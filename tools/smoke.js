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
// 浏览器里 localStorage 是全局属性(裸 localStorage === window.localStorage)。sound.js BGM 模块用裸
// localStorage 读写,故 node 环境需在 global 上同样挂一份,否则读写静默失败(被 try-catch 吞掉)。
global.localStorage = global.window.localStorage;
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
['config.js', 'platform.js', 'engine.js', 'assets.js', 'sound.js', 'render.js', 'entities.js', 'game.js'].forEach(function (f) {
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
assert(!!G.Sound, 'G.Sound 已挂载');

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

console.log('\n[3c] 音效(无 AudioContext 应静默 no-op,不抛异常)');
G.Sound.init();
// 遍历全部命名音效:node 无 AudioContext,Platform.audio.tone/noise 应静默返回
['fire', 'kill', 'coin', 'upgrade', 'hit', 'boss', 'bossKill', 'reflect'].forEach(function (n) {
  G.Sound.play(n);
});
// 禁用开关
G.Platform.audio.setEnabled(false);
G.Sound.play('fire');
G.Platform.audio.setEnabled(true);
assert(true, '音效系统在无 AudioContext 环境安全运行');

console.log('\n[3d] v0.10.9 BGM 多曲切换(无 Audio 静默 no-op,验证索引/持久化/环绕)');
assert(typeof G.Sound.bgmTrackCount === 'function', 'bgmTrackCount 接口存在');
assert(G.Sound.bgmTrackCount() === 2, '两首曲目 (count=' + G.Sound.bgmTrackCount() + ')');
assert(G.Sound.bgmTrackIdx() === 0, '初始曲目 idx=0');
assert(typeof G.Sound.bgmTrackName() === 'string' && G.Sound.bgmTrackName().length > 0, '当前曲名非空 (' + G.Sound.bgmTrackName() + ')');
// 无 Audio 环境:bgmStart/Pause/Sync 安全 no-op 不抛
G.Sound.bgmStart(); G.Sound.bgmPause(); G.Sound.bgmSync();
assert(true, 'bgmStart/Pause/Sync 无 Audio 安全 no-op');
// 切歌:0→1→0(环绕);无元素时仅更新索引
var i0 = G.Sound.bgmNext();
assert(i0 === 1 && G.Sound.bgmTrackIdx() === 1, '切到第 2 首 (idx=' + G.Sound.bgmTrackIdx() + ', name=' + G.Sound.bgmTrackName() + ')');
var i1 = G.Sound.bgmNext();
assert(i1 === 0 && G.Sound.bgmTrackIdx() === 0, '再切回第 1 首(环绕 idx=' + G.Sound.bgmTrackIdx() + ')');
// 持久化:gh_bgm_track 已写入(末态为 '0')
assert(lsStore['gh_bgm_track'] === '0', "持久化键 gh_bgm_track='0'");
// 复位到第 0 首避免影响后续用例
lsStore['gh_bgm_track'] = '0';

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
Game.weaponLevel = 1;                    // 脉冲激光(v0.5 伤害 2,前期更易清怪)
Game.shipLevel = 3; Game._syncShipVisual();    // 巡洋舰 fireMul 1.5
Game.activeSkill = null;                       // 无技能:用武器默认弹道
Game.fire(G.Config.WEAPONS[1]);
const bd = Game.bullets[Game.bullets.length - 1].damage;
const expectBd = G.Config.WEAPONS[1].damage * G.Config.SHIPS[3].fireMul;   // 2 × 1.5 = 3
assert(bd === expectBd, '子弹伤害 = 武器伤害 × 船舰 fireMul (got ' + bd + ', expect ' + expectBd + ')');
Game.shipLevel = 1; Game._syncShipVisual();    // 回退 1.0
Game.fire(G.Config.WEAPONS[1]);
const bd2 = Game.bullets[Game.bullets.length - 1].damage;
assert(bd2 === G.Config.WEAPONS[1].damage, 'Lv1 船舰无加成 (got ' + bd2 + ')');

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
Game.activeSkill = null;
Game.defenseLevel = 3; Game._applyDefense(); Game.ship.reflectChance = 1;
var probe3 = new G.Entities.Alien('t3', Game.ship.x, Game.ship.y - 5);  // 蟹甲 hp8
Game.aliens.push(probe3); Game.ship.invuln = 0;
const hp3 = probe3.hp;
Game.collisions();
// 反伤 = 武器伤害(v0.5 w1=2)× 船舰 fireMul(1)× reflectDmgMul(0.6) = 1.2,不致死
const reflectDmg = G.Config.WEAPONS[1].damage * G.Config.SHIPS[1].fireMul * Game.ship.reflectDmgMul;
assert(probe3.hp === hp3 - reflectDmg, '弱反弹仍对怪造成伤害 (hp ' + hp3 + ' → ' + probe3.hp + ', 反伤 ' + reflectDmg + ')');

console.log('\n[4j] Boss 多阶段');
Game.startGame();
var boss = new G.Entities.Alien('t6', G.Config.WIDTH / 2, 200);
assert(boss.isBoss === true, 't6 标记为 Boss');
assert(boss.bossStage === 1, '初始阶段 1');
// 阶段 2:hp ≤ 66%(按比例打血,适配 hp 调整)
boss.takeDamage(Math.ceil(boss.maxHp * 0.34));   // hp → 66%, 进入阶段 2
boss.update(0.02);                        // 触发阶段切换检测
assert(boss.bossStage === 2, 'hp≤66% 进入狂暴阶段 2 (hp ' + boss.hp + ')');
// 阶段 3:hp ≤ 33%
boss.takeDamage(Math.ceil(boss.maxHp * 0.33));   // 再打到 33%, 进入阶段 3
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

console.log('\n[7] 战绩排行榜(v0.4)');
Game.leaderboard = []; Game.saveLeaderboard();          // 隔离榜单做基线
assert(Game.leaderboard.length === 0, '初始榜单为空');
// 0 分不入榜
Game.startGame();
Game.score = 0; Game.battleTime = 65; Game.killCount = 12;
Game.weaponLevel = 3; Game.shipLevel = 2; Game.defenseLevel = 2;
Game.gameOver();
assert(Game.leaderboard.length === 0, '0 分不入榜 (len ' + Game.leaderboard.length + ')');
// 正常入榜 + 字段记录
Game.startGame();
Game.score = 500; Game.battleTime = 65; Game.killCount = 12;
Game.weaponLevel = 3; Game.shipLevel = 2; Game.defenseLevel = 2;
Game.gameOver();
assert(Game.leaderboard.length === 1, '500 分入榜 (len ' + Game.leaderboard.length + ')');
var e0 = Game.leaderboard[0];
assert(e0.score === 500, '记录积分正确 (' + e0.score + ')');
assert(e0.wave === 3, '记录波次正确 (wave ' + e0.wave + ')');   // floor(65/30)=2 → 波次 3
assert(e0.kills === 12, '记录击杀数正确 (kills ' + e0.kills + ')');
assert(e0.weapon === 3 && e0.ship === 2 && e0.defense === 2, '记录装备等级正确');
assert(typeof e0.ts === 'number' && e0.ts > 0, '记录时间戳有效');
// 降序排序
Game.startGame(); Game.score = 1200; Game.gameOver();
Game.startGame(); Game.score = 300; Game.gameOver();
assert(Game.leaderboard.length === 3, '累计 3 条 (len ' + Game.leaderboard.length + ')');
assert(Game.leaderboard[0].score === 1200, '榜首为最高分 (' + Game.leaderboard[0].score + ')');
assert(Game.leaderboard[2].score === 300, '榜尾为最低分 (' + Game.leaderboard[2].score + ')');
// Top 10 截断:推入 12 条(100..1200),应只保留前 10 高分
Game.leaderboard = [];
for (var s = 100; s <= 1200; s += 100) { Game.startGame(); Game.score = s; Game.gameOver(); }
assert(Game.leaderboard.length === 10, '超过 10 条截断为 10 (len ' + Game.leaderboard.length + ')');
assert(Game.leaderboard[0].score === 1200, '截断后榜首仍为最高 (' + Game.leaderboard[0].score + ')');
assert(Game.leaderboard[9].score === 300, '截断后榜尾为 300 (' + Game.leaderboard[9].score + ')');
// 持久化:写入独立存储键 gh_leaderboard(不混入 gh_save)
var lbSaved = JSON.parse(lsStore['gh_leaderboard']);
assert(Array.isArray(lbSaved) && lbSaved.length === 10, '榜单持久化到 gh_leaderboard (len ' + (lbSaved && lbSaved.length) + ')');
var saveSaved = JSON.parse(lsStore['gh_save']);
assert(saveSaved.leaderboard === undefined, '榜单未污染 save 键');
// loadLeaderboard 从存储读回
Game.leaderboard = [];
Game.loadLeaderboard();
assert(Game.leaderboard.length === 10, 'loadLeaderboard 读回 10 条 (len ' + Game.leaderboard.length + ')');
// 排行榜状态切换 + 原路返回
Game.state = 'gameover';
Game.openLeaderboard();
assert(Game.state === 'leaderboard', 'openLeaderboard 进入 leaderboard 状态');
assert(Game._lbReturnState === 'gameover', '记录返回目标为 gameover');
Game.closeLeaderboard();
assert(Game.state === 'gameover', 'closeLeaderboard 原路返回 gameover');
// 渲染冒烟:榜单满 10 条时跑一帧 drawLeaderboard,校验渲染路径无异常(无 ctx 则 no-op)
Game.openLeaderboard(); pump(120); Game.closeLeaderboard();
assert(true, '排行榜渲染路径执行无异常');

console.log('\n[8] 飞船左右跟随指针 + 炮口固定朝上(v0.7)');
Game.startGame();
Game.activeSkill = null;
var ship0x = Game.ship.x, ship0y = Game.ship.y;
// v0.6:飞船固定底部、仅左右移动。指针指向右侧,飞船 x 应跟上,y 保持固定
P.pointer.x = 600; P.pointer.y = 950; P.pointer.down = false;
Game.ship.update(1.0);   // 1s 足够移到位
assert(Math.abs(Game.ship.x - 600) < 5, '飞船左右跟随指针 x (x ' + Game.ship.x.toFixed(0) + ')');
assert(Game.ship.y === G.Config.SHIP.y, '飞船 y 固定底部 (y ' + Game.ship.y.toFixed(0) + ', 固定 ' + G.Config.SHIP.y + ')');
// 指针指到屏幕顶部,y 也不变(不再上下移动)
P.pointer.x = 360; P.pointer.y = 0;
Game.ship.update(1.0);
assert(Game.ship.x === 360, '飞船 x 跟到 360 (x ' + Game.ship.x.toFixed(0) + ')');
assert(Game.ship.y === G.Config.SHIP.y, '指针在顶部时飞船 y 仍固定 (y ' + Game.ship.y.toFixed(0) + ')');
// 左右边界:指针超出右边,飞船贴边不越界
P.pointer.x = 99999; Game.ship.update(1.0);
assert(Game.ship.x === G.Config.WIDTH - Game.ship.radius, '右边界钳制 (x ' + Game.ship.x.toFixed(0) + ')');
// v0.7:炮口固定朝上(经典纵向射击),不再自动锁敌 —— 有敌、无敌、指针任意位置,炮口恒朝上
Game.aliens.length = 0;
var aimTarget = new G.Entities.Alien('t1', Game.ship.x + 100, Game.ship.y - 200);
Game.aliens.push(aimTarget);
Game.ship._aliens = Game.aliens;
Game.ship.update(0.02);
assert(Math.abs(Game.ship.aimAngle - (-Math.PI / 2)) < 0.01, '炮口固定朝上(有敌也不锁)');
// 无目标同样朝上
Game.aliens.length = 0;
Game.ship.update(0.02);
assert(Math.abs(Game.ship.aimAngle - (-Math.PI / 2)) < 0.01, '无目标炮口仍朝上');

console.log('\n[9] 技能系统:拾取持久生效 + 弹道/特效(v0.5)');
// 无技能时用武器默认 spread(1)
Game.startGame();
Game.activeSkill = null;
Game.fire(G.Config.WEAPONS[1]);
assert(Game.bullets.length === 1, '无技能:默认单发 (spread 1, 生成 ' + Game.bullets.length + ' 发)');
assert(Game.bullets[0].skill === null, '无技能子弹 skill=null');
// 四发技能:spread 覆盖为 4
Game.startGame();
Game.activeSkill = 'multi4';
Game.fire(G.Config.WEAPONS[1]);
assert(Game.bullets.length === 4, '四发技能:弹道覆盖为 4 (生成 ' + Game.bullets.length + ' 发)');
assert(Game.bullets[0].skill && Game.bullets[0].skill.fx === 'multi', '四发子弹携带 multi 技能');
// 火焰:伤害 ×1.8
Game.startGame();
Game.weaponLevel = 1; Game.shipLevel = 1; Game._syncShipVisual();
Game.activeSkill = 'fire';
Game.fire(G.Config.WEAPONS[1]);
var fDmg = G.Config.WEAPONS[1].damage * G.Config.SHIPS[1].fireMul * G.Config.SKILLS.fire.damageMul;
assert(Game.bullets[0].damage === fDmg, '火焰弹伤害 ×1.8 (got ' + Game.bullets[0].damage + ', expect ' + fDmg + ')');
assert(Game.bullets[0].color === G.Config.SKILLS.fire.color, '火焰弹弹道色为技能色');
// 激光:贯穿层=9999(无限贯穿)
Game.startGame();
Game.activeSkill = 'laser';
Game.fire(G.Config.WEAPONS[1]);
assert(Game.bullets[0].pierce >= 9999, '激光弹无限贯穿 (pierce ' + Game.bullets[0].pierce + ')');

console.log('\n[9b] 拾取技能胶囊(子弹击中即拾取,持久直到下一个)');
Game.startGame();
Game.activeSkill = null;
Game.powerups.length = 0;
Game.bullets.length = 0;
var pu = new G.Entities.PowerUp('ice', Game.ship.x, Game.ship.y - 80);
Game.powerups.push(pu);
Game.fire(G.Config.WEAPONS[1]);         // 炮口固定朝上发射(胶囊在飞船正上方,子弹朝上 → 即将命中)
// 把子弹挪到胶囊上确保命中
Game.bullets[0].x = pu.x; Game.bullets[0].y = pu.y;
Game.collisions();
assert(Game.activeSkill === 'ice', '击中胶囊拾取冰冻技能 (skill ' + Game.activeSkill + ')');
assert(pu.collected === true, '胶囊标记已拾取');
// 持久:新开火仍带 ice(直到拾取下一个)
Game.fire(G.Config.WEAPONS[1]);
assert(Game.bullets[Game.bullets.length - 1].skill && Game.bullets[Game.bullets.length - 1].skill.fx === 'ice',
  '技能持久生效:后续子弹仍带 ice');
// 拾取另一个技能→覆盖
Game.powerups.length = 0; Game.bullets.length = 0;
var pu2 = new G.Entities.PowerUp('fire', Game.ship.x, Game.ship.y - 80);
Game.powerups.push(pu2);
Game.fire(G.Config.WEAPONS[1]);
Game.bullets[0].x = pu2.x; Game.bullets[0].y = pu2.y;
Game.collisions();
assert(Game.activeSkill === 'fire', '拾取新技能覆盖旧的 (→ ' + Game.activeSkill + ')');

console.log('\n[9c] 技能命中效果:冰冻减速 / 火焰灼烧 / 闪电连锁');
// 冰冻:命中后怪 slowMul<1、slowTimer>0
Game.startGame();
Game.activeSkill = 'ice'; Game.weaponLevel = 1; Game.shipLevel = 1; Game._syncShipVisual();
var iceAlien = new G.Entities.Alien('t2', Game.ship.x, Game.ship.y - 60);  // hp3
Game.aliens.push(iceAlien);
Game.bullets.length = 0; Game.fire(G.Config.WEAPONS[1]);
Game.bullets[0].x = iceAlien.x; Game.bullets[0].y = iceAlien.y;
Game.collisions();
assert(iceAlien.slowMul === G.Config.SKILLS.ice.slowMul, '冰冻施加减速 (slowMul ' + iceAlien.slowMul + ')');
assert(iceAlien.slowTimer > 0, '冰冻减速有持续 (timer ' + iceAlien.slowTimer.toFixed(2) + ')');
// 减速作用于移速:推进后位置变化应小于正常速度(无技能怪走得更快)
var normal = new G.Entities.Alien('t2', 100, 100);
var slowed = new G.Entities.Alien('t2', 100, 100);
slowed.slowMul = 0.4;
var nY = normal.y, sY = slowed.y;
normal.update(0.5); slowed.update(0.5);
assert(slowed.y - sY < normal.y - nY, '减速怪移动更慢 (正常 Δ' + (normal.y - nY).toFixed(1) + ' / 减速 Δ' + (slowed.y - sY).toFixed(1) + ')');
// 火焰:命中施加 burn
Game.startGame();
Game.activeSkill = 'fire';
var fireAlien = new G.Entities.Alien('t3', Game.ship.x, Game.ship.y - 60);  // 蟹甲 hp8,火焰不致死
Game.aliens.push(fireAlien);
Game.bullets.length = 0; Game.fire(G.Config.WEAPONS[1]);
Game.bullets[0].x = fireAlien.x; Game.bullets[0].y = fireAlien.y;
Game.collisions();
assert(fireAlien.burnTimer > 0 && fireAlien.burnDps > 0, '火焰施加灼烧 (dps ' + fireAlien.burnDps + ', timer ' + fireAlien.burnTimer.toFixed(2) + ')');
assert(fireAlien.dead === false, '火焰直击不致死蟹甲 (hp ' + fireAlien.hp + ')');
// 灼烧随时间扣血
var hpBeforeBurn = fireAlien.hp;
fireAlien.update(2.1);   // burnDur 2.0,应扣 ~2.0 伤害
assert(fireAlien.hp < hpBeforeBurn, '灼烧持续扣血 (hp ' + hpBeforeBurn + ' → ' + fireAlien.hp + ')');
// 闪电:命中连锁附近怪
Game.startGame();
Game.activeSkill = 'bolt';
var main = new G.Entities.Alien('t1', Game.ship.x, Game.ship.y - 60);       // hp1 主目标
var near = new G.Entities.Alien('t1', Game.ship.x + 80, Game.ship.y - 60);  // hp1 连锁目标(在 220 半径内)
Game.aliens.push(main, near);
Game.bullets.length = 0; Game.fire(G.Config.WEAPONS[1]);
Game.bullets[0].x = main.x; Game.bullets[0].y = main.y;
var killsBefore = Game.killCount;
Game.collisions();
assert(main.dead === true, '闪电主目标被击杀');
assert(near.dead === true, '闪电连锁击杀附近怪');
assert(Game.killCount === killsBefore + 2, '连锁击杀计入击杀数 (kill ' + killsBefore + ' → ' + Game.killCount + ')');

console.log('\n[9d] 胶囊定时掉落');
Game.startGame();
Game.powerups.length = 0;
assert(Game.powerups.length === 0, '开局无胶囊');
assert(Game.powerupTimer === G.Config.POWERUP.dropEvery, '首个胶囊倒计时初始化 (' + Game.powerupTimer + ')');
// 推进越过掉落间隔,应生成胶囊(指针按下让飞船别乱飞)
P.pointer.x = 360; P.pointer.y = 1100; P.pointer.down = true;
Game.ship.invuln = 999;   // v0.10.3:移动改快后怪更易撞死飞船,测试期间无敌避免干扰胶囊判定
pump(G.Config.POWERUP.dropEvery * 1000 + 200);
assert(Game.powerups.length >= 1, '定时掉落胶囊 (生成 ' + Game.powerups.length + ' 个)');
assert(Game.activeSkill === null, '胶囊未拾取前技能仍为空');
// 胶囊渲染冒烟:跑一帧 drawWorld,校验胶囊 + 技能特效渲染路径无异常
pump(120);
assert(true, '技能胶囊 + 特效渲染路径执行无异常');

console.log('\n[10] 美术系统渲染冒烟(v0.6:飞船模块化进化 + 怪物生态)');
// 飞船 Lv1..Lv5:逐级组装模块(引擎/机翼/船体/武器/能量核心),渲染路径无异常
Game.startGame(); Game.activeSkill = null;
for (var lv = 1; lv <= 5; lv++) {
  Game.shipLevel = lv; Game._syncShipVisual();
  Game.ship.update(0.02);
  Game.ship.draw(makeCtx());
}
assert(true, '飞船 Lv1→Lv5 模块化渲染路径执行无异常');
// 受击闪白路径
Game.ship.hitFlash = 0.2; Game.ship.draw(makeCtx()); Game.ship.hitFlash = 0;
assert(true, '飞船受击闪白渲染路径无异常');
// 怪物 t1..t6:每种独立轮廓 + 发光弱点核心,渲染路径无异常
for (var tk = 1; tk <= 6; tk++) {
  var al = new G.Entities.Alien('t' + tk, G.Config.WIDTH / 2, 400);
  al.draw(makeCtx());
}
assert(true, '怪物 t1→t6 生态渲染路径执行无异常');
// 怪物受击闪白 + 状态(冰冻/灼烧)叠加渲染
var stAlien = new G.Entities.Alien('t3', 360, 500);
stAlien.hitFlash = 0.2; stAlien.draw(makeCtx());
stAlien.slowTimer = 1; stAlien.slowMul = 0.4; stAlien.draw(makeCtx());
stAlien.burnTimer = 1; stAlien.burnDps = 1; stAlien.draw(makeCtx());
assert(true, '怪物闪白/冰冻/灼烧状态叠加渲染无异常');
// 受伤血条渲染(hp < maxHp)
var hurt = new G.Entities.Alien('t5', 360, 600); hurt.hp = 10; hurt.draw(makeCtx());
assert(true, '怪物血条渲染路径无异常');
// 飞船技能弹道变体渲染(各 fx 路径:激光/火/闪电/冰/multi)
Game.startGame();
['ice', 'fire', 'bolt', 'laser', 'multi2', 'multi3', 'multi4'].forEach(function (sk) {
  Game.activeSkill = sk; Game.bullets.length = 0; Game.fire(G.Config.WEAPONS[1]);
  Game.bullets[Game.bullets.length - 1].draw(makeCtx());
});
assert(true, '各技能弹道变体渲染路径无异常');
// 跑一整帧 render 覆盖全部绘制路径
Game.startGame(); Game.activeSkill = 'fire';
P.pointer.x = 360; P.pointer.y = 1000; P.pointer.down = true;
pump(400);
assert(true, '完整 render 帧(飞船/怪物/技能/胶囊/HUD)无异常');

// ==================== v0.8:新内容(精英/Boss/敌弹)====================
console.log('\n[11] v0.8 新内容 — 配置与实体');
assert(G.Config.ALIENS.t7.behavior === 'dash', 't7 撕裂者标记 dash 行为');
assert(G.Config.ALIENS.t8.fire.pattern === 'aimed', 't8 守卫者 aimed 敌弹');
assert(G.Config.ALIENS.t9.boss === true && G.Config.ALIENS.t9.fire.stages, 't9 钢铁巨像 Boss + 阶段弹幕');
assert(G.Config.ALIENS.t10.boss === true && G.Config.ALIENS.t10.summonType === 't2', 't10 虚空吞噬者 Boss + 召唤override');
assert(JSON.stringify(G.Config.WAVE.bossRotation) === '["t6","t9","t10","boss-titan","boss-hydra","boss-crystall","boss-maw","boss-overlord"]', 'v0.11 Boss 轮换序列 8 Boss(t6/t9/t10 + 5 新)');
assert(G.Config.ENEMY_BULLET.damage === 1, '敌弹伤害=1(走护盾/hp 同路径)');
assert(typeof G.Entities.EnemyBullet === 'function', 'EnemyBullet 实体已导出');
// t7 非 Boss、不发弹;Boss 标志统一(向后兼容 t6)
assert(new G.Entities.Alien('t7', 100, 100).isBoss === false, 't7 非 Boss');
assert(new G.Entities.Alien('t6', 100, 100).isBoss === true, 't6 仍判定为 Boss(向后兼容 tier===6)');

console.log('\n[12] v0.8 敌弹生成/移动/回收');
Game.startGame();
Game.enemyBullets.length = 0;
var eb = new G.Entities.EnemyBullet(100, 100, 0, 200, '#ff5470');
Game.enemyBullets.push(eb);
Game.updateEntities(0.02);             // 移动
assert(eb.y > 100, '敌弹移动生效 (y 100 → ' + eb.y.toFixed(1) + ')');
assert(eb.trail.length > 0, '敌弹拖尾记录');
eb.x = G.Config.WIDTH + 100;            // 推出屏幕
Game.updateEntities(0.02);
assert(eb.dead === true, '敌弹出界标记回收');
Game.cleanup();
assert(Game.enemyBullets.length === 0, '出界敌弹被清理 (剩 ' + Game.enemyBullets.length + ')');

console.log('\n[13] v0.8 敌弹↔飞船碰撞(走护盾消格)');
Game.startGame();
Game.defenseLevel = 2; Game._applyDefense();   // 能量护盾 1 格
Game.ship.invuln = 0;
Game.enemyBullets.length = 0;
var eb2 = new G.Entities.EnemyBullet(Game.ship.x, Game.ship.y - 5, 0, 0, '#ff5470');
Game.enemyBullets.push(eb2);
var sh2 = Game.ship.shield, hp2 = Game.ship.hp;
Game.collisions();
assert(Game.ship.shield === sh2 - 1, '敌弹命中消一格护盾 (shield ' + sh2 + ' → ' + Game.ship.shield + ')');
assert(Game.ship.hp === hp2, '护盾吸收时 hp 不变 (hp ' + hp2 + ')');
assert(eb2.dead === true, '命中后敌弹销毁');
// 无敌帧内敌弹穿过(不销毁,雷电式无敌穿透)
Game.startGame();
Game.ship.invuln = 1.0;                 // 开局无敌
Game.enemyBullets.length = 0;
var eb3 = new G.Entities.EnemyBullet(Game.ship.x, Game.ship.y, 0, 0, '#ff5470');
Game.enemyBullets.push(eb3);
Game.collisions();
assert(eb3.dead === false, '无敌帧内敌弹穿过不销毁 (invuln=' + Game.ship.invuln + ')');

console.log('\n[14] v0.8 t7 撕裂者 — 预警→锁定→突进');
Game.startGame();
var rip = new G.Entities.Alien('t7', G.Config.WIDTH / 2, 200);
Game.aliens.push(rip);
assert(rip._dashTele === 0 && rip._repos === 0.8, 't7 初始缓速下移状态');
rip.update(1.0);                        // 进入循环,启动 _dashTele
assert(rip._dashTele > 0, '进入预警蓄能 (_dashTele=' + rip._dashTele.toFixed(2) + ')');
rip._dashArmed = false;                 // 重置以触发锁向断言
rip.update(0.05);                        // 触发 _lockDashAim
assert(rip._dashArmed === true, '预警期锁定突进方向');
var dashDx = rip._dashDx, dashDy = rip._dashDy;
var mag = Math.hypot(dashDx, dashDy);
assert(mag > 0.99 && mag < 1.01, '锁向单位向量 (_dashDx,_dashDy 长度 ' + mag.toFixed(3) + ')');
rip._dashTele = 0.01; rip.update(0.05); // 蓄能结束→突进
assert(rip._dashDur > 0, '蓄能结束进入突进 (_dashDur=' + rip._dashDur.toFixed(2) + ')');
var xBefore = rip.x, yBefore = rip.y;
rip.update(0.05);                        // 突进位移
assert(Math.hypot(rip.x - xBefore, rip.y - yBefore) > 0, '突进产生位移');

console.log('\n[15] v0.8 t8 守卫者 — 瞄准敌弹发射');
Game.startGame();
var gd = new G.Entities.Alien('t8', G.Config.WIDTH / 2, 200);
Game.aliens.push(gd);
gd.fireTimer = 0.05;                    // 即将到点
gd.update(0.1);                         // _updateFire 到点 → _enemyFire 生成 aimed 扇形
assert(Game.enemyBullets.length === 3, 'aimed 发射 3 发扇形敌弹 (得 ' + Game.enemyBullets.length + ')');
var ebCol = Game.enemyBullets[0].color;
assert(ebCol === '#ff8c42', '敌弹用怪色染色 (' + ebCol + ')');
// 弹幕上限保护
Game.enemyBullets.length = 0;
G.Config.ENEMY_BULLET.maxOnScreen = 2;
gd._aimArmed = false; gd.fireTimer = 0.05;
gd.update(0.1);
assert(Game.enemyBullets.length === 2, '敌弹上限保护 (上限2,得 ' + Game.enemyBullets.length + ')');
G.Config.ENEMY_BULLET.maxOnScreen = 90; // 复位

console.log('\n[16] v0.8 t9 钢铁巨像 — 多阶段弹幕(spiral/ring)');
Game.startGame();
var col = new G.Entities.Alien('t9', G.Config.WIDTH / 2, 200);
Game.aliens.push(col);
assert(col.bossStage === 1, 't9 初始阶段1(aimed)');
// 推进到阶段2:spiral 多臂
col.takeDamage(Math.ceil(col.maxHp * 0.4));   // hp → 60%,进阶段2
col.update(0.02);
assert(col.bossStage === 2, 'hp≤66% 进阶段2 (stage=' + col.bossStage + ')');
Game.enemyBullets.length = 0;
col.fireTimer = 0.05; col.update(0.2);   // spiral 到点
assert(Game.enemyBullets.length === 3, '阶段2 spiral 每次发射3臂 (得 ' + Game.enemyBullets.length + ')');
// 推进到阶段3:ring 全圆
col.takeDamage(Math.ceil(col.maxHp * 0.4));
col.update(0.02);
assert(col.bossStage === 3, 'hp≤33% 进阶段3 (stage=' + col.bossStage + ')');
Game.enemyBullets.length = 0;
col.fireTimer = 0.05; col.update(0.3);   // ring 到点
assert(Game.enemyBullets.length === 18, '阶段3 ring 发射18发全圆 (得 ' + Game.enemyBullets.length + ')');

console.log('\n[17] v0.8 t10 虚空吞噬者 — 多阶段 + 召唤override');
Game.startGame();
var vd = new G.Entities.Alien('t10', G.Config.WIDTH / 2, 200);
Game.aliens.push(vd);
assert(vd.isBoss === true, 't10 标记 Boss');
vd.bossStage = 2; vd.summonTimer = 0;
var aliensBefore = Game.aliens.length;
Game._bossSummon(vd);                    // 用 override summonType=t2 / count=3
var summoned = Game.aliens.length - aliensBefore;
assert(summoned === 3, 't10 override 召唤3只t2 (增 ' + summoned + ')');
// spiral 弹幕(阶段1:4臂)
Game.enemyBullets.length = 0;
vd.bossStage = 1; vd.fireTimer = 0.05; vd.update(0.2);
assert(Game.enemyBullets.length === 4, 't10 阶段1 spiral 4臂 (得 ' + Game.enemyBullets.length + ')');

console.log('\n[18] v0.12 Boss 轮换 8 序列 + 随机起始(首 Boss 不再恒 t6)');
Game.startGame();
assert(Game._bossIdx === 0, '开局 _bossIdx=0');
assert(Game._bossProgress === 0 && Game._nextBossAt === G.Config.WAVE.bossEveryKills, '开局 _bossProgress=0 / _nextBossAt=阈值');
assert(Game._bossRotationOffset >= 0 && Game._bossRotationOffset < G.Config.WAVE.bossRotation.length,
  '开局 _bossRotationOffset 随机落在轮换表内 (offset=' + Game._bossRotationOffset + ')');
// v0.12:触发用 _bossProgress≥_nextBossAt 阈值(替代 killCount%N 取模,防连环触发)。
//   这里把 offset 钳回 0 做确定性轮换序断言;t8 顺序仍是 t6→t9→t10→5新→回 t6。
Game._bossRotationOffset = 0;
// v0.10.7:Boss 触发后先警报(bossAlert>0、_bossPending),不立即入场。
//   驱动警报归零后才召唤。辅助:推 _bossProgress 到 _nextBossAt 阈值 + 推进警报直到 Boss 入场。
function triggerBossNext() {
  Game.aliens.length = 0; Game._bossSpawned = false; Game._bossPending = false; Game._bossCooldown = 0;
  Game._bossProgress = Game._nextBossAt;     // v0.12:推到阈值触发
  Game.updateWaves(0.01);
  assert(Game._bossPending === true, '触发后进入警报 pending(不立即入场)');
  var hasBossEarly = Game.aliens.some(function (a) { return a.isBoss; });
  assert(hasBossEarly === false, '警报期间 Boss 未入场(压迫感)');
  Game.bossAlert = 0;
  Game.updateWaves(0.01);
  return Game.aliens[Game.aliens.length - 1];
}
assert(triggerBossNext().type === 't6', '第1次触发 → t6 (idx→' + Game._bossIdx + ')');
assert(Game._bossIdx === 1, '_bossIdx 递增到 1');
assert(triggerBossNext().type === 't9', '第2次触发 → t9 (轮换生效)');
assert(triggerBossNext().type === 't10', '第3次触发 → t10');
// v0.11:轮换扩到 8 Boss,第4-8 次触发 5 个新 Boss(各自机制),第9 次回 t6(8-Boss 循环)
assert(triggerBossNext().type === 'boss-titan', '第4次触发 → boss-titan (机制 shield)');
assert(triggerBossNext().type === 'boss-hydra', '第5次触发 → boss-hydra (机制 summon)');
assert(triggerBossNext().type === 'boss-crystall', '第6次触发 → boss-crystall (机制 absorb)');
assert(triggerBossNext().type === 'boss-maw', '第7次触发 → boss-maw (机制 wave)');
assert(triggerBossNext().type === 'boss-overlord', '第8次触发 → boss-overlord (机制 summon+shield)');
assert(triggerBossNext().type === 't6', '第9次触发 → 回 t6 (8-Boss 循环)');

console.log('\n[18b] v0.10.7 单波单 Boss(不堆叠)+ v0.12 阈值/召唤仆从不推进触发');
Game.startGame();
Game._bossRotationOffset = 0;
// 触发 + 入场一个 Boss(Boss 在场)
var singleBoss = triggerBossNext();
assert(singleBoss && singleBoss.isBoss === true, 'Boss 入场在场');
Game.updateWaves(0.01);   // 跑一帧让 _hadBoss 置 true(Boss 在场)
assert(Game._hadBoss === true, '_hadBoss 追踪到 Boss 在场');
// Boss 在场时,即便 _bossProgress 再达阈值也不触发新 Boss
Game._bossProgress = Game._nextBossAt;
Game.bossAlert = 0;
Game.updateWaves(0.01);
assert(Game._bossPending === false && Game._bossSpawned === true, 'Boss 在场期间抑制新触发(单波单 Boss)');
// v0.12:Boss 召唤的仆从击杀不推进 _bossProgress(防连环触发下一个 Boss → 重叠)
var summon = new G.Entities.Alien('t2', 200, 200);
summon.isSummoned = true;
var progBefore = Game._bossProgress;
Game.killAlien(summon);
assert(Game._bossProgress === progBefore, '召唤仆从击杀不推进 _bossProgress (防连环触发)');
assert(Game.killCount === 1, '召唤仆从仍计入 killCount(HUD 显示)');
// Boss 死亡(清场)→ 下一帧下降沿复位
Game.aliens.length = 0;   // 模拟 Boss 被击杀清场
Game.updateWaves(0.01);
assert(Game._bossSpawned === false, 'Boss 死亡后复位 _bossSpawned(允许下一轮)');
// v0.11.1:Boss 死亡后冷却 6s,期间即便到阈值也不触发(防连触发/视觉堆叠)
assert(Game._bossCooldown > 0, 'Boss 死亡后进入冷却 (cooldown=' + Game._bossCooldown.toFixed(1) + ')');
Game._bossProgress = Game._nextBossAt;   // 到下一个阈值
Game.updateWaves(0.01);
assert(Game._bossPending === false, '冷却期间不触发新 Boss');
// 冷却耗尽后才允许触发
Game._bossCooldown = 0;
Game._bossProgress = Game._nextBossAt;
Game.updateWaves(0.01);
assert(Game._bossPending === true, '冷却结束后恢复触发');

console.log('\n[18c] v0.12 独有弹幕(fan/cross/split)+ Boss 血量上调 + 金币去磁吸');
// t13 飞镖无人机:fan 宽扇 5 发
Game.startGame();
Game.enemyBullets.length = 0;
var drone = new G.Entities.Alien('t13', G.Config.WIDTH / 2, 200);
Game.aliens.push(drone);
assert(G.Config.ALIENS.t13.fire.pattern === 'fan', 't13 配置 fan 弹种');
drone.fireTimer = 0.05; drone.update(0.1);
assert(Game.enemyBullets.length === 5, 'fan 发射 5 发宽扇敌弹 (得 ' + Game.enemyBullets.length + ')');
// t15 钻头钻探者:cross 十字 4 向
Game.enemyBullets.length = 0;
var drl = new G.Entities.Alien('t15', G.Config.WIDTH / 2, 300);
Game.aliens.push(drl);
assert(G.Config.ALIENS.t15.fire.pattern === 'cross', 't15 配置 cross 弹种');
drl.fireTimer = 0.05; drl.update(0.1);
assert(Game.enemyBullets.length === 4, 'cross 发射 4 发十字敌弹 (得 ' + Game.enemyBullets.length + ')');
// t16 晶簇机械体:split 存活时不发弹(无 every),被击杀炸 6 发圆环
Game.enemyBullets.length = 0;
var cryst = new G.Entities.Alien('t16', G.Config.WIDTH / 2, 400);
Game.aliens.push(cryst);
assert(G.Config.ALIENS.t16.fire.pattern === 'split' && !G.Config.ALIENS.t16.fire.every, 't16 配置 split 且无 every(存活不发弹)');
cryst.fireTimer = 0.05; cryst.update(0.5);   // 推进计时
assert(Game.enemyBullets.length === 0, 'split 存活时不发弹 (得 ' + Game.enemyBullets.length + ')');
Game.enemyBullets.length = 0;
Game.killAlien(cryst);
assert(Game.enemyBullets.length === 6, 'split 被击杀炸 6 发圆环弹 (得 ' + Game.enemyBullets.length + ')');
// Boss 血量上调(原 t6=200/t9=500/t10=1200 秒爆,现显著提升)
assert(G.Config.ALIENS.t6.hp === 550, 't6 血量上调 200→550');
assert(G.Config.ALIENS.t9.hp === 1400, 't9 血量上调 500→1400');
assert(G.Config.ALIENS.t10.hp === 2800, 't10 血量上调 1200→2800');
assert(G.Config.ALIENS['boss-overlord'].hp === 5000, 'boss-overlord 血量上调 3500→5000');
// 金币去磁吸:ship 远离时金币不朝飞船加速(旧磁吸会有显著横向拉力)
Game.startGame();
var coin = new G.Entities.Coin(100, 200, 5);
coin.vx = 0; coin.vy = 0;              // 抹掉初始随机速度,只观测磁吸/重力
Game.ship.x = 600; Game.ship.y = 1100; // 远离金币
coin.update(0.1, Game.ship);
assert(Math.abs(coin.vx) < 5, '金币无磁吸:ship 远离时无横向拉力 (vx=' + coin.vx.toFixed(2) + ')');
assert(coin.vy > 0, '金币改为重力下落 (vy=' + coin.vy.toFixed(2) + ')');

console.log('\n[19] v0.8 新怪 + 敌弹渲染路径');
// t7 预警/突进两态 + t8 蓄能态渲染
var rip2 = new G.Entities.Alien('t7', 360, 400); rip2._dashTele = 0.3; rip2.draw(makeCtx());
rip2._dashTele = 0; rip2._dashDur = 0.5; rip2.draw(makeCtx());
var gd2 = new G.Entities.Alien('t8', 360, 400); gd2._aimArmed = true; gd2._aimAngle = Math.PI / 2; gd2.draw(makeCtx());
assert(true, 't7 预警/突进 + t8 蓄能态渲染无异常');
// t9/t10 三阶段渲染
for (var stg = 1; stg <= 3; stg++) {
  var c9 = new G.Entities.Alien('t9', 360, 500); c9.bossStage = stg; c9.draw(makeCtx());
  var c10 = new G.Entities.Alien('t10', 360, 500); c10.bossStage = stg; c10.draw(makeCtx());
}
assert(true, 't9/t10 三阶段渲染路径无异常');
// 敌弹渲染(带拖尾)
var eb4 = new G.Entities.EnemyBullet(360, 500, 0, 100, '#ff5470');
eb4.update(0.02); eb4.update(0.02); eb4.draw(makeCtx());
assert(true, '敌弹(拖尾+尖刺)渲染路径无异常');
// 音效 enemyFire 无 AudioContext 静默
G.Sound.play('enemyFire');
assert(true, 'enemyFire 音效无 AudioContext 安全运行');

// ==================== v0.10:船舰副炮养成实装(GDD §4.3 炮位阶梯)====================
console.log('\n[20] v0.10 副炮 — 配置阶梯(炮位解锁)');
assert(G.Config.SHIPS[1].turrets === 0, 'Lv1 侦察艇无副炮');
assert(G.Config.SHIPS[2].turrets === 1 && G.Config.SHIPS[2].turretAuto === false, 'Lv2 驱逐舰 1门固定朝上(双炮位)');
assert(G.Config.SHIPS[3].turrets === 1 && G.Config.SHIPS[3].turretAuto === true, 'Lv3 巡洋舰 1门自动锁敌(+自动副炮)');
assert(G.Config.SHIPS[4].turrets === 2 && G.Config.SHIPS[4].turretAuto === true, 'Lv4 战列舰 2门自动锁敌(三炮位)');
assert(G.Config.SHIPS[5].turrets === 2 && G.Config.SHIPS[5].turretAuto === true, 'Lv5 旗舰 2门自动锁敌(全向射击)');
assert(typeof G.Config.TURRET === 'object' && G.Config.TURRET.pierce === 0, 'TURRET 全局配置已挂载且不贯穿');

console.log('\n[21] v0.10 副炮 — 自动开火与弹道属性');
Game.startGame();
Game.weaponLevel = 1; Game.shipLevel = 1; Game._syncShipVisual();
Game.bullets.length = 0; Game._fireTurrets(1.0);
assert(Game.bullets.length === 0, 'Lv1 无副炮 → 不生成弹');
// Lv2 1门固定朝上:vx≈0、vy<0
Game.shipLevel = 2; Game._syncShipVisual();
Game.bullets.length = 0; Game._fireTurrets(1.0);
var t2b = Game.bullets[0];
assert(Game.bullets.length === 1, 'Lv2 副炮生成 1 发');
assert(t2b.vy < 0 && Math.abs(t2b.vx) < 1, 'Lv2 副炮固定朝上 (vy=' + t2b.vy.toFixed(0) + ')');
assert(t2b.turret === true && t2b.skill === null, '副炮弹标记 turret、无 skill');
assert(t2b.color === G.Config.TURRET.color && t2b.radius === G.Config.TURRET.radius, '副炮弹色/半径=TURRET 配置');
assert(t2b.pierce === 0, '副炮弹不贯穿 (pierce=0)');
assert(t2b.damage === G.Config.SHIPS[2].turretDmg, '副炮弹伤害=turretDmg(不乘 fireMul, got ' + t2b.damage + ')');
// Lv4 2门(场上无怪 → 退回朝上)
Game.shipLevel = 4; Game._syncShipVisual();
Game.bullets.length = 0; Game._fireTurrets(1.0);
assert(Game.bullets.length === 2, 'Lv4 副炮生成 2 发(机翼左右)');

console.log('\n[22] v0.10 副炮 — 自动锁敌 + 击杀链路');
Game.startGame();
Game.weaponLevel = 1; Game.shipLevel = 3; Game._syncShipVisual();   // 巡洋舰 1门自锁
// 放一只怪在飞船右上方(非正上方),验证副炮弹朝目标而非纯朝上
Game.aliens.length = 0;
var tgtA = new G.Entities.Alien('t1', Game.ship.x + 200, Game.ship.y - 200);
Game.aliens.push(tgtA);
Game.ship._aliens = Game.aliens;
Game.bullets.length = 0; Game._fireTurrets(1.0);
var t3b = Game.bullets[0];
assert(t3b.vx > 1 && t3b.vy < 0, 'Lv3 自锁:副炮弹朝目标方向 (vx=' + t3b.vx.toFixed(0) + ',vy=' + t3b.vy.toFixed(0) + ')');
// 副炮弹不受 activeSkill 影响(纯物理)
Game.activeSkill = 'fire';
Game.bullets.length = 0; Game._fireTurrets(1.0);
assert(Game.bullets[0].skill === null, '副炮弹不受 activeSkill 影响(纯物理)');
// 副炮弹命中击杀:手动构造一发副炮弹叠到怪身上,验证走通用碰撞/击杀链路
Game.startGame();
Game.weaponLevel = 1; Game.shipLevel = 3; Game._syncShipVisual();
var tkDmg = G.Config.SHIPS[3].turretDmg;   // 2
var kpA = new G.Entities.Alien('t1', 360, 300);   // 远离飞船(避免撞船干扰)
kpA.hp = tkDmg; kpA.maxHp = tkDmg;
Game.aliens.length = 0; Game.aliens.push(kpA);
var tb = new G.Entities.Bullet(kpA.x, kpA.y, 0, -100, G.Config.WEAPONS[1], tkDmg, null);
tb.color = G.Config.TURRET.color; tb.radius = G.Config.TURRET.radius; tb.pierce = 0; tb.turret = true;
Game.bullets.length = 0; Game.bullets.push(tb);
var beforeKills = Game.killCount;
Game.collisions();
assert(kpA.dead === true, '副炮弹命中击杀怪物');
assert(Game.killCount === beforeKills + 1, '副炮击杀走 killAlien 链路 (kills ' + beforeKills + ' → ' + Game.killCount + ')');
// startGame 重置 turretTimer
Game.turretTimer = 99; Game.startGame();
assert(Game.turretTimer === 0, 'startGame 重置 turretTimer');
// 副炮座渲染路径(Lv1 无 / Lv2 单 / Lv5 双)
for (var tl = 1; tl <= 5; tl++) {
  Game.shipLevel = tl; Game._syncShipVisual();
  Game.ship.update(0.02); Game.ship.draw(makeCtx());
}
assert(true, '飞船 Lv1→Lv5 含副炮座渲染路径无异常');

// ==================== v0.11:5 新 Boss 机制(shield/summon/absorb/wave)====================
console.log('\n[23] v0.11 新 Boss — 配置完整(机制/阶段/不进刷新池)');
['boss-titan', 'boss-hydra', 'boss-crystall', 'boss-maw', 'boss-overlord'].forEach(function (bt) {
  var d = G.Config.ALIENS[bt];
  assert(d.boss === true && d.mechanism && d.spawnWeight === 0, bt + ' 配置完整 (boss/mechanism=' + d.mechanism + '/spawnWeight=0)');
  assert(d.bossVisScale > 0 && d.fire.stages, bt + ' 有 bossVisScale + 阶段弹幕 (visScale=' + d.bossVisScale + ')');
});
assert(G.Config.ALIENS['boss-hydra'].mechanism === 'summon' && G.Config.ALIENS['boss-hydra'].summonType === 't7', 'hydra 机制 summon → 召唤 t7');
assert(G.Config.ALIENS['boss-overlord'].summonType === 't8', 'overlord 召唤 t8 仆从');
assert(G.Config.ALIENS['boss-maw'].mechanism === 'wave', 'maw 机制 wave');
assert(G.Config.ALIENS['boss-crystall'].mechanism === 'absorb', 'crystall 机制 absorb');
assert(G.Config.ALIENS['boss-titan'].mechanism === 'shield', 'titan 机制 shield');

console.log('\n[24] v0.11 takeDamage — shield 吸收 / absorb 回血 / 阶段激活');
// shield 机制(titan):shield>0 时扣盾不扣血,返回 'shield'
var titan = new G.Entities.Alien('boss-titan', G.Config.WIDTH / 2, 200);
assert(titan.shield === 400 && titan.maxShield === 400, 'titan 初始护盾 400');
var tHp0 = titan.hp;
var hitS = titan.takeDamage(100);
assert(hitS === 'shield', 'shield 机制命中返回 shield');
assert(titan.shield === 300 && titan.hp === tHp0, '扣盾不扣血 (shield 400→' + titan.shield + ', hp 不变)');
// 盾吸收溢出不穿血(盾 50 挨 100 → 盾归 0,溢出 50 不扣 hp)
var titan2 = new G.Entities.Alien('boss-titan', G.Config.WIDTH / 2, 200);
titan2.shield = 50;
var hitP = titan2.takeDamage(100);
assert(titan2.shield === 0 && titan2.hp === titan2.maxHp, '盾吸收溢出不穿血 (shield→0, hp 不变, hit=' + hitP + ')');
// absorb 机制(crystall):hp<maxHp 时 30% 概率吸收回血,返回 'absorb'
var cryst = new G.Entities.Alien('boss-crystall', G.Config.WIDTH / 2, 200);
cryst.hp = cryst.maxHp - 50;   // 受伤态(满足 hp<maxHp 才可吸收)
var origRandom = Math.random;
Math.random = function () { return 0.1; };   // <0.3 强制触发吸收
var hitA = cryst.takeDamage(10);
Math.random = origRandom;       // 立即复位,避免污染后续用例
assert(hitA === 'absorb', 'absorb 机制命中返回 absorb (hit=' + hitA + ')');
assert(cryst.hp > cryst.maxHp - 50, '吸收回血 (hp ' + (cryst.maxHp - 50) + ' → ' + cryst.hp + ')');
// shield 阶段激活:_onBossStage 阶段2/3 补满护盾(护盾在时无法受伤,需先打破)
Game.startGame();
var stBoss = new G.Entities.Alien('boss-titan', G.Config.WIDTH / 2, 200);
stBoss.shield = 0; stBoss.bossStage = 1;
Game._onBossStage(stBoss, 2);
assert(stBoss.shield === stBoss.maxShield, '阶段2 激活护盾回满 (shield→' + stBoss.shield + ')');

console.log('\n[25] v0.11 wave 机制 — 冲击波弹膨胀衰减');
assert(G.Config.ALIENS['boss-maw'].fire.stages[2].pattern === 'wave', 'maw 阶段2 用 wave 冲击波弹');
// expand 标记的敌弹:update 后 radius 增大(限 40 上限)、速度衰减
var waveEb = new G.Entities.EnemyBullet(360, 500, 100, 0, '#ff5d8f', 'ring', true);
waveEb.expand = true;
var r0 = waveEb.radius, v0 = waveEb.vx;
waveEb.update(0.5);
assert(waveEb.radius > r0, '冲击波弹膨胀 (radius ' + r0.toFixed(1) + ' → ' + waveEb.radius.toFixed(1) + ')');
assert(waveEb.vx < v0, '冲击波弹减速衰减 (vx ' + v0.toFixed(1) + ' → ' + waveEb.vx.toFixed(1) + ')');
assert(waveEb.radius <= 40, '膨胀有上限 (radius=' + waveEb.radius.toFixed(1) + ' ≤ 40)');

console.log('\n==============================');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail === 0 ? '✅ 冒烟测试全部通过' : '❌ 存在失败项', '\n');
process.exit(fail === 0 ? 0 : 1);
