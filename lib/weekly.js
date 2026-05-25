/**
 * lib/weekly.js — 周模式学习
 *
 * 从历史数据学习每周各天的行为模式：
 *   - 周一通常步数多（新的一周）还是少（周一综合症）？
 *   - 周五是否有"周末前放松"效应？
 */
const { triangularRand } = require('./engine');

/**
 * 分析每周各天的平均步数
 * @returns {{ [day: string]: { avg: number, count: number } }}
 */
function learnDayPatterns(history) {
  const days = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  for (const entry of history) {
    const d = new Date(entry.date).getDay();
    days[d].push(entry.steps);
  }

  const patterns = {};
  for (let i = 0; i < 7; i++) {
    if (days[i].length >= 2) {
      const avg = Math.round(days[i].reduce((s, v) => s + v, 0) / days[i].length);
      patterns[dayNames[i]] = { avg, count: days[i].length, samples: days[i] };
    }
  }

  return patterns;
}

/**
 * 获取今天相对于周均的修正系数
 * 例如：周一通常比周均值高 15% → 返回 1.15
 */
function getDayOfWeekAdjustment(history) {
  if (history.length < 14) return { factor: 1.0, reason: '' };

  const patterns = learnDayPatterns(history);
  const today = new Date().getDay();
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const todayName = dayNames[today];

  const todayPattern = patterns[todayName];
  if (!todayPattern) return { factor: 1.0, reason: '' };

  // 计算周均值
  let total = 0, count = 0;
  for (const [, p] of Object.entries(patterns)) {
    total += p.avg * p.count;
    count += p.count;
  }
  const weekAvg = count > 0 ? total / count : todayPattern.avg;

  const ratio = todayPattern.avg / weekAvg;
  if (ratio > 1.15) return { factor: ratio, reason: `${todayName}通常较活跃 (+${Math.round((ratio - 1) * 100)}%)` };
  if (ratio < 0.85) return { factor: ratio, reason: `${todayName}通常较安静 (${Math.round(ratio * 100)}%)` };
  return { factor: 1.0, reason: '' };
}

module.exports = { learnDayPatterns, getDayOfWeekAdjustment };
