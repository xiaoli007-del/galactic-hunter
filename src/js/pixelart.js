/*
 * Galactic Hunter — pixelart.js
 * 像素风精灵生成器
 *
 * 根据设定图风格,用代码绘制高清像素风精灵。
 * 每个精灵定义为二维颜色数组,渲染时按像素放大。
 */
(function (G) {
  'use strict';

  // 像素风调色盘
  var PAL = {
    // 玩家飞船系列(蓝银)
    ship_light: '#7ec8e3',
    ship_mid: '#4a90b8',
    ship_dark: '#2a5a7a',
    ship_metal: '#c0d0e0',
    ship_core: '#00ccff',
    ship_glow: '#00eeff',
    ship_accent: '#ffd700',
    // 怪物系列(红/紫/橙)
    monster_red: '#cc2222',
    monster_dark_red: '#881111',
    monster_purple: '#7744aa',
    monster_dark_purple: '#442266',
    monster_orange: '#ff8833',
    monster_dark_orange: '#cc5500',
    monster_teal: '#00ccaa',
    monster_dark_teal: '#008866',
    monster_metal: '#556677',
    monster_dark_metal: '#334455',
    monster_eye: '#ff3333',
    // 弹道系列
    bullet_blue: '#44aaff',
    bullet_purple: '#aa66ff',
    bullet_orange: '#ffaa33',
    bullet_teal: '#00ffcc',
    bullet_white: '#ffffff',
    // 背景
    bg_deep: '#0a0818',
    bg_nebula1: '#1a0a30',
    bg_nebula2: '#0a1a40',
    bg_star: '#cfe4ff',
  };

  // 绘制像素精灵:pixelData = 二维数组,每个元素是颜色字符串或null(透明)
  //   scale = 每个像素放大几倍
  function drawPixelSprite(ctx, pixelData, x, y, scale) {
    var h = pixelData.length, w = pixelData[0].length;
    var ox = x - (w * scale) / 2, oy = y - (h * scale) / 2;
    for (var row = 0; row < h; row++) {
      for (var col = 0; col < w; col++) {
        var c = pixelData[row][col];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(ox + col * scale, oy + row * scale, scale, scale);
        }
      }
    }
  }

  // 生成精灵缓存(避免每帧重绘)
  var spriteCache = {};
  function getPixelCanvas(key, pixelData, scale) {
    if (spriteCache[key]) return spriteCache[key];
    var h = pixelData.length, w = pixelData[0].length;
    var canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    var ctx = canvas.getContext('2d');
    for (var row = 0; row < h; row++) {
      for (var col = 0; col < w; col++) {
        var c = pixelData[row][col];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(col * scale, row * scale, scale, scale);
        }
      }
    }
    spriteCache[key] = canvas;
    return canvas;
  }

  // ============ 玩家飞船(5个等级,根据设定图) ============

  // Lv1 侦察艇:小型蓝色飞船,简单造型
  var SHIP_LV1 = [
    [null,null,null,'#2a5a7a','#2a5a7a',null,null,null,null],
    [null,null,'#4a90b8','#7ec8e3','#7ec8e3','#4a90b8',null,null,null],
    [null,'#2a5a7a','#4a90b8','#00ccff','#00ccff','#4a90b8','#2a5a7a',null,null],
    ['#2a5a7a','#4a90b8','#7ec8e3','#00eeff','#00eeff','#7ec8e3','#4a90b8','#2a5a7a',null],
    ['#4a90b8','#7ec8e3','#c0d0e0','#00ccff','#00ccff','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a'],
    [null,'#2a5a7a','#4a90b8','#7ec8e3','#7ec8e3','#4a90b8','#2a5a7a',null,null],
    [null,null,'#2a5a7a','#4a90b8','#4a90b8','#2a5a7a',null,null,null],
    [null,null,null,'#2a5a7a','#2a5a7a',null,null,null,null],
    [null,null,null,'#00ccff','#00ccff',null,null,null,null],
  ];

  // Lv2 驱逐舰:更大,翼展更宽
  var SHIP_LV2 = [
    [null,null,null,null,'#2a5a7a','#2a5a7a',null,null,null,null,null],
    [null,null,null,'#4a90b8','#7ec8e3','#7ec8e3','#4a90b8',null,null,null,null],
    [null,null,'#2a5a7a','#4a90b8','#00ccff','#00ccff','#4a90b8','#2a5a7a',null,null,null],
    [null,'#2a5a7a','#4a90b8','#7ec8e3','#00eeff','#00eeff','#7ec8e3','#4a90b8','#2a5a7a',null,null],
    ['#2a5a7a','#4a90b8','#7ec8e3','#c0d0e0','#00ccff','#00ccff','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a',null],
    ['#4a90b8','#7ec8e3','#c0d0e0','#7ec8e3','#00eeff','#00eeff','#7ec8e3','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a'],
    [null,'#2a5a7a','#4a90b8','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#4a90b8','#2a5a7a',null,null],
    [null,null,'#2a5a7a','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#2a5a7a',null,null,null],
    [null,null,null,'#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a',null,null,null,null],
    [null,null,null,null,'#00ccff','#00ccff',null,null,null,null,null],
    [null,null,null,null,'#00eeff','#00eeff',null,null,null,null,null],
  ];

  // Lv3 巡洋舰:更复杂,金色点缀
  var SHIP_LV3 = [
    [null,null,null,null,null,'#2a5a7a','#2a5a7a',null,null,null,null,null,null],
    [null,null,null,null,'#4a90b8','#7ec8e3','#7ec8e3','#4a90b8',null,null,null,null,null],
    [null,null,null,'#2a5a7a','#4a90b8','#00ccff','#00ccff','#4a90b8','#2a5a7a',null,null,null,null],
    [null,null,'#2a5a7a','#4a90b8','#7ec8e3','#00eeff','#00eeff','#7ec8e3','#4a90b8','#2a5a7a',null,null,null],
    [null,'#2a5a7a','#4a90b8','#7ec8e3','#c0d0e0','#00ccff','#00ccff','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a',null,null],
    ['#2a5a7a','#4a90b8','#7ec8e3','#c0d0e0','#7ec8e3','#00eeff','#00eeff','#7ec8e3','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a',null],
    ['#4a90b8','#7ec8e3','#c0d0e0','#7ec8e3','#ffd700','#00ccff','#00ccff','#ffd700','#7ec8e3','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a'],
    [null,'#2a5a7a','#4a90b8','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#4a90b8','#2a5a7a',null,null],
    [null,null,'#2a5a7a','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#2a5a7a',null,null,null],
    [null,null,null,'#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a',null,null,null,null],
    [null,null,null,null,'#00ccff','#00ccff','#00ccff','#00ccff',null,null,null,null,null],
    [null,null,null,null,null,'#00eeff','#00eeff',null,null,null,null,null,null],
  ];

  // Lv4 战列舰:大型,分叉翼,金色核心
  var SHIP_LV4 = [
    [null,null,null,null,null,null,'#2a5a7a','#2a5a7a',null,null,null,null,null,null,null],
    [null,null,null,null,null,'#4a90b8','#7ec8e3','#7ec8e3','#4a90b8',null,null,null,null,null,null],
    [null,null,null,null,'#2a5a7a','#4a90b8','#00ccff','#00ccff','#4a90b8','#2a5a7a',null,null,null,null,null],
    [null,null,null,'#2a5a7a','#4a90b8','#7ec8e3','#00eeff','#00eeff','#7ec8e3','#4a90b8','#2a5a7a',null,null,null,null],
    [null,null,'#2a5a7a','#4a90b8','#7ec8e3','#c0d0e0','#00ccff','#00ccff','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a',null,null,null],
    [null,'#2a5a7a','#4a90b8','#7ec8e3','#c0d0e0','#7ec8e3','#00eeff','#00eeff','#7ec8e3','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a',null,null],
    ['#2a5a7a','#4a90b8','#7ec8e3','#c0d0e0','#7ec8e3','#ffd700','#00ccff','#00ccff','#ffd700','#7ec8e3','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a',null],
    ['#4a90b8','#7ec8e3','#c0d0e0','#7ec8e3','#ffd700','#00eeff','#00eeff','#00eeff','#00eeff','#ffd700','#7ec8e3','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a'],
    [null,'#2a5a7a','#4a90b8','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#4a90b8','#2a5a7a',null,null],
    [null,null,'#2a5a7a','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#2a5a7a',null,null,null],
    [null,null,null,'#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a',null,null,null,null],
    [null,null,null,null,'#00ccff','#00ccff','#00ccff','#00ccff','#00ccff','#00ccff',null,null,null,null,null],
    [null,null,null,null,null,'#00eeff','#00eeff','#00eeff','#00eeff',null,null,null,null,null,null],
  ];

  // Lv5 旗舰:最华丽,多层装甲,双旋转环
  var SHIP_LV5 = [
    [null,null,null,null,null,null,null,'#2a5a7a','#2a5a7a',null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,'#4a90b8','#7ec8e3','#7ec8e3','#4a90b8',null,null,null,null,null,null,null],
    [null,null,null,null,null,'#2a5a7a','#4a90b8','#00ccff','#00ccff','#4a90b8','#2a5a7a',null,null,null,null,null,null],
    [null,null,null,null,'#2a5a7a','#4a90b8','#7ec8e3','#00eeff','#00eeff','#7ec8e3','#4a90b8','#2a5a7a',null,null,null,null,null],
    [null,null,null,'#2a5a7a','#4a90b8','#7ec8e3','#c0d0e0','#00ccff','#00ccff','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a',null,null,null,null],
    [null,null,'#2a5a7a','#4a90b8','#7ec8e3','#c0d0e0','#7ec8e3','#00eeff','#00eeff','#7ec8e3','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a',null,null,null],
    [null,'#2a5a7a','#4a90b8','#7ec8e3','#c0d0e0','#7ec8e3','#ffd700','#00ccff','#00ccff','#ffd700','#7ec8e3','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a',null,null],
    ['#2a5a7a','#4a90b8','#7ec8e3','#c0d0e0','#7ec8e3','#ffd700','#00eeff','#00eeff','#00eeff','#00eeff','#ffd700','#7ec8e3','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a',null],
    ['#4a90b8','#7ec8e3','#c0d0e0','#7ec8e3','#ffd700','#00eeff','#00ccff','#00eeff','#00eeff','#00ccff','#00eeff','#ffd700','#7ec8e3','#c0d0e0','#7ec8e3','#4a90b8','#2a5a7a'],
    [null,'#2a5a7a','#4a90b8','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#7ec8e3','#4a90b8','#2a5a7a',null,null],
    [null,null,'#2a5a7a','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#4a90b8','#2a5a7a',null,null,null],
    [null,null,null,'#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a','#2a5a7a',null,null,null,null],
    [null,null,null,null,'#00ccff','#00ccff','#00ccff','#00ccff','#00ccff','#00ccff','#00ccff','#00ccff',null,null,null,null,null],
    [null,null,null,null,null,'#00eeff','#00eeff','#00eeff','#00eeff','#00eeff','#00eeff',null,null,null,null,null,null],
    [null,null,null,null,null,null,'#00eeff','#00eeff','#00eeff','#00eeff',null,null,null,null,null,null,null],
  ];

  var SHIP_DATA = [null, SHIP_LV1, SHIP_LV2, SHIP_LV3, SHIP_LV4, SHIP_LV5];

  // ============ 怪物(根据设定图) ============

  // t1 红眼虫族:小甲壳虫 + 红眼 + 双颚
  var ALIEN_T1 = [
    [null,null,'#881111','#cc2222','#881111',null,null],
    [null,'#881111','#cc2222','#ff3333','#cc2222','#881111',null],
    ['#334455','#556677','#881111','#cc2222','#881111','#556677','#334455'],
    ['#556677','#cc2222','#ff3333','#ff6666','#ff3333','#cc2222','#556677'],
    ['#334455','#556677','#881111','#cc2222','#881111','#556677','#334455'],
    [null,'#881111','#cc2222','#cc2222','#cc2222','#881111',null],
    [null,null,'#881111','#556677','#881111',null,null],
    [null,null,null,'#556677',null,null,null],
    [null,'#881111',null,null,null,'#881111',null],
  ];

  // t2 圆盘机械眼:金属环 + 红色大眼
  var ALIEN_T2 = [
    [null,null,'#334455','#556677','#334455',null,null],
    [null,'#334455','#556677','#888899','#556677','#334455',null],
    ['#334455','#556677','#888899','#cc2222','#888899','#556677','#334455'],
    ['#556677','#888899','#cc2222','#ff3333','#cc2222','#888899','#556677'],
    ['#334455','#556677','#888899','#cc2222','#888899','#556677','#334455'],
    [null,'#334455','#556677','#888899','#556677','#334455',null],
    [null,null,'#334455','#556677','#334455',null,null],
  ];

  // t3 紫甲蜘蛛:紫色装甲 + 多足
  var ALIEN_T3 = [
    [null,null,null,'#7744aa','#7744aa',null,null,null],
    [null,null,'#7744aa','#9966cc','#9966cc','#7744aa',null,null],
    [null,'#442266','#7744aa','#aa88dd','#aa88dd','#7744aa','#442266',null],
    ['#442266','#7744aa','#aa88dd','#ccaaee','#ccaaee','#aa88dd','#7744aa','#442266'],
    ['#7744aa','#aa88dd','#aa88dd','#aa88dd','#aa88dd','#aa88dd','#aa88dd','#7744aa'],
    [null,'#442266','#7744aa','#7744aa','#7744aa','#7744aa','#442266',null],
    [null,null,'#442266','#7744aa','#7744aa','#442266',null,null],
    ['#7744aa',null,null,null,null,null,null,'#7744aa'],
    [null,'#7744aa',null,null,null,null,'#7744aa',null],
  ];

  // t4 幽灵翼龙:半透明翼膜 + 紫白
  var ALIEN_T4 = [
    [null,null,null,'#aa88dd',null,null,null],
    [null,null,'#aa88dd','#ccaaee','#aa88dd',null,null],
    [null,'#7744aa','#aa88dd','#ddccff','#aa88dd','#7744aa',null],
    ['#442266','#7744aa','#ccaaee','#ffffff','#ccaaee','#7744aa','#442266'],
    [null,'#7744aa','#aa88dd','#ddccff','#aa88dd','#7744aa',null],
    [null,null,'#7744aa','#aa88dd','#7744aa',null,null],
    [null,null,null,'#7744aa',null,null,null],
    [null,'#442266',null,null,null,'#442266',null],
  ];

  // t5 精英机甲:八边形 + 肩炮 + 橙色核心
  var ALIEN_T5 = [
    [null,null,'#334455','#556677','#334455',null,null],
    [null,'#334455','#556677','#888899','#556677','#334455',null],
    ['#334455','#556677','#888899','#ff8833','#888899','#556677','#334455'],
    ['#556677','#888899','#ff8833','#ffaa33','#ff8833','#888899','#556677'],
    ['#334455','#556677','#888899','#ff8833','#888899','#556677','#334455'],
    [null,'#334455','#556677','#888899','#556677','#334455',null],
    [null,null,'#334455','#556677','#334455',null,null],
    ['#334455',null,null,null,null,null,'#334455'],
  ];

  // t6 Boss:大型装甲 + 三红眼
  var ALIEN_T6 = [
    [null,null,null,null,'#334455','#334455',null,null,null,null],
    [null,null,null,'#334455','#556677','#556677','#334455',null,null,null],
    [null,null,'#334455','#556677','#888899','#888899','#556677','#334455',null,null],
    [null,'#334455','#556677','#888899','#cc2222','#cc2222','#888899','#556677','#334455',null],
    ['#334455','#556677','#888899','#cc2222','#ff3333','#ff3333','#cc2222','#888899','#556677','#334455'],
    ['#556677','#888899','#cc2222','#ff3333','#ff3333','#ff3333','#ff3333','#cc2222','#888899','#556677'],
    [null,'#334455','#556677','#888899','#cc2222','#cc2222','#888899','#556677','#334455',null],
    [null,null,'#334455','#556677','#556677','#556677','#556677','#334455',null,null],
    [null,null,null,'#334455','#334455','#334455','#334455',null,null,null],
  ];

  // 敌弹菱形
  var ENEMY_BULLET = [
    [null,'#ff3333',null],
    ['#ff3333','#ffffff','#ff3333'],
    [null,'#ff3333',null],
  ];

  // 玩家弹道
  var PLAYER_BULLET = [
    [null,'#44aaff',null],
    ['#44aaff','#ffffff','#44aaff'],
    [null,'#44aaff',null],
  ];

  var PixelArt = {
    PAL: PAL,
    drawPixelSprite: drawPixelSprite,
    getPixelCanvas: getPixelCanvas,
    SHIP_DATA: SHIP_DATA,
    ALIEN_T1: ALIEN_T1,
    ALIEN_T2: ALIEN_T2,
    ALIEN_T3: ALIEN_T3,
    ALIEN_T4: ALIEN_T4,
    ALIEN_T5: ALIEN_T5,
    ALIEN_T6: ALIEN_T6,
    ENEMY_BULLET: ENEMY_BULLET,
    PLAYER_BULLET: PLAYER_BULLET,
  };

  G.PixelArt = PixelArt;
})(window.G = window.G || {});
