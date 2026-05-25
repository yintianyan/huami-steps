/**
 * lib/state.js — 运行时状态持久化
 *
 * state.json 结构：
 * {
 *   date,           // 当前日期（由累加函数更新）
 *   targetDate,     // 日目标的日期（独立校验，避免跨天泄漏）
 *   accounts: { account: steps },
 *   dailyTargets: { account: target },
 *   tokenCache: { account: { userId, appToken, loginToken, cachedAt } },
 *   lastExecution,  // 最后执行时间
 *   executionCount  // 当日执行次数
 * }
 */
const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'state.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

// ==================== 步数累加逻辑 ====================

function getAccumulatedSteps(state, account, today) {
  if (state.date !== today) {
    state.date = today;
    state.accounts = {};
  }
  if (!state.accounts) state.accounts = {};
  return state.accounts[account] || 0;
}

function setAccumulatedSteps(state, account, today, steps) {
  state.date = today;
  if (!state.accounts) state.accounts = {};
  state.accounts[account] = steps;
}

// ==================== 外部同步检测 ====================

/** 记录服务器步数快照，用于检测外部来源（手机手表同步） */
function trackExternalSync(state, account, serverSteps) {
  if (!state._externalSync) state._externalSync = {};
  if (!state._externalSync[account]) state._externalSync[account] = { lastCheck: null, lastServerSteps: 0, externalIncrements: 0 };

  const track = state._externalSync[account];
  const prev = track.lastServerSteps;
  track.lastServerSteps = serverSteps;
  track.lastCheck = new Date().toISOString();

  if (prev > 0 && serverSteps > prev) {
    const extInc = serverSteps - prev;
    track.externalIncrements += extInc;
    return { hasExternal: true, increment: extInc, totalExternal: track.externalIncrements };
  }
  return { hasExternal: false, increment: 0, totalExternal: track.externalIncrements };
}

/** 获取外部同步修正系数（外部步数越多，脚本贡献应越小） */
function getExternalDampenFactor(state, account, dailyTarget) {
  const track = state._externalSync?.[account];
  if (!track || dailyTarget <= 0) return 1.0;
  const ratio = track.externalIncrements / dailyTarget;
  // 外部贡献 > 30% → 脚本降至 50%；> 60% → 降至 30%
  if (ratio > 0.6) return 0.3;
  if (ratio > 0.3) return 0.5;
  return 1.0;
}

function logExecution(state) {
  const { datetimeStr } = require('./time');
  state.lastExecution = datetimeStr();
  state.executionCount = (state.executionCount || 0) + 1;
}

module.exports = {
  STATE_PATH,
  loadState,
  saveState,
  getAccumulatedSteps,
  setAccumulatedSteps,
  logExecution,
  trackExternalSync,
  getExternalDampenFactor,
};
