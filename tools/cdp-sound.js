/*
 * CDP 验证:v0.14 音效升级——真 AudioContext 下开火/击杀/受击/各技能命中音不抛异常。
 * 用法:node tools/cdp-sound.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WS = require('ws');
const ROOT = path.join(__dirname, '..');
const INDEX_URL = 'file:///' + path.join(ROOT, 'index.html').split(path.sep).join('/');
const CDP = 'http://127.0.0.1:9222';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TMPDIR = path.join(require('os').tmpdir(), 'gh-snd-' + process.pid);

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
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9222',
    '--user-data-dir=' + TMPDIR, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
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
    await send(ws, 'Page.navigate', { url: INDEX_URL });
    await sleep(1500);
    await evalJs(ws, 'window.__errs=[];window.addEventListener("error",function(e){window.__errs.push("error:"+(e.message||e))});window.addEventListener("unhandledrejection",function(e){window.__errs.push("rej:"+(e.reason&&e.reason.message||e.reason))});0');
    for (let i = 0; i < 60; i++) {
      const ready = await evalJs(ws, '(window.G&&G.Assets&&G.Assets._state&&Object.keys(G.Assets._state).length>=20)?1:0');
      if (ready) break;
      await sleep(100);
    }

    // 跑一局:升满级 + 自动开火 + 逐个切技能弹,让各技能命中音都触发
    await evalJs(ws, `(function(){
      G.Game.startGame();
      G.Game.coins = 999999;
      for(var i=0;i<4;i++) G.Game.upgradeWeapon();
      var p = G.Platform.pointer;
      p.down = true; p.x = G.Game.W/2; p.y = G.Game.H-180;
    })()`);
    await sleep(1500);
    // 逐个切技能(直接设 activeSkill),让命中触发各技能音
    var skills = ['ice', 'fire', 'bolt', 'laser', 'multi2'];
    for (var s of skills) {
      await evalJs(ws, 'G.Game.activeSkill="' + s + '"');
      await sleep(900);
    }
    await evalJs(ws, 'G.Game.activeSkill=null');  // 回普通弹
    await sleep(800);

    const errs = await evalJs(ws, 'JSON.stringify(window.__errs)');
    const kills = await evalJs(ws, 'G.Game.killCount');
    const fps = await evalJs(ws, 'G.Game.fps||"?"');
    console.log('[对局] 击杀=' + kills + ' fps=' + fps);
    // 检查音频上下文是否真创建(说明音效确实在尝试播放)
    const audioOn = await evalJs(ws, 'G.Platform.audio._ctx?1:0');
    console.log('[AudioContext] ' + (audioOn ? '已创建(音效在播放)' : '未创建'));
    const errArr = JSON.parse(errs);
    console.log('[错误] ' + (errArr.length === 0 ? '0' : JSON.stringify(errArr)));
    console.log(errArr.length === 0 && audioOn ? '✅ 音效系统真浏览器运行无异常,AudioContext 正常' : '❌ 有问题');
    process.exit((errArr.length === 0 && audioOn) ? 0 : 1);
  } finally {
    try { ws && ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { fs.rmSync(TMPDIR, { recursive: true, force: true }); } catch (e) {}
  }
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
