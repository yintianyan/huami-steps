/**
 * lib/engine.js — 真实感增量计算引擎 v3
 *
 * 基于打工人习性模型：
 *   - 11 时段全覆盖（早起→通勤→办公→午餐→午休→办公→下班→晚间→居家→深夜）
 *   - 周末作息后移 + 活动量降低
 *   - 三角分布 + 久坐跳过 + 突发活跃 + 走路事件 + 渐进减速 + 达标后微量活动
 */
const { chinaHour } = require('./time');
const { isRestDay } = require('./calendar');
const { isNightShiftWeek, getShiftStatus, isSleepHour, getSleepDescription } = require('./shift');

// ==================== 随机工具 ====================

function rand(min, max) {
  return Math.floor(Math.random() * (max + 1 - min) + min);
}

function triangularRand(min, max) {
  const u = (Math.random() + Math.random()) / 2;
  return Math.round(min + u * (max - min));
}

// ==================== 日目标 ====================

function getDailyTarget(state, account, today, dailyMaxSteps, realism, options) {
  if (state.targetDate !== today) {
    state.targetDate = today;
    state.dailyTargets = {};
  }
  if (!state.dailyTargets) state.dailyTargets = {};
  if (!state.dailyTargets[account]) {
    let tMin, tMax, reason = '';
    if (realism?.enabled && realism.dailyMaxSteps) {
      const dd = realism.dailyMaxSteps;
      if (isRestDay(today) && dd.weekend) {
        tMin = dd.weekend.min;
        tMax = dd.weekend.max;
      } else if (!isRestDay(today) && dd.weekday) {
        tMin = dd.weekday.min;
        tMax = dd.weekday.max;
      }
    }
    if (tMin == null) {
      tMin = dailyMaxSteps?.min ?? 30000;
      tMax = dailyMaxSteps?.max ?? 30000;
    }
    // 🧠 自适应目标
    if (options?.smart && options.history?.length >= 3) {
      const { getAdaptiveTarget } = require('./memory');
      const adapted = getAdaptiveTarget(tMin, tMax, options.history);
      tMin = adapted.tMin;
      tMax = adapted.tMax;
      reason = adapted.reason;
    }
    // 🌙 夜班工作日目标降低
    const shiftStatus = require('./shift').getShiftStatus(realism);
    if (realism?.nightShift?.enabled && shiftStatus.shift === 'night' && shiftStatus.isWork) {
      const adj = realism.nightShift.dailyTargetAdjust ?? 0.85;
      tMin = Math.round(tMin * adj);
      tMax = Math.round(tMax * adj);
      reason = (reason ? reason + '，' : '') + '夜班模式';
    }
    state.dailyTargets[account] = triangularRand(tMin, tMax);
    state.targetReason = reason || null;
  }
  return state.dailyTargets[account];
}

// ==================== 时段匹配 ====================

