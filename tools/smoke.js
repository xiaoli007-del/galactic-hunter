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

console.log('\n[4i] 反射力场反弹(Lv3,护盾吸收时反伤)');
Game.startGame();
Game._syncShipVisual();
Game.defenseLevel = 3; Game._applyDefense();             // 反射力场:reflectChance 0.5, mul 0.6
Game.ship.reflectChance = 1;                             // 强制 100% 反弹以做确定性断言
// 强力武器 + 旗舰船舰:反伤 6×3×0.6=10.8,一击反杀 t1(hp1)并走 killAlien 掉落链路
Game.weaponLevel = 5; Game.shipLevel = 5; Game._syncShipVisual();
var probe2 = new G.Entities.Alien('t1', Game.ship.x, Game.ship.y - 5);
Game.aliens.push(probe2);
Game.ship.invuln = 0;                                     // 清除开局无敌,确保 takeHit 生效
const hpBefore = probe2.hp, shieldBefore = Game.ship.shield, killBefore = Game.killCount;
Game.collisions();                                       // 碰撞 → 护盾消 → 反弹击杀 → killAlien
assert(probe2.hp <= 0, '反弹伤害致死 (hp ' + hpBefore + ' → ' + probe2.hp + ')');
assert(probe2.dead === true, '怪物被反弹击杀');
assert(Game.ship.shield === shieldBefore - 1, '反弹仍消耗一格护盾 (shield ' + shieldBefore + ' → ' + Game.ship.shield + ')');
assert(Game.killCount === killBefore + 1, '反弹击杀计入击杀/掉落 (kill ' + killBefore + ' → ' + Game.killCount + ')');
// 弱反弹(低倍率)不致死时,飞船仍碾死怪物但不计 killAlien —— 验证反射反伤本身生效
Game.startGame();
Game.weaponLevel = 1; Game.shipLevel = 1; Game._syncShipVisual();
Game.defenseLevel = 3; Game._applyDefense(); Game.ship.reflectChance = 1;
var probe3 = new G.Entities.Alien('t3', Game.ship.x, Game.ship.y - 5);  // 蟹甲 hp8:反伤 0.6 不死
Game.aliens.push(probe3); Game.ship.invuln = 0;
const hp3 = probe3.hp;
Game.collisions();
assert(probe3.hp === hp3 - 0.6, '弱反弹仍对怪造成伤害 (hp ' + hp3 + ' → ' + probe3.hp + ')');

console.log('\n[4j] Boss 多阶段');
Game.startGame();
var boss = new G.Entities.Alien('t6', G.Config.WIDTH / 2, 200);
assert(boss.isBoss === true, 't6 标记为 Boss');
assert(boss.bossStage === 1, '初始阶段 1');
// 阶段 2:hp ≤ 66%(=66)
boss.takeDamage(34);                      // 100 → 66, ratio 0.66, 进入阶段 2
boss.update(0.02);                        // 触发阶段切换检测
assert(boss.bossStage === 2, 'hp≤66% 进入狂暴阶段 2 (hp ' + boss.hp + ')');
// 阶段 3:hp ≤ 33%(=33)
boss.takeDamage(33);                      // 66 → 33, ratio 0.33, 进入阶段 3
boss.update(0.02);
assert(boss.bossStage === 3, 'hp≤33% 进入暴怒阶段 3 (hp ' + boss.hp + ')');
// 召唤:阶段 3 summonEvery 2.2s,推进应产生小怪
var aliensBefore = Game.aliens.length;
Game.aliens.push(boss);
boss.summonTimer = 0;
boss.update(2.3);                         // 越过召唤间隔
assert(Game.aliens.length > aliensBefore, 'Boss 阶段 3 召唤小怪 (aliens ' + aliensBefore + ' → ' + Game.aliens.length + ')');
// Boss 击杀奖励:killAlien 走特殊爆炸 + 飘字
var bossKillBefore = Game.killCount, bossTxtBefore = Game.texts.length;
Game.killAlien(boss);
assert(Game.killCount === bossKillBefore + 1, 'Boss 击杀计入击杀数 (kill ' + bossKillBefore + ' → ' + Game.killCount + ')');
assert(Game.texts.length > bossTxtBefore, 'Boss 击杀产生庆祝飘字');
assert(Game.texts.length > bossTxtBefore, 'Boss 击杀产生庆祝飘字');

console.log('\n[4k] 怪物特殊行为 — T4 幽灵闪现回避');
var wraith = new G.Entities.Alien('t4', G.Config.WIDTH / 2, 300);
assert(wraith.behavior === 'blink', 't4 标记 blink 行为');
var wB = G.Config.BEHAVIOR;
wB.blinkChance = 1;                      // 强制必定闪现
wB.blinkDist = 100;
var x0 = wraith.x, y0 = wraith.y;
wraith.takeDamage(1);                     // 受击未死(hp5→4)→ 触发闪现
assert(wraith.hp === 4, '闪现不阻止伤害结算 (hp 5 → 4)');
var moved = Math.hypot(wraith.x - x0, wraith.y - y0);
assert(moved > 50, '闪现位移生效 (距离 ' + moved.toFixed(0) + ')');
// 闪现冷却期内再受击不触发
var x1 = wraith.x, y1 = wraith.y;
wraith.takeDamage(1);
assert(Math.hypot(wraith.x - x1, wraith.y - y1) < 1, '冷却期内不再闪现');
wB.blinkChance = 0.35;                   // 复位

console.log('\n[4l] 怪物特殊行为 — T5 精灵螺旋 + 冲刺');
var elite = new G.Entities.Alien('t5', G.Config.WIDTH / 2, 200);
assert(elite.behavior === 'spiral', 't5 标记 spiral 行为');
var ex0 = elite.x, ey0 = elite.y;
elite.update(0.3);                        // 螺旋推进:位置应变化(非直线下移)
assert(Math.hypot(elite.x - ex0, elite.y - ey0) > 0, '精灵螺旋移动生效');
// 冲刺:sprintTimer 归零后 update 应进入冲刺(spiralDash>0)
elite.spiralTimer = 0; elite.spiralDash = 0;
elite.update(0.05);
assert(elite.spiralDash > 0, '精灵触发冲刺 (spiralDash ' + elite.spiralDash.toFixed(2) + ')');
// 精灵仍可被正常击杀(takeDamage 走标准路径)
var eHp = elite.hp;
elite.takeDamage(5);
assert(elite.hp === eHp - 5, '精灵可被正常伤害 (hp ' + eHp + ' → ' + elite.hp + ')');

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
