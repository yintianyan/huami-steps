#!/usr/bin/env node
/**
 * 华米运动步数自动同步 — Node.js 本地脚本 v4
 *
 * 基于打工人习性模型 + 智能感知层，模拟全天自然步数增长。
 *
 * 用法：
 *   node huami-steps.js            # 正常执行（增量累加）
 *   node huami-steps.js --reset    # 重置当日步数为 0
 *   node huami-steps.js --status   # 查看当日状态（含错误摘要）
 *   node huami-steps.js --report   # 生成日报（支持 Webhook 推送）
 *   node huami-steps.js --dashboard # Web Dashboard (http://localhost:3456)
 *   node huami-steps.js --daemon   # 守护模式（不推荐，建议用 cron）
 *
 * 定时运行：
 *   bash setup-cron.sh             # 安装 cron（推荐）
 *   bash setup-cron.sh --remove    # 移除
 *
 * 前置条件：Node.js >= 18，配置好 config.json
 */

const { dateStr, datetimeStr, sleep } = require('./lib/time');
const { loadConfig, mergeAccountConfig } = require('./lib/config');
const {
  loadState, saveState,
  getAccumulatedSteps, setAccumulatedSteps,
  logExecution,
  trackExternalSync, getExternalDampenFactor,
} = require('./lib/state');
const {
  formatSteps, withRetry,
  getToken, submitWithTokenRefresh, fetchServerSteps,
} = require('./lib/api');
const {
  getDailyTarget, getTimeProfile,
  computeRealismIncrement, maybeAfterTargetIncrement,
} = require('./lib/engine');
const { isRestDay } = require('./lib/calendar');
const { getWeatherModifier } = require('./lib/weather');
const { archiveYesterday, ensureHistory, identifyPersona } = require('./lib/memory');
const logger = require('./lib/logger');
const { buildSummary, sendWebhook } = require('./lib/webhook');
const { midDayAdjust, sleepCoherence } = require('./lib/adapt');
const { getDayOfWeekAdjustment } = require('./lib/weekly');

// ==================== 命令行参数 ====================
const ARG = process.argv[2] || '';
const IS_RESET = ARG === '--reset';
const IS_STATUS = ARG === '--status';
const IS_DAEMON = ARG === '--daemon';
const IS_REPORT = ARG === '--report';
const IS_DASHBOARD = ARG === '--dashboard';
const IS_IMPORT = ARG === '--import';
const IS_SEED = ARG === '--seed';
const IS_ANALYZE = ARG === '--analyze';
const IS_APPLY = ARG === '--apply';
const IS_CHECK = ARG === '--check';
const IS_SIMULATE = ARG === '--simulate';
const IS_GFIT = ARG === '--gfit';
const IS_GFIT_GUIDE = ARG === '--gfit-guide';
const IS_HUAWEI = ARG === '--huawei';
const IS_HOURLY = ARG === '--hourly';

