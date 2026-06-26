const { createCanvas, Image } = require('canvas');
const fs = require('fs');
const path = require('path');

const INPUT  = String.raw`C:\Users\xhxq1024\Desktop\飞船设定图\飞船设定图.png`;
const OUTPUT = String.raw`C:\Users\xhxq1024\Desktop\GalacticHunter\src\assets\sprites`;

async function loadImageFromPath(filePath) {
  const buf = fs.readFileSync(filePath);
  const img = new Image();
  img.src = buf;
  return img;
}

async function main() {
  const img = await loadImageFromPath(INPUT);
  console.log(`Image loaded: ${img.width} x ${img.height}`);

  const colW = Math.floor(img.width / 5);
  const rowH = Math.floor(img.height / 2);
  console.log(`Cell size: ${colW} x ${rowH}`);

  // --- Ships (top row, lv1..lv5 left to right) ---
  for (let i = 0; i < 5; i++) {
    const sx = i * colW;
    const sy = 0;
    const canvas = createCanvas(colW, rowH);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, colW, rowH, 0, 0, colW, rowH);

    const file = path.join(OUTPUT, `ship-lv${i + 1}.png`);
    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(file, buf);
    console.log(`Saved ${file}  (${buf.length} bytes)`);
  }

  // --- Bullets (bottom row, lv1..lv5 left to right) ---
  for (let i = 0; i < 5; i++) {
    const sx = i * colW;
    const sy = rowH;
    const canvas = createCanvas(colW, rowH);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, colW, rowH, 0, 0, colW, rowH);

    const file = path.join(OUTPUT, `bullet-lv${i + 1}.png`);
    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(file, buf);
    console.log(`Saved ${file}  (${buf.length} bytes)`);
  }

  console.log('\nDone! All 10 sprites extracted.');
}

main().catch(err => { console.error(err); process.exit(1); });
