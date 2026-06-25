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
    // 容错:lighten()/darken() 返回 'rgb(r,g,b)' 字符串。若直接喂给 drawGlow/glow
    // (内部走 hexToRgba→hexToRgb),非 hex 会解析成 NaN,使 addColorStop 抛异常
    // (alien 弱点核心光晕即因此崩,真机 Canvas 校验色值、node smoke 的 mock 不校验故漏网)。
    // 先识别 rgb()/rgba(),使其也能进入统一颜色管线。
    if (typeof hex === 'string') {
      var m = hex.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    }
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

    // —— 飞船(模块化 + 阶段进化,v0.6)——
    //   不再用静态贴图(无法表达升级外观变化);改为按 ship.level 组装模块:
    //   引擎 → 机翼 → 船体 → 武器挂载 → 能量核心(最关键,发光随等级增强)。
    //   等级越高:体积↑ / 武器数↑ / 核心发光↑ / 结构 单体→拼装→机械复杂化 / 尾焰↑。
    ship: function (ctx, ship) {
      var lvl = ship.level || 1;
      var visScale = 1 + (lvl - 1) * 0.06;      // 体型随等级放大(Lv5≈1.24×;仅视觉,碰撞半径不变)
      var glowColor = ship.glow || '#5ad1ff';    // 等级光晕色(见 Config.SHIPS[].glow)
      var r = ship.radius, flash = ship.hitFlash > 0;
      var t = Math.max(1, Math.min(5, lvl));     // 进化阶段 1..5
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(ship.aimAngle + Math.PI / 2);
      ctx.scale(visScale, visScale);
      this._shipEngine(ctx, r, t, flash);
      this._shipWings(ctx, r, t, glowColor, flash);
      this._shipHull(ctx, r, t, flash);
      this._shipWeapons(ctx, r, t, flash);
      this._shipCore(ctx, r, t, glowColor, flash);
      ctx.restore();
    },

    // 推进器:喷口数 1→2→3→4→5(环形),尾焰随等级变长变亮
    _shipEngine: function (ctx, r, t, flash) {
      var n = t;
      var fl = 0.7 + 0.3 * Math.sin(Date.now() / 55);
      var flameLen = r * (0.7 + t * 0.16) * fl;
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < n; i++) {
        var off = n === 1 ? 0 : (i - (n - 1) / 2) * (r * 0.32);
        drawGlow(ctx, '#4a9eff', off, r * 0.62 + flameLen * 0.4, r * (0.42 + t * 0.05), 0.65);
        drawGlow(ctx, '#cfe8ff', off, r * 0.62 + flameLen * 0.18, r * 0.2, 0.85);
      }
      ctx.globalCompositeOperation = 'source-over';
      for (var j = 0; j < n; j++) {
        var ox = n === 1 ? 0 : (j - (n - 1) / 2) * (r * 0.32);
        var g = ctx.createLinearGradient(ox, r * 0.5, ox, r * 0.8);
        if (flash) { g.addColorStop(0, '#fff'); g.addColorStop(1, '#fff'); }
        else { g.addColorStop(0, '#3a4a5a'); g.addColorStop(1, '#788ea0'); }
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(ox, r * 0.64, r * 0.1, r * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      }
    },

    // 机翼:窄→宽→分叉→能量翼缘;左右对称
    _shipWings: function (ctx, r, t, glow, flash) {
      var spread = [0.55, 0.85, 1.1, 1.35, 1.6][t - 1] * r;
      var fork = t >= 3, energy = t >= 4;
      var drawSide = function (s) {
        var g = ctx.createLinearGradient(0, 0, s * spread, 0);
        if (flash) { g.addColorStop(0, '#fff'); g.addColorStop(1, '#cfe0f0'); }
        else { g.addColorStop(0, '#5a6a7a'); g.addColorStop(0.5, '#9fb0c6'); g.addColorStop(1, '#2a3340'); }
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(s * r * 0.15, -r * 0.1);
        ctx.lineTo(s * spread, r * 0.15);
        ctx.lineTo(s * spread * (fork ? 0.65 : 0.78), r * (fork ? 0.5 : 0.45));
        ctx.lineTo(s * r * 0.2, r * 0.38);
        ctx.closePath(); ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = flash ? '#fff' : lighten(glow, 0.15); ctx.stroke();
        if (energy) {   // 能量翼缘
          ctx.globalCompositeOperation = 'lighter';
          drawGlow(ctx, glow, s * spread * 0.8, r * 0.28, r * 0.46, 0.45);
          ctx.globalCompositeOperation = 'source-over';
        }
      };
      drawSide(1); drawSide(-1);
    },

    // 船体核心:梭形→装甲条纹→分体结构;金属渐变
    _shipHull: function (ctx, r, t, flash) {
      var split = t >= 4;
      var len = r * (1.15 + t * 0.04), wid = r * (0.3 + t * 0.04);
      var g = ctx.createLinearGradient(-r, 0, r, 0);
      if (flash) { g.addColorStop(0, '#fff'); g.addColorStop(0.5, '#dbe6f5'); g.addColorStop(1, '#fff'); }
      else { g.addColorStop(0, '#2a3340'); g.addColorStop(0.5, '#aebccf'); g.addColorStop(1, '#2a3340'); }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -len);
      ctx.quadraticCurveTo(wid, -r * 0.2, wid * 1.3, r * 0.5);
      ctx.lineTo(r * 0.2, r * 0.6); ctx.lineTo(-r * 0.2, r * 0.6);
      ctx.lineTo(-wid * 1.3, r * 0.5);
      ctx.quadraticCurveTo(-wid, -r * 0.2, 0, -len);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = flash ? '#fff' : '#cfe0ff'; ctx.stroke();
      if (t >= 2) {   // 装甲板拼接条纹
        ctx.strokeStyle = 'rgba(20,28,40,0.55)'; ctx.lineWidth = 1;
        for (var p = 0; p < t - 1; p++) {
          var py = -r * 0.3 + p * r * 0.24;
          ctx.beginPath(); ctx.moveTo(-wid, py); ctx.lineTo(wid, py); ctx.stroke();
        }
      }
      if (split) {   // 分体结构(Lv4+)中线缝隙
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -len * 0.9); ctx.lineTo(0, r * 0.5); ctx.stroke();
      }
    },

    // 武器挂载:1→2→3→4 管,高级多联装
    _shipWeapons: function (ctx, r, t, flash) {
      var n = Math.min(t, 4);
      for (var i = 0; i < n; i++) {
        var off = n === 1 ? 0 : (i - (n - 1) / 2) * r * 0.38;
        var g = ctx.createLinearGradient(off, -r * 1.0, off, -r * 1.3);
        if (flash) { g.addColorStop(0, '#fff'); g.addColorStop(1, '#fff'); }
        else { g.addColorStop(0, '#788ea0'); g.addColorStop(1, '#3a4a5a'); }
        ctx.fillStyle = g;
        ctx.fillRect(off - r * 0.05, -r * 1.28, r * 0.1, r * 0.42);
        if (t >= 3) {   // 多联装炮管
          ctx.fillRect(off - r * 0.09, -r * 1.2, r * 0.045, r * 0.3);
          ctx.fillRect(off + r * 0.045, -r * 1.2, r * 0.045, r * 0.3);
        }
      }
    },

    // 能量核心(最关键):尺寸/亮度随等级增强,Lv5 悬浮 + 能量环
    _shipCore: function (ctx, r, t, glow, flash) {
      var size = r * (0.16 + t * 0.026);
      var alpha = 0.45 + t * 0.12;
      var float = (t >= 5) ? Math.sin(Date.now() / 180) * r * 0.06 : 0;
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, glow, 0, float, size * 3.0, alpha);
      var g = ctx.createRadialGradient(0, float, 0, 0, float, size);
      if (flash) { g.addColorStop(0, '#fff'); g.addColorStop(1, glow); }
      else { g.addColorStop(0, '#fff'); g.addColorStop(0.4, lighten(glow, 0.3)); g.addColorStop(1, glow); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, float, size, 0, Math.PI * 2); ctx.fill();
      if (t >= 5) {   // 悬浮能量环
        ctx.strokeStyle = hexToRgba(glow, 0.6); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, float, size * 1.8, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    },

    // —— 外星怪(机械/生物机械生态,v0.6)——
    //   不用静态贴图;每种 tier 有独立轮廓 + 发光弱点核心,一眼可辨类型,
    //   复杂度/光效随 tier 递增。统一规则:发光弱点核心 + 清晰轮廓 + 太空机械风。
    alien: function (ctx, a) {
      var def = a.def, r = def.radius, flash = a.hitFlash > 0;
      ctx.save();
      ctx.translate(a.x, a.y); ctx.rotate(a.angle);
      var wob = Math.sin(a.phase) * 0.5 + 0.5;

      // 外光晕(发光精灵)
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, def.color, 0, 0, r * 2.4, 0.5);
      ctx.globalCompositeOperation = 'source-over';

      // 本体径向渐变(内亮外暗,机械装甲质感)
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

      // 发光弱点核心(非 Boss;Boss 自带多核心节点)。越强越亮,随 tier 增大。
      if (!a.isBoss) {
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, lighten(def.color, 0.3), 0, 0, r * (0.4 + def.tier * 0.06), 0.5 + def.tier * 0.05);
        ctx.globalCompositeOperation = 'source-over';
        var cg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * (0.14 + def.tier * 0.02));
        cg.addColorStop(0, '#fff'); cg.addColorStop(0.5, lighten(def.color, 0.4)); cg.addColorStop(1, def.color);
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(0, 0, r * (0.14 + def.tier * 0.02), 0, Math.PI * 2); ctx.fill();
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

    // ① 小型追踪虫 Drone Bug:装甲水滴体 + 尖刺腿 + 上颚(快速/自爆感)
    _alienCrawler: function (ctx, r, wob) {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.9, -r * 0.2, r * 0.6, r * 0.7);
      ctx.quadraticCurveTo(0, r * 1.05, -r * 0.6, r * 0.7);
      ctx.quadraticCurveTo(-r * 0.9, -r * 0.2, 0, -r);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();   // 三条尖刺腿
      ctx.moveTo(-r * 0.5, r * 0.4); ctx.lineTo(-r * 1.0, r * 0.9 + wob * 5);
      ctx.moveTo(0, r * 0.55); ctx.lineTo(0, r * 1.2 + wob * 5);
      ctx.moveTo(r * 0.5, r * 0.4); ctx.lineTo(r * 1.0, r * 0.9 + wob * 5);
      ctx.stroke();
      ctx.beginPath();   // 上颚
      ctx.moveTo(-r * 0.2, -r * 0.85); ctx.lineTo(-r * 0.08, -r * 1.2);
      ctx.moveTo(r * 0.2, -r * 0.85); ctx.lineTo(r * 0.08, -r * 1.2);
      ctx.stroke();
    },
    // ② 拦截机 Interceptor:后掠三角翼 + 双引擎(中距射击型)
    _alienDrone: function (ctx, r, wob) {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.9);
      ctx.lineTo(r * 1.1, r * 0.6); ctx.lineTo(r * 0.5, r * 0.4);
      ctx.lineTo(0, r * 0.8); ctx.lineTo(-r * 0.5, r * 0.4); ctx.lineTo(-r * 1.1, r * 0.6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '#cfe8ff', -r * 0.7, r * 0.5, r * 0.3, 0.7);   // 双引擎光
      drawGlow(ctx, '#cfe8ff', r * 0.7, r * 0.5, r * 0.3, 0.7);
      ctx.globalCompositeOperation = 'source-over';
    },
    // ③ 装甲巨兽 Armored Brute:六边形装甲体 + 钳臂 + 凹陷核心(高防肉盾)
    _alienBrute: function (ctx, r, wob) {
      ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        var a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        var x = Math.cos(a) * r * 0.85, y = Math.sin(a) * r * 0.85;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 4;   // 双钳臂
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, r * 0.3); ctx.quadraticCurveTo(-r * 1.4, r * 0.1, -r * 1.5, -r * 0.4 + wob * 6);
      ctx.moveTo(r * 0.8, r * 0.3); ctx.quadraticCurveTo(r * 1.4, r * 0.1, r * 1.5, -r * 0.4 + wob * 6);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(-r * 1.5, -r * 0.4 + wob * 6, r * 0.16, 0, Math.PI * 2);
      ctx.arc(r * 1.5, -r * 0.4 + wob * 6, r * 0.16, 0, Math.PI * 2); ctx.fill();
    },
    // ④ 相位幽影 Phase Wraith:半透明波浪生物机械体 + 触须(闪避型)
    _alienWraith: function (ctx, r, wob) {
      ctx.globalAlpha = 0.82;
      ctx.beginPath();
      var pts = 9;
      for (var i = 0; i <= pts; i++) {
        var ang = (i / pts) * Math.PI * 2, rr = r * (0.7 + 0.3 * Math.sin(ang * 3 + wob * 4));
        var x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 0.5;   // 触须
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, r * 0.6); ctx.quadraticCurveTo(-r * 0.8, r * 1.0, -r * 0.6 + wob * 4, r * 1.4);
      ctx.moveTo(r * 0.4, r * 0.6); ctx.quadraticCurveTo(r * 0.8, r * 1.0, r * 0.6 - wob * 4, r * 1.4);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    // ⑤ 精英装甲 Elite Armor:不规则八边形机械体 + 肩炮 + 装甲分割 + 暴露弱点核心
    _alienElite: function (ctx, r, wob) {
      ctx.beginPath();
      var pts = [[0, -1], [0.6, -0.7], [1, -0.1], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, -0.1], [-0.6, -0.7]];
      for (var i = 0; i < pts.length; i++) {
        i ? ctx.lineTo(pts[i][0] * r, pts[i][1] * r) : ctx.moveTo(pts[i][0] * r, pts[i][1] * r);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 3;   // 肩炮
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.4); ctx.lineTo(-r * 1.2, -r * 0.8);
      ctx.moveTo(r * 0.7, -r * 0.4); ctx.lineTo(r * 1.2, -r * 0.8);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(-r * 1.2, -r * 0.8, r * 0.15, 0, Math.PI * 2);
      ctx.arc(r * 1.2, -r * 0.8, r * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.5;   // 装甲分割线
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.3); ctx.lineTo(r * 0.5, -r * 0.3);
      ctx.moveTo(0, -r * 0.6); ctx.lineTo(0, r * 0.6);
      ctx.stroke();
    },
    // ⑥ 巨构 Boss Colossus:分段团块 + 多核心节点 + 尖刺(占屏 1/3,分段可破坏感)
    _alienBoss: function (ctx, r, wob) {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 1.3, -r * 0.2, r * 0.9, r);
      ctx.quadraticCurveTo(0, r * 1.25, -r * 0.9, r);
      ctx.quadraticCurveTo(-r * 1.3, -r * 0.2, 0, -r);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 2;   // 装甲段分割(可破坏感)
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.3); ctx.quadraticCurveTo(0, -r * 0.5, r * 0.7, -r * 0.3);
      ctx.moveTo(-r * 0.9, r * 0.3); ctx.quadraticCurveTo(0, r * 0.1, r * 0.9, r * 0.3);
      ctx.stroke();
      ctx.lineWidth = 3;   // 顶刺
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.8); ctx.lineTo(-r * 0.8, -r * 1.3);
      ctx.moveTo(r * 0.5, -r * 0.8); ctx.lineTo(r * 0.8, -r * 1.3);
      ctx.stroke();
      var eyes = [[-r * 0.4, -r * 0.1], [r * 0.4, -r * 0.1], [0, r * 0.35]];   // 多核心节点
      for (var i = 0; i < eyes.length; i++) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(eyes[i][0], eyes[i][1], r * 0.12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff3d6e';
        ctx.beginPath(); ctx.arc(eyes[i][0], eyes[i][1], r * 0.06, 0, Math.PI * 2); ctx.fill();
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
