/**
 * lib/memory.js — 学习与记忆层
 *
 * 记录每日步数历史，学习个人习惯，自适应调整策略。
 *
 * 三个核心输出：
 *   1. adaptiveTarget  — 基于 7 日平均，微调当天目标
 *   2. persona         — 识别用户类型（活跃/普通/宅）
 *   3. completionTrend — 预测今天何时达标
 */

const { dateStr } = require('./time');

// ==================== 历史管理 ====================

/** 初始化或清理历史记录 */
function ensureHistory(state, account) {
  if (!state.history) state.history = {};
  if (!state.history[account]) state.history[account] = [];
  return state.history[account];
}

/**
 * 归档昨天的数据到历史
 * 应在每天首次执行时调用
 */
function archiveYesterday(state, account) {
  const history = ensureHistory(state, account);
  const today = dateStr();

  // 如果昨天有数据但未归档
  if (state.date && state.date !== today) {
    const yesterday = state.date;
    const steps = state.accounts?.[account] || 0;
    const target = state.dailyTargets?.[account] || steps;
    const reached = steps >= target;

    // 避免重复归档
    const alreadyArchived = history.some(h => h.date === yesterday);
    if (!alreadyArchived && steps > 0) {
      history.push({
        date: yesterday,
        steps,
        target,
        reached,
        completionRatio: target > 0 ? Math.min(1, steps / target) : 0,
        executionCount: state.executionCount || 0,
        targetDate: state.targetDate || yesterday,
      });

      // 只保留最近 14 天
      if (history.length > 14) history.shift();
    }
  }
}

// ==================== 学习与分析 ====================

/** 计算 7 日滚动平均步数 */
function getRollingAverage(history) {
  if (history.length === 0) return null;
  const recent = history.slice(-7);
  const sum = recent.reduce((s, h) => s + h.steps, 0);
  return Math.round(sum / recent.length);
}

/** 计算平均达标率 */
function getAvgCompletionRatio(history) {
  if (history.length === 0) return 1.0;
  const recent = history.slice(-7);
  const sum = recent.reduce((s, h) => s + h.completionRatio, 0);
  return Math.round((sum / recent.length) * 100) / 100;
}

/** 识别用户类型 */
function identifyPersona(history) {
  if (history.length < 3) return { type: 'new', desc: '🧑 新用户', adjust: 1.0 };
  const avgSteps = getRollingAverage(history) || 8000;
  if (avgSteps > 10000) return { type: 'active', desc: '🏃 活跃型', adjust: 1.10 };
  if (avgSteps > 7000)  return { type: 'normal', desc: '🚶 普通型', adjust: 1.0 };
  return { type: 'sedentary', desc: '🪑 久坐型', adjust: 0.90 };
}

/**
 * 计算自适应目标：基于历史学习微调当日目标
 *
 * @param {number} baseMin - 基础目标下限
 * @param {number} baseMax - 基础目标上限
 * @param {array} history - 历史记录
 * @returns {{ tMin: number, tMax: number, reason: string }}
 */
function getAdaptiveTarget(baseMin, baseMax, history) {
  if (history.length < 3) {
    return { tMin: baseMin, tMax: baseMax, reason: '基础目标（数据不足）' };
  }

  const avgSteps = getRollingAverage(history);
  const completionRatio = getAvgCompletionRatio(history);
  const persona = identifyPersona(history);

  // 策略：基于近期达标率动态调整
  // >95% → +5%, 85-95% → ±0, 70-85% → -5%, 50-70% → -10%, <50% → -15%
  let adjustMin = baseMin, adjustMax = baseMax;
  let reason = '';

  if (completionRatio > 0.95) {
    adjustMin = Math.round(baseMin * 1.05);
    adjustMax = Math.round(baseMax * 1.05);
    reason = `近期达标率高(${Math.round(completionRatio*100)}%)，微提目标`;
  } else if (completionRatio >= 0.85) {
    // 85-95%：维持，不做调整
    reason = `近期达标率良好(${Math.round(completionRatio*100)}%)，维持目标`;
  } else if (completionRatio >= 0.70) {
    adjustMin = Math.round(baseMin * 0.94);
    adjustMax = Math.round(baseMax * 0.94);
    reason = `近期达标率偏低(${Math.round(completionRatio*100)}%)，微降目标`;
  } else if (completionRatio >= 0.50) {
    adjustMin = Math.round(baseMin * 0.88);
    adjustMax = Math.round(baseMax * 0.88);
    reason = `近期达标率低(${Math.round(completionRatio*100)}%)，降低目标`;
  } else {
    adjustMin = Math.round(baseMin * 0.82);
    adjustMax = Math.round(baseMax * 0.82);
    reason = `近期达标率很低(${Math.round(completionRatio*100)}%)，大幅降目标`;
  }

  // 限制目标不低于 7 天均值的 80%
  if (avgSteps > 0) {
    const floor = Math.round(avgSteps * 0.80);
    adjustMin = Math.max(adjustMin, floor);
    adjustMax = Math.max(adjustMax, floor + 500);
  }

  return { tMin: adjustMin, tMax: adjustMax, reason };
}

module.exports = {
  ensureHistory,
  archiveYesterday,
  getRollingAverage,
  getAvgCompletionRatio,
  identifyPersona,
  getAdaptiveTarget,
};
