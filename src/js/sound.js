/*
 * Galactic Hunter — sound.js
 * 音效层(Web Audio API 程序化合成,零音频文件)
 *
 * 设计:全部音效用振荡器 + 噪声合成,无外部音频资源 —— 规避二进制资源生成/识别的
 * 脆弱路径(与程序化贴图同一思路)。无 AudioContext 时由 Platform.audio 静默 no-op,
 * 因此 node 冒烟环境不受影响。
 *
 * 命名音效 → Platform.audio 原语 的封装。开火音效做最小间隔节流,避免连发刷屏糊成一团。
 */
(function (G) {
  'use strict';

  var A;  // G.Platform.audio,init 时绑定
  var lastFire = 0;

  var Sound = {
    init: function () { A = G.Platform && G.Platform.audio; },

    play: function (name) {
      if (!A) return;
      switch (name) {
        case 'fire':
          // 节流:连发时最快 40ms 一声,否则糊成噪声
          if (G.Platform._now && G.Platform._now() - lastFire < 0.04) return;
          lastFire = G.Platform._now ? G.Platform._now() : 0;
          A.tone(880, 0.06, 'square', 0.06, 420);     // 短促高频"啾",下滑
          break;
        case 'kill':
          A.noise(0.12, 0.12);                          // 爆裂白噪
          A.tone(180, 0.1, 'sawtooth', 0.08, 60);      // 低频闷响
          break;
        case 'coin':
          A.tone(1200, 0.06, 'sine', 0.12, 1600);      // 清脆上扬"叮"
          break;
        case 'upgrade':
          A.tone(523, 0.1, 'triangle', 0.12, 784);     // do→sol 上行
          setTimeout(function () { A && A.tone(784, 0.12, 'triangle', 0.12, 1047); }, 90); // →do 高八度
          break;
        case 'hit':
          A.tone(160, 0.12, 'sawtooth', 0.16, 80);     // 受击低沉
          A.noise(0.06, 0.1);
          break;
        case 'boss':
          A.tone(110, 0.5, 'sawtooth', 0.18, 55);      // Boss 出现低吼
          break;
        case 'bossKill':
          A.noise(0.4, 0.2);
          A.tone(440, 0.3, 'square', 0.14, 110);       // Boss 击破
          break;
        case 'reflect':
          A.tone(660, 0.08, 'sine', 0.1, 990);         // 反弹"咻"
          break;
      }
    },
  };

  G.Sound = Sound;
})(window.G = window.G || {});
