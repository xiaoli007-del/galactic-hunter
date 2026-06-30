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
    //   飞船 Lv1-5(每级一张,升级外观进化)+ 23 种怪各一独立贴图(t1-t23,按 a.type 取)
    //   未就绪→null→render 退回程序化绘制,缺图不影响运行(可分批接入)
    LIST: ['ship1', 'ship2', 'ship3', 'ship4', 'ship5',
           't1','t2','t3','t4','t5','t6','t7','t8','t9','t10',
           't11','t12','t13','t14','t15','t16','t17','t18','t19','t20',
           'bg',
           'bullet1','bullet2','bullet3','bullet4','bullet5',
           'bullet-ice','bullet-fire','bullet-bolt','bullet-laser',
           'explosion',                                                            // v0.10.11:爆炸特效
           'ebullet-aimed','ebullet-ring','ebullet-boss','enemy-bullet',        // v0.10.11:敌弹(aimed直射/ring环射/boss重弹;spiral复用enemy-bullet)
           'powerup-ice','powerup-fire','powerup-bolt','powerup-laser','powerup-multi2'],  // v0.10.11:技能胶囊(双/三/四发共用 multi2 底图+程序画数字)

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
