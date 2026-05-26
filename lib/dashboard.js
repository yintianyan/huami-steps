/**
 * lib/dashboard.js — 全功能 Web 控制台
 *
 * 端口 3456，局域网可访问
 * 功能：状态展示、步数图表、手动执行/重置、数据导入、日志查看
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { dateStr, datetimeStr, chinaHour } = require('./time');
const { isRestDay } = require('./calendar');

const ROOT = path.join(__dirname, '..');
const PORT = 3456;

// ==================== 数据获取 ====================

function getData() {
  const { loadConfig } = require('./config');
  const { loadState } = require('./state');
  const config = loadConfig();
  const state = loadState();
  const safeConfig = JSON.parse(JSON.stringify(config));
  if (safeConfig.accounts) safeConfig.accounts = safeConfig.accounts.map(a => ({ account: a.account, profile: a.profile || null }));
  return { state, config: safeConfig, accounts: config.accounts, history: state.history || {} };
}

function formatSteps(n) { return (n||0).toLocaleString('zh-CN'); }

// ==================== HTML ====================

function renderHTML() {
  return `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🏃 华米步数控制台</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b1120;color:#e2e8f0;min-height:100vh}
.header{background:#1a2332;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1e3a5f}
.header h1{font-size:18px;display:flex;align-items:center;gap:8px}
.controls{display:flex;gap:8px}
.btn{padding:8px 16px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer;font-size:13px;transition:.2s}
.btn:hover{background:#334155}
.btn-green{background:#065f46;border-color:#047857}.btn-green:hover{background:#047857}
.btn-red{background:#7f1d1d;border-color:#991b1b}.btn-red:hover{background:#991b1b}
.btn-blue{background:#1e3a5f;border-color:#2563eb}.btn-blue:hover{background:#2563eb}
.main{max-width:1200px;margin:0 auto;padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:800px){.main{grid-template-columns:1fr}}
.panel{background:#1a2332;border-radius:12px;padding:20px;border:1px solid #1e3a5f}
.panel.full{grid-column:1/-1}
.panel h2{font-size:15px;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.stat-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1e293b;font-size:13px}
.stat-row span:last-child{font-weight:600}
.progress-bar{height:24px;background:#1e293b;border-radius:12px;overflow:hidden;margin:12px 0}
.progress-fill{height:100%;background:linear-gradient(90deg,#2563eb,#38bdf8);border-radius:12px;transition:width .5s;display:flex;align-items:center;padding:0 10px;font-size:11px;font-weight:600}
.metric-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.metric-card{background:#0f172a;border-radius:8px;padding:12px;text-align:center}
.metric-card .val{font-size:24px;font-weight:700;color:#38bdf8}
.metric-card .lbl{font-size:11px;color:#64748b;margin-top:4px}
.chart-wrap{position:relative;height:250px}
.chart-wrap canvas{width:100%!important}
.log-view{max-height:300px;overflow-y:auto;font-family:monospace;font-size:12px;color:#94a3b8;white-space:pre-wrap;background:#0f172a;border-radius:8px;padding:12px}
.upload-zone{border:2px dashed #334155;border-radius:12px;padding:30px;text-align:center;cursor:pointer;transition:.2s}
.upload-zone:hover{border-color:#38bdf8;background:#0f172a}
#toast{position:fixed;top:20px;right:20px;z-index:999;display:none}
.toast-msg{background:#065f46;color:#fff;padding:12px 20px;border-radius:8px;margin-bottom:8px;font-size:13px}
.hidden{display:none}
.tabs{display:flex;gap:0;margin-bottom:12px}
.tab{padding:6px 14px;background:#0f172a;border:1px solid #1e3a5f;cursor:pointer;font-size:12px;color:#94a3b8}
.tab:first-child{border-radius:8px 0 0 8px}.tab:last-child{border-radius:0 8px 8px 0}
.tab.active{background:#1e3a5f;color:#fff}
</style></head><body>
<div class="header">
  <h1>🏃 华米步数控制台 <span style="font-size:12px;color:#64748b;font-weight:400" id="refreshTime"></span></h1>
  <div class="controls">
    <button class="btn btn-green" onclick="manualRun()">▶ 手动执行</button>
    <button class="btn btn-blue" onclick="action('reset')">🔄 重置</button>
    <button class="btn" id="nightBtn" onclick="toggleNight()" style="background:#4a1d6b;border-color:#7c3aed">🌙 夜班</button>
    <button class="btn btn-red" onclick="action('simulate')">🔮 模拟</button>
    <button class="btn" onclick="location.reload()">🔃 刷新</button>
  </div>
</div>
<div class="main">
  <!-- 状态面板 -->
  <div class="panel">
    <h2>📊 实时状态 <span id="statusTime"></span></h2>
    <div class="metric-grid" id="metrics"></div>
    <div class="progress-bar"><div class="progress-fill" id="progressBar">0%</div></div>
    <div class="stat-row"><span>🕐 预计达标</span><span id="eta">—</span></div>
    <div class="stat-row"><span>🧠 智能分析</span><span id="persona">—</span></div>
    <div class="stat-row"><span>🌤 当前时段</span><span id="timeSlot">—</span></div>
    <div class="stat-row"><span>📅 日类型</span><span id="dayType">—</span></div>
    <div class="stat-row"><span>🌦 天气因子</span><span id="weatherInfo">—</span></div>
  </div>
  <!-- 日趋势 -->
  <div class="panel">
    <h2>📈 今日步数趋势 <span id="historyCount"></span></h2>
    <div class="chart-wrap"><canvas id="trendChart"></canvas></div>
  </div>
  <!-- 日志 -->
  <div class="panel full">
    <div class="tabs" style="margin-bottom:12px">
      <div class="tab active" onclick="switchTab('log')">📋 执行日志</div>
      <div class="tab" onclick="switchTab('manual')">📝 手动录入</div>
      <div class="tab" onclick="switchTab('import')">📥 文件导入</div>
      <div class="tab" onclick="switchTab('history')">📊 历史图表</div>
      <div class="tab" onclick="switchTab('settings')">⚙ 设置</div>
    </div>
    <div id="tab-log"><div class="log-view" id="logContent">加载中...</div></div>
    <div id="tab-manual" class="hidden">
      <div style="display:flex;gap:12px;margin-bottom:12px;align-items:center;flex-wrap:wrap">
        <label>日期: <input type="date" id="manualDate" style="background:#0f172a;color:#fff;border:1px solid #334155;border-radius:6px;padding:6px;font-size:13px"></label>
        <label>星期: <select id="manualDow" style="background:#0f172a;color:#fff;border:1px solid #334155;border-radius:6px;padding:6px;font-size:13px">
          <option>周一</option><option>周二</option><option>周三</option><option>周四</option><option>周五</option><option>周六</option><option>周日</option>
        </select></label>
        <button class="btn btn-blue" onclick="fillSleep()">🌙 睡眠时段填0</button>
        <button class="btn btn-green" onclick="submitManual()">✅ 导入数据</button>
        <span id="manualTotal" style="font-size:14px;font-weight:600;color:#38bdf8"></span>
      </div>
      <div id="manualGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;max-height:400px;overflow-y:auto"></div>
    </div>
    <div id="tab-import" class="hidden">
      <div class="upload-zone" onclick="document.getElementById('fileInput').click()">
        📁 点击上传 hourly JSON 或 CSV 文件<br>
        <small style="color:#64748b">支持 hourly-template.json 格式</small>
      </div>
      <input type="file" id="fileInput" accept=".json,.csv" class="hidden" onchange="uploadFile()">
      <div id="uploadResult" style="margin-top:12px;font-size:13px"></div>
    </div>
    <div id="tab-history" class="hidden">
      <div class="chart-wrap"><canvas id="historyChart"></canvas></div>
    </div>
    <div id="tab-settings" class="hidden">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <!-- 预设切换 -->
        <div style="background:#0f172a;border-radius:10px;padding:14px">
          <h3 style="font-size:14px;margin-bottom:10px">🎯 预设方案</h3>
          <div id="presetList" style="display:flex;flex-direction:column;gap:6px"></div>
          <div id="presetMsg" style="font-size:12px;color:#38bdf8;margin-top:8px"></div>
        </div>
        <!-- 账号管理 -->
        <div style="background:#0f172a;border-radius:10px;padding:14px">
          <h3 style="font-size:14px;margin-bottom:10px">📧 账号管理</h3>
          <div id="accountList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>
          <div style="display:flex;gap:6px">
            <input type="email" id="newAccount" placeholder="邮箱" style="flex:1;background:#1a2332;color:#fff;border:1px solid #334155;border-radius:6px;padding:6px;font-size:12px">
            <input type="password" id="newPassword" placeholder="密码" style="flex:1;background:#1a2332;color:#fff;border:1px solid #334155;border-radius:6px;padding:6px;font-size:12px">
            <button class="btn btn-green" onclick="addAccount()" style="font-size:12px;padding:6px 12px">添加</button>
          </div>
          <div id="accountMsg" style="font-size:12px;color:#38bdf8;margin-top:8px"></div>
        </div>
      </div>
      <!-- 配置编辑 -->
      <div style="background:#0f172a;border-radius:10px;padding:14px;margin-top:12px">
        <h3 style="font-size:14px;margin-bottom:10px">⚙ 运行参数</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px" id="configForm"></div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <button class="btn btn-green" onclick="saveConfig()">💾 保存配置</button>
          <button class="btn" onclick="loadConfigForm()">🔄 重新加载</button>
          <span id="configMsg" style="font-size:12px;color:#38bdf8;align-self:center"></span>
        </div>
      </div>
    </div>
  </div>
</div>
<div id="toast"></div>
<script>
let trendChart=null,historyChart=null;
const API='/api';

async function api(path,opt={}){
  const r=await fetch(API+path,opt);
  return r.json();
}

function toast(msg,ok=true){
  const t=document.getElementById('toast');
  const d=document.createElement('div');
  d.className='toast-msg';d.style.background=ok?'#065f46':'#7f1d1d';
  d.textContent=msg;t.appendChild(d);t.style.display='block';
  setTimeout(()=>{d.remove();if(!t.children.length)t.style.display='none'},3000);
}

async function toggleNight(){
  const r=await api('/nightshift');
  const btn=document.getElementById('nightBtn');
  if(r.enabled){
    btn.style.background='#7c3aed';btn.style.borderColor='#a78bfa';btn.textContent='🌙 夜班 ON';
  }else{
    btn.style.background='#4a1d6b';btn.style.borderColor='#7c3aed';btn.textContent='🌙 夜班';
  }
  toast(r.enabled?'🌙 夜班模式已开启（作息翻转12h）':'☀ 白班模式已恢复');
  setTimeout(refresh,500);
}

async function manualRun(){
  const input=prompt('输入步数（正数增加，负数减少，留空自动执行）:', '');
  if(input===null) return;
  const steps=parseInt(input);
  if(input!==''&&isNaN(steps)){toast('请输入有效数字',false);return}
  try{
    const body=input===''?null:JSON.stringify({steps});
    const r=await fetch(API+'/run',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body
    });
    const j=await r.json();
    toast(j.msg||(j.ok?'操作成功':j.error),!!j.ok);
    setTimeout(refresh,1000);
  }catch(e){toast('操作失败: '+e.message,false)}
}

async function action(act){
  if(act==='reset'&&!confirm('确定重置今日所有步数？'))return;
  try{
    const r=await api('/'+act);
    toast(r.msg||r.ok?'操作成功':r.error,!!r.ok);
    setTimeout(refresh,1000);
  }catch(e){toast('操作失败: '+e.message,false)}
}

function switchTab(name){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  event.target.classList.add('active');
  ['log','manual','import','history','settings'].forEach(n=>document.getElementById('tab-'+n).classList.toggle('hidden',n!==name));
  if(name==='history') loadHistoryChart();
  if(name==='manual') buildManualGrid();
  if(name==='settings') loadSettings();
}

// ========== 手动录入 ==========
function buildManualGrid(){
  const grid=document.getElementById('manualGrid');
  if(grid.children.length>0) return; // 已构建
  document.getElementById('manualDate').value=new Date().toISOString().split('T')[0];
  let html='';
  for(let h=0;h<24;h++){
    const hs=String(h).padStart(2,'0');
    const nhs=String((h+1)%24).padStart(2,'0');
    const today=document.getElementById('manualDate').value;
    const rest=isRestDay(today);
    const work=rest?'🏠':'💼';
    const commute=rest?'🚶':'🚇';
    const label=h<6||h>=23?'🌙':h<9?'🌅':h<12?work:h<14?'🍜':h<17?work:h<19?commute:h<22?'🏃':'🏠';
    html+='<div style="background:#0f172a;border-radius:8px;padding:6px 8px;display:flex;align-items:center;gap:4px">';
    html+='<span style="font-size:10px;width:18px">'+label+'</span>';
    html+='<span style="font-size:11px;width:52px;color:#94a3b8">'+hs+':00-'+hs+':30</span>';
    html+='<input type="number" min="0" max="9999" value="0" id="s'+h+'a" onchange="updateTotal()" style="width:52px;background:#1a2332;color:#38bdf8;border:1px solid #334155;border-radius:4px;padding:3px;font-size:12px;text-align:center">';
    html+='<span style="font-size:11px;width:52px;color:#94a3b8">'+hs+':30-'+nhs+':00</span>';
    html+='<input type="number" min="0" max="9999" value="0" id="s'+h+'b" onchange="updateTotal()" style="width:52px;background:#1a2332;color:#38bdf8;border:1px solid #334155;border-radius:4px;padding:3px;font-size:12px;text-align:center">';
    html+='</div>';
  }
  grid.innerHTML=html;
  updateTotal();
}

function fillSleep(){
  for(let h=0;h<24;h++){
    if(h<6||h>=23){document.getElementById('s'+h+'a').value=0;document.getElementById('s'+h+'b').value=0}
  }
  updateTotal();
}

function updateTotal(){
  let total=0;
  for(let h=0;h<24;h++){
    total+=parseInt(document.getElementById('s'+h+'a')?.value||0);
    total+=parseInt(document.getElementById('s'+h+'b')?.value||0);
  }
  document.getElementById('manualTotal').textContent='总计: '+total.toLocaleString()+' 步';
}

async function submitManual(){
  const date=document.getElementById('manualDate').value;
  const dow=document.getElementById('manualDow').value;
  const slots={};
  for(let h=0;h<24;h++){
    const hs=String(h).padStart(2,'0');
    const nhs=String((h+1)%24).padStart(2,'0');
    slots[hs+':00-'+hs+':30']=parseInt(document.getElementById('s'+h+'a')?.value||0);
    slots[hs+':30-'+nhs+':00']=parseInt(document.getElementById('s'+h+'b')?.value||0);
  }
  const total=Object.values(slots).reduce((s,v)=>s+v,0);
  if(total===0){toast('请至少填入一些步数',false);return}

  const r=await fetch(API+'/manual',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({date,dayOfWeek:dow,slots})
  });
  const j=await r.json();
  if(j.ok){
    toast('✅ 导入成功: '+total.toLocaleString()+'步');
    setTimeout(refresh,500);
  }else{
    toast('❌ '+j.error,false);
  }
}

async function uploadFile(){
  const f=document.getElementById('fileInput').files[0];
  if(!f)return;
  const fd=new FormData();fd.append('file',f);
  const r=await fetch(API+'/upload',{method:'POST',body:fd});
  const j=await r.json();
  document.getElementById('uploadResult').innerHTML=j.ok
    ?'✅ '+j.msg+'<br>'+'<button class=btn onclick=manualRun() style=margin-top:8px>▶ 立即执行一次</button>'
    :'❌ '+j.error;
  if(j.ok)setTimeout(refresh,500);
}

async function refresh(){
  const data=await api('/status');
  const s=data.state||{},h=data.history||{},cfg=data.config||{};
  const today=s.date||'';
  const acc=s.accounts||{},tgt=s.dailyTargets||{};
  
  document.getElementById('refreshTime').textContent=datetime();
  document.getElementById('statusTime').textContent='· '+today;
  
  // 指标
  let metrics='';
  const total=Object.values(acc).reduce((a,b)=>a+b,0);
  const target=Object.values(tgt)[0]||8000;
  const pct=target?Math.min(100,Math.round(total/target*100)):0;
  metrics+='<div class=metric-card><div class=val>'+total.toLocaleString()+'</div><div class=lbl>当前步数</div></div>';
  metrics+='<div class=metric-card><div class=val>'+target.toLocaleString()+'</div><div class=lbl>今日目标</div></div>';
  metrics+='<div class=metric-card><div class=val>'+pct+'%</div><div class=lbl>完成度</div></div>';
  metrics+='<div class=metric-card><div class=val>'+(s.executionCount||0)+'次</div><div class=lbl>今日执行</div></div>';
  document.getElementById('metrics').innerHTML=metrics;
  
  // 进度条
  const bar=document.getElementById('progressBar');
  bar.style.width=pct+'%';bar.textContent=pct+'%';
  if(pct>=100){bar.style.background='linear-gradient(90deg,#059669,#34d399)'}
  
  // 状态行
  const restDay=isRestDay(today);
  document.getElementById('dayType').textContent=restDay?'📅 休息日':'📅 工作日';
  // 夜班状态
  const nightOn=data.shiftStatus==='night';
  const shiftLabel=data.shiftStatus==='night'?'🌙 夜班':data.shiftStatus==='rest'?'😴 休息':'☀ 白班';
  const nightBtn=document.getElementById('nightBtn');
  if(nightOn){nightBtn.style.background='#7c3aed';nightBtn.style.borderColor='#a78bfa';nightBtn.textContent='🌙 夜班 ON'}
  else{nightBtn.style.background='#4a1d6b';nightBtn.style.borderColor='#7c3aed';nightBtn.textContent='🌙 夜班'}
  document.getElementById('dayType').textContent=shiftLabel+' · '+(restDay?'休息日':'工作日');
  document.getElementById('persona').textContent=(data.persona||'—')+' | '+(Object.values(h)[0]?.length||0)+'天历史 | 💤'+data.sleepDesc;
  
  const hour=chinaHour();
  const tp=data.timeSlot||{desc:'—'};
  document.getElementById('timeSlot').textContent=tp.desc+' ['+(tp.incMin||0)+'~'+(tp.incMax||0)+']';
  // 天气因子
  const wm=data.weatherModifier||1;
  const wd=data.weatherDesc||'—';
  const wmPct=Math.round((wm-1)*100);
  const wmLabel=wm>1.05?'☀ +'+wmPct+'%':wm<0.95?'🌧 '+wmPct+'%':'☁ ±0%';
  document.getElementById('weatherInfo').textContent=wd+' · '+wmLabel;
  
  // ETA
  const eta=data.eta||'—';
  document.getElementById('eta').textContent=eta;
  
  // 历史计数
  const hCount=Object.values(h)[0]?.length||0;
  document.getElementById('historyCount').textContent=hCount+'天';
  
  // 趋势图
  const history=Object.entries(acc).flatMap(([acct,steps])=>{
    const hist=h[acct]||[];
    return hist.slice(-7).map(d=>({date:d.date,steps:d.steps,target:d.target}));
  });
  if(!trendChart){
    trendChart=new Chart(document.getElementById('trendChart'),{
      type:'bar',
      data:{labels:history.map(d=>d.date),datasets:[
        {label:'步数',data:history.map(d=>d.steps),backgroundColor:'#2563eb',borderRadius:4},
        {label:'目标',data:history.map(d=>d.target),backgroundColor:'#1e3a5f',borderRadius:4}
      ]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#94a3b8'}}},scales:{x:{ticks:{color:'#64748b'}},y:{ticks:{color:'#64748b'}}}}
    });
  }
  
  // 日志
  try{
    const logR=await api('/log');
    document.getElementById('logContent').textContent=logR.log||'暂无日志';
  }catch(e){}
}

function chinaHour(){return new Date(new Date().getTime()+8*3600000).getUTCHours()}
function datetime(){return new Date(new Date().getTime()+8*3600000).toISOString().replace('T',' ').slice(0,19)}
function isRestDay(d){const day=new Date(d).getDay();return day===0||day===6}

async function loadHistoryChart(){
  const data=await api('/history');
  const days=[];for(const acct in data.history||{}){for(const d of data.history[acct]||[]){days.push(d)}}
  days.sort((a,b)=>a.date.localeCompare(b.date));
  if(!historyChart){
    historyChart=new Chart(document.getElementById('historyChart'),{
      type:'line',
      data:{labels:days.map(d=>d.date),datasets:[
        {label:'步数',data:days.map(d=>d.steps),borderColor:'#38bdf8',tension:0.3,pointRadius:3},
        {label:'目标',data:days.map(d=>d.target),borderColor:'#64748b',tension:0.3,pointRadius:2,borderDash:[5,5]}
      ]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#94a3b8'}}},scales:{x:{ticks:{color:'#64748b',maxTicksLimit:15}},y:{ticks:{color:'#64748b'}}}}
    });
  }
}

// ========== 设置页 ==========
let configData=null;

async function loadSettings(){
  const r=await api('/config');
  if(!r.ok) return;
  configData=r.config;
  // 预设列表
  let presetHtml='';
  for(const p of r.presets||[]){
    const active=p.key===r.currentPreset;
    presetHtml+='<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:8px;'+(active?'background:#1e3a5f;border:1px solid #2563eb;':'background:#1a2332;border:1px solid #334155;')+'">';
    presetHtml+='<span style="font-size:13px">'+p.desc+'</span>';
    presetHtml+='<button class="btn '+(active?'btn-green':'')+'" onclick="switchPreset(\\''+p.key+'\\')" style="font-size:11px;padding:4px 10px">'+(active?'当前':'应用')+'</button>';
    presetHtml+='</div>';
  }
  document.getElementById('presetList').innerHTML=presetHtml;

  // 账号列表
  const ar=await api('/accounts');
  let acctHtml='';
  for(const a of ar.accounts||[]){
    acctHtml+='<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#1a2332;border:1px solid #334155;border-radius:8px">';
    acctHtml+='<span style="font-size:12px">📧 '+a.account+' <span style="color:#64748b">'+a.password+'</span></span>';
    acctHtml+='<div style="display:flex;gap:4px">';
    acctHtml+='<button class="btn" onclick="loginAccount(\\''+a.account+'\\')" style="font-size:11px;padding:4px 8px">🔑 登录</button>';
    acctHtml+='<button class="btn btn-red" onclick="removeAccount(\\''+a.account+'\\')" style="font-size:11px;padding:4px 8px">✕</button>';
    acctHtml+='</div></div>';
  }
  if(!ar.accounts||ar.accounts.length===0) acctHtml='<div style="font-size:12px;color:#64748b;padding:8px">暂无账号</div>';
  document.getElementById('accountList').innerHTML=acctHtml;

  // 配置表单
  loadConfigForm();
}

function loadConfigForm(){
  if(!configData) return;
  const c=configData;
  const r=c.realism||{};
  const ns=r.nightShift||{};
  const dms=r.dailyMaxSteps||{};
  const we=r.walkEvent||{};

  const fields=[
    ['基础','incrementRange.min','增量下限',c.incrementRange?.min||100,'number'],
    ['基础','incrementRange.max','增量上限',c.incrementRange?.max||500,'number'],
    ['基础','delaySeconds','提交间隔(秒)',c.delaySeconds||10,'number'],
    ['目标','dailyMaxSteps.weekday.min','工作日目标下限',dms.weekday?.min||7000,'number'],
    ['目标','dailyMaxSteps.weekday.max','工作日目标上限',dms.weekday?.max||9000,'number'],
    ['目标','dailyMaxSteps.weekend.min','休息日目标下限',dms.weekend?.min||4000,'number'],
    ['目标','dailyMaxSteps.weekend.max','休息日目标上限',dms.weekend?.max||7000,'number'],
    ['真实感','realism.enabled','启用真实感',r.enabled!==false,'bool'],
    ['真实感','realism.weekendHourShift','休息日作息后移(h)',r.weekendHourShift||0,'number'],
    ['真实感','realism.weekendMultiplier','休息日活动系数',r.weekendMultiplier||1,'number'],
    ['真实感','realism.burstMultiplier.min','突发倍数下限',(r.burstMultiplier||{}).min||2,'number'],
    ['真实感','realism.burstMultiplier.max','突发倍数上限',(r.burstMultiplier||{}).max||4,'number'],
    ['真实感','realism.walkEvent.chance','走路事件概率',we.chance||0.04,'number'],
    ['真实感','realism.walkEvent.steps.min','走路最小步数',(we.steps||{}).min||1000,'number'],
    ['真实感','realism.walkEvent.steps.max','走路最大步数',(we.steps||{}).max||2500,'number'],
    ['真实感','realism.afterTargetChance','达标后活动概率',r.afterTargetChance||0.1,'number'],
    ['真实感','realism.deceleration','渐进减速',r.deceleration!==false,'bool'],
    ['夜班','realism.nightShift.enabled','启用白夜班',ns.enabled!==false,'bool'],
    ['夜班','realism.nightShift.autoDetect','自动检测',ns.autoDetect!==false,'bool'],
    ['夜班','realism.nightShift.hourShift','作息翻转(h)',ns.hourShift||12,'number'],
    ['夜班','realism.nightShift.activityMultiplier','活动系数',ns.activityMultiplier||0.75,'number'],
    ['通知','webhookUrl','Webhook URL',c.webhookUrl||r.webhookUrl||'','text'],
  ];

  let html='';
  let lastGroup='';
  for(const [group,path,label,value,type] of fields){
    if(group!==lastGroup){
      if(lastGroup) html+='</div>';
      html+='<div style="background:#1a2332;border-radius:8px;padding:10px"><div style="font-size:11px;color:#64748b;margin-bottom:8px">'+group+'</div>';
      lastGroup=group;
    }
    html+='<div style="margin-bottom:6px"><label style="font-size:11px;color:#94a3b8;display:block">'+label+'</label>';
    if(type==='bool'){
      html+='<select data-path="'+path+'" style="width:100%;background:#0f172a;color:#fff;border:1px solid #334155;border-radius:4px;padding:4px;font-size:12px"><option value="1" '+(value?'selected':'')+'>✅ 开启</option><option value="0" '+(value?'':'selected')+'>❌ 关闭</option></select>';
    }else{
      html+='<input data-path="'+path+'" type="'+type+'" value="'+value+'" style="width:100%;background:#0f172a;color:#fff;border:1px solid #334155;border-radius:4px;padding:4px;font-size:12px">';
    }
    html+='</div>';
  }
  html+='</div>';
  document.getElementById('configForm').innerHTML=html;
}

async function saveConfig(){
  const updates={};
  document.querySelectorAll('#configForm [data-path]').forEach(el=>{
    const path=el.dataset.path.split('.');
    let val=el.tagName==='SELECT'?(el.value==='1'):(el.type==='number'?parseFloat(el.value):el.value);
    let obj=updates;
    for(let i=0;i<path.length-1;i++){
      if(!obj[path[i]]) obj[path[i]]={};
      obj=obj[path[i]];
    }
    obj[path[path.length-1]]=val;
  });
  const r=await fetch(API+'/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(updates)});
  const j=await r.json();
  document.getElementById('configMsg').textContent=j.ok?'✅ '+j.msg:'❌ '+(j.error||'失败');
  if(j.ok) setTimeout(()=>{document.getElementById('configMsg').textContent='';},3000);
}

async function switchPreset(key){
  if(!confirm('切换预设会覆盖时段配置和目标范围，确定？')) return;
  const r=await fetch(API+'/preset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preset:key})});
  const j=await r.json();
  document.getElementById('presetMsg').textContent=j.ok?'✅ '+j.msg:'❌ '+(j.error||'失败');
  if(j.ok){toast(j.msg);setTimeout(()=>{loadSettings();refresh();},800);}
}

async function addAccount(){
  const account=document.getElementById('newAccount').value.trim();
  const password=document.getElementById('newPassword').value;
  if(!account||!password){document.getElementById('accountMsg').textContent='❌ 请填写账号和密码';return}
  const r=await fetch(API+'/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add',account,password})});
  const j=await r.json();
  document.getElementById('accountMsg').textContent=j.ok?'✅ '+j.msg:'❌ '+j.error;
  if(j.ok){document.getElementById('newAccount').value='';document.getElementById('newPassword').value='';loadSettings();}
}

async function removeAccount(account){
  if(!confirm('确定删除账号 '+account+' ？')) return;
  const r=await fetch(API+'/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remove',account})});
  const j=await r.json();
  if(j.ok){toast(j.msg);loadSettings();}else{toast(j.error,false);}
}

async function loginAccount(account){
  document.getElementById('accountMsg').textContent='⏳ 登录中...';
  const r=await fetch(API+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account})});
  const j=await r.json();
  document.getElementById('accountMsg').textContent=j.ok?'✅ '+j.msg:'❌ '+j.error;
  if(j.ok) toast('登录成功');
}

refresh();setInterval(refresh,60000);
</script></body></html>`;
}

// ==================== API 路由 ====================

function jsonRes(res, data, code=200) {
  res.writeHead(code, {'Content-Type':'application/json;charset=utf-8'});
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise(resolve => {
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>resolve(body));
  });
}

function parseMultipart(body, boundary) {
  const parts={};
  const b='--'+boundary;
  const sections=body.split(b).filter(s=>s.includes('filename'));
  for(const s of sections){
    const nameMatch=s.match(/name="(\w+)"/);
    const filenameMatch=s.match(/filename="(.+?)"/);
    if(nameMatch && filenameMatch){
      const start=s.indexOf('\r\n\r\n')+4;
      const end=s.lastIndexOf('\r\n');
      parts[nameMatch[1]]={filename:filenameMatch[1],data:s.slice(start,end)};
    }
  }
  return parts;
}

function createServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin','*');
    const url = new URL(req.url, 'http://localhost');

    try {
      // 页面
      if (req.method==='GET' && (url.pathname==='/'||url.pathname==='/index.html')) {
        res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
        res.end(renderHTML());
        return;
      }

      // API: 状态
      if (url.pathname==='/api/status'){
        const {state,accounts,history,config}=getData();
        const {getTimeProfile}=require('./engine');
        const {midDayAdjust}=require('./adapt');
        const {identifyPersona}=require('./memory');
        const tp=getTimeProfile(state.realism||{},100,500,{today:dateStr()});
        const total=state.accounts?.[accounts[0]?.account]||0;
        const target=state.dailyTargets?.[accounts[0]?.account]||8000;
        const adjust=midDayAdjust(total,target,state);
        const persona=identifyPersona(history[accounts[0]?.account]||[]);
        const {getShiftStatus,getSleepDescription}=require('./shift');
        const shiftStatus=getShiftStatus(config.realism||{});
        // 天气因子
        let weatherModifier=1.0,weatherDesc='';
        try{
          const {getWeatherModifier}=require('./weather');
          const wm=await getWeatherModifier(config.realism?.city||'Beijing');
          weatherModifier=wm.modifier;
          weatherDesc=wm.desc;
        }catch(e){/* 天气获取失败不影响 */}
        return jsonRes(res,{ok:true,state,history,timeSlot:tp,eta:adjust.eta,persona:persona.desc,nightShift:shiftStatus.shift==='night',shiftStatus:shiftStatus.shift,sleepDesc:getSleepDescription(config.realism||{}),weatherModifier,weatherDesc});
      }

      // API: 手动执行
      if (url.pathname==='/api/run'){
        try{
          let manualSteps=0;
          if(req.method==='POST'){
            const body=await readBody(req);
            const data=JSON.parse(body||'{}');
            manualSteps=parseInt(data.steps)||0;
          }
          if(manualSteps !== 0){
            // 直接提交指定步数（正数增加，负数减少）
            const {loadState,saveState}=require('./state');
            const {getToken,submitWithTokenRefresh}=require('./api');
            const {loadConfig}=require('./config');
            const cfg=loadConfig();
            const state=loadState();
            const today=dateStr();
            for(const acct of cfg.accounts){
              const cur=state.accounts?.[acct.account]||0;
              const tgt=state.dailyTargets?.[acct.account]||8000;
              const newTotal=Math.max(0, cur + manualSteps);
              const token=await getToken(state,acct.account,acct.password);
              await submitWithTokenRefresh(state,acct.account,acct.password,token,newTotal,tgt);
              state.accounts[acct.account]=newTotal;
              saveState(state);
            }
            const sign=manualSteps>0?'+':'';
            jsonRes(res,{ok:true,msg:`已提交 ${sign}${manualSteps.toLocaleString()} 步`});
          }else{
            execSync('node "'+path.join(ROOT,'huami-steps.js')+'"',{cwd:ROOT,timeout:30000,stdio:'pipe'});
            jsonRes(res,{ok:true,msg:'执行完成'});
          }
        }catch(e){jsonRes(res,{ok:false,error:e.message},500)}
        return;
      }

      // API: 重置
      if (url.pathname==='/api/reset'){
        try{
          execSync('node "'+path.join(ROOT,'huami-steps.js')+'" --reset',{cwd:ROOT,timeout:10000,stdio:'pipe'});
          jsonRes(res,{ok:true,msg:'已重置'});
        }catch(e){jsonRes(res,{ok:false,error:e.message},500)}
        return;
      }

      // API: 模拟
      if (url.pathname==='/api/simulate'){
        try{
          const out=execSync('node "'+path.join(ROOT,'huami-steps.js')+'" --simulate',{cwd:ROOT,timeout:10000,encoding:'utf8'});
          jsonRes(res,{ok:true,msg:out.trim()});
        }catch(e){jsonRes(res,{ok:false,error:e.message},500)}
        return;
      }

      // API: 日志
      if (url.pathname==='/api/log'){
        const logPath=path.join(ROOT,'huami-steps.log');
        let log='暂无日志';
        if(fs.existsSync(logPath)){
          const raw=fs.readFileSync(logPath,'utf-8');
          const lines=raw.split('\n').filter(l=>l.trim());
          log=lines.slice(-50).join('\n');
        }
        return jsonRes(res,{log});
      }

      // API: 历史
      if (url.pathname==='/api/history'){
        const {state}=getData();
        return jsonRes(res,{history:state.history||{}});
      }

      // API: 夜班切换
      if (url.pathname==='/api/nightshift'){
        const cfgPath=path.join(ROOT,'config.json');
        const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf-8'));
        cfg.realism.nightShift=cfg.realism.nightShift||{};
        cfg.realism.nightShift.enabled=!cfg.realism.nightShift.enabled;
        cfg.realism.nightShift.hourShift=cfg.realism.nightShift.hourShift||12;
        fs.writeFileSync(cfgPath,JSON.stringify(cfg,null,2));
        return jsonRes(res,{ok:true,enabled:cfg.realism.nightShift.enabled});
      }

      // API: 手动录入
      if (req.method==='POST' && url.pathname==='/api/manual'){
        const body=await readBody(req);
        const data=JSON.parse(body);
        const tmpPath=path.join(ROOT,'.manual-'+Date.now()+'.json');
        fs.writeFileSync(tmpPath,JSON.stringify(data));
        try{
          execSync('node "'+path.join(ROOT,'huami-steps.js')+'" --hourly '+tmpPath,{cwd:ROOT,timeout:10000,stdio:'pipe'});
          fs.unlinkSync(tmpPath);
          jsonRes(res,{ok:true,msg:'导入成功'});
        }catch(e){
          try{fs.unlinkSync(tmpPath)}catch(e2){}
          jsonRes(res,{error:e.message},500);
        }
        return;
      }

      // API: 上传
      if (req.method==='POST' && url.pathname==='/api/upload'){
        const body=await readBody(req);
        const ct=req.headers['content-type']||'';
        const boundary=ct.split('boundary=')[1];
        if(!boundary) return jsonRes(res,{error:'不支持的上传格式'},400);
        const parts=parseMultipart(body,boundary);
        const file=parts.file;
        if(!file) return jsonRes(res,{error:'未找到文件'},400);
        const tmpPath=path.join(ROOT,'.upload-tmp-'+Date.now()+'.json');
        fs.writeFileSync(tmpPath,file.data);
        try{
          if(file.filename.endsWith('.csv')){
            execSync('node "'+path.join(ROOT,'huami-steps.js')+'" --import '+tmpPath,{cwd:ROOT,timeout:10000,stdio:'pipe'});
          }else{
            execSync('node "'+path.join(ROOT,'huami-steps.js')+'" --hourly '+tmpPath,{cwd:ROOT,timeout:10000,stdio:'pipe'});
          }
          fs.unlinkSync(tmpPath);
          jsonRes(res,{ok:true,msg:'导入成功: '+file.filename});
        }catch(e){
          try{fs.unlinkSync(tmpPath)}catch(e2){}
          jsonRes(res,{error:e.message},500);
        }
        return;
      }

      // ========== 配置管理 ==========
      // 获取完整配置（密码脱敏）
      if (url.pathname==='/api/config'){
        const cfgPath=path.join(ROOT,'config.json');
        const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf-8'));
        // 密码脱敏
        const safe=JSON.parse(JSON.stringify(cfg));
        if(safe.accounts) safe.accounts=safe.accounts.map(a=>({...a,password:'••••••'+(a.password||'').slice(-4)}));
        return jsonRes(res,{ok:true,config:safe,presets:Object.keys(require('./config').PRESETS).map(k=>({key:k,desc:require('./config').PRESETS[k].desc})),currentPreset:cfg.realism?.preset||''});
      }

      // 保存配置
      if (req.method==='POST' && url.pathname==='/api/config'){
        const body=await readBody(req);
        const updates=JSON.parse(body);
        const cfgPath=path.join(ROOT,'config.json');
        const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf-8'));
        // 深度合并更新
        deepMerge(cfg,updates);
        fs.writeFileSync(cfgPath,JSON.stringify(cfg,null,2));
        return jsonRes(res,{ok:true,msg:'配置已保存'});
      }

      // 切换预设
      if (req.method==='POST' && url.pathname==='/api/preset'){
        const body=await readBody(req);
        const {preset}=JSON.parse(body);
        const {PRESETS,applyPreset}=require('./config');
        if(!PRESETS[preset]) return jsonRes(res,{error:'未知预设: '+preset},400);
        const cfgPath=path.join(ROOT,'config.json');
        const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf-8'));
        // 应用预设
        const p=PRESETS[preset].config;
        if(p.incrementRange) cfg.incrementRange=p.incrementRange;
        if(p.dailyMaxSteps) cfg.dailyMaxSteps=p.dailyMaxSteps;
        if(p.realism){
          cfg.realism=cfg.realism||{};
          if(p.realism.dailyMaxSteps) cfg.realism.dailyMaxSteps=p.realism.dailyMaxSteps;
          if(p.realism.weekendHourShift!=null) cfg.realism.weekendHourShift=p.realism.weekendHourShift;
          if(p.realism.weekendMultiplier!=null) cfg.realism.weekendMultiplier=p.realism.weekendMultiplier;
          if(p.realism.burstMultiplier) cfg.realism.burstMultiplier=p.realism.burstMultiplier;
          if(p.realism.walkEvent) cfg.realism.walkEvent=p.realism.walkEvent;
          if(p.realism.timeProfile) cfg.realism.timeProfile=p.realism.timeProfile;
        }
        cfg.realism.preset=preset;
        fs.writeFileSync(cfgPath,JSON.stringify(cfg,null,2));
        return jsonRes(res,{ok:true,msg:'已切换至: '+PRESETS[preset].desc,preset});
      }

      // ========== 账号管理 ==========
      if (url.pathname==='/api/accounts'){
        const cfgPath=path.join(ROOT,'config.json');
        const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf-8'));
        if(req.method==='GET'){
          const list=(cfg.accounts||[]).map(a=>({account:a.account,profile:a.profile||'—',password:'••••••'+(a.password||'').slice(-4)}));
          return jsonRes(res,{ok:true,accounts:list});
        }
        if(req.method==='POST'){
          const body=await readBody(req);
          const {action,account,password,profile}=JSON.parse(body);
          if(action==='add'){
            if(!account||!password) return jsonRes(res,{error:'账号和密码不能为空'},400);
            cfg.accounts=cfg.accounts||[];
            // 检查重复
            if(cfg.accounts.find(a=>a.account===account)) return jsonRes(res,{error:'账号已存在'},400);
            cfg.accounts.push({account,password,profile:profile||null});
            fs.writeFileSync(cfgPath,JSON.stringify(cfg,null,2));
            return jsonRes(res,{ok:true,msg:'账号已添加'});
          }
          if(action==='remove'){
            cfg.accounts=(cfg.accounts||[]).filter(a=>a.account!==account);
            fs.writeFileSync(cfgPath,JSON.stringify(cfg,null,2));
            return jsonRes(res,{ok:true,msg:'账号已移除'});
          }
          return jsonRes(res,{error:'未知操作'},400);
        }
      }

      // 手动登录
      if (req.method==='POST' && url.pathname==='/api/login'){
        const body=await readBody(req);
        const {account}=JSON.parse(body);
        const cfgPath=path.join(ROOT,'config.json');
        const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf-8'));
        const acct=cfg.accounts.find(a=>a.account===account);
        if(!acct) return jsonRes(res,{error:'账号不存在'},404);
        try{
          const {loginHuami}=require('./api');
          const {loadState,saveState}=require('./state');
          const state=loadState();
          state.tokenCache=state.tokenCache||{};
          const token=await loginHuami(acct.account,acct.password);
          state.tokenCache[acct.account]={token,time:Date.now()};
          saveState(state);
          jsonRes(res,{ok:true,msg:'登录成功: '+token.userId});
        }catch(e){
          jsonRes(res,{error:'登录失败: '+e.message},500);
        }
        return;
      }

      res.writeHead(404);res.end('Not Found');
    }catch(e){
      jsonRes(res,{error:e.message},500);
    }
  });
  return server;
}

// 深度合并工具
function deepMerge(target,source){
  for(const key of Object.keys(source)){
    if(source[key]&&typeof source[key]==='object'&&!Array.isArray(source[key])&&typeof target[key]==='object'&&!Array.isArray(target[key])){
      deepMerge(target[key],source[key]);
    }else{
      target[key]=source[key];
    }
  }
}

function startDashboard(port=PORT){
  const server=createServer();
  server.listen(port,()=>{
    console.log('\n📊 控制台已启动: http://localhost:'+port);
    console.log('   按 Ctrl+C 停止\n');
  });
  return server;
}

module.exports={startDashboard};
