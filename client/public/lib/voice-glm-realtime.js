/* ============================================================================
 * voice-glm-realtime —— 用 GLM-Realtime 全双工语音接管办公室角色的「通话」。
 *
 * 链路：
 *   麦克风 → AudioWorklet 打成 100ms/16kHz PCM16 → /voice-rt（vite 代理到本机
 *   桥 127.0.0.1:7871）→ 智谱 GLM-Realtime（Server VAD，打断由服务端托管）
 *   → 24kHz PCM16 下行 → 本地排队播放；同时把模型转写经 api.callReply() 写进
 *   通话面板 / 角色气泡。
 *
 * 零侵入：
 *   · 不 import office3d.js 的内部符号，只经 window.__office 的公开面注册扩展；
 *   · 未发起通话时不创建 AudioContext、不申请麦克风；
 *   · 面板文字复用 api.callReply()，未开内置语音时其内部 TTS 分支零副作用。
 *
  * 与后端的文本契约（约定见 ~/3dp-agent/voice_service/voice_common.py 的 ROLE_GREETINGS，
  *   Marvis 侧重构后常量已搬家到该文件；此处中文表须与 ROLE_GREETINGS["zh"] 一字不差，
  *   否则 isGreetingEcho 去重失效、开场白在面板里显示两遍）：
 *   → {"type":"start","peer":<角色key>}      上行：二进制帧 = 裸 PCM16/16kHz
 *   → {"type":"text","text":"..."}           上行：面板打字发言
 *   ← {"type":"speech_started"}              下行：清空未播音频（打断手感）
 *   ← {"type":"transcript_done","text":"…"}  下行：模型这句话的文本
 *   ← {"type":"error",...}                   下行：错误
 * ==========================================================================*/