// ==================== 主流程 ====================
async function main() {
  const CONFIG = loadConfig();
  const today = dateStr();
  const state = loadState();
  const { accounts, incrementRange, dailyMaxSteps, delaySeconds, realism } = CONFIG;
  const incMin = incrementRange?.min ?? 500;
  const incMax = incrementRange?.max ?? 2000;
  const targetMin = dailyMaxSteps?.min ?? 30000;
  const targetMax = dailyMaxSteps?.max ?? 30000;
  const realismOn = realism?.enabled ?? false;

  // ----- 仅查看状态 -----
  if (IS_STATUS) {
    console.log(`\n📊 当日步数状态  ${datetimeStr()}`);
    console.log(`──────────────────────────────────`);
    console.log(`  日期：${state.date || today}`);
    console.log(`  增量范围：${incMin} ~ ${incMax} 步/次`);
    console.log(`  每日目标区间：${formatSteps(targetMin)} ~ ${formatSteps(targetMax)} 步`);
    if (realismOn) {
      const tp = getTimeProfile(realism, incMin, incMax, { today });
      const restLabel = isRestDay(today) ? '📅 休息日' : '📅 工作日';
      const shiftInfo = isRestDay(today) && realism.weekendHourShift
        ? ` (作息后移${realism.weekendHourShift}h)` : '';
      console.log(`  真实感引擎：✅ 启用 | 当前时段：${tp.desc} [${tp.incMin}~${tp.incMax}]${shiftInfo} ${restLabel}`);
    } else {
      console.log(`  真实感引擎：❌ 未启用`);
    }
    // 🧠 智能层状态
    if (realismOn && realism.smart !== false) {
      const personaInfo = [];
      for (const { account } of accounts) {
        const h = ensureHistory(state, account);
        if (h.length >= 3) personaInfo.push(identifyPersona(h).desc);
      }
      if (personaInfo.length > 0) {
        console.log(`  🧠 智能层：✅ 启用 | 类型：${personaInfo.join(', ')} | 历史：${ensureHistory(state, accounts[0].account).length}天`);
      } else {
        console.log(`  🧠 智能层：✅ 启用 | 学习中（需3天数据）`);
      }
    }
    // 📋 错误摘要
    const errSummary = logger.getErrorSummary();
    if (errSummary.total > 0) {
      const health = errSummary.healthy ? '✅ 正常' : `⚠ 连续失败 ${errSummary.consecutive} 次`;
      console.log(`  📋 运行状况：${health} | 累计错误：${errSummary.total} 次`);
      if (errSummary.lastError) {
        console.log(`     最后错误：${errSummary.lastError.time} — ${errSummary.lastError.msg}`);
      }
    }
    console.log(``);
    let stateChanged = false;
    for (const { account } of accounts) {
      const acc = getAccumulatedSteps(state, account, today);
      const hadTarget = state.dailyTargets && state.dailyTargets[account];
      const options = { smart: realismOn && realism.smart !== false, history: state.history?.[account] || [] };
      const target = getDailyTarget(state, account, today, dailyMaxSteps, realism, options);
      if (!hadTarget && state.dailyTargets && state.dailyTargets[account]) stateChanged = true;
      const bar = '▓'.repeat(Math.min(Math.ceil(acc / target * 20), 20));
      const empty = '░'.repeat(20 - bar.length);
      const done = acc >= target ? ' ✅ 已上线' : '';
      const restLabel = isRestDay(today) ? '休息日' : '工作日';
      const targetLabel = realismOn && realism.dailyMaxSteps
        ? `${formatSteps(target)}（${restLabel}目标）`
        : formatSteps(target);
      const reason = state.targetReason ? ` 🧠${state.targetReason}` : '';
      console.log(`  ${account.padEnd(28)} ${bar}${empty} ${formatSteps(acc).padStart(8)} / ${targetLabel}${done}${reason}`);

      // 🧠 达标预测
      if (realismOn && acc < target && acc > 0) {
        const adjust = midDayAdjust(acc, target, state);
        if (adjust.eta !== '—') {
          console.log(`     🕐 预计 ${adjust.eta} 达标（当前 ${adjust.progress}%，理想 ${adjust.expected}%）`);
        }
      }
    }
    if (stateChanged) saveState(state);
    console.log(``);
    return;
  }

  // ----- 重置当日步数 -----
  if (IS_RESET) {
    state.date = today;
    state.targetDate = today;
    state.accounts = {};
    state.dailyTargets = {};
    state.executionCount = 0;
    saveState(state);
    console.log(`✅ 当日步数已重置为 0，目标已重新随机`);
    return;
  }

  // ----- 生成日报并推送 -----
  if (IS_REPORT) {
    const summary = buildSummary(state, accounts, realism, dailyMaxSteps);
    console.log(summary.text);
    const webhookUrl = CONFIG.webhookUrl || realism?.webhookUrl;
    if (webhookUrl) {
      const ok = await sendWebhook(webhookUrl, summary);
      console.log(ok ? '✅ Webhook 推送成功' : '❌ Webhook 推送失败');
    } else {
      console.log('💡 未配置 webhookUrl，跳过推送');
    }
    return;
  }

  // ----- 正常增量执行 -----
  // 🎲 随机延时 0~9 分钟（避免整点规律，模拟真人随机性）
  const jitterSec = Math.floor(Math.random() * 540);
  if (jitterSec > 0) {
    console.log(`🎲 随机延时 ${jitterSec} 秒...`);
    await sleep(jitterSec * 1000);
  }

  // ⏰ 时段守卫：根据白夜班自动调整执行窗口
  const sched = CONFIG.schedule || {};
  const nowHour = require('./lib/time').chinaHour();
  const shiftStatus = require('./lib/shift').getShiftStatus(realism);
  let sStart = sched.startHour ?? 7;
  let sEnd = sched.endHour ?? 21;
  // 夜班工作日：窗口调整为 14:00-07:00（跨天）— 含过渡周一
  if (shiftStatus.shift === 'night' && shiftStatus.isWork) {
    sStart = 14; sEnd = 7; // 跨天窗口：14:00-次日07:00
  }
  const inWindow = (sStart <= sEnd)
    ? (nowHour >= sStart && nowHour <= sEnd)   // 普通窗口 7-21
    : (nowHour >= sStart || nowHour <= sEnd);   // 跨天窗口 14-7
  if (!inWindow) {
    console.log(`⏰ 非执行时段（${nowHour}时，允许${sStart}:00-${sEnd}:00），跳过`);
    return;
  }

  // 跨天自动重置
  if (state.date !== today) {
    console.log(`🌅 新的一天！步数自动归零（${state.date || '无记录'} → ${today}）`);
    for (const { account } of accounts) {
      archiveYesterday(state, account);
    }
    state.date = today;
    state.targetDate = today;
    state.accounts = {};
    state.dailyTargets = {};
    state.executionCount = 0;
    saveState(state); // 立即持久化，避免跳过时丢失跨天状态
  }

  // 🧠 智能感知
  const smartOn = realismOn && (realism.smart !== false);
  let weatherModifier = 1.0, weatherDesc = '';
  if (smartOn) {
    try {
      const wm = await getWeatherModifier(realism.city || 'Beijing');
      weatherModifier = wm.modifier;
      weatherDesc = wm.desc;
    } catch { /* 天气获取失败不影响主流程 */ }
  }

  // 🌙 作息连贯性：昨日晚达标 → 今日晚起
  let morningDampen = 1.0;
  if (smartOn) {
    const coherence = sleepCoherence(state, realism);
    if (coherence.morningDampen < 1.0) {
      morningDampen = coherence.morningDampen;
      console.log(`  🌙 ${coherence.reason}`);
    }
  }

  const engineOptions = { today, smart: smartOn, weatherModifier, weatherDesc, hour: require('./lib/time').chinaHour() };

  // 📝 单行执行头
  const tpHeader = realismOn ? getTimeProfile(realism, incMin, incMax, engineOptions) : null;
  logger.execHeader({
    inc: `${incMin}~${incMax}`,
    dayType: isRestDay(today) ? '休息日' : '工作日',
    weather: weatherDesc || null,
    slot: tpHeader ? `${tpHeader.desc} [${tpHeader.incMin}~${tpHeader.incMax}]` : null,
    skipPct: tpHeader ? Math.round(tpHeader.skipChance * 100) : null,
  });

  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const accountEntry = accounts[i];
    const { account, password } = accountEntry;
    const label = `[${i + 1}/${accounts.length}] ${account}`;

    // 合并账号级配置
    const acConfig = mergeAccountConfig(CONFIG, accountEntry);
    const acIncMin = acConfig.incrementRange?.min ?? incMin;
    const acIncMax = acConfig.incrementRange?.max ?? incMax;
    const acDailyMax = acConfig.dailyMaxSteps;
    const acRealism = acConfig.realism;

    const currentTotal = getAccumulatedSteps(state, account, today);
    const history = state.history?.[account] || [];
    const personOptions = { ...engineOptions, history };
    const dailyTarget = getDailyTarget(state, account, today, acDailyMax, acRealism, personOptions);

    // ----- 已达目标 → 微量活动 -----
    if (currentTotal >= dailyTarget) {
      const afterInc = maybeAfterTargetIncrement(currentTotal, dailyTarget, realism);
      if (afterInc > 0) {
        const newTotal = currentTotal + afterInc;
        try {
          const tokenInfo = await withRetry(
            () => getToken(state, account, password), '获取Token', acConfig.retry || CONFIG.retry);
          await withRetry(
            () => submitWithTokenRefresh(state, account, password, tokenInfo, newTotal, dailyTarget),
            '提交步数', acConfig.retry || CONFIG.retry);
          setAccumulatedSteps(state, account, today, newTotal);
          logExecution(state);
          saveState(state);
          logger.markSuccess();
          results.push({ account, previous: currentTotal, added: afterInc, total: newTotal, status: 'afterTarget' });
          logger.logExecution(account, {
            status: 'afterTarget', previous: currentTotal, added: afterInc,
            total: newTotal, target: dailyTarget, tags: ['微量活动'],
          });
        } catch (err) {
          logger.error(`提交失败: ${account}`, err);
          results.push({ account, previous: currentTotal, added: 0, total: currentTotal, status: 'error', error: err.message });
        }
      } else {
        results.push({ account, previous: currentTotal, added: 0, total: currentTotal, status: 'capped' });
      }
      continue;
    }

    // ----- 真实感引擎计算增量（使用账号级配置）-----
    const comp = computeRealismIncrement(acIncMin, acIncMax, currentTotal, dailyTarget, acRealism, engineOptions);
    let increment = comp.increment;
    const tags = comp.tags;

    // 🧠 中程自适应：落后加速，超前减速
    if (increment > 0 && smartOn) {
      const adjust = midDayAdjust(currentTotal, dailyTarget, state);
      if (adjust.factor !== 1.0) {
        increment = Math.round(increment * adjust.factor);
        tags.push(`${adjust.status} ETA ${adjust.eta}`);
      }
      // 早晨衰减（基于昨日作息）
      const hour = require('./lib/time').chinaHour();
      if (morningDampen < 1.0 && hour >= 7 && hour <= 9) {
        increment = Math.round(increment * morningDampen);
        tags.push(`🌙 晚起缓冲`);
      }      // 周模式修正（周几通常更活跃/安静）
      if (history.length >= 14) {
        const dayAdj = getDayOfWeekAdjustment(history);
        if (dayAdj.factor !== 1.0) {
          increment = Math.round(increment * dayAdj.factor);
          tags.push(`📅 ${dayAdj.reason}`);
        }
      }    }

    let newTotal = currentTotal + increment;

    // 软着陆：超 5% 才截断到 ~3%，否则保留自然溢出
    const overshootRatio = dailyTarget > 0 ? (newTotal - dailyTarget) / dailyTarget : 0;
    if (overshootRatio > 0.05) {
      newTotal = dailyTarget + Math.round(dailyTarget * 0.03);
      increment = newTotal - currentTotal;
      tags.push('🎯 软着陆');
    } else if (newTotal > dailyTarget && overshootRatio <= 0.05) {
      tags.push('🎯 自然达标');
    }

    console.log(`▶ ${label}`);
    if (increment === 0) {
      logger.logExecution(account, {
        status: 'skipped', previous: currentTotal, added: 0,
        total: currentTotal, target: dailyTarget, tags,
      });
      results.push({ account, previous: currentTotal, added: 0, total: currentTotal, status: 'skipped' });
      continue;
    }

    try {
      const tokenInfo = await withRetry(
        () => getToken(state, account, password), '获取Token', acConfig.retry || CONFIG.retry);

      // 服务器同步校准
      const serverSteps = await fetchServerSteps(tokenInfo);
      if (serverSteps !== null && serverSteps !== currentTotal) {
        const reconciled = Math.max(serverSteps, currentTotal);
        setAccumulatedSteps(state, account, today, reconciled);
        saveState(state);

        const extSync = trackExternalSync(state, account, serverSteps);
        if (extSync.hasExternal) {
          const dampen = getExternalDampenFactor(state, account, dailyTarget);
          increment = Math.round(increment * dampen);
        }

        const remaining = dailyTarget - reconciled;
        if (remaining <= 0) {
          logger.logExecution(account, {
            status: 'capped', previous: currentTotal, added: 0,
            total: reconciled, target: dailyTarget, tags: ['服务器已达标'],
          });
          results.push({ account, previous: currentTotal, added: 0, total: reconciled, status: 'capped' });
          continue;
        }
        increment = Math.min(increment, remaining);
        newTotal = reconciled + increment;
      } else if (serverSteps !== null) {
        trackExternalSync(state, account, serverSteps);
      }

      await withRetry(
        () => submitWithTokenRefresh(state, account, password, tokenInfo, newTotal, dailyTarget),
        '提交步数', CONFIG.retry);

      setAccumulatedSteps(state, account, today, newTotal);
      logExecution(state);
      saveState(state);
      logger.markSuccess();

      results.push({ account, previous: currentTotal, added: increment, total: newTotal, status: 'ok' });
      logger.logExecution(account, {
        status: 'ok', previous: currentTotal, added: increment,
        total: newTotal, target: dailyTarget, tags,
      });

      // 🎉 首次达标推送
      if (currentTotal < dailyTarget && newTotal >= dailyTarget) {
        const webhookUrl = CONFIG.webhookUrl || realism?.webhookUrl;
        if (webhookUrl) {
          const summary = buildSummary(state, accounts, realism, dailyMaxSteps);
          sendWebhook(webhookUrl, summary).catch(() => {});
        }
      }
    } catch (err) {
      logger.error(`提交失败: ${account}`, err);
      results.push({ account, previous: currentTotal, added: 0, total: currentTotal, status: 'error', error: err.message });
    }

    if (i < accounts.length - 1 && (delaySeconds ?? 10) > 0) {
      await sleep((delaySeconds ?? 10) * 1000);
    }
  }

  // 📝 汇总行
  const okCount = results.filter(r => r.status === 'ok').length;
  const skipCount = results.filter(r => r.status === 'skipped').length;
  const errCount = results.filter(r => r.status === 'error').length;
  const totalSteps = results.reduce((s, r) => s + (r.total || 0), 0);
  const summary = `✓ 完成 | 成功 ${okCount} | 跳过 ${skipCount} | 失败 ${errCount} | 累计 ${formatSteps(totalSteps)} 步`;
  console.log(summary);
  logger.info(summary);
}

