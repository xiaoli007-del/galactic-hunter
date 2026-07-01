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

async function processOne(file, tol) {
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
  var arg = process.argv[2];
  var tol = parseInt(process.argv[3], 10) || DEFAULT_TOL;
  if (arg && !/^\d+$/.test(arg)) {
    // 按名称过滤
    files = files.filter(function (f) { return f.toLowerCase().indexOf(arg.toLowerCase()) >= 0; });
  } else if (arg && /^\d+$/.test(arg)) {
    tol = parseInt(arg, 10);   // node strip-bg.js 40 → 全部,容差40
  }
  if (!files.length) { console.error(' _raw/ 里没有 PNG。把生图原图放到:\n  ' + RAW_DIR); process.exit(1); }
  console.log('处理 ' + files.length + ' 张,容差 ' + tol + '\n');
  var fail = 0;
  for (var i = 0; i < files.length; i++) {
    try { await processOne(files[i], tol); }
    catch (e) { console.error('  ✗ ' + files[i] + ': ' + e.message); fail++; }
  }
  console.log('\n完成 ' + (files.length - fail) + '/' + files.length + '。运行游戏看效果,抠不净加容差重试。');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERR', e); process.exit(1); });
