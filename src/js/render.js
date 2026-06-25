/*
 * Galactic Hunter — render.js
 * 渲染层(写实科幻风,性能优化版)
 *
 * 性能核心:用「预渲染发光精灵 + drawImage」替代 shadowBlur。
 * shadowBlur 每次绘制都触发高斯模糊,是 Canvas2D 头号性能杀手;
 * 发光精灵一次性生成、反复贴图,快一个数量级以上且视觉几乎无损。
 */
(function (G) {
  'use strict';

  var stars = null, bgCanvas = null;
  var glowCache = {};

  // —— 颜色工具 ——
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return { r: parseInt(h.substr(0, 2), 16), g: parseInt(h.substr(2, 2), 16), b: parseInt(h.substr(4, 2), 16) };
  }
  function hexToRgba(hex, a) {
    var c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }
  function lighten(hex, amt) {
    var c = hexToRgb(hex);
    return 'rgb(' + Math.min(255, c.r + (255 - c.r) * amt | 0) + ',' +
      Math.min(255, c.g + (255 - c.g) * amt | 0) + ',' +
      Math.min(255, c.b + (255 - c.b) * amt | 0) + ')';
  }
  function darken(hex, amt) {
    var c = hexToRgb(hex);
    return 'rgb(' + (c.r * (1 - amt) | 0) + ',' + (c.g * (1 - amt) | 0) + ',' + (c.b * (1 - amt) | 0) + ')';
  }

  // —— 发光精灵:按颜色懒生成、缓存复用 ——
  function glow(color) {
    if (glowCache[color]) return glowCache[color];
    var size = 64;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var cx = c.getContext('2d');
    var g = cx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, hexToRgba(color, 1));
    g.addColorStop(0.35, hexToRgba(color, 0.5));
    g.addColorStop(1, hexToRgba(color, 0));
    cx.fillStyle = g;
    cx.fillRect(0, 0, size, size);
    glowCache[color] = c;
    return c;
  }
  // 在 lighter 模式下贴一张发光精灵(光晕)
  function drawGlow(ctx, color, x, y, r, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(glow(color), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  function ensureStars() {
    if (stars) return;
    var cfg = G.Config, n = cfg.FX.starCount;
    stars = [];
    for (var i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * cfg.WIDTH, y: Math.random() * cfg.HEIGHT,
        r: Math.random() * 1.6 + 0.3, layer: Math.random() * 0.6 + 0.4,
        tw: Math.random() * Math.PI * 2, tws: Math.random() * 2 + 0.5,
      });
    }
  }

  // 背景预渲染:深空底 + 星云画进离屏 canvas,每帧只贴一次图
  function buildBackground() {
    var cfg = G.Config, W = cfg.WIDTH, H = cfg.HEIGHT;
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = W; bgCanvas.height = H;
    var ctx = bgCanvas.getContext('2d');
    var bg = ctx.createRadialGradient(W * 0.5, H * 0.42, 60, W * 0.5, H * 0.5, H * 0.8);
    bg.addColorStop(0, '#10131f'); bg.addColorStop(0.5, '#0a0c16'); bg.addColorStop(1, '#05060c');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    var nebulae = [
      { x: W * 0.25, y: H * 0.22, r: 360, c: 'rgba(80,40,140,0.22)' },
      { x: W * 0.78, y: H * 0.40, r: 420, c: 'rgba(30,90,160,0.20)' },
      { x: W * 0.50, y: H * 0.78, r: 480, c: 'rgba(150,30,90,0.16)' },
    ];
    for (var i = 0; i < nebulae.length; i++) {
      var nb = nebulae[i];
      var g = ctx.createRadialGradient(nb.x, nb.y, 10, nb.x, nb.y, nb.r);
      g.addColorStop(0, nb.c); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
  }

  var Render = {

    background: function (ctx, t) {
      ensureStars();
      if (!bgCanvas) buildBackground();
      var cfg = G.Config, W = cfg.WIDTH, H = cfg.HEIGHT;
      ctx.drawImage(bgCanvas, 0, 0);            // 预渲染底图,一次贴图

      // 星点闪烁(无 shadow,纯 arc,便宜)
      for (var s = 0; s < stars.length; s++) {
        var st = stars[s];
        var a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * st.tws + st.tw));
        ctx.globalAlpha = a * st.layer;
        ctx.fillStyle = '#cfe4ff';
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r * st.layer, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    // —— 飞船 ——
    ship: function (ctx, ship) {
      var lvl = ship.level || 1;
      var visScale = 1 + (lvl - 1) * 0.06;      // 船舰等级越高体型越大(Lv5≈1.24×;仅视觉,碰撞半径不变)
      var glowColor = ship.glow || '#5ad1ff';    // 等级光晕色(见 Config.SHIPS[].glow)
      var tex = G.Assets && G.Assets.get('ship');
      if (tex) { this._sprite(ctx, tex, ship.x, ship.y, ship.radius * 2.6 * visScale, ship.aimAngle + Math.PI / 2, ship.hitFlash > 0, glowColor); return; }
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(ship.aimAngle + Math.PI / 2);
      ctx.scale(visScale, visScale);
      var r = ship.radius, flash = ship.hitFlash > 0;

      // 外光晕(发光精灵,lighter)
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, glowColor, 0, 0, r * 2.2, 0.45);

      // 引擎尾焰
      var flame = 0.7 + 0.3 * Math.sin(Date.now() / 60);
      drawGlow(ctx, '#4a9eff', 0, r * 0.6 + r * flame, r * 1.4, 0.7);
      ctx.globalCompositeOperation = 'source-over';

      // 主体金属渐变
      var body = ctx.createLinearGradient(-r, 0, r, 0);
      if (flash) { body.addColorStop(0, '#fff'); body.addColorStop(0.5, '#dbe6f5'); body.addColorStop(1, '#fff'); }
      else { body.addColorStop(0, '#2a3340'); body.addColorStop(0.5, '#9fb0c6'); body.addColorStop(1, '#2a3340'); }
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.15);
      ctx.lineTo(r * 0.5, r * 0.2); ctx.lineTo(r * 0.95, r * 0.75); ctx.lineTo(r * 0.3, r * 0.55);
      ctx.lineTo(r * 0.3, r * 0.7); ctx.lineTo(-r * 0.3, r * 0.7); ctx.lineTo(-r * 0.3, r * 0.55);
      ctx.lineTo(-r * 0.95, r * 0.75); ctx.lineTo(-r * 0.5, r * 0.2);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = flash ? '#fff' : '#bfe0ff';
      ctx.stroke();

      ctx.strokeStyle = 'rgba(90,209,255,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -r * 1.0); ctx.lineTo(0, r * 0.55); ctx.stroke();

      var cab = ctx.createRadialGradient(-r * 0.12, -r * 0.35, 1, 0, -r * 0.3, r * 0.32);
      cab.addColorStop(0, '#eaf6ff'); cab.addColorStop(0.5, '#3aa0ff'); cab.addColorStop(1, '#0a2a55');
      ctx.fillStyle = cab;
      ctx.beginPath(); ctx.arc(0, -r * 0.3, r * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },

    // —— 外星怪 ——
    alien: function (ctx, a) {
      var def = a.def, r = def.radius, flash = a.hitFlash > 0;
      var tex = G.Assets && G.Assets.get('alien-' + a.type);
      if (tex) {
        this._sprite(ctx, tex, a.x, a.y, r * 2.4, a.angle, flash, def.color);
        this._alienStatus(ctx, a, r);
        if (a.hp < a.maxHp) this._hpBar(ctx, a.x, a.y - r - 10, r * 1.6, a.hp / a.maxHp, def.color);
        return;
      }
      ctx.save();
      ctx.translate(a.x, a.y); ctx.rotate(a.angle);
      var wob = Math.sin(a.phase) * 0.5 + 0.5;

      // 光晕(发光精灵)
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, def.color, 0, 0, r * 2.4, 0.5);
      ctx.globalCompositeOperation = 'source-over';

      var fill = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      if (flash) { fill.addColorStop(0, '#fff'); fill.addColorStop(1, '#fff'); }
      else { fill.addColorStop(0, lighten(def.color, 0.4)); fill.addColorStop(0.6, def.color); fill.addColorStop(1, darken(def.color, 0.55)); }
      ctx.fillStyle = fill;
      ctx.strokeStyle = flash ? '#fff' : lighten(def.color, 0.5);
      ctx.lineWidth = 2;

      switch (def.tier) {
        case 1: this._alienCrawler(ctx, r, wob); break;
        case 2: this._alienDrone(ctx, r, wob); break;
        case 3: this._alienBrute(ctx, r, wob); break;
        case 4: this._alienWraith(ctx, r, wob); break;
        case 5: this._alienElite(ctx, r, wob); break;
        case 6: this._alienBoss(ctx, r, wob); break;
      }
      ctx.restore();
      this._alienStatus(ctx, a, r);
      if (a.hp < a.maxHp) this._hpBar(ctx, a.x, a.y - r - 10, r * 1.6, a.hp / a.maxHp, def.color);
    },

    // v0.5 技能状态叠加:冰冻=冷蓝光晕 + 减速圈;灼烧=橙色脉动(覆盖 sprite/几何两条路径)
    _alienStatus: function (ctx, a, r) {
      if (a.slowTimer <= 0 && a.burnTimer <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (a.slowTimer > 0) {
        drawGlow(ctx, '#7fe0ff', a.x, a.y, r * 1.5, 0.32);   // 冰冻冷光晕
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(160,230,255,0.7)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(a.x, a.y, r * 1.15, 0, Math.PI * 2); ctx.stroke();
      }
      if (a.burnTimer > 0) {
        ctx.globalCompositeOperation = 'lighter';
        var bp = 0.4 + Math.sin((a.phase || 0) * 10) * 0.2;
        drawGlow(ctx, '#ff7a3d', a.x, a.y, r * 1.3, bp);     // 灼烧橙光脉动
      }
      ctx.restore();
    },

    _alienCrawler: function (ctx, r, wob) {
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.7, r, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.7); ctx.lineTo(-r * 0.7, -r * 1.4 - wob * 4);
      ctx.moveTo(r * 0.4, -r * 0.7); ctx.lineTo(r * 0.7, -r * 1.4 - wob * 4); ctx.stroke();
    },
    _alienDrone: function (ctx, r, wob) {
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(r, r * 0.7); ctx.lineTo(r * 0.4, r * 0.3);
      ctx.lineTo(-r * 0.4, r * 0.3); ctx.lineTo(-r, r * 0.7); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#eafff5';
      ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.22, 0, Math.PI * 2); ctx.fill();
    },
    _alienBrute: function (ctx, r, wob) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, r * 0.2); ctx.lineTo(-r * 1.3, -r * 0.3 + wob * 6);
      ctx.moveTo(r * 0.8, r * 0.2); ctx.lineTo(r * 1.3, -r * 0.3 + wob * 6); ctx.stroke();
    },
    _alienWraith: function (ctx, r, wob) {
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      var pts = 7;
      for (var i = 0; i <= pts; i++) {
        var ang = (i / pts) * Math.PI * 2, rr = r * (0.7 + 0.35 * Math.sin(ang * 3 + wob * 4));
        var x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
    },
    _alienElite: function (ctx, r, wob) {
      ctx.beginPath();
      for (var i = 0; i < 10; i++) {
        var ang = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 === 0 ? r : r * 0.5;
        var x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff3e0';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2); ctx.fill();
    },
    _alienBoss: function (ctx, r, wob) {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 1.2, -r * 0.2, r * 0.8, r);
      ctx.quadraticCurveTo(0, r * 1.2, -r * 0.8, r);
      ctx.quadraticCurveTo(-r * 1.2, -r * 0.2, 0, -r);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      var eyes = [[-r * 0.4, -r * 0.1], [r * 0.4, -r * 0.1], [0, r * 0.35]];
      for (var i = 0; i < eyes.length; i++) {
        ctx.beginPath(); ctx.arc(eyes[i][0], eyes[i][1], r * 0.13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff3d6e';
        ctx.beginPath(); ctx.arc(eyes[i][0], eyes[i][1], r * 0.06, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
      }
    },

    _hpBar: function (ctx, x, y, w, ratio, color) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - w / 2, y, w, 4);
      ctx.fillStyle = color; ctx.fillRect(x - w / 2, y, w * ratio, 4);
      ctx.restore();
    },

    // —— 贴图渲染(发光光晕 + 贴图 + 受击增亮;飞船/怪物通用)——
    _sprite: function (ctx, tex, x, y, size, angle, flash, glowColor) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, glowColor || '#5ad1ff', 0, 0, size * 0.62, 0.28);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(tex, -size / 2, -size / 2, size, size);
      if (flash) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55;
        ctx.drawImage(tex, -size / 2, -size / 2, size, size);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    },

    // —— 子弹:发光精灵 + 拖尾(v0.5 按技能变体:激光粗光束 / 火焰橙拖尾 / 闪电锯齿 / 冰冻冷光)——
    bullet: function (ctx, b) {
      var fx = b.skill && b.skill.fx;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (b.trail.length > 1) {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.radius * (fx === 'laser' ? 3.0 : 1.4);   // 激光弹道更粗
        ctx.lineCap = 'round';
        ctx.globalAlpha = fx === 'fire' ? 0.4 : (fx === 'laser' ? 0.5 : 0.28);
        ctx.beginPath();
        ctx.moveTo(b.trail[0].x, b.trail[0].y);
        if (fx === 'bolt') {                          // 闪电:锯齿拖尾
          for (var i = 1; i < b.trail.length; i++) {
            var jx = (Math.random() - 0.5) * 8, jy = (Math.random() - 0.5) * 8;
            ctx.lineTo(b.trail[i].x + jx, b.trail[i].y + jy);
          }
        } else {
          for (var k = 1; k < b.trail.length; k++) ctx.lineTo(b.trail[k].x, b.trail[k].y);
        }
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      drawGlow(ctx, b.color, b.x, b.y, b.radius * (fx ? 3.4 : 3));
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.radius * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },

    // —— 粒子(发光精灵)——
    particle: function (ctx, p) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.drawImage(glow(p.color), p.x - p.r * 2, p.y - p.r * 2, p.r * 4, p.r * 4);
      ctx.restore();
    },

    // —— 金币 ——
    coin: function (ctx, c) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '#ffd166', c.x, c.y, c.r * 2.4);
      ctx.fillStyle = '#fff6cf';
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },

    // —— 技能胶囊(v0.5):技能色光晕 + 旋转六边形外壳 + 中心技能标识 ——
    powerUp: function (ctx, p) {
      var col = p.def.color, r = p.r, t = (p.t || 0);
      ctx.save();
      ctx.translate(p.x, p.y);
      // 外光晕(发光精灵)
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, col, 0, 0, r * 2.6, 0.55);
      ctx.globalCompositeOperation = 'source-over';

      // 旋转六边形外壳(脉动)
      var pulse = 1 + Math.sin(t * 5) * 0.08;
      ctx.rotate(t * 0.8);
      ctx.lineWidth = 2;
      ctx.strokeStyle = lighten(col, 0.2);
      ctx.fillStyle = hexToRgba(col, 0.22);
      ctx.beginPath();
      for (var i = 0; i <= 6; i++) {
        var ang = (i / 6) * Math.PI * 2 - Math.PI / 2;
        var rr = r * pulse;
        var px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.rotate(-t * 0.8);

      // 中心技能标识符号(随技能变体)
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.round(r * 1.1) + 'px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var sym = { ice: '❄', fire: '🔥', bolt: '⚡', laser: '✦', multi: '◎' }[p.def.fx] || '★';
      ctx.fillText(sym, 0, 1);
      ctx.restore();
    },

    // —— 飘字(描边法,不用 shadowBlur)——
    floatingText: function (ctx, f) {
      ctx.save();
      ctx.globalAlpha = f.life / f.maxLife;
      ctx.font = 'bold ' + f.size + 'px Arial';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    },

    flash: function (ctx, alpha, color) {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color || '#fff';
      ctx.fillRect(0, 0, G.Config.WIDTH, G.Config.HEIGHT);
      ctx.restore();
    },
  };

  Render._lighten = lighten;
  Render._darken = darken;
  G.Render = Render;
})(window.G = window.G || {});
