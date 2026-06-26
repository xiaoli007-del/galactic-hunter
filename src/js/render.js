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

  var stars = null, bgCanvas = null, bgImage = null;
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

  // v0.8 金属渐变(雷电硬表面):从亮顶到暗底的装甲面,带中段反射高光。
  //   flash 闪白时直接全白。统一所有飞船模块/怪的金属质感,避免每处重写 createLinearGradient。
  function metalGrad(ctx, x0, y0, x1, y1, flash) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    if (flash) { g.addColorStop(0, '#fff'); g.addColorStop(1, '#fff'); return g; }
    g.addColorStop(0, '#cdd8e6');     // 顶部高光(冷光)
    g.addColorStop(0.35, '#8a99ad');  // 中上反射
    g.addColorStop(0.55, '#566478');  // 明暗交界
    g.addColorStop(1, '#2a3340');      // 底部阴影
    return g;
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

  // 背景预渲染:深空紫蓝星云 + 旋涡星系 + 行星 + 小行星带 + 能量边框
  //   根据玩家提供的设定图风格重绘:深紫/蓝色星云、左侧旋涡星系、右侧行星、底部小行星
  function buildBackground() {
    var cfg = G.Config, W = cfg.WIDTH, H = cfg.HEIGHT;
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = W; bgCanvas.height = H;
    var ctx = bgCanvas.getContext('2d');

    // 深空底色:极深蓝黑
    var bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 80, W * 0.5, H * 0.5, H * 0.85);
    bg.addColorStop(0, '#0c0a1a'); bg.addColorStop(0.5, '#080612'); bg.addColorStop(1, '#04030a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // 星云层:紫色/蓝色/洋红交织
    var nebulae = [
      { x: W * 0.35, y: H * 0.35, r: 400, c: 'rgba(80,30,160,0.28)' },   // 紫色主星云
      { x: W * 0.65, y: H * 0.45, r: 380, c: 'rgba(30,60,180,0.25)' },   // 蓝色星云
      { x: W * 0.20, y: H * 0.55, r: 350, c: 'rgba(140,20,100,0.20)' },  // 洋红星云
      { x: W * 0.50, y: H * 0.25, r: 300, c: 'rgba(60,40,140,0.18)' },   // 淡紫高层
      { x: W * 0.80, y: H * 0.70, r: 320, c: 'rgba(20,50,120,0.15)' },   // 深蓝低层
    ];
    for (var i = 0; i < nebulae.length; i++) {
      var nb = nebulae[i];
      var g = ctx.createRadialGradient(nb.x, nb.y, 20, nb.x, nb.y, nb.r);
      g.addColorStop(0, nb.c); g.addColorStop(0.6, nb.c.replace(/[\d.]+\)$/, '0.08)'));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    // 旋涡星系(左侧):蓝色旋臂 + 亮核
    var gx = W * 0.15, gy = H * 0.35;
    for (var arm = 0; arm < 3; arm++) {
      var armAngle = (arm / 3) * Math.PI * 2;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(armAngle);
      var ag = ctx.createRadialGradient(0, 0, 5, 0, 0, 180);
      ag.addColorStop(0, 'rgba(80,140,255,0.35)');
      ag.addColorStop(0.5, 'rgba(60,100,200,0.15)');
      ag.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ag;
      ctx.beginPath();
      ctx.ellipse(60, 0, 140, 35, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 星系核心
    var gg = ctx.createRadialGradient(gx, gy, 0, gx, gy, 25);
    gg.addColorStop(0, 'rgba(200,220,255,0.9)');
    gg.addColorStop(0.5, 'rgba(100,150,255,0.4)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(gx, gy, 25, 0, Math.PI * 2); ctx.fill();

    // 行星(右上):暗色球体 + 大气光晕
    var px = W * 0.78, py = H * 0.18, pr = 55;
    var pg = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.1, px, py, pr);
    pg.addColorStop(0, '#2a3a5a'); pg.addColorStop(0.6, '#1a2a4a'); pg.addColorStop(1, '#0a1020');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    // 行星光环
    ctx.strokeStyle = 'rgba(100,140,200,0.3)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(px, py, pr * 1.6, pr * 0.3, 0.2, 0, Math.PI * 2); ctx.stroke();
    // 行星大气光晕
    ctx.globalCompositeOperation = 'lighter';
    var pglow = ctx.createRadialGradient(px, py, pr * 0.8, px, py, pr * 1.4);
    pglow.addColorStop(0, 'rgba(60,100,180,0)');
    pglow.addColorStop(0.7, 'rgba(60,100,180,0.15)');
    pglow.addColorStop(1, 'rgba(60,100,180,0)');
    ctx.fillStyle = pglow;
    ctx.beginPath(); ctx.arc(px, py, pr * 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // 小行星带(底部):散落岩石
    for (var ro = 0; ro < 12; ro++) {
      var rx = W * 0.1 + Math.random() * W * 0.8;
      var ry = H * 0.75 + Math.random() * H * 0.2;
      var rr = 3 + Math.random() * 8;
      ctx.fillStyle = 'rgba(40,35,50,' + (0.3 + Math.random() * 0.3) + ')';
      ctx.beginPath();
      ctx.arc(rx, ry, rr, 0, Math.PI * 2);
      ctx.fill();
    }

    // 能量边框(顶部/底部蓝色光带)
    var frameG = ctx.createLinearGradient(0, 0, 0, 40);
    frameG.addColorStop(0, 'rgba(40,100,200,0.4)');
    frameG.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = frameG;
    ctx.fillRect(0, 0, W, 40);

    var frameG2 = ctx.createLinearGradient(0, H - 40, 0, H);
    frameG2.addColorStop(0, 'rgba(0,0,0,0)');
    frameG2.addColorStop(1, 'rgba(40,100,200,0.4)');
    ctx.fillStyle = frameG2;
    ctx.fillRect(0, H - 40, W, 40);
  }

  var Render = {

    background: function (ctx, t) {
      ensureStars();
      if (!bgCanvas) buildBackground();
      var cfg = G.Config, W = cfg.WIDTH, H = cfg.HEIGHT;
      ctx.drawImage(bgCanvas, 0, 0);

      // 星点闪烁
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

    // —— 飞船(贴图渲染,按等级切换设定图)——
    //   优先使用玩家提供的设定图贴图(ship-lv1..ship-lv5),贴图缺失时退回程序化绘制。
    //   贴图自带引擎尾焰/装甲/发光核心,不再需要分模块绘制。
    ship: function (ctx, ship) {
      var lvl = ship.level || 1;
      var glowColor = ship.glow || '#5ad1ff';
      var r = ship.radius, flash = ship.hitFlash > 0;

      // 尝试加载贴图
      var tex = G.Assets && G.Assets.get('ship-lv' + lvl);
      if (tex) {
        // 贴图渲染:居中绘制,尺寸与碰撞半径匹配
        ctx.save();
        ctx.translate(ship.x, ship.y);
        ctx.rotate(ship.aimAngle + Math.PI / 2);
        // 贴图比例:根据等级调整大小(Lv1 较小,Lv5 较大)
        var texScale = [1.0, 1.1, 1.2, 1.35, 1.5][lvl - 1] || 1.0;
        var texSize = r * 2.2 * texScale;
        ctx.drawImage(tex, -texSize / 2, -texSize / 2, texSize, texSize);
        // 受击闪烁:叠加白色半透明
        if (flash) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.5;
          ctx.drawImage(tex, -texSize / 2, -texSize / 2, texSize, texSize);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.restore();
      } else {
        // 退回程序化绘制(贴图未加载时)
        this._shipFallback(ctx, ship);
      }
    },

    // 飞船程序化回退(贴图缺失时使用,保留原版渲染)
    _shipFallback: function (ctx, ship) {
      var lvl = ship.level || 1;
      var visScale = 1 + (lvl - 1) * 0.06;
      var glowColor = ship.glow || '#5ad1ff';
      var r = ship.radius, flash = ship.hitFlash > 0;
      var t = Math.max(1, Math.min(5, lvl));
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

    // 推进器(v0.8 雷电风):双/多引擎热焰 —— 外焰蓝 + 内焰白 + 热晕脉动,金属喷口环 + 散热栅格。
    //   喷口数随级 1→5;尾焰随级变长变粗。用发光精灵(lighter),不碰 shadowBlur。
    _shipEngine: function (ctx, r, t, flash) {
      var n = t;
      var fl = 0.7 + 0.3 * Math.sin(Date.now() / 55);
      var flameLen = r * (0.75 + t * 0.18) * fl;
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < n; i++) {
        var off = n === 1 ? 0 : (i - (n - 1) / 2) * (r * 0.34);
        drawGlow(ctx, '#2a6bff', off, r * 0.62 + flameLen * 0.5, r * (0.5 + t * 0.06), 0.5);  // 外热焰(蓝)
        drawGlow(ctx, '#6ab4ff', off, r * 0.62 + flameLen * 0.3, r * (0.34 + t * 0.04), 0.7); // 中焰
        drawGlow(ctx, '#eaf6ff', off, r * 0.62 + flameLen * 0.12, r * 0.2, 0.95);              // 内焰白核
      }
      ctx.globalCompositeOperation = 'source-over';
      // 金属喷口环(梯形渐变)+ 散热栅格 + 深色内膛
      for (var j = 0; j < n; j++) {
        var ox = n === 1 ? 0 : (j - (n - 1) / 2) * (r * 0.34);
        ctx.fillStyle = metalGrad(ctx, ox - r * 0.14, r * 0.5, ox + r * 0.14, r * 0.84, flash);
        ctx.beginPath(); ctx.moveTo(ox - r * 0.14, r * 0.5); ctx.lineTo(ox + r * 0.14, r * 0.5);
        ctx.lineTo(ox + r * 0.1, r * 0.82); ctx.lineTo(ox - r * 0.1, r * 0.82); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = flash ? '#fff' : '#8aa0c0'; ctx.lineWidth = 1; ctx.stroke();
        ctx.strokeStyle = flash ? '#fff' : 'rgba(15,22,34,0.7)'; ctx.lineWidth = 1;   // 散热栅格
        for (var gg = 0; gg < 3; gg++) { var gy = r * 0.56 + gg * r * 0.08; ctx.beginPath(); ctx.moveTo(ox - r * 0.12, gy); ctx.lineTo(ox + r * 0.12, gy); ctx.stroke(); }
        ctx.fillStyle = flash ? '#fff' : '#080c14';        // 喷口内膛(深,衬出热焰)
        ctx.beginPath(); ctx.ellipse(ox, r * 0.66, r * 0.075, r * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      }
    },

    // 机翼(v0.8 雷电风):后掠三角装甲翼 —— 面板接缝 + 铆钉点阵 + 翼尖灯 + 翼载武器荚(雷电签名)。
    //   窄→宽→分叉(L3+)→能量翼缘(L4+);面板用金属渐变 + 前缘高光描边,层次感强。
    _shipWings: function (ctx, r, t, glow, flash) {
      var spread = [0.6, 0.9, 1.15, 1.42, 1.68][t - 1] * r;
      var fork = t >= 3, energy = t >= 4;
      var drawSide = function (s) {
        ctx.fillStyle = metalGrad(ctx, s * r * 0.15, -r * 0.15, s * spread, r * 0.5, flash);
        ctx.beginPath();
        ctx.moveTo(s * r * 0.12, -r * 0.05);
        ctx.lineTo(s * spread, r * 0.18);                                   // 前缘后掠
        ctx.lineTo(s * spread * (fork ? 0.62 : 0.74), r * 0.5);             // 翼尖
        ctx.lineTo(s * r * 0.22, r * 0.4);
        ctx.closePath(); ctx.fill();
        ctx.lineWidth = 1.4; ctx.strokeStyle = flash ? '#fff' : lighten(glow, 0.25);  // 前缘高光
        ctx.beginPath(); ctx.moveTo(s * r * 0.12, -r * 0.05); ctx.lineTo(s * spread, r * 0.18); ctx.stroke();
        ctx.strokeStyle = flash ? '#fff' : 'rgba(12,20,32,0.6)'; ctx.lineWidth = 1;      // 面板接缝(前/后缘到翼根)
        ctx.beginPath(); ctx.moveTo(s * r * 0.24, r * 0.02); ctx.lineTo(s * spread * 0.8, r * 0.28); ctx.stroke();
        ctx.fillStyle = flash ? '#fff' : '#1a2230';                                     // 铆钉点阵
        for (var rv = 0; rv < 3; rv++) { ctx.beginPath(); ctx.arc(s * (r * 0.34 + rv * spread * 0.2), r * 0.16, 1.2, 0, Math.PI * 2); ctx.fill(); }
        if (t >= 3) {   // 翼尖灯(发光)
          ctx.globalCompositeOperation = 'lighter';
          drawGlow(ctx, glow, s * spread, r * 0.18, r * 0.16, 0.95);
          ctx.globalCompositeOperation = 'source-over';
        }
        if (energy) {   // 能量翼缘(L4+,柔光带)
          ctx.globalCompositeOperation = 'lighter';
          drawGlow(ctx, glow, s * spread * 0.72, r * 0.3, r * 0.44, 0.42);
          ctx.globalCompositeOperation = 'source-over';
        }
      };
      drawSide(1); drawSide(-1);
    },

    // 船体(v0.8 雷电风):尖锐鼻锥 + 中脊装甲脊 + 面板接缝/铆钉 + 进气槽 + 驾驶舱玻璃。
    //   梭形→装甲分体(L4+);鼻锥强化高光,中脊高光强调硬表面棱角。
    _shipHull: function (ctx, r, t, flash) {
      var split = t >= 4;
      var len = r * (1.2 + t * 0.05), wid = r * (0.32 + t * 0.045);
      ctx.fillStyle = metalGrad(ctx, -wid, 0, wid, 0, flash);   // 左右明暗(侧光)
      ctx.beginPath();
      ctx.moveTo(0, -len);
      ctx.quadraticCurveTo(wid, -r * 0.2, wid * 1.35, r * 0.5);
      ctx.lineTo(r * 0.2, r * 0.6); ctx.lineTo(-r * 0.2, r * 0.6);
      ctx.lineTo(-wid * 1.35, r * 0.5);
      ctx.quadraticCurveTo(-wid, -r * 0.2, 0, -len);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1.4; ctx.strokeStyle = flash ? '#fff' : '#9fb4d0'; ctx.stroke();
      ctx.strokeStyle = flash ? '#fff' : 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.3;   // 中脊装甲棱高光
      ctx.beginPath(); ctx.moveTo(0, -len * 0.95); ctx.lineTo(0, r * 0.55); ctx.stroke();
      if (t >= 2) {   // 横向装甲面板接缝 + 接缝铆钉(随级增多)
        ctx.strokeStyle = flash ? '#fff' : 'rgba(12,20,32,0.65)'; ctx.lineWidth = 1;
        for (var p = 0; p < t - 1; p++) {
          var py = -r * 0.3 + p * r * 0.24;
          ctx.beginPath(); ctx.moveTo(-wid, py); ctx.lineTo(wid, py); ctx.stroke();
          ctx.fillStyle = flash ? '#fff' : '#10182a';
          ctx.beginPath(); ctx.arc(-wid * 0.7, py, 1.3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(wid * 0.7, py, 1.3, 0, Math.PI * 2); ctx.fill();
        }
      }
      // 鼻锥(更尖更高光的尖端)
      var ng = ctx.createLinearGradient(0, -len, 0, -r * 0.2);
      if (flash) { ng.addColorStop(0, '#fff'); ng.addColorStop(1, '#fff'); }
      else { ng.addColorStop(0, '#eef4ff'); ng.addColorStop(1, '#5a6a7a'); }
      ctx.fillStyle = ng;
      ctx.beginPath(); ctx.moveTo(0, -len); ctx.quadraticCurveTo(wid * 0.55, -r * 0.5, 0, -r * 0.2);
      ctx.quadraticCurveTo(-wid * 0.55, -r * 0.5, 0, -len); ctx.closePath(); ctx.fill();
      if (t >= 3) {   // 侧面进气槽(暗)
        ctx.fillStyle = flash ? '#fff' : '#080c14';
        ctx.fillRect(wid * 0.92, -r * 0.05, r * 0.08, r * 0.26);
        ctx.fillRect(-wid * 0.92 - r * 0.08, -r * 0.05, r * 0.08, r * 0.26);
      }
      if (split) {   // 分体中线缝隙(L4+,深槽)
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(0, -len * 0.9); ctx.lineTo(0, r * 0.5); ctx.stroke();
      }
      // 驾驶舱玻璃(雷电式深蓝半透明罩,鼻锥下方,带顶部反射高光)
      if (!flash) {
        var cg = ctx.createLinearGradient(0, -r * 0.55, 0, -r * 0.1);
        cg.addColorStop(0, 'rgba(150,210,255,0.85)'); cg.addColorStop(0.5, 'rgba(40,90,150,0.9)'); cg.addColorStop(1, 'rgba(12,28,48,0.95)');
        ctx.fillStyle = cg;
      } else ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(0, -r * 0.55); ctx.quadraticCurveTo(wid * 0.7, -r * 0.35, wid * 0.4, -r * 0.1);
      ctx.lineTo(-wid * 0.4, -r * 0.1); ctx.quadraticCurveTo(-wid * 0.7, -r * 0.35, 0, -r * 0.55); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    },

    // 武器挂载(v0.8 雷电风):翼载武器荚 —— 金属炮管 + 炮口环 + 散热口 + 多联装底座;1→4 管。
    _shipWeapons: function (ctx, r, t, flash) {
      var n = Math.min(t, 4);
      for (var i = 0; i < n; i++) {
        var off = n === 1 ? 0 : (i - (n - 1) / 2) * r * 0.4;
        ctx.fillStyle = metalGrad(ctx, off - r * 0.07, 0, off + r * 0.07, 0, flash);  // 炮管侧高光
        ctx.fillRect(off - r * 0.06, -r * 1.3, r * 0.12, r * 0.44);
        ctx.fillStyle = flash ? '#fff' : '#080c14';        // 炮口环(深)
        ctx.fillRect(off - r * 0.06, -r * 1.32, r * 0.12, r * 0.06);
        ctx.fillStyle = flash ? '#fff' : 'rgba(15,22,34,0.75)';   // 散热口
        ctx.fillRect(off - r * 0.06, -r * 1.2, r * 0.12, r * 0.02);
        if (t >= 3) {   // 多联装副炮管
          ctx.fillStyle = metalGrad(ctx, off - r * 0.1, 0, off - r * 0.06, 0, flash);
          ctx.fillRect(off - r * 0.1, -r * 1.22, r * 0.04, r * 0.32);
          ctx.fillRect(off + r * 0.06, -r * 1.22, r * 0.04, r * 0.32);
        }
      }
      if (n >= 2) {   // 多联装底座(装甲块)
        ctx.fillStyle = metalGrad(ctx, 0, -r * 1.0, 0, -r * 0.85, flash);
        ctx.fillRect(-r * 0.48, -r * 0.96, r * 0.96, r * 0.13);
      }
    },

    // 能量核心(v0.8 雷电风):多层光晕 + 中心炽核 + 旋转能量环(L4+ 悬浮旋转)。
    //   驾驶舱下方核心,尺寸/亮度随级增强,Lv5 悬浮 + 双层旋转能量环。
    _shipCore: function (ctx, r, t, glow, flash) {
      var size = r * (0.17 + t * 0.028);
      var alpha = 0.48 + t * 0.12;
      var float = (t >= 5) ? Math.sin(Date.now() / 180) * r * 0.06 : 0;
      var pulse = 0.9 + 0.1 * Math.sin(Date.now() / 120);
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, glow, 0, float, size * 3.4 * pulse, alpha);        // 外光晕
      drawGlow(ctx, '#ffffff', 0, float, size * 1.5, 0.5);            // 内白晕
      var g = ctx.createRadialGradient(0, float, 0, 0, float, size);
      if (flash) { g.addColorStop(0, '#fff'); g.addColorStop(1, glow); }
      else { g.addColorStop(0, '#fff'); g.addColorStop(0.4, lighten(glow, 0.35)); g.addColorStop(1, glow); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, float, size * pulse, 0, Math.PI * 2); ctx.fill();
      if (t >= 4) {   // 能量环(L4+ 单环,L5 双层旋转)
        var spin = (t >= 5) ? Date.now() / 580 : 0;
        ctx.strokeStyle = hexToRgba(glow, 0.7); ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(0, float, size * 1.9, spin, spin + Math.PI * 1.4); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, float, size * 1.9, spin + Math.PI, spin + Math.PI * 2.4); ctx.stroke();
        if (t >= 5) {   // L5 外层反向旋转环
          var spin2 = -Date.now() / 740;
          ctx.strokeStyle = hexToRgba(lighten(glow, 0.3), 0.5); ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(0, float, size * 2.6, spin2, spin2 + Math.PI * 1.1); ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    },

    // —— 外星怪(程序化渲染,根据设定图风格重绘)——
    //   每种怪物按设定图的独特外观重写:红眼虫族 / 圆盘机械眼 / 紫甲蜘蛛 / 幽灵翼龙 / 精英机甲 / 巨构Boss / 虚空终Boss
    alien: function (ctx, a) {
      var def = a.def, r = def.radius, flash = a.hitFlash > 0;
      ctx.save();
      ctx.translate(a.x, a.y); ctx.rotate(a.angle);
      var wob = Math.sin(a.phase) * 0.5 + 0.5;

      // 外光晕
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, def.color, 0, 0, r * 2.2, 0.45);
      ctx.globalCompositeOperation = 'source-over';

      // 本体径向渐变
      var fill = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r * 1.05);
      if (flash) { fill.addColorStop(0, '#fff'); fill.addColorStop(1, '#fff'); }
      else { fill.addColorStop(0, lighten(def.color, 0.4)); fill.addColorStop(0.5, def.color); fill.addColorStop(1, darken(def.color, 0.65)); }
      ctx.fillStyle = fill;

      switch (a.type) {
        case 't1': this._alienT1(ctx, r, wob, flash); break;   // 红眼虫族
        case 't2': this._alienT2(ctx, r, wob, flash); break;   // 圆盘机械眼
        case 't3': this._alienT3(ctx, r, wob, flash); break;   // 紫甲蜘蛛
        case 't4': this._alienT4(ctx, r, wob, flash); break;   // 幽灵翼龙
        case 't5': this._alienT5(ctx, r, wob, flash); break;   // 精英机甲
        case 't6': this._alienT6(ctx, a, r, wob, flash); break; // 巨构Boss
        case 't7': this._alienT7(ctx, r, wob, flash); break;   // 撕裂者
        case 't8': this._alienT8(ctx, a, r, wob, flash); break; // 守卫者
        case 't9': this._alienT9(ctx, a, r, wob, flash); break; // 钢铁巨像
        case 't10': this._alienT10(ctx, a, r, wob, flash); break; // 虚空吞噬者
        default: this._alienT1(ctx, r, wob, flash); break;
      }

      // 发光弱点核心(非 Boss)
      if (!a.isBoss) {
        var wpulse = 0.85 + 0.15 * Math.sin(Date.now() / 120);
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, '#ff3333', 0, 0, r * 0.5 * wpulse, 0.7);
        ctx.globalCompositeOperation = 'source-over';
        var cg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.2 * wpulse);
        cg.addColorStop(0, '#fff'); cg.addColorStop(0.4, '#ff6666'); cg.addColorStop(1, '#ff0000');
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.2 * wpulse, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      this._alienStatus(ctx, a, r);
      if (a.hp < a.maxHp) this._hpBar(ctx, a.x, a.y - r - 10, r * 1.6, a.hp / a.maxHp, def.color);
    },

    // ① t1 红眼虫族:尖刺甲壳 + 双颚 + 红色复眼
    _alienT1: function (ctx, r, wob, flash) {
      // 身体:水滴形甲壳
      ctx.fillStyle = flash ? '#fff' : '#2a1520';
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.8, -r * 0.3, r * 0.5, r * 0.5);
      ctx.quadraticCurveTo(0, r * 0.9, -r * 0.5, r * 0.5);
      ctx.quadraticCurveTo(-r * 0.8, -r * 0.3, 0, -r);
      ctx.closePath(); ctx.fill();
      // 装甲纹路
      ctx.strokeStyle = flash ? '#fff' : '#4a2030';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, -r * 0.6); ctx.lineTo(-r * 0.4, r * 0.3);
      ctx.moveTo(r * 0.3, -r * 0.6); ctx.lineTo(r * 0.4, r * 0.3);
      ctx.stroke();
      // 双颚(底部)
      ctx.strokeStyle = flash ? '#fff' : '#8a2020';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, r * 0.6); ctx.lineTo(-r * 0.35 + wob * 3, r * 1.1);
      ctx.moveTo(r * 0.15, r * 0.6); ctx.lineTo(r * 0.35 - wob * 3, r * 1.1);
      ctx.stroke();
      // 红色复眼
      ctx.fillStyle = flash ? '#fff' : '#ff2222';
      ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.2, r * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.25, -r * 0.2, r * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.22, r * 0.06, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.25, -r * 0.22, r * 0.06, 0, Math.PI * 2); ctx.fill();
    },

    // ② t2 圆盘机械眼:金属圆环 + 中央红色大眼 + 尖刺
    _alienT2: function (ctx, r, wob, flash) {
      // 外环:金属质感
      var g = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r);
      if (flash) { g.addColorStop(0, '#fff'); g.addColorStop(1, '#fff'); }
      else { g.addColorStop(0, '#5a6a7a'); g.addColorStop(0.7, '#3a4a5a'); g.addColorStop(1, '#1a2a3a'); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2); ctx.fill();
      // 尖刺(环形分布)
      ctx.fillStyle = flash ? '#fff' : '#4a3a50';
      for (var i = 0; i < 8; i++) {
        var ang = (i / 8) * Math.PI * 2;
        var sx = Math.cos(ang) * r * 0.7, sy = Math.sin(ang) * r * 0.7;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(ang) * r * 0.5, sy + Math.sin(ang) * r * 0.5);
        ctx.lineTo(sx + Math.cos(ang + 0.4) * r * 0.15, sy + Math.sin(ang + 0.4) * r * 0.15);
        ctx.closePath(); ctx.fill();
      }
      // 中央大眼:红色虹膜 + 深色瞳孔
      ctx.fillStyle = flash ? '#fff' : '#cc2222';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = flash ? '#fff' : '#1a0a0a';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(r * 0.1, -r * 0.1, r * 0.1, 0, Math.PI * 2); ctx.fill();
    },

    // ③ t3 紫甲蜘蛛:多足 + 紫色装甲 + 机械关节
    _alienT3: function (ctx, r, wob, flash) {
      // 身体:椭圆甲壳
      ctx.fillStyle = flash ? '#fff' : '#2a1a3a';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.6, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      // 装甲纹路
      ctx.strokeStyle = flash ? '#fff' : '#5a3a7a';
      ctx.lineWidth = 1.5;
      for (var p = 0; p < 3; p++) {
        var py = -r * 0.4 + p * r * 0.35;
        ctx.beginPath(); ctx.moveTo(-r * 0.5, py); ctx.lineTo(r * 0.5, py); ctx.stroke();
      }
      // 六条腿(左右各三)
      ctx.strokeStyle = flash ? '#fff' : '#4a3a5a';
      ctx.lineWidth = 2.5;
      var legs = [[-0.6, 0.3], [-0.7, 0], [-0.5, -0.3], [0.6, 0.3], [0.7, 0], [0.5, -0.3]];
      for (var l = 0; l < legs.length; l++) {
        var lx = legs[l][0] * r, ly = legs[l][1] * r;
        var lsign = l < 3 ? -1 : 1;
        var footX = lx + lsign * r * 0.5 + wob * lsign * 3;
        var footY = ly + r * 0.4;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.quadraticCurveTo(lx + lsign * r * 0.3, ly + r * 0.2, footX, footY);
        ctx.stroke();
        // 关节球
        ctx.fillStyle = flash ? '#fff' : '#2a1a3a';
        ctx.beginPath(); ctx.arc(lx, ly, r * 0.08, 0, Math.PI * 2); ctx.fill();
      }
      // 紫色眼
      ctx.fillStyle = flash ? '#fff' : '#9966ff';
      ctx.beginPath(); ctx.arc(-r * 0.2, -r * 0.15, r * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.2, -r * 0.15, r * 0.12, 0, Math.PI * 2); ctx.fill();
    },

    // ④ t4 幽灵翼龙:半透明翼膜 + 紫白渐变 + 长翼展
    _alienT4: function (ctx, r, wob, flash) {
      ctx.globalAlpha = flash ? 1 : 0.85;
      // 身体:流线型
      ctx.fillStyle = flash ? '#fff' : '#4a2a6a';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.9);
      ctx.quadraticCurveTo(r * 0.3, -r * 0.3, r * 0.25, r * 0.5);
      ctx.quadraticCurveTo(0, r * 0.8, -r * 0.25, r * 0.5);
      ctx.quadraticCurveTo(-r * 0.3, -r * 0.3, 0, -r * 0.9);
      ctx.closePath(); ctx.fill();
      // 翼膜(大三角翼)
      ctx.fillStyle = flash ? '#fff' : 'rgba(100,60,160,0.7)';
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, -r * 0.2);
      ctx.lineTo(-r * 1.3, r * 0.3 + wob * 4);
      ctx.lineTo(-r * 0.3, r * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r * 0.15, -r * 0.2);
      ctx.lineTo(r * 1.3, r * 0.3 - wob * 4);
      ctx.lineTo(r * 0.3, r * 0.5);
      ctx.closePath(); ctx.fill();
      // 翼骨架
      ctx.strokeStyle = flash ? '#fff' : '#8a6aaa';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.1, -r * 0.1); ctx.lineTo(-r * 1.2, r * 0.35 + wob * 4);
      ctx.moveTo(r * 0.1, -r * 0.1); ctx.lineTo(r * 1.2, r * 0.35 - wob * 4);
      ctx.stroke();
      // 紫白发光核心
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '#aa88ff', 0, 0, r * 0.4, 0.6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    },

    // ⑤ t5 精英机甲:多层装甲 + 肩炮 + 橙色能量核心
    _alienT5: function (ctx, r, wob, flash) {
      // 八边形装甲主体
      ctx.fillStyle = flash ? '#fff' : '#2a2a3a';
      ctx.beginPath();
      var pts = [[0, -1], [0.7, -0.7], [1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7]];
      for (var i = 0; i < pts.length; i++) {
        i ? ctx.lineTo(pts[i][0] * r, pts[i][1] * r) : ctx.moveTo(pts[i][0] * r, pts[i][1] * r);
      }
      ctx.closePath(); ctx.fill();
      // 装甲分割
      ctx.strokeStyle = flash ? '#fff' : '#4a4a5a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, 0); ctx.lineTo(r * 0.6, 0);
      ctx.moveTo(0, -r * 0.6); ctx.lineTo(0, r * 0.6);
      ctx.stroke();
      // 肩炮
      ctx.fillStyle = flash ? '#fff' : '#3a3a4a';
      ctx.fillRect(-r * 1.1, -r * 0.6, r * 0.25, r * 0.5);
      ctx.fillRect(r * 0.85, -r * 0.6, r * 0.25, r * 0.5);
      ctx.fillStyle = flash ? '#fff' : '#1a1a2a';
      ctx.beginPath(); ctx.arc(-r * 0.98, -r * 0.6, r * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.98, -r * 0.6, r * 0.1, 0, Math.PI * 2); ctx.fill();
      // 橙色能量核心
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '#ff8a3d', 0, 0, r * 0.35, 0.7);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff6a2d';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2); ctx.fill();
    },

    // ⑥ t6 巨构Boss:分段装甲 + 多核心眼 + 顶刺
    _alienT6: function (ctx, a, r, wob, flash) {
      // 巨型装甲体
      ctx.fillStyle = flash ? '#fff' : '#1a1520';
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 1.2, -r * 0.2, r * 0.85, r);
      ctx.quadraticCurveTo(0, r * 1.2, -r * 0.85, r);
      ctx.quadraticCurveTo(-r * 1.2, -r * 0.2, 0, -r);
      ctx.closePath(); ctx.fill();
      // 装甲段分割
      ctx.strokeStyle = flash ? '#fff' : '#3a2a40';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.3); ctx.quadraticCurveTo(0, -r * 0.5, r * 0.7, -r * 0.3);
      ctx.moveTo(-r * 0.8, r * 0.3); ctx.quadraticCurveTo(0, r * 0.1, r * 0.8, r * 0.3);
      ctx.stroke();
      // 顶刺
      ctx.strokeStyle = flash ? '#fff' : '#5a3a50';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.85); ctx.lineTo(-r * 0.7, -r * 1.3);
      ctx.moveTo(r * 0.4, -r * 0.85); ctx.lineTo(r * 0.7, -r * 1.3);
      ctx.stroke();
      // 多核心红色眼
      var eyes = [[-r * 0.35, -r * 0.1], [r * 0.35, -r * 0.1], [0, r * 0.3]];
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < eyes.length; i++) drawGlow(ctx, '#ff3333', eyes[i][0], eyes[i][1], r * 0.18, 0.8);
      ctx.globalCompositeOperation = 'source-over';
      for (var j = 0; j < eyes.length; j++) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(eyes[j][0], eyes[j][1], r * 0.12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff2222';
        ctx.beginPath(); ctx.arc(eyes[j][0], eyes[j][1], r * 0.06, 0, Math.PI * 2); ctx.fill();
      }
    },

    // ⑦ t7 撕裂者:流线刀型 + 蓄能核心
    _alienT7: function (ctx, r, wob, flash) {
      ctx.fillStyle = flash ? '#fff' : '#2a1a25';
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.05);
      ctx.quadraticCurveTo(r * 0.65, -r * 0.1, r * 0.45, r * 0.7);
      ctx.quadraticCurveTo(0, r * 0.95, -r * 0.45, r * 0.7);
      ctx.quadraticCurveTo(-r * 0.65, -r * 0.1, 0, -r * 1.05);
      ctx.closePath(); ctx.fill();
      // 中线脊
      ctx.strokeStyle = flash ? '#fff' : '#4a2a40';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(0, r * 0.7); ctx.stroke();
      // 侧刀刃
      ctx.strokeStyle = flash ? '#fff' : '#6a3a5a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, r * 0.1); ctx.lineTo(-r * 1.1, r * 0.5);
      ctx.moveTo(r * 0.5, r * 0.1); ctx.lineTo(r * 1.1, r * 0.5);
      ctx.stroke();
      // 核心
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, r * 0.2, r * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff4d6d';
      ctx.beginPath(); ctx.arc(0, r * 0.2, r * 0.05, 0, Math.PI * 2); ctx.fill();
    },

    // ⑧ t8 守卫者:六边形炮塔 + 旋转主炮
    _alienT8: function (ctx, a, r, wob, flash) {
      ctx.fillStyle = flash ? '#fff' : '#2a2530';
      ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        var an = (i / 6) * Math.PI * 2 - Math.PI / 2;
        var x = Math.cos(an) * r * 0.82, y = Math.sin(an) * r * 0.82;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      // 装甲分割
      ctx.strokeStyle = flash ? '#fff' : '#4a3a50';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var k = 0; k < 6; k++) { var ka = (k / 6) * Math.PI * 2 - Math.PI / 2; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ka) * r * 0.6, Math.sin(ka) * r * 0.6); }
      ctx.stroke();
      // 旋转主炮
      var aim = a._aimAngle != null ? a._aimAngle : Math.PI / 2;
      ctx.save(); ctx.rotate(aim - Math.PI / 2);
      ctx.fillStyle = flash ? '#fff' : '#3a3a4a';
      ctx.fillRect(-r * 0.1, 0, r * 0.2, r * 0.95);
      ctx.fillStyle = flash ? '#fff' : '#1a1a2a';
      ctx.fillRect(-r * 0.1, r * 0.85, r * 0.2, r * 0.1);
      ctx.restore();
    },

    // ⑨ t9 钢铁巨像(中 Boss):装甲堡垒 + 环形炮荚
    _alienT9: function (ctx, a, r, wob, flash) {
      var stage = a.bossStage || 1;
      ctx.fillStyle = flash ? '#fff' : '#1a2030';
      ctx.beginPath();
      var pts = [[0, -1], [0.7, -0.7], [1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7]];
      for (var i = 0; i < pts.length; i++) { i ? ctx.lineTo(pts[i][0] * r * 0.9, pts[i][1] * r * 0.9) : ctx.moveTo(pts[i][0] * r * 0.9, pts[i][1] * r * 0.9); }
      ctx.closePath(); ctx.fill();
      // 环形炮荚
      var pods = stage === 1 ? 4 : (stage === 2 ? 6 : 8);
      var spin = (Date.now() / 1400) * (stage >= 2 ? 1.4 : 1);
      for (var p = 0; p < pods; p++) {
        var pa = spin + p / pods * Math.PI * 2;
        var px = Math.cos(pa) * r * 0.78, py = Math.sin(pa) * r * 0.78;
        ctx.fillStyle = flash ? '#fff' : '#3a4a5a';
        ctx.beginPath(); ctx.arc(px, py, r * 0.12, 0, Math.PI * 2); ctx.fill();
      }
      // 核心
      var coreCol = stage === 1 ? '#9fb4c8' : (stage === 2 ? '#ff8c42' : '#ff4d6d');
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, coreCol, 0, 0, r * 0.4, 0.5 + stage * 0.1);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = coreCol;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.06, 0, Math.PI * 2); ctx.fill();
    },

    // ⑩ t10 虚空吞噬者(终 Boss):有机机械体 + 触须 + 多核心
    _alienT10: function (ctx, a, r, wob, flash) {
      var stage = a.bossStage || 1;
      // 波浪主体
      ctx.fillStyle = flash ? '#fff' : '#1a1025';
      ctx.beginPath();
      var segs = 12;
      for (var i = 0; i <= segs; i++) {
        var ang = (i / segs) * Math.PI * 2;
        var rr = r * (0.82 + 0.18 * Math.sin(ang * 3 + wob * 3));
        var x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      // 触须
      var tentN = stage === 1 ? 4 : (stage === 2 ? 6 : 8);
      ctx.strokeStyle = flash ? '#fff' : 'rgba(120,60,200,0.6)';
      ctx.lineWidth = 3;
      for (var t = 0; t < tentN; t++) {
        var ta = t / tentN * Math.PI * 2 + (Date.now() / 2600) % (Math.PI * 2);
        var ex = Math.cos(ta) * r * 1.35, ey = Math.sin(ta) * r * 1.35;
        ctx.beginPath(); ctx.moveTo(Math.cos(ta) * r * 0.7, Math.sin(ta) * r * 0.7);
        ctx.quadraticCurveTo(Math.cos(ta) * r * 1.0, Math.sin(ta) * r * 1.0, ex, ey);
        ctx.stroke();
      }
      // 多核心眼
      var eyeN = stage === 1 ? 3 : (stage === 2 ? 5 : 7);
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '#b14dff', 0, 0, r * 0.5, 0.5 + stage * 0.1);
      for (var e = 0; e < eyeN; e++) {
        var ea = e / eyeN * Math.PI * 2 - Math.PI / 2;
        drawGlow(ctx, '#ff3333', Math.cos(ea) * r * 0.4, Math.sin(ea) * r * 0.4, r * 0.16, 0.8);
      }
      ctx.globalCompositeOperation = 'source-over';
      for (var ey2 = 0; ey2 < eyeN; ey2++) {
        var eay = ey2 / eyeN * Math.PI * 2 - Math.PI / 2;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(Math.cos(eay) * r * 0.4, Math.sin(eay) * r * 0.4, r * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff3333';
        ctx.beginPath(); ctx.arc(Math.cos(eay) * r * 0.4, Math.sin(eay) * r * 0.4, r * 0.05, 0, Math.PI * 2); ctx.fill();
      }
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

    // ① 装甲爬虫(v0.7):水滴装甲体 + 尖刺腿 + 上颚 + 腹部装甲横纹/铆钉/腿关节
    _alienCrawler: function (ctx, r, wob) {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.9, -r * 0.2, r * 0.6, r * 0.7);
      ctx.quadraticCurveTo(0, r * 1.05, -r * 0.6, r * 0.7);
      ctx.quadraticCurveTo(-r * 0.9, -r * 0.2, 0, -r);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 腹部装甲横纹 + 铆钉
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(20,28,40,0.55)';
      for (var s = 0; s < 3; s++) { var sy = -r * 0.4 + s * r * 0.35; ctx.beginPath(); ctx.moveTo(-r * 0.5, sy); ctx.lineTo(r * 0.5, sy); ctx.stroke(); }
      ctx.fillStyle = 'rgba(20,28,40,0.7)';
      ctx.beginPath(); ctx.arc(0, r * 0.2, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2;   // 三条尖刺腿
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, r * 0.4); ctx.lineTo(-r * 1.0, r * 0.9 + wob * 5);
      ctx.moveTo(0, r * 0.55); ctx.lineTo(0, r * 1.2 + wob * 5);
      ctx.moveTo(r * 0.5, r * 0.4); ctx.lineTo(r * 1.0, r * 0.9 + wob * 5);
      ctx.stroke();
      ctx.fillStyle = '#1a2230';   // 腿关节球
      ctx.beginPath(); ctx.arc(-r * 1.0, r * 0.9 + wob * 5, r * 0.08, 0, Math.PI * 2);
      ctx.arc(0, r * 1.2 + wob * 5, r * 0.08, 0, Math.PI * 2);
      ctx.arc(r * 1.0, r * 0.9 + wob * 5, r * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();   // 上颚
      ctx.moveTo(-r * 0.2, -r * 0.85); ctx.lineTo(-r * 0.08, -r * 1.2);
      ctx.moveTo(r * 0.2, -r * 0.85); ctx.lineTo(r * 0.08, -r * 1.2);
      ctx.stroke();
    },
    // ② 拦截机(v0.7):后掠三角翼 + 翼面装甲线/铆钉 + 双引擎喷口环(中距射击型)
    _alienDrone: function (ctx, r, wob) {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.9);
      ctx.lineTo(r * 1.1, r * 0.6); ctx.lineTo(r * 0.5, r * 0.4);
      ctx.lineTo(0, r * 0.8); ctx.lineTo(-r * 0.5, r * 0.4); ctx.lineTo(-r * 1.1, r * 0.6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 翼面装甲线 + 铆钉
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(20,28,40,0.5)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.5); ctx.lineTo(r * 0.8, r * 0.3); ctx.moveTo(0, -r * 0.5); ctx.lineTo(-r * 0.8, r * 0.3);
      ctx.stroke();
      ctx.fillStyle = '#1a2230';
      ctx.beginPath(); ctx.arc(r * 0.5, r * 0.2, 1.2, 0, Math.PI * 2); ctx.arc(-r * 0.5, r * 0.2, 1.2, 0, Math.PI * 2); ctx.fill();
      // 双引擎喷口(发光 + 金属环 + 深色炮口)
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '#cfe8ff', -r * 0.7, r * 0.5, r * 0.3, 0.7);
      drawGlow(ctx, '#cfe8ff', r * 0.7, r * 0.5, r * 0.3, 0.7);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#0a1018';
      ctx.beginPath(); ctx.arc(-r * 0.7, r * 0.5, r * 0.1, 0, Math.PI * 2); ctx.arc(r * 0.7, r * 0.5, r * 0.1, 0, Math.PI * 2); ctx.fill();
    },
    // ③ 装甲巨兽(v0.7):六边形装甲体 + 内分割/铆钉 + 钳臂关节(高防肉盾)
    _alienBrute: function (ctx, r, wob) {
      ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        var a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        var x = Math.cos(a) * r * 0.85, y = Math.sin(a) * r * 0.85;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 内装甲分割(中心向六顶点) + 铆钉
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(20,28,40,0.5)';
      ctx.beginPath();
      for (var k = 0; k < 6; k++) { var ka = (k / 6) * Math.PI * 2 - Math.PI / 2; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ka) * r * 0.6, Math.sin(ka) * r * 0.6); }
      ctx.stroke();
      ctx.fillStyle = '#1a2230';
      for (var rv = 0; rv < 6; rv++) { var ra = (rv / 6) * Math.PI * 2 - Math.PI / 2; ctx.beginPath(); ctx.arc(Math.cos(ra) * r * 0.55, Math.sin(ra) * r * 0.55, 1.3, 0, Math.PI * 2); ctx.fill(); }
      ctx.lineWidth = 4;   // 双钳臂
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, r * 0.3); ctx.quadraticCurveTo(-r * 1.4, r * 0.1, -r * 1.5, -r * 0.4 + wob * 6);
      ctx.moveTo(r * 0.8, r * 0.3); ctx.quadraticCurveTo(r * 1.4, r * 0.1, r * 1.5, -r * 0.4 + wob * 6);
      ctx.stroke();
      ctx.fillStyle = '#1a2230';   // 钳臂关节球
      ctx.beginPath(); ctx.arc(-r * 1.5, -r * 0.4 + wob * 6, r * 0.16, 0, Math.PI * 2);
      ctx.arc(r * 1.5, -r * 0.4 + wob * 6, r * 0.16, 0, Math.PI * 2); ctx.fill();
    },
    // ④ 相位幽影(v0.7):半透明波浪生物机械体 + 内能量纹 + 触须发光端(闪避型)
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
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.35)';   // 内能量纹路(螺旋感)
      ctx.beginPath();
      for (var s = 0; s < 3; s++) { ctx.moveTo(-r * 0.4, -r * 0.3 + s * r * 0.3); ctx.quadraticCurveTo(0, -r * 0.15 + s * r * 0.3, r * 0.4, -r * 0.3 + s * r * 0.3); }
      ctx.stroke();
      ctx.globalAlpha = 0.5;   // 触须
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, r * 0.6); ctx.quadraticCurveTo(-r * 0.8, r * 1.0, -r * 0.6 + wob * 4, r * 1.4);
      ctx.moveTo(r * 0.4, r * 0.6); ctx.quadraticCurveTo(r * 0.8, r * 1.0, r * 0.6 - wob * 4, r * 1.4);
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';   // 触须发光端
      drawGlow(ctx, '#c77dff', -r * 0.6 + wob * 4, r * 1.4, r * 0.12, 0.7);
      drawGlow(ctx, '#c77dff', r * 0.6 - wob * 4, r * 1.4, r * 0.12, 0.7);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    },
    // ⑤ 精英装甲(v0.7):八边形机械体 + 肩炮炮口环 + 装甲分割/铆钉 + 推进口(暴露弱点核)
    _alienElite: function (ctx, r, wob) {
      ctx.beginPath();
      var pts = [[0, -1], [0.6, -0.7], [1, -0.1], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, -0.1], [-0.6, -0.7]];
      for (var i = 0; i < pts.length; i++) {
        i ? ctx.lineTo(pts[i][0] * r, pts[i][1] * r) : ctx.moveTo(pts[i][0] * r, pts[i][1] * r);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 装甲分割线(十字) + 铆钉
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(20,28,40,0.6)';
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.3); ctx.lineTo(r * 0.5, -r * 0.3);
      ctx.moveTo(0, -r * 0.6); ctx.lineTo(0, r * 0.6);
      ctx.stroke();
      ctx.fillStyle = '#1a2230';
      ctx.beginPath(); ctx.arc(-r * 0.35, r * 0.4, 1.3, 0, Math.PI * 2); ctx.arc(r * 0.35, r * 0.4, 1.3, 0, Math.PI * 2); ctx.fill();
      // 肩炮(炮管 + 炮口环 + 深色炮口)
      ctx.lineWidth = 3; ctx.strokeStyle = '#5a6a7a';
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.4); ctx.lineTo(-r * 1.2, -r * 0.8);
      ctx.moveTo(r * 0.7, -r * 0.4); ctx.lineTo(r * 1.2, -r * 0.8);
      ctx.stroke();
      ctx.fillStyle = '#0a1018';
      ctx.beginPath(); ctx.arc(-r * 1.2, -r * 0.8, r * 0.13, 0, Math.PI * 2); ctx.arc(r * 1.2, -r * 0.8, r * 0.13, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5a6a7a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(-r * 1.2, -r * 0.8, r * 0.18, 0, Math.PI * 2); ctx.arc(r * 1.2, -r * 0.8, r * 0.18, 0, Math.PI * 2); ctx.stroke();
      // 推进口(底部光)
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '#ff8a3d', 0, r * 0.9, r * 0.16, 0.6);
      ctx.globalCompositeOperation = 'source-over';
    },
    // ⑥ 巨构 Boss(v0.7):分段装甲团块 + 多核心发光眼 + 尖刺 + 装甲缝/铆钉(可破坏感)
    _alienBoss: function (ctx, r, wob) {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 1.3, -r * 0.2, r * 0.9, r);
      ctx.quadraticCurveTo(0, r * 1.25, -r * 0.9, r);
      ctx.quadraticCurveTo(-r * 1.3, -r * 0.2, 0, -r);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 装甲段分割(多层,可破坏感)
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(20,28,40,0.6)';
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.3); ctx.quadraticCurveTo(0, -r * 0.5, r * 0.7, -r * 0.3);
      ctx.moveTo(-r * 0.9, r * 0.3); ctx.quadraticCurveTo(0, r * 0.1, r * 0.9, r * 0.3);
      ctx.moveTo(-r * 0.5, r * 0.65); ctx.quadraticCurveTo(0, r * 0.5, r * 0.5, r * 0.65);
      ctx.stroke();
      // 铆钉点阵(环形)
      ctx.fillStyle = '#1a2230';
      for (var rv = 0; rv < 6; rv++) { var ra = rv / 6 * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(ra) * r * 0.6, Math.sin(ra) * r * 0.6, 1.6, 0, Math.PI * 2); ctx.fill(); }
      // 顶刺(带底座)
      ctx.lineWidth = 3; ctx.strokeStyle = '#5a3a4a';
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.8); ctx.lineTo(-r * 0.8, -r * 1.3);
      ctx.moveTo(r * 0.5, -r * 0.8); ctx.lineTo(r * 0.8, -r * 1.3);
      ctx.stroke();
      ctx.fillStyle = '#3a2a35';   // 尖刺底座
      ctx.beginPath(); ctx.arc(-r * 0.5, -r * 0.8, r * 0.08, 0, Math.PI * 2); ctx.arc(r * 0.5, -r * 0.8, r * 0.08, 0, Math.PI * 2); ctx.fill();
      // 多核心发光眼
      var eyes = [[-r * 0.4, -r * 0.1], [r * 0.4, -r * 0.1], [0, r * 0.35]];
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < eyes.length; i++) drawGlow(ctx, '#ff3d6e', eyes[i][0], eyes[i][1], r * 0.18, 0.8);
      ctx.globalCompositeOperation = 'source-over';
      for (var j = 0; j < eyes.length; j++) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(eyes[j][0], eyes[j][1], r * 0.12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff3d6e';
        ctx.beginPath(); ctx.arc(eyes[j][0], eyes[j][1], r * 0.06, 0, Math.PI * 2); ctx.fill();
      }
    },

    // ===== v0.8 新内容(雷电风·新精英/Boss;均带发光弱点核心)=====
    // 注:取 alien 实体 a(非仅 wob),因需读 _dashTele/_aimArmed/bossStage 做预警/阶段渲染。

    // t7 撕裂者:流线刀型 + 颈部蓄能光(预警 _dashTele>0 时鼻锥充能高亮;突进时鼻锥爆光)
    _alienRipper: function (ctx, a, r, wob) {
      var tele = a._dashTele > 0, dashing = a._dashDur > 0;
      // 流线刀刃主体(前尖后窄)
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.05);
      ctx.quadraticCurveTo(r * 0.7, -r * 0.1, r * 0.5, r * 0.7);
      ctx.quadraticCurveTo(0, r * 0.95, -r * 0.5, r * 0.7);
      ctx.quadraticCurveTo(-r * 0.7, -r * 0.1, 0, -r * 1.05);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 中线脊 + 装甲板
      ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(15,22,34,0.65)';
      ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(0, r * 0.7); ctx.stroke();
      for (var p = 0; p < 2; p++) { var py = -r * 0.3 + p * r * 0.4; ctx.beginPath(); ctx.moveTo(-r * 0.4, py); ctx.lineTo(r * 0.4, py); ctx.stroke(); }
      // 侧刀刃翼(锋利前缘)
      ctx.lineWidth = 2.4; ctx.strokeStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, r * 0.1); ctx.lineTo(-r * 1.15, r * 0.5);
      ctx.moveTo(r * 0.5, r * 0.1); ctx.lineTo(r * 1.15, r * 0.5);
      ctx.stroke();
      // 颈部蓄能核心 + 鼻锥预警充能
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '#ff4d6d', 0, r * 0.2, r * 0.22, 0.8);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, r * 0.2, r * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(0, r * 0.2, r * 0.05, 0, Math.PI * 2); ctx.fill();
      if (tele) {   // 预警:鼻锥充能高亮(玩家可读)
        var cg = 0.5 + 0.5 * Math.sin(Date.now() / 40);
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, '#fff', 0, -r * 0.7, r * 0.3 * (0.6 + cg * 0.6), 0.6 + cg * 0.3);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (dashing) {   // 突进:鼻锥爆光残影
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, '#ff4d6d', 0, -r * 0.6, r * 0.4, 0.9);
        ctx.globalCompositeOperation = 'source-over';
      }
    },

    // t8 守卫者:六边形护盾炮塔 + 旋转主炮(_aimArmed 时炮口预警充能光)
    _alienGuardian: function (ctx, a, r, wob) {
      var armed = a._aimArmed;
      // 六边形装甲主体
      ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        var an = (i / 6) * Math.PI * 2 - Math.PI / 2;
        var x = Math.cos(an) * r * 0.82, y = Math.sin(an) * r * 0.82;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 装甲分割(中心向六顶点)+ 铆钉
      ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(15,22,34,0.6)';
      ctx.beginPath();
      for (var k = 0; k < 6; k++) { var ka = (k / 6) * Math.PI * 2 - Math.PI / 2; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ka) * r * 0.6, Math.sin(ka) * r * 0.6); }
      ctx.stroke();
      ctx.fillStyle = '#1a2230';
      for (var rv = 0; rv < 6; rv++) { var ra = (rv / 6) * Math.PI * 2 - Math.PI / 2; ctx.beginPath(); ctx.arc(Math.cos(ra) * r * 0.55, Math.sin(ra) * r * 0.55, 1.3, 0, Math.PI * 2); ctx.fill(); }
      // 旋转主炮(朝锁定方向 a._aimAngle;默认朝下)
      var aim = a._aimAngle != null ? a._aimAngle : Math.PI / 2;
      var spin = (Date.now() / 900) % (Math.PI * 2);
      ctx.save(); ctx.rotate(spin);
      ctx.fillStyle = '#3a4a5a';
      ctx.fillRect(-r * 0.12, -r * 0.5, r * 0.24, r * 0.5);   // 炮塔基座(旋转装饰环)
      ctx.restore();
      ctx.save(); ctx.rotate(aim - Math.PI / 2);               // 主炮管朝发射方向
      ctx.fillStyle = '#2a3340';
      ctx.fillRect(-r * 0.1, 0, r * 0.2, r * 0.95);
      ctx.fillStyle = '#080c14'; ctx.fillRect(-r * 0.1, r * 0.85, r * 0.2, r * 0.1);  // 炮口环
      if (armed) {   // 预警充能:炮口蓄能光(脉冲)
        var cg = 0.5 + 0.5 * Math.sin(Date.now() / 40);
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, '#ff8c42', 0, r * 0.95, r * 0.28 * (0.6 + cg * 0.6), 0.7 + cg * 0.3);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    },

    // t9 钢铁巨像(中 Boss):装甲堡垒 + 环形多炮荚 + 旋转核心 + 按 bossStage 强化(无弱点单核,走多核心)
    _alienColossus: function (ctx, a, r, wob) {
      var stage = a.bossStage || 1;
      // 主体:厚重八边形堡垒
      ctx.beginPath();
      var pts = [[0, -1], [0.7, -0.7], [1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7]];
      for (var i = 0; i < pts.length; i++) { i ? ctx.lineTo(pts[i][0] * r * 0.9, pts[i][1] * r * 0.9) : ctx.moveTo(pts[i][0] * r * 0.9, pts[i][1] * r * 0.9); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 装甲板分割(十字 + 环)+ 铆钉
      ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(15,22,34,0.6)';
      ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(r * 0.8, 0); ctx.moveTo(0, -r * 0.8); ctx.lineTo(0, r * 0.8); ctx.stroke();
      ctx.strokeStyle = 'rgba(15,22,34,0.45)';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#10182a';
      for (var rv = 0; rv < 8; rv++) { var ra = rv / 8 * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(ra) * r * 0.65, Math.sin(ra) * r * 0.65, 1.5, 0, Math.PI * 2); ctx.fill(); }
      // 环形炮荚(随阶段增多:stage1=4, stage2=6, stage3=8)
      var pods = stage === 1 ? 4 : (stage === 2 ? 6 : 8);
      var spin = (Date.now() / 1400) * (stage >= 2 ? 1.4 : 1);
      for (var p = 0; p < pods; p++) {
        var pa = spin + p / pods * Math.PI * 2;
        var px = Math.cos(pa) * r * 0.78, py = Math.sin(pa) * r * 0.78;
        ctx.fillStyle = '#3a4a5a';
        ctx.beginPath(); ctx.arc(px, py, r * 0.12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#080c14'; ctx.beginPath(); ctx.arc(px, py, r * 0.05, 0, Math.PI * 2); ctx.fill();  // 炮口
      }
      // 旋转核心(多核心发光眼,按阶段增亮)
      var coreN = stage === 1 ? 1 : (stage === 2 ? 3 : 5);
      ctx.globalCompositeOperation = 'lighter';
      var coreCol = stage === 1 ? '#9fb4c8' : (stage === 2 ? '#ff8c42' : '#ff4d6d');
      drawGlow(ctx, coreCol, 0, 0, r * 0.45, 0.5 + stage * 0.12);
      ctx.globalCompositeOperation = 'source-over';
      for (var c = 0; c < coreN; c++) {
        var ca = c / coreN * Math.PI * 2 - Math.PI / 2;
        var cx = coreN === 1 ? 0 : Math.cos(ca) * r * 0.25, cy = coreN === 1 ? 0 : Math.sin(ca) * r * 0.25;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = coreCol; ctx.beginPath(); ctx.arc(cx, cy, r * 0.05, 0, Math.PI * 2); ctx.fill();
      }
    },

    // t10 虚空吞噬者(终 Boss):有机机械体 + 脉动虚空核 + 触须武器阵 + 多核心发光眼
    _alienVoid: function (ctx, a, r, wob) {
      var stage = a.bossStage || 1;
      // 主体:波浪生物机械团块(有机感)
      ctx.beginPath();
      var segs = 12;
      for (var i = 0; i <= segs; i++) {
        var ang = (i / segs) * Math.PI * 2;
        var rr = r * (0.82 + 0.18 * Math.sin(ang * 3 + wob * 3));
        var x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 装甲段分割(多层曲线,可破坏感)
      ctx.lineWidth = 1.8; ctx.strokeStyle = 'rgba(15,22,34,0.55)';
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, -r * 0.35); ctx.quadraticCurveTo(0, -r * 0.55, r * 0.75, -r * 0.35);
      ctx.moveTo(-r * 0.9, r * 0.3); ctx.quadraticCurveTo(0, r * 0.1, r * 0.9, r * 0.3);
      ctx.stroke();
      // 触须武器阵(随阶段增多:stage1=4, stage2=6, stage3=8),带发光端
      var tentN = stage === 1 ? 4 : (stage === 2 ? 6 : 8);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(177,77,255,0.6)';
      for (var t = 0; t < tentN; t++) {
        var ta = t / tentN * Math.PI * 2 + (Date.now() / 2600) % (Math.PI * 2);
        var ex = Math.cos(ta) * r * 1.35, ey = Math.sin(ta) * r * 1.35;
        ctx.beginPath(); ctx.moveTo(Math.cos(ta) * r * 0.7, Math.sin(ta) * r * 0.7);
        ctx.quadraticCurveTo(Math.cos(ta) * r * 1.0, Math.sin(ta) * r * 1.0, ex, ey);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
      for (var te = 0; te < tentN; te++) {
        var tta = te / tentN * Math.PI * 2 + (Date.now() / 2600) % (Math.PI * 2);
        drawGlow(ctx, '#b14dff', Math.cos(tta) * r * 1.35, Math.sin(tta) * r * 1.35, r * 0.16, 0.8);
      }
      ctx.globalCompositeOperation = 'source-over';
      // 脉动虚空核心 + 多核心眼(按阶段增亮增多)
      var pulse = 0.9 + 0.1 * Math.sin(Date.now() / 110);
      var eyeN = stage === 1 ? 3 : (stage === 2 ? 5 : 7);
      var eyes = [];
      for (var e = 0; e < eyeN; e++) { var ea = e / eyeN * Math.PI * 2 - Math.PI / 2; eyes.push([Math.cos(ea) * r * 0.4, Math.sin(ea) * r * 0.4]); }
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '#b14dff', 0, 0, r * 0.55 * pulse, 0.55 + stage * 0.12);
      for (var ee = 0; ee < eyes.length; ee++) drawGlow(ctx, '#ff3d6e', eyes[ee][0], eyes[ee][1], r * 0.16, 0.85);
      ctx.globalCompositeOperation = 'source-over';
      for (var ey2 = 0; ey2 < eyes.length; ey2++) {
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(eyes[ey2][0], eyes[ey2][1], r * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff3d6e'; ctx.beginPath(); ctx.arc(eyes[ey2][0], eyes[ey2][1], r * 0.05, 0, Math.PI * 2); ctx.fill();
      }
    },

    // —— 敌弹(程序化渲染,根据设定图风格)——
    //   红色菱形弹(虫族) / 紫色尖刺弹(机械) / 橙色火焰弹(精英) / 青色能量弹(Boss)
    enemyBullet: function (ctx, b) {
      ctx.save();
      if (b.trail.length > 1) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = b.color; ctx.lineWidth = b.radius * 1.4; ctx.lineCap = 'round';
        ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.moveTo(b.trail[0].x, b.trail[0].y);
        for (var i = 1; i < b.trail.length; i++) ctx.lineTo(b.trail[i].x, b.trail[i].y);
        ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, b.color, b.x, b.y, b.radius * 3);
      ctx.globalCompositeOperation = 'source-over';
      // 菱形弹体
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y - b.radius * 1.8);
      ctx.lineTo(b.x + b.radius * 0.8, b.y);
      ctx.lineTo(b.x, b.y + b.radius * 1.8);
      ctx.lineTo(b.x - b.radius * 0.8, b.y);
      ctx.closePath(); ctx.fill();
      // 白色内核
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.radius * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
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

    // —— 子弹:贴图渲染(按武器等级切换弹道设定图)——
    //   优先使用玩家提供的弹道贴图(bullet-lv1..bullet-lv5),贴图缺失时退回程序化绘制。
    //   技能特效(冰冻/火焰/闪电/激光)仍以程序化叠加在贴图之上。
    bullet: function (ctx, b) {
      var fx = b.skill && b.skill.fx;
      // 尝试加载弹道贴图(按武器等级)
      var weaponLv = b.weaponLevel || 1;
      var tex = G.Assets && G.Assets.get('bullet-lv' + weaponLv);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // 拖尾效果(保留)
      if (b.trail.length > 1) {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.radius * (fx === 'laser' ? 3.0 : 1.4);
        ctx.lineCap = 'round';
        ctx.globalAlpha = fx === 'fire' ? 0.4 : (fx === 'laser' ? 0.5 : 0.28);
        ctx.beginPath();
        ctx.moveTo(b.trail[0].x, b.trail[0].y);
        if (fx === 'bolt') {
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

      // 绘制弹道
      if (tex) {
        // 贴图渲染:从精灵图中取对应弹道(贴图竖向排列3个弹道)
        var texSize = b.radius * 6;
        var srcRow = Math.min(b.spreadCount || 0, 2); // 0,1,2 对应3行
        var srcH = tex.height / 3;
        ctx.drawImage(tex,
          0, srcRow * srcH, tex.width, srcH,  // 源区域
          b.x - texSize / 2, b.y - texSize / 2, texSize, texSize  // 目标区域
        );
      } else {
        // 退回程序化绘制
        drawGlow(ctx, b.color, b.x, b.y, b.radius * (fx ? 3.4 : 3));
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.radius * 0.55, 0, Math.PI * 2); ctx.fill();
      }

      // 技能特效叠加(冰冻/火焰/闪电)
      if (fx === 'ice') {
        ctx.strokeStyle = 'rgba(127,224,255,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.radius * 2.5, 0, Math.PI * 2); ctx.stroke();
      } else if (fx === 'fire') {
        drawGlow(ctx, '#ff7a3d', b.x, b.y, b.radius * 2.8, 0.35);
      } else if (fx === 'bolt') {
        ctx.strokeStyle = 'rgba(255,224,102,0.5)';
        ctx.lineWidth = 1.5;
        for (var j = 0; j < 3; j++) {
          var jx2 = (Math.random() - 0.5) * 12, jy2 = (Math.random() - 0.5) * 12;
          ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + jx2, b.y + jy2); ctx.stroke();
        }
      }

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
