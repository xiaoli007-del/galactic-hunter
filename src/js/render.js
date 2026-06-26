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

    // —— 飞船(v0.8:雷电战机风硬表面机械重做)——
    //   按 ship.level 组装模块:引擎 → 机翼 → 船体 → 武器挂载 → 能量核心。
    //   风格:锐利三角洲剪影(远看清晰)+ 装甲分层(前缘高光/接缝/铆钉)+ 座舱罩玻璃
    //        + 双/多联引擎舱 + 尾焰 + 翼下挂点 + 反应堆外壳包裹的能量核心。
    //   等级越高:体型↑ / 武器管↑ / 核心发光↑ / 翼展↑ / 结构复杂化(Lv4+ 能量翼缘,Lv5 旋转环)。
    //   仅外观重做:朝向/功能/Lv1-5 结构/碰撞半径全不变。
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

    // 推进器(v0.8 雷电风):金属引擎舱(梯形外壳 + 高光边)+ 喷口内蓝焰 + 散热栅格 + 尾焰
    //   喷口数 1→5 环形排布;尾焰随级变长、双焰芯(外焰蓝 + 内焰白)。
    _shipEngine: function (ctx, r, t, flash) {
      var n = t;
      var fl = 0.7 + 0.3 * Math.sin(Date.now() / 55);
      var flameLen = r * (0.7 + t * 0.16) * fl;
      // 尾焰(发光精灵:外焰蓝 + 内焰白核)
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < n; i++) {
        var off = n === 1 ? 0 : (i - (n - 1) / 2) * (r * 0.30);
        drawGlow(ctx, '#4a9eff', off, r * 0.68 + flameLen * 0.4, r * (0.42 + t * 0.05), 0.6);
        drawGlow(ctx, '#eaf4ff', off, r * 0.68 + flameLen * 0.16, r * 0.18, 0.95);
      }
      ctx.globalCompositeOperation = 'source-over';
      // 引擎舱(金属梯形外壳:上窄下宽,机械感;深色喷口 + 蓝内焰 + 散热栅格)
      for (var j = 0; j < n; j++) {
        var ox = n === 1 ? 0 : (j - (n - 1) / 2) * (r * 0.30);
        var eg = ctx.createLinearGradient(ox, r * 0.5, ox, r * 0.86);
        if (flash) { eg.addColorStop(0, '#fff'); eg.addColorStop(1, '#fff'); }
        else { eg.addColorStop(0, '#aab9cc'); eg.addColorStop(0.5, '#56657a'); eg.addColorStop(1, '#262f3c'); }
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.moveTo(ox - r * 0.10, r * 0.52); ctx.lineTo(ox + r * 0.10, r * 0.52);
        ctx.lineTo(ox + r * 0.13, r * 0.80); ctx.lineTo(ox - r * 0.13, r * 0.80);
        ctx.closePath(); ctx.fill();
        ctx.lineWidth = 1.3; ctx.strokeStyle = flash ? '#fff' : '#cfe0ff'; ctx.stroke();
        ctx.fillStyle = flash ? '#fff' : '#0a1018';            // 喷口(深色椭圆)
        ctx.beginPath(); ctx.ellipse(ox, r * 0.74, r * 0.10, r * 0.07, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, '#4a9eff', ox, r * 0.74, r * 0.10, 0.9);   // 喷口内蓝焰
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = flash ? '#fff' : 'rgba(20,28,40,0.6)'; ctx.lineWidth = 1;   // 散热栅格横纹
        for (var gg = 0; gg < 3; gg++) { var gy = r * 0.56 + gg * r * 0.05; ctx.beginPath(); ctx.moveTo(ox - r * 0.10, gy); ctx.lineTo(ox + r * 0.10, gy); ctx.stroke(); }
      }
    },

    // 机翼(v0.8 雷电风):锐利三角装甲板(前缘高光 + 后缘暗)+ 翼根接缝/铆钉 + 翼尖灯
    //   + 翼下挂点荚舱(t≥3)+ 能量翼缘(t≥4)。窄→宽→分叉→能量翼。
    _shipWings: function (ctx, r, t, glow, flash) {
      var spread = [0.55, 0.85, 1.1, 1.35, 1.6][t - 1] * r;
      var fork = t >= 3, energy = t >= 4;
      var drawSide = function (s) {
        var g = ctx.createLinearGradient(0, -r * 0.1, 0, r * 0.5);   // 前缘亮 / 后缘暗
        if (flash) { g.addColorStop(0, '#fff'); g.addColorStop(1, '#cfe0f0'); }
        else { g.addColorStop(0, '#c3d0e0'); g.addColorStop(0.5, '#62738a'); g.addColorStop(1, '#2a3340'); }
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(s * r * 0.12, -r * 0.05);
        ctx.lineTo(s * spread, r * 0.12);                          // 翼尖前
        ctx.lineTo(s * spread * (fork ? 0.62 : 0.74), r * 0.46);   // 翼尖后(分叉则内收)
        if (fork) ctx.lineTo(s * spread * 0.92, r * 0.30);         // 分叉缺口
        ctx.lineTo(s * r * 0.18, r * 0.34);
        ctx.closePath(); ctx.fill();
        ctx.lineWidth = 1.8; ctx.strokeStyle = flash ? '#fff' : lighten(glow, 0.15);   // 前缘高光(最强光线)
        ctx.beginPath(); ctx.moveTo(s * r * 0.12, -r * 0.05); ctx.lineTo(s * spread, r * 0.12); ctx.stroke();
        ctx.strokeStyle = flash ? '#fff' : 'rgba(20,28,40,0.55)'; ctx.lineWidth = 1;    // 翼根接缝
        ctx.beginPath(); ctx.moveTo(s * r * 0.20, r * 0.06); ctx.lineTo(s * spread * 0.80, r * 0.30); ctx.stroke();
        ctx.fillStyle = flash ? '#fff' : '#1a2230';                                       // 铆钉点阵
        for (var rv = 0; rv < 3; rv++) { ctx.beginPath(); ctx.arc(s * (r * 0.28 + rv * spread * 0.20), r * 0.18, 1.1, 0, Math.PI * 2); ctx.fill(); }
        if (t >= 2) {   // 翼尖发光灯
          ctx.globalCompositeOperation = 'lighter';
          drawGlow(ctx, glow, s * spread, r * 0.12, r * 0.13, 0.95);
          ctx.globalCompositeOperation = 'source-over';
        }
        if (t >= 3) {   // 翼下挂点荚舱(武器挂点,雷电战机标志性细节)
          ctx.fillStyle = flash ? '#fff' : '#3a4a5a';
          ctx.beginPath(); ctx.ellipse(s * spread * 0.55, r * 0.30, r * 0.06, r * 0.14, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = flash ? '#fff' : '#56657a'; ctx.lineWidth = 0.8; ctx.stroke();
        }
        if (energy) {   // 能量翼缘(L4+)
          ctx.globalCompositeOperation = 'lighter';
          drawGlow(ctx, glow, s * spread * 0.7, r * 0.28, r * 0.40, 0.4);
          ctx.globalCompositeOperation = 'source-over';
        }
      };
      drawSide(1); drawSide(-1);
    },

    // 船体(v0.8 雷电风):梭形中段 + 中脊高光 + 装甲接缝/铆钉 + 鼻锥 + 侧面进气口
    //   + 座舱罩(暗色玻璃 + 青色反光,战斗机灵魂细节)。梭形→装甲→分体(L4+)。
    _shipHull: function (ctx, r, t, flash) {
      var split = t >= 4;
      var len = r * (1.15 + t * 0.04), wid = r * (0.3 + t * 0.04);
      var g = ctx.createLinearGradient(-r, 0, r, 0);   // 左右明暗(模拟侧光)
      if (flash) { g.addColorStop(0, '#fff'); g.addColorStop(0.5, '#dbe6f5'); g.addColorStop(1, '#fff'); }
      else { g.addColorStop(0, '#2a3340'); g.addColorStop(0.5, '#c3d0e0'); g.addColorStop(1, '#2a3340'); }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -len);
      ctx.quadraticCurveTo(wid, -r * 0.2, wid * 1.3, r * 0.5);
      ctx.lineTo(r * 0.2, r * 0.6); ctx.lineTo(-r * 0.2, r * 0.6);
      ctx.lineTo(-wid * 1.3, r * 0.5);
      ctx.quadraticCurveTo(-wid, -r * 0.2, 0, -len);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = flash ? '#fff' : '#cfe0ff'; ctx.stroke();
      ctx.strokeStyle = flash ? '#fff' : 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.2;   // 中脊高光
      ctx.beginPath(); ctx.moveTo(0, -len * 0.95); ctx.lineTo(0, r * 0.55); ctx.stroke();
      if (t >= 2) {   // 装甲板接缝 + 铆钉
        ctx.strokeStyle = flash ? '#fff' : 'rgba(20,28,40,0.6)'; ctx.lineWidth = 1;
        for (var p = 0; p < t - 1; p++) {
          var py = -r * 0.3 + p * r * 0.24;
          ctx.beginPath(); ctx.moveTo(-wid, py); ctx.lineTo(wid, py); ctx.stroke();
          ctx.fillStyle = flash ? '#fff' : '#1a2230';
          ctx.beginPath(); ctx.arc(-wid * 0.7, py, 1.2, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(wid * 0.7, py, 1.2, 0, Math.PI * 2); ctx.fill();
        }
      }
      // 鼻锥(尖端强化高光)
      var ng = ctx.createLinearGradient(0, -len, 0, -r * 0.2);
      if (flash) { ng.addColorStop(0, '#fff'); ng.addColorStop(1, '#fff'); }
      else { ng.addColorStop(0, '#e6eef8'); ng.addColorStop(1, '#56657a'); }
      ctx.fillStyle = ng;
      ctx.beginPath(); ctx.moveTo(0, -len); ctx.quadraticCurveTo(wid * 0.6, -r * 0.5, 0, -r * 0.2);
      ctx.quadraticCurveTo(-wid * 0.6, -r * 0.5, 0, -len); ctx.closePath(); ctx.fill();
      // 座舱罩(暗色玻璃 + 青色反光条 —— 雷电战机标志性细节,提升"战机"识别度)
      var cg = ctx.createLinearGradient(0, -len * 0.8, 0, -r * 0.2);
      if (flash) { cg.addColorStop(0, '#fff'); cg.addColorStop(1, '#fff'); }
      else { cg.addColorStop(0, '#0a1828'); cg.addColorStop(0.5, '#163040'); cg.addColorStop(1, '#0a1828'); }
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(0, -len * 0.82);
      ctx.quadraticCurveTo(wid * 0.55, -len * 0.5, 0, -r * 0.25);
      ctx.quadraticCurveTo(-wid * 0.55, -len * 0.5, 0, -len * 0.82);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = flash ? '#fff' : 'rgba(120,200,255,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.strokeStyle = flash ? '#fff' : 'rgba(180,230,255,0.5)'; ctx.lineWidth = 1;   // 玻璃高光弧
      ctx.beginPath(); ctx.moveTo(-wid * 0.15, -len * 0.7); ctx.quadraticCurveTo(0, -len * 0.55, wid * 0.15, -len * 0.7); ctx.stroke();
      if (t >= 3) {   // 侧面进气口(暗槽)
        ctx.fillStyle = flash ? '#fff' : '#0a1018';
        ctx.fillRect(wid * 0.9, -r * 0.05, r * 0.08, r * 0.25);
        ctx.fillRect(-wid * 0.9 - r * 0.08, -r * 0.05, r * 0.08, r * 0.25);
      }
      if (split) {   // 分体中线缝隙(L4+)
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -len * 0.9); ctx.lineTo(0, r * 0.5); ctx.stroke();
      }
    },

    // 武器挂载(v0.7):金属炮管 + 炮口环 + 散热口 + 多联装底座;1→4 管
    _shipWeapons: function (ctx, r, t, flash) {
      var n = Math.min(t, 4);
      for (var i = 0; i < n; i++) {
        var off = n === 1 ? 0 : (i - (n - 1) / 2) * r * 0.38;
        var g = ctx.createLinearGradient(off - r * 0.06, 0, off + r * 0.06, 0);   // 炮管侧高光
        if (flash) { g.addColorStop(0, '#fff'); g.addColorStop(1, '#fff'); }
        else { g.addColorStop(0, '#3a4a5a'); g.addColorStop(0.5, '#aebccf'); g.addColorStop(1, '#3a4a5a'); }
        ctx.fillStyle = g;
        ctx.fillRect(off - r * 0.055, -r * 1.28, r * 0.11, r * 0.42);
        ctx.fillStyle = flash ? '#fff' : '#0a1018';        // 炮口环(深色)
        ctx.fillRect(off - r * 0.055, -r * 1.3, r * 0.11, r * 0.06);
        ctx.fillStyle = flash ? '#fff' : 'rgba(20,28,40,0.7)';   // 散热口
        ctx.fillRect(off - r * 0.055, -r * 1.18, r * 0.11, r * 0.02);
        if (t >= 3) {   // 多联装副炮管
          ctx.fillStyle = g;
          ctx.fillRect(off - r * 0.095, -r * 1.2, r * 0.04, r * 0.3);
          ctx.fillRect(off + r * 0.055, -r * 1.2, r * 0.04, r * 0.3);
        }
      }
      if (n >= 2) {   // 多联装底座
        var bg = ctx.createLinearGradient(0, -r * 1.0, 0, -r * 0.85);
        if (flash) { bg.addColorStop(0, '#fff'); bg.addColorStop(1, '#fff'); }
        else { bg.addColorStop(0, '#3a4a5a'); bg.addColorStop(1, '#788ea0'); }
        ctx.fillStyle = bg;
        ctx.fillRect(-r * 0.45, -r * 0.95, r * 0.9, r * 0.12);
      }
    },

    // 能量核心(v0.8 雷电风):反应堆外壳(暗金属环包裹)+ 多层光晕 + 中心炽核 + 旋转能量环(L5)
    //   外壳让核心读作"被装载的反应堆"而非裸光球,机械质感↑。尺寸/亮度随级增强。
    _shipCore: function (ctx, r, t, glow, flash) {
      var size = r * (0.16 + t * 0.026);
      var alpha = 0.45 + t * 0.12;
      var float = (t >= 5) ? Math.sin(Date.now() / 180) * r * 0.06 : 0;
      var pulse = 0.9 + 0.1 * Math.sin(Date.now() / 120);
      // 反应堆外壳(source-over,先画,被光晕覆盖中心但环边露出)
      ctx.strokeStyle = flash ? '#fff' : 'rgba(36,48,62,0.95)'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, float, size * 1.55, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = flash ? '#fff' : 'rgba(130,150,172,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, float, size * 1.55, 0, Math.PI * 2); ctx.stroke();
      // 发光层(additive)
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, glow, 0, float, size * 3.2 * pulse, alpha);        // 外光晕
      drawGlow(ctx, '#ffffff', 0, float, size * 1.4, 0.5);              // 内白晕
      var g = ctx.createRadialGradient(0, float, 0, 0, float, size);
      if (flash) { g.addColorStop(0, '#fff'); g.addColorStop(1, glow); }
      else { g.addColorStop(0, '#fff'); g.addColorStop(0.4, lighten(glow, 0.3)); g.addColorStop(1, glow); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, float, size * pulse, 0, Math.PI * 2); ctx.fill();
      if (t >= 4) {   // 能量环(L4+,L5 旋转)
        var spin = (t >= 5) ? Date.now() / 600 : 0;
        ctx.strokeStyle = hexToRgba(glow, 0.65); ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(0, float, size * 1.8, spin, spin + Math.PI * 1.4); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, float, size * 1.8, spin + Math.PI, spin + Math.PI * 2.4); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    },

    // —— 外星怪(机械/生物机械生态;v0.7 精致机械装甲风重做)——
    //   不用静态贴图;每种 tier 独立轮廓 + 发光弱点核心,一眼可辨类型。
    //   精致化:装甲分割线/铆钉/炮口环/关节球/能量纹/推进口,复杂度随 tier 递增。
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
        case 7: this._alienRipper(ctx, r, wob); break;     // v0.8 撕裂者
        case 8: this._alienGuardian(ctx, r, wob); break;   // v0.8 守卫者
        case 9: this._alienColossus(ctx, r, wob); break;    // v0.8 钢铁巨像(中 Boss)
        case 10: this._alienDevourer(ctx, r, wob); break;   // v0.8 虚空吞噬者(终 Boss)
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
      if (a.telegraph > 0) this._alienTelegraph(ctx, a, r);   // v0.8 预警(突进/开火前的瞄准提示)
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

    // v0.8 预警渲染(突进/开火前的瞄准提示;世界坐标,不随怪旋转)。
    //   lunge:朝锁定 x 向下的虚线弹道 + 蓄能红光(提示玩家横移躲);
    //   gunner/aimed:炮口蓄能光 + 朝飞船的虚线瞄准线。
    _alienTelegraph: function (ctx, a, r) {
      var pulse = 0.4 + 0.5 * Math.sin(a.phase * 8);
      var col = a.def.color;
      ctx.save();
      if (a.telegraphType === 'lunge') {
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, col, a._lungeTx, a.y + r * 0.4, r * 0.5, 0.3 * pulse);
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = hexToRgba(col, 0.5 + 0.4 * pulse); ctx.lineWidth = 2.5;
        ctx.setLineDash([10, 8]);
        ctx.beginPath(); ctx.moveTo(a._lungeTx, a.y); ctx.lineTo(a._lungeTx, G.Config.HEIGHT + 40); ctx.stroke();
        ctx.setLineDash([]);
      } else {   // gunner / aimed
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, col, a.x, a.y, r * 1.3, 0.4 * pulse);
        ctx.globalCompositeOperation = 'source-over';
        if (G.Game && G.Game.ship) {
          ctx.strokeStyle = hexToRgba(col, 0.4 + 0.4 * pulse); ctx.lineWidth = 2;
          ctx.setLineDash([6, 6]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(G.Game.ship.x, G.Game.ship.y); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
    },

    // ① 装甲爬虫(v0.8):甲虫机械体 —— 头胸分节 + 六足关节 + 上颚 + 腹甲横纹(虫群入门怪)
    _alienCrawler: function (ctx, r, wob) {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.95, -r * 0.15, r * 0.62, r * 0.7);
      ctx.quadraticCurveTo(0, r * 1.05, -r * 0.62, r * 0.7);
      ctx.quadraticCurveTo(-r * 0.95, -r * 0.15, 0, -r);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 腹甲分节横缝 + 铆钉
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(20,28,40,0.6)';
      for (var s = 0; s < 3; s++) { var sy = -r * 0.4 + s * r * 0.35; ctx.beginPath(); ctx.moveTo(-r * 0.55, sy); ctx.lineTo(r * 0.55, sy); ctx.stroke(); }
      ctx.fillStyle = 'rgba(20,28,40,0.7)';
      ctx.beginPath(); ctx.arc(0, r * 0.2, 1.4, 0, Math.PI * 2); ctx.fill();
      // 六条关节足(三对左右对称,末端球关节)
      ctx.lineWidth = 2;
      for (var L = 0; L < 3; L++) {
        var ly = -r * 0.2 + L * r * 0.3, sx = r * 0.4, ey = ly + r * 0.45 + wob * 5;
        ctx.beginPath();
        ctx.moveTo(-sx, ly); ctx.lineTo(-r * 1.05, ey);
        ctx.moveTo(sx, ly); ctx.lineTo(r * 1.05, ey);
        ctx.stroke();
        ctx.fillStyle = '#1a2230';
        ctx.beginPath(); ctx.arc(-r * 1.05, ey, r * 0.07, 0, Math.PI * 2); ctx.arc(r * 1.05, ey, r * 0.07, 0, Math.PI * 2); ctx.fill();
      }
      ctx.lineWidth = 2;   // 上颚
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, -r * 0.85); ctx.lineTo(-r * 0.08, -r * 1.25);
      ctx.moveTo(r * 0.2, -r * 0.85); ctx.lineTo(r * 0.08, -r * 1.25);
      ctx.stroke();
    },
    // ② 拦截机(v0.8):锐利箭形机 —— 后掠主翼 + 鸭翼 + 翼面装甲线 + 双引擎(中速射手)
    _alienDrone: function (ctx, r, wob) {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.95);
      ctx.lineTo(r * 1.15, r * 0.55); ctx.lineTo(r * 0.45, r * 0.35);
      ctx.lineTo(0, r * 0.8); ctx.lineTo(-r * 0.45, r * 0.35); ctx.lineTo(-r * 1.15, r * 0.55);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1.5;   // 鸭翼(前缘小翼)
      ctx.beginPath();
      ctx.moveTo(r * 0.3, -r * 0.3); ctx.lineTo(r * 0.7, r * 0.05);
      ctx.moveTo(-r * 0.3, -r * 0.3); ctx.lineTo(-r * 0.7, r * 0.05);
      ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(20,28,40,0.5)';   // 翼面装甲线 + 铆钉
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.5); ctx.lineTo(r * 0.85, r * 0.3); ctx.moveTo(0, -r * 0.5); ctx.lineTo(-r * 0.85, r * 0.3);
      ctx.stroke();
      ctx.fillStyle = '#1a2230';
      ctx.beginPath(); ctx.arc(r * 0.55, r * 0.2, 1.2, 0, Math.PI * 2); ctx.arc(-r * 0.55, r * 0.2, 1.2, 0, Math.PI * 2); ctx.fill();
      // 双引擎(发光 + 深口)
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '#cfe8ff', -r * 0.75, r * 0.5, r * 0.3, 0.75);
      drawGlow(ctx, '#cfe8ff', r * 0.75, r * 0.5, r * 0.3, 0.75);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#0a1018';
      ctx.beginPath(); ctx.arc(-r * 0.75, r * 0.5, r * 0.1, 0, Math.PI * 2); ctx.arc(r * 0.75, r * 0.5, r * 0.1, 0, Math.PI * 2); ctx.fill();
    },
    // ③ 装甲巨兽(v0.8):六边形重甲堡垒 —— 内分割/铆钉 + 巨钳臂 + 关节球(高防肉盾)
    _alienBrute: function (ctx, r, wob) {
      ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        var a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        var x = Math.cos(a) * r * 0.9, y = Math.sin(a) * r * 0.9;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(20,28,40,0.55)';   // 内分割(中心向六顶点) + 铆钉
      ctx.beginPath();
      for (var k = 0; k < 6; k++) { var ka = (k / 6) * Math.PI * 2 - Math.PI / 2; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ka) * r * 0.62, Math.sin(ka) * r * 0.62); }
      ctx.stroke();
      ctx.fillStyle = '#1a2230';
      for (var rv = 0; rv < 6; rv++) { var ra = (rv / 6) * Math.PI * 2 - Math.PI / 2; ctx.beginPath(); ctx.arc(Math.cos(ra) * r * 0.6, Math.sin(ra) * r * 0.6, 1.4, 0, Math.PI * 2); ctx.fill(); }
      ctx.lineWidth = 5;   // 巨钳臂(粗)
      ctx.beginPath();
      ctx.moveTo(-r * 0.85, r * 0.3); ctx.quadraticCurveTo(-r * 1.5, r * 0.1, -r * 1.6, -r * 0.45 + wob * 6);
      ctx.moveTo(r * 0.85, r * 0.3); ctx.quadraticCurveTo(r * 1.5, r * 0.1, r * 1.6, -r * 0.45 + wob * 6);
      ctx.stroke();
      ctx.fillStyle = '#1a2230';   // 钳臂关节球
      ctx.beginPath(); ctx.arc(-r * 1.6, -r * 0.45 + wob * 6, r * 0.18, 0, Math.PI * 2);
      ctx.arc(r * 1.6, -r * 0.45 + wob * 6, r * 0.18, 0, Math.PI * 2); ctx.fill();
    },
    // ④ 相位幽影(v0.8):半透明幽灵蝠 —— 波浪膜翼 + 能量经脉 + 经脉节点 + 触须发光端(闪避型)
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
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.4)';   // 能量经脉(螺旋感)
      ctx.beginPath();
      for (var s = 0; s < 3; s++) { ctx.moveTo(-r * 0.4, -r * 0.3 + s * r * 0.3); ctx.quadraticCurveTo(0, -r * 0.15 + s * r * 0.3, r * 0.4, -r * 0.3 + s * r * 0.3); }
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';   // 经脉节点(发光)
      for (var n = 0; n < 4; n++) { var na = n / 4 * Math.PI * 2 + wob; drawGlow(ctx, '#c77dff', Math.cos(na) * r * 0.4, Math.sin(na) * r * 0.4, r * 0.08, 0.7); }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.5;   // 触须
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, r * 0.6); ctx.quadraticCurveTo(-r * 0.8, r * 1.0, -r * 0.6 + wob * 4, r * 1.4);
      ctx.moveTo(r * 0.4, r * 0.6); ctx.quadraticCurveTo(r * 0.8, r * 1.0, r * 0.6 - wob * 4, r * 1.4);
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';   // 触须发光端
      drawGlow(ctx, '#c77dff', -r * 0.6 + wob * 4, r * 1.4, r * 0.13, 0.7);
      drawGlow(ctx, '#c77dff', r * 0.6 - wob * 4, r * 1.4, r * 0.13, 0.7);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    },
    // ⑤ 精英装甲(v0.8):八边形炮艇 —— 双肩炮 + 装甲分割 + 暴露反应堆(高分目标)
    _alienElite: function (ctx, r, wob) {
      ctx.beginPath();
      var pts = [[0, -1], [0.6, -0.7], [1, -0.1], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, -0.1], [-0.6, -0.7]];
      for (var i = 0; i < pts.length; i++) {
        i ? ctx.lineTo(pts[i][0] * r, pts[i][1] * r) : ctx.moveTo(pts[i][0] * r, pts[i][1] * r);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(20,28,40,0.6)';   // 装甲分割(十字) + 铆钉
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.3); ctx.lineTo(r * 0.5, -r * 0.3);
      ctx.moveTo(0, -r * 0.6); ctx.lineTo(0, r * 0.6);
      ctx.stroke();
      ctx.fillStyle = '#1a2230';
      ctx.beginPath(); ctx.arc(-r * 0.35, r * 0.4, 1.3, 0, Math.PI * 2); ctx.arc(r * 0.35, r * 0.4, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#5a6a7a';   // 双肩炮(炮管 + 炮口环 + 深口)
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.4); ctx.lineTo(-r * 1.25, -r * 0.8);
      ctx.moveTo(r * 0.7, -r * 0.4); ctx.lineTo(r * 1.25, -r * 0.8);
      ctx.stroke();
      ctx.fillStyle = '#0a1018';
      ctx.beginPath(); ctx.arc(-r * 1.25, -r * 0.8, r * 0.14, 0, Math.PI * 2); ctx.arc(r * 1.25, -r * 0.8, r * 0.14, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5a6a7a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(-r * 1.25, -r * 0.8, r * 0.19, 0, Math.PI * 2); ctx.arc(r * 1.25, -r * 0.8, r * 0.19, 0, Math.PI * 2); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';   // 暴露反应堆(底部光)
      drawGlow(ctx, '#ff8a3d', 0, r * 0.9, r * 0.18, 0.7);
      ctx.globalCompositeOperation = 'source-over';
    },
    // ⑥ 巨构 Boss(v0.8):移动堡垒 —— 分段装甲 + 多核心眼 + 环形铆钉 + 顶刺(可破坏感)
    _alienBoss: function (ctx, r, wob) {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 1.35, -r * 0.2, r * 0.95, r);
      ctx.quadraticCurveTo(0, r * 1.3, -r * 0.95, r);
      ctx.quadraticCurveTo(-r * 1.35, -r * 0.2, 0, -r);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(20,28,40,0.6)';   // 装甲段分割(多层曲线)
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, -r * 0.3); ctx.quadraticCurveTo(0, -r * 0.55, r * 0.75, -r * 0.3);
      ctx.moveTo(-r * 0.95, r * 0.3); ctx.quadraticCurveTo(0, r * 0.1, r * 0.95, r * 0.3);
      ctx.moveTo(-r * 0.5, r * 0.7); ctx.quadraticCurveTo(0, r * 0.5, r * 0.5, r * 0.7);
      ctx.stroke();
      ctx.fillStyle = '#1a2230';   // 环形铆钉
      for (var rv = 0; rv < 8; rv++) { var ra = rv / 8 * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(ra) * r * 0.6, Math.sin(ra) * r * 0.6, 1.6, 0, Math.PI * 2); ctx.fill(); }
      ctx.lineWidth = 3; ctx.strokeStyle = '#5a3a4a';   // 顶刺(带底座)
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.8); ctx.lineTo(-r * 0.85, -r * 1.35);
      ctx.moveTo(r * 0.5, -r * 0.8); ctx.lineTo(r * 0.85, -r * 1.35);
      ctx.stroke();
      ctx.fillStyle = '#3a2a35';
      ctx.beginPath(); ctx.arc(-r * 0.5, -r * 0.8, r * 0.08, 0, Math.PI * 2); ctx.arc(r * 0.5, -r * 0.8, r * 0.08, 0, Math.PI * 2); ctx.fill();
      var eyes = [[-r * 0.4, -r * 0.1], [r * 0.4, -r * 0.1], [0, r * 0.4]];   // 多核心发光眼
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < eyes.length; i++) drawGlow(ctx, '#ff3d6e', eyes[i][0], eyes[i][1], r * 0.2, 0.85);
      ctx.globalCompositeOperation = 'source-over';
      for (var j = 0; j < eyes.length; j++) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(eyes[j][0], eyes[j][1], r * 0.13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff3d6e';
        ctx.beginPath(); ctx.arc(eyes[j][0], eyes[j][1], r * 0.07, 0, Math.PI * 2); ctx.fill();
      }
    },

    // ⑦ 撕裂者(v0.8):掠食飞镖 —— 前掠利刃 + 中脊 + 后置双推进器(预警突进型,轮廓锐利)
    //   中心独眼由 alien() 的弱点核心提供。
    _alienRipper: function (ctx, r, wob) {
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.1);
      ctx.lineTo(r * 1.0, r * 0.3); ctx.lineTo(r * 0.4, r * 0.55);
      ctx.lineTo(0, r * 0.85); ctx.lineTo(-r * 0.4, r * 0.55); ctx.lineTo(-r * 1.0, r * 0.3);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(20,28,40,0.55)';   // 中脊线
      ctx.beginPath(); ctx.moveTo(0, -r * 1.0); ctx.lineTo(0, r * 0.7); ctx.stroke();
      ctx.lineWidth = 1.8;   // 前掠刃前缘高光
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.0); ctx.lineTo(r * 0.95, r * 0.3);
      ctx.moveTo(0, -r * 1.0); ctx.lineTo(-r * 0.95, r * 0.3);
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';   // 后置双推进器
      drawGlow(ctx, '#ff3344', -r * 0.5, r * 0.7, r * 0.22, 0.8);
      drawGlow(ctx, '#ff3344', r * 0.5, r * 0.7, r * 0.22, 0.8);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#0a1018';
      ctx.beginPath(); ctx.arc(-r * 0.5, r * 0.7, r * 0.09, 0, Math.PI * 2); ctx.arc(r * 0.5, r * 0.7, r * 0.09, 0, Math.PI * 2); ctx.fill();
    },
    // ⑧ 守卫者(v0.8):武装哨兵 —— 方形八边体 + 大型前主炮 + 侧翼护板(预警射击型)
    //   预警期朝飞船转向,主炮随之指向目标。中心弱点核由 alien() 提供。
    _alienGuardian: function (ctx, r, wob) {
      ctx.beginPath();
      var pts = [[0, -0.85], [0.8, -0.55], [0.95, 0.1], [0.8, 0.65], [0, 0.9], [-0.8, 0.65], [-0.95, 0.1], [-0.8, -0.55]];
      for (var i = 0; i < pts.length; i++) {
        i ? ctx.lineTo(pts[i][0] * r, pts[i][1] * r) : ctx.moveTo(pts[i][0] * r, pts[i][1] * r);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(20,28,40,0.6)';   // 装甲分割(十字) + 铆钉
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.2); ctx.lineTo(r * 0.6, -r * 0.2);
      ctx.moveTo(0, -r * 0.7); ctx.lineTo(0, r * 0.7);
      ctx.stroke();
      ctx.fillStyle = '#1a2230';
      ctx.beginPath(); ctx.arc(-r * 0.45, r * 0.35, 1.4, 0, Math.PI * 2); ctx.arc(r * 0.45, r * 0.35, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#5a6a7a';   // 大型前主炮(炮管 + 炮口环 + 深口)
      ctx.beginPath(); ctx.moveTo(0, -r * 0.5); ctx.lineTo(0, -r * 1.3); ctx.stroke();
      ctx.fillStyle = '#0a1018';
      ctx.beginPath(); ctx.arc(0, -r * 1.3, r * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5a6a7a'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(0, -r * 1.3, r * 0.22, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 3;   // 侧翼护板(盾)
      ctx.beginPath();
      ctx.moveTo(-r * 0.85, -r * 0.1); ctx.lineTo(-r * 1.2, -r * 0.45);
      ctx.moveTo(r * 0.85, -r * 0.1); ctx.lineTo(r * 1.2, -r * 0.45);
      ctx.stroke();
    },
    // ⑨ 钢铁巨像(v0.8 中 Boss):悬浮炮台堡垒 —— 旋转外环 + 六边形核心 + 6 炮口 + 中央反应堆
    _alienColossus: function (ctx, r, wob) {
      var spin = (Date.now() / 1400) % (Math.PI * 2);   // 外旋转环(断续弧,缓慢自转)
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,92,42,0.5)';
      for (var seg = 0; seg < 6; seg++) {
        var a0 = spin + seg * Math.PI / 3;
        ctx.beginPath(); ctx.arc(0, 0, r * 1.15, a0, a0 + Math.PI / 6); ctx.stroke();
      }
      ctx.beginPath();   // 本体:六边形核心(厚重)
      for (var i = 0; i < 6; i++) {
        var a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        var x = Math.cos(a) * r * 0.92, y = Math.sin(a) * r * 0.92;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(20,28,40,0.6)';   // 内分割(中心向六顶点) + 铆钉
      ctx.beginPath();
      for (var k = 0; k < 6; k++) { var ka = (k / 6) * Math.PI * 2 - Math.PI / 2; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ka) * r * 0.7, Math.sin(ka) * r * 0.7); }
      ctx.stroke();
      ctx.fillStyle = '#1a2230';
      for (var rv = 0; rv < 6; rv++) { var ra = (rv / 6) * Math.PI * 2 - Math.PI / 2; ctx.beginPath(); ctx.arc(Math.cos(ra) * r * 0.7, Math.sin(ra) * r * 0.7, 1.8, 0, Math.PI * 2); ctx.fill(); }
      for (var c = 0; c < 6; c++) {   // 6 炮口(六顶点外突,深口 + 环)
        var ca = (c / 6) * Math.PI * 2 - Math.PI / 2;
        var cx = Math.cos(ca) * r * 0.92, cy = Math.sin(ca) * r * 0.92;
        ctx.fillStyle = '#0a1018';
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#5a6a7a'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.14, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';   // 中央反应堆(发光)
      drawGlow(ctx, '#ff5c2a', 0, 0, r * 0.45, 0.9);
      ctx.globalCompositeOperation = 'source-over';
      var rg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.22);
      rg.addColorStop(0, '#fff'); rg.addColorStop(0.5, '#ff5c2a'); rg.addColorStop(1, '#ff5c2a');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2); ctx.fill();
    },
    // ⑩ 虚空吞噬者(v0.8 终 Boss):虚空巨构 —— 双旋转能量阵列 + 多段装甲 + 5 核心眼 + 尖刺(三阶段弹幕)
    _alienDevourer: function (ctx, r, wob) {
      var spin = (Date.now() / 900) % (Math.PI * 2);   // 双旋转能量阵列(反向)
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(177,77,255,0.55)';
      for (var seg = 0; seg < 8; seg++) {
        var a0 = spin + seg * Math.PI / 4;
        ctx.beginPath(); ctx.arc(0, 0, r * 1.2, a0, a0 + Math.PI / 8); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, r * 1.35, -spin + seg * Math.PI / 4, -spin + seg * Math.PI / 4 + Math.PI / 8); ctx.stroke();
      }
      ctx.beginPath();   // 本体:不规则巨构团块
      ctx.moveTo(0, -r * 1.05);
      ctx.quadraticCurveTo(r * 1.4, -r * 0.25, r * 1.0, r);
      ctx.quadraticCurveTo(0, r * 1.3, -r * 1.0, r);
      ctx.quadraticCurveTo(-r * 1.4, -r * 0.25, 0, -r * 1.05);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(20,28,40,0.6)';   // 装甲段分割(多层)
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, -r * 0.35); ctx.quadraticCurveTo(0, -r * 0.6, r * 0.8, -r * 0.35);
      ctx.moveTo(-r * 1.0, r * 0.3); ctx.quadraticCurveTo(0, r * 0.1, r * 1.0, r * 0.3);
      ctx.moveTo(-r * 0.55, r * 0.75); ctx.quadraticCurveTo(0, r * 0.55, r * 0.55, r * 0.75);
      ctx.stroke();
      ctx.fillStyle = '#1a2230';   // 环形铆钉
      for (var rv = 0; rv < 10; rv++) { var ra = rv / 10 * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(ra) * r * 0.7, Math.sin(ra) * r * 0.7, 1.8, 0, Math.PI * 2); ctx.fill(); }
      ctx.lineWidth = 3.5; ctx.strokeStyle = '#4a2a5a';   // 尖刺(4 根,带底座)
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.85); ctx.lineTo(-r * 0.95, -r * 1.4);
      ctx.moveTo(r * 0.6, -r * 0.85); ctx.lineTo(r * 0.95, -r * 1.4);
      ctx.moveTo(-r * 0.7, r * 0.6); ctx.lineTo(-r * 1.1, r * 1.1);
      ctx.moveTo(r * 0.7, r * 0.6); ctx.lineTo(r * 1.1, r * 1.1);
      ctx.stroke();
      var eyes = [[-r * 0.45, -r * 0.15], [r * 0.45, -r * 0.15], [-r * 0.45, r * 0.45], [r * 0.45, r * 0.45], [0, r * 0.05]];   // 5 核心眼
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < eyes.length; i++) drawGlow(ctx, '#b14dff', eyes[i][0], eyes[i][1], r * 0.16, 0.85);
      ctx.globalCompositeOperation = 'source-over';
      for (var j = 0; j < eyes.length; j++) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(eyes[j][0], eyes[j][1], r * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#b14dff';
        ctx.beginPath(); ctx.arc(eyes[j][0], eyes[j][1], r * 0.05, 0, Math.PI * 2); ctx.fill();
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

    // —— 敌弹(v0.8):发光精灵 + 渐变弹体 + 自旋十字弹核(慢速可走位躲避)——
    enemyBullet: function (ctx, b) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, b.color, b.x, b.y, b.radius * 2.6, 0.85);
      var g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.radius);
      g.addColorStop(0, '#fff'); g.addColorStop(0.5, b.color); g.addColorStop(1, hexToRgba(b.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
      ctx.translate(b.x, b.y); ctx.rotate(b.phase);   // 自旋十字(机械弹核)
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-b.radius * 0.7, 0); ctx.lineTo(b.radius * 0.7, 0);
      ctx.moveTo(0, -b.radius * 0.7); ctx.lineTo(0, b.radius * 0.7);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
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

    // —— 金币 / 能量水晶(v0.7:旋转六边形水晶 + 中心十字高光)——
    //   旧版是"白点 + 金晕"的小亮点,被玩家误当成追踪弹。现做成明显的水晶收集物:
    //   金色渐变六边形 + 自转 + 白十字高光 + 柔光晕,一眼是奖励不是攻击。
    coin: function (ctx, c) {
      var r = c.r, t = c.t || 0;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '#ffd166', 0, 0, r * 2.4, 0.8);          // 柔金光晕
      ctx.globalCompositeOperation = 'source-over';
      ctx.rotate(t * 2);                                      // 缓慢自转
      var g = ctx.createLinearGradient(0, -r, 0, r);         // 纵向金属渐变(立体感)
      g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, '#ffd166'); g.addColorStop(1, '#c98a1e');
      ctx.fillStyle = g;
      ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        var a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        var px = Math.cos(a) * r, py = Math.sin(a) * r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#fff3b0'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.rotate(-t * 2);                                     // 转回,画不旋转的中心十字高光
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, 0); ctx.lineTo(r * 0.5, 0);
      ctx.moveTo(0, -r * 0.5); ctx.lineTo(0, r * 0.5);
      ctx.stroke();
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
