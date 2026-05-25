/**
 * lib/api.js — 华米/Zepp API 封装
 *
 * 包含：登录、提交步数、Token 缓存、重试机制、服务器同步
 */
const { dateStr, sleep } = require('./time');
const { saveState } = require('./state');

// ==================== 常量 ====================
const DEVICE_ID = '2C8B4939-0CCD-4E94-8CBA-CB8EA6E613A1';
const HEADERS = {
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'user-agent': 'MiFit/6.12.0 (MCE16; Android 16; Density/1.5)',
  'app_name': 'com.xiaomi.hm.health',
};
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// ==================== 工具 ====================

function rand(min, max) {
  return Math.floor(Math.random() * (max + 1 - min) + min);
}

function ts(sec = false) {
  const now = Date.now();
  return sec ? Math.floor(now / 1000) : now;
}

function safeJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function formatSteps(n) {
  return n.toLocaleString('zh-CN');
}

// ==================== HTTP ====================

async function httpPost(url, headers = {}, body = '') {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...HEADERS, ...headers },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await resp.text();
  if (!resp.ok) {
    if (resp.status === 429) throw new Error('请求过于频繁，请稍后再试');
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  return text;
}

// ==================== 重试 ====================

async function withRetry(fn, description, retryConfig) {
  const maxRetries = retryConfig?.maxRetries ?? 3;
  const baseDelay = (retryConfig?.baseDelaySeconds ?? 30) * 1000;
  const maxDelay = (retryConfig?.maxDelaySeconds ?? 300) * 1000;
  const multiplier = retryConfig?.backoffMultiplier ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err.message.includes('请求过于频繁');
      if (!isRateLimit || attempt >= maxRetries) throw err;

      let delay = Math.min(baseDelay * Math.pow(multiplier, attempt), maxDelay);
      const jitter = rand(Math.floor(-delay * 0.2), Math.floor(delay * 0.2));
      delay = Math.max(1000, delay + jitter);

      const waitSec = Math.round(delay / 1000);
      console.log(`  ⚠  ${description} 被限流，${waitSec}秒后重试（${attempt + 1}/${maxRetries}）...`);
      await sleep(delay);
    }
  }
}

// ==================== 登录 ====================

async function loginHuami(account, password) {
  const isEmail = account.includes('@');
  const userName = isEmail ? account : `+86${account}`;
  const thirdName = isEmail ? 'email' : 'huami_phone';

  console.log(`  [登录] 获取 AccessToken...`);
  const step1Body = new URLSearchParams({
    client_id: 'HuaMi',
    country_code: 'CN',
    json_response: 'true',
    name: userName,
    password: password,
    redirect_uri: 'https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html',
    state: 'REDIRECTION',
    token: 'access',
  }).toString();

  const step1Text = await httpPost(
    `https://api-user.zepp.com/registrations/${userName}/tokens`,
    {},
    step1Body
  );
  const res1 = safeJSON(step1Text);
  if (!res1 || !res1.access) {
    throw new Error(`账号或密码错误`);
  }

  console.log(`  [登录] 换取应用令牌...`);
  const step2Data = isEmail ? {
    app_name: 'com.xiaomi.hm.health',
    country_code: 'CN',
    code: res1.access,
    device_id: DEVICE_ID,
    device_model: 'phone',
    app_version: '6.5.5',
    grant_type: 'access_token',
    allow_registration: 'false',
    dn: 'api-user.huami.com,api-mifit.huami.com,app-analytics.huami.com',
    source: 'com.xiaomi.hm.health',
    third_name: thirdName,
    os_version: '1.5.0',
    lang: 'zh_CN',
  } : {
    app_name: 'com.xiaomi.hm.health',
    country_code: 'CN',
    code: res1.access,
    device_id: DEVICE_ID,
    device_model: 'android_phone',
    app_version: '6.12.0',
    grant_type: 'access_token',
    allow_registration: 'false',
    dn: 'account.zepp.com,api-user.zepp.com,api-mifit.zepp.com,api-watch.zepp.com,app-analytics.zepp.com,api-analytics.huami.com,auth.zepp.com',
    source: 'com.xiaomi.hm.health',
    third_name: thirdName,
  };
  const step2Body = new URLSearchParams(step2Data).toString();

  const step2Text = await httpPost(
    'https://account.zepp.com/v2/client/login',
    {},
    step2Body
  );
  const res2 = safeJSON(step2Text);
  if (!res2 || !res2.token_info) {
    throw new Error(`无法获取 token`);
  }

  return {
    userId: res2.token_info.user_id,
    appToken: res2.token_info.app_token,
    loginToken: res2.token_info.login_token,
  };
}