if (IS_IMPORT) {
  const { importData } = require('./lib/import');
  const state = loadState();
  const CONFIG = loadConfig();
  const filePath = process.argv[3];
  if (!filePath) {
    console.error('用法: node huami-steps.js --import <export.xml 或 data.csv>');
    process.exit(1);
  }
  const account = CONFIG.accounts[0].account;
  const n = importData(filePath, state, account);
  if (n > 0) {
    saveState(state);
    console.log(`✅ 已导入 ${n} 天数据到 ${account}`);
    const { identifyPersona } = require('./lib/memory');
    const h = state.history?.[account] || [];
    console.log(`   ${identifyPersona(h).desc}`);
  }
  process.exit(0);
}

if (IS_SEED) {
  const { generateSeedHistory } = require('./lib/seed');
  const state = loadState();
  const CONFIG = loadConfig();
  const account = CONFIG.accounts[0].account;

  const wdAvg = parseInt(process.argv[3]) || 8000;
  const weAvg = parseInt(process.argv[4]) || Math.round(wdAvg * 0.65);

  console.log(`\n🌱 种子数据生成器`);
  console.log(`   工作日均步：${wdAvg.toLocaleString('zh-CN')} | 休息日均步：${weAvg.toLocaleString('zh-CN')}`);

  const history = generateSeedHistory({ days: 30, weekdayAvg: wdAvg, weekendAvg: weAvg });
  if (!state.history) state.history = {};
  state.history[account] = history;
  saveState(state);

  const { identifyPersona } = require('./lib/memory');
  console.log(`✅ 已生成 ${history.length} 天历史数据 → ${identifyPersona(history).desc}`);
  console.log(`   智能层已就绪\n`);
  process.exit(0);
}
if (IS_ANALYZE) {
  const { analyze, suggestConfig } = require('./lib/learn');
  const state = loadState();
  const CONFIG = loadConfig();
  const account = CONFIG.accounts[0].account;
  const history = state.history?.[account] || [];

  const result = analyze(history);
  if (!result.ready) {
    console.log(`❌ ${result.reason}`);
    process.exit(1);
  }
  const s = suggestConfig(result);
  console.log(`\n📊 历史数据分析（${result.days} 天）`);
  console.log(`──────────────────────────────────`);
  console.log(`  模式：${result.patternDesc}`);
  console.log(`  工作日均步：${result.weekdayAvg.toLocaleString('zh-CN')} ±${result.weekdayStd}`);
  console.log(`  休息日均步：${result.weekendAvg.toLocaleString('zh-CN')} ±${result.weekendStd}`);
  console.log(`  达标率：${result.weekdayReachRate}%`);
  console.log(`  周末活跃度：${result.weekendRatio}%`);
  console.log(``);
  console.log(`  💡 建议配置：`);
  console.log(`     weekday: ${s.recommendation.dailyMaxSteps.weekday.min}~${s.recommendation.dailyMaxSteps.weekday.max}`);
  console.log(`     weekend: ${s.recommendation.dailyMaxSteps.weekend.min}~${s.recommendation.dailyMaxSteps.weekend.max}`);
  console.log(`     weekendMultiplier: ${s.recommendation.weekendMultiplier}`);
  console.log(``);
  process.exit(0);
}

