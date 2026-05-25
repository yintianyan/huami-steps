/**
 * lib/config.js — 配置加载与标准化
 */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`❌ 配置文件不存在：${CONFIG_PATH}`);
    process.exit(1);
  }

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {
    console.error('❌ 配置文件解析失败：', e.message);
    process.exit(1);
  }

  // --- 基础校验 ---
  if (!cfg.accounts || cfg.accounts.length === 0) {
    console.error('❌ config.json 中未配置账号');
    process.exit(1);
  }

  // --- 标准化 ---
  // 兼容旧版 stepRange → incrementRange
  if (!cfg.incrementRange && cfg.stepRange) {
    cfg.incrementRange = cfg.stepRange;
  }

  // 兼容：dailyMaxSteps 数字 → {min, max}
  if (typeof cfg.dailyMaxSteps === 'number') {
    cfg.dailyMaxSteps = { min: cfg.dailyMaxSteps, max: cfg.dailyMaxSteps };
  }

  // 增量默认值
  if (!cfg.incrementRange) {
    cfg.incrementRange = { min: 500, max: 2000 };
  }

  // 延时默认值
  if (cfg.delaySeconds == null) cfg.delaySeconds = 10;

  // --- realism 默认值 ---
  if (cfg.realism) {
    const r = cfg.realism;
    if (r.afterTargetChance == null) r.afterTargetChance = 0.10;
    if (r.deceleration == null) r.deceleration = true;
    if (r.distribution == null) r.distribution = 'triangular';
    if (r.burstMultiplier == null) r.burstMultiplier = { min: 2.0, max: 4.0 };
    if (r.weekendHourShift == null) r.weekendHourShift = 0;
    if (r.weekendMultiplier == null) r.weekendMultiplier = 1.0;
  }

  // --- 应用预设 ---
  if (cfg.realism?.preset && cfg.realism?.timeProfile) {
    applyPreset(cfg, cfg.realism.preset);
  }

  return cfg;
}

// ==================== 预设系统 ====================

const PRESETS = {
  'office-worker': {
    desc: '💼 普通上班族（默认）',
    config: {
      incrementRange: { min: 100, max: 500 },
      dailyMaxSteps: { min: 7000, max: 9000 },
      realism: {
        dailyMaxSteps: { weekday: { min: 7000, max: 11000 }, weekend: { min: 4000, max: 7000 } },
        weekendHourShift: 2,
        weekendMultiplier: 0.7,
        timeProfile: {
          sleep:      { hours: [0,6],   increment: { min: 0, max: 0 },     skipChance: 1.0,  burstChance: 0.0,  desc: '💤 睡眠' },
          morning:    { hours: [7,7],   increment: { min: 150, max: 400 },  skipChance: 0.12, burstChance: 0.08, desc: '🌅 早起' },
          commuteAm:  { hours: [8,9],   increment: { min: 300, max: 700 },  skipChance: 0.05, burstChance: 0.15, desc: '🚇 早通勤' },
          officeAm:   { hours: [10,11], increment: { min: 20, max: 150 },   skipChance: 0.30, burstChance: 0.06, desc: '💼 上午办公' },
          lunch:      { hours: [12,12], increment: { min: 100, max: 500 },  skipChance: 0.10, burstChance: 0.10, desc: '🍜 午餐' },
          nap:        { hours: [13,13], increment: { min: 10, max: 60 },    skipChance: 0.60, burstChance: 0.0,  desc: '😴 午休' },
          officePm:   { hours: [14,16], increment: { min: 20, max: 150 },   skipChance: 0.30, burstChance: 0.06, desc: '💼 下午办公' },
          commutePm:  { hours: [17,18], increment: { min: 300, max: 700 },  skipChance: 0.05, burstChance: 0.15, desc: '🚇 晚通勤' },
          evening:    { hours: [19,20], increment: { min: 200, max: 700 },  skipChance: 0.06, burstChance: 0.20, desc: '🏃 晚间活跃' },
          night:      { hours: [21,22], increment: { min: 30, max: 300 },   skipChance: 0.20, burstChance: 0.06, desc: '🏠 居家' },
          lateNight:  { hours: [23,23], increment: { min: 0, max: 80 },     skipChance: 0.70, burstChance: 0.0,  desc: '🌙 深夜' },
        },
      },
    },
  },
  'active': {
    desc: '🏃 运动达人（高步数、强活跃）',
    config: {
      incrementRange: { min: 200, max: 800 },
      dailyMaxSteps: { min: 10000, max: 15000 },
      realism: {
        dailyMaxSteps: { weekday: { min: 10000, max: 15000 }, weekend: { min: 7000, max: 12000 } },
        weekendHourShift: 1,
        weekendMultiplier: 0.85,
        burstMultiplier: { min: 2.5, max: 5.0 },
        walkEvent: { chance: 0.08, steps: { min: 2000, max: 5000 } },
        timeProfile: {
          sleep:      { hours: [0,5],   increment: { min: 0, max: 0 },     skipChance: 1.0,  burstChance: 0.0  },
          morning:    { hours: [6,7],   increment: { min: 300, max: 800 },  skipChance: 0.05, burstChance: 0.15 },
          commuteAm:  { hours: [8,9],   increment: { min: 500, max: 1000 }, skipChance: 0.03, burstChance: 0.20 },
          officeAm:   { hours: [10,11], increment: { min: 50, max: 250 },   skipChance: 0.20, burstChance: 0.10 },
          lunch:      { hours: [12,12], increment: { min: 200, max: 800 },  skipChance: 0.05, burstChance: 0.15 },
          nap:        { hours: [13,13], increment: { min: 20, max: 100 },   skipChance: 0.50, burstChance: 0.0  },
          officePm:   { hours: [14,16], increment: { min: 50, max: 250 },   skipChance: 0.20, burstChance: 0.10 },
          commutePm:  { hours: [17,18], increment: { min: 500, max: 1000 }, skipChance: 0.03, burstChance: 0.20 },
          evening:    { hours: [19,20], increment: { min: 400, max: 1200 }, skipChance: 0.03, burstChance: 0.25 },
          night:      { hours: [21,22], increment: { min: 50, max: 500 },   skipChance: 0.15, burstChance: 0.08 },
          lateNight:  { hours: [23,23], increment: { min: 0, max: 100 },    skipChance: 0.60, burstChance: 0.0  },
        },
      },
    },
  },
  'sedentary': {
    desc: '🪑 居家/远程办公（低步数、久坐为主）',
    config: {
      incrementRange: { min: 50, max: 300 },
      dailyMaxSteps: { min: 3000, max: 6000 },
      realism: {
        dailyMaxSteps: { weekday: { min: 3000, max: 5500 }, weekend: { min: 2000, max: 4000 } },
        weekendHourShift: 2,
        weekendMultiplier: 0.6,
        burstMultiplier: { min: 1.5, max: 2.5 },
        walkEvent: { chance: 0.02, steps: { min: 500, max: 1500 } },
        timeProfile: {
          sleep:      { hours: [0,7],   increment: { min: 0, max: 0 },     skipChance: 1.0,  burstChance: 0.0  },
          morning:    { hours: [8,8],   increment: { min: 50, max: 200 },   skipChance: 0.15, burstChance: 0.05 },
          commuteAm:  { hours: [9,9],   increment: { min: 30, max: 150 },   skipChance: 0.25, burstChance: 0.05 },
          officeAm:   { hours: [10,11], increment: { min: 10, max: 80 },    skipChance: 0.40, burstChance: 0.03 },
          lunch:      { hours: [12,12], increment: { min: 50, max: 300 },   skipChance: 0.15, burstChance: 0.08 },
          nap:        { hours: [13,14], increment: { min: 5, max: 30 },     skipChance: 0.70, burstChance: 0.0  },
          officePm:   { hours: [15,17], increment: { min: 10, max: 80 },    skipChance: 0.40, burstChance: 0.03 },
          commutePm:  { hours: [18,18], increment: { min: 30, max: 150 },   skipChance: 0.25, burstChance: 0.05 },
          evening:    { hours: [19,20], increment: { min: 100, max: 400 },  skipChance: 0.15, burstChance: 0.10 },
          night:      { hours: [21,22], increment: { min: 20, max: 200 },   skipChance: 0.30, burstChance: 0.03 },
          lateNight:  { hours: [23,23], increment: { min: 0, max: 50 },     skipChance: 0.80, burstChance: 0.0  },
        },
      },
    },
  },
};

