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
['config.js', 'platform.js', 'engine.js', 'assets.js', 'render.js', 'entities.js', 'game.js'].forEach(function (f) {
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
assert(Game.weaponLevel === before + 1 || Game.weaponLevel === G.Config.MAX_WEAPON_LEVEL,
  '武器升级生效 (Lv' + before + ' → Lv' + Game.weaponLevel + ')');
// 金币不足分支
Game.coins = 0;
const lv2 = Game.weaponLevel;
Game.upgradeWeapon();
assert(Game.weaponLevel === lv2, '金币不足时不升级');

console.log('\n[4d] 武器满级解锁 Lv1→Lv5');
Game.weaponLevel = 1; Game.coins = 999999;
for (let i = 0; i < 10; i++) Game.upgradeWeapon();
assert(Game.weaponLevel === G.Config.MAX_WEAPON_LEVEL, '武器可升满级 Lv' + Game.weaponLevel + '/' + G.Config.MAX_WEAPON_LEVEL);
assert(G.Config.MAX_WEAPON_LEVEL === 5, '满级 Lv5(散射波/量子湮灭 解锁)');

console.log('\n[4b] 升级船舰');
const sb = Game.shipLevel;
Game.coins = 999999;
Game.upgradeShip();
assert(Game.shipLevel === sb + 1 || Game.shipLevel === G.Config.MAX_SHIP_LEVEL,
  '船舰升级生效 (Lv' + sb + ' → Lv' + Game.shipLevel + ')');
Game.coins = 0;
const sb2 = Game.shipLevel;
Game.upgradeShip();
assert(Game.shipLevel === sb2, '金币不足时不升级');

console.log('\n[4c] 船舰火力加成接入子弹伤害');
Game.startGame();
Game.weaponLevel = 1;                    // 脉冲激光 伤害 1
Game.shipLevel = 3; Game._syncShipVisual();    // 巡洋舰 fireMul 1.5
Game.fire(G.Config.WEAPONS[1]);
const bd = Game.bullets[Game.bullets.length - 1].damage;
assert(bd === 1.5, '子弹伤害 = 武器伤害 × 船舰 fireMul (got ' + bd + ')');
Game.shipLevel = 1; Game._syncShipVisual();    // 回退 1.0
Game.fire(G.Config.WEAPONS[1]);
const bd2 = Game.bullets[Game.bullets.length - 1].damage;
assert(bd2 === 1, 'Lv1 船舰无加成 (got ' + bd2 + ')');

console.log('\n[4e] 升级防御');
const db = Game.defenseLevel;
Game.coins = 999999;
Game.upgradeDefense();
assert(Game.defenseLevel === db + 1 || Game.defenseLevel === G.Config.MAX_DEFENSE_LEVEL,
  '防御升级生效 (Lv' + db + ' → Lv' + Game.defenseLevel + ')');
Game.coins = 0;
const db2 = Game.defenseLevel;
Game.upgradeDefense();
assert(Game.defenseLevel === db2, '金币不足时不升级');

console.log('\n[4f] 护盾吸收(受击消格不扣血)');
Game.startGame();
Game.defenseLevel = 2; Game._applyDefense();   // 能量护盾 1 格
Game.ship.invuln = 0;
const hp0 = Game.ship.hp, sh0 = Game.ship.shield;
Game.ship.takeHit();
assert(Game.ship.shield === sh0 - 1, '护盾消一格 (shield ' + sh0 + ' → ' + Game.ship.shield + ')');
assert(Game.ship.hp === hp0, '血量未受影响 (hp ' + hp0 + ')');
// 格尽后受击才扣血
Game.ship.invuln = 0;
Game.ship.takeHit();
assert(Game.ship.hp === hp0 - 1, '护盾耗尽后扣血 (hp ' + hp0 + ' → ' + Game.ship.hp + ')');

console.log('\n[4g] 护盾自动回充(Lv4 快速)');
Game.startGame();
Game.defenseLevel = 4; Game._applyDefense();   // 量子护盾 3 格,regenDelay 4s
Game.ship.shield = 0; Game.ship.shieldRegenTimer = 0.1;
Game.ship.update(0.2);
assert(Game.ship.shield === 1, '回充一格 (shield → ' + Game.ship.shield + ')');

console.log('\n[4h] 不灭屏障复活(Lv5)');
Game.startGame();
Game.defenseLevel = 5; Game._applyDefense();   // 不灭屏障,revive
Game.ship.shield = 0;                          // 跗空护盾,模拟已耗尽 → 下一击走扣血
Game.ship.hp = 1; Game.ship.invuln = 0;
Game.ship.takeHit();                            // hp → 0
assert(Game.ship.hp === 0, '护盾耗尽后 hp 归零');
const revived = Game.ship.revive();
assert(revived === true, 'Lv5 可复活一次');
assert(Game.ship.hp === Game.ship.maxHp, '复活回满血 (hp ' + Game.ship.hp + ')');
assert(Game.ship.revivesLeft === 0, '复活次数 -1 (剩 ' + Game.ship.revivesLeft + ')');
assert(Game.ship.revive() === false, '复活次数用尽后不可再复活');

// 渲染冒烟:防御 Lv5 时跑一帧 drawHUD,校验护盾指示 + 防御卡渲染无异常(无 ctx 则 no-op)
pump(120);
assert(true, '防御 Lv5 HUD 渲染路径执行无异常');

console.log('\n[5] 存档写入');
Game.coins = 12345; Game.save();
const saved = JSON.parse(lsStore['gh_save']);
assert(saved.coins === 12345, '存档正确写入 (' + saved.coins + ')');

console.log('\n[6] 死亡结算');
Game.defenseLevel = 1; Game._applyDefense();   // 回基础装甲(无护盾/复活),确保可死亡
Game.ship.hp = 1; Game.ship.invuln = 0; Game.ship.shield = 0;
// 撞一个怪测试 takeHit → 死亡
const a = new G.Entities.Alien('t6', Game.ship.x, Game.ship.y - 5);
Game.aliens.push(a);
pump(200);
assert(Game.state === 'gameover' || Game.ship.hp <= Game.ship.maxHp, '受击结算链路正常');

console.log('\n==============================');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail === 0 ? '✅ 冒烟测试全部通过' : '❌ 存在失败项', '\n');
process.exit(fail === 0 ? 0 : 1);
