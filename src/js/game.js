/*
 * Galactic Hunter — game.js
 * 游戏逻辑层(对应 GDD §9.2 第三层主控)
 *
 * 职责:状态机、波次刷新、碰撞结算、经济、升级、存档、UI。
 * 不直接依赖 DOM/窗口,所有环境能力经 G.Platform 获取 —— 保证移植小游戏时本文件不动。
 */
(function (G) {
  'use strict';
  var E = G.Engine, P = G.Platform, C = G.Config, R = G.Render, Ent = G.Entities, Snd = null;

  var STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover', LEADERBOARD: 'leaderboard' };

  // —— 布局(逻辑坐标 720×1280)——
  var TOP_H = 104, BOT_H = 156;

  var Game = {
    state: STATE.MENU,
    time: 0,           // 全局渲染时间(背景动画用,不依赖 Math.random)
    battleTime: 0,     // 本局战斗计时
    score: 0,
    coins: 0,
    highScore: 0,
    weaponLevel: 1,
    shipLevel: 1,      // 船舰等级(乘区)
    defenseLevel: 1,   // 防御等级(充能护盾)

    leaderboard: [],        // 本机战绩榜 Top-10(v0.4,独立存储键,避免随金币频繁写入)
    _lastEntryTs: 0,        // 最近一次入榜记录的时间戳(榜单高亮该局用)
    _lbReturnState: 'menu', // 排行榜返回的目标状态(从菜单/结算进入则原路返回)

    ship: null,
    bullets: [], aliens: [], particles: [], explosions: [], coinsArr: [], texts: [], powerups: [],
    enemyBullets: [],         // v0.8:新精英/Boss 发射的敌弹(与玩家弹分库,碰撞走 ship.takeHit)

    activeSkill: null,        // v0.5:当前生效技能(SKILLS 键);持久直到拾取下一个
    powerupTimer: 0,          // 胶囊掉落倒计时

    spawnTimer: 0,
    killCount: 0,
    fireTimer: 0,
    screenFlash: 0,
    _clickConsumed: false,
    _bossIdx: 0,              // v0.8:Boss 轮换序号(t6→t9→t10→t6…);startGame 重置为 0(首 Boss 恒 t6)
    turretTimer: 0,           // v0.10:副炮自动开火计时(按 SHIPS[shipLevel].turretRate 节奏连发)
    bossAlert: 0,             // v0.10.4:Boss 出现警报剩余秒(>0 时渲染 EVA 式红条警报)
    _bossSpawned: false,      // v0.10.7:本轮 Boss 已触发(警报或在场期间抑制重复触发)
    _bossPending: false,      // v0.10.7:Boss 警报中、尚未入场(警报结束后才召唤)
    _bossPendingType: null,   // v0.10.7:待入场的 Boss 类型(pending 期间暂存)
    _hadBoss: false,          // v0.10.7:上一帧是否有活 Boss(用于死亡下降沿复位 _bossSpawned)
    _bossCooldown: 0,         // v0.11.1:Boss 死亡后冷却秒(期间不触发新 Boss,防连触发)

    init: function () {
      this.loadSave();
      this.loadLeaderboard();
      this.ship = new Ent.Ship(C);
      this._syncShipVisual();            // 船舰等级 → 飞船渲染状态(体型/光晕)
      this._applyDefense();              // 防御等级 → 护盾充能/复活状态
      G.Assets && G.Assets.init();        // 异步加载贴图(渐进增强,缺失自动退回程序化)
      G.Sound && G.Sound.init(); Snd = G.Sound;  // 音效(无 AudioContext 则 no-op)
      G.Platform.init(document.getElementById('stage'));
      E.startLoop(this.update.bind(this), this.render.bind(this));
    },

    // —— 存档 ——
    loadSave: function () {
      var s = P.getStorage('save') || {};
      this.coins = s.coins != null ? s.coins : C.START.coins;
      this.weaponLevel = s.weaponLevel || C.START.weaponLevel;
      this.shipLevel = s.shipLevel || C.START.shipLevel;
      this.defenseLevel = s.defenseLevel || C.START.defenseLevel;
      this.highScore = s.highScore || 0;
    },
    save: function () {
      P.setStorage('save', {
        coins: this.coins, weaponLevel: this.weaponLevel, shipLevel: this.shipLevel, defenseLevel: this.defenseLevel, highScore: this.highScore
      });
    },

    // —— 战绩排行榜(v0.4)——
    // 独立存储键 'leaderboard',不并入 'save'(save 在每局金币拾取时频繁写入,
    // 榜单变更频率低,分键避免无谓序列化,移植小游戏也只需在 platform.js 换实现)。
    loadLeaderboard: function () {
      this.leaderboard = P.getStorage('leaderboard') || [];
    },
    saveLeaderboard: function () {
      P.setStorage('leaderboard', this.leaderboard);
    },
    // 单局结算入榜:0 分不记(避免空局占榜),降序取 Top 10;记录波次/击杀/装备便于回看
    submitScore: function () {
      if (this.score <= 0) return;
      var tier = Math.floor(this.battleTime / C.WAVE.difficultyInterval);
      var entry = {
        score: this.score, ts: Date.now(),
        wave: tier + 1, kills: this.killCount,
        weapon: this.weaponLevel, ship: this.shipLevel, defense: this.defenseLevel,
      };
      this.leaderboard.push(entry);
      // 同分按时间新→旧排前(后入的同分局更靠前)
      this.leaderboard.sort(function (a, b) { return b.score - a.score || b.ts - a.ts; });
      if (this.leaderboard.length > 10) this.leaderboard.length = 10;  // 截断 Top 10
      this._lastEntryTs = entry.ts;
      this.saveLeaderboard();
    },
    openLeaderboard: function () {
      this._lbReturnState = this.state;          // 记下来处,返回时回退到原状态
      this.state = STATE.LEADERBOARD;
    },
    closeLeaderboard: function () {
      this.state = this._lbReturnState || STATE.MENU;
    },

    startGame: function () {
      this.state = STATE.PLAYING;
      Snd && Snd.bgmStart();   // v0.10.8:开始游戏播背景音乐(首次用户交互后允许播放)
      this.score = 0;
      this.battleTime = 0;
      this.spawnTimer = 0;
      this.killCount = 0;
      this.fireTimer = 0;
      this.bullets.length = 0;
      this.aliens.length = 0;
      this.particles.length = 0;
      this.coinsArr.length = 0;
      this.texts.length = 0;
      this.powerups.length = 0;
      this.enemyBullets.length = 0;         // v0.8:清空场上敌弹
      this._bossIdx = 0;                    // v0.8:Boss 轮换序号归零(首 Boss 恒 t6)
      this._bossSpawned = false;            // v0.10.7:每局重置 Boss 触发标志
      this._bossPending = false;            // v0.10.7:每局重置 Boss 警报/待入场状态
      this._bossPendingType = null;
      this._hadBoss = false;                // v0.10.7:每局重置 Boss 在场追踪
      this._bossCooldown = 0;               // v0.11.1:每局重置 Boss 冷却
      this.bossAlert = 0;                   // v0.10.7:每局重置警报
      this.activeSkill = null;             // v0.5:每局重置技能(开局用武器默认弹道)
      this.turretTimer = 0;               // v0.10:副炮计时归零(每局重置,与主开火解耦)
      this.powerupTimer = G.Config.POWERUP.dropEvery;   // 首个胶囊倒计时
      this.ship._aliens = this.aliens;      // v0.5:同步目标列表给飞船自动锁敌(避免实体反向依赖 Game)
      this.ship.hp = this.ship.maxHp;
      this.ship.hitFlash = 0;
      this.ship.invuln = 1.0;
      // 防御线:每局重置护盾充能 + 复活次数(等级本身持久化,消耗是单局的)
      this.ship.shield = this.ship.maxShield;
      this.ship.shieldRegenTimer = this.ship.shieldRegenDelay;
      this.ship.revivesLeft = this.ship.canRevive ? 1 : 0;
    },

    gameOver: function () {
      this.state = STATE.GAMEOVER;
      this.screenFlash = 0.6;
      Snd && Snd.bgmPause();   // v0.10.8:游戏结束暂停背景音乐
      if (this.score > this.highScore) { this.highScore = this.score; }
      this.submitScore();          // v0.4:本局入榜(0 分不记)
      this.save();
    },

    // —— 暂停(P/ESC 或暂停按钮)——冻结逻辑但仍渲染世界 + 暂停遮罩 ——
    _pause: function () {
      this.state = STATE.PAUSED;
      Snd && Snd.bgmPause();   // v0.10.8:暂停时暂停背景音乐
      P.pointer.down = false; P.pointer.justPressed = false;   // 防暂停瞬间的按下被当开火
    },
    _resume: function () {
      this.state = STATE.PLAYING;
      Snd && Snd.bgmStart();   // v0.10.8:恢复游戏继续播放背景音乐
      P.pointer.down = false; P.pointer.justPressed = false;   // 防继续按钮按下被当开火
    },
    // 放弃本局回主菜单(暂停/结算页用)。清场上残留,避免下次开局前短暂残留。
    returnToMenu: function () {
      this.state = STATE.MENU;
      Snd && Snd.bgmPause();   // v0.10.8:回菜单暂停背景音乐
      this.bullets.length = 0; this.aliens.length = 0;
      this.enemyBullets.length = 0; this.particles.length = 0; this.explosions.length = 0;
      this.coinsArr.length = 0; this.texts.length = 0; this.powerups.length = 0;
      P.pointer.down = false; P.pointer.justPressed = false;
    },

    drawPaused: function (ctx) {
      var W = C.WIDTH, H = C.HEIGHT;
      ctx.save();
      ctx.fillStyle = 'rgba(5,7,14,0.72)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#5ad1ff';
      ctx.shadowColor = '#5ad1ff'; ctx.shadowBlur = 20;
      ctx.font = 'bold 48px Arial';
      ctx.fillText('已 暂 停', W / 2, H / 2 - 110);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '16px Arial';
      ctx.fillText('按 P 或 ESC 继续', W / 2, H / 2 - 70);

      var bw = 280, bh = 70, bx = W / 2 - bw / 2, by = H / 2 - 30;
      if (this._button(ctx, bx, by, bw, bh, '▶  继 续 游 戏', true, false)) this._resume();
      var bw2 = 280, bh2 = 48, bx2 = W / 2 - bw2 / 2, by2 = by + bh + 18;
      if (this._button(ctx, bx2, by2, bw2, bh2, '◀  返 回 主 菜 单', true, true)) this.returnToMenu();
      ctx.restore();
    },

    // v0.10.4/v0.10.7:Boss 警报(EVA 式)—— 上下红条 + 警告字 + 倒计时。
    //   bossAlert>0 时每帧画;pending 阶段(Boss 入场前)显示"BOSS 逼近"+ 倒计时秒数,
    //   非pending(Boss 已在场,调试触发)显示"BOSS 接近"。8Hz 闪烁营造压迫感。
    drawBossAlert: function (ctx) {
      var W = C.WIDTH, H = C.HEIGHT;
      var t = this.time;
      var barH = 54;
      var pulse = 0.5 + 0.5 * Math.sin(t * 16);   // 8Hz 闪烁(警报节奏)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // 上下红条(半透明红 + 扫描亮线)
      var barA = 0.55 + pulse * 0.35;
      var grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, 'rgba(255,30,40,0)');
      grad.addColorStop(0.5, 'rgba(255,40,50,' + barA + ')');
      grad.addColorStop(1, 'rgba(255,30,40,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, barH);                 // 顶部
      ctx.fillRect(0, H - barH, W, barH);          // 底部
      // 横向扫描亮线(来回移动,赛博警报感)
      var scanX = (Math.sin(t * 2.5) * 0.5 + 0.5) * W;
      ctx.fillStyle = 'rgba(255,200,200,' + (0.4 + pulse * 0.4) + ')';
      ctx.fillRect(scanX - 3, 0, 6, barH);
      ctx.fillRect(W - scanX - 3, H - barH, 6, barH);
      ctx.globalCompositeOperation = 'source-over';
      // v0.10.14:警告文字移到屏幕中央(原在顶条内不明显),大字 + 脉动 + 倒计时,压迫感。
      var secs = Math.ceil(this.bossAlert);
      var msg = this._bossPending ? ('⚠  BOSS 逼近  ' + secs + ' S  ⚠') : '⚠  BOSS 接近  ⚠';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 中央半透明黑底衬(让红字在任意背景下都清晰)
      ctx.fillStyle = 'rgba(0,0,0,' + (0.45 + pulse * 0.2) + ')';
      ctx.fillRect(W / 2 - 230, H / 2 - 50, 460, 100);
      // 红字 + 红描边 + 发光
      ctx.font = 'bold 48px Arial';
      ctx.strokeStyle = 'rgba(120,0,10,' + (0.8 + pulse * 0.2) + ')';
      ctx.lineWidth = 6;
      ctx.strokeText(msg, W / 2, H / 2);
      ctx.fillStyle = 'rgba(255,' + (90 + pulse * 80) + ',' + (90 + pulse * 80) + ',' + (0.85 + pulse * 0.15) + ')';
      ctx.shadowColor = '#ff2030'; ctx.shadowBlur = 24;
      ctx.fillText(msg, W / 2, H / 2);
      ctx.shadowBlur = 0;
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
    },

    // ================= 主循环 =================
    update: function (dt) {
      this.time += dt;
      this._lastDt = dt;   // v0.10.15:供 render 的动态背景推进星空视差用
      if (this.screenFlash > 0) this.screenFlash -= dt * 2;
      if (this.bossAlert > 0) this.bossAlert -= dt;   // v0.10.4:Boss 警报倒计时
      // FPS 统计(0.5s 滑窗)
      this._fpsFr = (this._fpsFr || 0) + 1;
      this._fpsTm = (this._fpsTm || 0) + dt;
      if (this._fpsTm >= 0.5) { this.fps = Math.round(this._fpsFr / this._fpsTm); this._fpsFr = 0; this._fpsTm = 0; }

      // 暂停切换(P/ESC,或暂停按钮)。在任意状态都检测,仅 PLAYING↔PAUSED 间切。
      // 切换时清指针状态,避免"继续"按钮的按下被当成开火。
      if (P.isKeyJustPressed('p') || P.isKeyJustPressed('escape')) {
        if (this.state === STATE.PLAYING) { this._pause(); return; }
        if (this.state === STATE.PAUSED) { this._resume(); return; }
      }
      // 调试:按数字键 1-5 直接把船舰设为对应等级 + 金币拉满(检视各级飞船贴图用)。
      //   不调武器/防御,只切飞船;金币拉满方便你在底栏继续手动升武器。
      for (var lvl = 1; lvl <= 5; lvl++) {
        if (P.isKeyJustPressed(String(lvl)) && this.shipLevel !== lvl) {
          this.coins = 999999;             // 拉满金币
          this.shipLevel = lvl;
          this._syncShipVisual();
          this.texts.push(new Ent.FloatingText(this.ship.x, this.ship.y - 70,
            '🔧 船舰 Lv' + lvl + ' ' + C.SHIPS[lvl].name, C.SHIPS[lvl].glow, 26));
          this.screenFlash = 0.2;
          break;
        }
      }
      // 调试:按 B 键立即召唤下一个 Boss + 警报(检视放大后的 Boss + EVA 警报用)
      if (P.isKeyJustPressed('b')) {
        var rot2 = C.WAVE.bossRotation;
        var bt = rot2[this._bossIdx % rot2.length];
        this._bossIdx++;
        this.spawnAlien(0, bt);
        this.bossAlert = C.WAVE.bossAlertDuration;
        var bDef2 = C.ALIENS[bt];
        this.texts.push(new Ent.FloatingText(C.WIDTH / 2, C.HEIGHT / 2, '⚠ ' + bDef2.name + ' 出现', bDef2.color, 38));
        Snd && Snd.play('boss');
      }
      if (this.state !== STATE.PLAYING) return;

      this.battleTime += dt;
      this.ship.update(dt);

      // 开火:点击瞬间立即开火一次(消除首次延迟),按住则按射速连发
      var w = C.WEAPONS[this.weaponLevel];
      var interval = 1 / w.fireRate;
      if (P.pointer.justPressed) {
        this.fire(w);
        this.fireTimer = 0;        // 从本次开火起重新计时连发
        this._fireTurrets(1.0);    // v0.10.12:副炮改手动——跟随主弹点击瞬间一起开(不再自动)
      }
      if (P.pointer.down) {
        this.fireTimer += dt;
        while (this.fireTimer >= interval) {
          this.fire(w);
          this.fireTimer -= interval;
          this._fireTurrets(dt);   // v0.10.12:按住连发时副炮也跟随节奏开火
        }
      } else {
        this.fireTimer = 0;
        this.turretTimer = 0;      // v0.10.12:松开重置副炮计时
      }

      this.updateWaves(dt);
      this.updateEntities(dt);
      this.collisions();
      this.cleanup();

      // 防御线:hp 归零先尝试不灭屏障复活,复活失败才结算
      if (this.ship.hp <= 0) {
        if (this.ship.revive()) {
          this.screenFlash = 0.5;
          this.texts.push(new Ent.FloatingText(C.WIDTH / 2, C.HEIGHT / 2, '★ 护盾过载! 复活', '#ffd166', 34));
        } else {
          this.gameOver();
        }
      }
    },

    // —— 开火 ——
    // v0.5:activeSkill 叠加在武器之上 ——
    //   spread(双/三/四发)覆盖武器弹道数;damageMul(火焰)放大单发;pierce(激光)加贯穿层;
    //   技能弹道色覆盖武器色。无技能时用武器默认。技能持久,直到拾取下一个胶囊。
    fire: function (w) {
      Snd && Snd.play('fire');
      var a = this.ship.aimAngle;
      var sk = this.activeSkill ? C.SKILLS[this.activeSkill] : null;
      var n = (sk && sk.spread) ? sk.spread : w.spread;   // 技能弹道数覆盖武器
      var step = 0.12;
      var ox = Math.cos(a) * this.ship.radius * 1.1;
      var oy = Math.sin(a) * this.ship.radius * 1.1;
      var fireMul = C.SHIPS[this.shipLevel].fireMul;   // 船舰乘区:放大武器单发伤害
      var dmg = w.damage * fireMul * (sk && sk.damageMul ? sk.damageMul : 1);  // 火焰 ×1.8
      for (var i = 0; i < n; i++) {
        var off = n === 1 ? 0 : (i - (n - 1) / 2) * step;
        var ang = a + off;
        var b = new Ent.Bullet(
          this.ship.x + ox, this.ship.y + oy,
          Math.cos(ang) * w.speed, Math.sin(ang) * w.speed, w, dmg, sk);
        b.weaponLevel = this.weaponLevel;  // 传递武器等级给弹道渲染
        b.spreadCount = i;  // 弹道序号,用于贴图行选择
        this.bullets.push(b);
      }
    },

    // v0.10:船舰副炮自动开火 —— 按 SHIPS[shipLevel] 配置自动连发辅助火力(GDD §4.3 炮位阶梯)。
    //   门数 turrets:0(无)/1(Lv2-3)/2(Lv4-5);turretAuto:固定朝上(Lv2)或自动锁敌(Lv3+,「全向射击」)。
    //   副炮弹独立伤害(不乘 fireMul)、纯物理(skill=null 不吃技能);复用 Bullet,渲染/碰撞链路通用零特判。
    //   自动锁敌用 Ship._findTarget(v0.7 保留未用,现启用);无目标退回朝上。
    _fireTurrets: function (dt) {
      var sDef = C.SHIPS[this.shipLevel];
      var n = sDef.turrets || 0;
      if (n <= 0) { this.turretTimer = 0; return; }
      var interval = 1 / sDef.turretRate;
      this.turretTimer += dt;
      if (this.turretTimer < interval) return;
      this.turretTimer -= interval;          // 仅扣一发间隔(累计防漏发)
      var r = this.ship.radius, sx = this.ship.x, sy = this.ship.y;
      // 副炮座位置:1门居中(船体下部);2门机翼左右对称
      var offs = n === 1 ? [0] : [-r * 0.5, r * 0.5];
      // 发射方向:固定模式朝上(-π/2);自动模式锁最近敌,无目标退回朝上
      var base = -Math.PI / 2;
      if (sDef.turretAuto) {
        var tgt = this.ship._findTarget();
        if (tgt) base = Math.atan2(tgt.y - sy, tgt.x - sx);
      }
      for (var i = 0; i < n; i++) this._fireTurret(sx + offs[i], sy, base, sDef);
    },
    _fireTurret: function (x, y, ang, sDef) {
      var T = C.TURRET;
      var b = new Ent.Bullet(x, y, Math.cos(ang) * T.speed, Math.sin(ang) * T.speed,
        C.WEAPONS[this.weaponLevel], sDef.turretDmg, null);
      b.color = T.color;     // 副炮弹色(覆盖武器色)
      b.radius = T.radius;   // 副炮弹更细(覆盖默认 5)
      b.pierce = T.pierce;   // 不贯穿(覆盖武器 pierce)
      b.turret = true;       // 标记副炮弹(render 可选区分,目前沿用通用渲染)
      this.bullets.push(b);
    },

    // —— 波次刷新 ——
    updateWaves: function (dt) {
      this.spawnTimer -= dt;
      var tier = Math.floor(this.battleTime / C.WAVE.difficultyInterval);
      var interval = Math.max(C.WAVE.spawnIntervalMin,
        C.WAVE.spawnIntervalBase * Math.pow(C.WAVE.spawnIntervalDecay, tier));
      if (this.spawnTimer <= 0 && this.aliens.length < C.WAVE.maxAliensOnScreen) {
        this.spawnAlien(tier);
        this.spawnTimer = interval;
      }
      // Boss 触发(v0.10.7:警报提前 + 延迟入场 + 单波单 Boss,不堆叠)
      //   ① 击杀达阈值且当前无 Boss/无 pending → 进入 _bossPending:启动警报(4s),暂不召唤。
      //   ② 警报期间不召唤 Boss(营造压迫感);bossAlert 归零才 spawnAlien 入场。
      //   ③ Boss 在场或 pending 期间抑制新触发;Boss 死亡后(_anyBossAlive=false)才复位 _bossSpawned。
      //   v0.11.1:_bossCooldown 死亡后冷却 6s,防 Boss+召唤仆从都计 killCount 致连环触发/视觉堆叠。
      if (this._bossCooldown > 0) this._bossCooldown -= dt;
      if (this.killCount > 0 && this.killCount % C.WAVE.bossEveryKills === 0 && !this._bossSpawned && !this._bossPending && this._bossCooldown <= 0) {
        var rot = C.WAVE.bossRotation;
        this._bossPendingType = rot[this._bossIdx % rot.length];
        this._bossIdx++;
        this._bossPending = true;
        this._bossSpawned = true;
        this.bossAlert = C.WAVE.bossAlertDuration;   // v0.10.7:Boss 入场前警报 4s(红条闪烁 + 警告字)
        Snd && Snd.play('boss');
      }
      // 警报结束 → Boss 真正入场(飘字用 Boss 名与色)
      if (this._bossPending && this.bossAlert <= 0) {
        var bDef = C.ALIENS[this._bossPendingType];
        this.spawnAlien(tier, this._bossPendingType);
        this._bossPending = false;
        this._bossPendingType = null;
        this.texts.push(new Ent.FloatingText(C.WIDTH / 2, C.HEIGHT / 2, '⚠ ' + bDef.name + ' 出现', bDef.color, 38));
        Snd && Snd.play('boss');
      }
      // 当前轮 Boss 击杀完毕(无 pending 且场上无活 Boss)→ 复位 _bossSpawned,允许下一轮触发。
      //   用 _hadBoss 追踪上一帧是否有活 Boss,只在"有 Boss → 无 Boss"的下降沿复位,
      //   避免死亡瞬间 killCount 恰好又到阈值时立即重触发(取模判断不可靠,改边沿检测)。
      var bossAliveNow = this._anyBossAlive();
      if (this._hadBoss && !bossAliveNow && !this._bossPending) {
        this._bossSpawned = false;
        this._bossCooldown = 6.0;   // v0.11.1:Boss 死亡后冷却 6s 才允许下一轮触发(防连触发/视觉堆叠)
      }
      this._hadBoss = bossAliveNow;

      // v0.5:定时掉落技能胶囊
      this.powerupTimer -= dt;
      if (this.powerupTimer <= 0 && this.powerups.length < C.POWERUP.maxOnScreen) {
        this.spawnPowerUp();
        this.powerupTimer = C.POWERUP.dropEvery;
      }
    },

    // v0.10.7:场上是否还有活 Boss(用于单波单 Boss 判定:Boss 死亡后才允许下一轮触发)
    _anyBossAlive: function () {
      for (var i = 0; i < this.aliens.length; i++) {
        if (this.aliens[i].isBoss && !this.aliens[i].dead) return true;
      }
      return false;
    },

    // v0.5:按权重池随机一个技能,在上半屏随机位置生成胶囊
    spawnPowerUp: function () {
      var key = E.weighted(C.POWERUP_POOL, C.POWERUP_WEIGHTS);
      var x = E.rand(80, C.WIDTH - 80);
      var y = C.POWERUP.spawnY + E.rand(-40, 40);
      this.powerups.push(new Ent.PowerUp(key, x, y));
    },

    spawnAlien: function (tier, forceType) {
      var keys = Object.keys(C.ALIENS);
      var weights = keys.map(function (k) {
        var d = C.ALIENS[k];
        var mul = 1;
        // 难度档越高,高级怪越常见
        if (d.tier >= 3) mul *= 1 + 0.35 * tier;
        if (d.tier >= 5) mul *= 1 + 0.5 * tier;
        return d.spawnWeight * mul;
      });
      var type = forceType || E.weighted(keys, weights);
      var def = C.ALIENS[type];
      var x = def.boss ? C.WIDTH / 2 : E.rand(60, C.WIDTH - 60);   // v0.10.5:Boss 正中入场
      var y = -def.radius - 10;
      this.aliens.push(new Ent.Alien(type, x, y));
    },

    updateEntities: function (dt) {
      for (var i = 0; i < this.bullets.length; i++) this.bullets[i].update(dt);
      for (var j = 0; j < this.aliens.length; j++) this.aliens[j].update(dt);
      for (var k = 0; k < this.particles.length; k++) this.particles[k].update(dt);
      for (var e = 0; e < this.explosions.length; e++) this.explosions[e].update(dt);
      for (var eb = 0; eb < this.enemyBullets.length; eb++) this.enemyBullets[eb].update(dt);  // v0.8
      for (var m = 0; m < this.texts.length; m++) this.texts[m].update(dt);
      for (var n = 0; n < this.coinsArr.length; n++) this.coinsArr[n].update(dt, this.ship);
      for (var p = 0; p < this.powerups.length; p++) this.powerups[p].update(dt);
    },

    // —— 碰撞结算 ——
    collisions: function () {
      // 子弹 ↔ 怪物(含技能效果:减速 / 灼烧 / 连锁)
      for (var i = 0; i < this.bullets.length; i++) {
        var b = this.bullets[i];
        if (b.dead) continue;
        for (var j = 0; j < this.aliens.length; j++) {
          var a = this.aliens[j];
          if (a.dead) continue;
          if (E.circleHit(b, a)) {
            if (!b.hit(a)) continue;          // 已命中过则跳过
            this._applyBulletHit(b, a);
            if (a.dead) { this.killAlien(a); Snd && Snd.play('kill'); }
            // v0.5 闪电:命中后连锁到附近 N 只怪(部分伤害),用子弹色画电弧
            if (b.skill && b.skill.chain) this._chainLightning(b, a);
            // 激光/贯穿弹可继续打下一个目标,普通弹命中即 dead(b.hit 已处理)
            if (b.dead) break;
          }
        }
      }
      // 子弹 ↔ 技能胶囊(击中即拾取,设为当前技能;贯穿弹不消失,可连拾多个→取最后命中)
      for (var pi = 0; pi < this.bullets.length; pi++) {
        var pb = this.bullets[pi];
        if (pb.dead) continue;
        for (var pj = 0; pj < this.powerups.length; pj++) {
          var pu = this.powerups[pj];
          if (pu.dead || pu.collected) continue;
          if (E.circleHit(pb, pu)) {
            pu.collected = true; pu.dead = true;
            this._pickupSkill(pu);
            if (pb.pierce < 9999) pb.dead = true;   // 普通弹拾取后消失,激光贯穿弹继续飞
            break;
          }
        }
      }
      // 怪物 ↔ 飞船
      for (var k = 0; k < this.aliens.length; k++) {
        var al = this.aliens[k];
        if (al.dead) continue;
        if (E.circleHit(al, this.ship)) {
          if (this.ship.takeHit()) {
            Snd && Snd.play('hit');
            // 反射力场(Lv3):护盾格吸收命中时概率反弹,反伤=武器有效伤害×倍率
            if (this.ship.lastHitShielded && this.ship.reflectChance > 0 &&
                Math.random() < this.ship.reflectChance) {
              this._reflectAt(al);
              Snd && Snd.play('reflect');
            }
            this.explode(al.x, al.y, al.def.color, 18);
            this.screenFlash = 0.35;
            al.dead = true;
          }
        }
      }
      // 敌弹 ↔ 飞船(v0.8):命中走 ship.takeHit(护盾/反射/无敌帧自动兼容)。
      //   命中且未被无敌帧挡下 → 销毁敌弹 + 爆裂 + 闪屏;反射力场仅视觉飘字(敌弹无可伤实体)。
      //   无敌帧内(takeHit 返回 false)不销毁,敌弹穿过(雷电式无敌穿透,不刷屏)。
      for (var ei = 0; ei < this.enemyBullets.length; ei++) {
        var eb2 = this.enemyBullets[ei];
        if (eb2.dead) continue;
        if (E.circleHit(eb2, this.ship)) {
          if (this.ship.takeHit()) {
            Snd && Snd.play('hit');
            if (this.ship.lastHitShielded && this.ship.reflectChance > 0 &&
                Math.random() < this.ship.reflectChance) {
              this.texts.push(new Ent.FloatingText(eb2.x, eb2.y - 12, '↩', '#7df0c0', 20));
              Snd && Snd.play('reflect');
            }
            this.explode(eb2.x, eb2.y, eb2.color, 8);
            this.screenFlash = 0.25;
            eb2.dead = true;
          }
        }
      }
    },

    // v0.5:子弹命中结算伤害 + 施加技能状态(冰冻减速 / 火焰灼烧)
    _applyBulletHit: function (b, a) {
      var hit = a.takeDamage(b.damage);
      // v0.10.15:按命中类型飘字(hp 扣血/shield 护盾吸收/absorb 回血)
      if (hit === 'shield') {
        this.texts.push(new Ent.FloatingText(a.x, a.y - a.def.radius, '护盾 ' + Math.round(b.damage), '#7fe0ff', 18));
      } else if (hit === 'absorb') {
        this.texts.push(new Ent.FloatingText(a.x, a.y - a.def.radius, '+' + Math.round(b.damage * 0.5) + ' 吸收', '#5affb0', 18));
      } else {
        this.texts.push(new Ent.FloatingText(a.x, a.y - a.def.radius, '-' + Math.round(b.damage), b.color, 18));
      }
      if (b.skill) {
        if (b.skill.slowMul) {                       // 冰冻
          a.slowMul = b.skill.slowMul;
          a.slowTimer = b.skill.slowDur;
        }
        if (b.skill.burnDps) {                       // 火焰灼烧
          a.burnDps = b.skill.burnDps;
          a.burnTimer = b.skill.burnDur;
          a.burnTick = 0;
        }
      }
    },

    // v0.5 闪电连锁:从命中怪向附近 chain 只怪各造成 chainDmgMul×伤害,画电弧 + 飘字
    _chainLightning: function (b, src) {
      var hit = [src.id];
      var remain = b.skill.chain;
      for (var i = 0; i < this.aliens.length && remain > 0; i++) {
        var t = this.aliens[i];
        if (t.dead || t === src) continue;
        if (hit.indexOf(t.id) >= 0) continue;
        var d2 = E.dist2(src.x, src.y, t.x, t.y);
        if (d2 < 220 * 220) {                        // 连锁半径 220
          hit.push(t.id);
          var dmg = b.damage * b.skill.chainDmgMul;
          t.takeDamage(dmg);
          this.particles.push(new Ent.Particle((src.x + t.x) / 2, (src.y + t.y) / 2, 0, 0, 3, b.skill.color, 0.25));
          if (t.dead) { this.killAlien(t); }
          remain--;
        }
      }
    },

    // v0.5 拾取技能:设为当前技能(持久生效直到下一个);飘字 + 短闪反馈
    _pickupSkill: function (pu) {
      var prev = this.activeSkill;
      this.activeSkill = pu.skillKey;
      var def = pu.def;
      var isNew = prev !== pu.skillKey;
      this.texts.push(new Ent.FloatingText(pu.x, pu.y - 18, isNew ? ('获得 ' + def.label + '!') : (def.label + ' 刷新'),
        def.color, 22));
      this.screenFlash = 0.2;
      Snd && Snd.play('upgrade');   // 复用升级音效(上扬提示),避免新增音色
    },

    // 反射力场反伤:对怪物造成反弹伤害,可能直接击杀并走掉落链路
    _reflectAt: function (alien) {
      var w = C.WEAPONS[this.weaponLevel];
      var fireMul = C.SHIPS[this.shipLevel].fireMul;
      var dmg = w.damage * fireMul * this.ship.reflectDmgMul;
      if (dmg <= 0) return;
      // 反弹特效:从飞船射向怪物的能量弧 + 反伤飘字
      this.texts.push(new Ent.FloatingText(alien.x, alien.y - alien.def.radius,
        '↩' + Math.round(dmg), '#7df0c0', 20));
      alien.takeDamage(dmg);
      if (alien.dead) this.killAlien(alien);
    },

    killAlien: function (a) {
      this.score += a.def.score;
      this.killCount++;
      this.explode(a.x, a.y, a.def.color, C.FX.explosionParticles);
      // 掉落金币
      var drops = a.def.tier <= 2 ? 1 : (a.def.tier <= 4 ? 2 : 3);
      for (var i = 0; i < drops; i++) {
        this.coinsArr.push(new Ent.Coin(a.x + E.rand(-10, 10), a.y + E.rand(-10, 10), Math.ceil(a.def.coin / drops)));
      }
      this.texts.push(new Ent.FloatingText(a.x, a.y, '+' + a.def.score, a.def.color, a.def.tier >= 5 ? 30 : 22));
      // Boss 击杀:更大爆炸 + 胜利飘字
      if (a.isBoss) {
        this.explode(a.x, a.y, a.def.color, 40);
        this.screenFlash = 0.5;
        this.texts.push(new Ent.FloatingText(C.WIDTH / 2, C.HEIGHT / 2, '★ BOSS 击破!', '#ffd166', 40));
        Snd && Snd.play('bossKill');
      }
    },

    // —— Boss 多阶段回调(v0.3/v0.10.15 机制触发)——
    _onBossStage: function (boss, stage) {
      if (stage === 2) this.texts.push(new Ent.FloatingText(C.WIDTH / 2, C.HEIGHT / 2 - 80, '⚠ BOSS 狂暴', '#ff8a3d', 30));
      else if (stage === 3) this.texts.push(new Ent.FloatingText(C.WIDTH / 2, C.HEIGHT / 2 - 80, '⚠ BOSS 暴怒!', '#ff3d6e', 32));
      this.screenFlash = 0.3;
      // v0.10.15:阶段切换触发机制
      //   shield 机制:进入阶段 2/3 时补满护盾(护盾在时无法受伤,需先打破)
      if (boss.maxShield > 0 && stage >= 2) {
        boss.shield = boss.maxShield;
        this.texts.push(new Ent.FloatingText(boss.x, boss.y - boss.def.radius * (boss.def.bossVisScale || 1) - 20, '⚡ 护盾激活', '#7fe0ff', 22));
      }
      // summon 机制:阶段 2/3 立即召唤一轮仆从(_bossSummon 已支持 per-Boss summonType/summonCount)
      if (boss.mechanism === 'summon' && stage >= 2) {
        this._bossSummon(boss);
      }
    },
    // Boss 召唤小怪:在 Boss 周边生成,受同屏上限约束
    // v0.8:Boss 可用自身 def.summonType/summonCount override 全局(t10 召唤 t2×3,t6 仍走全局)
    _bossSummon: function (boss) {
      var B = C.BOSS;
      if (this.aliens.length >= C.WAVE.maxAliensOnScreen) return;
      var st = boss.def.summonType || B.summonType;
      var sc = boss.def.summonCount || B.summonCount;
      for (var i = 0; i < sc; i++) {
        if (this.aliens.length >= C.WAVE.maxAliensOnScreen) break;
        var ang = (i / sc) * Math.PI * 2;
        this.aliens.push(new Ent.Alien(st,
          boss.x + Math.cos(ang) * (boss.radius + 20),
          boss.y + Math.sin(ang) * (boss.radius + 20)));
      }
      this.texts.push(new Ent.FloatingText(boss.x, boss.y - boss.radius, '召唤!', '#c77dff', 20));
    },

    // —— v0.8 敌弹发射(由 Alien._updateFire 到点调用)——
    //   按 fireDef.pattern 生成 EnemyBullet,弹色用 alien.def.color 染色,受 maxOnScreen 上限。
    //   aimed:以 _aimAngle(telegraph 期锁定;兜底 _angleToShip)为基准,count 发扇形发射。
    //   spiral:count 臂均布,每次发射后 fireAngle += spiralStep(累积旋转,形成弹幕螺旋)。
    //   ring:count 发全圆均布,fireAngle 微漂使每环错开角度(避免叠成一条线)。
    _enemyFire: function (alien, f) {
      var col = alien.def.color;
      var sp = f.speed;
      var n = f.count;
      var pat = f.pattern;
      var boss = !!alien.isBoss;          // v0.10.11:Boss 弹标记
      if (this.enemyBullets.length >= C.ENEMY_BULLET.maxOnScreen) return;
      Snd && Snd.play('enemyFire');
      if (pat === 'aimed') {
        var baseA = alien._aimAngle != null ? alien._aimAngle : alien._angleToShip();
        for (var i = 0; i < n; i++) {
          var off = n === 1 ? 0 : (i / (n - 1) - 0.5) * (f.spread || 0.2);
          this._spawnEBullet(alien, baseA + off, sp, col, pat, boss);
        }
      } else if (pat === 'spiral') {
        for (var s = 0; s < n; s++) {
          var a = alien.fireAngle + (s / n) * Math.PI * 2;
          this._spawnEBullet(alien, a, sp, col, pat, boss);
        }
        alien.fireAngle += f.spiralStep || 0.3;
      } else if (pat === 'ring') {
        for (var r = 0; r < n; r++) {
          var ra = alien.fireAngle + (r / n) * Math.PI * 2;
          this._spawnEBullet(alien, ra, sp, col, pat, boss);
        }
        alien.fireAngle += 0.3;   // 微漂使每环错开
      } else if (pat === 'wave') {
        // v0.10.15:位移冲击波 —— 全圆均布膨胀弹(从 Boss 中心向外径向,半径随时间增大)
        for (var w = 0; w < n; w++) {
          var wa = alien.fireAngle + (w / n) * Math.PI * 2;
          var eb = new Ent.EnemyBullet(alien.x, alien.y, Math.cos(wa) * sp, Math.sin(wa) * sp, col, 'ring', boss);
          eb.expand = true;   // 标记膨胀(update 里 radius 增大)
          this.enemyBullets.push(eb);
        }
        alien.fireAngle += 0.4;
      }
    },
    // 生成一发敌弹(从怪物边缘出膛,避免在自身碰撞圈内生成)
    _spawnEBullet: function (alien, ang, sp, col, pattern, boss) {
      if (this.enemyBullets.length >= C.ENEMY_BULLET.maxOnScreen) return;
      var er = alien.radius + 4;
      this.enemyBullets.push(new Ent.EnemyBullet(
        alien.x + Math.cos(ang) * er, alien.y + Math.sin(ang) * er,
        Math.cos(ang) * sp, Math.sin(ang) * sp, col, pattern, boss));
    },

    explode: function (x, y, color, n) {
      // v0.10.11:贴图爆炸(放大淡出)+ 粒子碎片飞溅(保留)
      var sz = n >= 30 ? 160 : (n >= 14 ? 90 : 60);   // Boss 级 40 粒→大爆炸;普通 14→中;小 8→小
      this.explosions.push(new Ent.Explosion(x, y, sz, color, 0.42));
      for (var i = 0; i < n; i++) {
        var ang = Math.random() * Math.PI * 2;
        var sp = E.rand(60, 280);
        this.particles.push(new Ent.Particle(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp,
          E.rand(2, 5), color, E.rand(0.3, 0.7)));
      }
    },

    // —— 回收 + 金币拾取 ——
    cleanup: function () {
      var gained = 0;
      this.bullets = this.bullets.filter(function (b) { return !b.dead; });
      this.aliens = this.aliens.filter(function (a) { return !a.dead && !a.escaped; });
      this.enemyBullets = this.enemyBullets.filter(function (b) { return !b.dead; });  // v0.8
      this.powerups = this.powerups.filter(function (p) { return !p.dead; });
      this.particles = this.particles.filter(function (p) { return !p.dead; });
      if (this.particles.length > 240) this.particles.splice(0, this.particles.length - 240);
      this.explosions = this.explosions.filter(function (x) { return !x.dead; });
      this.texts = this.texts.filter(function (t) { return !t.dead; });
      var self = this;
      this.coinsArr = this.coinsArr.filter(function (c) {
        if (c.collected) { gained += c.value; return false; }
        return !c.dead;
      });
      if (gained > 0) {
        this.coins += gained;
        Snd && Snd.play('coin');
        this.save();
      }
    },

    // —— 升级 ——
    upgradeWeapon: function () {
      if (this.weaponLevel >= C.MAX_WEAPON_LEVEL) return;
      var next = this.weaponLevel + 1;
      var cost = C.WEAPONS[next].cost;
      if (this.coins < cost) {
        this.texts.push(new Ent.FloatingText(this.ship.x, this.ship.y - 60, '金币不足', '#ff6b6b', 24));
        return;
      }
      this.coins -= cost;
      this.weaponLevel = next;
      this.texts.push(new Ent.FloatingText(this.ship.x, this.ship.y - 60, '武器升级! ' + C.WEAPONS[next].name, '#7df0c0', 26));
      this.screenFlash = 0.2; Snd && Snd.play('upgrade');
      this.save();
    },

    upgradeShip: function () {
      if (this.shipLevel >= C.MAX_SHIP_LEVEL) return;
      var next = this.shipLevel + 1;
      var cost = C.SHIPS[next].cost;
      if (this.coins < cost) {
        this.texts.push(new Ent.FloatingText(this.ship.x, this.ship.y - 60, '金币不足', '#ff6b6b', 24));
        return;
      }
      this.coins -= cost;
      this.shipLevel = next;
      this._syncShipVisual();
      this.texts.push(new Ent.FloatingText(this.ship.x, this.ship.y - 60, '船舰升级! ' + C.SHIPS[next].name, '#5ad1ff', 26));
      this.screenFlash = 0.2; Snd && Snd.play('upgrade');
      this.save();
    },

    // 同步船舰等级到飞船实体(渲染体型/光晕用)
    _syncShipVisual: function () {
      var s = C.SHIPS[this.shipLevel];
      this.ship.level = this.shipLevel;
      this.ship.glow = s ? s.glow : '#5ad1ff';
    },

    upgradeDefense: function () {
      if (this.defenseLevel >= C.MAX_DEFENSE_LEVEL) return;
      var next = this.defenseLevel + 1;
      var cost = C.DEFENSES[next].cost;
      if (this.coins < cost) {
        this.texts.push(new Ent.FloatingText(this.ship.x, this.ship.y - 60, '金币不足', '#ff6b6b', 24));
        return;
      }
      this.coins -= cost;
      this.defenseLevel = next;
      this._applyDefense();
      this.texts.push(new Ent.FloatingText(this.ship.x, this.ship.y - 60, '防御升级! ' + C.DEFENSES[next].name, '#c77dff', 26));
      this.screenFlash = 0.2; Snd && Snd.play('upgrade');
      this.save();
    },

    // 同步防御等级到飞船实体:护盾上限/回充/复活能力;并按等级补满当前护盾
    _applyDefense: function () {
      var d = C.DEFENSES[this.defenseLevel];
      this.ship.maxShield = d.charges;
      this.ship.shieldRegenDelay = d.regenDelay;
      this.ship.defenseGlow = d.glow;
      this.ship.canRevive = d.revive;
      this.ship.reflectChance = d.reflectChance || 0;
      this.ship.reflectDmgMul = d.reflectDmgMul || 0;
      this.ship.shield = d.charges;                       // 升级时即时补满
      this.ship.shieldRegenTimer = d.regenDelay;
      this.ship.revivesLeft = d.revive ? 1 : 0;
    },

    // ================= 渲染 =================
    render: function (alpha) {
      var ctx = P.ctx;
      // 先以单位变换铺满整个画布的深空底色,让手机/PC 的 letterbox 留白区与
      // 游戏画面边缘同色,消除上下黑边的突兀感,视觉接近全屏。
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#05060c';
      ctx.fillRect(0, 0, P.canvas.width, P.canvas.height);
      // 设置变换:逻辑坐标 → 物理像素(letterbox 居中 + dpr)
      var s = P._scale * P._dpr, ox = P._offsetX * P._dpr, oy = P._offsetY * P._dpr;
      ctx.setTransform(s, 0, 0, s, ox, oy);

      R.background(ctx, this.time, this._lastDt || 0);   // v0.10.15:传 dt 供星空视差推进

      if (this.state === STATE.PLAYING || this.state === STATE.GAMEOVER || this.state === STATE.PAUSED) {
        this.drawWorld(ctx);
      }
      if (this.state === STATE.PLAYING) {
        this.drawHUD(ctx);
        if (this.bossAlert > 0) this.drawBossAlert(ctx);   // v0.10.4:EVA 式红色警报
      }
      if (this.state === STATE.PAUSED) this.drawPaused(ctx);
      if (this.state === STATE.MENU) this.drawMenu(ctx);
      if (this.state === STATE.GAMEOVER) this.drawGameOver(ctx);
      if (this.state === STATE.LEADERBOARD) this.drawLeaderboard(ctx);

      R.flash(ctx, this.screenFlash, this.state === STATE.GAMEOVER ? '#ff3d6e' : '#ffffff');

      this._clickConsumed = false; // 复位,供本次 render 内按钮检测使用
      P.endFrame();
    },

    drawWorld: function (ctx) {
      // 飞船无敌闪烁
      var blink = this.ship.invuln > 0 && Math.floor(this.time * 18) % 2 === 0;
      ctx.save();
      if (blink) ctx.globalAlpha = 0.35;
      this.ship.draw(ctx);
      ctx.restore();

      for (var i = 0; i < this.aliens.length; i++) this.aliens[i].draw(ctx);
      for (var pu = 0; pu < this.powerups.length; pu++) this.powerups[pu].draw(ctx);
      for (var eb3 = 0; eb3 < this.enemyBullets.length; eb3++) this.enemyBullets[eb3].draw(ctx);  // v0.8
      for (var j = 0; j < this.bullets.length; j++) this.bullets[j].draw(ctx);
      for (var k = 0; k < this.particles.length; k++) this.particles[k].draw(ctx);
      for (var e = 0; e < this.explosions.length; e++) this.explosions[e].draw(ctx);
      for (var m = 0; m < this.coinsArr.length; m++) this.coinsArr[m].draw(ctx);
      for (var n = 0; n < this.texts.length; n++) this.texts[n].draw(ctx);
    },

    // —— 顶部 HUD + 底部升级栏 ——
    drawHUD: function (ctx) {
      var W = C.WIDTH;
      // 顶栏
      ctx.save();
      ctx.fillStyle = 'rgba(8,12,24,0.55)';
      ctx.fillRect(0, 0, W, TOP_H);
      ctx.strokeStyle = 'rgba(90,209,255,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, TOP_H); ctx.lineTo(W, TOP_H); ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#7df0c0'; ctx.font = 'bold 16px Arial';
      ctx.fillText('积分 SCORE', 24, 34);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 34px Arial';
      ctx.fillText(this.score, 24, 72);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 16px Arial';
      ctx.fillText('金币 COIN', W - 24, 34);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 34px Arial';
      ctx.fillText(this.coins, W - 24, 72);
      ctx.restore();

      // v0.5:当前技能指示(顶栏中部,HP 上方)。无技能时灰显「标准弹道」
      var sk = this.activeSkill ? C.SKILLS[this.activeSkill] : null;
      ctx.save();
      ctx.textAlign = 'center';
      var chipW = 168, chipH = 26, chipX = W / 2 - chipW / 2, chipY = 6;
      ctx.fillStyle = sk ? this._hexA(sk.color, 0.18) : 'rgba(255,255,255,0.06)';
      this._roundRect(ctx, chipX, chipY, chipW, chipH, 8); ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = sk ? this._hexA(sk.color, 0.8) : 'rgba(255,255,255,0.2)';
      this._roundRect(ctx, chipX, chipY, chipW, chipH, 8); ctx.stroke();
      ctx.fillStyle = sk ? sk.color : 'rgba(255,255,255,0.5)';
      ctx.font = 'bold 13px Arial'; ctx.textBaseline = 'middle';
      ctx.fillText('⚡ ' + (sk ? sk.name : '标准弹道'), W / 2, chipY + chipH / 2 + 1);
      ctx.textBaseline = 'alphabetic';
      ctx.restore();

      // 音效开关 + 暂停按钮 + BGM 开关 + 切歌按钮(右上角)
      var sndOn = P.audio.isEnabled();
      var sbS = 32;
      // v0.10.9:四按钮 — 暂停 / 切歌 / 音乐 / 音效(左→右)。音效仍最右,音乐与切歌相邻。
      var pbX = W - 176, nbX = W - 132, mbX = W - 88, sbX = W - 44, sbY = 8;
      if (this._button(ctx, pbX, sbY, sbS, sbS, '⏸', true, true)) this._pause();
      // v0.10.9:切歌按钮(下一首)。点击→bgmNext + 顶部飘字提示当前曲名。
      if (this._button(ctx, nbX, sbY, sbS, sbS, '⏭', true, true)) {
        if (Snd) {
          Snd.bgmNext();
          this.texts.push(new Ent.FloatingText(C.WIDTH / 2, 120, '♪ ' + Snd.bgmTrackName(), '#5ad1ff', 24));
        }
      }
      // 切歌按钮下方常显 "当前/总数" 小字(让玩家知道共几首、现在是第几首)
      ctx.save();
      ctx.fillStyle = 'rgba(160,200,255,0.7)'; ctx.font = '10px Arial'; ctx.textAlign = 'center';
      ctx.fillText((Snd ? Snd.bgmTrackIdx() : 0) + 1 + '/' + (Snd ? Snd.bgmTrackCount() : 1),
        nbX + sbS / 2, sbY + sbS + 10);
      ctx.restore();
      // v0.10.8:BGM 开关(🎵 开 / 🎶 关)。独立于音效,持久化。
      var bgmOn = Snd ? Snd.bgmIsOn() : false;
      if (this._button(ctx, mbX, sbY, sbS, sbS, bgmOn ? '🎵' : '🎶', true, true)) {
        if (Snd) { Snd.bgmToggle(); }
      }
      if (this._button(ctx, sbX, sbY, sbS, sbS, sndOn ? '♪' : '✕', true, true)) {
        P.audio.setEnabled(!sndOn);
        Snd && Snd.bgmSync();   // v0.10.8:静音状态变化同步 BGM(静音则暂停,解除则恢复)
      }
      if (!sndOn) {  // 静音时图标变暗提示
        ctx.save();
        ctx.fillStyle = 'rgba(255,107,107,0.7)';
        ctx.font = '10px Arial'; ctx.textAlign = 'center';
        ctx.fillText('静音', sbX + sbS / 2, sbY + sbS + 10);
        ctx.restore();
      }
      if (!bgmOn) {  // BGM 关闭时图标变暗提示
        ctx.save();
        ctx.fillStyle = 'rgba(255,107,107,0.7)';
        ctx.font = '10px Arial'; ctx.textAlign = 'center';
        ctx.fillText('音乐', mbX + sbS / 2, sbY + sbS + 10);
        ctx.restore();
      }

      // 血量(中部醒目血条 + "生命 N/M" 数字,低血红色脉动闪烁)
      //   旧版是 14px 小三角飞船图标,颜色与 HUD 接近、无数字,玩家难判断剩多少血。
      //   改成分段血条(满段亮绿、空段暗)+ 数字标注 + 低血(hp≤1 且非满血上限)红色闪烁警告。
      ctx.save();
      var hpMax = this.ship.maxHp, hp = this.ship.hp;
      var lowHp = hp <= 1 && hpMax > 1;
      var flash = lowHp && Math.floor(this.time * 8) % 2 === 0;
      var barW = 110, barH = 11, segGap = 3;
      var segW = (barW - segGap * (hpMax - 1)) / hpMax;
      var bx = W / 2 - barW / 2, by = 30;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      this._roundRect(ctx, bx - 2, by - 2, barW + 4, barH + 4, 4); ctx.fill();  // 背框
      for (var i = 0; i < hpMax; i++) {
        var full = i < hp;
        ctx.fillStyle = full
          ? (lowHp ? (flash ? '#ff4d6d' : '#7a2030') : '#5aff8a')   // 满段:正常绿 / 低血红闪烁
          : 'rgba(120,140,160,0.22)';                                // 空段:暗灰
        this._roundRect(ctx, bx + i * (segW + segGap), by, segW, barH, 2); ctx.fill();
      }
      ctx.fillStyle = lowHp ? '#ff4d6d' : '#cfe4ff';
      ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center';
      ctx.fillText('生命 ' + hp + ' / ' + hpMax, W / 2, by + barH + 16);
      ctx.restore();

      // 护盾充能(防御线):HP 下方一行小菱形,有格才画
      if (this.ship.maxShield > 0) {
        ctx.save();
        var sdN = this.ship.maxShield, dw = 13, dgap = 5;
        var sx = W / 2 - (sdN * (dw + dgap) - dgap) / 2;
        for (var si = 0; si < sdN; si++) {
          ctx.fillStyle = si < this.ship.shield ? this.ship.defenseGlow : 'rgba(120,160,200,0.18)';
          var cx = sx + si * (dw + dgap) + dw / 2, cy = 66;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 7); ctx.lineTo(cx + 6, cy);
          ctx.lineTo(cx, cy + 7); ctx.lineTo(cx - 6, cy); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }

      // 底栏(升级:武器 / 船舰 / 防御 三卡片)
      ctx.save();
      ctx.fillStyle = 'rgba(8,12,24,0.7)';
      ctx.fillRect(0, C.HEIGHT - BOT_H, W, BOT_H);
      ctx.strokeStyle = 'rgba(90,209,255,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, C.HEIGHT - BOT_H); ctx.lineTo(W, C.HEIGHT - BOT_H); ctx.stroke();
      ctx.restore();

      var top = C.HEIGHT - BOT_H;
      var fireMul = C.SHIPS[this.shipLevel].fireMul;
      var cardW = 220, xs = [14, 250, 486];   // 三卡片 x(居中、间隔 16)

      // 武器卡
      var wDef = C.WEAPONS[this.weaponLevel];
      var wMaxed = this.weaponLevel >= C.MAX_WEAPON_LEVEL;
      var wNext = this.weaponLevel + 1;
      var wCost = wMaxed ? 0 : C.WEAPONS[wNext].cost;
      var wCanBuy = !wMaxed && this.coins >= wCost;
      var effDmg = Math.round(wDef.damage * fireMul);
      var wStat = '伤害 ' + effDmg + (fireMul > 1 ? ' (×' + fireMul + ')' : '') +
        '  ·  ' + wDef.fireRate + '/s  ·  ' + (wDef.pierce > 0 ? '穿透 ' + wDef.pierce : '弹道 ' + wDef.spread);
      if (this._upgradeCard(ctx, xs[0], top, {
        w: cardW, title: '武器 Lv' + this.weaponLevel + ' ' + wDef.name, stat: wStat, color: wDef.color,
        maxed: wMaxed, cost: wCost, canBuy: wCanBuy, maxedLabel: '已满级'
      })) this.upgradeWeapon();

      // 船舰卡
      var sDef = C.SHIPS[this.shipLevel];
      var sMaxed = this.shipLevel >= C.MAX_SHIP_LEVEL;
      var sNext = this.shipLevel + 1;
      var sCost = sMaxed ? 0 : C.SHIPS[sNext].cost;
      var sCanBuy = !sMaxed && this.coins >= sCost;
      var sTurret = sDef.turrets || 0;
      var sTStat = sTurret > 0 ? ('副炮×' + sTurret + (sDef.turretAuto ? ' 自锁' : '')) : '无副炮';
      var sStat = '火力 ×' + sDef.fireMul.toFixed(1) + '  ·  伤害 ' + effDmg + '  ·  ' + sTStat;
      if (this._upgradeCard(ctx, xs[1], top, {
        w: cardW, title: '船舰 Lv' + this.shipLevel + ' ' + sDef.name, stat: sStat, color: sDef.glow,
        maxed: sMaxed, cost: sCost, canBuy: sCanBuy, maxedLabel: '已满级'
      })) this.upgradeShip();

      // 防御卡
      var dDef = C.DEFENSES[this.defenseLevel];
      var dMaxed = this.defenseLevel >= C.MAX_DEFENSE_LEVEL;
      var dNext = this.defenseLevel + 1;
      var dCost = dMaxed ? 0 : C.DEFENSES[dNext].cost;
      var dCanBuy = !dMaxed && this.coins >= dCost;
      var dPerks = [];
      if (dDef.charges > 0) dPerks.push(dDef.charges + '格');
      if (dDef.regenDelay > 0 && dDef.regenDelay <= 5) dPerks.push('自动回复');
      if (dDef.revive) dPerks.push('复活');
      var dStat = dDef.charges > 0 ? ('护盾 ' + dPerks.join(' · ')) : '无护盾 · 受击扣血';
      if (this._upgradeCard(ctx, xs[2], top, {
        w: cardW, title: '防御 Lv' + this.defenseLevel + ' ' + dDef.name, stat: dStat, color: dDef.glow,
        maxed: dMaxed, cost: dCost, canBuy: dCanBuy, maxedLabel: '已满级'
      })) this.upgradeDefense();

      // FPS 调试显示
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '12px Arial';
      ctx.textAlign = 'left';
      ctx.fillText('FPS ' + (this.fps || 0), 24, top - 10);
      ctx.restore();
    },

    // —— 菜单 ——
    drawMenu: function (ctx) {
      var W = C.WIDTH, H = C.HEIGHT;
      ctx.save();
      ctx.fillStyle = 'rgba(5,7,14,0.7)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#5ad1ff';
      ctx.shadowColor = '#5ad1ff'; ctx.shadowBlur = 24;
      ctx.font = 'bold 56px Arial';
      ctx.fillText('GALACTIC HUNTER', W / 2, H / 2 - 120);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#c77dff'; ctx.font = '28px Arial';
      ctx.fillText('银 河 猎 手', W / 2, H / 2 - 70);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '16px Arial';
      ctx.fillText('驾驶飞船 · 射击外星怪物 · 三线养成', W / 2, H / 2 - 30);
      ctx.fillText('移动指针瞄准 · 点击或按住开火', W / 2, H / 2 - 6);

      var bw = 280, bh = 76, bx = W / 2 - bw / 2, by = H / 2 + 40;
      if (this._button(ctx, bx, by, bw, bh, '▶  开始游戏', true, false)) this.startGame();

      ctx.fillStyle = 'rgba(255,209,102,0.8)'; ctx.font = 'bold 18px Arial';
      ctx.fillText('最高分  ' + this.highScore, W / 2, by + bh + 38);

      var lbw = 280, lbh = 50, lbx = W / 2 - lbw / 2, lby = by + bh + 64;
      if (this._button(ctx, lbx, lby, lbw, lbh, '🏆  战 绩 排 行 榜', true, true)) this.openLeaderboard();

      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '13px Arial';
      ctx.fillText('v0.4 · AI 协作设计', W / 2, H - 30);
      ctx.restore();
    },

    // —— 结算 ——
    drawGameOver: function (ctx) {
      var W = C.WIDTH, H = C.HEIGHT;
      ctx.save();
      ctx.fillStyle = 'rgba(5,7,14,0.78)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff3d6e';
      ctx.shadowColor = '#ff3d6e'; ctx.shadowBlur = 20;
      ctx.font = 'bold 52px Arial';
      ctx.fillText('任 务 失 败', W / 2, H / 2 - 100);
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Arial';
      ctx.fillText('本局积分', W / 2, H / 2 - 40);
      ctx.fillStyle = '#7df0c0'; ctx.font = 'bold 44px Arial';
      ctx.fillText(this.score, W / 2, H / 2 + 4);

      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '15px Arial';
      ctx.fillText('累计金币  ' + this.coins + '   ·   武器  Lv' + this.weaponLevel + '   ·   船舰  Lv' + this.shipLevel + '   ·   防御  Lv' + this.defenseLevel, W / 2, H / 2 + 40);
      if (this.score >= this.highScore && this.score > 0) {
        ctx.fillStyle = '#ffd166'; ctx.font = 'bold 16px Arial';
        ctx.fillText('★ 新纪录!', W / 2, H / 2 + 66);
      }

      var bw = 280, bh = 70, bx = W / 2 - bw / 2, by = H / 2 + 100;
      if (this._button(ctx, bx, by, bw, bh, '↻  再 战 一 局', true, false)) this.startGame();
      var lbw2 = 280, lbh2 = 48, lbx2 = W / 2 - lbw2 / 2, lby2 = by + bh + 18;
      if (this._button(ctx, lbx2, lby2, lbw2, lbh2, '🏆  查 看 排 行 榜', true, true)) this.openLeaderboard();
      var mbw = 280, mbh = 48, mbx = W / 2 - mbw / 2, mby = lby2 + lbh2 + 14;
      if (this._button(ctx, mbx, mby, mbw, mbh, '🏠  返 回 主 菜 单', true, true)) this.returnToMenu();
      ctx.restore();
    },

    // —— 排行榜(v0.4):本机 Top 10 战绩 ——
    drawLeaderboard: function (ctx) {
      var W = C.WIDTH, H = C.HEIGHT;
      ctx.save();
      ctx.fillStyle = 'rgba(5,7,14,0.84)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';

      ctx.fillStyle = '#ffd166';
      ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 20;
      ctx.font = 'bold 44px Arial';
      ctx.fillText('战 绩 排 行 榜', W / 2, 118);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '15px Arial';
      ctx.fillText('本机最高分 Top 10', W / 2, 148);

      if (this.leaderboard.length === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '20px Arial';
        ctx.fillText('暂无记录,去战斗吧!', W / 2, H / 2);
      } else {
        var top = 188, rowH = 74, listW = 620, listX = (W - listW) / 2;
        for (var i = 0; i < this.leaderboard.length; i++) {
          this._leaderRow(ctx, listX, top + i * rowH, listW, rowH, i, this.leaderboard[i]);
        }
      }

      var bbW = 260, bbH = 60, bbX = W / 2 - bbW / 2, bbY = H - 120;
      if (this._button(ctx, bbX, bbY, bbW, bbH, '◀  返 回', true, false)) this.closeLeaderboard();
      ctx.restore();
    },

    // 榜单单行:名次(前三名金银铜色)+ 积分 + 日期 + 波次/击杀/装备详情;
    // 本局刚入榜的记录(ts 匹配 _lastEntryTs)高亮金底,便于玩家找到自己这局。
    _leaderRow: function (ctx, x, y, w, h, idx, e) {
      var isLast = e.ts === this._lastEntryTs && this._lastEntryTs > 0;
      ctx.save();
      ctx.fillStyle = isLast ? 'rgba(255,209,102,0.16)' : 'rgba(90,209,255,0.08)';
      this._roundRect(ctx, x, y, w, h, 10); ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = isLast ? 'rgba(255,209,102,0.7)' : 'rgba(90,209,255,0.3)';
      this._roundRect(ctx, x, y, w, h, 10); ctx.stroke();

      var rankColors = ['#ffd166', '#cfd8e3', '#cd7f32'];   // 金/银/铜
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = idx < 3 ? rankColors[idx] : 'rgba(255,255,255,0.55)';
      ctx.font = 'bold 30px Arial';
      ctx.fillText((idx + 1) + '.', x + 22, y + h / 2 + 2);

      ctx.fillStyle = isLast ? '#ffd166' : '#7df0c0';
      ctx.font = 'bold 30px Arial';
      ctx.fillText(e.score, x + 86, y + h / 2 + 2);

      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '13px Arial';
      ctx.fillText(this._fmtDate(e.ts), x + w - 22, y + 26);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('波次 ' + e.wave + ' · 击杀 ' + e.kills + ' · 武' + e.weapon + ' 船' + e.ship + ' 防' + e.defense,
        x + w - 22, y + h - 22);
      ctx.restore();
    },

    _fmtDate: function (ts) {
      function pad(n) { return n < 10 ? '0' + n : '' + n; }
      var d = new Date(ts);
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    },
    // hex → rgba 字符串(技能芯片配色用;render.js 有同名能力但未导出,此处内联避免耦合)
    _hexA: function (hex, a) {
      var h = hex.replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) + ',' +
        parseInt(h.substr(4, 2), 16) + ',' + a + ')';
    },

    // —— 科幻按钮(绘制 + 点击检测,justPressed 单帧消费)——
    _button: function (ctx, x, y, w, h, label, enabled, muted) {
      var hit = P.pointer.justPressed &&
        !this._clickConsumed &&
        P.pointer.x >= x && P.pointer.x <= x + w &&
        P.pointer.y >= y && P.pointer.y <= y + h;
      if (hit && enabled) this._clickConsumed = true;

      ctx.save();
      var hover = P.pointer.x >= x && P.pointer.x <= x + w && P.pointer.y >= y && P.pointer.y <= y + h;
      var g = ctx.createLinearGradient(x, y, x, y + h);
      if (!enabled) { g.addColorStop(0, '#2a2f3d'); g.addColorStop(1, '#1a1e28'); }
      else { g.addColorStop(0, hover ? '#3a6fae' : '#2a4a78'); g.addColorStop(1, '#15243a'); }
      ctx.fillStyle = g;
      this._roundRect(ctx, x, y, w, h, 12); ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = enabled ? (hover ? '#9fe0ff' : 'rgba(90,209,255,0.6)') : 'rgba(255,255,255,0.15)';
      if (enabled) { ctx.shadowColor = '#5ad1ff'; ctx.shadowBlur = hover ? 16 : 8; }
      this._roundRect(ctx, x, y, w, h, 12); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = enabled ? '#fff' : 'rgba(255,255,255,0.35)';
      ctx.font = 'bold ' + (muted ? 18 : 24) + 'px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x + w / 2, y + h / 2);
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
      return hit && enabled;
    },

    _roundRect: function (ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },

    // —— 升级卡片(武器/船舰通用:标题 + 数值行 + 升级按钮)——
    _upgradeCard: function (ctx, x, top, o) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.fillStyle = o.color; ctx.font = 'bold 18px Arial';
      ctx.fillText(o.title, x, top + 28);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '11px Arial';
      ctx.fillText(o.stat, x, top + 48);
      ctx.restore();

      var btnW = o.w || 220, btnH = 46, btnX = x, btnY = top + 58;
      var label = o.maxed ? o.maxedLabel : ('升级 ▲ ' + o.cost + ' 金币');
      var clicked = this._button(ctx, btnX, btnY, btnW, btnH, label, o.canBuy || o.maxed, o.maxed);
      return clicked && !o.maxed;     // 满级时点击仅消费不升级
    },
  };

  G.Game = Game;
})(window.G = window.G || {});
