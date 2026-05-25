/**
 * lib/learn.js — 统计学习引擎
 *
 * 分析历史步数数据，生成个性化参数：
 *   1. 步数分布曲线 → 自定义时段配置
 *   2. 工作日/周末差异量化
 *   3. 最优目标区间
 *   4. 活动类型识别（规律型/波动型/两极型）
 */
const { triangularRand } = require('./engine');

// ==================== 统计分析 ====================

function analyze(history) {
  if (!history || history.length < 5) {
    return { ready: false, reason: `数据不足（需 ≥5 天，当前 ${history?.length || 0} 天）` };
  }

  const weekdays = history.filter(d => {
    const day = new Date(d.date).getDay();
    return day !== 0 && day !== 6;
  });
  const weekends = history.filter(d => {
    const day = new Date(d.date).getDay();
    return day === 0 || day === 6;
  });

  // 基础统计
  const avg = arr => arr.length ? Math.round(arr.reduce((s, d) => s + d.steps, 0) / arr.length) : 0;
  const std = (arr, mean) => {
    if (arr.length < 2) return 0;
    return Math.round(Math.sqrt(arr.reduce((s, d) => s + Math.pow(d.steps - mean, 2), 0) / arr.length));
  };

  const wdAvg = avg(weekdays);
  const weAvg = avg(weekends);
  const wdStd = std(weekdays, wdAvg);
  const weStd = std(weekends, weAvg);

  // 达标率
  const wdReachRate = weekdays.length ? weekdays.filter(d => d.reached).length / weekdays.length : 0;
  const weReachRate = weekends.length ? weekends.filter(d => d.reached).length / weekends.length : 0;

  // 波动性分析
  const coefficient = wdAvg > 0 ? wdStd / wdAvg : 0;
  let patternType, patternDesc;
  if (coefficient < 0.15) {
    patternType = 'steady'; patternDesc = '📏 规律型（步数稳定）';
  } else if (coefficient < 0.30) {
    patternType = 'moderate'; patternDesc = '🌊 波动型（时多时少）';
  } else {
    patternType = 'extreme'; patternDesc = '🎢 两极型（高低悬殊）';
  }

  // 最优目标区间
  const targetMin = Math.round((wdAvg * 0.85 + weAvg * 0.85) / 2);
  const targetMax = Math.round((wdAvg * 1.15 + weAvg * 1.15) / 2);
  const weekendMin = Math.round(weAvg * 0.8);
  const weekendMax = Math.round(weAvg * 1.2);

  // 周末差异度
  const weekendRatio = wdAvg > 0 ? weAvg / wdAvg : 0.7;
  let weekendStyle;
  if (weekendRatio > 0.9) weekendStyle = 'active';      // 周末几乎不减
  else if (weekendRatio > 0.6) weekendStyle = 'moderate'; // 周末适当减少
  else weekendStyle = 'rest';                             // 周末大幅减少

  return {
    ready: true,
    weekdayAvg: wdAvg, weekendAvg: weAvg,
    weekdayStd: wdStd, weekendStd: weStd,
    weekdayReachRate: Math.round(wdReachRate * 100),
    weekendReachRate: Math.round(weReachRate * 100),
    patternType, patternDesc,
    weekendRatio: Math.round(weekendRatio * 100),
    weekendStyle,
    optimal: {
      weekdayMin: targetMin, weekdayMax: targetMax,
      weekendMin, weekendMax,
      weekendMultiplier: Math.round(weekendRatio * 100) / 100,
    },
    days: history.length,
  };
}

// ==================== 个性化时段生成 ====================

/**
 * 基于统计数据生成个性化时段配置
 * 规律型 → 标准上班族模式
 * 波动型 → 加宽波动范围
 * 两极型 → 极端高低交错
 */
function generatePersonalizedTimeProfile(analysis, basePreset) {
  const { patternType, weekdayAvg } = analysis;

  // 基础时段（复制 preset）
  const profile = JSON.parse(JSON.stringify(basePreset));

  // 根据日均步数缩放所有增量区间
  const baseAvg = 8000; // 预设基于 8000 步基准
  const scaleFactor = weekdayAvg / baseAvg;

  for (const key of Object.keys(profile)) {
    const cfg = profile[key];
    if (cfg.increment && cfg.increment.min > 0) {
      cfg.increment.min = Math.max(5, Math.round(cfg.increment.min * scaleFactor));
      cfg.increment.max = Math.max(10, Math.round(cfg.increment.max * scaleFactor));
    }
  }

  // 根据波动类型调整跳过率
  if (patternType === 'steady') {
    // 规律型：减少随机跳过，更稳定
    for (const key of Object.keys(profile)) {
      if (profile[key].skipChance > 0.1) profile[key].skipChance *= 0.8;
    }
  } else if (patternType === 'extreme') {
    // 两极型：增加随机波动
    for (const key of Object.keys(profile)) {
      if (profile[key].skipChance < 0.8) profile[key].skipChance *= 1.2;
      if (profile[key].burstChance < 0.3) profile[key].burstChance *= 1.3;
    }
  }

  return profile;
}

// ==================== 建议输出 ====================

function suggestConfig(analysis) {
  if (!analysis.ready) return analysis;

  const o = analysis.optimal;
  return {
    analysis,
    recommendation: {
      dailyMaxSteps: {
        weekday: { min: o.weekdayMin, max: o.weekdayMax },
        weekend: { min: o.weekendMin, max: o.weekendMax },
      },
      weekendMultiplier: o.weekendMultiplier,
      pattern: analysis.patternDesc,
      weekendStyle: analysis.weekendStyle === 'active' ? '周末活跃型' :
                    analysis.weekendStyle === 'moderate' ? '周末适度减少' : '周末大幅减少',
    },
  };
}

module.exports = { analyze, generatePersonalizedTimeProfile, suggestConfig };
