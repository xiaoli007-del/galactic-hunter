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
  }
  Ship.prototype.update = function (dt) {
    // 炮口跟随指针(手动瞄准)
    var p = G.Platform.pointer;
    this.aimAngle = Math.atan2(p.y - this.y, p.x - this.x);
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.invuln > 0) this.invuln -= dt;
  };
  Ship.prototype.draw = function (ctx) { G.Render.ship(ctx, this); };
  Ship.prototype.takeHit = function () {
    if (this.invuln > 0) return false;
    this.hp -= 1;
    this.hitFlash = 0.18;
    this.invuln = 0.7;
    return true;
  };

  // —— 子弹 ——
  function Bullet(x, y, vx, vy, def) {
    this.id = newId();
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.damage = def.damage;
    this.color = def.color;
    this.radius = 5;
    this.pierce = def.pierce;       // 可穿透敌人数
    this.hitIds = {};                // 已命中过的敌人 id,防重复
    this.trail = [];
    this.dead = false;
  }
  Bullet.prototype.update = function (dt) {
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 6) this.trail.shift();
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    var cfg = G.Config;
    if (this.y < -20 || this.y > cfg.HEIGHT + 20 || this.x < -20 || this.x > cfg.WIDTH + 20) this.dead = true;
  };
  Bullet.prototype.draw = function (ctx) { G.Render.bullet(ctx, this); };
  Bullet.prototype.hit = function (alien) {
    if (this.hitIds[alien.id]) return false;
    this.hitIds[alien.id] = true;
    if (this.pierce <= 0) this.dead = true;
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
  }
  Alien.prototype.update = function (dt) {
    this.phase += dt * 6;
    this.wob += dt * 2;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    // 朝下移动 + 横向摆动
    var targetX = G.Config.WIDTH / 2 + this.driftX + Math.sin(this.wob) * 80;
    var dx = targetX - this.x, dy = (G.Config.HEIGHT + 60) - this.y;
    var len = Math.hypot(dx, dy) || 1;
    this.x += (dx / len) * this.speed * dt;
    this.y += (dy / len) * this.speed * dt;
    this.angle = Math.atan2(dy, dx) - Math.PI / 2; // 造型朝运动方向
    if (this.y > G.Config.HEIGHT + 80) this.escaped = true;
  };
  Alien.prototype.draw = function (ctx) { G.Render.alien(ctx, this); };
  Alien.prototype.takeDamage = function (dmg) {
    this.hp -= dmg;
    this.hitFlash = 0.08;
    if (this.hp <= 0) this.dead = true;
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

  // —— 金币(击杀掉落,飞向飞船)——
  function Coin(x, y, value) {
    this.x = x; this.y = y; this.value = value;
    this.r = 6;
    this.vx = (Math.random() - 0.5) * 120;
    this.vy = (Math.random() - 0.5) * 120 - 60;
    this.life = 4; this.dead = false; this.collected = false;
  }
  Coin.prototype.update = function (dt, ship) {
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    // 飞向飞船(引力)
    var dx = ship.x - this.x, dy = ship.y - this.y;
    var d = Math.hypot(dx, dy) || 1;
    var pull = G.Config.FX.coinFlySpeed * (1 + (4 - this.life) * 0.5);
    this.vx += (dx / d) * pull * dt * 6;
    this.vy += (dy / d) * pull * dt * 6;
    this.vx *= 0.9; this.vy *= 0.9;
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (d < ship.radius + 12) this.collected = true;
  };
  Coin.prototype.draw = function (ctx) { G.Render.coin(ctx, this); };

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
  Entities.Coin = Coin;
  Entities.FloatingText = FloatingText;
  G.Entities = Entities;
})(window.G = window.G || {});