// ==================== 提交步数 ====================

async function submitSteps(tokenInfo, totalSteps, dailyTarget) {
  const headers = { apptoken: tokenInfo.appToken };

  const dataJSON = {
    date: dateStr(),
    data_hr: '/v7+'.repeat(480),
    data: [{
      start: 0,
      stop: 1439,
      value: 'AU'.repeat(1440 * 2),
      tz: 32,
      did: DEVICE_ID,
      src: 24,
    }],
    summary: JSON.stringify({
      v: 6,
      stp: {
        ttl: totalSteps,
        dis: Math.floor(totalSteps * (0.65 + Math.random() * 0.1)),
        cal: Math.floor(totalSteps / (22 + Math.random() * 6)),
        wk: Math.floor(totalSteps / (100 + Math.random() * 40)),
      },
      goal: dailyTarget || 8000,
    }),
    source: 24,
    type: 0,
  };

  const body = new URLSearchParams({
    userid: tokenInfo.userId,
    device_type: '0',
    last_source: '24',
    last_deviceid: DEVICE_ID,
    enableMultiDevice: '1',
    last_sync_data_time: String(ts(true)),
    data_json: JSON.stringify([dataJSON]),
  }).toString();

  const text = await httpPost(
    `https://api-mifit.zepp.com/v1/data/band_data.json?t=${ts()}`,
    headers,
    body
  );
  const res = safeJSON(text);
  if (!res || res.code !== 1) {
    throw new Error(`提交失败(${res?.code || 'unknown'}): ${res?.message || text}`);
  }

  return totalSteps;
}

// ==================== Token 缓存 ====================

function getTokenCache(state, account) {
  if (!state.tokenCache) return null;
  const entry = state.tokenCache[account];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TOKEN_TTL_MS) return null;
  return entry;
}

function setTokenCache(state, account, tokenInfo) {
  if (!state.tokenCache) state.tokenCache = {};
  state.tokenCache[account] = {
    userId: tokenInfo.userId,
    appToken: tokenInfo.appToken,
    loginToken: tokenInfo.loginToken,
    cachedAt: Date.now(),
  };
}

async function getToken(state, account, password) {
  const cached = getTokenCache(state, account);
  if (cached) {
    const ageMin = Math.round((Date.now() - cached.cachedAt) / 60000);
    console.log(`  [Token] ♻ 使用缓存（已缓存 ${ageMin} 分钟），免登录`);
    return cached;
  }
  console.log(`  [Token] 缓存无效，执行完整登录...`);
  const tokenInfo = await loginHuami(account, password);
  setTokenCache(state, account, tokenInfo);
  saveState(state);
  console.log(`  [Token] ✅ 已缓存，有效期 12 小时`);
  return tokenInfo;
}

function isAuthError(err) {
  const msg = err.message || '';
  return msg.includes('token') || msg.includes('auth') ||
         msg.includes('401') || msg.includes('403') ||
         msg.includes('无法获取') || msg.includes('账号或密码错误');
}

async function submitWithTokenRefresh(state, account, password, tokenInfo, totalSteps, dailyTarget) {
  try {
    return await submitSteps(tokenInfo, totalSteps, dailyTarget);
  } catch (err) {
    if (isAuthError(err)) {
      console.log(`  [Token] ⚠ Token 可能已过期，重新登录...`);
      const newToken = await loginHuami(account, password);
      setTokenCache(state, account, newToken);
      saveState(state);
      console.log(`  [Token] 🔄 已刷新，重试提交...`);
      return await submitSteps(newToken, totalSteps, dailyTarget);
    }
    throw err;
  }
}

// ==================== 服务器同步 ====================

async function fetchServerSteps(tokenInfo) {
  try {
    const today = dateStr();
    const params = new URLSearchParams({
      userid: tokenInfo.userId,
      from: today,
      to: today,
    });
    const text = await httpPost(
      `https://api-mifit.zepp.com/v1/data/band_data.json?t=${ts()}&${params.toString()}`,
      { apptoken: tokenInfo.appToken },
      ''
    );
    const res = safeJSON(text);
    if (res && res.data && Array.isArray(res.data)) {
      for (const item of res.data) {
        if (item.summary) {
          const summary = safeJSON(item.summary);
          if (summary && summary.stp && typeof summary.stp.ttl === 'number') {
            return summary.stp.ttl;
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = {
  rand,
  formatSteps,
  withRetry,
  loginHuami,
  submitSteps,
  getTokenCache,
  setTokenCache,
  getToken,
  isAuthError,
  submitWithTokenRefresh,
  fetchServerSteps,
};
