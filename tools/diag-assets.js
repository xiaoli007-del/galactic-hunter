/* 诊断游戏运行时贴图加载状态(不读图识别,只查 Assets._state 数值) */
const path = require('path');
const WS = require('ws');
const HTTP = (typeof fetch !== 'undefined') ? fetch : require('node-fetch');
const INDEX_URL = 'file:///' + path.join(__dirname, '..', 'index.html').split(path.sep).join('/');
const CDP = 'http://127.0.0.1:9222';
async function findTab(){ const r = await HTTP(CDP+'/json'); const t = await r.json(); return t.find(x=>x.type==='page')||t[0]; }
let mid=0;
function send(ws,m,p){ const id=++mid; return new Promise((res,rej)=>{ const h=d=>{let o;try{o=JSON.parse(d.toString?d.toString():d)}catch(e){return} if(o.id===id){ws.off('message',h);o.error?rej(new Error(m+':'+JSON.stringify(o.error))):res(o.result)}};ws.on('message',h);ws.send(JSON.stringify({id,method:m,params:p})); }); }
async function evalJs(ws,expr,ap){ const r=await send(ws,'Runtime.evaluate',{expression:expr,awaitPromise:!!ap,returnByValue:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
(async()=>{
  const ws=new WS((await findTab()).webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.on('open',res);ws.on('error',rej);});
  await send(ws,'Runtime.enable'); await send(ws,'Page.enable');
  await send(ws,'Page.navigate',{url:INDEX_URL});
  await new Promise(r=>setTimeout(r,2000));
  const st = await evalJs(ws, `JSON.stringify({
    state: G.Assets._state,
    ready: G.Assets.LIST.map(k=>({k, ok: !!(G.Assets.get(k))})),
    location: location.href,
    errs: window.__errs||[]
  })`);
  console.log(st);
  await ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
