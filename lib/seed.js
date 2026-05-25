/**
 * lib/seed.js — 种子数据生成
 *
 * 基于用户输入生成合理的历史步数，快速启动智能学习
 *
 * 用法：node huami-steps.js --seed
 */
const { triangularRand } = require('./engine');

/**
 * 基于参数生成 N 天的模拟历史数据
 * @param {{ days: number, weekdayAvg: number, weekendAvg: number, variance: number }} params
 * @returns {Array<{date:string, steps:number, target:number, reached:boolean, completionRatio:number}>}
 */
function generateSeedHistory(params = {}) {
  const days = params.days || 30;
  const wdAvg = params.weekdayAvg || 8000;
  const weAvg = params.weekendAvg || 5000;
  const variance = params.variance || 0.2; // ±20%

  const history = [];
  const now = new Date();

  for (let i = days; i >= 1; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const baseAvg = isWeekend ? weAvg : wdAvg;
    const min = Math.round(baseAvg * (1 - variance));
    const max = Math.round(baseAvg * (1 + variance));
    const steps = triangularRand(min, max);
    const target = triangularRand(Math.round(baseAvg * 1.05), Math.round(baseAvg * 1.25));
    const reached = steps >= target;

    history.push({
      date: dateStr,
      steps,
      target,
      reached,
      completionRatio: target > 0 ? Math.min(1, steps / target) : 1,
      executionCount: Math.ceil(steps / 400),
      targetDate: dateStr,
    });
  }

  return history;
}

module.exports = { generateSeedHistory };
