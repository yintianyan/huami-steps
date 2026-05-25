#!/usr/bin/env node
/**
 * sim-month.js — N天本地模拟（环境隔离，完整日志输出）
 * 用法：node sim-month.js [天数] [起始日期]
 */
const fs = require('fs');
const path = require('path');

const SIM_DIR = path.join(__dirname, 'sim');
if (!fs.existsSync(SIM_DIR)) fs.mkdirSync(SIM_DIR);

const DAYS = parseInt(process.argv[2]) || 30;
const START = process.argv[3] || '2026-05-26';

// ==================== 日志 ====================
const logFile = path.join(SIM_DIR, 'sim-month.log');
fs.writeFileSync(logFile, '');
function simLog(msg) { console.log(msg); fs.appendFileSync(logFile, msg + '\n'); }

// ==================== 依赖 ====================
const { loadConfig } = require('./lib/config');
const { setSimTime, clearSimTime, chinaHour } = require('./lib/time');
const {
  getDailyTarget, getTimeProfile,
  computeRealismIncrement, maybeAfterTargetIncrement,
} = require('./lib/engine');
const { isRestDay } = require('./lib/calendar');
const { getShiftStatus, getSleepWindows, isSleepHour } = require('./lib/shift');
const { midDayAdjust } = require('./lib/adapt');
const { getDayOfWeekAdjustment } = require('./lib/weekly');
const { generateSeedHistory } = require('./lib/seed');

const CONFIG = loadConfig();
const ACCOUNT = CONFIG.accounts[0]?.account || 'test@test.com';
const incMin = CONFIG.incrementRange?.min ?? 200;
const incMax = CONFIG.incrementRange?.max ?? 600;

// ==================== 独立状态 ====================
const simState = {
  date: null, targetDate: null,
  accounts: {}, dailyTargets: {}, tokenCache: {},
  lastExecution: null, executionCount: 0, history: {},
};

// 种子历史
const seedHistory = generateSeedHistory({ days: 30, weekdayAvg: 8000, weekendAvg: 5000 });
simState.history = { [ACCOUNT]: seedHistory };

function formatSteps(n) { return (n || 0).toLocaleString('zh-CN'); }

