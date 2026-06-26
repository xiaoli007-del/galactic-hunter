/*
 * Galactic Hunter — CDP 美术陈列截图(v0.9 机械装甲科幻重做)
 *
 * 生成两张对照图:飞船 Lv1-5 + 全 23 怪陈列 / 实机对局。
 * 用 headless Chrome CDP Page.captureScreenshot,纯 Node(依赖 ws,Node 24 内置 fetch)。
 *   1) 启动 headless Chrome 开 9222(见 cdp-verify.js 用法)
 *   2) node tools/cdp-gallery.js
 */
const fs = require('fs');
const path = require('path');
const WS = require('ws');

const ROOT = path.join(__dirname, '..');
const INDEX_URL = 'file:///' + path.join(ROOT, 'index.html').split(path.sep).join('/');
const CDP = 'http://127.0.0.1:9222';

function log(m) { console.log('[gal] ' + m); }

async function findTab() { const r = await fetch(CDP + '/json'); const t = await r.json(); return t.find(x => x.type === 'page') || t[0]; }
let msgId = 0;
function send(ws, method, params) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    const on = (d) => { let o; try { o = JSON.parse(d.toString()); } catch (e) { return; } if (o.id === id) { ws.off('message', on); o.error ? rej(new Error(method + ':' + JSON.stringify(o.error))) : res(o.result); } };
    ws.on('message', on); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(ws, expr, awaitP) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: !!awaitP, returnByValue: true });
  if (r.exceptionDetails) throw new Error('Eval: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function main() {
  log('connect...'); const tab = await findTab(); if (!tab) throw new Error('无可用页面(先启动 Chrome --remote-debugging-port=9222)');
  const ws = new WS(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  await send(ws, 'Runtime.enable'); await send(ws, 'Page.enable');
  log('nav ' + INDEX_URL); await send(ws, 'Page.navigate', { url: INDEX_URL }); await new Promise(r => setTimeout(r, 1500));
  await evalJs(ws, `window.__errs=[];window.addEventListener('error',e=>window.__errs.push(e.message||''));'injected'`);

  // 飞船 Lv1-5 横排 + 全 23 怪 5 列网格陈列
  await evalJs(ws, `
    var G=window.G,R=G.Render,C=G.Config,Game=G.Game;
    var c=document.getElementById('stage'),ctx=c.getContext('2d');
    ctx.fillStyle='#060814';ctx.fillRect(0,0,C.WIDTH,C.HEIGHT);
    // 背景星点(轻量,避免陈列空旷)
    ctx.fillStyle='rgba(207,228,255,0.5)';for(var i=0;i<80;i++){ctx.fillRect(Math.random()*C.WIDTH,Math.random()*C.HEIGHT,1.5,1.5);}
    Game.startGame();
    ctx.fillStyle='#cfe4ff';ctx.font='bold 20px sans-serif';ctx.textAlign='center';ctx.fillText('飞船 Lv1→5 模块化进化',360,40);
    for(var lv=1;lv<=5;lv++){Game.shipLevel=lv;Game._syncShipVisual();Game.ship.x=90+lv*120;Game.ship.y=120;Game.ship.hitFlash=0;R.ship(ctx,Game.ship);
      ctx.fillStyle='#7ec8e3';ctx.font='12px monospace';ctx.fillText('Lv'+lv,90+lv*120,175);}
    ctx.fillStyle='#cfe4ff';ctx.font='bold 20px sans-serif';ctx.fillText('外星怪物 23 种(普通15/精英5/Boss3)',360,215);
    var keys=Object.keys(C.ALIENS);
    var colW=132,rowH=140,startY=270;
    for(var i=0;i<keys.length;i++){
      var k=keys[i],def=C.ALIENS[k];
      var col=i%5,row=Math.floor(i/5);
      var x=70+col*colW, y=startY+row*rowH;
      var a=new G.Entities.Alien(k,x,y);a.angle=0;a.wob=0;a.hitFlash=0;
      R.alien(ctx,a);
      ctx.fillStyle=def.boss?'#ff5d8f':(def.tier>=5?'#ffd166':'#9fb4c8');ctx.font='11px monospace';ctx.textAlign='center';
      ctx.fillText(k+' '+def.name,x,y+def.radius+16);
    }
    'gallery drawn';
  `);
  const s1 = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'tools', 'v0.9-gallery.png'), Buffer.from(s1.data, 'base64'));
  log('saved tools/v0.9-gallery.png (' + Math.round(s1.data.length * 0.75 / 1024) + 'KB)');

  // 实机对局 3s
  await evalJs(ws, `
    var Game=window.G.Game,P=window.G.Platform;
    Game.startGame();Game.coins=50000;Game.upgradeShip();Game.upgradeShip();
    P.pointer.x=360;P.pointer.y=1100;P.pointer.down=true;P.pointer.justPressed=true;
    for(var i=0;i<180;i++){Game.update(0.016);Game.render(1);P.pointer.justPressed=false;}
    JSON.stringify({state:Game.state,kills:Game.killCount,score:Game.score,aliens:Game.aliens.length});
  `, true).then(s => log('对局3s: ' + s));
  const s2 = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'tools', 'v0.9-game.png'), Buffer.from(s2.data, 'base64'));
  log('saved tools/v0.9-game.png');

  const errs = await evalJs(ws, 'JSON.stringify(window.__errs)');
  log('捕获错误: ' + errs);
  await ws.close();
  process.exit(JSON.parse(errs).length === 0 ? 0 : 1);
}
main().catch(e => { console.error('[gal] fatal:', e.message); process.exit(2); });
