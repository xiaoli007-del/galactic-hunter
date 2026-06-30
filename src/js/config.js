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
      y: HEIGHT - 180,      // 固定底部 Y(仅左右移动,Galaga 式)
      speed: 760,            // 左右跟随指针的最大移速(px/s)
      aimRange: 760,         // 自动锁敌最大半径(逻辑像素);超出则朝指针方向
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
    // v0.10 实装副炮(GDD §4.3 炮位阶梯,此前只 fireMul 未做炮位):
    //   turrets   = 副炮门数(0/1/1/2/2);turretAuto = 自动锁敌(true=Lv3+ 全向,false=Lv2 固定朝上)
    //   turretDmg = 副炮单发独立伤害(不乘 fireMul —— 乘区已在主武体现,副炮是舰载固有火力)
    //   turretRate= 副炮射速(发/秒,独立于武器射速)。自动锁敌用 Ship._findTarget(v0.7 保留未用,现启用)。
    SHIPS: {
      1: { name: '侦察艇', fireMul: 1.0, cost: 0,     glow: '#5ad1ff', turrets: 0 },
      2: { name: '驱逐舰', fireMul: 1.2, cost: 350,   glow: '#5ad1ff', turrets: 1, turretAuto: false, turretDmg: 1, turretRate: 2.0 },  // 双炮位:1门固定朝上
      3: { name: '巡洋舰', fireMul: 1.5, cost: 2600,  glow: '#7df0c0', turrets: 1, turretAuto: true,  turretDmg: 2, turretRate: 2.5 },  // +自动副炮:1门锁敌
      4: { name: '战列舰', fireMul: 2.0, cost: 11000, glow: '#ffd166', turrets: 2, turretAuto: true,  turretDmg: 2, turretRate: 3.0 },  // 三炮位:2门锁敌
      5: { name: '旗舰',   fireMul: 3.0, cost: 48000, glow: '#ff5d8f', turrets: 2, turretAuto: true,  turretDmg: 3, turretRate: 3.6 },  // 全向射击:2门锁敌+强化
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
      t2: { name: '飞翼',   tier: 2, hp: 3,   score: 30,   coin: 9,   radius: 24, speed: 70,  spawnWeight: 25, color: '#5ad1ff', behavior: null,
            fire: { pattern: 'aimed', every: 3.2, count: 1, speed: 300, telegraph: 0.5 } },   // 朝飞船瞄一发
      t3: { name: '蟹甲',   tier: 3, hp: 8,   score: 80,   coin: 15,  radius: 34, speed: 48,  spawnWeight: 18, color: '#ffd166', behavior: null,
            fire: { pattern: 'aimed', every: 3.0, count: 2, spread: 0.18, speed: 280, telegraph: 0.6 } },  // 双发小扇形
      t4: { name: '幽灵',   tier: 4, hp: 5,   score: 150,  coin: 25,  radius: 26, speed: 78,  spawnWeight: 10, color: '#c77dff', behavior: 'blink',   // 受击概率闪现回避
            fire: { pattern: 'spiral', every: 0.7, count: 2, spiralStep: 0.5, speed: 240, telegraph: 0 } },  // 闪现时双臂慢螺旋
      t5: { name: '精英',   tier: 5, hp: 20,  score: 300,  coin: 60,  radius: 40, speed: 60,  spawnWeight: 5,  color: '#ff8a3d', behavior: 'spiral' },    // 螺旋移动 + 周期冲刺
      t6: { name: 'Boss',   tier: 6, hp: 200, score: 1500, coin: 300, radius: 115, speed: 38,  spawnWeight: 2,  color: '#ff3d6e', behavior: null, boss: true,   // 固定位 + 三阶段弹幕(v0.10.5 加血加大)
            fire: { stages: {
              1: { pattern: 'aimed',  every: 2.2, count: 3, spread: 0.22, speed: 300, telegraph: 0.5 },
              2: { pattern: 'spiral', every: 0.22, count: 3, spiralStep: 0.4, speed: 270, telegraph: 0 },
              3: { pattern: 'ring',   every: 2.5, count: 16, speed: 260, telegraph: 0 },
            } } },
      // v0.8 新内容(雷电风):精英与 Boss 专有特殊机制/敌弹,与 t1–t6 本体冲撞区分。
      //   boss = 是否 Boss(独立于 tier;原 t6 用 tier===6 判定,现统一为 def.boss 标志)。
      //   fire = 敌弹发射配置(仅新内容;t1–t6 维持纯本体冲撞不发弹):
      //     pattern: 'aimed'(瞄准扇形)/ 'spiral'(多臂螺旋,每次按 spiralStep 旋转)/ 'ring'(全圆均布)
      //     every: 发射间隔(s);count: 每次发射弹数(aimed=扇内弹数/spiral=臂数/ring=圆周弹数)
      //     spread: aimed 扇形总张角(弧);speed: 弹速;telegraph: 发射前预警时长(s,0=无)
      //     spiralStep: spiral 每次发射的旋转增量(弧);stages: Boss 按 bossStage 切换弹幕
      t7: { name: '撕裂者', tier: 7, hp: 28,  score: 400,  coin: 70,  radius: 30, speed: 64,  spawnWeight: 3,  color: '#ff4d6d', behavior: 'dash' },      // 预警→锁定方向直线突进(可读可躲)
      t8: { name: '守卫者', tier: 7, hp: 40,  score: 500,  coin: 90,  radius: 32, speed: 46,  spawnWeight: 3,  color: '#ff8c42', behavior: 'gunner',           // 周期朝飞船发射瞄准敌弹
            fire: { pattern: 'aimed', every: 2.6, count: 3, spread: 0.24, speed: 320, telegraph: 0.55 } },
      t9: { name: '钢铁巨像', tier: 8, hp: 500, score: 4000, coin: 600, radius: 135, speed: 30, spawnWeight: 0, color: '#9fb4c8', behavior: null, boss: true,   // 中 Boss·固定位三阶段弹幕(v0.10.5 加血加大)
            fire: { stages: {
              1: { pattern: 'aimed',  every: 1.8, count: 3, spread: 0.20, speed: 330, telegraph: 0.45 },
              2: { pattern: 'spiral', every: 0.16, count: 3, spiralStep: 0.34, speed: 280, telegraph: 0 },
              3: { pattern: 'ring',    every: 2.2, count: 18, speed: 250, telegraph: 0 },
            } } },
      t10: { name: '虚空吞噬者', tier: 9, hp: 1200, score: 12000, coin: 1500, radius: 155, speed: 26, spawnWeight: 0, color: '#b14dff', behavior: null, boss: true,   // 终 Boss·固定位三阶段密集弹幕 + 召唤(v0.10.5 加血加大)
            summonType: 't2', summonCount: 3,     // 阶段≥2 召唤飞翼(沿用 _bossSummon,override 全局 summonType/Count)
            fire: { stages: {
              1: { pattern: 'spiral', every: 0.13, count: 4, spiralStep: 0.28, speed: 300, telegraph: 0 },   // 四臂螺旋
              2: { pattern: 'ring',   every: 1.9, count: 22, speed: 280, telegraph: 0 },                       // 密集环
              3: { pattern: 'spiral', every: 0.10, count: 6, spiralStep: 0.24, speed: 330, telegraph: 0 },   // 六臂急旋
            } } },
      // v0.10.3:扩展怪(AI 贴图已生成接入)。t11-t20 已接入;t21-t23 待生图后补。
      //   全 AI 贴图、画风与 t1-t10 统一;发弹配置沿用分级(小怪 aimed/精英 spiral+ring)。
      t11: { name: '装甲水母',   tier: 2, hp: 2,  score: 20,  coin: 6,   radius: 22, speed: 78, spawnWeight: 22, color: '#4dd0e1', behavior: null,
             fire: { pattern: 'aimed', every: 3.5, count: 1, speed: 280, telegraph: 0.5 } },
      t12: { name: '双足机甲',   tier: 3, hp: 6,  score: 70,  coin: 14,  radius: 28, speed: 52, spawnWeight: 16, color: '#8d6e63', behavior: null,
             fire: { pattern: 'aimed', every: 2.8, count: 2, spread: 0.2, speed: 290, telegraph: 0.55 } },
      t13: { name: '飞镖无人机', tier: 2, hp: 3,  score: 35,  coin: 8,   radius: 20, speed: 88, spawnWeight: 20, color: '#b39ddb', behavior: null,
             fire: { pattern: 'aimed', every: 2.5, count: 1, speed: 340, telegraph: 0.4 } },
      t14: { name: '装甲海星',   tier: 3, hp: 7,  score: 85,  coin: 16,  radius: 30, speed: 50, spawnWeight: 14, color: '#ffb74d', behavior: null,
             fire: { pattern: 'ring', every: 3.5, count: 8, speed: 240, telegraph: 0 } },
      t15: { name: '钻头钻探者', tier: 4, hp: 10, score: 110, coin: 20,  radius: 26, speed: 64, spawnWeight: 10, color: '#90a4ae', behavior: null,
             fire: { pattern: 'aimed', every: 2.6, count: 1, speed: 320, telegraph: 0.45 } },
      t16: { name: '晶簇机械体', tier: 3, hp: 8,  score: 90,  coin: 17,  radius: 28, speed: 56, spawnWeight: 13, color: '#4db6ac', behavior: null,
             fire: { pattern: 'spiral', every: 0.5, count: 2, spiralStep: 0.45, speed: 230, telegraph: 0 } },
      t17: { name: '蜂巢炮台',   tier: 4, hp: 12, score: 130, coin: 24,  radius: 32, speed: 46, spawnWeight: 9,  color: '#fff176', behavior: null,
             fire: { pattern: 'ring', every: 2.8, count: 12, speed: 260, telegraph: 0.4 } },
      t18: { name: '回旋镖翼',   tier: 2, hp: 4,  score: 40,  coin: 9,   radius: 24, speed: 84, spawnWeight: 18, color: '#7986cb', behavior: null,
             fire: { pattern: 'aimed', every: 3.0, count: 1, speed: 300, telegraph: 0.5 } },
      t19: { name: '装甲鳐',     tier: 3, hp: 9,  score: 95,  coin: 18,  radius: 30, speed: 54, spawnWeight: 12, color: '#a1887f', behavior: null,
             fire: { pattern: 'aimed', every: 2.7, count: 2, spread: 0.16, speed: 285, telegraph: 0.5 } },
      t20: { name: '齿轮巨虫',   tier: 4, hp: 11, score: 120, coin: 22,  radius: 30, speed: 48, spawnWeight: 9,  color: '#cfd8dc', behavior: null,
             fire: { pattern: 'spiral', every: 0.35, count: 3, spiralStep: 0.38, speed: 250, telegraph: 0 } },
    },
    // 特殊行为数值(v0.3)
    BEHAVIOR: {
      blinkChance: 0.35,      // 幽灵受击时闪现概率
      blinkDist: 130,         // 闪现位移
      spiralRadius: 120,      // 精英螺旋半径
      spiralDashEvery: 2.5,   // 精英冲刺间隔
      spiralDashDur: 0.5,     // 精灵冲刺持续
      spiralDashMul: 2.6,     // 精灵冲刺速度倍率
      // v0.8 t7 撕裂者:预警突进(锁定方向后直线高速冲撞)
      dashTelegraph: 0.6,     // 预警蓄能时长(锁定方向,玩家可读可躲)
      dashSpeedMul: 5.5,      // 突进速度倍率
      dashReposition: 1.4,    // 突进结束/出界后重新入场前的间隔
    },

    // 波次:随时间提升高等级怪权重。难度档每 30s 一档。
    // v0.5 节奏调参:刷新更快(base 1.1→0.85、min 0.35→0.28),前期怪更密、金币产出更顺。
    WAVE: {
      difficultyInterval: 30,    // 秒
      spawnIntervalBase: 0.85,   // 初始刷新间隔
      spawnIntervalMin: 0.28,    // 最快刷新间隔
      spawnIntervalDecay: 0.92,  // 每档刷新间隔衰减
      bossEveryKills: 60,        // 每 N 击杀触发 Boss
      bossAlertDuration: 4.0,    // v0.10.7:Boss 入场前警报持续秒(3-4s 营造压迫感,期间 Boss 不入场)
      maxAliensOnScreen: 26,
      // v0.8:Boss 轮换 —— 每个触发点按序循环 t6→t9→t10→t6…,避免单一 Boss。
      bossRotation: ['t6', 't9', 't10'],
    },

    // 敌弹(v0.8):新精英/Boss 发射的子弹。伤害=1(与本体撞击一致:消一格护盾或扣 1 hp),
    //   走飞船 takeHit 同路径,护盾/反射/无敌帧自动兼容;弹速由各怪 fire.speed 覆盖。
    ENEMY_BULLET: {
      radius: 7,            // 碰撞/渲染半径
      damage: 1,           // 单发伤害(1 = 一次护盾格 / 1 hp)
      color: '#ff5470',    // 默认弹色(各怪 fire 可经 def.color 染色)
      maxOnScreen: 140,    // 同屏敌弹上限(v0.10.3:小怪全员发弹后调高,防频繁触顶丢弹)
      trail: 6,            // 拖尾点数
    },

    // 副炮弹(v0.10):船舰自带副炮发射的子弹。独立弹速/色/半径,不贯穿(pierce=0)。
    //   复用 Bullet 实体(skill=null + 覆盖 color/radius/pierce),渲染/碰撞链路通用、零特判。
    //   伤害由 SHIPS[shipLevel].turretDmg 决定(不乘 fireMul);纯物理不吃技能。
    TURRET: {
      speed: 720,       // 副炮弹速(独立于武器)
      color: '#9bff7a', // 副炮弹色(亮绿,与主武弹道区分)
      radius: 3.6,     // 副炮弹半径(细于主武 5)
      pierce: 0,       // 不贯穿(命中即销毁)
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
      speedMul:  { 1: 1.0, 2: 1.4, 3: 1.9 },   // 各阶段移速倍率(v0.10.5:Boss 固定位不再用,保留)
      summonEvery: { 2: 3.5, 3: 2.2 },          // 召唤间隔(秒);阶段 1 不召唤
      summonType: 't2',                          // 召唤的小怪
      summonCount: 2,                            // 每次召唤数量
      dashEvery: 2.8,                            // 阶段 3 冲刺间隔(v0.10.5:Boss 不再冲刺,保留)
      dashSpeedMul: 4.5,                         // 冲刺速度倍率(保留)
      dashDuration: 0.6,                         // 冲刺持续(保留)
      bossY: 340,                                // v0.10.7:Boss 锚点 Y —— 飞船对面(飞船在 HEIGHT-180=1100;Boss 留上方,与飞船上下对峙,中间留弹道纵深)
      bossScale: 1.35,                          // v0.10.7:Boss 整体放大倍率(t6/t9/t10 更大更有压迫感)
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

    // v0.10.9:背景音乐曲目表(多首可切换)。HUD 切歌按钮循环切换,当前曲目持久化(localStorage 'gh_bgm_track')。
    //   name 用于切歌飘字提示;url 为相对 index.html 的路径(文件名纯 ASCII、无空格/括号)。
    //   sound.js 读此表;缺失时退回内置默认两首,保证健壮。
    BGM: {
      volume: 0.35,
      tracks: [
        { name: '银河流光', url: 'src/assets/audio/bgm.mp3' },
        { name: '赛博朋克', url: 'src/assets/audio/bgm2.mp3' },
      ],
    },
  };

  G.Config = Config;
})(window.G = window.G || {});