if (IS_GFIT_GUIDE) {
  console.log(`
╔══════════════════════════════════════════════════════╗
║        Google Fit OAuth 配置指南                      ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  1. 浏览器打开:                                       ║
║     https://console.cloud.google.com                  ║
║                                                      ║
║  2. 点击顶部 "选择项目" → "新建项目"                   ║
║     (名称随意)                                        ║
║                                                      ║
║  3. 左侧菜单 → API和服务 → 库                         ║
║     搜索 "Fitness API" → 启用                         ║
║                                                      ║
║  4. 左侧菜单 → 凭据 → 创建凭据 → OAuth 客户端 ID      ║
║     应用类型选 "桌面应用"                               ║
║                                                      ║
║  5. 下载 JSON → 替换 gfit-credentials.json            ║
║                                                      ║
║  6. node huami-steps.js --gfit                       ║
║     首次会弹出浏览器授权                                ║
║                                                      ║
║  COROS APP: 个人中心 → 第三方同步 → Google Fit → 开启  ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
  `);
  process.exit(0);
}

if (IS_GFIT) {
  const fs = require('fs');
  const credPath = require('path').join(__dirname, 'gfit-credentials.json');
  const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  if (creds.installed?.client_id?.includes('粘贴')) {
    console.log('❌ 请先配置 gfit-credentials.json');
    console.log('   node huami-steps.js --gfit-guide');
    process.exit(1);
  }

  (async () => {
    const { syncToHistory } = require('./lib/gfit');
    const state = loadState();
    const CONFIG = loadConfig();
    const account = CONFIG.accounts[0].account;
    const days = parseInt(process.argv[3]) || 30;
    const n = await syncToHistory(state, account, days);
    if (n > 0) {
      saveState(state);
      const { identifyPersona } = require('./lib/memory');
      const h = state.history?.[account] || [];
      console.log(`✅ 已同步 ${n} 天真实步数 → ${identifyPersona(h).desc}`);
    }
    process.exit(0);
  })();
}

