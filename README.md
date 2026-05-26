# 🏃 华米步数模拟系统

> 基于打工人习性模型的智能步数模拟，支持 Web 全功能管理、白夜班调度、天气感知、真实数据学习。

📖 **完整技术文档：** [`DOCS.md`](./DOCS.md)

---

## 🚀 快速开始

```bash
# 1. 复制配置模板并编辑
cp config.example.json config.json
nano config.json          # 填入华米账号密码

# 2. 启动 Web 控制台
node huami-steps.js --dashboard
# → 打开 http://localhost:3456

# 3. 安装定时任务
launchctl load ~/Library/LaunchAgents/com.huami.steps.plist
```

**环境要求：** Node.js >= 18 | macOS

---

## 📟 命令一览

| 命令 | 说明 |
|------|------|
| `--dashboard` | 🌐 Web 全功能控制台 (3456) |
| `--status` | 📊 查看当日状态 + 达标预测 |
| `--reset` | 🔄 重置当日步数 |
| `--simulate` | 🔮 模拟今日剩余执行 |
| `--report` | 📋 生成日报 + Webhook 推送 |
| `--seed` | 🌱 生成历史种子数据 |

---

## 🌐 Web 控制台

`http://localhost:3456` 提供全部管理功能：

| 面板 | 功能 |
|------|------|
| 📊 实时状态 | 步数/目标/完成度/ETA/天气 |
| 📈 趋势图 | Chart.js 7天步数图表 |
| 📝 手动录入 | 按小时填入步数 |
| ⚙ 设置 | 预设切换/账号管理/参数编辑 |

---

## 🎭 核心特性

- **真实感引擎** — 24时段 + 久坐跳过 + 走路事件 + 突发活跃 + 渐进减速 + 末段冲刺
- **白夜班调度** — 双周交替 + 睡眠窗口 + 凌晨冷却 + 过渡日
- **智能学习** — 7天自适应目标 + 人物画像 + 周模式
- **天气感知** — wttr.in 免费 API，雨雪降低户外活动
- **节假日** — 2025-2026 法定假 + 调休工作日

---

## 🔧 模拟测试

```bash
node sim-month.js 30    # 30天环境隔离模拟
```

---

## 📁 项目结构

```
huami-steps/
├── huami-steps.js       # 主入口
├── sim-month.js         # 模拟脚本
├── config.example.json  # 配置模板
├── lib/                 # 21个核心模块
├── sim/                 # 模拟数据
└── DOCS.md              # 完整技术文档
```
