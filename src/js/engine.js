/*
 * Galactic Hunter — engine.js
 * 引擎工具层(对应 GDD §9.2 第二层)
 *
 * 提供与平台无关的通用能力:主循环、数学工具、对象池、碰撞。
 * 不依赖任何游戏业务逻辑。
 */
(function (G) {
  'use strict';

  var Engine = {

    // —— 主循环(变步长:每帧按真实 dt 更新,高刷新率屏下子弹位移连续平滑)——
    startLoop: function (update, render) {
      var last = 0;
      var maxDt = 1 / 20;          // 单帧最大逻辑时间 50ms,防切后台后 dt 暴跳
      function frame(now) {
        if (!last) last = now;
        var dt = (now - last) / 1000;
        last = now;
        if (dt > maxDt) dt = maxDt;
        // 变步长:每帧推进一次。60Hz 屏 dt≈1/60,144Hz 屏 dt≈1/144 都平滑更新,
        // 不再因「逻辑锁 60、渲染 144」导致子弹位移离散、肉眼一顿一顿。
        update(dt);
        render(1);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    },

    // —— 数学工具 ——
    clamp: function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    rand: function (min, max) { return min + Math.random() * (max - min); },
    randInt: function (min, max) { return Math.floor(min + Math.random() * (max - min + 1)); },
    choice: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    // 加权选择,arr = [{item, weight}, ...] 或传两个数组
    weighted: function (items, weights) {
      var total = 0, i;
      for (i = 0; i < weights.length; i++) total += weights[i];
      var r = Math.random() * total;
      var acc = 0;
      for (i = 0; i < items.length; i++) {
        acc += weights[i];
        if (r < acc) return items[i];
      }
      return items[items.length - 1];
    },
    dist2: function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; },
    dist: function (ax, ay, bx, by) { return Math.sqrt(Engine.dist2(ax, ay, bx, by)); },
    angleTo: function (ax, ay, bx, by) { return Math.atan2(by - ay, bx - ay); },
    // 圆碰撞
    circleHit: function (a, b) {
      var r = a.radius + b.radius;
      return Engine.dist2(a.x, a.y, b.x, b.y) < r * r;
    },

    // —— 对象池(用于大量短生命周期实体,如粒子)——
    pool: function (factory) {
      var free = [];
      return {
        get: function () { return free.pop() || factory(); },
        recycle: function (obj) { free.push(obj); },
      };
    },
  };

  G.Engine = Engine;
})(window.G = window.G || {});
