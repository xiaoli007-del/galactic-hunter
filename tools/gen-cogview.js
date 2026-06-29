/*
 * Galactic Hunter — CogView 美术资产生成器(v0.10.2)
 *
 * 调用智谱 CogView-4 文生图 API,按《太空射击游戏美术规范 v1.0》生成雷电/怒首领蜂级的
 * 玩家飞船 LV1-5、敌人、弹幕 PNG,落到 src/assets/sprites/ 供 render.js 接入。
 *
 * 用法:
 *   先设环境变量(本会话):read -s ZHIPU_API_KEY && export ZHIPU_API_KEY
 *   跑单张试水:  node tools/gen-cogview.js ship 1          # 只生成飞船 Lv1
 *   跑全部:      node tools/gen-cogview.js all
 *   跑某类:      node tools/gen-cogview.js ship            # 飞船 Lv1-5
 *
 * 依赖:Node 24 内置 fetch;需 HTTPS_PROXY=http://127.0.0.1:7890(本机直连外网超时)。
 *   key 经 $ZHIPU_API_KEY 读取,不出现在命令行/代码里。
 */
const fs = require('fs');
const path = require('path');

const API = 'https://open.bigmodel.cn/api/paas/v4/images/generations';
const KEY = process.env.ZHIPU_API_KEY;
const PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const OUT_DIR = path.join(__dirname, '..', 'src', 'assets', 'sprites');

if (!KEY) {
  console.error('✗ 缺 ZHIPU_API_KEY。先在本会话设:');
  console.error('  read -s ZHIPU_API_KEY && export ZHIPU_API_KEY');
  process.exit(1);
}

// —— 通用风格锚(所有提示词共享,确保系列一致)——
const STYLE = [
  'arcade shoot-em-up game asset, Raiden Fighters style, top-down view, ship pointing UP',
  'mechanical hard-surface design, NOT an icon, NOT flat shape, NOT a glowing blob',
  'visible structure: external armor plating + internal frame + small energy core + thrusters + weapon muzzles',
  'structure 80%, glow effects max 20%, light only on core/engine, NEVER light replacing shape',
  'metallic alloy material, industrial panel seams, rivets, mechanical joints',
  'high contrast, strong silhouette, combat readable: clear front direction, attack direction, weak core',
  'transparent background (PNG alpha), centered, no text, no watermark, no border',
].join('; ');

// —— 资产清单(规范 §4 飞船 / §5 敌人)——
//   size 用 CogView-4 支持的方形(飞船/怪正方利于多方向);文件名对齐 assets.js LIST。
const ASSETS = {
  ship: [
    { file: 'ship1', tier: 'LV1 scout: small body, single engine, single weapon, light armor' },
    { file: 'ship2', tier: 'LV2 fighter: twin engines, dual weapon systems, added wing structure, medium armor' },
    { file: 'ship3', tier: 'LV3 armored: segmented block armor, expanded weapon systems, enhanced core energy' },
    { file: 'ship4', tier: 'LV4 heavy: multiple engine system, multi-layer armor, weapon arrays' },
    { file: 'ship5', tier: 'LV5 mothership-class: modular structure, segmented fuselage, multi-core energy system, building-level complexity' },
  ],
  enemy: [
    { file: 'enemy-scout',  tier: 'recon unit: small, fast, weak armor, single thruster' },
    { file: 'enemy-shield', tier: 'shielded unit: outer shield ring structure, exposed inner core' },
    { file: 'enemy-turret', tier: 'attack turret: floating, multi-muzzle weapon ports' },
    { file: 'enemy-elite',  tier: 'elite hunter: mecha-bio hybrid, segmented joints, red/purple core, heavy armor layers' },
    { file: 'enemy-heavy',  tier: 'heavy elite: huge volume, multi-module body, destructible structures, multi-core systems' },
  ],
};

function buildPrompt(item) {
  return `${item.tier}. ${STYLE}`;
}

// 直连 fetch(智谱 open.bigmodel.cn 是国内域名,直连可达,无需代理;
//   代理是给 GitHub 用的,国内域名走代理反被绕到国外)
const TIMEOUT_MS = 90000;   // 生图慢,留足时间
async function fetchDirect(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

async function download(url, dest) {
  const res = await fetchDirect(url, {});
  if (!res.ok) throw new Error('download http ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function genOne(item, size) {
  const prompt = buildPrompt(item);
  const dest = path.join(OUT_DIR, item.file + '.png');
  console.log(`→ 生成 ${item.file} ... (size ${size})`);
  const body = { model: 'cogview-4', prompt, size };
  const res = await fetchDirect(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: 'Bearer ' + KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`API http ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  // 兼容 url / b64_json 两种返回
  const it = (data.data && data.data[0]) || {};
  let bytes = 0;
  if (it.url) {
    bytes = await download(it.url, dest);
  } else if (it.b64_json) {
    fs.writeFileSync(dest, Buffer.from(it.b64_json, 'base64'));
    bytes = fs.statSync(dest).size;
  } else {
    throw new Error('无图片数据,响应: ' + JSON.stringify(data).slice(0, 300));
  }
  // 校验是合法 PNG(读 IHDR)
  const b = fs.readFileSync(dest);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  console.log(`  ✓ ${item.file}.png ${w}x${h} (${(bytes / 1024).toFixed(1)}KB)`);
  return { file: item.file, w, h, bytes };
}

(async () => {
  const arg = process.argv[2] || 'ship';
  const subArg = process.argv[3];   // ship 的等级序号
  let jobs = [];
  if (arg === 'all') {
    jobs = [...ASSETS.ship, ...ASSETS.enemy];
  } else if (ASSETS[arg]) {
    jobs = ASSETS[arg];
    if (arg === 'ship' && subArg) jobs = [ASSETS.ship[parseInt(subArg, 10) - 1]];
  } else {
    console.error('未知类目: ' + arg + '。可用: ship / enemy / all');
    process.exit(1);
  }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`连接: 直连 open.bigmodel.cn(国内域名,无需代理)`);
  console.log(`目标: ${jobs.length} 张 → ${OUT_DIR}\n`);
  const ok = [], fail = [];
  for (const item of jobs) {
    try {
      // CogView-4 支持尺寸:方形 1024x1024 / 768x1344(竖)等;飞船用方形便于方向旋转
      const r = await genOne(item, '1024x1024');
      ok.push(r);
    } catch (e) {
      console.error(`  ✗ ${item.file}: ${e.message}`);
      fail.push({ file: item.file, err: e.message });
    }
  }
  console.log(`\n完成: ${ok.length} 成功 / ${fail.length} 失败`);
  if (fail.length) { console.log('失败项:'); fail.forEach(f => console.log('  ' + f.file + ' — ' + f.err.slice(0, 120))); }
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
