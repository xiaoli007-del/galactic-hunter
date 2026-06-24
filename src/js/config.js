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

    // 武器(对应 GDD §4.2)。MVP 解锁到 Lv3,Lv4/Lv5 数据先配好。
    WEAPONS: {
      1: { name: '脉冲激光',  damage: 1, fireRate: 4.0, spread: 1, speed: 900,  color: '#5ad1ff', cost: 0,     pierce: 0 },
      2: { name: '双联激光',  damage: 1, fireRate: 6.0, spread: 2, speed: 940,  color: '#7df0c0', cost: 500,   pierce: 0 },
      3: { name: '等离子炮',  damage: 3, fireRate: 4.0, spread: 1, speed: 820,  color: '#c77dff', cost: 2000,  pierce: 2 },
      4: { name: '散射波',    damage: 2, fireRate: 3.0, spread: 3, speed: 780,  color: '#ffd166', cost: 8000,  pierce: 0 },
      5: { name: '量子湮灭',  damage: 6, fireRate: 5.0, spread: 1, speed: 1000, color: '#ff5d8f', cost: 30000, pierce: 3 },
    },
    MAX_WEAPON_LEVEL_MVP: 3,

    // 船舰(v0.2 实装:fireMul 作为「乘区」放大武器单发伤害;glow 为飞船等级光晕色)
    SHIPS: {
      1: { name: '侦察艇',   fireMul: 1.0, cost: 0,      glow: '#5ad1ff' },
      2: { name: '驱逐舰',   fireMul: 1.2, cost: 1500,   glow: '#5ad1ff' },
      3: { name: '巡洋舰',   fireMul: 1.5, cost: 6000,   glow: '#7df0c0' },
      4: { name: '战列舰',   fireMul: 2.0, cost: 25000,  glow: '#ffd166' },
      5: { name: '旗舰',     fireMul: 3.0, cost: 100000, glow: '#ff5d8f' },
    },
    MAX_SHIP_LEVEL: 5,
    // 防御(数据预留,v0.2 之后实装)
    DEFENSES: {
      1: { name: '基础装甲', shield: 0,  cost: 0 },
      2: { name: '能量护盾', shield: 50, cost: 1000 },
      3: { name: '反射力场', shield: 100, cost: 5000 },
      4: { name: '量子护盾', shield: 200, cost: 20000 },
      5: { name: '不灭屏障', shield: 500, cost: 80000 },
    },

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
      bossEveryKills: 60,        // 每 N 击杀触发 Boss(MVP 简化)
      maxAliensOnScreen: 26,
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
