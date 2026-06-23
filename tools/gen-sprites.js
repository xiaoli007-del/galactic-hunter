/*
 * Galactic Hunter — tools/gen-sprites.js
 * 程序化生成贴图 PNG(ship + alien-t1..t6),输出到 src/assets/sprites/。
 *
 * 纯 Node 实现:软件光栅化(扫描线多边形/圆/径向渐变)+ zlib 编码 PNG。
 * 无任何外部依赖、不调用图像模型 —— 彻底避开“识别图片报错”。
 *
 * 运行:node tools/gen-sprites.js
 * 风格与 render.js 的程序化绘制保持一致(缺失贴图时的回退观感),
 * 因此贴图就绪与否视觉相近,渐进增强无突兀切换。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CANVAS = 256;                 // 每张贴图正方形画布
const OUT = path.join(__dirname, '..', 'src', 'assets', 'sprites');

// ────────────────── 颜色工具 ──────────────────
function hex(s) {
  s = s.replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function lighten(c, t) { return mix(c, [255, 255, 255], t); }
function darken(c, t) { return mix(c, [0, 0, 0], t); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ────────────────── 帧缓冲(直通 alpha,over 合成)──────────────────
class Buf {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8Array(w * h * 4); }
  // 直通 alpha over 合成
  over(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4;
    const sa = a / 255, da = this.d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    this.d[i]     = (r * sa + this.d[i]     * da * (1 - sa)) / oa;
    this.d[i + 1] = (g * sa + this.d[i + 1] * da * (1 - sa)) / oa;
    this.d[i + 2] = (b * sa + this.d[i + 2] * da * (1 - sa)) / oa;
    this.d[i + 3] = oa * 255;
  }
}

// 扫描线多边形填充;colorFn(px,py) -> [r,g,b,a]
function fillPoly(buf, pts, colorFn) {
  let minY = Infinity, maxY = -Infinity, cx = 0, cy = 0;
  for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  const y0 = Math.floor(minY), y1 = Math.ceil(maxY);
  for (let y = y0; y < y1; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const A = pts[i], B = pts[(i + 1) % pts.length];
      const ay = A[1], by = B[1];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
        xs.push(A[0] + (yc - ay) / (by - ay) * (B[0] - A[0]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.ceil(xs[k] - 0.5), xb = Math.floor(xs[k + 1] - 0.5);
      for (let x = xa; x <= xb; x++) {
        const c = colorFn(x + 0.5, yc);
        buf.over(x, y, c[0], c[1], c[2], c[3]);
      }
    }
  }
}
function scalePoly(pts, f, cx, cy) { return pts.map(p => [cx + (p[0] - cx) * f, cy + (p[1] - cy) * f]); }

// 径向渐变圆(r0..r1 区间插值;colorStops:[t..[r,g,b]] 升序)
function radialColor(d, innerR, outerR, stops) {
  let t = (d - innerR) / (outerR - innerR);
  t = clamp(t, 0, 1);
  for (let i = 0; i < stops.length - 1; i++) {
    if (t <= stops[i + 1][0]) {
      const a = stops[i], b = stops[i + 1], lt = (t - a[0]) / (b[0] - a[0] || 1);
      return mix(a[1], b[1], lt);
    }
  }
  return stops[stops.length - 1][1];
}
function fillCircle(buf, cx, cy, rad, colorFn) {
  const x0 = Math.floor(cx - rad), x1 = Math.ceil(cx + rad);
  const y0 = Math.floor(cy - rad), y1 = Math.ceil(cy + rad);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = (x + 0.5) - cx, dy = (y + 0.5) - cy, d = Math.sqrt(dx * dx + dy * dy);
    if (d <= rad) { const c = colorFn(x + 0.5, y + 0.5, d); buf.over(x, y, c[0], c[1], c[2], c[3]); }
  }
}
// 发光(径向 alpha 渐变,模拟 render.js glow():0→a,0.35→0.5a,1→0)
function glow(buf, cx, cy, rad, color, maxA) {
  fillCircle(buf, cx, cy, rad, (px, py, d) => {
    const t = d / rad; let a;
    if (t < 0.35) a = maxA * (1 + (0.5 - 1) * (t / 0.35));
    else a = maxA * (0.5 + (0 - 0.5) * ((t - 0.35) / 0.65));
    return [color[0], color[1], color[2], clamp(a, 0, 1) * 255];
  });
}
function thickLine(buf, x0, y0, x1, y1, thick, color, a) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillCircle(buf, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thick / 2, () => [color[0], color[1], color[2], (a == null ? 255 : a * 255)]);
  }
}
// 二次贝塞尔采样
function quadBez(p0, c, p1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; const u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]); }
  return out;
}

// ────────────────── PNG 编码 ──────────────────
const crcTab = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTab[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, cb]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride) : Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ────────────────── 通用“怪物体”绘制:外缘描边 + 径向渐变填充 ──────────────────
function drawAlienBody(buf, C, R, pts, color) {
  const l40 = lighten(color, 0.4), d55 = darken(color, 0.55), rim = lighten(color, 0.5);
  let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length; // 形心(本地坐标)
  // 1) 略放大的描边层
  fillPoly(buf, scalePoly(pts, 1.045, cx, cy), () => [rim[0], rim[1], rim[2], 255]);
  // 2) 本体径向渐变(内圆 -0.3r,-0.3r 半径 0.1r → 外圆 半径 R)
  const ix = -0.3 * R, iy = -0.3 * R, inR = 0.1 * R, outR = R;
  fillPoly(buf, pts, (px, py) => {
    const d = Math.sqrt((px - C - ix) * (px - C - ix) + (py - C - iy) * (py - C - iy));
    const c = radialColor(d, inR, outR, [[0, l40], [0.6, color], [1, d55]]);
    return [c[0], c[1], c[2], 255];
  });
}

// ────────────────── 各贴图 ──────────────────
const C = CANVAS / 2;

function spriteShip() {
  const buf = new Buf(CANVAS, CANVAS), R = 70;
  const cyan = hex('#5ad1ff'), flameC = hex('#4a9eff'), rim = hex('#bfe0ff');
  // 青色主光晕(本体下方,贴图自带辉光,与程序化回退观感一致)
  glow(buf, C, C, R * 1.5, cyan, 0.4);
  // 引擎尾焰(在机腹下方,本体覆盖其上半部)
  glow(buf, C, C + R * (0.6 + 0.85), R * 0.55, flameC, 0.75);
  glow(buf, C, C + R * (0.6 + 0.85), R * 0.28, hex('#9fd0ff'), 0.6);
  // 本体多边形(render.js ship 顶点)
  const body = [[0, -1.15], [0.5, 0.2], [0.95, 0.75], [0.3, 0.55], [0.3, 0.7], [-0.3, 0.7], [-0.3, 0.55], [-0.95, 0.75], [-0.5, 0.2]]
    .map(p => [C + p[0] * R, C + p[1] * R]);
  let bx = 0, by = 0; for (const p of body) { bx += p[0]; by += p[1]; } bx /= body.length; by /= body.length;
  // 描边层
  fillPoly(buf, scalePoly(body, 1.05, bx, by), () => [rim[0], rim[1], rim[2], 255]);
  // 金属横向渐变:#2a3340 → #9fb0c6 → #2a3340
  const dark = hex('#2a3340'), mid = hex('#9fb0c6');
  fillPoly(buf, body, (px) => {
    const t = clamp((px - (C - R)) / (2 * R), 0, 1);
    const c = t < 0.5 ? mix(dark, mid, t / 0.5) : mix(mid, dark, (t - 0.5) / 0.5);
    return [c[0], c[1], c[2], 255];
  });
  // 中线脊
  thickLine(buf, C, C - R * 1.0, C, C + R * 0.55, R * 0.05, cyan, 0.9);
  // 驾驶舱(radial:#eaf6ff → #3aa0ff → #0a2a55)
  const cabStops = [[0, hex('#eaf6ff')], [0.5, hex('#3aa0ff')], [1, hex('#0a2a55')]];
  fillCircle(buf, C, C - R * 0.3, R * 0.26, (px, py, d) => { const c = radialColor(d, 0, R * 0.26, cabStops); return [c[0], c[1], c[2], 255]; });
  return buf;
}

// 通用怪物装配:绘制本体 + 各 tier 特征
function spriteAlien(tier, color) {
  const buf = new Buf(CANVAS, CANVAS), R = 80;
  // 本色主光晕(贴图自带辉光)
  glow(buf, C, C, R * 1.45, color, 0.42);
  let pts = [], alpha = 255, features = () => {};
  switch (tier) {
    case 1: { // 爬虫:竖椭圆 + 两根触角
      pts = ellipse(0, 0, 0.7 * R, R, 40);
      features = () => {
        const rim = lighten(color, 0.5);
        thickLine(buf, C - 0.4 * R, C - 0.7 * R, C - 0.7 * R, C - 1.4 * R, R * 0.07, rim, 1);
        thickLine(buf, C + 0.4 * R, C - 0.7 * R, C + 0.7 * R, C - 1.4 * R, R * 0.07, rim, 1);
      };
      break;
    }
    case 2: { // 飞翼:箭形 + 白色单眼
      pts = [[0, -1], [1, 0.7], [0.4, 0.3], [-0.4, 0.3], [-1, 0.7]].map(p => [C + p[0] * R, C + p[1] * R]);
      features = () => {
        fillCircle(buf, C, C - 0.1 * R, R * 0.22, (px, py, d) => { const c = radialColor(d, 0, R * 0.22, [[0, [255, 255, 255]], [1, [180, 230, 220]]]); return [c[0], c[1], c[2], 255]; });
        fillCircle(buf, C, C - 0.1 * R, R * 0.09, () => [20, 40, 60, 255]);
      };
      break;
    }
    case 3: { // 蟹甲:圆身 + 两根钳臂
      pts = ellipse(0, 0, 0.85 * R, 0.85 * R, 40);
      features = () => {
        const rim = lighten(color, 0.5);
        thickLine(buf, C - 0.8 * R, C + 0.2 * R, C - 1.3 * R, C - 0.3 * R, R * 0.16, rim, 1);
        thickLine(buf, C + 0.8 * R, C + 0.2 * R, C + 1.3 * R, C - 0.3 * R, R * 0.16, rim, 1);
        fillCircle(buf, C - 1.3 * R, C - 0.3 * R, R * 0.12, () => [rim[0], rim[1], rim[2], 255]);
        fillCircle(buf, C + 1.3 * R, C - 0.3 * R, R * 0.12, () => [rim[0], rim[1], rim[2], 255]);
      };
      break;
    }
    case 4: { // 幽灵:7 点波浪形,半透明
      alpha = 218; pts = []; const seg = 7;
      for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2, rr = R * (0.7 + 0.35 * Math.sin(a * 3 + 2)); pts.push([C + Math.cos(a) * rr, C + Math.sin(a) * rr]); }
      features = () => { /* 留白 */ };
      break;
    }
    case 5: { // 精英:10 角星 + 中心亮点
      pts = []; const n = 10;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 - Math.PI / 2, rr = i % 2 === 0 ? R : R * 0.5; pts.push([C + Math.cos(a) * rr, C + Math.sin(a) * rr]); }
      features = () => { fillCircle(buf, C, C, R * 0.2, () => [255, 243, 224, 255]); };
      break;
    }
    case 6: { // Boss:贝塞尔团块 + 三只眼
      pts = quadBez([0, -R], [1.2 * R, -0.2 * R], [0.8 * R, R], 14)
        .concat(quadBez([0.8 * R, R], [0, 1.2 * R], [-0.8 * R, R], 14))
        .concat(quadBez([-0.8 * R, R], [-1.2 * R, -0.2 * R], [0, -R], 14))
        .map(p => [C + p[0], C + p[1]]);
      features = () => {
        const eyes = [[-0.4, -0.1], [0.4, -0.1], [0, 0.35]];
        for (const e of eyes) {
          fillCircle(buf, C + e[0] * R, C + e[1] * R, R * 0.13, () => [255, 255, 255, 255]);
          fillCircle(buf, C + e[0] * R, C + e[1] * R, R * 0.06, () => [255, 61, 110, 255]);
        }
      };
      break;
    }
  }
  drawAlienBody(buf, C, R, pts, color);
  features();
  if (alpha < 255) applyAlpha(buf, alpha); // 幽灵整体降透明度
  return buf;
}