if (IS_APPLY) {
  const { analyze, suggestConfig } = require('./lib/learn');
  const state = loadState();
  const CONFIG = loadConfig();
  const account = CONFIG.accounts[0].account;
  const history = state.history?.[account] || [];
  const result = analyze(history);
  if (!result.ready) { console.log(`❌ ${result.reason}`); process.exit(1); }
  const s = suggestConfig(result);

  // 备份
  const fs = require('fs');
  const cfgPath = require('path').join(__dirname, 'config.json');
  const bakPath = cfgPath.replace('.json', `.bak-${dateStr()}.json`);
  fs.copyFileSync(cfgPath, bakPath);
  console.log(`💾 已备份: ${bakPath}`);

  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  cfg.dailyMaxSteps = s.recommendation.dailyMaxSteps;
  cfg.realism.dailyMaxSteps = s.recommendation.dailyMaxSteps;
  cfg.realism.weekendMultiplier = s.recommendation.weekendMultiplier;
  cfg.realism._customProfile = true;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`✅ 已应用优化配置`);
  process.exit(0);
}

if (IS_CHECK) {
  const CONFIG = loadConfig();
  const state = loadState();
  const err = require('./lib/logger').getErrorSummary();
  const fs = require('fs');
  console.log('\n🏥 系统健康检查');
  console.log('──────────────────────────────────');
  const checks = [
    ['Node.js', process.version],
    ['账号数', `${CONFIG.accounts?.length || 0}`],
    ['状态日期', state.date || '未初始化'],
    ['Token', state.tokenCache ? '有效' : '无'],
    ['错误', err.healthy ? '✅ 正常' : `⚠ 连续${err.consecutive}次`],
    ['历史', `${state.history?.[CONFIG.accounts[0]?.account]?.length || 0}天`],
    ['日志', fs.existsSync(require('path').join(__dirname, 'huami-steps.log')) ? '存在' : '无'],
  ];
  for (const [n, v] of checks) console.log(`  ✅ ${n}: ${v}`);
  console.log('');
  process.exit(0);
}

