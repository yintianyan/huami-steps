/**
 * lib/weather.js — 天气感知
 *
 * 使用 wttr.in 免费 API（无需密钥），每 2 小时缓存一次
 * 下雨/下雪 → 减少户外活动，增加室内微量活动
 */

const { sleep } = require('./time');

// ==================== 天气缓存 ====================
let weatherCache = null;
let cacheTime = 0;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时

/**
 * 从 wttr.in 获取天气（JSON 格式）
 * @param {string} city - 城市名，默认 Beijing
 * @returns {object|null} 天气数据
 */
async function fetchWeather(city = 'Beijing') {
  const now = Date.now();
  if (weatherCache && (now - cacheTime) < CACHE_TTL_MS) {
    return weatherCache;
  }
  try {
    const resp = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    weatherCache = data;
    cacheTime = now;
    return data;
  } catch {
    return weatherCache; // 获取失败返回旧缓存
  }
}

/**
 * 将天气状况映射为活动修正系数
 *
 * @returns {{ modifier: number, desc: string, indoorBias: number }}
 *   modifier: 户外活动系数 (0.3=暴雨 → 1.2=晴好)
 *   indoorBias: 室内微量活动增强系数
 *   desc: 天气描述
 */
function weatherToModifier(weatherData) {
  if (!weatherData?.current_condition) {
    return { modifier: 1.0, indoorBias: 1.0, desc: '未知天气' };
  }

  const cond = weatherData.current_condition[0];
  const code = parseInt(cond.weatherCode) || 0;
  const desc = (cond.weatherDesc?.[0]?.value || cond.lang_zh?.[0]?.value || '未知').trim();
  const temp = parseInt(cond.temp_C) || 20;

  // 天气代码 → 活动修正
  // 参考：https://www.worldweatheronline.com/weather-api/api/docs/weather-icons.aspx
  let modifier = 1.0;
  let indoorBias = 1.0;

  if (code >= 200 && code < 300) {
    // 雷暴
    modifier = 0.2; indoorBias = 1.4;
  } else if (code >= 300 && code < 400) {
    // 毛毛雨
    modifier = 0.6; indoorBias = 1.1;
  } else if (code >= 500 && code < 600) {
    // 雨
    modifier = 0.4; indoorBias = 1.3;
  } else if (code >= 600 && code < 700) {
    // 雪
    modifier = 0.3; indoorBias = 1.3;
  } else if (code >= 700 && code < 800) {
    // 雾/霾
    modifier = 0.7; indoorBias = 1.1;
  } else {
    // 晴/多云 (800-804)
    modifier = 1.0 + (code === 800 ? 0.15 : 0.05); // 大晴天 ×1.15
    indoorBias = 1.0;
  }

  // 极端温度修正
  if (temp > 38)  { modifier *= 0.5; indoorBias = Math.max(indoorBias, 1.4); }
  if (temp < 0)   { modifier *= 0.5; indoorBias = Math.max(indoorBias, 1.2); }

  return { modifier: Math.round(modifier * 100) / 100, indoorBias, desc };
}

/**
 * 获取当前天气活动修正
 * @returns {{ modifier: number, desc: string, indoorBias: number }}
 */
async function getWeatherModifier(city) {
  const data = await fetchWeather(city);
  return weatherToModifier(data);
}

module.exports = { fetchWeather, weatherToModifier, getWeatherModifier };
