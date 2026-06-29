/*
 * Galactic Hunter — CDP 真浏览器验证(v0.8)
 *
 * node smoke 的 mock canvas 不校验色值(addColorStop(NaN) 类 bug 会漏网,v0.6 教训)。
 * 本脚本用 headless Chrome + CDP 跑真实游戏,重点校验颜色管线 + 新内容(怪 t1-t10/敌弹/弹幕)。
 *
 * 用法:
 *   1) 启动 headless Chrome 开 9222:
 *      "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu \
 *        --remote-debugging-port=9222 --user-data-dir=<tmp>
 *   2) node tools/cdp-verify.js
 *
 * 依赖 ws 包(npm i ws)。Node 24 内置 fetch。
 */
const fs = require('fs');
const path = require('path');
const WS = require('ws');
const HTTP = (typeof fetch !== 'undefined') ? fetch : require('node-fetch');

const ROOT = path.join(__dirname, '..');
const INDEX_URL = 'file:///' + path.join(ROOT, 'index.html').split(path.sep).join('/');
const CDP = 'http://127.0.0.1:9222';

function log(msg) { console.log('[cdp] ' + msg); }

async function findTab() {
  const r = await HTTP(CDP + '/json');
  const tabs = await r.json();
  return tabs.find(t => t.type === 'page') || tabs[0];
}

