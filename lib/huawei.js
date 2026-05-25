/**
 * lib/huawei.js — 华为运动健康 步数读取
 *
 * 华为 Health Kit REST API
 * 需要：华为开发者账号 + 应用审核
 *
 * 前置步骤：
 *   1. https://developer.huawei.com → 注册 → 创建应用
 *   2. 开通 Health Kit 服务
 *   3. 获取 client_id / client_secret
 *   4. 配置 OAuth 回调地址
 */

const fs = require('fs');
const path = require('path');
const { dateStr } = require('./time');

const CRED_PATH = path.join(__dirname, '..', 'huawei-credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', 'huawei-token.json');

const API_BASE = 'https://oauth-login.cloud.huawei.com';
const HEALTH_API = 'https://health-api.cloud.huawei.com';

// ==================== OAuth 2.0 ====================

function loadCredentials() {
  if (!fs.existsSync(CRED_PATH)) return null;
  return JSON.parse(fs.readFileSync(CRED_PATH, 'utf-8'));
}

function loadToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')); }
  catch { return null; }
}

function saveToken(token) {
  token._savedAt = Date.now();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
}

async function postForm(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${err}`);
  }
  return resp.json();
}

async function postJSON(url, token, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': `Bearer ${token}`,
      'client_id': loadCredentials()?.client_id || '',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${err}`);
  }
  return resp.json();
}

// ==================== 授权 ====================

async function authorize() {
  const creds = loadCredentials();
  if (!creds) {
    console.log('❌ 未找到 huawei-credentials.json');
    console.log('   1. https://developer.huawei.com → 控制台');
    console.log('   2. 创建应用 → 开通 Health Kit');
    console.log('   3. 下载 agconnect-services.json');
    console.log('   4. 提取 client_id / client_secret');
    return null;
  }

  const authUrl = `${API_BASE}/oauth2/v3/authorize?` + new URLSearchParams({
    client_id: creds.client_id,
    redirect_uri: creds.redirect_uri || 'http://localhost:9876',
    response_type: 'code',
    scope: 'https://www.huawei.com/healthkit/activity.read',
    access_type: 'offline',
  }).toString();

  console.log('\n🔐 请在浏览器中授权华为运动健康：');
  console.log(`   ${authUrl}\n`);
  console.log('   授权后浏览器跳转，复制地址栏中 code= 后面的授权码：\n');

  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise((resolve) => {
    rl.question('   授权码: ', (answer) => { rl.close(); resolve(answer.trim()); });
  });
  if (!code) throw new Error('未输入授权码');

  // code 换 token
  console.log('   交换授权码...');
  const token = await postForm(`${API_BASE}/oauth2/v3/token`, {
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: creds.redirect_uri || 'http://localhost:9876',
  });

  if (token.error) {
    console.log(`\n❌ 授权失败: ${token.error} - ${token.error_description}`);
    return null;
  }

  saveToken(token);
  console.log('✅ 授权成功');
  return token.access_token;
}

async function getAccessToken() {
  const creds = loadCredentials();
  if (!creds) return null;

  const token = loadToken();
  if (token?.access_token) {
    const age = Date.now() - (token._savedAt || 0);
    if (age < (token.expires_in || 3600) * 1000 - 60000) return token.access_token;
    if (token.refresh_token) {
      try {
        const newToken = await postForm(`${API_BASE}/oauth2/v3/token`, {
          client_id: creds.client_id,
          client_secret: creds.client_secret,
          refresh_token: token.refresh_token,
          grant_type: 'refresh_token',
        });
        saveToken(newToken);
        return newToken.access_token;
      } catch { /* 刷新失败 */ }
    }
  }
  return null;
}

// ==================== 步数读取 ====================

async function fetchSteps(accessToken, startDate, endDate) {
  const startMs = new Date(startDate + 'T00:00:00+08:00').getTime();
  const endMs = new Date(endDate + 'T23:59:59+08:00').getTime();

  const body = {
    dataCollectorId: 'derived:com.huawei.step_count.delta:com.huawei.health:step_counter',
    samplePoints: [
      { dataTypeName: 'com.huawei.step_count.delta', startTime: startMs * 1000000, endTime: endMs * 1000000 }
    ],
    groupByTime: { duration: 86400000, timeUnit: 'MILLISECONDS' },
  };

  const data = await postJSON(`${HEALTH_API}/v1/data/query`, accessToken, body);

  const result = {};
  for (const group of data.group || []) {
    const d = new Date(parseInt(group.startTime / 1000000)).toISOString().split('T')[0];
    let steps = 0;
    for (const sp of group.samplePoint || []) {
      for (const dp of sp.dataPoint || []) {
        for (const v of dp.value || []) {
          steps += v.intValue || v.fieldValue || 0;
        }
      }
    }
    if (steps > 0) result[d] = steps;
  }
  return result;
}

async function syncToHistory(state, account, days = 30) {
  let token = await getAccessToken();
  if (!token) {
    token = await authorize();
    if (!token) return 0;
  }

  const endDate = dateStr();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const startDate = start.toISOString().split('T')[0];

  console.log(`⌚ 从华为运动健康拉取 ${startDate} ~ ${endDate} 的步数...`);
  const dailySteps = await fetchSteps(token, startDate, endDate);

  const csvLines = Object.entries(dailySteps)
    .map(([date, steps]) => `${date},${steps}`)
    .join('\n');

  const { importData } = require('./import');
  const tmpPath = path.join(__dirname, '..', '.huawei-tmp.csv');
  fs.writeFileSync(tmpPath, csvLines);
  const n = importData(tmpPath, state, account);
  fs.unlinkSync(tmpPath);

  return n;
}

module.exports = { syncToHistory };
