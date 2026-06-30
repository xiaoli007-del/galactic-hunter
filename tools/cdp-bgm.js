/*
 * Galactic Hunter — CDP BGM 专项验证(v0.10.9)
 *
 * 独立导航到 fresh 页面,验证多首 BGM 切换完整时序(不与其他验证共享 _bgmEl/__audioEls 状态)。
 * 用 Page.addScriptToEvaluateOnNewDocument 在导航前注入 Audio 拦截,捕获元素创建/换源/播放。
 *
 * 用法:
 *   1) headless Chrome 开 9222(加 --autoplay-policy=no-user-gesture-required):
 *      "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu \
 *        --remote-debugging-port=9222 --autoplay-policy=no-user-gesture-required --user-data-dir=<tmp>
 *   2) node tools/cdp-bgm.js
 */
const WS = require('ws');
const ROOT = require('path').join(__dirname, '..');
const INDEX_URL = 'file:///' + ROOT.split(require('path').sep).join('/') + '/index.html';
const CDP = 'http://127.0.0.1:9222';
let msgId = 0;
function send(ws, m, p) { const id = ++msgId; return new Promise((res, rej) => { const on = (d) => { let o; try { o = JSON.parse(d.toString()); } catch (e) { return; } if (o.id === id) { ws.off('message', on); o.error ? rej(new Error(m + ': ' + JSON.stringify(o.error))) : res(o.result); } }; ws.on('message', on); ws.send(JSON.stringify({ id, method: m, params: p })); }); }
async function evalJs(ws, expr) { const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true }); if (r.exceptionDetails) throw new Error('Eval: ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text).slice(0, 300)); return r.result.value; }
function log(msg) { console.log('[bgm] ' + msg); }

const INJECT = `
  var _A = window.Audio;
  window.__audioEls = [];
  window.Audio = function(src){
    var el = new _A(src);
    el.__playCount = 0; el.__pauseCount = 0;
    var _play = el.play.bind(el);
    el.play = function(){ el.__playCount++; return _play(); };
    var _pause = el.pause.bind(el);
    el.pause = function(){ el.__pauseCount++; return _pause(); };
    window.__audioEls.push(el);
    return el;
  };
  window.Audio.prototype = _A.prototype;
`;

async function main() {
  const r = await fetch(CDP + '/json');
  const tab = (await r.json()).find(t => t.type === 'page') || (await r.json())[0];
  const ws = new WS(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  await send(ws, 'Page.enable', {});
  await send(ws, 'Runtime.enable', {});
  await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

  let pass = 0, fail = 0;
  function check(cond, msg) { if (cond) { pass++; log('  ✓ ' + msg); } else { fail++; log('  ✗ ' + msg); } }

  // 导航(清 localStorage 用页面内 eval,拦截已在 new document 注入)
  await send(ws, 'Page.navigate', { url: INDEX_URL });
  await new Promise(r => setTimeout(r, 1500));
  await evalJs(ws, "window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(e.message)});");

  // ① startGame → 建单元素 + play(loop/volume 正确)。首曲 idx 取决于 localStorage 残留,记录实际首曲。
  await evalJs(ws, `
    var Snd=window.G.Sound;
    localStorage.removeItem('gh_bgm');   // 清音乐开关(保 gh_bgm_track 以测沿用;首曲由残留定)
    Snd.init();
    Snd.bgmStart();
  `);
  await new Promise(r => setTimeout(r, 200));
  const s1 = JSON.parse(await evalJs(ws, `
    var e0=window.__audioEls[0];
    JSON.stringify({els:window.__audioEls.length,isBgm1:e0&&e0.src.indexOf('bgm.mp3')>=0&&e0.src.indexOf('bgm2')<0,isBgm2:e0&&e0.src.indexOf('bgm2.mp3')>=0,plays0:e0&&e0.__playCount,loop:e0&&e0.loop,vol:e0&&e0.volume});
  `));
  log('startGame: ' + JSON.stringify(s1));
  check(s1.els === 1, '建单元素 (els=' + s1.els + ')');
  check(s1.isBgm1 || s1.isBgm2, '载入某首曲目(bgm1 或 bgm2)');
  check(s1.loop === true, 'loop=true');
  check(s1.vol === 0.35, 'volume=0.35');
  check(s1.plays0 >= 1, 'play 被调用 (plays=' + s1.plays0 + ')');
  var firstIsBgm2 = !!s1.isBgm2;   // 记录首曲是否 bgm2,决定 bgmNext 后期望哪首

  // ② bgmNext → 换源到另一首 + 续播(play 计数增加)+ 持久化 + 仍单元素
  const beforeNext = s1.plays0;
  const s2 = JSON.parse(await evalJs(ws, `
    var Snd=window.G.Sound, e=window.__audioEls[0];
    var beforeSrc = e && e.src;
    Snd.bgmNext();
    JSON.stringify({srcChanged:(e&&e.src)!==beforeSrc,isBgm1:e&&e.src.indexOf('bgm.mp3')>=0&&e.src.indexOf('bgm2')<0,isBgm2:e&&e.src.indexOf('bgm2.mp3')>=0,plays2:e&&e.__playCount,els2:window.__audioEls.length,persisted:localStorage.getItem('gh_bgm_track'),name:Snd.bgmTrackName(),idx:Snd.bgmTrackIdx()});
  `));
  log('bgmNext: ' + JSON.stringify(s2));
  check(s2.srcChanged === true, 'bgmNext 换源(src 变化)');
  check(firstIsBgm2 ? s2.isBgm1 === true : s2.isBgm2 === true, '切到另一首(' + (firstIsBgm2 ? 'bgm1' : 'bgm2') + ')');
  check(s2.plays2 > beforeNext, '续播 play 计数增加 (' + beforeNext + '→' + s2.plays2 + ')');
  check(s2.els2 === 1, '仍单元素复用 (els=' + s2.els2 + ')');
  check(s2.persisted === String(s2.idx), "持久化 gh_bgm_track 与 idx 一致 ('" + s2.persisted + "'===" + s2.idx + ')');

  // ③ bgmToggle 关→pause、开→play,源不变
  const s3 = JSON.parse(await evalJs(ws, `
    var Snd=window.G.Sound, e=window.__audioEls[0];
    var srcBefore=e&&e.src;
    Snd.bgmToggle(); var pausedOff=e&&e.paused;
    Snd.bgmToggle();
    JSON.stringify({pausedOff:pausedOff,plays3:e&&e.__playCount,srcUnchanged:(e&&e.src)===srcBefore});
  `));
  log('toggle: ' + JSON.stringify(s3));
  check(s3.pausedOff === true, '关→pause');
  check(s3.plays3 > s2.plays2, '开→play 计数增加');
  check(s3.srcUnchanged === true, '开关不改变当前曲目');

  // ④ 重载页面 → 沿用持久化曲目(首曲源与重载前 idx 一致)
  const idxBefore = s2.idx;
  await send(ws, 'Page.navigate', { url: INDEX_URL });
  await new Promise(r => setTimeout(r, 1500));
  await evalJs(ws, "window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(e.message)});");
  await evalJs(ws, 'var Snd=window.G.Sound; Snd.init(); Snd.bgmStart();');
  await new Promise(r => setTimeout(r, 200));
  const s4 = JSON.parse(await evalJs(ws, `
    var e=window.__audioEls[0];
    JSON.stringify({idx:window.G.Sound.bgmTrackIdx(),isBgm1:e&&e.src.indexOf('bgm.mp3')>=0&&e.src.indexOf('bgm2')<0,isBgm2:e&&e.src.indexOf('bgm2.mp3')>=0});
  `));
  log('reload: ' + JSON.stringify(s4));
  check(s4.idx === idxBefore, '重载沿用持久化 idx (' + idxBefore + '→' + s4.idx + ')');
  check(idxBefore === 0 ? s4.isBgm1 === true : s4.isBgm2 === true, '重载首曲源匹配 idx');

  const errs = JSON.parse(await evalJs(ws, 'JSON.stringify(window.__errs)'));
  check(errs.length === 0, '0 运行错误' + (errs.length ? ': ' + errs.slice(0, 2).join(';') : ''));

  await ws.close();
  log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[bgm] 致命错误: ' + e.message); process.exit(2); });
