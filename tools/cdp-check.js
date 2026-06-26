/*
 * Galactic Hunter — v0.8 CDP 真浏览器验证
 * node smoke 用 mock canvas 不校验色值,颜色管线类 bug 只有真 Canvas 才会抛(v0.6 曾因此崩)。
 * 本脚本:静态伺服 index.html → 无头 Chrome → CDP 注入 window.__errs(捕获 error/rejection/console.error)
 *        → 驱动 startGame + 升满三线 + 陈列 t1-t10 + 各工厂敌弹 → 跑 2.8s 真实对局 → 读回错误/fps。
 * 运行:node tools/cdp-check.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 8123;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDir = path.join(os.tmpdir(), 'gh-cdp-profile3');
const CDP_PORT = 9224;
const args = [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + CDP_PORT, '--remote-debugging-address=127.0.0.1',
  '--user-data-dir=' + profileDir,
  'http://127.0.0.1:' + PORT + '/index.html',
];

server.listen(PORT, '127.0.0.1', () => {
  console.log('SERVER_UP on ' + PORT);
  const cp = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  cp.stderr && cp.stderr.on('data', d => { if (/DevTools listening/.test(String(d))) console.log('CDP_LISTENING'); });
  let tries = 0;
  const poll = () => setTimeout(() => {
    fetch('http://127.0.0.1:' + CDP_PORT + '/json/list').then(r => r.json()).then(targets => {
      const page = targets.find(t => t.type === 'page');
      console.log('POLL#' + tries + ' targets=' + targets.length + ' page=' + (page ? 'YES' : 'no'));
      if (!page) { if (++tries < 40) return poll(); console.log('NO_PAGE_TARGET'); return cleanup(1); }
      drive(page.webSocketDebuggerUrl);
    }).catch(() => { if (++tries < 40) poll(); else { console.log('CDP_NOT_REACHABLE'); cleanup(1); } });
  }, 400);

  let ws, id = 0, pending = {};
  const drive = (url) => {
    console.log('WS_CONNECT');
    ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      console.log('WS_OPEN');
      send('Runtime.enable').then(() => {
        console.log('EVAL_SENT');
        const expr = "(function(){\
          window.__errs=[];\
          addEventListener('error',e=>window.__errs.push('error: '+(e&&e.message||e)));\
          addEventListener('unhandledrejection',e=>window.__errs.push('rejection: '+(e.reason&&(e.reason.message||e.reason))));\
          var ce=console.error.bind(console); console.error=function(){window.__errs.push('console.error: '+Array.from(arguments).map(String).join(' ')); ce.apply(console,arguments);};\
          try {\
            var Game=window.G.Game;\
            Game.startGame();\
            Game.coins=999999; for(var i=0;i<12;i++){Game.upgradeWeapon();Game.upgradeShip();Game.upgradeDefense();}\
            for(var t=1;t<=10;t++){Game.aliens.push(new G.Entities.Alien('t'+t, 80+t*60, 300));}\
            Game._fireRing(360,520,14,200,'#ff5c2a');\
            Game._fireAimedSpread(360,520,3,0.2,250,'#ffaa00');\
          } catch(e){ window.__errs.push('SETUP_THREW: '+(e&&e.message||e)); }\
          return new Promise(function(res){ setTimeout(function(){\
            res(JSON.stringify({errs:window.__errs, fps:Game.fps||0, state:Game.state, aliens:Game.aliens.length, ebullets:Game.enemyBullets.length, shipLv:Game.shipLevel, wepLv:Game.weaponLevel, defLv:Game.defenseLevel}));\
          }, 2800); });\
        })()";
        return send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      }).then(r => {
        const val = r && r.result && r.result.value;
        console.log('CDP_RESULT: ' + val);
        let hadErrs = true;
        try {
          const o = JSON.parse(val);
          hadErrs = !!(o.errs && o.errs.length);
          console.log('\n==== v0.8 真浏览器验证结论 ====');
          console.log('错误数: ' + (o.errs ? o.errs.length : 0));
          if (o.errs && o.errs.length) o.errs.forEach(e => console.log('  ✗ ' + e));
          console.log('FPS: ' + o.fps + '  状态: ' + o.state + '  怪在场: ' + o.aliens + '  敌弹: ' + o.ebullets);
          console.log('装备: 武Lv' + o.wepLv + ' 船Lv' + o.shipLv + ' 防Lv' + o.defLv);
          console.log(o.errs && o.errs.length === 0 ? '✅ 真浏览器 0 错误,颜色管线/渲染路径安全' : '❌ 真浏览器存在错误,需排查');
        } catch (e) { console.log('PARSE_FAIL: ' + e.message); }
        cleanup(hadErrs ? 1 : 0);
      });
    });
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (pending[m.id]) { pending[m.id](m.result); delete pending[m.id]; } });
    ws.addEventListener('error', () => { console.log('WS_ERROR'); cleanup(1); });
  };
  const send = (method, params) => new Promise(res => { const i = ++id; pending[i] = res; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const cleanup = (code) => { try { ws && ws.close(); } catch (e) {} try { cp.kill(); } catch (e) {} server.close(); process.exit(code); };
  poll();
});

setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 30000);