function getTimeProfile(realism, globalIncMin, globalIncMax, options) {
  const today = options?.today || require('./time').dateStr();
  let hour = chinaHour();

  // 🌙 白夜班调度：自动检测 + 睡眠窗口强制跳过
  const shiftStatus = getShiftStatus(realism);
  let nightMult = 1.0, nightSkipBias = 0, nightBurstBias = 0;

  if (shiftStatus.shift === 'night') {
    const ns = realism?.nightShift || {};
    const realHour = hour;
    hour = (hour - (ns.hourShift ?? 12) + 24) % 24;
    nightMult = ns.activityMultiplier ?? 0.75;
    nightSkipBias = ns.skipIncrease ?? 0.10;
    nightBurstBias = ns.burstDecrease ?? 0.05;
    // 🌙 凌晨 0-3 点：夜班工作中段，活动适中（非通勤级）
    if (realHour >= 0 && realHour <= 3) {
      nightMult *= 0.60;
      nightSkipBias += 0.10;
    }
    // 🌙 凌晨 4-6 点：夜班最后2小时收尾，活动量降低
    if (realHour >= 4 && realHour <= 6) {
      nightMult *= 0.35;
      nightSkipBias += 0.35;
      nightBurstBias += 0.08;
    }    // 🌙 夜班上班第一小时(20:00)：通勤级活动
    if (realHour === 20) {
      nightMult = Math.max(nightMult, 1.0);
      nightSkipBias = Math.min(nightSkipBias, 0.05);
    }  }

  // 睡眠时间强制跳过（无论白班夜班）
  if (isSleepHour(realism)) {
    return { incMin: 0, incMax: 0, skipChance: 1.0, burstChance: 0,
      desc: '💤 ' + getSleepDescription(realism), nightMult: 1 };
  }

  // 休息日作息后移
  if (isRestDay(today) && realism?.weekendHourShift) {
    hour = (hour - realism.weekendHourShift + 24) % 24;
  }
  const restMult = (isRestDay(today) && realism?.weekendMultiplier)
    ? realism.weekendMultiplier : 1.0;
  const weatherMult = options?.weatherModifier ?? 1.0;
  const effectiveMult = restMult * weatherMult;

  const profile = realism?.timeProfile;
  if (!profile) {
    return { incMin: globalIncMin, incMax: globalIncMax, skipChance: 0, burstChance: 0, desc: '默认', nightMult: 1 };
  }

  // 休息日标签替换：去除通勤/办公语义
  function restLabel(desc) {
    if (!desc || !isRestDay(today)) return desc;
    // 用 replace 链做子串替换，比 map 更稳健（避免 emoji 编码差异）
    return desc.trim()
      .replace('💼 上午', '☀ 上午')
      .replace('💼 下午', '🌤 下午')
      .replace('🚇 晚通勤', '🚶 傍晚');
  }

  for (const [, cfg] of Object.entries(profile)) {
    const [hStart, hEnd] = cfg.hours;
    if (hour >= hStart && hour <= hEnd) {
      if (cfg.increment) {
        return {
          incMin: Math.round(cfg.increment.min * effectiveMult * nightMult),
          incMax: Math.round(cfg.increment.max * effectiveMult * nightMult),
          skipChance: Math.min(0.95, (cfg.skipChance ?? 0) + nightSkipBias),
          burstChance: Math.max(0, (cfg.burstChance ?? 0) - nightBurstBias),
          desc: (nightMult < 1 ? '🌙' : '') + restLabel(cfg.desc || ''),
          nightMult,
        };
      }
      // 兼容旧版 multiplier
      const mult = (cfg.multiplier ?? 1.0) * effectiveMult;
      return {
        incMin: Math.round(globalIncMin * mult),
        incMax: Math.round(globalIncMax * mult),
        skipChance: realism.skipChance ?? 0.15,
        burstChance: realism.burstChance ?? 0.20,
        desc: restLabel(cfg.desc || ''),
        nightMult,
      };
    }
  }
  return { incMin: globalIncMin, incMax: globalIncMax, skipChance: 0, burstChance: 0, desc: '默认', nightMult: 1 };
}

// ==================== 增量计算 ====================

