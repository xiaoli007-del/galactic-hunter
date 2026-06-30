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

  // v0.10.8/v0.10.9:背景音乐(HTMLAudioElement + loop,多首可切换)。与音效(程序化合成)分离。
  //   浏览器自动播放策略:首次需用户交互(开始按钮点击)才能播放,故 start 在 startGame 调。
  //   静音时(audio.isEnabled()=false)不播放;音乐开关 _bgmOn 持久化('gh_bgm')。
  //   v0.10.9:曲目表来自 Config.BGM.tracks;当前曲目 _trackIdx 持久化('gh_bgm_track'),HUD 切歌按钮循环切换。
  var DEFAULT_TRACKS = [
    { name: '银河流光', url: 'src/assets/audio/bgm.mp3' },
    { name: '赛博朋克', url: 'src/assets/audio/bgm2.mp3' },
  ];
  var _tracks = (function () {
    try { var t = G.Config && G.Config.BGM && G.Config.BGM.tracks; return (t && t.length) ? t : DEFAULT_TRACKS; }
    catch (e) { return DEFAULT_TRACKS; }
  })();
  var _BGM_VOL = (function () { try { var v = G.Config && G.Config.BGM && G.Config.BGM.volume; return v || 0.35; } catch (e) { return 0.35; } })();
  var _bgmEl = null;            // 单 HTMLAudioElement,换源复用(loop/volume 在换源后保留)
  var _loadedIdx = -1;          // _bgmEl 已载入的下标;-1=未载入/失效(强制 _loadCurrent 重设源)
  var _bgmOn = (function () {
    try { return localStorage.getItem('gh_bgm') !== '0'; } catch (e) { return true; }
  })();
  var _trackIdx = (function () {
    try {
      var i = parseInt(localStorage.getItem('gh_bgm_track'), 10);
      return (isNaN(i) || i < 0 || i >= _tracks.length) ? 0 : i;
    } catch (e) { return 0; }
  })();

  // 懒建 _bgmEl(loop=true/volume/preload auto)。node 无 Audio 返回 null。
  function _ensureEl() {
    if (_bgmEl) return _bgmEl;
    if (typeof Audio === 'undefined') return null;
    try {
      _bgmEl = new Audio();
      _bgmEl.loop = true;
      _bgmEl.volume = _BGM_VOL;
      _bgmEl.preload = 'auto';
    } catch (e) { _bgmEl = null; }
    return _bgmEl;
  }
  // 把当前 _trackIdx 对应曲目载入 _bgmEl(仅当 _loadedIdx !== _trackIdx 才设源,避免重复 load)。
  //   设 .src 后元素保持 paused(不自动播放);loop/volume/preload 换源后保留。
  function _loadCurrent() {
    var el = _ensureEl(); if (!el) return;
    if (_loadedIdx !== _trackIdx) {
      var t = _tracks[_trackIdx] || _tracks[0];
      try { el.src = t.url; el.load(); } catch (e) {}
      _loadedIdx = _trackIdx;
    }
  }

  var Sound = {
    init: function () { A = G.Platform && G.Platform.audio; },

    // —— 背景音乐控制 ——
    // start():载入当前曲目并播放。静音/用户关闭时不发声(但元素仍建,便于解除后直接播当前曲)。
    bgmStart: function () {
      if (!_bgmOn) return;
      if (typeof Audio === 'undefined') return;   // node 环境无 Audio
      _loadCurrent();                              // v0.10.9:确保元素 + 当前曲目源就绪
      if (!_bgmEl) return;
      if (A && !A.isEnabled()) return;             // 静音时也建元素但不播放(play 会 reject,catch 吞掉)
      var p = _bgmEl.play();
      if (p && p.catch) p.catch(function () { /* 自动播放策略拦截,等下次交互 */ });
    },
    bgmPause: function () {
      if (_bgmEl && !_bgmEl.paused) { try { _bgmEl.pause(); } catch (e) {} }
    },
    // 静音状态变化时同步:BGM 开着→静音则暂停,解除则恢复(_bgmEl 源已由 start/next 同步到当前曲)
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
    // v0.10.9:切换到下一首(循环)。正在播放→换源续播(新曲从头);关闭/暂停中→仅更新索引,
    //   下次 bgmStart 用新曲。单首时 no-op。返回新索引。
    bgmNext: function () {
      if (_tracks.length <= 1) return _trackIdx;   // 单首不可切(优雅降级)
      var wasPlaying = !!_bgmEl && !_bgmEl.paused && _bgmOn && (!A || A.isEnabled());
      _trackIdx = (_trackIdx + 1) % _tracks.length;
      try { localStorage.setItem('gh_bgm_track', String(_trackIdx)); } catch (e) {}
      if (typeof Audio === 'undefined') return _trackIdx;   // node:仅更新索引
      if (_bgmEl) {                                         // 元素已存在→立即换源(无论播放/暂停)
        _loadedIdx = -1;                                    // 失效,强制 _loadCurrent 重设源
        _loadCurrent();
        if (wasPlaying) { var p = _bgmEl.play(); if (p && p.catch) p.catch(function () {}); }
      }
      // 元素不存在(从未 start / 音乐关):仅更新索引,下次 bgmStart 的 _loadCurrent 载入新曲
      return _trackIdx;
    },
    bgmTrackIdx:   function () { return _trackIdx; },
    bgmTrackCount: function () { return _tracks.length; },
    bgmTrackName:  function () { var t = _tracks[_trackIdx]; return t ? t.name : ''; },


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
