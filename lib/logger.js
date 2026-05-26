/**
 * lib/logger.js — 结构化日志系统
 *
 * 双写：huami-steps.log（文本）+ huami-steps.jsonl（结构化）
 * 追踪连续错误次数，支持告警阈值
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..');
const TEXT_LOG = path.join(LOG_DIR, 'huami-steps.log');
const JSON_LOG = path.join(LOG_DIR, 'huami-steps.jsonl');
const STATE_PATH = path.join(LOG_DIR, 'state.json');

// ==================== 日志写入 ====================

function formatTime() {
  return new Date(new Date().getTime() + 8 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').split('.')[0];
}

function appendText(line) {
  fs.appendFileSync(TEXT_LOG, line + '\n');
}

function appendJSON(entry) {
  entry.time = formatTime();
  fs.appendFileSync(JSON_LOG, JSON.stringify(entry) + '\n');
}

// ==================== 错误追踪 ====================

function loadErrorState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
      return s._errors || { consecutive: 0, total: 0, lastError: null };
    }
  } catch { /* ignore */ }
  return { consecutive: 0, total: 0, lastError: null };
}

function saveErrorState(errState) {
  try {
    let s = {};
    if (fs.existsSync(STATE_PATH)) {
      s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    }
    s._errors = errState;
    fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
  } catch { /* ignore */ }
}

// ==================== 公开 API ====================

/** 普通信息日志（仅写文件，避免控制台重复） */
function info(msg, data = {}) {
  const line = `${formatTime()}  ${msg}`;
  appendText(line);
  appendJSON({ level: 'info', msg, ...data });
}

/** 单行执行头 */
function execHeader(meta) {
  const parts = [`${formatTime()}  ▶`];
  if (meta.inc) parts.push(`增量 ${meta.inc}`);
  if (meta.dayType) parts.push(meta.dayType);
  if (meta.weather) parts.push(meta.weather);
  if (meta.slot) parts.push(meta.slot);
  if (meta.skipPct != null) parts.push(`跳过${meta.skipPct}%`);
  const line = parts.join(' | ');
  console.log(line);
  return line;
}

/** 执行结果 — 单行紧凑格式 */
function logExecution(account, result) {
  const st = result.status;
  const icon = st === 'ok' ? '✅' : st === 'skipped' ? '🪑' : st === 'afterTarget' ? '🔁' : st === 'capped' ? '⏹' : '❌';
  const pct = result.target > 0 ? Math.round(result.total / result.target * 100) : 0;
  const bar = '█'.repeat(Math.min(Math.ceil(pct / 5), 20));
  const addStr = result.added > 0 ? `+${result.added}` : '跳过';
  const line = `  ${icon} ${account}  ${result.previous} → ${addStr} → ${result.total} / ${result.target}  ${bar} ${pct}%`;
  const tags = (result.tags || []).join(' | ');
  if (tags) console.log(line + `  ${tags}`);
  else console.log(line);
  appendJSON({ level: 'exec', account, status: st, previous: result.previous, added: result.added || 0, total: result.total, target: result.target, pct, tags: result.tags || [] });
}

/** 错误日志 */
function error(msg, err = null) {
  const errState = loadErrorState();
  errState.consecutive++;
  errState.total++;
  errState.lastError = { time: formatTime(), msg, detail: err?.message || '' };
  saveErrorState(errState);

  const detail = err?.message || '';
  const line = `[ERROR ${formatTime()}] ${msg} ${detail} (连续${errState.consecutive}次)`;
  console.error(line);
  appendText(line);
  appendJSON({ level: 'error', msg, detail, consecutive: errState.consecutive });

  // 告警阈值
  if (errState.consecutive === 3) {
    const alert = `⚠ 连续失败 3 次！请检查网络或账号状态`;
    console.error(alert);
    appendText(`[ALERT ${formatTime()}] ${alert}`);
  }
  if (errState.consecutive === 10) {
    const alert = `🚨 连续失败 10 次！脚本可能已失效，请立即检查`;
    console.error(alert);
    appendText(`[ALERT ${formatTime()}] ${alert}`);
  }
}

/** 标记一次成功，重置连续错误计数 */
function markSuccess() {
  const errState = loadErrorState();
  if (errState.consecutive > 0) {
    errState.consecutive = 0;
    saveErrorState(errState);
  }
}

/** 获取错误摘要 */
function getErrorSummary() {
  const s = loadErrorState();
  return {
    consecutive: s.consecutive,
    total: s.total,
    lastError: s.lastError,
    healthy: s.consecutive < 3,
  };
}

module.exports = {
  info,
  execHeader,
  logExecution,
  error,
  markSuccess,
  getErrorSummary,
};
