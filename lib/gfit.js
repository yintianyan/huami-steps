/**
 * lib/gfit.js — Google Fit 步数读取
 *
 * 从 Google Fit 拉取真实步数 → 喂给学习系统
 * 只读不写，提交仍走华米
 *
 * 前置步骤：
 *   1. Google Cloud Console → 创建项目 → 启用 Fitness API
 *   2. 创建 OAuth 2.0 客户端 ID（桌面应用）
 *   3. 下载 credentials.json 放到项目目录
 *   4. 首次运行会弹出浏览器授权
 */
const fs = require('fs');
const path = require('path');
const { dateStr } = require('./time');

const CRED_PATH = path.join(__dirname, '..', 'gfit-credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', 'gfit-token.json');

// ==================== 代理（国内必配）====================

function getProxy() {
  return process.env.HTTPS_PROXY || process.env.https_proxy ||
         process.env.HTTP_PROXY || process.env.http_proxy || '';
}

function getDispatcher() {
  const proxy = getProxy();
  if (!proxy) return undefined;
  try {
    const { ProxyAgent } = require('undici');
    return new ProxyAgent(proxy);
  } catch { return undefined; }
}

/**
 * 支持代理的 fetch 封装
 */
async function proxyFetch(url, options = {}) {
  const dispatcher = getDispatcher();
  const fetchOptions = { ...options };
  if (dispatcher) fetchOptions.dispatcher = dispatcher;

  try {
    return await fetch(url, fetchOptions);
  } catch (e) {
    if (e.cause?.code === 'UND_ERR_CONNECT_TIMEOUT') {
      const proxy = getProxy();
      if (!proxy) {
        console.log('\n⛔ 连接 Google 超时 — 需要配置代理');
        console.log('   在终端执行（把端口改成你的代理端口）：');
        console.log('   export HTTPS_PROXY=http://127.0.0.1:7890');
        console.log('   然后重新运行\n');
      } else {
        console.log(`\n⛔ 代理 ${proxy} 也无法连接 Google`);
        console.log('   请检查代理是否正常运行\n');
      }
    }
    throw e;
  }
}

async function postJSON(url, headers, body) {
  return proxyFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function postForm(url, body) {
  return proxyFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

function loadCredentials() {
  if (!fs.existsSync(CRED_PATH)) return null;
  return JSON.parse(fs.readFileSync(CRED_PATH, 'utf-8')).installed || JSON.parse(fs.readFileSync(CRED_PATH, 'utf-8')).web;
}

function loadToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')); }
  catch { return null; }
}

function saveToken(token) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
}

async function refreshAccessToken(creds, token) {
  const resp = await postForm('https://oauth2.googleapis.com/token', {
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token',
  });
  if (!resp.ok) throw new Error(`Token 刷新失败: ${resp.status}`);
  const newToken = await resp.json();
  newToken.refresh_token = token.refresh_token;
  saveToken(newToken);
  return newToken;
}

async function getAccessToken() {
  const creds = loadCredentials();
  if (!creds) return null;

  const token = loadToken();
  if (token?.access_token) {
    // 检查是否过期
    const expiresAt = token._expiresAt || 0;
    if (Date.now() < expiresAt - 60000) return token.access_token;
    if (token.refresh_token) {
      try {
        const newToken = await refreshAccessToken(creds, token);
        return newToken.access_token;
      } catch { /* 刷新失败，继续走授权 */ }
    }
  }

  // 需要重新授权
  return null;
}

/**
 * 引导用户完成 OAuth 授权
 */