function ellipse(cx, cy, rx, ry, n) {
  const out = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([C + cx + Math.cos(a) * rx, C + cy + Math.sin(a) * ry]); } return out;
}
function applyAlpha(buf, a) {
  for (let i = 3; i < buf.d.length; i += 4) buf.d[i] = Math.min(buf.d[i], a);
}

// ────────────────── 主流程 ──────────────────
const TIERS = {
  ship:    { tier: 0, color: hex('#5ad1ff') },
  'alien-t1': { tier: 1, color: hex('#8aff80') },
  'alien-t2': { tier: 2, color: hex('#5ad1ff') },
  'alien-t3': { tier: 3, color: hex('#ffd166') },
  'alien-t4': { tier: 4, color: hex('#c77dff') },
  'alien-t5': { tier: 5, color: hex('#ff8a3d') },
  'alien-t6': { tier: 6, color: hex('#ff3d6e') },
};

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const key of Object.keys(TIERS)) {
    const meta = TIERS[key];
    const buf = meta.tier === 0 ? spriteShip() : spriteAlien(meta.tier, meta.color);
    const png = encodePNG(CANVAS, CANVAS, Buffer.from(buf.d));
    const file = path.join(OUT, key + '.png');
    fs.writeFileSync(file, png);
    // 自检:回读校验尺寸/有效像素,无需图像识别
    const check = verifyPNG(file);
    console.log(`  ✓ ${key}.png  ${png.length}B  非透明像素 ${check.opaque}px (${check.pct}%)  IHDR ${check.w}x${check.h}/${check.ct}`);
  }
  console.log(`\n完成:${Object.keys(TIERS).length} 张贴图已写入 ${path.relative(process.cwd(), OUT)}/`);
}

// 结构校验(不依赖图像解码库):解压 IDAT,核对行长度与过滤字节合法性
function verifyPNG(file) {
  const b = fs.readFileSync(file);
  // 跳过 8 字节签名,解析 IHDR
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), ct = b[25];
  // 找 IDAT(可能多段,这里单段)
  let p = 8, idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') idat.push(b.slice(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4, expected = (stride + 1) * h;
  let opaque = 0;
  for (let y = 0; y < h; y++) {
    const fb = raw[y * (stride + 1)]; // 过滤字节
    if (fb > 4) throw new Error(`${file}: 非法过滤字节 ${fb}`);
    for (let x = 0; x < w; x++) { if (raw[y * (stride + 1) + 1 + x * 4 + 3] > 8) opaque++; }
  }
  if (raw.length !== expected) throw new Error(`${file}: 解压长度不符 ${raw.length} vs ${expected}`);
  return { w, h, ct, opaque, pct: (opaque / (w * h) * 100).toFixed(1) };
}

main();
