/* 精修对比截图:左 ship1 原图 右 ship1_enhanced,并排渲染。产出 桌面/精修对比.png */
const fs = require('fs'); const path = require('path'); const WS = require('ws'); const HTTP = fetch;
const CDP = 'http://127.0.0.1:9222'; const OUT = path.join(process.env.USERPROFILE, 'Desktop', '精修对比.png');
async function findTab(){const r=await HTTP(CDP+'/json');const t=await r.json();return t.find(x=>x.type==='page')||t[0];}
let mid=0;function send(ws,m,p){const id=++mid;return new Promise((res,rej)=>{const h=d=>{let o;try{o=JSON.parse(d.toString?d.toString():d)}catch(e){return}if(o.id===id){ws.off('message',h);o.error?rej(new Error(m+':'+JSON.stringify(o.error))):res(o.result)}};ws.on('message',h);ws.send(JSON.stringify({id,method:m,params:p}));});}
async function ev(ws,expr,ap){const r=await send(ws,'Runtime.evaluate',{expression:expr,awaitPromise:!!ap,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
(async()=>{
  const ws=new WS((await findTab()).webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.on('open',r);ws.on('error',j);});
  await send(ws,'Runtime.enable'); await send(ws,'Page.enable');
  await send(ws,'Page.navigate',{url:'file:///C:/Users/xhxq1024/Desktop/GalacticHunter/index.html'});
  await new Promise(r=>setTimeout(r,1200));
  await ev(ws, `
    var c=document.getElementById('stage');var ctx=c.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#05060c';ctx.fillRect(0,0,c.width,c.height);
    ctx.textAlign='center';ctx.fillStyle='#ffd166';ctx.font='bold 36px Arial';
    ctx.fillText('左=原图  右=精修版',c.width/2,70);
    ctx.fillStyle='#8aa0b5';ctx.font='16px Arial';
    ctx.fillText('精修叠加:轮廓加深描边 + 金属高光带 + 铆钉点 + 装甲接缝阴影',c.width/2,100);
    function loadImg(url){return new Promise((res,rej)=>{var im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=url;});}
    (async()=>{
      var orig=await loadImg('src/assets/sprites/ship1.png');
      var enh=await loadImg('src/assets/sprites/ship1_enhanced.png');
      function draw(img,cx){var s=420/Math.max(img.width,img.height);var dw=img.width*s,dh=img.height*s;ctx.drawImage(img,cx-dw/2,470-dh/2,dw,dh);}
      draw(orig,c.width*0.28);draw(enh,c.width*0.72);
      ctx.fillStyle='#7df0c0';ctx.font='bold 22px Arial';
      ctx.fillText('原图',c.width*0.28,760);ctx.fillText('精修',c.width*0.72,760);
      return 'done';
    })();
  `, true);
  const shot=await send(ws,'Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(OUT,Buffer.from(shot.data,'base64'));
  console.log('已保存 '+OUT);
  await ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