let msgId = 0;
function send(ws, method, params) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const onMsg = (data) => {
      let obj;
      try { obj = JSON.parse(data.toString ? data.toString() : data); } catch (e) { return; }
      if (obj.id === id) {
        ws.off('message', onMsg);
        if (obj.error) reject(new Error(method + ': ' + JSON.stringify(obj.error)));
        else resolve(obj.result);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(ws, expr, awaitPromise) {
  const r = await send(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: !!awaitPromise,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error('Eval exception: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function main() {
  log('查找 CDP 页面...');
  const tab = await findTab();
  if (!tab) throw new Error('无可用页面');
  log('连接 ws: ' + tab.webSocketDebuggerUrl);
  const ws = new WS(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

  await send(ws, 'Runtime.enable');
  await send(ws, 'Page.enable');
  log('导航到 ' + INDEX_URL);
  await send(ws, 'Page.navigate', { url: INDEX_URL });
  await new Promise(r => setTimeout(r, 1200));   // 等加载 + init

  // 注入错误捕获(error/unhandledrejection/console.error → window.__errs)
  await evalJs(ws, `
    window.__errs = [];
    window.addEventListener('error', e => window.__errs.push('error: ' + (e.message||'') + ' @ ' + (e.filename||'')+':'+(e.lineno||'')));
    window.addEventListener('unhandledrejection', e => window.__errs.push('rejection: ' + (e.reason && e.reason.message || e.reason || '')));
    (function(){var oe=console.error;console.error=function(){window.__errs.push('console.error: '+Array.from(arguments).join(' '));oe.apply(console,arguments);};})();
    'injected';
  `);

  const ready = await evalJs(ws, `typeof window.G==='object' && !!window.G.Game && !!window.G.Entities.EnemyBullet`);
  if (!ready) { const e = await evalJs(ws, 'JSON.stringify(window.__errs)'); throw new Error('模块未就绪 errs=' + e); }
  log('模块就绪 ✓');

  // 1) 飞船 Lv1-5 渲染(校验金属渐变/驾驶舱/能量环等颜色管线不抛)
  await evalJs(ws, `
    var G=window.G, R=G.Render, Game=G.Game;
    var c=document.getElementById('stage'); var ctx=c.getContext('2d');
    Game.startGame();
    for (var lv=1; lv<=5; lv++){ Game.shipLevel=lv; Game._syncShipVisual(); Game.ship.hitFlash=lv===3?0.2:0; R.ship(ctx,Game.ship); }
    Game.shipLevel=1; Game._syncShipVisual();
    'ship Lv1-5 渲染完成';
  `);
  log('飞船 Lv1-5 渲染 ✓');

  // 2) 全怪 t1-t10(闪白/冰冻/灼烧;Boss 三阶段;t7 预警突进态/t8 蓄能态)
  await evalJs(ws, `
    var G=window.G, R=G.Render, C=G.Config;
    var c=document.getElementById('stage'); var ctx=c.getContext('2d');
    ['t1','t2','t3','t4','t5','t6','t7','t8','t9','t10','t11','t12','t13','t14','t15','t16','t17','t18','t19','t20','t21','t22','t23'].forEach(function(k){
      var a=new G.Entities.Alien(k, 360, 500);
      a.hitFlash=0.2; R.alien(ctx,a);
      a.slowTimer=1;a.slowMul=0.4;R.alien(ctx,a);
      a.burnTimer=1;a.burnDps=1;R.alien(ctx,a);
      if(a.isBoss){ for(var s=1;s<=3;s++){ a.bossStage=s; R.alien(ctx,a);} }
      if(k==='t7'){ a._dashTele=0.3;R.alien(ctx,a); a._dashTele=0;a._dashDur=0.5;R.alien(ctx,a);} // t7 预警/突进态
      if(k==='t8'){ a._aimArmed=true;a._aimAngle=Math.PI/2;R.alien(ctx,a);}                       // t8 蓄能态
      if(k==='t23'){ a._aimArmed=true;R.alien(ctx,a); }                                          // t23 环射要塞蓄能态
    });
    '怪 t1-t23 全状态渲染完成';
  `);
  log('怪 t1-t23 全状态渲染 ✓');

  // 3) 敌弹渲染 + aimed 生成
  await evalJs(ws, `
    var G=window.G, R=G.Render, C=G.Config, Game=G.Game;
    var c=document.getElementById('stage'); var ctx=c.getContext('2d');
    var eb=new G.Entities.EnemyBullet(360,500,0,100,'#ff5470');
    eb.update(0.02); eb.update(0.02); R.enemyBullet(ctx,eb);
    Game.startGame(); Game.enemyBullets.length=0;
    var g=new G.Entities.Alien('t8',360,200); Game.aliens.push(g);
    g._aimArmed=false; g.fireTimer=0.05; g.update(0.1);
    Game.enemyBullets.forEach(function(b){R.enemyBullet(ctx,b);});
    '敌弹渲染完成,aimed生成='+Game.enemyBullets.length;
  `);
  log('敌弹渲染 + aimed 生成 ✓');

  // 4) 真实对局 4s(主循环无异常,敌弹/弹幕/碰撞全链路)
  await evalJs(ws, `
    var Game=window.G.Game, P=window.G.Platform;
    Game.startGame();
    P.pointer.x=360; P.pointer.y=900; P.pointer.down=true; P.pointer.justPressed=true;
    var t0=Date.now();
    while(Date.now()-t0 < 4000){
      Game.update(0.016); Game.render(1);
      P.pointer.justPressed=false;
    }
    JSON.stringify({state:Game.state, aliens:Game.aliens.length, enemyBullets:Game.enemyBullets.length, kills:Game.killCount, score:Game.score, fps:Game.fps});
  `, true).then(s => log('对局 4s 结果: ' + s));

  // 5) t9/t10 弹幕(短时高分刷出)
  await evalJs(ws, `
    var Game=window.G.Game, C=window.G.Config;
    Game.startGame(); Game.coins=999999;
    var b9=new G.Entities.Alien('t9',C.WIDTH/2,300); Game.aliens.push(b9);
    var b10=new G.Entities.Alien('t10',C.WIDTH/2,500); Game.aliens.push(b10);
    b9.takeDamage(Math.ceil(b9.maxHp*0.7));
    b10.takeDamage(Math.ceil(b10.maxHp*0.4));
    for(var i=0;i<120;i++){ Game.update(0.016); Game.render(1); }
    JSON.stringify({eb:Game.enemyBullets.length, aliens:Game.aliens.length});
  `, true).then(s => log('t9/t10 弹幕 120 帧: ' + s));

  // 6) v0.10 副炮:各舰级副炮座渲染 + 自动开火生成副炮弹(校验新渲染/逻辑管线不抛)
  await evalJs(ws, `
    var G=window.G, R=G.Render, C=G.Config, Game=G.Game;
    var c=document.getElementById('stage'); var ctx=c.getContext('2d');
    Game.startGame();
    var cnt=0;
    for (var lv=1; lv<=5; lv++){
      Game.shipLevel=lv; Game._syncShipVisual();
      Game.ship.update(0.02); R.ship(ctx,Game.ship);      // 副炮座(_shipTurrets,Lv2-5)
      Game.bullets.length=0; Game._fireTurrets(1.0);       // 自动开火(Lv1 0,Lv2+ 生成)
      Game.bullets.forEach(function(b){ R.bullet(ctx,b); });// 副炮弹渲染(skill=null 路径)
      if(lv>=2) cnt += Game.bullets.length;
    }
    Game.shipLevel=1; Game._syncShipVisual();
    '副炮渲染完成,副炮弹数='+cnt;
  `).then(s => log('v0.10 副炮渲染: ' + s));

  await new Promise(r=>setTimeout(r,300));
  const errs = await evalJs(ws, 'JSON.stringify(window.__errs)');
  const errArr = JSON.parse(errs);
  log('捕获错误数: ' + errArr.length);
  errArr.forEach(e => console.log('  ✗ ' + e));

  const px = await evalJs(ws, `
    var c=document.getElementById('stage'); var ctx=c.getContext('2d');
    var d=ctx.getImageData(0,0,Math.min(c.width,720),Math.min(c.height,400)).data;
    var n=0; for(var i=3;i<d.length;i+=4){ if(d[i]>0) n++; } n;
  `);
  log('非空像素(α>0): ' + px);

  await ws.close();
  if (errArr.length === 0 && px > 1000) { log('✅ CDP 验证通过:0 错误、画面非空'); process.exit(0); }
  else { log('❌ CDP 验证失败'); process.exit(1); }
}

main().catch(e => { console.error('[cdp] 致命错误:', e.message); process.exit(2); });
