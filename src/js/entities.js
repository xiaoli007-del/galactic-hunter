/*
 * Galactic Hunter — entities.js
 * 实体层(对应 GDD §9.2 第三层)
 *
 * 每个实体只负责「自身状态 + 运动 + 绘制委托」。
 * 实体间的交互(碰撞、生成、回收、经济结算)由 game.js 统一处理。
 */
(function (G) {
  'use strict';

  var Entities = {};
  var _nextId = 1;
  function newId() { return _nextId++; }

  // —— 飞船 ——
  function Ship(cfg) {
    this.x = cfg.SHIP.x;
    this.y = cfg.SHIP.y;
    this.radius = cfg.SHIP.radius;
    this.aimAngle = -Math.PI / 2; // 默认朝上
    this.hp = cfg.SHIP.maxHp;
    this.maxHp = cfg.SHIP.maxHp;
    this.hitFlash = 0;
    this.invuln = 0; // 受击后短暂无敌
    this.level = 1;       // 船舰等级(渲染体型/光晕用,由 Game 同步)
    this.glow = '#5ad1ff';
    // 防御线:充能护盾(由 Game._applyDefense 按防御等级写入)
    this.maxShield = 0;          // 护盾格上限(充能数)
    this.shield = 0;             // 当前护盾格
    this.shieldRegenDelay = 0;   // 回充一格所需秒(0 = 不回复)
    this.shieldRegenTimer = 0;   // 回充倒计时
    this.defenseGlow = '#5ad1ff';// HUD 护盾指示色
    this.canRevive = false;      // Lv5 不灭屏障:本局可复活一次
    this.revivesLeft = 0;        // 剩余复活次数(每局重置)
    // 反射力场(Lv3):护盾格吸收命中时概率反弹
    this.reflectChance = 0;     // 反弹概率(0 = 无反射)
    this.reflectDmgMul = 0;     // 反弹伤害 = 武器有效伤害 × 此倍率
    this.lastHitShielded = false; // 上次 takeHit 是否被护盾吸收(collision 读此决定是否反弹)
  }
  Ship.prototype.update = function (dt) {
    var p = G.Platform.pointer, cfg = G.Config, SH = cfg.SHIP;

    // v0.6:飞船固定底部,仅左右跟随指针(Galaga 式)。腾出上下纵深给怪物下压,
    // 玩家靠左右走位闪避;炮口仍自动锁敌,移动与开火解耦,触屏单指即可走位+输出。
    if (p.down || p.x !== 0 || p.y !== 0) {   // 有指针输入才动(避免开局被未初始化指针扯走)
      var tx = Math.max(this.radius, Math.min(cfg.WIDTH - this.radius, p.x));
      var dx = tx - this.x;
      var step = SH.speed * dt;
      if (step >= Math.abs(dx)) this.x = tx;            // 一帧可达则吸附,消除抖动
      else this.x += (dx >= 0 ? 1 : -1) * step;
      this.y = SH.y;                                     // 固定底部
    }

    // v0.7:炮口固定朝上(经典纵向射击)。移除自动锁敌 —— 飞船只左右走位躲弹,
    // 子弹直线上射,玩家靠横移把敌人对到正上方;移动与开火彻底解耦,触屏单指即可。
    // (_findTarget / _aliens 保留不调用,留作未来「自动瞄准」开关切换)
    this.aimAngle = -Math.PI / 2;

    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    // 护盾自动回充(防御线):有格上限、未满、且配了回充间隔才计
    if (this.maxShield > 0 && this.shield < this.maxShield && this.shieldRegenDelay > 0) {
      this.shieldRegenTimer -= dt;
      if (this.shieldRegenTimer <= 0) {
        this.shield++;
        this.shieldRegenTimer = this.shieldRegenDelay;
      }
    }
  };
  // 锁定 aimRange 内最近的活怪;Game.aliens 由 Game 同步到 ship._aliens(避免实体反向依赖 Game)
  Ship.prototype._findTarget = function () {
    var list = this._aliens;
    if (!list || list.length === 0) return null;
    var best = null, bestD2 = G.Config.SHIP.aimRange * G.Config.SHIP.aimRange;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.dead || a.escaped) continue;
      var dx = a.x - this.x, dy = a.y - this.y, d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = a; }
    }
    return best;
  };
  Ship.prototype.draw = function (ctx) { G.Render.ship(ctx, this); };
  Ship.prototype.takeHit = function () {
    if (this.invuln > 0) return false;
    if (this.shield > 0) {            // 护盾吸收:消一格,不扣 hp
      this.shield--;
      this.lastHitShielded = true;
    } else {                          // 护盾耗尽:扣血
      this.hp -= 1;
      this.lastHitShielded = false;
    }
    this.hitFlash = 0.18;
    this.invuln = 0.7;
    this.shieldRegenTimer = this.shieldRegenDelay;  // 受击重置回充倒计时
    return true;
  };
  // 不灭屏障复活:hp 归零时若还有复活次数,回满血/护盾并返回 true
  Ship.prototype.revive = function () {
    if (!this.canRevive || this.revivesLeft <= 0) return false;
    this.revivesLeft--;
    this.hp = this.maxHp;
    this.shield = this.maxShield;
    this.shieldRegenTimer = this.shieldRegenDelay;
    this.hitFlash = 0.3;
    this.invuln = 2.0;     // 复活后长无敌,防止立即再死
    return true;
  };

  // —— 子弹 ——
  // v0.5:携带 skill(skillDef 或 null)。pierce 含技能加成(激光=大数=无限贯穿)。
  function Bullet(x, y, vx, vy, def, dmg, skill) {
    this.id = newId();
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.damage = dmg != null ? dmg : def.damage;   // dmg:经船舰乘区 + 技能倍率放大后的有效伤害
    this.color = (skill && skill.color) || def.color;
    this.radius = skill ? 6 : 5;                    // 技能弹道略粗,增强视觉辨识
    this.pierce = def.pierce + (skill && skill.pierce ? skill.pierce : 0);
    this.skill = skill || null;                    // 激活技能定义(影响命中特效与连锁判定)
    this.hitIds = {};                // 已命中过的敌人 id,防重复
    this.trail = [];
    this.dead = false;
  }
  Bullet.prototype.update = function (dt) {
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 8) this.trail.shift();
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    var cfg = G.Config;
    if (this.y < -20 || this.y > cfg.HEIGHT + 20 || this.x < -20 || this.x > cfg.WIDTH + 20) this.dead = true;
  };
  Bullet.prototype.draw = function (ctx) { G.Render.bullet(ctx, this); };
  Bullet.prototype.hit = function (alien) {
    if (this.hitIds[alien.id]) return false;
    this.hitIds[alien.id] = true;
    // 激光(无限贯穿)永不因命中而消失;其余按剩余贯穿层数扣减
    if (this.pierce >= 9999) { /* 贯穿一切,不 dead */ }
    else if (this.pierce <= 0) this.dead = true;
    else this.pierce -= 1;
    return true;
  };

  // —— 外星怪 ——
  function Alien(typeKey, x, y) {
    var def = G.Config.ALIENS[typeKey];
    this.id = newId();
    this.type = typeKey;
    this.def = def;
    this.x = x; this.y = y;
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.radius = def.radius;
    this.speed = def.speed;
    this.phase = Math.random() * Math.PI * 2;
    this.angle = Math.random() * Math.PI * 2;
    this.hitFlash = 0;
    this.dead = false;
    this.escaped = false;
    // 运动目标:朝向屏幕下方区域(飞船方向),带横向漂移
    this.driftX = (Math.random() - 0.5) * 60;
    this.wob = Math.random() * Math.PI * 2;
    // Boss 多阶段(v0.3):t6/t9/t10(v0.8 统一为 def.boss 标志,与 tier 解耦)
    this.isBoss = def.boss === true || def.tier === 6;
    this.bossStage = 1;        // 1/2/3 阶段
    this.summonTimer = 0;      // 召唤倒计时
    this.dashTimer = 0;        // 冲刺倒计时
    this.dashing = 0;          // 冲刺剩余秒数(>0 时冲刺中)
    // 特殊行为(v0.3):def.behavior
    this.behavior = def.behavior || null;
    this.blinkCd = 0;          // 幽灵闪现冷却(防连击)
    this.spiralPhase = Math.random() * Math.PI * 2;   // 精灵螺旋相位
    this.spiralTimer = 0;      // 精灵冲刺倒计时
    this.spiralDash = 0;       // 精灵冲刺剩余
    this._spiralCx = x; this._spiralCy = y;           // 螺旋中心(随下移)
    // v0.5 技能状态:冰冻减速 / 灼烧(由 game.collisions 命中时施加)
    this.slowTimer = 0;        // 减速剩余秒(>0 时移速×slowMul)
    this.slowMul = 1;          // 当前减速倍率(1=正常)
    this.burnTimer = 0;        // 灼烧剩余秒
    this.burnDps = 0;          // 灼烧伤害/秒
    this.burnTick = 0;         // 灼烧伤害累计(每秒结算一次,防 float 抖动)
    // v0.8 敌弹发射(仅 def.fire 怪:t8 守卫者 / t9·t10 Boss):
    //   fireTimer 倒计时;到点调 Game._enemyFire(this, fireDef)。
    //   aimed 弹种在 fireTimer ≤ telegraph 时进入蓄能(锁定方向 _aimAngle,渲染预警)。
    this.fireTimer = 0;        // 发射倒计时(0 → 首帧懒初始化为 every)
    this.fireAngle = Math.random() * Math.PI * 2;  // spiral 累积旋转角(每次发射 += spiralStep)
    this._aimArmed = false;    // aimed 蓄能是否已锁定方向(进入 telegraph 窗口时锁一次)
    this._aimAngle = Math.PI / 2;  // 锁定的发射方向(默认朝下)
    // v0.8 t7 撕裂者:预警突进状态机(telegraph→dash→repos 循环;与 t6 Boss dash 字段隔离)
    this._dashTele = 0;        // 预警蓄能倒计时(>0 时蓄能中,锁定方向)
    this._dashDur = 0;         // 突进剩余(>0 时突进中)
    this._repos = 0.8;         // 突进后/入场前的间隔(>0 时缓速下移)
    this._dashArmed = false;   // 预警是否已锁定方向
    this._dashDx = 0; this._dashDy = 1;  // 突进方向单位向量
  }
  Alien.prototype.update = function (dt) {
    this.phase += dt * 6;
    this.wob += dt * 2;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // v0.5 技能状态:减速递减 + 移速乘以减速倍率;灼烧按 dps 每帧扣血(累计到 1 才结算,避免小数飘字刷屏)
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowMul = 1;
    }
    if (this.burnTimer > 0 && this.burnDps > 0 && !this.dead) {
      this.burnTimer -= dt;
      this.burnTick += this.burnDps * dt;
      if (this.burnTick >= 1) {            // 每累计 1 点伤害结算一次
        var d = Math.floor(this.burnTick);
        this.hp -= d;
        this.burnTick -= d;
        this.hitFlash = 0.08;
        if (this.hp <= 0) this.dead = true;
      }
    }

    var speed = this.speed * this.slowMul;   // v0.5:冰冻减速作用于所有移动(含 Boss 冲刺)
    if (this.isBoss) {
      var B = G.Config.BOSS;
      // 阶段切换(按 hp 比例)
      var ratio = this.hp / this.maxHp;
      var newStage = ratio > B.stage2HpRatio ? 1 : (ratio > B.stage3HpRatio ? 2 : 3);
      if (newStage !== this.bossStage) {
        this.bossStage = newStage;
        if (G.Game) G.Game._onBossStage(this, newStage);
      }
      // v0.10.5:Boss 固定停在屏幕上方正中,不移动(只发弹 + 召唤 + 受击)。
      //   缓动吸附到固定锚点(WIDTH/2, 上方 bossY),到位后保持;阶段切换时轻微震颤强化压迫感。
      var anchorX = G.Config.WIDTH / 2;
      var anchorY = G.Config.BOSS.bossY;
      this.x += (anchorX - this.x) * Math.min(1, dt * 3);
      this.y += (anchorY - this.y) * Math.min(1, dt * 3);
      // 阶段≥2 震颤(压迫感:小幅随机抖动,模拟能量爆发)
      if (this.bossStage >= 2) {
        var tremor = (this.bossStage >= 3 ? 4 : 2);
        this.x += (Math.random() - 0.5) * tremor;
        this.y += (Math.random() - 0.5) * tremor;
      }
      this.angle = Math.PI;   // 朝下(正面对玩家);贴图机头朝下,angle=π 让造型朝下
      // 召唤小怪(阶段 ≥ 2)
      if (this.bossStage >= 2) {
        this.summonTimer -= dt;
        if (this.summonTimer <= 0) {
          this.summonTimer = B.summonEvery[this.bossStage];
          if (G.Game) G.Game._bossSummon(this);
        }
      }
      // Boss 固定位持续开火(_updateFire 已含 fire null 的 no-op 判断)
      this._updateFire(dt);
      return;   // Boss 不走下面的默认移动/dash
    }

    // v0.8 敌弹发射(t8 守卫者,及非冲刺态的 t9/t10 Boss):放在 Boss 块之后,bossStage 已更新。
    this._updateFire(dt);

    // 闪现冷却递减
    if (this.blinkCd > 0) this.blinkCd -= dt;

    // v0.8 t7 撕裂者:预警→锁定方向→直线突进→重新入场(可读可躲的"读弹"机制)
    if (this.behavior === 'dash') {
      var DB = G.Config.BEHAVIOR;
      if (this._dashTele > 0) {                       // 蓄能:锁定方向,缓速下移,渲染预警光
        if (!this._dashArmed) { this._dashArmed = true; this._lockDashAim(); }
        this._dashTele -= dt;
        this.y += speed * 0.3 * dt;
        this.angle = Math.atan2(this._dashDy, this._dashDx) - Math.PI / 2;
        if (this._dashTele <= 0) { this._dashDur = 0.85; }   // 蓄能结束→突进
      } else if (this._dashDur > 0) {                 // 突进:沿锁定方向高速直线
        this._dashDur -= dt;
        this.x += this._dashDx * speed * DB.dashSpeedMul * dt;
        this.y += this._dashDy * speed * DB.dashSpeedMul * dt;
        this.angle = Math.atan2(this._dashDy, this._dashDx) - Math.PI / 2;
        if (this.x < -40 || this.x > G.Config.WIDTH + 40 || this.y > G.Config.HEIGHT + 80) this.escaped = true;
      } else if (this._repos > 0) {                   // 重新入场:缓速下移,等待下次蓄能
        this._repos -= dt;
        this.y += speed * 0.55 * dt;
        if (this._repos <= 0) { this._dashTele = DB.dashTelegraph; this._dashArmed = false; }
        if (this.y > G.Config.HEIGHT + 80) this.escaped = true;
      } else {                                         // 初始:下移一小段后启动循环
        this.y += speed * dt;
        this._repos = DB.dashReposition;
      }
      if (this.y > G.Config.HEIGHT + 80) this.escaped = true;
      return;
    }

    // T5 精英:螺旋推进 + 周期冲刺(替代直线下移)
    if (this.behavior === 'spiral') {
      var SB = G.Config.BEHAVIOR;
      this._spiralCy += speed * dt;                    // 螺旋中心匀速下移
      this.spiralPhase += dt * 2.4;                    // 旋转
      this.spiralTimer -= dt;
      if (this.spiralDash <= 0 && this.spiralTimer <= 0) {
        this.spiralDash = SB.spiralDashDur;
        this.spiralTimer = SB.spiralDashEvery;
      }
      if (this.spiralDash > 0) {
        // 冲刺:朝飞船方向高速直冲
        var ddx = 0, ddy = 1;
        if (G.Game && G.Game.ship) {
          var ex = G.Game.ship.x - this.x, ey = G.Game.ship.y - this.y;
          var el = Math.hypot(ex, ey) || 1; ddx = ex / el; ddy = ey / el;
        }
        this.x += ddx * speed * SB.spiralDashMul * dt;
        this.y += ddy * speed * SB.spiralDashMul * dt;
        this.spiralDash -= dt;
        this.angle = Math.atan2(ddy, ddx) - Math.PI / 2;
      } else {
        // 螺旋:绕下移中心做圆周
        this.x = this._spiralCx + Math.cos(this.spiralPhase) * SB.spiralRadius;
        this.y = this._spiralCy + Math.sin(this.spiralPhase) * SB.spiralRadius;
        this.angle = this.spiralPhase + Math.PI / 2;
      }
      // 中心 x 缓慢漂移,避免螺旋全贴中轴
      this._spiralCx += Math.sin(this.wob) * 18 * dt;
      if (this.y > G.Config.HEIGHT + 80) this.escaped = true;
      return;
    }

    // 朝下移动 + 横向摆动(默认行为)
    var targetX = G.Config.WIDTH / 2 + this.driftX + Math.sin(this.wob) * 80;
    var dx = targetX - this.x, dy = (G.Config.HEIGHT + 60) - this.y;
    var len = Math.hypot(dx, dy) || 1;
    this.x += (dx / len) * speed * dt;
    this.y += (dy / len) * speed * dt;
    this.angle = Math.atan2(dy, dx) - Math.PI / 2; // 造型朝运动方向
    if (this.y > G.Config.HEIGHT + 80) this.escaped = true;
  };
  Alien.prototype.draw = function (ctx) { G.Render.alien(ctx, this); };

  // v0.8:取当前生效的敌弹配置(Boss 按 bossStage 取 stages 子项;普通怪直接 def.fire)
  Alien.prototype._fireDef = function () {
    var f = this.def.fire;
    if (!f) return null;
    if (f.stages) return f.stages[this.bossStage] || null;
    return f;
  };
  // 朝飞船方向的角度(无飞船/已死则朝下);aimed 弹种与 t7 突进锁向用
  Alien.prototype._angleToShip = function () {
    if (G.Game && G.Game.ship) {
      return Math.atan2(G.Game.ship.y - this.y, G.Game.ship.x - this.x);
    }
    return Math.PI / 2;
  };
  // t7 撕裂者:锁定突进方向(朝飞船当前位置),供预警渲染 + 突进位移共用
  Alien.prototype._lockDashAim = function () {
    if (G.Game && G.Game.ship) {
      var dx = G.Game.ship.x - this.x, dy = G.Game.ship.y - this.y;
      var l = Math.hypot(dx, dy) || 1;
      this._dashDx = dx / l; this._dashDy = dy / l;
    } else { this._dashDx = 0; this._dashDy = 1; }
  };
  // v0.8 敌弹发射计时:aimed 在 telegraph 窗口锁定方向(_aimAngle),到点委托 Game 生成弹幕
  Alien.prototype._updateFire = function (dt) {
    var f = this._fireDef();
    if (!f) return;
    if (this.fireTimer <= 0) this.fireTimer = f.every;     // 首帧懒初始化
    if (f.telegraph > 0 && this.fireTimer <= f.telegraph && !this._aimArmed) {
      this._aimArmed = true;                                 // 进入蓄能:锁定发射方向一次
      this._aimAngle = this._angleToShip();
    }
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      if (G.Game && G.Game._enemyFire) G.Game._enemyFire(this, f);
      this.fireTimer = f.every;
      this._aimArmed = false;
    }
  };
  Alien.prototype.takeDamage = function (dmg) {
    this.hp -= dmg;
    this.hitFlash = 0.08;
    if (this.hp <= 0) { this.dead = true; return; }
    // T4 幽灵闪现回避:受击未死时概率瞬移,闪现期间 cd 内不再触发
    if (this.behavior === 'blink' && this.blinkCd <= 0) {
      var B = G.Config.BEHAVIOR;
      if (Math.random() < B.blinkChance) {
        var ang = Math.random() * Math.PI * 2;
        this.x += Math.cos(ang) * B.blinkDist;
        this.y += Math.sin(ang) * B.blinkDist;
        // 边界约束,不飞出屏幕
        var W = G.Config.WIDTH, H = G.Config.HEIGHT;
        this.x = Math.max(this.radius, Math.min(W - this.radius, this.x));
        this.y = Math.max(-20, Math.min(H - this.radius, this.y));
        this.hitFlash = 0.12;
      }
      this.blinkCd = 0.6;
    }
  };

  // —— 粒子 ——
  function Particle(x, y, vx, vy, r, color, life) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.r = r; this.color = color; this.life = life; this.maxLife = life;
    this.dead = false;
  }
  Particle.prototype.update = function (dt) {
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.vx *= 0.94; this.vy *= 0.94;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  };
  Particle.prototype.draw = function (ctx) { G.Render.particle(ctx, this); };

  // v0.10.11:爆炸特效(贴图 + 放大→淡出)。与粒子碎片并行,提供大爆裂质感。
  //   size 为初始半径(像素),life 秒;渲染时从 size 放大到 size*1.6 并淡出。
  function Explosion(x, y, size, color, life) {
    this.x = x; this.y = y; this.size = size; this.color = color || '#ffb84d';
    this.life = life || 0.4; this.maxLife = this.life; this.dead = false;
  }
  Explosion.prototype.update = function (dt) { this.life -= dt; if (this.life <= 0) this.dead = true; };
  Explosion.prototype.draw = function (ctx) { G.Render.explosion(ctx, this); };

  // —— 敌弹(v0.8):新精英/Boss 发射的子弹。直线飞行,出界回收;命中飞船走 takeHit 同路径 ——
  //   伤害=1(与本体撞击一致:消一格护盾或扣 1 hp),护盾/反射/无敌帧自动兼容。
  function EnemyBullet(x, y, vx, vy, color, pattern, isBoss) {
    this.id = newId();
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.radius = G.Config.ENEMY_BULLET.radius;
    this.color = color || G.Config.ENEMY_BULLET.color;
    this.damage = G.Config.ENEMY_BULLET.damage;
    this.pattern = pattern || 'aimed';   // v0.10.11:aimed/spiral/ring,渲染按此选贴图
    this.isBoss = !!isBoss;              // v0.10.11:Boss 弹用重弹贴图
    this.trail = [];
    this.dead = false;
  }
  EnemyBullet.prototype.update = function (dt) {
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > G.Config.ENEMY_BULLET.trail) this.trail.shift();
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    var cfg = G.Config;
    if (this.x < -20 || this.x > cfg.WIDTH + 20 || this.y < -20 || this.y > cfg.HEIGHT + 20) this.dead = true;
  };
  EnemyBullet.prototype.draw = function (ctx) { G.Render.enemyBullet(ctx, this); };

  // —— 金币(击杀掉落,飞向飞船吸收;v0.7 改为温和吸附 + 水晶外观)——
  function Coin(x, y, value) {
    this.x = x; this.y = y; this.value = value;
    this.r = 8;                    // v0.7:略放大(旧 6 太像小弹点,易被误当追踪弹)
    this.vx = (Math.random() - 0.5) * 120;
    this.vy = (Math.random() - 0.5) * 120 - 60;
    this.life = 4; this.dead = false; this.collected = false;
    this.t = 0;                    // 旋转相位(水晶渲染用)
  }
  Coin.prototype.update = function (dt, ship) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    // v0.7:温和吸附——远处缓慢飘近,近距(220px 内)才明显加速吸入。
    //   不再"存活越久拉力越猛直冲飞船"(旧式像追踪弹躲不掉),改为收集物式缓吸。
    var dx = ship.x - this.x, dy = ship.y - this.y;
    var d = Math.hypot(dx, dy) || 1;
    var pull = G.Config.FX.coinFlySpeed * (d < 220 ? 0.9 : 0.4);
    this.vx += (dx / d) * pull * dt * 6;
    this.vy += (dy / d) * pull * dt * 6;
    this.vx *= 0.9; this.vy *= 0.9;
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (d < ship.radius + 12) this.collected = true;
  };
  Coin.prototype.draw = function (ctx) { G.Render.coin(ctx, this); };

  // —— 技能胶囊(v0.5):场上定时生成,飞船子弹击中即拾取 ——
  //   持久生效:拾取后设为飞船 activeSkill,直到命中下一个胶囊才替换。
  function PowerUp(skillKey, x, y) {
    this.skillKey = skillKey;
    this.def = G.Config.SKILLS[skillKey];
    this.x = x; this.y = y;
    this.baseY = y;              // 浮动基准
    this.r = G.Config.POWERUP.radius;       // 渲染/碰撞半径(别名,供 Engine.circleHit 读 .radius)
    this.radius = G.Config.POWERUP.radius;
    this.life = G.Config.POWERUP.life;
    this.dead = false; this.collected = false;
    this.t = 0;                  // 浮动相位
  }
  PowerUp.prototype.update = function (dt) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    this.y = this.baseY + Math.sin(this.t * G.Config.POWERUP.bobSpeed) * G.Config.POWERUP.bobAmp;
  };
  PowerUp.prototype.draw = function (ctx) { G.Render.powerUp(ctx, this); };

  // —— 飘字(伤害/积分)——
  function FloatingText(x, y, text, color, size) {
    this.x = x; this.y = y; this.text = text; this.color = color || '#fff';
    this.size = size || 22; this.vy = -60;
    this.life = 0.9; this.maxLife = 0.9; this.dead = false;
  }
  FloatingText.prototype.update = function (dt) {
    this.y += this.vy * dt; this.vy *= 0.96; this.life -= dt;
    if (this.life <= 0) this.dead = true;
  };
  FloatingText.prototype.draw = function (ctx) { G.Render.floatingText(ctx, this); };

  Entities.Ship = Ship;
  Entities.Bullet = Bullet;
  Entities.Alien = Alien;
  Entities.Particle = Particle;
  Entities.Explosion = Explosion;
  Entities.EnemyBullet = EnemyBullet;
  Entities.Coin = Coin;
  Entities.PowerUp = PowerUp;
  Entities.FloatingText = FloatingText;
  G.Entities = Entities;
})(window.G = window.G || {});
