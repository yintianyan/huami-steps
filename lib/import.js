/**
 * lib/import.js — 健康数据导入
 *
 * 支持：
 *   - Apple Health Export (export.xml)
 *   - 简单 CSV (date,steps)
 *
 * 用法：node huami-steps.js --import <文件路径>
 */
const fs = require('fs');
const path = require('path');

// ==================== Apple Health XML 解析 ====================

function parseAppleHealthXML(filePath) {
  console.log('📱 解析 Apple Health 导出数据...');
  const xml = fs.readFileSync(filePath, 'utf-8');

  // Apple Health 导出中的步数记录格式：
  // <Record type="HKQuantityTypeIdentifierStepCount" ... value="1234" ... creationDate="2024-01-15 08:30:00 +0800" .../>
  const recordRegex = /<Record\s[^>]*?type="HKQuantityTypeIdentifierStepCount"[^>]*?value="(\d+)"[^>]*?creationDate="([^"]+)"[^>]*?\/>/g;

  const dailySteps = {};
  let match;
  let count = 0;

  // 流式读取大文件
  const content = xml;
  while ((match = recordRegex.exec(content)) !== null) {
    const steps = parseInt(match[1]);
    const dateStr = match[2].split(' ')[0]; // "2024-01-15"
    dailySteps[dateStr] = (dailySteps[dateStr] || 0) + steps;
    count++;
  }

  console.log(`   解析了 ${count.toLocaleString('zh-CN')} 条记录，覆盖 ${Object.keys(dailySteps).length} 天`);
  return dailySteps;
}

// ==================== CSV 解析 ====================

function parseCSV(filePath) {
  console.log('📄 解析 CSV 文件...');
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const dailySteps = {};

  for (const line of lines) {
    const parts = line.split(/[,\t]/);
    if (parts.length < 2) continue;
    const date = parts[0].trim();
    const steps = parseInt(parts[1].trim());
    if (isNaN(steps)) continue;
    dailySteps[date] = (dailySteps[date] || 0) + steps;
  }

  console.log(`   解析了 ${lines.length} 行，覆盖 ${Object.keys(dailySteps).length} 天`);
  return dailySteps;
}

// ==================== 导入到历史 ====================

function importToHistory(state, account, dailySteps) {
  if (!state.history) state.history = {};
  if (!state.history[account]) state.history[account] = [];

  const existing = state.history[account];
  const existingDates = new Set(existing.map(h => h.date));

  let imported = 0;
  const sorted = Object.entries(dailySteps).sort((a, b) => a[0].localeCompare(b[0]));

  for (const [date, steps] of sorted) {
    if (existingDates.has(date)) continue; // 不覆盖已有数据
    if (steps <= 0) continue;

    existing.push({
      date,
      steps,
      target: Math.round(steps * 0.9), // 估算目标：实际步数的 90%
      reached: true,
      completionRatio: 1,
      executionCount: Math.ceil(steps / 500), // 估算：平均每次 500 步
      targetDate: date,
    });
    imported++;
  }

  // 只保留最近 60 天
  if (existing.length > 60) {
    state.history[account] = existing.slice(-60);
  }

  console.log(`   导入 ${imported} 天新数据，历史总计 ${state.history[account].length} 天`);
  return imported;
}

// ==================== 主入口 ====================

function importData(filePath, state, account) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ 文件不存在: ${filePath}`);
    return 0;
  }

  const ext = path.extname(filePath).toLowerCase();
  let dailySteps;

  if (ext === '.xml') {
    dailySteps = parseAppleHealthXML(filePath);
  } else if (ext === '.csv') {
    dailySteps = parseCSV(filePath);
  } else {
    console.error(`❌ 不支持的文件格式: ${ext}（支持 .xml / .csv）`);
    return 0;
  }

  if (Object.keys(dailySteps).length === 0) {
    console.log('   未找到步数数据');
    return 0;
  }

  return importToHistory(state, account, dailySteps);
}

module.exports = { importData, parseAppleHealthXML, parseCSV };
