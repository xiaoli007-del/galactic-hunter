/*
 * Galactic Hunter — config.js
 * 数值配置表(单一数据源)
 * 对应 GDD §4 怪物/武器/船舰/防御数值。所有平衡常量集中于此,便于调参。
 */
(function (G) {
  'use strict';

  // 画布逻辑分辨率(内部坐标系,渲染时按屏幕缩放;移植小游戏保持一致)
  var WIDTH = 720;
  var HEIGHT = 1280;

  var Config = {
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,

    // 游戏循环
    TARGET_FPS: 60,

    // 飞船
    SHIP: {
      radius: 34,
      x: WIDTH / 2,
      y: HEIGHT - 180,
      speed: 520,            // 手动瞄准时飞船本身固定底部,炮口指向指针;速度预留
      maxHp: 3,              // 受击次数(每次撞击/接触扣1,MVP 用 hp 制)
    },

    // 武器(对应 GDD §4.2)。Lv1–Lv5 全等级实装(v0.2 解锁满级,按金币逐级升级)。
    WEAPONS: {
      1: { name: '脉冲激光',  damage: 1, fireRate: 4.0, spread: 1, speed: 900,  color: '#5ad1ff', cost: 0,     pierce: 0 },
      2: { name: '双联激光',  damage: 1, fireRate: 6.0, spread: 2, speed: 940,  color: '#7df0c0', cost: 500,   pierce: 0 },
      3: { name: '等离子炮',  damage: 3, fireRate: 4.0, spread: 1, speed: 820,  color: '#c77dff', cost: 2000,  pierce: 2 },
      4: { name: '散射波',    damage: 2, fireRate: 3.0, spread: 3, speed: 780,  color: '#ffd166', cost: 8000,  pierce: 0 },
      5: { name: '量子湮灭',  damage: 6, fireRate: 5.0, spread: 1, speed: 1000, color: '#ff5d8f', cost: 30000, pierce: 3 },
    },
    MAX_WEAPON_LEVEL: 5,

    // 船舰(v0.2 实装:fireMul 作为「乘区」放大武器单发伤害;glow 为飞船等级光晕色)
    SHIPS: {
      1: { name: '侦察艇',   fireMul: 1.0, cost: 0,      glow: '#5ad1ff' },
      2: { name: '驱逐舰',   fireMul: 1.2, cost: 1500,   glow: '#5ad1ff' },
      3: { name: '巡洋舰',   fireMul: 1.5, cost: 6000,   glow: '#7df0c0' },
      4: { name: '战列舰',   fireMul: 2.0, cost: 25000,  glow: '#ffd166' },
      5: { name: '旗舰',     fireMul: 3.0, cost: 100000, glow: '#ff5d8f' },
    },
    MAX_SHIP_LEVEL: 5,
    // 防御(v0.2.2 实装:充能护盾 + 特效,忠实 GDD §4.4)
    //   charges   = 护盾充能数(每次受击消 1 格,格尽才扣 hp)
    //   regenDelay= 回充一格所需秒数(短 CD 回充;Lv4/5 自动回复 = 更快)
    //   revive    = Lv5 不灭屏障:每局死亡复活一次
    //   shield    = GDD §4.4 原始数值(留档,玩法用 charges)
    //   glow      = HUD 护盾指示色
    //   reflectChance / reflectDmgMul = Lv3 反射力场:护盾格吸收命中时概率反弹(reflectDmgMul 放大武器有效伤害)
    DEFENSES: {
      1: { name: '基础装甲', shield: 0,   cost: 0,     charges: 0, regenDelay: 0,  revive: false, glow: '#8aa0b5', reflectChance: 0,   reflectDmgMul: 0 },
      2: { name: '能量护盾', shield: 50,  cost: 1000,   charges: 1, regenDelay: 8,  revive: false, glow: '#5ad1ff', reflectChance: 0,   reflectDmgMul: 0 },
      3: { name: '反射力场', shield: 100, cost: 5000,   charges: 2, regenDelay: 7,  revive: false, glow: '#7df0c0', reflectChance: 0.5, reflectDmgMul: 0.6 },
      4: { name: '量子护盾', shield: 200, cost: 20000,  charges: 3, regenDelay: 4,  revive: false, glow: '#c77dff' },  // 自动回复
      5: { name: '不灭屏障', shield: 500, cost: 80000,  charges: 3, regenDelay: 4,  revive: true,  glow: '#ffd166' },  // 复活1次/局
    },
    MAX_DEFENSE_LEVEL: 5,

    // 外星怪物(对应 GDD §4.1)。spawnWeight 控制刷新概率。
    ALIENS: {
      t1: { name: '爬虫',   tier: 1, hp: 1,   score: 10,   coin: 2,   radius: 18, speed: 95,  spawnWeight: 40, color: '#8aff80' },
      t2: { name: '飞翼',   tier: 2, hp: 3,   score: 30,   coin: 5,   radius: 24, speed: 70,  spawnWeight: 25, color: '#5ad1ff' },
      t3: { name: '蟹甲',   tier: 3, hp: 8,   score: 80,   coin: 15,  radius: 34, speed: 48,  spawnWeight: 18, color: '#ffd166' },
      t4: { name: '幽灵',   tier: 4, hp: 5,   score: 150,  coin: 25,  radius: 26, speed: 78,  spawnWeight: 10, color: '#c77dff' },
      t5: { name: '精英',   tier: 5, hp: 20,  score: 300,  coin: 60,  radius: 40, speed: 60,  spawnWeight: 5,  color: '#ff8a3d' },
      t6: { name: 'Boss',   tier: 6, hp: 100, score: 1500, coin: 300, radius: 70, speed: 38,  spawnWeight: 2,  color: '#ff3d6e' },
    },

    // 波次:随时间提升高等级怪权重。难度档每 30s 一档。
    WAVE: {
      difficultyInterval: 30,    // 秒
      spawnIntervalBase: 1.1,    // 初始刷新间隔
      spawnIntervalMin: 0.35,    // 最快刷新间隔
      spawnIntervalDecay: 0.92,  // 每档刷新间隔衰减
      bossEveryKills: 60,        // 每 N 击杀触发 Boss
      maxAliensOnScreen: 26,
    },

    // Boss(t6)多阶段(v0.3):血量阈值触发阶段切换,每阶段强化行为
    BOSS: {
      stage2HpRatio: 0.66,   // hp ≤ 66% 进入阶段 2(狂暴)
      stage3HpRatio: 0.33,   // hp ≤ 33% 进入阶段 3(暴怒)
      speedMul:  { 1: 1.0, 2: 1.4, 3: 1.9 },   // 各阶段移速倍率
      summonEvery: { 2: 3.5, 3: 2.2 },          // 召唤间隔(秒);阶段 1 不召唤
      summonType: 't2',                          // 召唤的小怪
      summonCount: 2,                            // 每次召唤数量
      dashEvery: 2.8,                            // 阶段 3 冲刺间隔(秒)
      dashSpeedMul: 4.5,                         // 冲刺速度倍率
      dashDuration: 0.6,                         // 冲刺持续(秒)
    },

    // 起始与持久化
    START: {
      coins: 0,
      weaponLevel: 1,
      shipLevel: 1,
      defenseLevel: 1,
    },

    // 反馈与粒子
    FX: {
      coinFlySpeed: 520,
      damageTextSpeed: 60,
      explosionParticles: 14,
      starCount: 140,
    },
  };

  G.Config = Config;
})(window.G = window.G || {});
