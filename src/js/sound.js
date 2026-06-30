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

  // v0.10.8:背景音乐(HTMLAudioElement + loop)。与音效(程序化合成)分离。
  //   浏览器自动播放策略:首次需用户交互(开始按钮点击)才能播放,故 start 在 startGame 调。
  //   静音时(audio.isEnabled()=false)不播放;音乐开关 _bgmOn 持久化(localStorage)。
  var BGM_URL = 'src/assets/audio/bgm.mp3';
  var _bgmEl = null;
  var _bgmOn = (function () {
    try { return localStorage.getItem('gh_bgm') !== '0'; } catch (e) { return true; }
  })();

  var Sound = {
    init: function () { A = G.Platform && G.Platform.audio; },

    // —— 背景音乐控制 ——
    // start():加载并循环播放。若已存在则 resume。静音/用户关闭时不发声。
    bgmStart: function () {
      if (!_bgmOn) return;
      if (typeof Audio === 'undefined') return;   // node 环境无 Audio
      if (!_bgmEl) {
        try {
          _bgmEl = new Audio(BGM_URL);
          _bgmEl.loop = true;
          _bgmEl.volume = 0.35;        // 背景音压低,不盖过开火/击杀音效
          _bgmEl.preload = 'auto';
        } catch (e) { _bgmEl = null; return; }
      }
      // 静音时也建元素但不播放(play 会 reject,catch 吞掉)
      if (A && !A.isEnabled()) return;
      var p = _bgmEl.play();
      if (p && p.catch) p.catch(function () { /* 自动播放策略拦截,等下次交互 */ });
    },
    bgmPause: function () {
      if (_bgmEl && !_bgmEl.paused) { try { _bgmEl.pause(); } catch (e) {} }
    },
    // 静音状态变化时同步:BGM 开着→静音则暂停,解除则恢复
    bgmSync: function () {
      if (!_bgmEl) return;
      if (_bgmOn && A && A.isEnabled()) {
        if (_bgmEl.paused) { var p = _bgmEl.play(); if (p && p.catch) p.catch(function () {}); }
      } else {
        if (!_bgmEl.paused) { try { _bgmEl.pause(); } catch (e) {} }
      }
    },
    bgmToggle: function () {
      _bgmOn = !_bgmOn;
      try { localStorage.setItem('gh_bgm', _bgmOn ? '1' : '0'); } catch (e) {}
      if (_bgmOn) this.bgmStart(); else this.bgmPause();
      return _bgmOn;
    },
    bgmIsOn: function () { return _bgmOn; },


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
        case 'enemyFire':
          // v0.8 敌弹发射提示:短促低频锯齿下行,警示"敌方开火"
          A.tone(240, 0.05, 'sawtooth', 0.05, 160);
          break;
      }
    },
  };

  G.Sound = Sound;
})(window.G = window.G || {});
