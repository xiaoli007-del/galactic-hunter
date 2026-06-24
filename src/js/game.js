/*
 * Galactic Hunter — game.js
 * 游戏逻辑层(对应 GDD §9.2 第三层主控)
 *
 * 职责:状态机、波次刷新、碰撞结算、经济、升级、存档、UI。
 * 不直接依赖 DOM/窗口,所有环境能力经 G.Platform 获取 —— 保证移植小游戏时本文件不动。
 */
(function (G) {
  'use strict';
  var E = G.Engine, P = G.Platform, C = G.Config, R = G.Render, Ent = G.Entities;

  var STATE = { MENU: 'menu', PLAYING: 'playing', GAMEOVER: 'gameover' };

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

    ship: null,
    bullets: [], aliens: [], particles: [], coinsArr: [], texts: [],

    spawnTimer: 0,
    killCount: 0,
    fireTimer: 0,
    screenFlash: 0,
    _clickConsumed: false,

    init: function () {
      this.loadSave();
      this.ship = new Ent.Ship(C);
      this._syncShipVisual();            // 船舰等级 → 飞船渲染状态(体型/光晕)
      this._applyDefense();              // 防御等级 → 护盾充能/复活状态
      G.Assets && G.Assets.init();        // 异步加载贴图(渐进增强,缺失自动退回程序化)
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

    startGame: function () {
      this.state = STATE.PLAYING;
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
      if (this.score > this.highScore) { this.highScore = this.score; }
      this.save();
    },

    // ================= 主循环 =================
    update: function (dt) {
      this.time += dt;
      if (this.screenFlash > 0) this.screenFlash -= dt * 2;
      // FPS 统计(0.5s 滑窗)
      this._fpsFr = (this._fpsFr || 0) + 1;
      this._fpsTm = (this._fpsTm || 0) + dt;
      if (this._fpsTm >= 0.5) { this.fps = Math.round(this._fpsFr / this._fpsTm); this._fpsFr = 0; this._fpsTm = 0; }
      if (this.state !== STATE.PLAYING) return;

      this.battleTime += dt;
      this.ship.update(dt);

      // 开火:点击瞬间立即开火一次(消除首次延迟),按住则按射速连发
      var w = C.WEAPONS[this.weaponLevel];
      var interval = 1 / w.fireRate;
      if (P.pointer.justPressed) {
        this.fire(w);
        this.fireTimer = 0;        // 从本次开火起重新计时连发
      }
      if (P.pointer.down) {
        this.fireTimer += dt;
        while (this.fireTimer >= interval) {
          this.fire(w);
          this.fireTimer -= interval;
        }
      } else {
        this.fireTimer = 0;
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
    fire: function (w) {
      var a = this.ship.aimAngle;
      var n = w.spread, step = 0.12;
      var ox = Math.cos(a) * this.ship.radius * 1.1;
      var oy = Math.sin(a) * this.ship.radius * 1.1;
      var fireMul = C.SHIPS[this.shipLevel].fireMul;   // 船舰乘区:放大武器单发伤害
      var dmg = w.damage * fireMul;
      for (var i = 0; i < n; i++) {
        var off = n === 1 ? 0 : (i - (n - 1) / 2) * step;
        var ang = a + off;
        var b = new Ent.Bullet(
          this.ship.x + ox, this.ship.y + oy,
          Math.cos(ang) * w.speed, Math.sin(ang) * w.speed, w, dmg);
        this.bullets.push(b);
      }
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
      // Boss 触发
      if (this.killCount > 0 && this.killCount % C.WAVE.bossEveryKills === 0 && !this._bossSpawned) {
        this.spawnAlien(tier, 't6');
        this._bossSpawned = true;
        this.texts.push(new Ent.FloatingText(C.WIDTH / 2, C.HEIGHT / 2, '⚠ BOSS 出现', '#ff3d6e', 36));
      }
      if (this.killCount % C.WAVE.bossEveryKills !== 0) this._bossSpawned = false;
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
      var x = E.rand(60, C.WIDTH - 60);
      var y = -def.radius - 10;
      this.aliens.push(new Ent.Alien(type, x, y));
    },

    updateEntities: function (dt) {
      for (var i = 0; i < this.bullets.length; i++) this.bullets[i].update(dt);
      for (var j = 0; j < this.aliens.length; j++) this.aliens[j].update(dt);
      for (var k = 0; k < this.particles.length; k++) this.particles[k].update(dt);
      for (var m = 0; m < this.texts.length; m++) this.texts[m].update(dt);
      for (var n = 0; n < this.coinsArr.length; n++) this.coinsArr[n].update(dt, this.ship);
    },

    // —— 碰撞结算 ——
    collisions: function () {
      // 子弹 ↔ 怪物
      for (var i = 0; i < this.bullets.length; i++) {
        var b = this.bullets[i];
        if (b.dead) continue;
        for (var j = 0; j < this.aliens.length; j++) {
          var a = this.aliens[j];
          if (a.dead) continue;
          if (E.circleHit(b, a)) {
            if (!b.hit(a)) continue;          // 已命中过则跳过
            a.takeDamage(b.damage);
            this.texts.push(new Ent.FloatingText(a.x, a.y - a.def.radius, '-' + Math.round(b.damage), '#fff', 18));
            if (a.dead) this.killAlien(a);
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
            // 反射力场(Lv3):护盾格吸收命中时概率反弹,反伤=武器有效伤害×倍率
            if (this.ship.lastHitShielded && this.ship.reflectChance > 0 &&
                Math.random() < this.ship.reflectChance) {
              this._reflectAt(al);
            }
            this.explode(al.x, al.y, al.def.color, 18);
            this.screenFlash = 0.35;
            al.dead = true;
          }
        }
      }
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
      }
    },

    // —— Boss 多阶段回调(v0.3)——
    _onBossStage: function (boss, stage) {
      if (stage === 2) this.texts.push(new Ent.FloatingText(C.WIDTH / 2, C.HEIGHT / 2 - 80, '⚠ BOSS 狂暴', '#ff8a3d', 30));
      else if (stage === 3) this.texts.push(new Ent.FloatingText(C.WIDTH / 2, C.HEIGHT / 2 - 80, '⚠ BOSS 暴怒!', '#ff3d6e', 32));
      this.screenFlash = 0.3;
    },
    // Boss 召唤小怪:在 Boss 周边生成,受同屏上限约束
    _bossSummon: function (boss) {
      var B = C.BOSS;
      if (this.aliens.length >= C.WAVE.maxAliensOnScreen) return;
      for (var i = 0; i < B.summonCount; i++) {
        if (this.aliens.length >= C.WAVE.maxAliensOnScreen) break;
        var ang = (i / B.summonCount) * Math.PI * 2;
        this.aliens.push(new Ent.Alien(B.summonType,
          boss.x + Math.cos(ang) * (boss.radius + 20),
          boss.y + Math.sin(ang) * (boss.radius + 20)));
      }
      this.texts.push(new Ent.FloatingText(boss.x, boss.y - boss.radius, '召唤!', '#c77dff', 20));
    },

    explode: function (x, y, color, n) {
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
      this.particles = this.particles.filter(function (p) { return !p.dead; });
      if (this.particles.length > 240) this.particles.splice(0, this.particles.length - 240);
      this.texts = this.texts.filter(function (t) { return !t.dead; });
      var self = this;
      this.coinsArr = this.coinsArr.filter(function (c) {
        if (c.collected) { gained += c.value; return false; }
        return !c.dead;
      });
      if (gained > 0) {
        this.coins += gained;
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
      this.screenFlash = 0.2;
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
      this.screenFlash = 0.2;
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
      this.screenFlash = 0.2;
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

      R.background(ctx, this.time);

      if (this.state === STATE.PLAYING || this.state === STATE.GAMEOVER) {
        this.drawWorld(ctx);
      }
      if (this.state === STATE.PLAYING) this.drawHUD(ctx);
      if (this.state === STATE.MENU) this.drawMenu(ctx);
      if (this.state === STATE.GAMEOVER) this.drawGameOver(ctx);

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
      for (var j = 0; j < this.bullets.length; j++) this.bullets[j].draw(ctx);
      for (var k = 0; k < this.particles.length; k++) this.particles[k].draw(ctx);
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

      // 血量(中部小飞船图标)
      ctx.save();
      var hx = W / 2 - (this.ship.maxHp * 18) / 2;
      for (var i = 0; i < this.ship.maxHp; i++) {
        ctx.fillStyle = i < this.ship.hp ? '#5ad1ff' : 'rgba(90,209,255,0.2)';
        ctx.beginPath();
        ctx.moveTo(hx + i * 18, 30); ctx.lineTo(hx + i * 18 + 14, 30);
        ctx.lineTo(hx + i * 18 + 7, 48); ctx.closePath(); ctx.fill();
      }
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
      var sStat = '火力 ×' + sDef.fireMul.toFixed(1) + '  ·  伤害 ' + effDmg;
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
      ctx.fillText('最高分  ' + this.highScore, W / 2, by + bh + 40);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '13px Arial';
      ctx.fillText('v0.2.2 · AI 协作设计', W / 2, H - 30);
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
      ctx.restore();
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
      var label = o.maxed ? o.maxedLabel : ('升级 ▲ ' + o.cost);
      var clicked = this._button(ctx, btnX, btnY, btnW, btnH, label, o.canBuy || o.maxed, o.maxed);
      return clicked && !o.maxed;     // 满级时点击仅消费不升级
    },
  };

  G.Game = Game;
})(window.G = window.G || {});