function computeRealismIncrement(baseMin, baseMax, currentTotal, dailyTarget, realism, options) {
  const tags = [];

  if (!realism?.enabled) {
    const inc = realism?.distribution === 'triangular'
      ? triangularRand(baseMin, baseMax) : rand(baseMin, baseMax);
    return { increment: inc, tags: ['基础随机'] };
  }

  // 1. 时段配置（含天气修正）
  const tp = getTimeProfile(realism, baseMin, baseMax, options);
  tags.push(`${tp.desc} [${tp.incMin}~${tp.incMax}]`);

  // 🎢 异常值日：基于日期哈希，每周1-2天特殊模式
  const today = options?.today || require('./time').dateStr();
  const dateHash = today.split('-').reduce((s, n) => s + parseInt(n), 0);
  const specialMode = dateHash % 7; // 0-6
  let specialMult = 1.0, specialSkipBias = 0;
  if (specialMode === 0) {
    specialMult = 1.5; specialSkipBias = -0.15; // 暴走日
    if (!tags.some(t => t.includes('暴走'))) tags.push('🎢 暴走日');
  } else if (specialMode === 1) {
    specialMult = 0.55; specialSkipBias = 0.20; // 懒散日
    if (!tags.some(t => t.includes('懒散'))) tags.push('😴 懒散日');
  }

  // 天气标签
  if (options?.weatherDesc) {
    const wm = options.weatherModifier || 1;
    if (wm < 0.3) tags.push('⛈ 恶劣天气');
    else if (wm < 0.5) tags.push('🌧 大雨');
    else if (wm < 0.8) tags.push('🌦 小雨');
    else if (wm > 1.05) tags.push('☀ 晴好');
  }

  // 🏁 末段冲刺：窗口关闭前1h，≥85% → 跳过率归零、增量×1.3
  const progressRatio = currentTotal / dailyTarget;
  const hour = options?.hour ?? chinaHour();
  const isNightShift = (tp.nightMult || 1) < 1;
  const lastHour = isNightShift ? 6 : 20;
  let finalPush = false;
  if (hour === lastHour && progressRatio >= 0.85 && (dailyTarget - currentTotal) > 0) {
    finalPush = true;
    tags.push('🏁 末段冲刺');
  }

  // 2. 久坐跳过（末段冲刺时不跳过，特殊日调整概率）
  const effectiveSkip = Math.max(0, Math.min(0.95, tp.skipChance + specialSkipBias));
  if (!finalPush && Math.random() < effectiveSkip) {
    tags.push('🪑 久坐跳过');
    return { increment: 0, tags };
  }

  // 3. 走路事件（优先级高于突发）
  const we = realism.walkEvent;
  const nm = tp.nightMult || 1;
  const weChance = (we?.chance ?? 0.04) * nm;
  if (we && Math.random() < weChance) {
    const weMin = Math.round((we.steps?.min ?? 1000) * nm);
    const weMax = Math.round((we.steps?.max ?? 2500) * nm);
    const walkSteps = triangularRand(Math.max(50, weMin), Math.max(100, weMax));
    const remaining = dailyTarget - currentTotal;
    const capped = Math.min(walkSteps, Math.max(0, remaining));
    tags.length = 0;
    tags.push(`🚶 走路事件 +${capped}`);
    return { increment: capped, tags };
  }

  // 3.5 🏋 主动运动（概率低于走路，步数更大）
  const exChance = 0.02 * nm; // 2%基础概率
  if (Math.random() < exChance) {
    const exSteps = triangularRand(2000, 5000);
    const remaining = dailyTarget - currentTotal;
    const capped = Math.min(Math.round(exSteps * nm), Math.max(0, remaining));
    if (capped > 500) {
      tags.length = 0;
      tags.push(`🏋 主动运动 +${capped}`);
      return { increment: capped, tags };
    }
  }

  // 4. 突发活跃（可配置倍数）
  let effectiveMult = 1.0;
  if (Math.random() < tp.burstChance) {
    const bMin = realism.burstMultiplier?.min ?? 2.0;
    const bMax = realism.burstMultiplier?.max ?? 4.0;
    const burstMult = Math.round((bMin + Math.random() * (bMax - bMin)) * 10) / 10;
    effectiveMult = burstMult;
    tags.push(`🏃 突发 ×${burstMult.toFixed(1)}`);
  }

  // 5. 渐进式减速（末段冲刺时减半减速力度）
  const remaining = dailyTarget - currentTotal;
  if (realism.deceleration && remaining > 0) {
    if (progressRatio > 0.75) {
      let decelFactor = 1.0 - ((progressRatio - 0.75) / 0.25) * 0.7;
      if (finalPush) decelFactor = Math.max(0.6, decelFactor); // 冲刺时减速更温和
      const clampedDecel = Math.max(0.3, decelFactor);
      effectiveMult *= clampedDecel;
      if (clampedDecel < 0.95) tags.push(`🐢 减速 ×${clampedDecel.toFixed(2)}`);
    }
  }

  // 🏁 末段冲刺增量加成
  if (finalPush) {
    effectiveMult *= 1.4;
  }

  // 7. 计算最终增量（含异常值日修正）
  const useTriangular = realism.distribution !== 'uniform';
  const base = useTriangular ? triangularRand(tp.incMin, tp.incMax) : rand(tp.incMin, tp.incMax);
  const increment = Math.max(1, Math.round(base * effectiveMult * specialMult));
  const cappedInc = Math.min(increment, Math.max(0, remaining));

  return { increment: cappedInc, tags };
}

// ==================== 达标后微量活动 ====================

function maybeAfterTargetIncrement(currentTotal, dailyTarget, realism) {
  if (!realism?.enabled) return 0;
  if (currentTotal < dailyTarget) return 0;
  const chance = realism.afterTargetChance ?? 0.10;
  if (Math.random() >= chance) return 0;
  return triangularRand(10, 80);
}

module.exports = {
  rand,
  triangularRand,
  getDailyTarget,
  getTimeProfile,
  computeRealismIncrement,
  maybeAfterTargetIncrement,
};
