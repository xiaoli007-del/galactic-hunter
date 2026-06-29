/*
 * 贴图细节增强(enhance-sprite.js)
 *
 * 在现有 AI 生图贴图上叠加程序化细节层(不重新生图),提升精致度:
 *   ① 沿主体边缘加深色描边(强化轮廓,雷电压线感)
 *   ② 主体内部金属高光带(顶亮底暗,强化体积)
 *   ③ 铆钉点阵点缀(沿主体随机分布小亮点)
 *   ④ 装甲接缝阴影(横向暗带,机械分块感)
 *
 * 用法:
 *   node tools/enhance-sprite.js ship1          # 处理 ship1(输出 ship1_enhanced.png 预览)
 *   node tools/enhance-sprite.js ship1 apply    # 处理并覆盖原文件(确认效果后再用)
 *   node tools/enhance-sprite.js all            # 全部 ship1-5 + t1-t20
 *
 * 不改原图除非加 apply;先看 _enhanced 预览对比。
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const SPRITES = path.join(__dirname, '..', 'src', 'assets', 'sprites');

// 采样主体边缘像素(非透明像素中、邻居有透明的 → 边缘)
function findEdges(d, w, h) {
  var edges = [];
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var i = (y * w + x) * 4;
      if (d[i + 3] < 128) continue;   // 透明跳过
      // 四邻有透明 → 边缘
      var up = ((y - 1) * w + x) * 4, dn = ((y + 1) * w + x) * 4;
      var lf = (y * w + (x - 1)) * 4, rt = (y * w + (x + 1)) * 4;
      if (d[up + 3] < 128 || d[dn + 3] < 128 || d[lf + 3] < 128 || d[rt + 3] < 128) {
        edges.push(x, y);
      }
    }
  }
  return edges;   // 扁平 [x,y,x,y,...]
}

async function enhance(file, apply) {
  var src = path.join(SPRITES, file + '.png');
  var outName = apply ? file + '.png' : file + '_enhanced.png';
  var out = path.join(SPRITES, outName);
  var buf = fs.readFileSync(src);
  var img = await loadImage(buf);
  var w = img.width, h = img.height;
  var c = createCanvas(w, h);
  var ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  var imgData = ctx.getImageData(0, 0, w, h);
  var d = imgData.data;

  // ① 边缘加深描边(把主体边缘像素压暗,强化轮廓)
  var edges = findEdges(d, w, h);
  for (var e = 0; e < edges.length; e += 2) {
    var ex = edges[e], ey = edges[e + 1];
    var ei = (ey * w + ex) * 4;
    d[ei] = Math.round(d[ei] * 0.45);
    d[ei + 1] = Math.round(d[ei + 1] * 0.45);
    d[ei + 2] = Math.round(d[ei + 2] * 0.5);
  }
  ctx.putImageData(imgData, 0, 0);

  // ② 金属高光带:主体上半部加亮(顶光),用 lighter 叠加垂直渐变
  ctx.globalCompositeOperation = 'lighter';
  var hl = ctx.createLinearGradient(0, 0, 0, h);
  hl.addColorStop(0, 'rgba(255,255,255,0.10)');
  hl.addColorStop(0.4, 'rgba(255,255,255,0.04)');
  hl.addColorStop(0.6, 'rgba(0,0,0,0)');
  hl.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = hl;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  // ③ 铆钉点阵:沿主体随机点缀小亮点(用边缘像素做种子位置,避免点到空白)
  ctx.globalCompositeOperation = 'lighter';
  var rivetCount = Math.min(60, Math.floor(edges.length / 2 / 40));
  // 用确定性"随机"(按文件名 hash 种子,保证可复现;不用 Math.random 避免每次不同)
  var seed = 0;
  for (var s = 0; s < file.length; s++) seed = (seed * 31 + file.charCodeAt(s)) & 0x7fffffff;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  for (var r = 0; r < rivetCount; r++) {
    var idx = Math.floor(rnd() * (edges.length / 2)) * 2;
    var rx = edges[idx] + (rnd() - 0.5) * 60;
    var ry = edges[idx + 1] + (rnd() - 0.5) * 60;
    rx = Math.max(2, Math.min(w - 2, rx));
    ry = Math.max(2, Math.min(h - 2, ry));
    var rr = 1.5 + rnd() * 1.5;
    ctx.fillStyle = 'rgba(200,220,255,0.5)';
    ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // ④ 装甲接缝阴影:几条横向暗带(机械分块感)
  ctx.globalCompositeOperation = 'multiply';
  for (var b = 0; b < 4; b++) {
    var by = h * (0.25 + b * 0.18);
    var bg = ctx.createLinearGradient(0, by - 6, 0, by + 6);
    bg.addColorStop(0, 'rgba(255,255,255,1)');
    bg.addColorStop(0.5, 'rgba(120,130,150,1)');
    bg.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, by - 6, w, 12);
  }
  ctx.globalCompositeOperation = 'source-over';

  fs.writeFileSync(out, c.toBuffer('image/png'));
  console.log('  ' + (apply ? '✓ 覆盖' : '✓ 预览') + ' ' + outName + ' (' + (fs.statSync(out).size / 1024).toFixed(0) + 'KB, 细节点: 描边' + (edges.length / 2) + ' 铆钉' + rivetCount + ')');
}

(async () => {
  var arg = process.argv[2];
  var apply = process.argv[3] === 'apply';
  if (!arg) { console.error('用法: node enhance-sprite.js <name|all> [apply]'); process.exit(1); }
  var names;
  if (arg === 'all') names = ['ship1','ship2','ship3','ship4','ship5','t1','t2','t3','t4','t5','t6','t7','t8','t9','t10','t11','t12','t13','t14','t15','t16','t17','t18','t19','t20'];
  else names = [arg];
  for (var n of names) {
    if (!fs.existsSync(path.join(SPRITES, n + '.png'))) { console.error('  ✗ ' + n + ' 不存在'); continue; }
    try { await enhance(n, apply); } catch (e) { console.error('  ✗ ' + n + ': ' + e.message); }
  }
})();