// ==================== 模拟一天 ====================
function simulateDay(dateStr, dow) {
  setSimTime({ date: dateStr, dow, hour: 0 });

  const shift = getShiftStatus(CONFIG.realism);
  const sleepWindows = getSleepWindows(CONFIG.realism);
  const restDay = isRestDay(dateStr);

  simState.date = dateStr;
  simState.targetDate = null;
  simState.dailyTargets = {};
  simState.accounts = {};
  simState.executionCount = 0;

  let total = 0;
  const target = getDailyTarget(simState, ACCOUNT, dateStr, CONFIG.dailyMaxSteps, CONFIG.realism, {
    smart: true, history: simState.history?.[ACCOUNT] || [],
  });

  let ok = 0, skip = 0, after = 0;

  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      setSimTime({ date: dateStr, dow, hour: h });

      // 时段守卫
      const sStart = (shift.shift === 'night' && shift.isWork) ? 14 : 7;
      const sEnd = (shift.shift === 'night' && shift.isWork) ? 7 : 21;
      const inWindow = (sStart <= sEnd) ? (h >= sStart && h <= sEnd) : (h >= sStart || h <= sEnd);
      if (!inWindow) continue;

      // 睡眠检测
      const sleeping = sleepWindows.some(w => h >= w.start && h < w.end);
      if (sleeping) continue;

      // 执行头（每个时段首次执行打印）
      const tp = getTimeProfile(CONFIG.realism, incMin, incMax, { today: dateStr, weatherModifier: 1.0 });
      const headerLine = `${dateStr} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}  ▶ | 增量 ${incMin}~${incMax} | ${restDay?'休息日':'工作日'} | ${tp.desc} [${tp.incMin}~${tp.incMax}] | 跳过${Math.round(tp.skipChance*100)}%`;
      if (m === 0) simLog(headerLine); // 每小时打印一次头

      // 已达目标
      if (total >= target) {
        const afterInc = maybeAfterTargetIncrement(total, target, CONFIG.realism);
        if (afterInc > 0) {
          total += afterInc;
          after++;
          simLog(`  🔁 ${ACCOUNT}  ${total-afterInc} → +${afterInc} → ${total} / ${target}  微量活动`);
        }
        continue;
      }

      // 真实感增量
      const comp = computeRealismIncrement(incMin, incMax, total, target, CONFIG.realism, {
        today: dateStr, smart: true, weatherModifier: 1.0, weatherDesc: '', hour: h,
      });

      let inc = comp.increment;
      if (inc > 0) {
        const adj = midDayAdjust(total, target, simState);
        if (adj.factor !== 1.0) inc = Math.round(inc * adj.factor);
        const dayAdj = getDayOfWeekAdjustment(simState.history?.[ACCOUNT] || []);
        if (dayAdj.factor !== 1.0) inc = Math.round(inc * dayAdj.factor);
      }

      let newTotal = total + inc;
      const overshoot = target > 0 ? (newTotal - target) / target : 0;
      if (overshoot > 0.05) {
        newTotal = target + Math.round(target * 0.03);
        inc = newTotal - total;
        comp.tags.push('🎯 软着陆');
      } else if (overshoot > 0 && overshoot <= 0.05) {
        comp.tags.push('🎯 自然达标');
      }

      if (inc > 0) {
        total = newTotal;
        ok++;
        const pct = target > 0 ? Math.round(total / target * 100) : 0;
        const bar = '█'.repeat(Math.min(Math.ceil(pct / 5), 20));
        const tags = comp.tags.join(' | ');
        simLog(`  ✅ ${ACCOUNT}  ${total-inc} → +${inc} → ${total} / ${target}  ${bar} ${pct}%  ${tags}`);
      } else {
        skip++;
        simLog(`  🪑 ${ACCOUNT}  跳过  ${comp.tags.join(' | ')}`);
      }

      simState.accounts[ACCOUNT] = total;
      simState.executionCount++;
    }
  }

  const reached = total >= target;

  // 归档
  if (!simState.history[ACCOUNT]) simState.history[ACCOUNT] = [];
  simState.history[ACCOUNT].push({
    date: dateStr, steps: total, target, reached,
    completionRatio: target > 0 ? Math.min(1, total / target) : 0,
    executionCount: ok, targetDate: dateStr,
  });
  if (simState.history[ACCOUNT].length > 60) simState.history[ACCOUNT].shift();

  clearSimTime();

  // 日汇总
  const icon = reached ? '✅' : total > target * 0.9 ? '🔶' : total > target * 0.7 ? '🔸' : '❌';
  const shiftIcon = shift.shift === 'night' ? '🌙' : shift.shift === 'rest' ? '😴' : '☀';
  simLog(`${icon} ${dateStr} ${['日','一','二','三','四','五','六'][dow]} ${shiftIcon} ${formatSteps(total)} / ${formatSteps(target)} | ✅${ok} 🪑${skip} 🔁${after} | ${reached ? '达标' : Math.round(total/target*100)+'%'}`);

  return { date: dateStr, dow, shift: shift.shift, isWork: shift.isWork, total, target, reached, ok, skip, after };
}