(function () {
  "use strict";

  var office = window.__office;
  if (!office || typeof office.registerExtension !== "function") {
    console.warn("[voice-rt] window.__office 未就绪，插件跳过挂载");
    return;
  }

  /* ---------------- 常量 ---------------- */
  var WS_PATH = "/voice-rt";
  var IN_RATE = 16000; // 上行采样率（桥端按 16k 解释）
  var OUT_RATE = 24000; // 下行采样率（GLM 固定 24k 单声道）
  var FRAME = 1600; // 100ms @16k
  var LOOKAHEAD = 0.06; // 播放预排，吸收网络抖动

  /* 与 voice_service/voice_common.py 的 ROLE_GREETINGS["zh"] 保持一字不差：
     在钩子里同步占位，压掉 office3d.js 420ms 后补的那条内置问候，避免重复。 */
  var GREETINGS = {
    coordinator: "喂，你好，我是总协调，排期和资源的事都可以找我。",
    geometry: "你好，我是几何分析，模型的网格和尺寸我来看。",
    printability: "喂，你好，我是可打印性这边，模型能不能打我来把关。",
    failure: "你好，我是失效模式，打印出问题随时说。",
    optimization: "喂，你好，我是优化建议，温度和速度这些我来调。",
  };

  var WORKLET_SRC =
    "class RtTap extends AudioWorkletProcessor {\n" +
    "  constructor(){ super(); this._b = new Float32Array(" + FRAME + "); this._n = 0; }\n" +
    "  process(inputs){\n" +
    "    const ch = inputs[0] && inputs[0][0];\n" +
    "    if (!ch) return true;\n" +
    "    for (let i = 0; i < ch.length; i++){\n" +
    "      this._b[this._n++] = ch[i];\n" +
    "      if (this._n >= " + FRAME + "){ this.port.postMessage(this._b.slice(0)); this._n = 0; }\n" +
    "    }\n" +
    "    return true;\n" +
    "  }\n" +
    "}\n" +
    'registerProcessor("rt-tap", RtTap);\n';

  /* ---------------- 运行时 ---------------- */
  var RT = {
    ws: null,
    peer: null,
    active: false,
    greeted: false,
    inCtx: null,
    micStream: null,
    srcNode: null,
    tapNode: null,
    outCtx: null,
    playHead: 0,
    voices: [],
    sentFrames: 0,
  };

  /* ---------------- 下行播放 ---------------- */
  function ensureOutCtx() {
    if (!RT.outCtx || RT.outCtx.state === "closed") {
      var C = window.AudioContext || window.webkitAudioContext;
      RT.outCtx = new C();
      RT.playHead = 0;
    }
    if (RT.outCtx.state === "suspended") RT.outCtx.resume();
    return RT.outCtx;
  }

  function playPcm(buf) {
    if (!buf || !buf.byteLength) return;
    var ctx = ensureOutCtx();
    var n = buf.byteLength >> 1;
    if (!n) return;
    var dv = new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
    var f32 = new Float32Array(n);
    for (var i = 0; i < n; i++) f32[i] = dv.getInt16(i * 2, true) / 32768;

    var ab = ctx.createBuffer(1, n, OUT_RATE);
    ab.copyToChannel(f32, 0);
    var s = ctx.createBufferSource();
    s.buffer = ab;
    s.connect(ctx.destination);

    var at = Math.max(ctx.currentTime + LOOKAHEAD, RT.playHead);
    s.start(at);
    RT.playHead = at + ab.duration;
    RT.playedBytes = (RT.playedBytes || 0) + buf.byteLength;
    RT.voices.push(s);
    s.onended = function () {
      var k = RT.voices.indexOf(s);
      if (k >= 0) RT.voices.splice(k, 1);
    };
  }

  function stopPlayback() {
    /* 只有"真的打断了还在播的内容"才计数：剩余时长有富余才说明用户抢话了 */
    if (RT.outCtx && RT.playHead - RT.outCtx.currentTime > 0.05) {
      RT.interrupts = (RT.interrupts || 0) + 1;
      RT.droppedSec =
        Math.round(((RT.droppedSec || 0) + (RT.playHead - RT.outCtx.currentTime)) * 10) / 10;
    }
    RT.voices.forEach(function (s) {
      try {
        s.stop();
      } catch (e) {}
    });
    RT.voices = [];
    RT.playHead = 0;
  }

  /* ---------------- 下行控制消息 ---------------- */
  function isGreetingEcho(text) {
    var g = GREETINGS[RT.peer];
    if (!g) return false;
    return text.indexOf(g.slice(0, 10)) === 0;
  }

  function onControl(raw) {
    var d;
    try {
      d = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (d.type === "speech_started") {
      stopPlayback(); // 服务端已判停/打断，本地立刻停播，手感跟手
    } else if (d.type === "transcript_done") {
      var text = String(d.text || "").trim();
      if (!text) return;
      if (!RT.greeted) {
        RT.greeted = true;
        if (isGreetingEcho(text)) return; // 开场白已在 start 时占好位
      }
      office.callReply(text);
    } else if (d.type === "error") {
      console.warn("[voice-rt] GLM error:", d.code, d.message);
    }
  }

  /* ---------------- 上行采集 ---------------- */
  function wsUrl() {
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + WS_PATH;
  }

  function connect() {
    return new Promise(function (resolve, reject) {
      var sock;
      try {
        sock = new WebSocket(wsUrl());
      } catch (e) {
        reject(e);
        return;
      }
      sock.binaryType = "arraybuffer";
      RT.ws = sock;
      var settled = false;
      sock.onopen = function () {
        settled = true;
        sock.send(JSON.stringify({ type: "start", peer: RT.peer }));
        resolve();
      };
      sock.onmessage = function (ev) {
        if (typeof ev.data === "string") onControl(ev.data);
        else playPcm(ev.data);
      };
      sock.onerror = function () {
        if (!settled) {
          settled = true;
          reject(new Error("语音桥连接失败（7871 是否在跑？）"));
        }
      };
      sock.onclose = function () {
        if (!settled) {
          settled = true;
          reject(new Error("语音桥提前断开"));
        } else if (RT.active) {
          /* 通话中意外断开：翻下状态、清资源、面板留一句，避免 RT.active 永远为 true */
          console.warn("[voice-rt] 语音桥已断开");
          var peer = RT.peer;
          stop();
          try {
            if (peer) office.say(peer, "语音连接已断开，请重新发起通话。");
          } catch (e) {}
        }
      };
      setTimeout(function () {
        if (!settled) {
          settled = true;
          reject(new Error("语音桥连接超时"));
        }
      }, 4000);
    });
  }

  function sendFrame(f32) {
    var ws = RT.ws;
    if (!ws || ws.readyState !== 1) return;
    var n = f32.length;
    var ab = new ArrayBuffer(n * 2);
    var dv = new DataView(ab);
    for (var i = 0; i < n; i++) {
      var v = f32[i];
      if (v > 1) v = 1;
      else if (v < -1) v = -1;
      dv.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    ws.send(ab);
    RT.sentFrames++;
  }

  function openMic() {
    return navigator.mediaDevices
      .getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then(function (stream) {
        RT.micStream = stream;
        var C = window.AudioContext || window.webkitAudioContext;
        var ctx = new C({ sampleRate: IN_RATE });
        RT.inCtx = ctx;
        if (ctx.state === "suspended") ctx.resume();
        var url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
        return ctx.audioWorklet.addModule(url).then(function () {
          URL.revokeObjectURL(url);
          var src = ctx.createMediaStreamSource(stream);
          var tap = new AudioWorkletNode(ctx, "rt-tap");
          tap.port.onmessage = function (ev) {
            sendFrame(ev.data);
          };
          /* 接到零增益节点：让 worklet 一定被调度，又不会把麦克风放出来 */
          var mute = ctx.createGain();
          mute.gain.value = 0;
          src.connect(tap);
          tap.connect(mute);
          mute.connect(ctx.destination);
          RT.srcNode = src;
          RT.tapNode = tap;
        });
      });
  }

  /* ---------------- 生命周期 ---------------- */
  function start(peer) {
    if (RT.active) stop();
    RT.peer = peer;
    RT.active = true;
    RT.greeted = false;
    RT.sentFrames = 0;

    if (GREETINGS[peer]) office.callReply(GREETINGS[peer]); // 同步占位，压掉内置兜底问候
    try {
      office.callVoice(false); // 关掉 v0 自带 TTS/聆听，避免与实时语音双路出声
    } catch (e) {}

    connect()
      .then(openMic)
      .then(function () {
        console.debug("[voice-rt] 语音已接通：", peer);
      })
      .catch(function (e) {
        console.error("[voice-rt] 启动失败", e);
        office.say(peer, "语音接通失败：" + (e && e.message ? e.message : e));
        stop();
      });
  }

  function stop() {
    RT.active = false;
    RT.greeted = false;
    stopPlayback();
    try {
      if (RT.tapNode) RT.tapNode.port.onmessage = null;
    } catch (e) {}
    try {
      if (RT.micStream)
        RT.micStream.getTracks().forEach(function (t) {
          t.stop();
        });
    } catch (e) {}
    try {
      if (RT.inCtx && RT.inCtx.state !== "closed") RT.inCtx.close();
    } catch (e) {}
    try {
      if (RT.ws && RT.ws.readyState <= 1) RT.ws.close();
    } catch (e) {}
    RT.ws = null;
    RT.inCtx = null;
    RT.micStream = null;
    RT.srcNode = null;
    RT.tapNode = null;
    RT.peer = null;
  }

  function sendText(text) {
    var ws = RT.ws;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "text", text: String(text) }));
  }

  /* ---------------- 挂载 ---------------- */
  var ok = office.registerExtension({
    id: "voice-glm-realtime",
    /* kind ∈ start / user / end，由 office3d.js 的 callFire() 广播 */
    onCallEvent: function (peer, kind, text) {
      if (kind === "start") start(peer);
      else if (kind === "end") stop();
      else if (kind === "user" && text) sendText(text);
    },
  });
  if (!ok) console.warn("[voice-rt] 扩展注册失败（id 重复？）");
  else console.debug("[voice-rt] 已挂到 __office.registerExtension，通话时自动接管语音");

  /* 调试 / 自测句柄：控制台里可直接 __voiceRT.start("geometry") / .stop() / .stats() */
  window.__voiceRT = {
    start: start,
    stop: stop,
    sendText: sendText,
    stats: function () {
      return {
        active: RT.active,
        peer: RT.peer,
        wsState: RT.ws ? RT.ws.readyState : -1,
        sentFrames: RT.sentFrames,
        sentSec: Math.round(RT.sentFrames) / 10,
        playedBytes: RT.playedBytes || 0,
        playedSec: Math.round(((RT.playedBytes || 0) / 2 / OUT_RATE) * 10) / 10,
        pendingVoices: RT.voices.length,
        interrupts: RT.interrupts || 0,
        droppedSec: RT.droppedSec || 0,
      };
    },
  };
})();
