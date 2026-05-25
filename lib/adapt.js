/**
 * lib/adapt.js — 实时自适应引擎
 *
 * 三个核心能力：
 *   1. 中程调整 — 根据当前进度动态调整增量
 *   2. 达标预测 — 预估今天几点能达标
 *   3. 作息连贯 — 昨天晚达标 → 今天晚启动
 */
const { chinaHour } = require('./time');

// ==================== 中程进度调整 ====================

/**
 * 根据"当前时间 vs 当前进度"判断是否应该加速或减速
 *
 * 理想进度曲线（打工人模型）：
 *   10:00 → 10%  12:00 → 20%  14:00 → 25%
 *   17:00 → 40%  19:00 → 65%  21:00 → 90%
 *
 * @returns {{ factor: number, status: string, eta: string }}
 *   factor: 1.0=正常, >1=加速, <1=减速
 */
function midDayAdjust(currentSteps, dailyTarget, state) {
  const hour = chinaHour();
  if (hour < 7 || hour >= 22) return { factor: 1.0, status: '非活跃时段', eta: '—' };
  if (dailyTarget <= 0) return { factor: 1.0, status: '无目标', eta: '—' };

  const progress = currentSteps / dailyTarget;

  // 理想进度表（24小时制 → 预期完成%）
  const idealProgress = {
    7: 0.00, 8: 0.05, 9: 0.12, 10: 0.16, 11: 0.19,
    12: 0.24, 13: 0.27, 14: 0.30, 15: 0.33, 16: 0.36,
    17: 0.43, 18: 0.52, 19: 0.62, 20: 0.76, 21: 0.88, 22: 0.95,
  };

  const expected = idealProgress[hour] || 0.5;
  const gap = progress - expected;

  let factor, status;
  if (gap < -0.15) {
    // 严重落后 → 加速 30%
    factor = 1.30; status = `⚠ 落后 ${Math.round(Math.abs(gap) * 100)}%，加速中`;
  } else if (gap < -0.08) {
    // 轻度落后 → 加速 15%
    factor = 1.15; status = `🔶 轻度落后，小幅加速`;
  } else if (gap > 0.15) {
    // 大幅超前 → 减速 30%
    factor = 0.70; status = `🟢 超前 ${Math.round(gap * 100)}%，放缓中`;
  } else if (gap > 0.08) {
    // 轻度超前 → 减速 15%
    factor = 0.85; status = `✅ 轻度超前，适当放缓`;
  } else {
    factor = 1.0; status = '✅ 进度正常';
  }

  // 预测达标时间
  const remaining = dailyTarget - currentSteps;
  const avgIncPerExec = currentSteps / Math.max(1, state.executionCount || 1);
  const execsNeeded = avgIncPerExec > 0 ? Math.ceil(remaining / (avgIncPerExec * factor)) : 99;
  const minsToGo = execsNeeded * 30; // 每30分钟一次
  const etaDate = new Date(Date.now() + minsToGo * 60000 + 8 * 3600000);
  const eta = `${String(etaDate.getUTCHours()).padStart(2, '0')}:${String(etaDate.getUTCMinutes()).padStart(2, '0')}`;

  return { factor, status, eta, progress: Math.round(progress * 100), expected: Math.round(expected * 100) };
}

// ==================== 作息连贯性 ====================

/**
 * 基于昨日达标时间，调整今日起始活跃度
 * 昨天 22:30 才达标 → 今天推迟早起，降低早晨增量
 */
function sleepCoherence(state, realism) {
  const history = state.history?.[Object.keys(state.history || {})[0]] || [];
  if (history.length < 2) return { morningDelay: 0, morningDampen: 1.0, reason: '' };

  const yesterday = history[history.length - 1];
  if (!yesterday || !yesterday.reached) return { morningDelay: 0, morningDampen: 1.0, reason: '' };

  // 估算昨日达标时的小时（基于执行次数）
  const execCount = yesterday.executionCount || 10;
  // 假设 7:00 开始，每30分钟一次
  const finishMinute = 7 * 60 + execCount * 30;
  const finishHour = finishMinute / 60;

  if (finishHour > 21) {
    // 昨天很晚才达标 → 今天晚起，早晨减量
    return { morningDelay: 1, morningDampen: 0.7, reason: `昨日${Math.round(finishHour)}点达标，今日晚起` };
  } else if (finishHour > 20) {
    return { morningDelay: 0.5, morningDampen: 0.85, reason: `昨日较晚达标` };
  }
  return { morningDelay: 0, morningDampen: 1.0, reason: '' };
}

module.exports = { midDayAdjust, sleepCoherence };
