/**
 * lib/time.js — 时间工具（统一北京时间处理）
 */

// ==================== 模拟时间覆盖（仅用于测试/模拟） ====================
let _sim = null; // { hour, dow, date } — 非 null 时覆盖实际时间

/** 设置模拟时间。仅用于 sim-month.js 等测试脚本 */
function setSimTime(opts) { _sim = opts || null; }
function clearSimTime() { _sim = null; }

/** 当前北京时间的小时数 (0-23) */
function chinaHour() {
  if (_sim?.hour != null) return _sim.hour;
  return new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours();
}

/** 当前北京时间的星期几 (0=周日, 1=周一, ..., 6=周六) */
function chinaDayOfWeek() {
  if (_sim?.dow != null) return _sim.dow;
  const china = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return china.getUTCDay();
}

/**
 * 是否周末
 * @param {string} [dateStr] - YYYY-MM-DD 格式日期，不传则用当前北京时间
 */
function isWeekend(dateStr) {
  let d;
  if (dateStr) {
    d = new Date(dateStr + 'T12:00:00+08:00').getUTCDay();
  } else {
    d = chinaDayOfWeek();
  }
  return d === 0 || d === 6;
}

/** 当前北京日期字符串 YYYY-MM-DD */
function dateStr() {
  if (_sim?.date) return _sim.date;
  const utc = new Date();
  const china = new Date(utc.setUTCHours(utc.getUTCHours() + 8));
  return china.toISOString().split('T')[0];
}

/** 当前北京时间字符串 YYYY-MM-DD HH:MM:SS */
function datetimeStr() {
  const utc = new Date();
  const china = new Date(utc.setUTCHours(utc.getUTCHours() + 8));
  return china.toISOString().replace('T', ' ').split('.')[0];
}

/** 休眠毫秒 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  chinaHour,
  chinaDayOfWeek,
  isWeekend,
  dateStr,
  datetimeStr,
  sleep,
  setSimTime,
  clearSimTime,
};
