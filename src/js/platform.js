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
    // 键盘状态(暂停等用):keys=持续按下,_justKeys=本帧按下的瞬间(单帧标志)
    keys: {},
    _justKeys: {},
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

      // 键盘(P/ESC 暂停等)。小游戏移植时换 wx.onKeyDown,逻辑层不变。
      window.addEventListener('keydown', function (e) {
        var k = (e.key || e.keyCode === 27 && 'escape' || '').toLowerCase();
        if (!k && e.keyCode) k = String.fromCharCode(e.keyCode).toLowerCase();
        if (!k) return;
        if (!self.keys[k]) self._justKeys[k] = true;   // 未按→按下的瞬间标记
        self.keys[k] = true;
        // 暂停键阻止默认(避免 ESC 退出全屏等干扰),其余不拦
        if (k === 'p' || k === 'escape') e.preventDefault();
      });
      window.addEventListener('keyup', function (e) {
        var k = (e.key || '').toLowerCase();
        self.keys[k] = false;
      });

      return this;
    },

    // 某键是否在本帧"刚刚按下"(单帧消费,防连发)
    isKeyJustPressed: function (k) { return !!this._justKeys[k]; },

    _resize: function () {
      var cfg = G.Config;
      var w = window.innerWidth, h = window.innerHeight;
      // 保持逻辑比例,letterbox 居中
      var scale = Math.min(w / cfg.WIDTH, h / cfg.HEIGHT);
      this._scale = scale;
      this._offsetX = (w - cfg.WIDTH * scale) / 2;
      this._offsetY = (h - cfg.HEIGHT * scale) / 2;
      // 用 devicePixelRatio 保证清晰,但限制上限:4K/3x 屏物理像素会翻倍,
      // 限制到 2 视觉几乎无损却显著降低每帧绘制压力(缓解 PC 卡顿)。
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      this._justKeys = {};
    },

    // 单调时钟(秒),用于音效节流等;无 performance 时退回 Date 毫秒
    _now: function () {
      var p = window.performance && window.performance.now ? window.performance.now() / 1000 : Date.now() / 1000;
      return p;
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

    // —— 音频(Web Audio API 程序化合成,无音频文件;移植小游戏换 wx.createInnerAudioContext)——
    // 渐进增强:无 AudioContext(node 环境/旧浏览器)时静默 no-op,不影响运行。
    audio: {
      _ctx: null,
      _enabled: true,
      // AudioContext 必须在用户交互后创建(浏览器策略),故懒加载;首调 play 时建。
      _ctxGet: function () {
        if (this._ctx) return this._ctx;
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { this._ctx = new AC(); } catch (e) { this._ctx = null; }
        return this._ctx;
      },
      setEnabled: function (on) { this._enabled = on; },
      isEnabled: function () { return this._enabled; },
      // 基础原语:一个带 ADSR 包络的振荡音(freq 赫兹,dur 秒,type 波形,vol 音量,slideTo 频率扫向)
      tone: function (freq, dur, type, vol, slideTo) {
        if (!this._enabled) return;
        var ctx = this._ctxGet();
        if (!ctx) return;
        if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }  // 首次交互后唤醒
        var t0 = ctx.currentTime;
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = type || 'square';
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        var v = vol == null ? 0.18 : vol;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(v, t0 + 0.008);     // 起音
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);   // 释放
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.02);
      },
      // 噪声爆裂(击杀/爆炸用):白噪声经短包络
      noise: function (dur, vol) {
        if (!this._enabled) return;
        var ctx = this._ctxGet();
        if (!ctx) return;
        if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
        var t0 = ctx.currentTime;
        var n = Math.floor(ctx.sampleRate * dur);
        var buf = ctx.createBuffer(1, n, ctx.sampleRate);
        var data = buf.getChannelData(0);
        for (var i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);  // 衰减白噪
        var src = ctx.createBufferSource(); src.buffer = buf;
        var g = ctx.createGain();
        g.gain.setValueAtTime(vol == null ? 0.16 : vol, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(g); g.connect(ctx.destination);
        src.start(t0); src.stop(t0 + dur);
      },
      // v0.14:带滤波的噪声爆裂(技能音核心)。filterType='lowpass'/'highpass'/'bandpass',
      //   freq=截止/中心频率,Q=共振(越高越"啸叫/嗡嗡")。用于:火(低通闷燃)/冰(带通脆裂)/
      //   电(高通滋滋)。dur/vol 同 noise;freq 为 0 时不加滤波(等同 noise)。
      noiseFiltered: function (dur, vol, filterType, freq, Q) {
        if (!this._enabled) return;
        var ctx = this._ctxGet();
        if (!ctx) return;
        if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
        var t0 = ctx.currentTime;
        var n = Math.floor(ctx.sampleRate * dur);
        var buf = ctx.createBuffer(1, n, ctx.sampleRate);
        var data = buf.getChannelData(0);
        for (var i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
        var src = ctx.createBufferSource(); src.buffer = buf;
        var g = ctx.createGain();
        g.gain.setValueAtTime(vol == null ? 0.16 : vol, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        var node = src;
        if (freq) {
          var f = ctx.createBiquadFilter();
          f.type = filterType || 'lowpass';
          f.frequency.value = freq;
          f.Q.value = Q == null ? 1 : Q;
          src.connect(f); f.connect(g);
        } else {
          src.connect(g);
        }
        g.connect(ctx.destination);
        src.start(t0); src.stop(t0 + dur);
      },
    },
  };

  G.Platform = Platform;
})(window.G = window.G || {});
