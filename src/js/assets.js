/*
 * Galactic Hunter — assets.js
 * 贴图加载层(渐进增强)
 *
 * 异步加载 src/assets/sprites/ 下的 PNG。render 层优先用贴图,未就绪/失败/缺失时
 * 自动退回程序化绘制 —— 因此缺图不影响运行,可边补图边生效。
 * node 环境无 Image,load 静默跳过,get 永远返回 null,smoke 测试不受影响。
 *
 * v0.10.1:接入 Kenney Space Kit(CC0)贴图 —— 飞船 Lv1-5 用 ship1-5 五种造型,
 *   每级一张 = 升级外观变化;怪物候选 alien/alienBones/robot/陨石。旧 ship.png 保留兼容。
 */
(function (G) {
  'use strict';

  var Assets = {
    _images: {},
    _state: {},   // key -> 'loading' | 'ok' | 'fail'
    SPRITE_DIR: 'src/assets/sprites/',
    // 需要的贴图(AI 生图 / strip-bg 抠图后落 sprites/):
    //   飞船 Lv1-5(每级一张,升级外观进化)+ 5 个敌人原型(按功能映射现有 23 怪)
    //   未就绪→null→render 退回程序化绘制,缺图不影响运行
    LIST: ['ship1', 'ship2', 'ship3', 'ship4', 'ship5',
           'enemy-scout', 'enemy-shield', 'enemy-turret', 'enemy-elite', 'enemy-heavy'],

    init: function () {
      var self = this;
      this.LIST.forEach(function (key) { self.load(key); });
    },

    load: function (key) {
      if (this._images[key] || typeof Image === 'undefined') return;  // 已加载或非浏览器环境
      var self = this, img = new Image();
      this._images[key] = img;
      this._state[key] = 'loading';
      img.onload = function () { self._state[key] = 'ok'; };
      img.onerror = function () { self._state[key] = 'fail'; };   // 文件不存在/损坏 → 退回程序化
      img.src = this.SPRITE_DIR + key + '.png';
    },

    // 返回就绪的 Image,否则 null(调用方退回程序化绘制)
    get: function (key) {
      if (this._state[key] === 'ok' && this._images[key]) return this._images[key];
      return null;
    },
  };

  G.Assets = Assets;
})(window.G = window.G || {});