// ==================== 主循环 ====================
function main() {
  const now = new Date();
  simLog(`🚀 模拟 ${DAYS} 天 | 起始 ${START} | ${now.toISOString().slice(0,19)}`);
  simLog('═'.repeat(60));

  const results = [];
  const start = new Date(START + 'T12:00:00+08:00');

  for (let d = 0; d < DAYS; d++) {
    const dt = new Date(start);
    dt.setDate(dt.getDate() + d);
    const dateStr = dt.toISOString().slice(0, 10);
    const dow = dt.getDay();

    const r = simulateDay(dateStr, dow);
    results.push(r);
  }

  // ==================== 报告 ====================
  console.log('\n' + '='.repeat(60));
  console.log('📊 模拟分析报告');
  console.log('='.repeat(60));

  const avgSteps = Math.round(results.reduce((s, r) => s + r.total, 0) / results.length);
  const avgTarget = Math.round(results.reduce((s, r) => s + r.target, 0) / results.length);
  const reachedDays = results.filter(r => r.reached).length;

  console.log(`总天数: ${DAYS} | 达标: ${reachedDays} (${Math.round(reachedDays / DAYS * 100)}%)`);
  console.log(`日均步数: ${formatSteps(avgSteps)} | 日均目标: ${formatSteps(avgTarget)}`);
  console.log(`日均执行: ${Math.round(results.reduce((s, r) => s + r.ok, 0) / DAYS)}次 | 日均跳过: ${Math.round(results.reduce((s, r) => s + r.skip, 0) / DAYS)}次`);

  // 按班次
  const dayRes = results.filter(r => r.shift === 'day' && r.isWork);
  const nightRes = results.filter(r => r.shift === 'night' && r.isWork);
  const restRes = results.filter(r => !r.isWork);
  const avg = arr => arr.length ? Math.round(arr.reduce((s, r) => s + r.total, 0) / arr.length) : 0;

  console.log(`\n☀ 白班(${dayRes.length}天): 日均 ${formatSteps(avg(dayRes))} | 达标 ${dayRes.filter(r => r.reached).length}/${dayRes.length}`);
  console.log(`🌙 夜班(${nightRes.length}天): 日均 ${formatSteps(avg(nightRes))} | 达标 ${nightRes.filter(r => r.reached).length}/${nightRes.length}`);
  console.log(`😴 休息(${restRes.length}天): 日均 ${formatSteps(avg(restRes))}`);

  // 步数分布
  const ranges = { '0-3k': 0, '3-6k': 0, '6-9k': 0, '9-12k': 0, '12k+': 0 };
  results.forEach(r => {
    if (r.total < 3000) ranges['0-3k']++;
    else if (r.total < 6000) ranges['3-6k']++;
    else if (r.total < 9000) ranges['6-9k']++;
    else if (r.total < 12000) ranges['9-12k']++;
    else ranges['12k+']++;
  });
  console.log(`\n分布: ${Object.entries(ranges).map(([k, v]) => k + ':' + v).join(' | ')}`);

  // 达标深度分析
  const reachedDays2 = results.filter(r => r.reached);
  if (reachedDays2.length > 0) {
    const avgExec = Math.round(reachedDays2.reduce((s, r) => s + r.ok, 0) / reachedDays2.length);
    const minExec = Math.min(...reachedDays2.map(r => r.ok));
    const maxExec = Math.max(...reachedDays2.map(r => r.ok));
    const avgPerExec = Math.round(reachedDays2.reduce((s, r) => r.ok > 0 ? s + r.total / r.ok : s, 0) / reachedDays2.length);
    console.log(`\n📐 达标日分析:`);
    console.log(`  执行次数: 均${avgExec} | 最少${minExec} | 最多${maxExec}`);
    console.log(`  每次增量: ${avgPerExec} 步/次 (${avgPerExec < 400 ? '✅' : '⚠'} 多次少步)`);
  }

  // 未达标日分析
  const notReached = results.filter(r => !r.reached);
  if (notReached.length > 0) {
    const avgPct = Math.round(notReached.reduce((s, r) => s + r.total / r.target * 100, 0) / notReached.length);
    const avgGap = Math.round(notReached.reduce((s, r) => s + (r.target - r.total), 0) / notReached.length);
    console.log(`\n📐 未达标日(${notReached.length}天): 均完成 ${avgPct}% | 均差 ${formatSteps(avgGap)} 步`);
  }

  // 异常检测
  console.log(`\n🔍 异常:`);
  let anomalies = 0;
  results.forEach(r => {
    if (r.total > r.target * 1.5) { console.log(`  ⚠ ${r.date}: ${r.total} > ${r.target} (+${Math.round((r.total/r.target-1)*100)}%)`); anomalies++; }
    if (r.total < r.target * 0.2 && r.isWork) { console.log(`  ⚠ ${r.date}: ${r.total} < ${r.target} (${Math.round(r.total/r.target*100)}%)`); anomalies++; }
    if (r.ok === 0 && r.isWork) { console.log(`  ⚠ ${r.date}: 0次成功执行`); anomalies++; }
    if (r.ok > 35) { console.log(`  ⚠ ${r.date}: 执行${r.ok}次偏多`); anomalies++; }
  });
  if (anomalies === 0) console.log('  ✅ 未发现异常');

  fs.writeFileSync(path.join(SIM_DIR, 'sim-detail.json'), JSON.stringify(results, null, 2));
  console.log(`\n📄 sim/sim-detail.json  |  sim/sim-month.log`);
  console.log('✅ 模拟完成\n');
}

main();
