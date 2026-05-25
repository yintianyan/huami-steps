/**
 * lib/shift.js — 白夜班自动调度器
 *
 * 规则：
 *   - 白班周(周一~周六白班) → 夜班周(周一~周六夜班) → 交替
 *   - 周日休息(两班共用)
 *   - 工作日睡 7~8h，休息日睡 8~10h
 *   - 夜班工作日月睡眠在白天(如 8:00-16:00)
 *   - 白夜交替时睡眠可能中断，允许多段睡眠
 */

const { chinaHour, chinaDayOfWeek, dateStr } = require('./time');
const { isHoliday } = require('./calendar');

/**
 * 判断当前是否夜班周
 * @param {number} firstNightWeek - 第一个夜班周的周一日期 (如 2026-01-05 的 timestamp)
 */
function isNightShiftWeek(config) {
  const ns = config?.nightShift;
  if (!ns?.enabled) return false;
  if (!ns.autoDetect) return ns.enabled;

  const ref = ns.firstNightShiftMonday || '2026-01-05';
  const refDate = new Date(ref + 'T00:00:00+08:00');
  const todayStr = dateStr();
  const now = new Date(todayStr + 'T12:00:00+08:00');
  
  const diffWeeks = Math.floor((now - refDate) / (7 * 86400000));
  return diffWeeks % 2 === 0;
}

/**
 * 判定今天的工作/休息状态
 * @returns {{ isWork: bool, isRest: bool, shift: 'day'|'night'|'rest', desc: string }}
 */
function getShiftStatus(config) {
  const today = dateStr();
  const dow = chinaDayOfWeek();
  const isNight = isNightShiftWeek(config);
  const holiday = isHoliday(today);

  // 周日 = 休息
  if (dow === 0 || holiday) {
    return { isWork: false, isRest: true, shift: 'rest', desc: holiday ? '🎌 节假日' : '😴 休息日' };
  }

  // 周一~周六 = 工作
  if (dow >= 1 && dow <= 6) {
    return { isWork: true, isRest: false, shift: isNight ? 'night' : 'day', desc: isNight ? '🌙 夜班' : '☀ 白班' };
  }

  return { isWork: false, isRest: true, shift: 'rest', desc: '😴' };
}

/**
 * 生成睡眠窗口列表 (可能多段)
 *
 * 白班工作日(8:00-17:30):      0:00-7:00 (7h)
 * 夜班工作日(20:00-06:00):     7:00-13:00 (7h)
 * 白→夜过渡(夜班周周一):       12:00-14:00 (午睡2h，周日已充分休息)
 * 夜→白过渡(周日休息+周一白班): 自然规律，无需特殊处理
 * 休息日(周日):                0:00-9:00 (9h) + 午睡 13:00-14:00
 *
 * @returns {Array<{start:number, end:number}>} 睡眠时段(hour)
 */
function getSleepWindows(config) {
  const status = getShiftStatus(config);
  const ns = config?.nightShift || {};

  if (status.shift === 'day' && status.isWork) {
    // 白班工作日 (8:00-17:30)：晚上睡觉 0:00-7:00
    return [{ start: 0, end: 7 }];
  }

  if (status.shift === 'night' && status.isWork) {
    const dow = chinaDayOfWeek();
    if (dow === 1) {
      // 白→夜过渡周一：周日已充分休息，白天仅需午睡 12:00-13:59
      return [{ start: 12, end: 14 }];
    }
    // 夜班工作日 (Tue-Sat, 20:00-06:00)：下班后睡觉 7:00-13:59
    return [{ start: 7, end: 14 }];
  }

  if (status.isRest) {
    const dow = chinaDayOfWeek();
    // 休息日：主睡眠 + 可能午休
    const windows = [{ start: 0, end: 9 }]; // 主睡眠 9h
    if (dow === 0) {
      // 周日：可能加午睡 13:00-14:00
      windows.push({ start: 13, end: 14 });
    }
    return windows;
  }

  return [{ start: 0, end: 7 }];
}

/**
 * 判断当前小时是否在睡眠窗口中
 * @returns {boolean}
 */
function isSleepHour(config) {
  const hour = chinaHour();
  const windows = getSleepWindows(config);
  return windows.some(w => hour >= w.start && hour < w.end);
}

/**
 * 白夜交替周睡眠调整说明
 */
function getSleepDescription(config) {
  const windows = getSleepWindows(config);
  return windows.map(w => {
    const duration = w.end - w.start;
    return `${String(w.start).padStart(2,'0')}:00-${String(w.end).padStart(2,'0')}:00 (${duration}h)`;
  }).join(' + ');
}

module.exports = { isNightShiftWeek, getShiftStatus, getSleepWindows, isSleepHour, getSleepDescription };
