/*
 * Galactic Hunter — platform.js
 * 平台适配层(对应 GDD §9.2 最底层)
 *
 * 这一层把所有「与运行环境耦合」的能力收敛到一处:画布、输入、本地存储。
 * 移植到微信/抖音小游戏时,只改本文件:
 *   - wx.createCanvas() 替换 canvas 创建
 *   - wx.onTouchStart/Move/End 替换事件
 *   - wx.getStorageSync/setStorageSync 替换 localStorage
 * 上层游戏逻辑不感知平台差异。
 */
(function (G) {
  'use strict';

  var STORAGE_PREFIX = 'gh_';

  var Platform = {
    canvas: null,
    ctx: null,
    // 指针状态(逻辑坐标系)
    pointer: { x: 0, y: 0, down: false, justPressed: false },
    _scale: 1,
    _offsetX: 0,
    _offsetY: 0,
    _callbacks: { move: [], down: [] },

    init: function (canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this._resize();
      var self = this;
      // 监听容器尺寸变化(旋转窗口等)
      window.addEventListener('resize', function () { self._resize(); });

      // 鼠标
      canvas.addEventListener('mousemove', function (e) { self._update(e.clientX, e.clientY); });
      canvas.addEventListener('mousedown', function (e) { self._press(e.clientX, e.clientY); });
      window.addEventListener('mouseup', function () { self.pointer.down = false; });

      // 触摸(小游戏主要输入方式,提前适配)
      canvas.addEventListener('touchmove', function (e) {
        e.preventDefault();
        var t = e.touches[0]; self._update(t.clientX, t.clientY);
      }, { passive: false });
      canvas.addEventListener('touchstart', function (e) {
        e.preventDefault();
        var t = e.touches[0]; self._update(t.clientX, t.clientY); self._press(t.clientX, t.clientY);
      }, { passive: false });
      window.addEventListener('touchend', function () { self.pointer.down = false; });

      return this;
    },

    _resize: function () {
      var cfg = G.Config;
      var w = window.innerWidth, h = window.innerHeight;
      // 保持逻辑比例,letterbox 居中
      var scale = Math.min(w / cfg.WIDTH, h / cfg.HEIGHT);
      this._scale = scale;
      this._offsetX = (w - cfg.WIDTH * scale) / 2;
      this._offsetY = (h - cfg.HEIGHT * scale) / 2;
      // 用 devicePixelRatio 保证清晰
      var dpr = window.devicePixelRatio || 1;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this._dpr = dpr;
    },

    // 屏幕坐标 → 逻辑坐标
    _toLogical: function (sx, sy) {
      return {
        x: (sx - this._offsetX) / this._scale,
        y: (sy - this._offsetY) / this._scale,
      };
    },

    _update: function (sx, sy) {
      var p = this._toLogical(sx, sy);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
    },

    _press: function (sx, sy) {
      this._update(sx, sy);
      this.pointer.down = true;
      this.pointer.justPressed = true;
    },

    // 每帧末由 Game 调用,清掉单帧标志
    endFrame: function () {
      this.pointer.justPressed = false;
    },

    // —— 本地存储(抽象,移植小游戏换实现)——
    getStorage: function (key) {
      try {
        var v = window.localStorage.getItem(STORAGE_PREFIX + key);
        return v ? JSON.parse(v) : null;
      } catch (e) { return null; }
    },
    setStorage: function (key, value) {
      try { window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); }
      catch (e) { /* 存储满或禁用时静默 */ }
    },
  };

  G.Platform = Platform;
})(window.G = window.G || {});
