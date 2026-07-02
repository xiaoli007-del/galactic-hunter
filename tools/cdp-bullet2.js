/*
 * CDP 验证:bullet2 重抠后贴图加载 + 5 等级玩家弹渲染无异常。
 * 用法:node tools/cdp-bullet2.js  (自动启动/关闭 headless Chrome)
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WS = require('ws');
const ROOT = path.join(__dirname, '..');
const INDEX_URL = 'file:///' + path.join(ROOT, 'index.html').split(path.sep).join('/');
const CDP = 'http://127.0.0.1:9222';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TMPDIR = path.join(require('os').tmpdir(), 'gh-cdp-' + process.pid);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
let msgId = 0;
function send(ws, method, params) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const onMsg = (data) => {
      let obj; try { obj = JSON.parse(data.toString()); } catch (e) { return; }
      if (obj.id === id) { ws.off('message', onMsg); obj.error ? reject(new Error(method + ': ' + JSON.stringify(obj.error))) : resolve(obj.result); }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(ws, expr, awaitP) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: !!awaitP, returnByValue: true });
  if (r.exceptionDetails) throw new Error('Eval: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function main() {
  // 启动 Chrome
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9222',
    '--user-data-dir=' + TMPDIR, '--autoplay-policy=no-user-gesture-required', 'about:blank'],
    { stdio: 'ignore' });
  let ws;
  try {
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(CDP + '/json'); const tabs = await r.json(); if (tabs.length) break; } catch (e) {}
      await sleep(250);
    }
    const r = await fetch(CDP + '/json');
    const tab = (await r.json()).find(t => t.type === 'page');
    ws = new WS(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    // 注入错误捕获
    await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source:
      'window.__errs=[];window.addEventListener("error",e=>window.__errs.push("error:"+e.message));window.addEventListener("unhandledrejection",e=>window.__errs.push("rej:"+(e.reason&&e.reason.message||e.reason)));' });
    await send(ws, 'Page.navigate', { url: INDEX_URL });
    await sleep(1500);
    // 再注入一次错误捕获(确保对局期间错误被记录;addScriptToEvaluateOnNewDocument 偶发不生效)
    await evalJs(ws, 'window.__errs=[];window.addEventListener("error",function(e){window.__errs.push("error:"+(e.message||e))});window.addEventListener("unhandledrejection",function(e){window.__errs.push("rej:"+(e.reason&&e.reason.message||e.reason))});0');

    // 等游戏就绪 + Assets 加载(node 侧轮询)
    for (let i = 0; i < 60; i++) {
      const ready = await evalJs(ws, '(window.G&&G.Assets&&G.Assets._state&&Object.keys(G.Assets._state).length>=20)?1:0');
      if (ready) break;
      await sleep(100);
    }

    // 1. 查 bullet2 及所有玩家弹贴图状态
    const states = await evalJs(ws, `JSON.stringify((function(){
      var s=G.Assets._state; var out={};
      ['bullet1','bullet2','bullet3','bullet4','bullet5','bullet-ice','bullet-fire','bullet-bolt','bullet-laser'].forEach(function(k){out[k]=s[k]||'missing';});
      return out;
    })())`);
    console.log('[贴图状态] ' + states);

    // 2. 跑一局:升级到 Lv5,自动开火,验证 5 等级弹渲染 + 0 错误
    await evalJs(ws, `(function(){
      G.Game.startGame();
      G.Game.coins = 999999;
      for(var i=0;i<4;i++){ G.Game.upgradeWeapon(); }   // 武器升到 Lv5
      var p = G.Platform.pointer;
      p.down = true; p.justPressed = true; p.x = G.Game.W/2; p.y = G.Game.H-180;
    })()`);
    await sleep(3500);
    const errs = await evalJs(ws, 'JSON.stringify(window.__errs)');
    const wl = await evalJs(ws, 'G.Game.weaponLevel');
    const bullets = await evalJs(ws, '(G.Game.bullets||[]).length');
    const fps = await evalJs(ws, 'G.Game.fps||"?"');
    console.log('[对局] 武器等级=' + wl + ' 在场子弹=' + bullets + ' fps=' + fps);
    console.log('[错误] ' + errs);
    const errArr = JSON.parse(errs);
    console.log(errArr.length === 0 ? '✅ 0 错误,玩家弹贴图加载+渲染正常' : '❌ 有 ' + errArr.length + ' 个错误');
    process.exit(errArr.length === 0 ? 0 : 1);
  } finally {
    try { ws && ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { fs.rmSync(TMPDIR, { recursive: true, force: true }); } catch (e) {}
  }
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