if (IS_SIMULATE) {
  const CONFIG = loadConfig();
  const today = dateStr();
  const state = loadState();
  const { accounts, incrementRange, realism } = CONFIG;
  const incMin = incrementRange?.min ?? 500;
  const incMax = incrementRange?.max ?? 2000;
  const { getTimeProfile } = require('./lib/engine');
  const { chinaHour } = require('./lib/time');

  let simTotal = state.accounts?.[accounts[0].account] || 0;
  const simTarget = state.dailyTargets?.[accounts[0].account] || 8000;
  let execCount = 0, skipCount = 0;

  console.log(`\n🔮 模拟今日剩余执行（不会提交）`);
  console.log(`──────────────────────────────────`);
  for (let h = chinaHour(); h < 22 && simTotal < simTarget; h++) {
    for (let m = (h === chinaHour() ? Math.ceil(new Date().getMinutes()/30)*30 : 0); m < 60; m += 30) {
      if (simTotal >= simTarget) break;
      execCount++;
      const tp = getTimeProfile(realism, incMin, incMax, { today });
      if (tp.incMin === 0 && tp.incMax === 0) { skipCount++; continue; }
      const avgInc = Math.round((tp.incMin + tp.incMax) / 2);
      simTotal = Math.min(simTotal + avgInc, simTarget);
    }
  }
  console.log(`  目标：${simTarget.toLocaleString('zh-CN')}`);
  console.log(`  当前：${(state.accounts?.[accounts[0].account] || 0).toLocaleString('zh-CN')}`);
  console.log(`  预计执行：${execCount} 次（跳过 ${skipCount} 次）`);
  console.log(`  预计达标：${simTotal >= simTarget ? '✅ 是' : '❌ 否'}`);
  console.log('');
  process.exit(0);
}

