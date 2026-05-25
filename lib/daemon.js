/**
 * lib/daemon.js — 守护模式循环
 *
 * 按 config.schedule 配置定时执行 main()
 * 支持 SIGINT/SIGTERM 优雅退出
 */
const { chinaHour, sleep } = require('./time');
const { saveState } = require('./state');

async function daemonLoop(mainFn, config, state) {
  const { schedule } = config;

  if (!schedule || schedule.type !== 'interval') {
    console.error('❌ 守护模式需要 config.json 中配置 schedule.type = "interval"');
    process.exit(1);
  }

  const intervalMin = schedule.intervalMinutes || 30;
  const startH = schedule.startHour ?? 7;
  const endH = schedule.endHour ?? 22;
  const intervalMs = intervalMin * 60 * 1000;

  console.log(`\n🔄 守护模式已启动`);
  console.log(`   执行间隔：每 ${intervalMin} 分钟`);
  console.log(`   活跃时段：${String(startH).padStart(2, '0')}:00 - ${String(endH).padStart(2, '0')}:00`);
  console.log(`   按 Ctrl+C 停止\n`);

  // 优雅退出
  let shuttingDown = false;
  const onSignal = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n🛑 收到停止信号，保存状态...`);
    saveState(state);
    console.log(`✅ 状态已保存，退出`);
    process.exit(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  // 启动后立即执行一次
  try { await mainFn(); } catch (e) { console.error('⚠ 执行异常：', e.message); }

  while (!shuttingDown) {
    const now = new Date();
    const nextMin = Math.ceil(now.getMinutes() / intervalMin) * intervalMin;
    const next = new Date(now);
    next.setMinutes(nextMin, 0, 0);
    if (next <= now) next.setMinutes(next.getMinutes() + intervalMin);

    const waitMs = next - now;
    const nextChinaHour = new Date(next.getTime() + 8 * 60 * 60 * 1000).getUTCHours();
    const nextTime = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;

    if (nextChinaHour >= startH && nextChinaHour < endH) {
      console.log(`⏰ 下次执行：${nextTime}（${Math.round(waitMs / 60000)} 分钟后）`);
    } else {
      console.log(`💤 非活跃时段，下次执行：${nextTime}（跳过）`);
    }

    await sleep(waitMs);
    if (shuttingDown) break;

    // 🌙 唤醒检测：如果实际等待远长于预期，说明系统刚睡醒
    const actualElapsed = Date.now() - now.getTime();
    const missedIntervals = Math.floor((actualElapsed - waitMs) / intervalMs);
    if (missedIntervals > 1) {
      console.log(`🌙 系统唤醒！错过了 ${missedIntervals} 次执行（休眠 ${Math.round(actualElapsed/60000)} 分钟）`);
      // 追赶执行，最多补 3 次避免 API 洪水
      const catchUp = Math.min(missedIntervals, 3);
      for (let c = 0; c < catchUp && !shuttingDown; c++) {
        const curCH = chinaHour();
        if (curCH >= startH && curCH < endH) {
          console.log(`  🔄 补执行 ${c + 1}/${catchUp}...`);
          try { await mainFn(); } catch (e) { console.error('⚠ 执行异常：', e.message); }
          if (c < catchUp - 1) await sleep(3000); // 补执行间隔 3 秒
        }
      }
      continue; // 跳过本次正常执行（已在追赶中覆盖）
    }

    const curChinaHour = chinaHour();
    if (curChinaHour >= startH && curChinaHour < endH) {
      try { await mainFn(); } catch (e) { console.error('⚠ 执行异常：', e.message); }
    }
  }
}

module.exports = { daemonLoop };
