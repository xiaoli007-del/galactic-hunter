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
      speed: 760,            // v0.5:跟随指针的最大移速(px/s);指针进入活动区时朝其位移,实现闪避
      aimRange: 720,         // 自动锁敌最大半径(逻辑像素);超出则朝指针
      maxY: HEIGHT - 120,    // 活动区下界(留出底栏升级卡片空间)
      minY: HEIGHT * 0.45,   // 活动区上界(飞船限下半屏,避免贴顶丢失闪避纵深)
      maxHp: 3,              // 受击次数(每次撞击/接触扣1,MVP 用 hp 制)
    },

    // 武器(对应 GDD §4.2)。Lv1–Lv5 全等级实装(v0.2 解锁满级,按金币逐级升级)。
    // v0.5 经济调参:前期伤害↑(Lv1/2 各+1)、升级成本全线↓约 75%,小怪金币↑,使首局 30–40s 即可首次升级。
    WEAPONS: {
      1: { name: '脉冲激光',  damage: 2, fireRate: 4.0, spread: 1, speed: 900,  color: '#5ad1ff', cost: 0,     pierce: 0 },
      2: { name: '双联激光',  damage: 2, fireRate: 6.0, spread: 2, speed: 940,  color: '#7df0c0', cost: 120,   pierce: 0 },
      3: { name: '等离子炮',  damage: 4, fireRate: 4.0, spread: 1, speed: 820,  color: '#c77dff', cost: 900,   pierce: 2 },
      4: { name: '散射波',    damage: 3, fireRate: 3.0, spread: 3, speed: 780,  color: '#ffd166', cost: 3500,  pierce: 0 },
      5: { name: '量子湮灭',  damage: 8, fireRate: 5.0, spread: 1, speed: 1000, color: '#ff5d8f', cost: 14000, pierce: 3 },
    },
    MAX_WEAPON_LEVEL: 5,

    // 船舰(v0.2 实装:fireMul 作为「乘区」放大武器单发伤害;glow 为飞船等级光晕色)
    // v0.5 经济调参:成本全线↓约 75%,前期可快速升 1–2 级建立成长感。
    SHIPS: {
      1: { name: '侦察艇',   fireMul: 1.0, cost: 0,     glow: '#5ad1ff' },
      2: { name: '驱逐舰',   fireMul: 1.2, cost: 350,   glow: '#5ad1ff' },
      3: { name: '巡洋舰',   fireMul: 1.5, cost: 2600,  glow: '#7df0c0' },
      4: { name: '战列舰',   fireMul: 2.0, cost: 11000, glow: '#ffd166' },
      5: { name: '旗舰',     fireMul: 3.0, cost: 48000, glow: '#ff5d8f' },
    },
    MAX_SHIP_LEVEL: 5,
    // 防御(v0.2.2 实装:充能护盾 + 特效,忠实 GDD §4.4)
    //   charges   = 护盾充能数(每次受击消 1 格,格尽才扣 hp)
    //   regenDelay= 回充一格所需秒数(短 CD 回充;Lv4/5 自动回复 = 更快)
    //   revive    = Lv5 不灭屏障:每局死亡复活一次
    //   shield    = GDD §4.4 原始数值(留档,玩法用 charges)
    //   glow      = HUD 护盾指示色
    //   reflectChance / reflectDmgMul = Lv3 反射力场:护盾格吸收命中时概率反弹(reflectDmgMul 放大武器有效伤害)
    // v0.5 经济调参:成本全线↓约 75%。
    DEFENSES: {
      1: { name: '基础装甲', shield: 0,   cost: 0,     charges: 0, regenDelay: 0,  revive: false, glow: '#8aa0b5', reflectChance: 0,   reflectDmgMul: 0 },
      2: { name: '能量护盾', shield: 50,  cost: 200,   charges: 1, regenDelay: 8,  revive: false, glow: '#5ad1ff', reflectChance: 0,   reflectDmgMul: 0 },
      3: { name: '反射力场', shield: 100, cost: 2200,  charges: 2, regenDelay: 7,  revive: false, glow: '#7df0c0', reflectChance: 0.5, reflectDmgMul: 0.6 },
      4: { name: '量子护盾', shield: 200, cost: 9000,  charges: 3, regenDelay: 4,  revive: false, glow: '#c77dff' },  // 自动回复
      5: { name: '不灭屏障', shield: 500, cost: 38000, charges: 3, regenDelay: 4,  revive: true,  glow: '#ffd166' },  // 复活1次/局
    },
    MAX_DEFENSE_LEVEL: 5,

    // 外星怪物(对应 GDD §4.1)。spawnWeight 控制刷新概率。
    //   behavior = 特殊行为(v0.3):t4 幽灵闪现回避、t5 精英螺旋冲刺
    ALIENS: {
      t1: { name: '爬虫',   tier: 1, hp: 1,   score: 10,   coin: 4,   radius: 18, speed: 95,  spawnWeight: 40, color: '#8aff80', behavior: null },
      t2: { name: '飞翼',   tier: 2, hp: 3,   score: 30,   coin: 9,   radius: 24, speed: 70,  spawnWeight: 25, color: '#5ad1ff', behavior: null },
      t3: { name: '蟹甲',   tier: 3, hp: 8,   score: 80,   coin: 15,  radius: 34, speed: 48,  spawnWeight: 18, color: '#ffd166', behavior: null },
      t4: { name: '幽灵',   tier: 4, hp: 5,   score: 150,  coin: 25,  radius: 26, speed: 78,  spawnWeight: 10, color: '#c77dff', behavior: 'blink' },   // 受击概率闪现回避
      t5: { name: '精英',   tier: 5, hp: 20,  score: 300,  coin: 60,  radius: 40, speed: 60,  spawnWeight: 5,  color: '#ff8a3d', behavior: 'spiral' },    // 螺旋移动 + 周期冲刺
      t6: { name: 'Boss',   tier: 6, hp: 100, score: 1500, coin: 300, radius: 70, speed: 38,  spawnWeight: 2,  color: '#ff3d6e', behavior: null },
    },
    // 特殊行为数值(v0.3)
    BEHAVIOR: {
      blinkChance: 0.35,      // 幽灵受击时闪现概率
      blinkDist: 130,         // 闪现位移
      spiralRadius: 120,      // 精英螺旋半径
      spiralDashEvery: 2.5,   // 精英冲刺间隔
      spiralDashDur: 0.5,     // 精灵冲刺持续
      spiralDashMul: 2.6,     // 精灵冲刺速度倍率
    },

    // 波次:随时间提升高等级怪权重。难度档每 30s 一档。
    // v0.5 节奏调参:刷新更快(base 1.1→0.85、min 0.35→0.28),前期怪更密、金币产出更顺。
    WAVE: {
      difficultyInterval: 30,    // 秒
      spawnIntervalBase: 0.85,   // 初始刷新间隔
      spawnIntervalMin: 0.28,    // 最快刷新间隔
      spawnIntervalDecay: 0.92,  // 每档刷新间隔衰减
      bossEveryKills: 60,        // 每 N 击杀触发 Boss
      maxAliensOnScreen: 26,
    },

    // 技能胶囊(v0.5):场上定时掉落,飞船子弹击中即拾取;持久生效直到拾取下一个。
    POWERUP: {
      dropEvery: 9,           // 掉落间隔(秒):开局 9s 首个,之后每 9s 一个,保证前期就能玩到技能
      maxOnScreen: 3,         // 同屏胶囊上限(避免堆屏)
      radius: 16,             // 碰撞/拾取半径
      life: 12,               // 胶囊存活秒数(超时消失,鼓励主动击取)
      bobAmp: 6,              // 浮动幅度
      bobSpeed: 3,            // 浮动速度
      spawnY: 320,            // 生成 y 附近(上半屏,远离飞船,需走位或子弹够到)
    },

    // 技能定义(v0.5):activeSkill = 当前生效技能键(空 = 无技能、用武器默认弹道)。
    //   spreadMul   = 弹道数量倍率(双/三/四发直接覆盖武器 spread)
    //   damageMul   = 单发伤害倍率(火焰:×1.8)
    //   pierce      = 贯穿额外层数(激光:大数=无限贯穿;加在武器 pierce 之上)
    //   chain       = 命中后连锁的额外目标数(闪电:命中目标→弹向附近 N 只怪)
    //   chainDmgMul = 连锁伤害占命中伤害的比例(闪电 0.6)
    //   slowMul     = 怪物受击移速倍率(冰冻:0.4)
    //   slowDur     = 减速持续秒数(冰冻 1.5)
    //   burnDps     = 灼烧持续伤害/秒(火焰 1.0)
    //   burnDur     = 灼烧持续秒数(火焰 2.0)
    //   color       = 弹道/胶囊主色;label = HUD 技能名;fx = 特效类型(render 用)
    SKILLS: {
      ice:   { name: '冰冻减速弹', color: '#7fe0ff', label: '冰冻', fx: 'ice',
               slowMul: 0.4, slowDur: 1.5 },
      fire:  { name: '火焰弹',     color: '#ff7a3d', label: '火焰', fx: 'fire',
               damageMul: 1.8, burnDps: 1.0, burnDur: 2.0 },
      bolt:  { name: '闪电弹',     color: '#ffe066', label: '闪电', fx: 'bolt',
               chain: 2, chainDmgMul: 0.6 },
      laser: { name: '激光弹',     color: '#ff4dd2', label: '激光', fx: 'laser',
               pierce: 9999 },                         // 贯穿一切
      multi2:{ name: '双发散射',   color: '#9b8cff', label: '双发', fx: 'multi', spread: 2 },
      multi3:{ name: '三发散射',   color: '#5affb0', label: '三发', fx: 'multi', spread: 3 },
      multi4:{ name: '四发散射',   color: '#ffd166', label: '四发', fx: 'multi', spread: 4 },
    },
    // 胶囊掉落池(权重):攻击系四项更常见,弹道扩容稀有
    POWERUP_POOL: ['ice', 'fire', 'bolt', 'laser', 'multi2', 'multi3', 'multi4'],
    POWERUP_WEIGHTS: [22, 22, 22, 14, 10, 6, 4],

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
