/*
 * Galactic Hunter — 背景抠除工具(strip-bg.js)
 *
 * 把 src/assets/sprites/_raw/ 下的生图原图(任意背景色)抠成透明 PNG,输出到
 *   src/assets/sprites/(覆盖同名的 Kenney/旧图)。render.js 自动拾取生效。
 *
 * 原理:采样图像四角颜色判断背景色(不限于纯黑),容差内判为背景→透明,
 *   边缘羽化避免锯齿。alpha 阈值内保留半透明,光效/抗锯齿自然过渡。
 *
 * 用法:
 *   node tools/strip-bg.js                 # 处理 _raw/ 全部
 *   node tools/strip-bg.js ship1           # 只处理 ship1
 *   node tools/strip-bg.js ship1 40        # 指定容差 40(默认 36;抠不净调大,吃太多主体调小)
 *   node tools/strip-bg.js bullet2 6 close # 深色主体蛀洞修复(闭运算填被误抠的洞,默认关)
 *
 * 依赖 canvas 包(项目已装)。无依赖外网。
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

// 输入:桌面快捷文件夹(用户生图直接存这里,省得深层路径找)
const HOME = process.env.USERPROFILE || process.env.HOME;
const RAW_DIR = path.join(HOME, 'Desktop', 'GH-生图丢这里');
const OUT_DIR = path.join(__dirname, '..', 'src', 'assets', 'sprites');
const DEFAULT_TOL = 36;

// Windows + Node canvas 对中文路径 loadImage 偶发失败:先用 fs 读成 Buffer 再喂,
//   绕开路径编码问题(中文文件夹名也能正常处理)。
async function loadImageSafe(p) {
  const buf = fs.readFileSync(p);
  return loadImage(buf);
}

function colorDist(r1, g1, b1, r2, g2, b2) {
  // 加权欧氏(人眼对绿更敏感)
  var dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
}

// 形态学闭运算(膨胀 r 次 → 腐蚀 r 次),填弹体被误抠的细小蛀洞与窄缝。
//   只改 alpha:把被实体包围、<2r 的洞填实;外部轮廓先膨胀再腐蚀回基本不变(尖角略圆)。
//   填出的像素 RGB 用就近实体色(取邻域不透明像素均值),避免纯黑填进弹体。
function morphClose(d, w, h, r) {
  var n = w * h;
  var mask = new Uint8Array(n);
  for (var i = 0; i < n; i++) mask[i] = d[i * 4 + 3] > 128 ? 1 : 0;
  function dilate(src) {
    var dst = new Uint8Array(n);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var p = y * w + x, v = 0;
      if (src[p] || (x > 0 && src[p - 1]) || (x < w - 1 && src[p + 1]) || (y > 0 && src[p - w]) || (y < h - 1 && src[p + w])) v = 1;
      dst[p] = v;
    }
    return dst;
  }
  function erode(src) {
    var dst = new Uint8Array(n);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var p = y * w + x;
      var v = src[p] && (x === 0 || src[p - 1]) && (x === w - 1 || src[p + 1]) && (y === 0 || src[p - w]) && (y === h - 1 || src[p + w]) ? 1 : 0;
      dst[p] = v;
    }
    return dst;
  }
  var m = mask;
  for (var k = 0; k < r; k++) m = dilate(m);
  for (var k2 = 0; k2 < r; k2++) m = erode(m);
  // 闭运算新增的实体像素(原mask=0,闭后=1)→填实 alpha,RGB 取邻域均值
  for (var i2 = 0; i2 < n; i2++) {
    if (m[i2] && !mask[i2]) {
      var x = i2 % w, y = (i2 - x) / w, rs = 0, gs = 0, bs = 0, cnt = 0;
      for (var dy = -2; dy <= 2 && cnt === 0; dy++) for (var dx = -2; dx <= 2; dx++) {
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var np = ny * w + nx;
        if (mask[np]) { var ni = np * 4; rs = d[ni]; gs = d[ni + 1]; bs = d[ni + 2]; cnt = 1; break; }
      }
      if (cnt) { d[i2 * 4] = rs; d[i2 * 4 + 1] = gs; d[i2 * 4 + 2] = bs; d[i2 * 4 + 3] = 255; }
    }
  }
}

// 内部空洞填充:见 processOne 里的注释。alphaThresh 以下视为"纯透明",从四边
//   flood 扩散标记外部背景(阈值要小,只用纯透明扩散——否则半透明羽化带会成桥梁
//   让 flood 渗进主体把内部洞也标成外部)。未标记到的纯透明像素=内部洞→alpha 填回 255。
function fillInteriorHoles(d, w, h, alphaThresh) {
  var n = w * h;
  var ext = new Uint8Array(n); // 1=外部背景(连通边缘的纯透明)
  var stack = [];
  // 从四边的纯透明像素入栈
  for (var x = 0; x < w; x++) {
    if (d[(0 * w + x) * 4 + 3] < alphaThresh) { ext[0 * w + x] = 1; stack.push(0 * w + x); }
    if (d[((h - 1) * w + x) * 4 + 3] < alphaThresh) { ext[(h - 1) * w + x] = 1; stack.push((h - 1) * w + x); }
  }
  for (var y = 0; y < h; y++) {
    if (d[(y * w + 0) * 4 + 3] < alphaThresh) { ext[y * w + 0] = 1; stack.push(y * w + 0); }
    if (d[(y * w + (w - 1)) * 4 + 3] < alphaThresh) { ext[y * w + (w - 1)] = 1; stack.push(y * w + (w - 1)); }
  }
  // 4 连通 BFS 扩散(只沿纯透明)
  while (stack.length) {
    var p = stack.pop();
    var px = p % w, py = (p - px) / w;
    var nb = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1];
    for (var k = 0; k < 4; k++) {
      var q = nb[k];
      if (q < 0 || ext[q]) continue;
      if (d[q * 4 + 3] < alphaThresh) { ext[q] = 1; stack.push(q); }
    }
  }
  // 未标记为外部的纯透明像素 = 内部洞 → 填回不透明
  // (RGB 未动,深色金属洞的 RGB 本就是弹体色,补全后与周围一致)
  var filled = 0;
  for (var i = 0; i < n; i++) {
    if (!ext[i] && d[i * 4 + 3] < alphaThresh) {
      d[i * 4 + 3] = 255;
      filled++;
    }
  }
  return filled;
}

// 采样四角,取出现最多的色作为背景键(各角取小区域均值,再四角互相取最接近的主体)
function detectBg(data, w, h) {
  var corners = [];
  var pts = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  for (var p = 0; p < pts.length; p++) {
    var x = pts[p][0], y = pts[p][1];
    var idx = (y * w + x) * 4;
    corners.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
  }
  // 四角取均值作为背景键(假设背景大致均匀)
  var avg = { r: 0, g: 0, b: 0 };
  corners.forEach(function (c) { avg.r += c.r; avg.g += c.g; avg.b += c.b; });
  avg.r = Math.round(avg.r / 4); avg.g = Math.round(avg.g / 4); avg.b = Math.round(avg.b / 4);
  // 检查四角是否一致(一致=可信背景;差异大=背景不均匀,警告)
  var maxVar = 0;
  corners.forEach(function (c) { maxVar = Math.max(maxVar, colorDist(c.r, c.g, c.b, avg.r, avg.g, avg.b)); });
  return { bg: avg, uniform: maxVar < 40 };
}

async function processOne(file, tol, doFill) {
  var src = path.join(RAW_DIR, file);
  var out = path.join(OUT_DIR, file);
  var img = await loadImageSafe(src);
  var w = img.width, h = img.height;
  var canvas = createCanvas(w, h);
  var ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  var imgData = ctx.getImageData(0, 0, w, h);
  var d = imgData.data;
  var det = detectBg(d, w, h);
  var bg = det.bg;
  var feather = 18;   // 边缘羽化带宽度(容差内渐变到透明)

  for (var i = 0; i < d.length; i += 4) {
    var r = d[i], g = d[i + 1], b = d[i + 2];
    var dist = colorDist(r, g, b, bg.r, bg.g, bg.b);
    if (dist <= tol) {
      d[i + 3] = 0;   // 背景→全透明
    } else if (dist <= tol + feather) {
      // 边缘羽化:线性过渡透明度
      d[i + 3] = Math.round(255 * (dist - tol) / feather);
    }
  }

  if (doFill) {
    // v0.13.3:蛀洞修复(可选,命令行加 "close" 启用)——黑底深色主体(如深色金属
    //   弹体)的暗部距纯黑常 <容差,被误抠成透明,弹体布满"虫蛀"空洞。两步修复:
    //   ① fillInteriorHoles:从四边纯透明 flood 标记外部背景,未标记的透明像素=被
    //      主体包围的内部洞,填回不透明(对孤立洞有效)。
    //   ② morphClose(r=2):对"洞连通外部"的千疮百孔弹体,膨胀填窄缝/细洞、腐蚀修回
    //      轮廓,弹体变完整(会填掉 <4px 的细缝)。
    //   默认关闭:对已抠干净的亮色图(飞船/亮色怪)闭运算会填掉合法深色凹陷(推进口/
    //      窗口),改变外观,故仅在深色主体抠不净时按需开启。
    fillInteriorHoles(d, w, h, 10);
    morphClose(d, w, h, 2);
  }

  ctx.putImageData(imgData, 0, 0);

  // v0.11.1:裁剪到主体边界(alpha>40 的 bounding box),去四周半透明光晕羽化。
  //   AI 生图原图主体常仅占 2-5%,四周大片半透明光晕在运行时缩成小弹后成"透明壳"包裹弹丸。
  //   在抠图工具侧裁掉,输出的就是干净弹丸本体 —— 运行时只缩放不读像素,彻底绕开 file://
  //   下 canvas tainted 导致 getImageData 失败的问题(getEBulletTex 运行时裁剪在 file:// 下失效)。
  var bData = ctx.getImageData(0, 0, w, h).data;
  var minX = w, minY = h, maxX = 0, maxY = 0, found = false;
  for (var y = 0; y < h; y += 2) {
    for (var x = 0; x < w; x += 2) {
      if (bData[(y * w + x) * 4 + 3] > 40) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        found = true;
      }
    }
  }
  var outBuf;
  if (found) {
    var pad = Math.round((maxX - minX + maxY - minY) * 0.06) + 6;   // 留 6%+6px 边距,防贴边
    var cx0 = Math.max(0, minX - pad), cy0 = Math.max(0, minY - pad);
    var cw = Math.min(w, maxX + pad) - cx0, ch = Math.min(h, maxY + pad) - cy0;
    // v0.13.2:按主体实际 bbox 紧裁(不再强行正方形)。子弹是细长竖条,旧版取 max(cw,ch)
    //   做正方形会横向大量留白,运行时缩到 30px 显示时有效宽度仅 ~6px 糊成像素方块。
    //   圆形弹(敌弹)紧裁后近方形,效果与原正方形无异;长条弹(玩家弹)紧裁后主体填满。
    //   运行时 getBulletTex/drawImage 均按贴图自身宽高比缩放(见 render.js)。
    var c2 = createCanvas(cw, ch);
    var c2x = c2.getContext('2d');
    c2x.drawImage(canvas, cx0, cy0, cw, ch, 0, 0, cw, ch);
    outBuf = c2.toBuffer('image/png');
    console.log('  ✓ ' + file + ' ' + w + 'x' + h + ' → 紧裁主体 ' + cw + 'x' + ch + '(原主体占 ' +
      (((maxX - minX + 1) * (maxY - minY + 1)) * 100 / (w * h)).toFixed(1) + '%)' +
      ' 背景rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ') ' + (det.uniform ? '均匀' : '⚠不均匀') + ' 容差' + tol);
  } else {
    outBuf = canvas.toBuffer('image/png');
    console.log('  ⚠ ' + file + ' 未检测到主体,按原尺寸输出 ' + w + 'x' + h);
  }
  fs.writeFileSync(out, outBuf);
}

(async () => {
  if (!fs.existsSync(RAW_DIR)) { console.error('无 _raw 目录'); process.exit(1); }
  var files = fs.readdirSync(RAW_DIR).filter(function (f) { return /\.png$/i.test(f); });
  // 用法:node strip-bg.js [name] [tol] [close]
  //   name=过滤名(或省略=全部); tol=容差(默认36); close=启用蛀洞修复(默认关)
  //   例:node strip-bg.js bullet2 6 close   node strip-bg.js 40   node strip-bg.js ship1
  var args = process.argv.slice(2);
  var nameArg = null, tol = DEFAULT_TOL, doFill = false;
  for (var a = 0; a < args.length; a++) {
    if (/^\d+$/.test(args[a])) tol = parseInt(args[a], 10);
    else if (args[a].toLowerCase() === 'close') doFill = true;
    else nameArg = args[a];
  }
  if (nameArg) {
    files = files.filter(function (f) { return f.toLowerCase().indexOf(nameArg.toLowerCase()) >= 0; });
  }
  if (!files.length) { console.error(' _raw/ 里没有 PNG。把生图原图放到:\n  ' + RAW_DIR); process.exit(1); }
  console.log('处理 ' + files.length + ' 张,容差 ' + tol + (doFill ? ',蛀洞修复开' : '') + '\n');
  var fail = 0;
  for (var i = 0; i < files.length; i++) {
    try { await processOne(files[i], tol, doFill); }
    catch (e) { console.error('  ✗ ' + files[i] + ': ' + e.message); fail++; }
  }
  console.log('\n完成 ' + (files.length - fail) + '/' + files.length + '。运行游戏看效果,抠不净加容差重试,深色主体蛀洞加 close。');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERR', e); process.exit(1); });
