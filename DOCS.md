# 🏃 华米步数模拟系统 — 技术规范 v6

> Node.js v20 | 23 文件 | ~5500 行 | 达标率 70% | 最后更新 2026-05-26

---

## 目录

1. [系统架构](#1-系统架构)
2. [核心指标](#2-核心指标)
3. [模块详解](#3-模块详解)
4. [配置规范](#4-配置规范)
5. [真实感引擎规则](#5-真实感引擎规则)
6. [白夜班调度规则](#6-白夜班调度规则)
7. [执行与调度规则](#7-执行与调度规则)
8. [日志规范](#8-日志规范)
9. [模拟测试规范](#9-模拟测试规范)
10. [Web 控制台](#10-web-控制台)
11. [运行维护手册](#11-运行维护手册)

---

## 1. 系统架构

```
launchd(每30min) / --dashboard / CLI / sim-month.js(模拟)
              ↓
       huami-steps.js (15命令模式)
              ↓
    ┌─────────┼─────────┬──────────┐
 config(3预设) state    engine     dashboard(16API)
 日历+调休    时间模拟   真实感6步    Web全功能
 自适应目标   日志双写   5层修正     Chart.js
```

**设计原则：**
- 环境隔离：`sim/` + `setSimTime()`，不提交API
- 密码脱敏：API返回仅末4位
- 时段守卫：入口判断窗口，无效零开销
- 多次少步：日均 ≥18 次执行，每次 200~400 步

---

## 2. 核心指标

| 指标 | 值 | 说明 |
|------|-----|------|
| 🎯 达标率 | **70%** | 30天模拟验证 |
| ☀ 白班达标 | 90% | |
| 🌙 夜班达标 | 71% | |
| 📊 日均执行 | 19 次 | 多次少步 ✅ |
| 📏 每次增量 | ~350 步 | |
| 🚨 异常数 | 0 | 30天模拟 |
| 🏋 主动运动 | ~1次/周 | 2000~5000步 |
| 🎢 特殊日 | 2天/周 | 暴走/懒散 |

---

## 3. 模块详解

### 3.1 真实感引擎 `lib/engine.js`

**computeRealismIncrement 完整流程（7步）：**
```
1. getTimeProfile() → 时段参数 + nightMult + 特殊日检测
2. 久坐跳过 (skipChance + 特殊日偏差) — 末段冲刺不跳过
3. 走路事件 (walkChance × nightMult) → 500~1200步
3.5 主动运动 (2% × nightMult) → 2000~5000步 🏋
4. 突发活跃 ×1.5~3.0
5. 渐进减速 (75%后，最低30%) — 冲刺时最低60%
6. 末段冲刺 🏁：最后1h ≥85% → 跳过归零 ×1.4
7. 三角随机 × specialMult × effectiveMult → 增量
```

**夜班修正（getTimeProfile）：**
| 条件 | 效果 |
|------|------|
| 夜班基础 | nightMult=0.85, skipBias+0.03 |
| 凌晨4-6点 | nightMult×0.35, skipBias+0.35（收尾） |
| 20:00上班 | nightMult=1.0, skipBias=0.05（通勤级） |

**特殊日模式（日期哈希）：**
| 模式 | 概率 | 增量 | 跳过率 |
|------|------|------|--------|
| 🎢 暴走日 | 1/7 | ×1.5 | -15% |
| 😴 懒散日 | 1/7 | ×0.55 | +20% |
| 正常 | 5/7 | ×1.0 | ±0 |

### 3.2 自适应目标 `lib/memory.js`

**5档调节（基于7天达标率）：**
| 达标率 | 调整 | 说明 |
|--------|------|------|
| >95% | ×1.05 | 微提 |
| 85-95% | ×1.0 | 维持 |
| 70-85% | ×0.94 | 微降 |
| 50-70% | ×0.88 | 降低 |
| <50% | ×0.82 | 大幅降 |

下限保护：不低于7天均值的80%

### 3.3 白夜班调度 `lib/shift.js`

**作息表：**
| | ☀ 白班周 | 🌙 夜班周 |
|------|---------|----------|
| 上班 | 8:00-17:30 | 20:00-06:00 |
| 睡眠 | 0:00-6:59 | 7:00-13:59 |
| 窗口 | 7:00-21:00 | 14:00-07:00 |
| 冷却 | 无 | 4-6点×0.35 |

**过渡周一：** 午睡12-14，20点上班boost

### 3.4 模块速查

| 模块 | 功能 |
|------|------|
| `engine.js` | 真实感7步增量 + 夜班修正 + 特殊日 + 末段冲刺 + 主动运动 |
| `memory.js` | 14天历史 + 5档自适应目标 |
| `shift.js` | 双周交替 + 睡眠窗口 + 过渡日 |
| `time.js` | 北京时间 + setSimTime() 模拟覆盖 |
| `calendar.js` | 法定假 + 调休工作日 |
| `weather.js` | wttr.in + 2h缓存 |
| `adapt.js` | 中程调整 + ETA |
| `logger.js` | 紧凑单行格式 + JSONL |
| `dashboard.js` | 16API + 设置页面 |
| `sim-month.js` | 完整隔离模拟 |

---

## 4. 配置规范

### 关键参数（当前值）

```jsonc
{
  "incrementRange": { "min": 200, "max": 600 },
  "dailyMaxSteps": { "min": 5000, "max": 7500 },
  "realism": {
    "enabled": true, "preset": "office-worker",
    "deceleration": true, "distribution": "triangular",
    "weekendHourShift": 2, "weekendMultiplier": 0.7,
    "burstMultiplier": { "min": 1.5, "max": 3.0 },
    "walkEvent": { "chance": 0.04, "steps": { "min": 500, "max": 1200 } },
    "dailyMaxSteps": {
      "weekday": { "min": 5000, "max": 7500 },
      "weekend": { "min": 3000, "max": 5000 }
    },
    "_dailyTargetUserSet": true,
    "nightShift": {
      "enabled": true, "autoDetect": true,
      "firstNightShiftMonday": "2026-05-25",
      "hourShift": 7, "activityMultiplier": 0.85,
      "dailyTargetAdjust": 0.85, "skipIncrease": 0.03
    }
  }
}
```

### 调参原则

| 参数 ↑ | 效果 | 注意 |
|--------|------|------|
| incrementRange | 步数↑ 执行↓ | 反"多次少步" |
| burstMultiplier | 波动↑ | 影响可控性 |
| walkEvent.chance | 大增量频率↑ | |
| dailyTargetAdjust↓ | 夜班目标↓ 达标↑ | |
| activityMultiplier↑ | 夜班步数↑ | |

---

## 5. 真实感引擎规则

### 核心原则

**多次少步：** 日均≥18次执行，每次200~400步
**自然达标：** 达标率~70%，非100%（真人不会每天达标）
**异常值：** 每周1-2天暴走/懒散
**末段冲刺：** 最后1小时≥85%时加速
**主动运动：** 每周~1次刻意运动

### 增量公式

```
增量 = 时段基础(三角分布)
     × 休息日系数(0.7)
     × 夜班系数(0.85, 凌晨0.35, 20点1.0)
     × 突发(1.5~3.0)
     × 减速(0.3~1.0, 冲刺0.6~1.0)
     × 冲刺(×1.4)
     × 特殊日(0.55~1.5)
```

---

## 6. 白夜班调度规则

- firstNightShiftMonday=2026-05-25, 双周交替
- 夜班: 上班20-06, 睡眠7-14, 窗口14-07
- 白班: 上班8-17:30, 睡眠0-7, 窗口7-21
- 冷却: 夜班4-6点×0.35, 20点通勤boost
- 过渡周一: 午睡12-14

---

## 7. 执行与调度

```bash
launchctl load ~/Library/LaunchAgents/com.huami.steps.plist   # 启动
launchctl list com.huami.steps                                  # 状态
```

执行链: launchd(30min) → 随机延时(0~9min) → 时段守卫 → 睡眠检测 → 跨天 → 增量 → API提交

---

## 8. 日志规范

紧凑格式:
```
2026-05-26 14:00 ▶ | 增量 200~600 | 工作日 | 🌙🌅 早起 [128~340] | 跳过15%
  ✅ email  0 → +326 → 326 / 6242  █ 5%  🏁 末段冲刺
✓ 完成 | 成功 12 | 跳过 4 | 失败 0 | 累计 6,226 步
```

---

## 9. 模拟测试规范

```bash
node sim-month.js          # 30天
node sim-month.js 60       # 60天
node sim-month.js 30 2026-07-01  # 指定起始
```

隔离: `sim/`目录 + `setSimTime()` + 不调API
验证标准: 达标率40-80%, 日均≥18次, 0异常

---

## 10. Web 控制台

`localhost:3456` | `node huami-steps.js --dashboard`

16个API + 设置页面(预设/账号/23项参数)

---

## 11. 运行维护

```bash
node huami-steps.js --status    # 状态
node sim-month.js 30            # 模拟测试
tail -20 huami-steps.log        # 日志
launchctl list com.huami.steps  # 调度状态
```