async function authorize() {
  const creds = loadCredentials();
  if (!creds) {
    console.log('❌ 未找到 gfit-credentials.json');
    return null;
  }

  const redirectUri = creds.redirect_uris?.[0] || 'http://localhost';
  const port = redirectUri.includes(':9876') ? 9876 : (redirectUri.match(/:(\d+)/)?.[1] || 9876);

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: creds.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/fitness.activity.read',
    access_type: 'offline',
    prompt: 'consent',
  }).toString();

  console.log('\n🔐 请在浏览器中授权 Google Fit 访问：');
  console.log(`   ${authUrl}\n`);
  console.log('   授权后浏览器会跳转到一个空白页或无法访问的页面');
  console.log('   请复制地址栏中 ?code= 后面的完整授权码，粘贴到下方：\n');

  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise((resolve) => {
    rl.question('   授权码: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
  if (!code) throw new Error('未输入授权码');

  // 用 code 换 token
  console.log('   交换授权码...');
  const resp = await postForm('https://oauth2.googleapis.com/token', {
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const token = await resp.json();

  if (token.error) {
    console.log(`\n❌ 授权失败: ${token.error}`);
    if (token.error === 'invalid_grant') {
      console.log('   授权码无效或已过期（有效期只有几分钟）');
      console.log('   请重新运行，复制新的授权码');
    } else if (token.error === 'redirect_uri_mismatch') {
      console.log('   redirect_uri 不匹配，请在 Google Cloud Console 中');
      console.log('   API和服务 → 凭据 → OAuth 2.0 客户端 ID');
      console.log('   添加: http://localhost');
    } else if (token.error === 'invalid_client') {
      console.log('   client_id 或 client_secret 错误，请检查 gfit-credentials.json');
    }
    console.log(`   详细信息: ${JSON.stringify(token)}`);
    return null;
  }

  token._expiresAt = Date.now() + (token.expires_in || 3600) * 1000;
  saveToken(token);
  console.log('✅ 授权成功');
  return token.access_token;
}

// ==================== 步数读取 ====================

/**
 * 从 Google Fit 读取指定日期范围的步数
 */
async function fetchSteps(accessToken, startDate, endDate) {
  const startMs = new Date(startDate + 'T00:00:00+08:00').getTime();
  const endMs = new Date(endDate + 'T23:59:59+08:00').getTime();

  const body = {
    aggregateBy: [{
      dataTypeName: 'com.google.step_count.delta',
      dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps',
    }],
    bucketByTime: { durationMillis: 86400000 }, // 按天聚合
    startTimeMillis: startMs,
    endTimeMillis: endMs,
  };

  const resp = await postJSON(
    'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
    { 'Authorization': `Bearer ${accessToken}` },
    body
  );

  if (!resp.ok) {
    const err = await resp.text();
    let detail = err;
    try { detail = JSON.parse(err).error?.message || err; } catch {}

    if (resp.status === 403 && detail.includes('Fitness API')) {
      throw new Error(`Fitness API 未启用\n   👉 https://console.cloud.google.com/apis/library/fitness.googleapis.com`);
    }
    throw new Error(`${resp.status}: ${detail}`);
  }

  const data = await resp.json();
  const result = {};

  for (const bucket of data.bucket || []) {
    const date = new Date(parseInt(bucket.startTimeMillis)).toISOString().split('T')[0];
    let steps = 0;
    for (const ds of bucket.dataset || []) {
      for (const pt of ds.point || []) {
        for (const v of pt.value || []) {
          steps += v.intVal || 0;
        }
      }
    }
    if (steps > 0) result[date] = steps;
  }

  return result;
}

/**
 * 同步 Google Fit 步数到历史
 */
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

  console.log(`📱 从 Google Fit 拉取 ${startDate} ~ ${endDate} 的步数...`);
  const dailySteps = await fetchSteps(token, startDate, endDate);

  const { importData } = require('./import');

  // 转为 CSV 格式导入
  const csvLines = Object.entries(dailySteps)
    .map(([date, steps]) => `${date},${steps}`)
    .join('\n');

  const tmpPath = path.join(__dirname, '..', '.gfit-tmp.csv');
  fs.writeFileSync(tmpPath, csvLines);

  const n = importData(tmpPath, state, account);
  fs.unlinkSync(tmpPath);

  return n;
}

module.exports = { getAccessToken, authorize, fetchSteps, syncToHistory };
