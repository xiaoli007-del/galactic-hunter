// v0.13.1 验证:Boss 不重叠——长跑一局,确认同屏永远 ≤1 个 Boss(硬护栏 + 随机池过滤)。
const WS = require('ws');
const path = require('path');
const CDP = 'http://127.0.0.1:9222';
const ROOT = path.join(__dirname, '..').split(path.sep).join('/');
const INDEX = 'file:///' + ROOT + '/index.html';

(async () => {
  const r = await fetch(CDP + '/json');
  const tab = (await r.json()).find(t => t.type === 'page');
  const ws = new WS(tab.webSocketDebuggerUrl);
  let id = 0;
  const send = (m, p) => new Promise((res, rej) => {
    const i = ++id;
    const h = d => { const o = JSON.parse(d); if (o.id === i) { ws.off('message', h); o.error ? rej(o.error) : res(o.result); } };
    ws.on('message', h); ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
  await new Promise(r => ws.on('open', r));
  await send('Page.navigate', { url: INDEX });
  await new Promise(r => setTimeout(r, 800));
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
  const result = await ev('(function(){try{' +
    'var G=window.G, C=G.Config, Game=G.Game, P=G.Platform;' +
    'Game.startGame();' +
    'Game.coins=999999; Game.weaponLevel=5; Game.shipLevel=5;' +
    'var errs=window.__errs||[]; var maxBoss=0, bossSamples=[];' +
    'P.pointer.x=C.WIDTH/2; P.pointer.y=C.SHIP.y-100; P.pointer.down=true;' +
    'for(var f=0;f<2400;f++){' +
    '  Game.update(0.025);' +
    '  var bc=Game.aliens.filter(function(a){return a.isBoss&&!a.dead;}).length;' +
    '  if(bc>maxBoss){ maxBoss=bc; bossSamples.push({t:(f*0.025).toFixed(1)+"s", bc:bc}); }' +
    '  if(Game.state!=="playing") break;' +
    '}' +
    'return { ok:true, errs:errs.length, maxBoss:maxBoss, samples:bossSamples, state:Game.state };' +
    '}catch(e){return {ok:false, err:e.message, stack:e.stack};}})()');
  console.log('[boss-test]', JSON.stringify(result, null, 2));
  if (result.errs > 0) { console.log('FAIL: 运行时错误 ' + result.errs); process.exit(1); }
  if (result.maxBoss > 1) { console.log('FAIL: 同屏出现 ' + result.maxBoss + ' 个 Boss(重叠)'); process.exit(1); }
  console.log('PASS: 60s 长跑同屏 Boss 始终 ≤1 (峰值 ' + result.maxBoss + ')');
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
