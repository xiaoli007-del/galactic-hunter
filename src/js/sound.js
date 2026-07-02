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


    play: function (name, opt) {
      if (!A) return;
      switch (name) {
        case 'fire': {
          // v0.14:出膛音重做——低频"咚"冲击(打击感核心)+ 高频气阀"嘶"。
          //   节流放宽到 55ms:每声够厚不糊。连发时低频略降音量防轰头。
          if (G.Platform._now && G.Platform._now() - lastFire < 0.055) return;
          lastFire = G.Platform._now ? G.Platform._now() : 0;
          var wlv = (opt && opt.level) || 1;
          var bassFreq = 180 - wlv * 12;               // 等级越高,低频越沉(更重)
          A.tone(bassFreq, 0.09, 'sine', 0.22, bassFreq * 0.5);       // 低频下潜"咚"
          A.tone(720 + wlv * 60, 0.05, 'square', 0.05, 320);          // 高频气阀"嘶"上挑
          A.noiseFiltered(0.04, 0.05, 'highpass', 1800, 0.7);          // 出膛气流
          break;
        }
        case 'kill': {
          // v0.14:击杀=低频"轰"下潜 + 宽带爆破噪声 + 一点金属碎片高频。层层叠加才有爆炸感。
          A.tone(140, 0.22, 'sine', 0.26, 45);          // 低频轰鸣下潜(冲击核心)
          A.noise(0.18, 0.22);                          // 宽带爆破
          A.noiseFiltered(0.12, 0.1, 'highpass', 2600, 0.8);  // 金属碎片高频"哗啦"
          break;
        }
        case 'coin':
          A.tone(1200, 0.06, 'sine', 0.12, 1600);      // 清脆上扬"叮"
          break;
        case 'upgrade':
          A.tone(523, 0.1, 'triangle', 0.12, 784);     // do→sol 上行
          setTimeout(function () { A && A.tone(784, 0.12, 'triangle', 0.12, 1047); }, 90); // →do 高八度
          break;
        case 'hit':
          // v0.14:玩家受击——沉闷撞击 + 噪声爆裂 + 低频下潜,比旧版"重"得多。
          A.tone(130, 0.18, 'sawtooth', 0.2, 55);      // 低频闷撞下潜
          A.tone(90, 0.16, 'sine', 0.18, 40);          // 次低频加厚(胸腔感)
          A.noise(0.08, 0.16);                          // 撞击噪声
          break;
        case 'boss':
          // v0.14:Boss 出现——长低吼 + 下扫 + 低频脉动,压迫感。
          A.tone(110, 0.6, 'sawtooth', 0.2, 45);
          A.tone(55, 0.7, 'sine', 0.18, 40);
          A.noiseFiltered(0.5, 0.12, 'lowpass', 200, 1);
          break;
        case 'bossKill':
          // v0.14:Boss 击破——长爆破 + 多层下扫 + 高频碎片,够"大"。
          A.noise(0.5, 0.26);
          A.tone(220, 0.4, 'square', 0.16, 70);
          A.tone(110, 0.5, 'sine', 0.22, 40);
          A.noiseFiltered(0.3, 0.12, 'highpass', 2400, 0.8);
          break;
        case 'reflect':
          A.tone(660, 0.08, 'sine', 0.1, 990);         // 反弹"咻"
          A.noiseFiltered(0.05, 0.08, 'bandpass', 1600, 3);  // 反弹脆响
          break;
        case 'enemyFire':
          // v0.8 敌弹发射提示:短促低频锯齿下行,警示"敌方开火"
          A.tone(240, 0.05, 'sawtooth', 0.05, 160);
          break;

        // —— v0.14 技能弹命中音(按 b.skill.fx 分流) ——
        case 'hitIce': {
          // 冰冻凝结:高频冰晶碎裂脆响(带通高频噪声)+ 下滑脆音"叮~,层叠玻璃感。
          A.noiseFiltered(0.14, 0.14, 'highpass', 3200, 1.2);   // 冰晶碎裂高频"咔嚓"
          A.tone(1800, 0.12, 'triangle', 0.1, 700);             // 玻璃下滑脆音
          A.tone(2400, 0.08, 'sine', 0.06, 1400);               // 高频叮
          break;
        }
        case 'hitFire': {
          // 火焰命中:低通闷燃噪声(持续的"呼")+ 噼啪爆裂(高频随机)+ 低频火球冲击。
          A.noiseFiltered(0.22, 0.16, 'lowpass', 600, 0.8);     // 闷燃"呼"
          A.noiseFiltered(0.06, 0.1, 'highpass', 2200, 1);      // 噼啪"啪"
          A.tone(160, 0.14, 'sine', 0.14, 70);                  // 火球低频冲击
          break;
        }
        case 'hitBolt': {
          // 闪电命中:高通滋滋电流噪声(电流感)+ 锯齿抖动"滋啦"+ 高频劈啪。
          A.noiseFiltered(0.12, 0.16, 'highpass', 2600, 1.5);   // 电流滋滋(主体)
          A.tone(1200, 0.1, 'sawtooth', 0.08, 2400);            // 锯齿上挑"滋啦"
          A.tone(900, 0.06, 'square', 0.06, 1800);              // 劈啪
          break;
        }
        case 'hitLaser': {
          // 激光命中:持续能量嗡鸣(长音 + 低通扫频)+ 灼烧高频。贯穿感。
          A.tone(880, 0.18, 'sawtooth', 0.1, 440);              // 能量嗡鸣下扫
          A.noiseFiltered(0.16, 0.08, 'bandpass', 1500, 2);     // 灼烧中频
          A.tone(1760, 0.1, 'sine', 0.05, 1320);                // 高频能量芯
          break;
        }
        case 'hitMulti': {
          // 散射连击:密集金属脆响(每发一叮),比普通命中更"碎"。
          A.tone(1500, 0.05, 'square', 0.08, 900);
          A.noiseFiltered(0.04, 0.08, 'highpass', 3000, 1);
          break;
        }
        case 'hitNormal': {
          // v0.14 普通弹命中:清脆金属撞击"铛"+ 一点噪声。比 kill 轻、比 fire 闷。
          A.tone(900, 0.06, 'square', 0.1, 500);                // 金属"铛"下滑
          A.tone(450, 0.05, 'sine', 0.06, 280);                 // 加厚
          A.noiseFiltered(0.04, 0.06, 'bandpass', 2000, 2);     // 撞击噪声
          break;
        }
      }
    },
  };

  G.Sound = Sound;
})(window.G = window.G || {});