if (IS_HUAWEI) {
  const fs = require('fs');
  const credPath = require('path').join(__dirname, 'huawei-credentials.json');
  if (!fs.existsSync(credPath)) {
    console.log('❌ 未找到 huawei-credentials.json');
    console.log('   需要华为开发者账号: https://developer.huawei.com');
    process.exit(1);
  }
  (async () => {
    const { syncToHistory } = require('./lib/huawei');
    const state = loadState();
    const CONFIG = loadConfig();
    const account = CONFIG.accounts[0].account;
    const days = parseInt(process.argv[3]) || 30;
    const n = await syncToHistory(state, account, days);
    if (n > 0) {
      saveState(state);
      const { identifyPersona } = require('./lib/memory');
      const h = state.history?.[account] || [];
      console.log(`✅ 已同步 ${n} 天真实步数 → ${identifyPersona(h).desc}`);
    }
    process.exit(0);
  })();
}

if (IS_HOURLY) {
  const { importHourly } = require('./lib/hourly');
  const state = loadState();
  const CONFIG = loadConfig();
  const filePath = process.argv[3] || 'hourly-template.json';
  const account = CONFIG.accounts[0].account;
  const n = importHourly(filePath, state, account);
  if (n > 0) {
    saveState(state);
    console.log(`\n💡 提示：用更多天的数据可训练个性化时段配置`);
  }
  process.exit(0);
}

// ==================== 入口 ====================
if (IS_IMPORT) {
  // handled above
} else if (IS_SEED) {
  // handled above
} else if (IS_ANALYZE) {
  // handled above
} else if (IS_APPLY) {
  // handled above
} else if (IS_CHECK) {
  // handled above
} else if (IS_SIMULATE) {
  // handled above
} else if (IS_GFIT) {
  // handled above
} else if (IS_GFIT_GUIDE) {
  // handled above
} else if (IS_HUAWEI) {
  // handled above
} else if (IS_HOURLY) {
  // handled above
} else if (IS_DASHBOARD) {
  const { startDashboard } = require('./lib/dashboard');
  const port = parseInt(process.argv[3]) || 3456;
  startDashboard(port);
} else if (IS_DAEMON) {
  const CONFIG = loadConfig();
  const state = loadState();
  const { daemonLoop } = require('./lib/daemon');
  daemonLoop(main, CONFIG, state).catch(err => {
    console.error('💥 守护进程异常：', err);
    process.exit(1);
  });
} else {
  main().catch(err => {
    console.error('💥 脚本异常：', err);
    process.exit(1);
  });
}
