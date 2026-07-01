// v0.13.1 验证:expand 弹(震荡波/冲击波)减速后不出界,靠 1.3s 寿命回收,防糊屏堆积。
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
  const result = await ev('(function(){' +
    'var G=window.G, Game=G.Game; Game.startGame();' +
    'var mn=new G.Entities.Alien("t12",360,400); Game.aliens.push(mn);' +
    'var errs=window.__errs||[]; var samples=[];' +
    'for(var f=0;f<200;f++){ mn.update(0.05); Game.updateEntities(0.05); Game.cleanup();' +
    '  if(f%40===0) samples.push({t:(f*0.05).toFixed(1)+"s", eb:Game.enemyBullets.length, expand:Game.enemyBullets.filter(function(b){return b.expand;}).length}); }' +
    'return { errs:errs.length, finalEb:Game.enemyBullets.length, samples:samples }; })()');
  console.log('[expand-test]', JSON.stringify(result, null, 2));
  if (result.errs > 0) { console.log('FAIL: 运行时错误 ' + result.errs); process.exit(1); }
  if (result.finalEb > 5) { console.log('FAIL: expand 弹堆积 ' + result.finalEb + ' 发(糊屏)'); process.exit(1); }
  console.log('PASS: expand 弹正常回收无堆积(最终 ' + result.finalEb + ' 发)');
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
