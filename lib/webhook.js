/**
 * lib/webhook.js — 消息推送
 *
 * 支持企业微信/钉钉/飞书 机器人 Webhook
 * 每日达标时自动推送汇总
 */
const { dateStr, datetimeStr } = require('./time');
const { formatSteps } = require('./api');
const { isRestDay } = require('./calendar');
const { identifyPersona, getRollingAverage } = require('./memory');
const logger = require('./logger');

/**
 * 生成每日汇总消息
 * @returns {{ markdown: string, text: string }}
 */
function buildSummary(state, accounts, realism, dailyMaxSteps) {
  const today = dateStr();
  const restLabel = isRestDay(today) ? '休息日' : '工作日';
  const weather = state._lastWeather || '未知';

  let md = `## 🏃 华米步数日报\n`;
  md += `> ${datetimeStr()} | ${restLabel} | ${weather}\n\n`;

  let text = `华米步数日报 - ${datetimeStr()}\n`;

  for (const { account } of accounts) {
    const steps = state.accounts?.[account] || 0;
    const target = state.dailyTargets?.[account] || 8000;
    const reached = steps >= target;
    const pct = target > 0 ? Math.round(steps / target * 100) : 0;
    const icon = reached ? '✅' : pct > 50 ? '🔶' : '❌';

    md += `| ${icon} ${account} | **${formatSteps(steps)}** / ${formatSteps(target)} | ${pct}% |\n`;
    text += `${icon} ${account}: ${formatSteps(steps)} / ${formatSteps(target)} (${pct}%)\n`;
  }

  // 历史洞察
  for (const { account } of accounts) {
    const history = state.history?.[account] || [];
    if (history.length >= 3) {
      const persona = identifyPersona(history);
      const avg = getRollingAverage(history);
      md += `\n🧠 *${account}* — ${persona.desc} | 近7日均步: ${formatSteps(avg || 0)}\n`;
      text += `\n${account}: ${persona.desc}, 7日均步: ${avg}\n`;
      break; // 只显示第一个账号的洞察
    }
  }

  const errSummary = logger.getErrorSummary();
  if (errSummary.total > 0) {
    md += `\n⚠ 累计错误: ${errSummary.total} 次 (连续 ${errSummary.consecutive})\n`;
    text += `\n⚠ 错误: ${errSummary.total}次(连续${errSummary.consecutive})\n`;
  }

  return { markdown: md, text };
}

/**
 * 发送 Webhook 消息
 * 支持企业微信/钉钉/飞书机器人格式
 */
async function sendWebhook(url, summary) {
  if (!url) return false;
  try {
    // 企业微信/飞书用 markdown，钉钉用 text
    const isDingTalk = url.includes('dingtalk');
    const payload = isDingTalk
      ? { msgtype: 'text', text: { content: summary.text } }
      : { msgtype: 'markdown', markdown: { content: summary.markdown } };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const result = await resp.text();
    logger.info(`Webhook 推送: ${resp.status}`, { result });
    return resp.ok;
  } catch (e) {
    logger.error(`Webhook 发送失败`, e);
    return false;
  }
}

module.exports = { buildSummary, sendWebhook };
