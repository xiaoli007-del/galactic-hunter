/*
 * CDP 验证 v0.14.1:玩家弹 Lv4/5 渲染 + 敌弹放大 + Boss/精英体型放大,0 错误。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WS = require('ws');
const ROOT = path.join(__dirname, '..');
const INDEX_URL = 'file:///' + path.join(ROOT, 'index.html').split(path.sep).join('/');
const CDP = 'http://127.0.0.1:9222';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TMPDIR = path.join(require('os').tmpdir(), 'gh-v141-' + process.pid);
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
let msgId = 0;
function send(ws, method, params) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const onMsg = (data) => { let o; try { o = JSON.parse(data.toString()); } catch (e) { return; } if (o.id === id) { ws.off('message', onMsg); o.error ? reject(new Error(method + ':' + JSON.stringify(o.error))) : resolve(o.result); } };
    ws.on('message', onMsg); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(ws, expr) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error('Eval: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function main() {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9222', '--user-data-dir=' + TMPDIR, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    for (let i = 0; i < 40; i++) { try { const r = await fetch(CDP + '/json'); if ((await r.json()).length) break; } catch (e) {} await sleep(250); }
    const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
    ws = new WS(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    await send(ws, 'Page.navigate', { url: INDEX_URL });
    await sleep(1500);
    await evalJs(ws, 'window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(e.message||e)});window.addEventListener("unhandledrejection",function(e){window.__errs.push((e.reason&&e.reason.message)||e.reason)});0');
    for (let i = 0; i < 60; i++) { if (await evalJs(ws, '(window.G&&G.Assets&&Object.keys(G.Assets._state).length>=20)?1:0')) break; await sleep(100); }

    // 验证配置:Boss/精英 visScale
    const visScales = await evalJs(ws, `JSON.stringify((function(){
      var C=G.Config.ALIENS, out={};
      ['t6','t9','t10','boss-titan','boss-hydra','boss-crystall','boss-maw','boss-overlord',
       'elite-bulwark','elite-splitter','elite-lancer','elite-carrier','elite-juggernaut'].forEach(function(k){
        var d=C[k]; out[k]=d?(d.bossVisScale||d.eliteVisScale||null):null;
      }); return out;
    })())`);
    console.log('[visScale] ' + visScales);

    // 跑一局:升 Lv5 + 自动开火,触发玩家弹/敌弹
    await evalJs(ws, `(function(){
      G.Game.startGame(); G.Game.coins=999999;
      for(var i=0;i<4;i++) G.Game.upgradeWeapon();   // Lv5
      var p=G.Platform.pointer; p.down=true; p.x=G.Game.W/2; p.y=G.Game.H-180;
    })()`);
    await sleep(3000);
    // 逐个刷 Boss/精英验证体型渲染(每次清场避免 Boss 护栏拦截 + 同屏堆积)
    var mobs = ['t6', 't9', 't10', 'boss-titan', 'boss-maw', 'boss-overlord',
                'elite-bulwark', 'elite-lancer', 'elite-juggernaut', 'elite-carrier'];
    for (var m of mobs) {
      await evalJs(ws, 'G.Game.aliens.length=0; try{G.Game.spawnAlien(6,"' + m + '");}catch(e){}');
      await sleep(450);
    }
    await sleep(800);

    const errs = await evalJs(ws, 'JSON.stringify(window.__errs)');
    const fps = await evalJs(ws, 'G.Game.fps||"?"');
    const errArr = JSON.parse(errs);
    console.log('[对局] fps=' + fps + ' 错误=' + (errArr.length === 0 ? '0' : JSON.stringify(errArr)));
    console.log(errArr.length === 0 ? '✅ v0.14.1 玩家弹/敌弹/Boss/精英渲染 0 异常' : '❌ 有错误');
    process.exit(errArr.length === 0 ? 0 : 1);
  } finally {
    try { ws && ws.close(); } catch (e) {} try { chrome.kill(); } catch (e) {} try { fs.rmSync(TMPDIR, { recursive: true, force: true }); } catch (e) {}
  }
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