function applyPreset(cfg, presetName) {
  const preset = PRESETS[presetName];
  if (!preset) {
    console.error(`⚠ 未知预设 "${presetName}"，可用: ${Object.keys(PRESETS).join(', ')}`);
    return;
  }
  console.log(`🎭 应用预设：${preset.desc}`);

  const p = preset.config;

  // 只在用户未显式设置时才覆盖
  if (cfg.incrementRange === undefined) cfg.incrementRange = p.incrementRange;
  if (cfg.dailyMaxSteps === undefined) cfg.dailyMaxSteps = p.dailyMaxSteps;

  const r = cfg.realism;
  if (p.realism.dailyMaxSteps && !cfg.realism._dailyTargetUserSet) r.dailyMaxSteps = p.realism.dailyMaxSteps;
  if (r.weekendHourShift === undefined) r.weekendHourShift = p.realism.weekendHourShift;
  if (r.weekendMultiplier === undefined) r.weekendMultiplier = p.realism.weekendMultiplier;
  if (p.realism.burstMultiplier && !cfg.realism._burstUserSet) r.burstMultiplier = p.realism.burstMultiplier;
  if (p.realism.walkEvent && !cfg.realism._walkUserSet) r.walkEvent = p.realism.walkEvent;

  // 时段配置：如果用户没自定义，用预设覆盖
  const userHasCustomProfile = cfg.realism._customProfile === true;
  if (!userHasCustomProfile && p.realism.timeProfile) {
    r.timeProfile = p.realism.timeProfile;
  }
}

/** 合并账号级配置到全局配置 */
function mergeAccountConfig(globalConfig, accountEntry) {
  const merged = JSON.parse(JSON.stringify(globalConfig)); // 深拷贝
  const ac = accountEntry;

  // 应用账号级预设
  if (ac.profile && PRESETS[ac.profile]) {
    const presetConfig = PRESETS[ac.profile].config;
    if (presetConfig.incrementRange) merged.incrementRange = presetConfig.incrementRange;
    if (presetConfig.dailyMaxSteps) merged.dailyMaxSteps = presetConfig.dailyMaxSteps;
    if (presetConfig.realism) {
      Object.assign(merged.realism, JSON.parse(JSON.stringify(presetConfig.realism)));
    }
  }

  // 账号级覆盖
  if (ac.incrementRange) merged.incrementRange = ac.incrementRange;
  if (ac.dailyMaxSteps) {
    if (typeof ac.dailyMaxSteps === 'number') {
      merged.dailyMaxSteps = { min: ac.dailyMaxSteps, max: ac.dailyMaxSteps };
    } else {
      merged.dailyMaxSteps = ac.dailyMaxSteps;
    }
  }
  if (ac.realism) {
    Object.assign(merged.realism, ac.realism);
  }

  return merged;
}

module.exports = { loadConfig, CONFIG_PATH, PRESETS, applyPreset, mergeAccountConfig };
