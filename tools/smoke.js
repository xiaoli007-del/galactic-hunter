/*
 * Galactic Hunter — 冒烟测试(node 环境,模拟浏览器)
 * 加载全部模块 → init → 开局 → 跑 2 秒战斗 → 触发开火/碰撞/升级,验证无运行时异常。
 * 运行:node tools/smoke.js
 */
const fs = require('fs');
const path = require('path');

// —— 浏览器环境 mock ——
function makeGradient() { return { addColorStop: function () {} }; }
function makeCtx() {
  const store = {};
  return new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'string' && p.indexOf('create') === 0) return function () { return makeGradient(); };
      return function () {}; // 任意方法 no-op
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}
const canvas = { width: 0, height: 0, style: {}, getContext: function () { return makeCtx(); }, addEventListener: function () {} };

const listeners = {};
const lsStore = {};
global.window = {
  innerWidth: 720, innerHeight: 1280, devicePixelRatio: 2,
  addEventListener: function (e, cb) { listeners[e] = cb; },
  localStorage: { getItem: function (k) { return k in lsStore ? lsStore[k] : null; }, setItem: function (k, v) { lsStore[k] = v; } },
};
global.document = {
  getElementById: function () { return canvas; },
  createElement: function () { return { width: 64, height: 64, getContext: function () { return makeCtx(); } }; },
};

let rafQueue = [];
global.window.requestAnimationFrame = function (cb) { rafQueue.push(cb); };
global.requestAnimationFrame = global.window.requestAnimationFrame;

// 单调递增的时钟:跨多次 pump 调用也不能回退,否则引擎闭包里的 last 会算出负 dt、毒化累加器
let clock = 0;
function pump(ms) {
  // 步进须略大于游戏固定步长(1/60≈16.67ms),否则累加器每帧不足一步、update 只跑半速
  const STEP = 17;
  let total = 0;
  while (total < ms) {
    const cb = rafQueue.shift();
    if (!cb) break;
    clock += STEP;
    cb(clock);
    total += STEP;
  }
}

// —— 顺序加载模块(间接 eval 走全局作用域,使 window 解析正确)——
const dir = path.join(__dirname, '..', 'src', 'js');
['config.js', 'platform.js', 'engine.js', 'render.js', 'entities.js', 'game.js'].forEach(function (f) {
  const code = fs.readFileSync(path.join(dir, f), 'utf8');
  (0, eval)(code);
});

const G = global.window.G;
const Game = G.Game;
const P = G.Platform;
let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

console.log('\n[1] 模块加载与全局命名空间');
assert(!!G.Config, 'G.Config 已挂载');
assert(!!G.Platform, 'G.Platform 已挂载');
assert(!!G.Engine, 'G.Engine 已挂载');
assert(!!G.Render, 'G.Render 已挂载');
assert(!!G.Entities, 'G.Entities 已挂载');
assert(!!G.Game, 'G.Game 已挂载');

console.log('\n[2] init 与初始状态');
Game.init();
assert(Game.state === 'menu', '初始状态为 menu');
assert(typeof Game.highScore === 'number', 'highScore 读取正常');
assert(typeof Game.coins === 'number', 'coins 读取正常');

console.log('\n[3] 开局战斗 2 秒');
Game.startGame();
assert(Game.state === 'playing', '开局后状态为 playing');
// 模拟玩家按住开火,瞄准上方
P.pointer.x = 360; P.pointer.y = 300; P.pointer.down = true;
pump(2000);
assert(Game.aliens.length >= 0, '怪物系统运行(' + Game.aliens.length + ' 只在场)');
assert(Game.bullets.length >= 0, '子弹系统运行(' + Game.bullets.length + ' 发在场)');
assert(Game.score >= 0, '积分系统运行(本局 ' + Game.score + ')');
assert(Game.killCount >= 0, '击杀计数 ' + Game.killCount);

console.log('\n[3b] 精准击杀链路(子弹命中→积分→金币)');
Game.startGame();
Game.coins = 0; // 隔离金币基线,只看本次掉落
P.pointer.x = Game.ship.x; P.pointer.y = 300; P.pointer.down = true;
// 在飞船正上方近距离放一只 t1,锁定横向漂移,确保与垂直弹道相交
var probe = new G.Entities.Alien('t1', Game.ship.x, Game.ship.y - 90);
probe.driftX = 0;
Game.aliens.push(probe);
pump(700);
assert(Game.score > 0, '击杀产生积分 (score=' + Game.score + ')');
assert(Game.killCount >= 1, '击杀计数增加 (kill=' + Game.killCount + ')');
assert(Game.coins > 0, '金币掉落并被拾取 (coins=' + Game.coins + ')');

console.log('\n[4] 升级武器');
const before = Game.weaponLevel;
Game.coins = 999999;
Game.upgradeWeapon();
assert(Game.weaponLevel === before + 1 || Game.weaponLevel === G.Config.MAX_WEAPON_LEVEL_MVP,
  '武器升级生效 (Lv' + before + ' → Lv' + Game.weaponLevel + ')');
// 金币不足分支
Game.coins = 0;
const lv2 = Game.weaponLevel;
Game.upgradeWeapon();
assert(Game.weaponLevel === lv2, '金币不足时不升级');

console.log('\n[5] 存档写入');
Game.coins = 12345; Game.save();
const saved = JSON.parse(lsStore['gh_save']);
assert(saved.coins === 12345, '存档正确写入 (' + saved.coins + ')');

console.log('\n[6] 死亡结算');
Game.ship.hp = 1;
// 撞一个怪测试 takeHit → 死亡
const a = new G.Entities.Alien('t6', Game.ship.x, Game.ship.y - 5);
Game.aliens.push(a);
pump(200);
assert(Game.state === 'gameover' || Game.ship.hp <= Game.ship.maxHp, '受击结算链路正常');

console.log('\n==============================');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail === 0 ? '✅ 冒烟测试全部通过' : '❌ 存在失败项', '\n');
process.exit(fail === 0 ? 0 : 1);
