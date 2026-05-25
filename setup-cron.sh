#!/bin/bash
# ============================================
#  华米步数 — cron 定时任务安装脚本
#  适配 v4 模块化架构
# ============================================
#  用法:
#    bash setup-cron.sh          # 安装 cron 任务
#    bash setup-cron.sh --remove # 移除 cron 任务
#    bash setup-cron.sh --status # 查看 cron 状态
#    bash setup-cron.sh --run    # 手动执行一次
# ============================================

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="$(command -v node)"

check_node() {
  if [ -z "$NODE_BIN" ]; then
    echo "❌ 未找到 Node.js，请先安装"
    exit 1
  fi
  echo "✅ Node: $NODE_BIN ($($NODE_BIN --version))"
}

read_schedule() {
  local v
  v=$("$NODE_BIN" -e "try{process.stdout.write(String(require('$SCRIPT_DIR/config.json').schedule?.intervalMinutes||'30'))}catch(e){}")
  echo "${v:-30}"
}

CMD="cd $SCRIPT_DIR && sleep \$((RANDOM % 540)) && $NODE_BIN $SCRIPT_DIR/huami-steps.js >> $SCRIPT_DIR/huami-steps.log 2>&1"

case "${1:-}" in
  --remove)
    crontab -l 2>/dev/null | grep -v "huami-steps" | crontab - 2>/dev/null || true
    echo "✅ 已移除 cron 任务"
    ;;
  --status)
    echo "📋 当前 crontab 中的 huami-steps 任务:"
    crontab -l 2>/dev/null | grep "huami-steps" || echo "  (无)"
    ;;
  --run)
    check_node
    echo "▶ 手动执行一次..."
    eval "$CMD"
    echo "✅ 完成，日志见 huami-steps.log"
    ;;
  *)
    check_node
    INTERVAL=$(read_schedule)
    CRON_LINE="*/$INTERVAL 7-21 * * * $CMD"

    # 先移除旧任务
    crontab -l 2>/dev/null | grep -v "huami-steps" | crontab - 2>/dev/null || true

    # 安装新任务
    (crontab -l 2>/dev/null || true; echo "$CRON_LINE") | crontab -

    echo "✅ cron 已安装"
    echo "   间隔: 每 ${INTERVAL} 分钟"
    echo "   时段: 7:00 - 21:00"
    echo "   日志: $SCRIPT_DIR/huami-steps.log"
    echo "   状态: bash setup-cron.sh --status"
    echo "   移除: bash setup-cron.sh --remove"
    ;;
esac
