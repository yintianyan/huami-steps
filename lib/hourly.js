/**
 * lib/hourly.js — 小时级数据导入与分析
 *
 * 用法：node huami-steps.js --hourly hourly-template.json
 */
const fs = require('fs');

function importHourly(filePath, state, account) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const slots = data.slots || {};
  const date = data.date;
  const dayOfWeek = data.dayOfWeek || '';

  // 计算总步数
  const totalSteps = Object.values(slots).reduce((s, v) => s + v, 0);
  if (totalSteps === 0) {
    console.log('⚠ 所有时段都是 0，请填入步数');
    return 0;
  }

  // 分析小时分布（兼容两种格式）
  const hourlyDist = {};
  for (const [key, steps] of Object.entries(slots)) {
    // 支持 "00:00" 或 "00:00-00:30" 格式
    const hour = parseInt(key.split(':')[0]);
    hourlyDist[hour] = (hourlyDist[hour] || 0) + steps;
  }

  console.log(`\n📊 ${date} ${dayOfWeek} — 总计 ${totalSteps.toLocaleString('zh-CN')} 步`);
  console.log('──────────────────────────────────');
  console.log('  时段分布：');

  const maxH = Math.max(1, ...Object.values(hourlyDist));
  for (let h = 0; h < 24; h++) {
    const s = hourlyDist[h] || 0;
    if (s > 0) {
      const bar = '█'.repeat(Math.round(s / maxH * 30));
      const pct = Math.round(s / totalSteps * 100);
      console.log(`  ${String(h).padStart(2,'0')}:00 ${bar} ${s.toLocaleString('zh-CN')} (${pct}%)`);
    }
  }

  // 识别活跃时段
  const activeHours = Object.entries(hourlyDist)
    .filter(([, s]) => s > totalSteps * 0.05)
    .map(([h]) => parseInt(h));

  console.log(`\n  活跃时段：${activeHours.map(h => h+':00').join(', ')}`);
  console.log(`  高峰时段：${Object.entries(hourlyDist).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([h,s])=>h+':00('+Math.round(s/totalSteps*100)+'%)').join(', ')}`);

  // 保存到历史
  if (!state.history) state.history = {};
  if (!state.history[account]) state.history[account] = [];

  // 避免重复
  const exists = state.history[account].some(h => h.date === date);
  if (!exists) {
    state.history[account].push({
      date,
      steps: totalSteps,
      target: Math.round(totalSteps * 0.9),
      reached: true,
      completionRatio: 1,
      executionCount: Math.ceil(totalSteps / 400),
      targetDate: date,
      hourlyDistribution: hourlyDist, // 保存小时分布
    });
    console.log(`  ✅ 已保存到历史`);
  } else {
    console.log(`  ⚠ ${date} 已存在，跳过`);
  }

  return 1;
}

module.exports = { importHourly };
