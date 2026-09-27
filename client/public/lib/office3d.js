/* =====================================================================
   3DP Agent —— Agent 办公室 3D 场景
   Three.js 正交等轴测 / 卡通渲染 + 描边 / 程序化角色
   对外接口（挂在 window.__office，供宿主页 / iframe 嵌入方调用）：
     setAgent(k, status)   状态灯（P0-2 八态）：
                           idle | running | done | error | waiting | report |
                           recalibrating | debating（后两者复用 running 动作）
                           优先级 error > waiting > running > report > done > deepIdle，
                           低优先级不得覆盖高优先级；error/waiting/report 有保鲜期，
                           到期或 clearAgent(k) 后自动释放
     clearAgent(k)         显式清除某角色的高优先级状态（立刻回 idle）
     setLeisure(on) / leisure()
                           深空闲（deepIdle）氛围开关：等价 URL 参数 ?leisure=0
     setConsensus(s)       共识分：0~100
     reset()               回到初始待机
     setView(name) / nextView() / views()
                           机位：iso | top | print | front | gym | pantry | desks
                           （front = 3D 打印机正面，看 Agent 在机器前的作业动作）
     setLights(mode) / getLights() / lightInfo()
                           照明：on | off（不传参 = 切换）
     camera()              相机快照：机位 / 自由环绕角度 / 缩放 / 雾距 / 取景半高（自动化探针用）
     orbit(dx, dy) / zoom(f)
                           程序化环绕 / 缩放（等价一次鼠标拖拽 / 滚轮），返回 camera() 快照
     walls()               可透视墙分组：北墙 / 西墙的淡出透明度（自由环视用）
     card()                信息卡快照：悬停对象 / 锁定对象 / 是否带锁定样式（点击锁卡探针）
     鼠标：按住拖拽 = 360° 自由环绕（含绕到墙外自动透视）；滚轮 / 捏合 = 推拉缩放；
           单击可锁定物件信息卡，再次单击或 Esc 解锁；1-7 / V / L 为机位 / 灯光快捷键
     hud(show)             显示 / 隐藏页内 HUD（等价 URL 参数 ?hud=0 关闭）
     roster()              五名角色的坐标 / 朝向 / 动作（调试与巡检用）
     audit()               场景自检：网格数 / 角色数 / 当前机位与灯光
     flowPulse(k[, tag]) / flows() / setFlows(on) / flowClear()   （P1-6 数据流线）
                           角色产出 / 异常流向的流光可视化：手动点亮一条 / 只读快照 /
                           总开关 / 立即清空；角色状态迁移到 done · error 时自动点亮
   本文件零外部依赖（只 import 同目录 three.module.min.js），可被任意页面 iframe 引用。
   ===================================================================== */

import * as THREE from "/lib/three.module.min.js";

/* ---------------- 常量 ---------------- */
const ROOM = 12, WALL_H = 3.0, CX = 6, CZ = 6;
/* 角色微观质感贴图缓存（皮肤/面料/发丝），定义在顶部避免 TDZ */
const GRAIN_TEX = {};

/* =====================================================================
   配置中心：所有可调参数集中在这里（唯一入口）
   场景要继续升级 / 插件化时，优先改这里，不要在业务代码里散落魔法数字
   ===================================================================== */
const CONFIG = {
  /* 默认机位：抬高俯角（30° 级）避免家具挡住角色；视野范围由 layout() 自动算，一屏看全 */
  camera:    { dist: 15.5, elev: 0.545, lookY: 1.15,
               fitPad: 1.07, minHalfH: 5.4, maxHalfH: 17.0, zoom: 1 },
  /* 预设机位 + 灯光：HUD 上的「视角 / 灯光」两组控件都由这里驱动
     （增删机位只改 VIEWS，开关入口无需改动） */
  views:     { enabled: true,     // false = 完全不注入 HUD 控件；外部嵌入也可用 ?hud=0 单独关闭
               def: "iso",        // 默认机位：与旧版取景完全一致的等距全景
               tween: 0.75,       // 机位切换缓动时长（秒）
               keys: true },      // 数字键 / V / L 快捷键
  /* 鼠标自由视角（P0-4）：拖拽环绕 + 滚轮缩放
     · 拖拽只改"当前机位"的 azim / elev，不写回 VIEWS 预设；按 HUD / 数字键 / V
       立刻缓动回预设机位（自由角度不污染预设，既有自动切换与会诊运镜照旧）
     · 正交相机"推拉不改变成像大小"，所以滚轮改的是 zoomK（取景半高缩放系数）：
       zoomK > 1 = 画面放大、< 1 = 拉远；与全局固定倍率 camera.zoom 相互独立
     · azim 全 360° 开放：相机绕到北墙 / 西墙外侧时自动淡出该实心墙（见"可透视墙"区），
       任何角度都能看清室内，不存在被墙挡死的死角
     · elev 夹在 [minElev, maxElev]：既不会钻到地板下，也避开正上方的 lookAt 奇异点 */
  controls:  { enabled: true,
               orbit: 0.0068,       // 拖拽灵敏度（弧度 / 像素）
               invertY: false,      // true = 上下反向（习惯"向上拖 = 抬高机位"的可开）
               minElev: 0.07, maxElev: 1.42,
               zoomStep: 0.0015,    // 滚轮 / 捏合灵敏度（每像素的比例变化）
               minZoomK: 0.55, maxZoomK: 3.20,
               zoomLerp: 12,        // 缩放追帧速度（越大越跟手）
               dragGate: 5,         // 位移超过该像素数判定为"拖拽"，不再当作点击锁卡
               wallFade: 0.90,      // 墙淡出过渡带（世界单位）：相机越过墙面后这段距离内由实心渐变到全透视
               wallBand: 0.42 },    // 贴墙带宽度：世界坐标 z/x 落在此带内的网格视为"墙面装配"，随墙一起淡出
  lights:    { def: "off",        // off = 跟随日夜与天气的夜色氛围（旧行为）；on = 明亮办公室照明
               tween: 1.10 },     // 灯光切换过渡时长（秒）
  character: { bodyR: 0.20, roleGap: 0.70, seatDrop: 0.50,
               /* 坐姿落地求解（局部单位，随身高缩放）：
                  seatTop   —— 工位椅座面顶的世界高度（与 makeChair 保持一致）
                  hipLocal  —— 髋关节在角色局部坐标里的高度（torso.y 1.00 + leg.y -0.02）
                  thighDrop —— 大腿放平时髋到膝的垂直落距（0.46 * cos(1.50)）
                  shinLen   —— 膝到鞋底的竖直长度（小腿 0.455 + 鞋底 0.033） */
               seatTop: 0.50, hipLocal: 0.98, thighDrop: 0.0326, shinLen: 0.488,
               standGap: 0.032 },
  /* 头部外观：发壳/帽壳"面部让位"参数
     发球原本完整包住头骨，正面射线先命中发壳再命中眼球 → 所有角色只剩嘴露在外面。
     把发壳在 Z 向压扁并后移，额头/眉/眼/鼻梁即从发际线以下露出；改这两个值可整体调发际线。 */
  head:      { hairFrontSquash: 0.86, hairFrontShift: 0.032,   // 发壳前面压扁+后移，避免遮住眉眼
               beanieEdgeTheta: 0.34, beanieBrimY: 0.080, beanieBrimR: 0.130,
               headbandTilt: 0.30 },
  bubble:    { life: 3.0, fadeIn: 0.35, fadeOut: 0.75, talkGap: 2.3,
               headY: 2.30, maxWidth: 210, opacity: 0.88 },
  locale:    "zh-CN",                             // 场景 UI 文案（牌子 / 提示条）
  chatLocale: "en-US",                            // 对话气泡文案：先美式英语，可切换
};

/* ---------------- 文案（i18n）：默认美式英语，可运行时切换 ---------------- */
const I18N = {
  "en-US": {
    printer: { big: "Industrial 3D Printer", desk: "Desktop 3D Printer",
               idle: "Idle", upload: "Receiving model…", printing: "Printing",
               done: "Print complete", hint: "Hover / click for status",
               batch: "Batch", part: "part", noTask: "No job queued" },
    /* P0-3：悬停信息卡文案（八态名称 + 卡片行标签） */
    state: { idle: "Idle", running: "Running", done: "Done", error: "Error",
             waiting: "Awaiting confirmation", report: "Filing report",
             recalibrating: "Recalibrating", debating: "Cross-checking",
             deepIdle: "Off-duty" },
    card: { phase: "Phase", progress: "Progress", confidence: "Confidence",
            digest: "Latest output", material: "Material", spool: "spool left",
            nozzle: "Nozzle", bed: "Build plate", chamber: "Chamber",
            layers: "Layers printed", remain: "Time left", layerH: "Layer height",
            batch: "Batch", source: "Machine", none: "not reported",
            whereChamber: "Part on the build plate", whereHeld: "Carried part",
            whereSample: "Round-two sample on the desk",
            pinned: "Pinned · click to release", call: "Call" },
    /* calling v0：文字通话文案（{name} 为占位符，由调用处替换） */
    call: {
      title: "On call", placeholder: "Type a message…", send: "Send", hangup: "Hang up",
      start: "Call connected · {name}", end: "Call ended",
      hello: ["Here, go ahead.", "I'm listening.", "Yes, what do you need?"],
      ack: ["Got it, noted.", "Understood, let me take a look.", "Copy that, on it."],
      noPeer: "Role not on stage",
      /* calling v1：语音（TTS 播报 + 语音识别）文案 */
      voice: "Voice", voiceOn: "Voice on", voiceOff: "Voice off",
      ptt: "Hold to talk", listening: "Listening…",
      ttsFail: "Voice playback unavailable — replies stay text",
      srUnavailable: "Speech recognition unavailable — type instead",
      micDenied: "Microphone blocked — typing still works"
    },
    /* P1-c 导览流程文案（讲解词为数组时每次随机取一条，{n} 由调用处替换） */
    tour: {
      start: "Tour started · {n} visitor(s)", end: "Tour ended",
      visitorName: "Visitor", visitorRole: "Guest",
      welcome: ["Welcome aboard — let me walk you through the studio.",
                "Glad to have you here. Follow me and I'll show you around."],
      pantry: ["This is the pantry — coffee and drinks are always on.",
               "Pantry's right here; the team refuels between print runs."],
      desks: ["Four stages sit here — geometry, printability, failure, optimization.",
              "These desks run the four-stage pipeline on every model."],
      printBig: ["And here's the industrial printer — dual hopper, live build chamber.",
                 "This is our main machine; watch the chamber while it runs."],
      gym: ["Small gym here — the best way to reset between long builds.",
            "We keep a gym on site; people stretch while parts print."],
      qa: ["Any questions so far? I can pull the live numbers for you.",
           "Happy to go deeper on any stage you're curious about."],
      bye: ["That's the full loop — thanks for coming by.",
            "That wraps the tour. Safe travels!"],
      waitHuddle: "Waiting for the huddle to finish…"
    },
    tip: {
      bigPrinter:  { title: "Industrial 3D Printer", desc: "Dual-hopper FDM · visible build chamber" },
      deskPrinter: { title: "Desktop 3D Printer",    desc: "Compact FDM · live chamber view" },
      reportTray:  { title: "Report Tray",   desc: "Finished reports get dropped here" },
      faultBeacon: { title: "Fault Beacon",  desc: "Turns red while a stage is in error" }
    },
    say: {
      running: { geometry: "Tracing the mesh topology…",
                 printability: "Checking overhangs and wall thickness…",
                 failure: "Listing possible failure modes…",
                 optimization: "Drafting the optimization plan…",
                 coordinator: "Alright team — syncing all four stages." },
      done:    { geometry: "Geometry pass is clean.",
                 printability: "Printability checks all passed.",
                 failure: "Failure analysis is done.",
                 optimization: "Optimization plan is ready.",
                 coordinator: "Consensus reached. Good work, everyone." },
      error:   { geometry: "Hit a snag on the mesh. Re-running.",
                 printability: "Thin wall detected — flagging it.",
                 failure: "Something failed. Give me a minute.",
                 optimization: "Plan needs another pass.",
                 coordinator: "We have an issue — holding the print." },
      waiting: { geometry: "Need your call on the tolerance band.",
                 printability: "Waiting for your go-ahead to print.",
                 failure: "Confirm the risk threshold first?",
                 optimization: "Which plan should I take?",
                 coordinator: "Holding here — need your confirmation." },
      report:  { geometry: "Geometry report is filed.",
                 printability: "Printability report is filed.",
                 failure: "Failure report is filed.",
                 optimization: "Optimization report is filed.",
                 coordinator: "Summary report is on the tray." },
      recalibrating: { geometry: "Re-calibrating the caliper…",
                 printability: "Re-zeroing the slicer profile…",
                 failure: "Re-running the risk model…",
                 optimization: "Re-fitting the wall thickness…",
                 coordinator: "Re-syncing the stage chain…" },
      debating: { geometry: "Cross-checking the mesh with the team…",
                 printability: "Comparing print strategies with the team…",
                 failure: "Debating severity with the team…",
                 optimization: "Aligning the fix with the team…",
                 coordinator: "Let's talk this through before we commit." },
      consensus: "Gathering around the holo-table…"
    },
    hud: {
      viewCap: "View", lightCap: "Light", on: "On", off: "Off",
      hint: "1-7 / V / L · drag to orbit",
      view: { iso: "Isometric overview", top: "Top-down overview",
              print: "Print farm", front: "Printer front",
              gym: "Gym", pantry: "Pantry & coffee bar",
              desks: "Workstations" },
      lightsOn: "Office lights on", lightsOff: "Night ambience (lights off)"
    },
    /* P1-5 点击角色聚焦：顶部提示条文案（{name} 由 focusCue() 就地替换） */
    focus: {
      cue: "Focused on {name} · click empty space or press Esc to exit",
      exit: "Esc to exit"
    },
    chat: {
      threads: [
        ["Morning! How's the new build holding up?",
         "Solid — the enclosure printed clean overnight.",
         "Nice. I'll re-check the wall thickness before we queue it.",
         "Cool, ping me when it's done."],
        ["Did the failure analysis come back clean?",
         "Two minor risks, both low severity.",
         "Good. Flag them in the log anyway.",
         "Already done."],
        ["Any blockers on the impeller revision?",
         "One thin spot right next to the boss.",
         "Want me to thicken that rib?",
         "Please do — I'll hold the print run."],
        ["The printer's mid-run on batch three.",
         "I'll grab the finished parts in a minute.",
         "Mind measuring them before you log it?",
         "On it."]
      ]
    }
  },
  "zh-CN": {
    printer: { big: "大型工业打印机", desk: "桌面 3D 打印机",
               idle: "待机", upload: "接收模型…", printing: "打印中",
               done: "打印完成", hint: "悬停 / 点击查看状态",
               batch: "批次", part: "第", noTask: "暂无任务" },
    /* P0-3：悬停信息卡文案（八态名称 + 卡片行标签） */
    state: { idle: "空闲", running: "运行中", done: "已完成", error: "异常",
             waiting: "待确认", report: "出报告", recalibrating: "重新校准",
             debating: "内部研讨", deepIdle: "深空闲" },
    card: { phase: "阶段", progress: "进度", confidence: "置信度",
            digest: "输出摘要", material: "材料", spool: "料卷余量",
            nozzle: "喷嘴温度", bed: "热床温度", chamber: "舱温",
            layers: "已打印层", remain: "剩余时长", layerH: "层高",
            batch: "批次", source: "来源设备", none: "未采集",
            whereChamber: "热床上的打印件", whereHeld: "手中的打印件",
            whereSample: "工位上的二次分析样品",
            pinned: "已锁定 · 点击解锁", call: "通话" },
    /* calling v0：文字通话文案（{name} 为占位符，由调用处替换） */
    call: {
      title: "通话中", placeholder: "输入消息…", send: "发送", hangup: "挂断",
      start: "已接通 · {name}", end: "通话已结束",
      hello: ["我在，请讲。", "在的，您说。", "收到，我在听。"],
      ack: ["收到，我记下了。", "明白，我看一下。", "好的，马上处理。"],
      noPeer: "该角色不在场",
      /* calling v1：语音（TTS 播报 + 语音识别）文案 */
      voice: "语音", voiceOn: "语音已开", voiceOff: "语音已关",
      ptt: "按住说话", listening: "正在聆听…",
      ttsFail: "语音播报不可用，回话仅显示文字",
      srUnavailable: "本浏览器不支持语音识别，已降级为文字输入",
      micDenied: "麦克风权限被拒，已切回文字输入（通话不受影响）"
    },
    /* P1-c 导览流程文案（讲解词为数组时每次随机取一条，{n} 由调用处替换） */
    tour: {
      start: "导览开始 · {n} 位访客", end: "导览结束",
      visitorName: "访客", visitorRole: "来访客户",
      welcome: ["欢迎光临，我带你转一圈。", "很高兴见到你，跟我来，我给你介绍下这边。"],
      pantry: ["这里是茶水间，咖啡饮料随时取。", "茶水间在这边，打印间歇大家会来续杯。"],
      desks: ["这四张工位负责四道工序：几何、可打印性、失效、优化。",
              "工位区就在这里，每个模型都要跑这四道工序。"],
      printBig: ["这里是工业级打印机，双料仓、舱内实时可见。",
                 "这台是主力设备，运行时可以看舱内成型过程。"],
      gym: ["这边是健身房，长时间盯机后来活动一下。", "办公室配了健身房，打印时可以来拉伸。"],
      qa: ["看到这里有什么想了解的？我可以拉实时数据给你。",
           "哪个环节想听细一点，我展开说。"],
      bye: ["一圈转完了，感谢来访。", "参观到此结束，路上顺利！"],
      waitHuddle: "正在等会诊结束…"
    },
    tip: {
      bigPrinter:  { title: "大型工业级 3D 打印机", desc: "双料仓 FDM · 可视舱内作业" },
      deskPrinter: { title: "桌面 3D 打印机",       desc: "小型 FDM · 实时舱内可视" },
      reportTray:  { title: "文件托盘",             desc: "完成的报告放到这里" },
      faultBeacon: { title: "故障指示灯",           desc: "工序出错时亮起红灯" }
    },
    say: {
      running: { geometry: "正在解析网格拓扑…", printability: "正在检查悬垂与最小壁厚…",
                 failure: "正在枚举失效模式…", optimization: "正在生成优化方案…",
                 coordinator: "大家同步一下，四道工序一起过。" },
      done:    { geometry: "几何体检没问题。", printability: "可打印性检查全部通过。",
                 failure: "失效分析已完成。", optimization: "优化方案已经出好了。",
                 coordinator: "共识达成，各位辛苦。" },
      error:   { geometry: "网格这里有问题，我再看一遍。", printability: "发现薄壁，先标出来。",
                 failure: "这条流程挂了，稍等。", optimization: "方案还要再跑一遍。",
                 coordinator: "这里有问题，先暂停打印。" },
      waiting: { geometry: "公差带要你拍个板。", printability: "等你确认了再排队打印。",
                 failure: "风险阈值先确认一下？", optimization: "两个方案你挑一个？",
                 coordinator: "先停在这里，需要你确认。" },
      report:  { geometry: "几何报告已放上托盘。", printability: "可打印性报告已归档。",
                 failure: "失效分析报告已归档。", optimization: "优化方案报告已归档。",
                 coordinator: "汇总报告放托盘了。" },
      recalibrating: { geometry: "卡尺重新校零中…", printability: "重新标定切片参数…",
                 failure: "风险模型重新跑一遍…", optimization: "壁厚重新拟合中…",
                 coordinator: "四道工序重新同步…" },
      debating: { geometry: "和同事对一下网格口径…", printability: "和同事比一下打印策略…",
                 failure: "和同事讨论风险等级…", optimization: "和同事对齐改模方案…",
                 coordinator: "先把话说清楚再动手。" },
      consensus: "都到全息台这边来…"
    },
    hud: {
      viewCap: "视角", lightCap: "灯光", on: "开灯", off: "关灯",
      hint: "1-7 / V / L · 拖拽旋转",
      view: { iso: "等距全景", top: "俯瞰全景", print: "打印区特写",
              front: "打印机正面", gym: "健身区特写",
              pantry: "茶水间特写", desks: "工位区" },
      lightsOn: "打开办公室照明", lightsOff: "夜色氛围（关灯）"
    },
    /* P1-5 点击角色聚焦：顶部提示条文案（{name} 由 focusCue() 就地替换） */
    focus: {
      cue: "已聚焦 {name} · 点击空白处或按 Esc 退出",
      exit: "按 Esc 退出"
    },
    chat: {
      threads: [
        ["早，新版结构稳住了吗？", "稳了，外壳昨晚打得很干净。", "好，那我先复核壁厚再排队打印。", "行，好了叫我。"],
        ["失效分析结果干净吗？", "两个小风险，等级都很低。", "好，记得记进日志。", "已经记好了。"],
        ["叶轮改版卡住了吗？", "凸台旁边有一处偏薄。", "要我加厚那条筋吗？", "麻烦你了，我先不排队打印。"],
        ["大机器已经打到第三批了。", "我一会儿去取成品件。", "取之前顺手量一下尺寸？", "没问题。"]
      ]
    }
  }
};
let LOCALE = CONFIG.locale;                    // 场景 UI 文案（牌子 / 提示条）
let CHAT_LOCALE = CONFIG.chatLocale;           // 角色对话气泡文案（默认美式英语）

/** 取文案：支持 "a.b.c" 点路径，缺省回落到 en-US，再回落到 key 本身 */
function pickLocale(loc, key){
  const dict = I18N[loc];
  if (!dict) return null;
  let cur = dict;
  const parts = String(key).split(".");
  for (let i = 0; i < parts.length; i++){
    cur = cur[parts[i]];
    if (cur == null) return null;
  }
  return cur;
}
/* UI 文案（牌子 / 提示条）：跟随 LOCALE */
function t(key){
  const v = pickLocale(LOCALE, key);
  if (v != null) return v;
  const fb = pickLocale("en-US", key);
  return fb != null ? fb : key;
}
/* 角色对话文案（气泡）：默认美式英语，可独立切换 */
function tChat(key){
  const v = pickLocale(CHAT_LOCALE, key);
  if (v != null) return v;
  const fb = pickLocale("en-US", key);
  return fb != null ? fb : key;
}
/* 随机取一条对话线：优先用指定语种的线程池 */
function chatThread(){
  const pool = pickLocale(CHAT_LOCALE, "chat.threads") || pickLocale("en-US", "chat.threads");
  if (!pool || !pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------------- 3D 浮牌 ----------------
   浮牌 = 场景里的 canvas 贴图牌子（打印机 title / progress）
   统一遵守"默认隐藏，只有悬停/点击对应物件时才显示"，可见性总闸在 refreshPlates() */

/* ---------------- 插件化扩展点 ----------------
   window.__office.registerExtension({
     id: "my-plugin",
     onTick(dt, t, api)            每帧；异常被隔离，不影响主循环
     onAgentStatus(k, status, api) Agent 状态变化时
     onConsensus(status, api)      共识台状态变化时
   })
   插件可透过 api = window.__office 反向调用 say / setLocale / config 等能力 */
const EXTENSIONS = [];
function registerExtension(ext){
  if (!ext || !ext.id || EXTENSIONS.some(e => e.id === ext.id)) return false;
  EXTENSIONS.push(ext);
  return true;
}
/* 插件钩子派发：透传任意个业务参数，末尾追加 window.__office 作为 API 句柄。
   旧调用 runExtensions(hook, a, b) 的行为不变（回调仍收到 a, b, api）。 */
function runExtensions(hook, ...args){
  for (let i = 0; i < EXTENSIONS.length; i++){
    const fn = EXTENSIONS[i][hook];
    if (typeof fn !== "function") continue;
    try { fn.apply(EXTENSIONS[i], args.concat(window.__office)); }
    catch (err){ console.warn("[office ext]", EXTENSIONS[i].id, hook, err); }
  }
}

const DESK_AT = {                    // 四张工位的中心位置 (x, z)
  geometry:     [3.3, 3.3],
  printability: [8.7, 3.3],
  failure:      [3.3, 8.7],
  optimization: [8.7, 8.7]
};

const PALETTE = {
  /* 体型系数：shoulder/chest/waist/armR/jaw/hip/face/soft
     —— 前五项沿用旧版；hip=胯宽、face=脸圆润度、soft=软肉感（BBW / 圆润体态） */
  geometry: {                                   // 韩日系帅大叔：精致侧分背头 + 藏青西装 + 酒红领带
    accent: 0x22d3ee, skin: 0xe8b98f, hair: 0x241a12, hair2: 0xa39a8d,
    outfit: "suit", cloth: 0x243a5e, cloth2: 0xf4efe4, pants: 0x1b2233,
    shirt: 0xf4efe4, tie: 0x7d2b34,
    height: 1.86, build: "m", hairStyle: "sidePart", shoes: 0x1a1f27,
    glasses: true, watch: true, stubble: true, belt: true, socks: 0x27303c,
    shoeStyle: "loafer", socksStyle: "no",
    iris: 0x3b2a1a, lip: 0xb9705f, brow: 0x2c1f14, blush: 0xf0c3a0,
    shoulder: 1.07, chest: 1.04, waist: 0.96, armR: 1.05, jaw: 0.92,
    hip: 1.00, face: 0.98, soft: 0
  },
  printability: {                               // 年轻韩系帅哥：黑 T 显肌肉 + 低位渐变 + 逗号刘海
    accent: 0x34d399, skin: 0xc98d5f, hair: 0x120d09, hair2: 0x3d3428,
    outfit: "tee", cloth: 0x15181e, cloth2: 0x2a3038, pants: 0x2f3a48,
    height: 1.85, build: "m", hairStyle: "taperFade", shoes: 0xe9edf2,
    headphones: true, watch: true, belt: true, socks: 0xdfe6ee, apron: true,
    shoeStyle: "sneaker", socksStyle: "high",
    iris: 0x241608, lip: 0x9c5b4a, brow: 0x140e08, blush: 0xdba980,
    shoulder: 1.13, chest: 1.08, waist: 1.02, armR: 1.15, jaw: 1.06,
    hip: 1.02, face: 1.00, soft: 0
  },
  failure: {                                    // 日系清爽青年：燕麦重磅卫衣 + 层次卷发 + 圆框眼镜
    accent: 0xfb923c, skin: 0xf0c9a0, hair: 0x4a3524, hair2: 0x7d5f40,
    outfit: "hoodie", cloth: 0xe6dcc8, cloth2: 0xe6dcc8, pants: 0x5d6650,
    height: 1.80, build: "m", hairStyle: "curl", shoes: 0x333c4a,
    roundGlasses: true, tote: true, socks: 0xe9e2d4,
    shoeStyle: "sneaker", socksStyle: "mid",
    iris: 0x4a3320, lip: 0xc07e6a, brow: 0x3d2b1c, blush: 0xf6d3b0,
    shoulder: 1.02, chest: 1.00, waist: 0.97, armR: 1.00, jaw: 0.98,
    hip: 1.00, face: 1.02, soft: 0
  },
  optimization: {                               // 银发帅大叔：狼尾层次 + 敞开亚麻衬衫 + 白 T
    accent: 0xa78bfa, skin: 0x8a5a3b, hair: 0xb4bac2, hair2: 0xeef2f6,
    outfit: "open", cloth: 0x707f8e, cloth2: 0xf3f5f7, pants: 0x2c3340,
    height: 1.84, build: "m", hairStyle: "wolfcut", shoes: 0x5b6472,
    chain: true, watch: true, stubble: true, belt: true,
    shoeStyle: "runner", socksStyle: "neon",
    iris: 0x2b1c10, lip: 0x8a4a3c, brow: 0x9aa3ad, blush: 0x9c6a48,
    shoulder: 1.06, chest: 1.03, waist: 0.99, armR: 1.06, jaw: 1.00,
    hip: 1.00, face: 1.00, soft: 0
  },
  coordinator: {                                // 可爱 BBW 女生：针织开衫 + 高腰阔腿裤 + 高马尾蝴蝶结
    accent: 0xf0abfc, skin: 0xdbaa86, hair: 0x3a2418, hair2: 0x7a5230,
    outfit: "cozy", cloth: 0xead9c4, cloth2: 0xd9899f, pants: 0x424a63,
    height: 1.62, build: "f", hairStyle: "ponytail", shoes: 0xf3f4f6,
    headband: true, bow: true, earrings: true, tote: true,
    shoeStyle: "loafer", socksStyle: "no",
    iris: 0x4a2f1c, lip: 0xc2705f, brow: 0x33200f, blush: 0xeb9d86,
    shoulder: 0.98, chest: 1.12, waist: 1.06, armR: 1.08, jaw: 0.88,
    hip: 1.10, face: 1.10, soft: 1.0
  }
};

/* 自由活动目的地：空闲时角色会自己去这些地方“自由发挥” */
const DEST = {
  /* 左墙（西墙 x≈0）：茶水间 + 健身房 */
  coffee:   [1.58, 4.55],    // 咖啡台前
  water:    [1.55, 3.15],    // 饮水机前
  sink:     [1.58, 6.25],    // 水槽前
  fridge:   [1.60, 7.30],    // 冰箱前
  pantry:   [1.62, 5.45],    // 茶水间中段
  treadmill:[1.48, 8.70],    // 跑步机前
  gym:      [1.98, 9.02],    // 健身房空地（避开壶铃）
  dumbbell: [1.60, 10.45],   // 哑铃架前
  bench:    [1.02, 11.72],   // 训练凳前（俯身划船位）
  kettle:   [1.45, 9.12],    // 壶铃前
  mat:      [1.80, 10.95],   // 瑜伽垫上

  board:    [5.60, 1.35],    // 白板（北墙）
  window:   [9.55, 1.45],    // 北窗
  podium:   [6.00, 3.35],    // 中央台前

  printerBig:  [9.95, 5.60], // 大型机前
  printerDesk: [9.95, 8.70]  // 桌面机前
};

/* =====================================================================
   可打印零件库：每台机器按批次打印不同零件，从 0 逐层长到 1
   每个 builder 返回一个自包含 Group（尺寸随意，由 normPart 归一化到高度 1）
   ===================================================================== */
const PART_LIB = {
  gear: { name: "直齿轮", h: 0.34, build: (mat) => {
    const g = new THREE.Group();
    part(g, new THREE.CylinderGeometry(0.30, 0.30, 0.30, 26), mat, [0, 0.15, 0], null, null, false);
    for (let i = 0; i < 16; i++){
      const a = (i / 16) * Math.PI * 2;
      part(g, new THREE.BoxGeometry(0.10, 0.30, 0.085), mat,
           [Math.sin(a) * 0.335, 0.15, Math.cos(a) * 0.335], [0, a, 0], null, false);
    }
    part(g, new THREE.TorusGeometry(0.285, 0.045, 8, 24), mat, [0, 0.30, 0], [1.57, 0, 0], null, false);
    part(g, new THREE.CylinderGeometry(0.10, 0.10, 0.33, 18), mat, [0, 0.165, 0], null, null, false);
    part(g, new THREE.CylinderGeometry(0.055, 0.055, 0.36, 14), toon(0x0b1016), [0, 0.18, 0], null, null, false);
    return g;
  } },
  bracket: { name: "桁架支臂", h: 0.44, build: (mat) => {
    const g = new THREE.Group();
    part(g, new THREE.BoxGeometry(0.60, 0.70, 0.10), mat, [0, 0.35, 0], null, null, false);
    part(g, new THREE.BoxGeometry(0.10, 0.62, 0.42), mat, [0.25, 0.34, 0.21], null, null, false);
    [-1, 1].forEach(s => {
      part(g, new THREE.BoxGeometry(0.045, 0.52, 0.09), mat, [s * 0.20, 0.42, 0.05], [0, 0, s * 0.52], null, false);
      part(g, new THREE.CylinderGeometry(0.055, 0.055, 0.13, 16), mat, [s * 0.19, 0.62, 0], null, null, false);
      part(g, new THREE.CylinderGeometry(0.030, 0.030, 0.14, 14), toon(0x0b1016), [s * 0.19, 0.62, 0], null, null, false);
    });
    part(g, new THREE.CylinderGeometry(0.075, 0.075, 0.10), mat, [0, 0.72, 0], null, null, false);
    return g;
  } },
  impeller: { name: "涡流叶轮", h: 0.46, build: (mat) => {
    const g = new THREE.Group();
    part(g, new THREE.CylinderGeometry(0.16, 0.20, 0.22, 20), mat, [0, 0.11, 0], null, null, false);
    part(g, new THREE.TorusGeometry(0.30, 0.035, 8, 22), mat, [0, 0.20, 0], [1.57, 0, 0], null, false);
    for (let i = 0; i < 7; i++){
      const a = (i / 7) * Math.PI * 2;
      part(g, new THREE.BoxGeometry(0.30, 0.24, 0.055), mat,
           [Math.sin(a) * 0.24, 0.22, Math.cos(a) * 0.24], [0, a + 0.42, 0], null, false);
    }
    part(g, new THREE.CylinderGeometry(0.055, 0.055, 0.30, 14), mat, [0, 0.30, 0], null, null, false);
    part(g, new THREE.CylinderGeometry(0.10, 0.10, 0.05), mat, [0, 0.46, 0], null, null, false);
    return g;
  } },
  vase: { name: "螺旋花瓶", h: 0.56, build: (mat) => {
    const g = new THREE.Group();
    for (let i = 0; i < 14; i++){
      const t = i / 13;
      const rr = 0.26 - Math.sin(t * Math.PI * 0.9) * 0.13;
      part(g, new THREE.TorusGeometry(rr, 0.032, 8, 22), mat, [0, 0.03 + t * 0.62, 0], [1.57, 0, 0], null, false);
    }
    part(g, new THREE.CylinderGeometry(0.115, 0.115, 0.05, 18), mat, [0, 0.01, 0], null, null, false);
    return g;
  } },
  housing: { name: "齿轮箱壳", h: 0.52, build: (mat) => {
    const g = new THREE.Group();
    part(g, new THREE.BoxGeometry(0.62, 0.44, 0.10), mat, [0, 0.24, -0.24], null, null, false);
    part(g, new THREE.BoxGeometry(0.62, 0.44, 0.10), mat, [0, 0.24, 0.24], null, null, false);
    [-1, 1].forEach(s => part(g, new THREE.BoxGeometry(0.10, 0.44, 0.40), mat,
         [s * 0.30, 0.24, 0], null, null, false));
    part(g, new THREE.BoxGeometry(0.72, 0.065, 0.62), mat, [0, 0.50, 0], null, null, false);
    part(g, new THREE.CylinderGeometry(0.11, 0.11, 0.10, 18), mat, [0, 0.55, 0], null, null, false);
    part(g, new THREE.CylinderGeometry(0.06, 0.06, 0.12, 14), toon(0x0b1016), [0, 0.55, 0], null, null, false);
    part(g, new THREE.BoxGeometry(0.09, 0.78, 0.30), mat, [0.34, 0.40, 0], null, null, false);
    return g;
  } },
  turbine: { name: "涡轮转子", h: 0.50, build: (mat) => {
    const g = new THREE.Group();
    part(g, new THREE.ConeGeometry(0.30, 0.46, 20), mat, [0, 0.23, 0], null, null, false);
    part(g, new THREE.CylinderGeometry(0.09, 0.09, 0.62, 16), mat, [0, 0.31, 0], null, null, false);
    for (let i = 0; i < 9; i++){
      const a = (i / 9) * Math.PI * 2;
      part(g, new THREE.BoxGeometry(0.055, 0.30, 0.24), mat,
           [Math.sin(a) * 0.21, 0.20, Math.cos(a) * 0.21], [0.35, a, 0], null, false);
    }
    part(g, new THREE.CylinderGeometry(0.16, 0.16, 0.05, 18), mat, [0, 0.62, 0], null, null, false);
    return g;
  } },
  hook: { name: "承力吊钩", h: 0.40, build: (mat) => {
    const g = new THREE.Group();
    part(g, new THREE.CylinderGeometry(0.075, 0.075, 0.34, 16), mat, [0, 0.17, 0], null, null, false);
    part(g, new THREE.TorusGeometry(0.19, 0.062, 10, 22), mat, [0, 0.50, 0], [0, 0, 0.9], null, false);
    part(g, new THREE.TorusGeometry(0.055, 0.022, 8, 16), mat, [0, 0.35, 0], [0, 0, 0], null, false);
    part(g, new THREE.CylinderGeometry(0.12, 0.12, 0.05, 18), mat, [0, 0.30, 0], null, null, false);
    return g;
  } },
  lattice: { name: "点阵立方", h: 0.42, build: (mat) => {
    const g = new THREE.Group();
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++)
          part(g, new THREE.BoxGeometry(0.155, 0.155, 0.155), mat,
               [x * 0.19, 0.21 + y * 0.19, z * 0.19], null, null, false);
    return g;
  } }
};

/* 每台机器的分批打印队列（打一批不同件） */
const PART_CYCLE = {
  big:  ["housing", "impeller", "turbine", "gear", "bracket"],
  desk: ["gear", "hook", "lattice", "vase"]
};

/* 归一化到「底面 y=0、总高 1」，方便按进度 scale.y 生长 */
function normPart(g){
  g.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(g);
  const h = Math.max(0.001, box.max.y - box.min.y);
  const w = new THREE.Group();
  g.position.y = -box.min.y;
  w.add(g);
  w.scale.setScalar(1 / h);
  return w;
}

/* =====================================================================
   家具碰撞体 + 绕行路由：角色永远不穿过桌子 / 机器 / 器械
   ===================================================================== */
const OBST = [];
function addObst(cx, cz, hw, hd, rot, tag, pad){
  OBST.push({ cx, cz, hw, hd, s: Math.sin(rot || 0), c: Math.cos(rot || 0),
              pad: pad == null ? 0.30 : pad, tag: tag || "f" });
}
function obstLocal(r, x, z){
  const dx = x - r.cx, dz = z - r.cz;
  return [dx * r.c - dz * r.s, dx * r.s + dz * r.c];
}
function obstWorld(r, lx, lz){
  return [r.cx + lx * r.c + lz * r.s, r.cz - lx * r.s + lz * r.c];
}
function insideObst(r, x, z){
  const p = obstLocal(r, x, z);
  return Math.abs(p[0]) <= r.hw + 0.04 && Math.abs(p[1]) <= r.hd + 0.04;
}
/* 线段 vs 家具矩形（Liang-Barsky，已带 pad） */
function segHits(r, ax, az, bx, bz){
  const p = obstLocal(r, ax, az), q = obstLocal(r, bx, bz);
  const x1 = -r.hw - r.pad, x2 = r.hw + r.pad, z1 = -r.hd - r.pad, z2 = r.hd + r.pad;
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dz = q[1] - p[1];
  const P = [-dx, dx, -dz, dz], Q = [p[0] - x1, x2 - p[0], p[1] - z1, z2 - p[1]];
  for (let i = 0; i < 4; i++){
    if (Math.abs(P[i]) < 1e-9){ if (Q[i] < 0) return null; }
    else {
      const t = Q[i] / P[i];
      if (P[i] < 0){ if (t > t1) return null; if (t > t0) t0 = t; }
      else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
  }
  return [t0, t1];
}
/* 逐段绕开家具：命中就贴着家具的角绕过去 */
function avoidSeg(ax, az, bx, bz){
  const out = [[ax, az]];
  let cx = ax, cz = az, guard = 0;
  while (guard++ < 10){
    let best = null, bestT = 2;
    for (let i = 0; i < OBST.length; i++){
      const r = OBST[i];
      if (insideObst(r, ax, az) || insideObst(r, bx, bz)) continue;
      const hit = segHits(r, cx, cz, bx, bz);
      if (hit && hit[0] > 1e-4 && hit[0] < bestT){ bestT = hit[0]; best = r; }
    }
    if (!best) break;
    const ex = best.hw + best.pad + 0.10, ez = best.hd + best.pad + 0.10;
    let cand = null, candCost = Infinity;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const w = obstWorld(best, sx * ex, sz * ez);
      if (OBST.some(o => o !== best && insideObst(o, w[0], w[1]))) return;
      const cost = Math.hypot(w[0] - cx, w[1] - cz) + Math.hypot(bx - w[0], bz - w[1]);
      if (cost < candCost){ candCost = cost; cand = w; }
    });
    if (!cand) break;
    out.push(cand); cx = cand[0]; cz = cand[1];
  }
  out.push([bx, bz]);
  return out;
}
/* 完整路径：先绕中央台，再逐段绕家具 */
function pathPoints(ax, az, bx, bz){
  const base = routeVia(ax, az, bx, bz);
  const pts = [];
  for (let i = 0; i < base.length - 1; i++){
    const seg = avoidSeg(base[i][0], base[i][1], base[i + 1][0], base[i + 1][1]);
    for (let j = 0; j < seg.length - 1; j++) pts.push(seg[j]);
  }
  pts.push(base[base.length - 1]);
  return pts;
}

/* ---------------- 渲染器 / 场景 / 相机 ---------------- */
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoftShadowMap 高版本已废弃，避免升级告警
renderer.localClippingEnabled = true;   // 舱内打印件逐层生长用裁切面实现
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.78;

const scene = new THREE.Scene();
(function bg(){
  const c = document.createElement("canvas");
  c.width = 8; c.height = 128;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0.00, "#1b2b3c");
  g.addColorStop(0.45, "#101a24");
  g.addColorStop(1.00, "#06090d");
  x.fillStyle = g; x.fillRect(0, 0, 8, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
})();
scene.fog = new THREE.Fog(0x0a0f15, 42, 74);

const CAM = CONFIG.camera;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 140);

/* =====================================================================
   预设机位（VIEWS）：HUD / 快捷键 1-6 / __office.setView() 三处共用同一份定义
   ---------------------------------------------------------------------
   每个机位由三部分组成：
     ① 球坐标机位：azim（方位角，从 +X 轴转向 +Z）、elev（俯角）、dist（水平半径系数）
     ② 注视点 look：为了适配正交取景，注视点取"取景盒中心"最稳（偏心会被裁切）
     ③ 取景盒 box + 半高区间 [minH, maxH] + pad：fitHalfHeight() 把 8 个角投到相机
        空间，反推"一屏装得下"的正交半高 —— 因此画布无论多宽多高（含 iframe 嵌入）
        都不会跑出画面或裁掉主体；特写机位就靠"小取景盒 + 放低的 minH"实现推近。
   注意：房间的北墙(z=0)/西墙(x=0)是整面实心墙。预设机位的注视点都落在室内，方位角在
        0°~90°（+X/+Z 象限）内即可；front 机位与鼠标自由环绕会把相机送到墙外侧，
        由"可透视墙"（WALLP）自动淡出挡在前面的那面墙，不会出现被墙挡死的死角。
   ===================================================================== */
const VIEW_ORDER = ["iso", "top", "print", "front", "gym", "pantry", "desks"];

/* 取景盒统一写成数组形式，方便机位之间做线性缓动 */
function boxOf(min, max){ return { min: min, max: max }; }
/* 整间房（含墙体 + 一点余量）：与旧版 FIT_BOX 完全一致 */
const ROOM_BOX = boxOf([-0.15, 0.0, -0.15], [ROOM + 0.15, WALL_H + 0.45, ROOM + 0.15]);
const FIT_BOX = new THREE.Box3(                       // 仅 audit() 自检继续沿用
  new THREE.Vector3(ROOM_BOX.min[0], ROOM_BOX.min[1], ROOM_BOX.min[2]),
  new THREE.Vector3(ROOM_BOX.max[0], ROOM_BOX.max[1], ROOM_BOX.max[2]));

const VIEWS = {
  /* 默认等距全景：数值与旧版机位/取景逐项一致 → 默认画面零回归 */
  iso:    { tag: "ISO",    azim: Math.PI / 4, elev: CAM.elev, dist: CAM.dist,
            look: [CX, CAM.lookY, CZ], box: ROOM_BOX,
            minH: CAM.minHalfH, maxH: CAM.maxHalfH, pad: CAM.fitPad },
  /* 俯瞰全景：抬到近垂直俯视，看整体动线（分区 / 桌椅 / 角色走位） */
  top:    { tag: "TOP",    azim: Math.PI / 4, elev: 1.30, dist: 22,
            look: [CX, 0.55, CZ], box: ROOM_BOX,
            minH: 2.60, maxH: 16.0, pad: 1.04 },
  /* 打印区特写：工业机 + 桌面机 + 取件工位（3DP 主题最核心的一区；x 向西放宽到 8.30
     以便「大型机前会诊」五人在同一取景内全员入画） */
  print:  { tag: "PRINT",  azim: 0.80, elev: 0.56, dist: 12,
            look: [10.20, 1.05, 7.10], box: boxOf([8.30, 0.0, 4.30], [12.15, 2.80, 9.90]),
            minH: 2.10, maxH: 9.0, pad: 1.02 },
  /* 打印机正面（P0-4 新增）：站在工位一侧正对两台机器的操作面，看 Agent 在机器前的
     投件 / 观察 / 等待 / 取件动作。azim = π 即沿 -X 方向正对机器正面（机器正面朝 -X）；
     相机被推到西墙外侧（x<0）由"可透视墙"自动淡出西墙，且抬到 8 单位以上，
     正好越过茶水间 / 工位的杂物，视线直达机器操作面（与 print 机位同取景盒同尺度）。 */
  front:  { tag: "FRONT",  azim: Math.PI, elev: 0.42, dist: 12,
            look: [10.20, 1.05, 7.10], box: boxOf([8.10, 0.0, 4.30], [12.15, 2.80, 9.90]),
            minH: 2.10, maxH: 9.0, pad: 1.02 },
  /* 健身区特写：跑步机 / 哑铃架 / 瑜伽垫 */
  gym:    { tag: "GYM",    azim: 0.72, elev: 0.52, dist: 11,
            look: [1.38, 0.95, 9.95], box: boxOf([0.00, 0.0, 7.70], [2.75, 2.70, 12.15]),
            minH: 1.90, maxH: 8.0, pad: 1.02 },
  /* 茶水间特写：咖啡台 / 饮水机 / 水槽 / 冰箱 */
  pantry: { tag: "PANTRY", azim: 0.72, elev: 0.50, dist: 11,
            look: [1.38, 1.00, 5.20], box: boxOf([0.00, 0.0, 2.80], [2.75, 2.80, 7.65]),
            minH: 1.90, maxH: 8.0, pad: 1.02 },
  /* 工位区：四张工位 + 中央共识台（中景） */
  desks:  { tag: "DESKS",  azim: Math.PI / 4, elev: 0.60, dist: 14,
            look: [CX, 1.05, CZ], box: boxOf([2.15, 0.0, 2.15], [9.85, 2.90, 9.85]),
            minH: 2.80, maxH: 12.0, pad: 1.02 }
};

/* 取一份可变更的机位参数（缓动过程中会被逐帧改写） */
function cloneView(v){
  return { tag: v.tag, azim: v.azim, elev: v.elev, dist: v.dist,
           look: v.look.slice(),
           box: { min: v.box.min.slice(), max: v.box.max.slice() },
           minH: v.minH, maxH: v.maxH, pad: v.pad,
           /* 自由缩放系数：正交相机"推拉不改成像大小"，放大只能改取景半高 */
           zoomK: v.zoomK == null ? 1 : v.zoomK };
}

let activeView = VIEWS[CONFIG.views.def] ? CONFIG.views.def : "iso";
const camNow = cloneView(VIEWS[activeView]);   // 当前生效机位（缓动中为插值结果）
let camTween = null;                           // { from, to, t, dur, prev }

/* 按 camNow 摆放正交相机，并重算视锥（画布尺寸变化时由 layout 复用） */
function applyCam(){
  const R = camNow.dist * Math.SQRT2;          // 水平半径：45° 机位下等价于旧版的 (dist, dist)
  camera.position.set(camNow.look[0] + R * Math.cos(camNow.azim),
                      camNow.look[1] + R * Math.tan(camNow.elev),
                      camNow.look[2] + R * Math.sin(camNow.azim));
  camera.lookAt(camNow.look[0], camNow.look[1], camNow.look[2]);
  camera.zoom = CAM.zoom;
  camera.updateMatrixWorld(true);
  layout();
  updateWalls();   // 相机绕到墙外侧 → 自动淡出挡在前面的那面墙
  updateFog();     // 雾距跟随相机距离外推（房间本体永不被雾吃掉）
}

/* 把当前取景盒的 8 个角投到相机空间，反推"一屏装得下"的正交半高 */
function fitHalfHeight(aspect){
  const v = new THREE.Vector3();
  let mx = 0, my = 0;
  const b = camNow.box;
  for (let i = 0; i < 8; i++){
    v.set(i & 1 ? b.max[0] : b.min[0],
          i & 2 ? b.max[1] : b.min[1],
          i & 4 ? b.max[2] : b.min[2]);
    v.applyMatrix4(camera.matrixWorldInverse);
    mx = Math.max(mx, Math.abs(v.x));
    my = Math.max(my, Math.abs(v.y));
  }
  const need = Math.max(my, mx / Math.max(0.2, aspect)) * camNow.pad;
  return Math.max(camNow.minH, Math.min(camNow.maxH, need));
}

let _layW = 0, _layH = 0;
function layout(){
  const w = canvas.clientWidth || 940;
  const h = canvas.clientHeight || 800;
  const a = w / h;
  /* zoomK：自由缩放的取景半高倍率（>1 放大）；预设机位恒为 1 → 取景与旧版逐项一致 */
  const VH = fitHalfHeight(a) / (camNow.zoomK || 1);
  camera.left = -VH * a; camera.right = VH * a;
  camera.top = VH;       camera.bottom = -VH;
  camera.updateProjectionMatrix();
  /* 只在画布尺寸真的变了才重建缓冲：自由缩放会逐帧调 layout，避免每帧重置 canvas */
  if (w !== _layW || h !== _layH){
    _layW = w; _layH = h;
    renderer.setSize(w, h, false);
  }
}

/* 切到某个预设机位：默认缓动过渡，instant=true 直接落位 */
function useView(name, opts){
  const v = VIEWS[name];
  if (!v) return { ok: false, error: "unknown view: " + name, views: VIEW_ORDER.slice() };
  /* P1-5：切预设机位 = 退出聚焦。这里保留相机（keepCam）不清回快照，让下面的机位缓动
     直接从"聚焦时的机位"平顺滑到目标预设，避免先跳回旧机位再飞过去的顿挫；
     顺手掐掉可能还在跑的"聚焦回程缓动"，避免两条通道抢同一份 camNow。未聚焦时零副作用。 */
  if (FOCUS.on) exitFocus({ keepCam: true });
  if (FOCUS.tween) FOCUS.tween = null;
  const prev = activeView;
  const instant = !!(opts && (opts.instant || opts.dur === 0));
  const dur = Math.max(0, instant ? 0 : ((opts && opts.dur != null) ? opts.dur : CONFIG.views.tween));
  activeView = name;
  /* 切预设机位 = 回到"预设跟随"：退出自由环绕、把自由缩放缓动回 1（预设取景零污染） */
  camFree = false;
  ctrl.zoomTarget = 1;
  if (dur <= 0.001){
    Object.assign(camNow, cloneView(v));
    camTween = null;
    applyCam();
    runExtensions("onView", name, prev);
  }else{
    camTween = { from: cloneView(camNow), to: cloneView(v), t: 0, dur: dur, prev: prev };
  }
  syncHud();
  return { ok: true, view: name, prev: prev };
}

function nextView(step){
  const i = VIEW_ORDER.indexOf(activeView);
  const n = VIEW_ORDER.length;
  return VIEW_ORDER[((i < 0 ? 0 : i) + (step || 1) + n) % n];
}

/* 每帧推进机位缓动（只有切换后的 0.x 秒内会真的做事） */
function updateView(dt){
  if (!camTween) return;
  const T = camTween;
  T.t += dt;
  let k = T.dur > 0 ? Math.min(1, T.t / T.dur) : 1;
  k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // easeInOutQuad
  const a = T.from, b = T.to;
  let dAz = b.azim - a.azim;
  while (dAz > Math.PI)  dAz -= Math.PI * 2;
  while (dAz < -Math.PI) dAz += Math.PI * 2;
  camNow.azim = a.azim + dAz * k;
  camNow.elev = a.elev + (b.elev - a.elev) * k;
  camNow.dist = a.dist + (b.dist - a.dist) * k;
  for (let i = 0; i < 3; i++){
    camNow.look[i]   = a.look[i] + (b.look[i] - a.look[i]) * k;
    camNow.box.min[i] = a.box.min[i] + (b.box.min[i] - a.box.min[i]) * k;
    camNow.box.max[i] = a.box.max[i] + (b.box.max[i] - a.box.max[i]) * k;
  }
  camNow.minH = a.minH + (b.minH - a.minH) * k;
  camNow.maxH = a.maxH + (b.maxH - a.maxH) * k;
  camNow.pad  = a.pad  + (b.pad  - a.pad)  * k;
  camNow.zoomK = a.zoomK + (b.zoomK - a.zoomK) * k;   // 自由缩放在切机位时缓动回 1
  applyCam();
  if (k >= 1){
    camTween = null;
    camNow.tag = b.tag;
    runExtensions("onView", activeView, T.prev);
  }
}

/* =====================================================================
   P0-4 鼠标自由视角：360° 环绕 + 滚轮缩放 + 可透视墙 + 自适应雾距
   ---------------------------------------------------------------------
   · 拖拽 = 绕注视点环绕（只改 camNow.azim / elev，绝不写回 VIEWS 预设）
   · 滚轮 / 捏合 = 缩放（camNow.zoomK：正交取景半高倍率，>1 放大；与 camera.zoom 独立）
   · 松手即停在自由角度；按 HUD / 数字键 / V 立刻缓动回预设机位（自动机位与会诊运镜照旧）
   ===================================================================== */
const ctrl = {
  drag: null,            // { id, x, y, sx, sy, orbiting, tip }：当前按下的指针
  zoomTarget: 1          // 缩放目标值，camNow.zoomK 每帧追上它
};
let camFree = false;     // true = 当前处于自由环绕角度（HUD 不再高亮任何机位）

function clampN(v, lo, hi){ return v < lo ? lo : (v > hi ? hi : v); }
function wrapAngle(a){
  while (a >  Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* 接管相机：缓动途中开始拖拽 / 滚轮时，先"就地冻结"当前插值结果，避免画面跳变 */
function beginOrbit(){
  if (camTween){
    camTween = null;
    camNow.tag = "FREE";
  }
  /* P1-5：聚焦缓动期间开始拖拽 → 聚焦缓动立刻让位（冻结在当下角度，聚焦态继续保留，
     退出聚焦时再统一还原机位）；聚焦态下拖拽视为"自由微调视角"，退出后仍回到进入前机位。 */
  if (FOCUS.tween) FOCUS.tween = null;
  if (FOCUS.on) FOCUS.free = true;
  if (!camFree){
    camFree = true;
    syncHud();
  }
  ctrl.zoomTarget = camNow.zoomK || 1;
}

/* 拖拽环绕：向右拖相机沿方位角正向绕（场景跟着手指走），向下拖抬高机位（与 OrbitControls 一致） */
function orbitBy(dx, dy){
  const c = CONFIG.controls;
  camNow.azim = wrapAngle(camNow.azim + dx * c.orbit);
  camNow.elev = clampN(camNow.elev + dy * c.orbit * (c.invertY ? -1 : 1), c.minElev, c.maxElev);
  applyCam();
}

function zoomBy(scale){
  const c = CONFIG.controls;
  beginOrbit();
  ctrl.zoomTarget = clampN(ctrl.zoomTarget * scale, c.minZoomK, c.maxZoomK);
}

/* 每帧把缩放平滑追到目标（机位缓动期间由 updateView 全权接管，避免两边打架） */
function updateControls(dt){
  if (!CONFIG.controls.enabled || camTween || FOCUS.tween) return;
  const z = camNow.zoomK || 1;
  if (Math.abs(ctrl.zoomTarget - z) < 5e-4) return;
  camNow.zoomK = z + (ctrl.zoomTarget - z) * Math.min(1, dt * CONFIG.controls.zoomLerp);
  applyCam();
}

/* ---------------- 可透视墙（自由环视 / front 机位） ----------------
   北墙(z≈0) 与西墙(x≈0) 是整面实心墙：相机一旦绕到墙外侧，室内会被整面墙糊住。
   场景搭完后按"贴墙带"收集两侧墙体及其依附件（窗 / 白板 / 踢脚线 …），相机越到
   墙外时整组淡出（半透明），回到室内侧自动恢复 —— 360° 环视没有死角。
   收集只在启动时做一次（此刻角色都还在工位，不会被误收）；墙保持 visible，
   淡出只用透明度，因此投影（castShadow）不随视角变化，光照始终一致。 */
const WALL_BAND = CONFIG.controls.wallBand;   // 贴墙带宽度：世界坐标 z / x 落在带内视为墙体装配
const WALL_EDGE = CONFIG.controls.wallFade;   // 淡出过渡带：相机越过墙面后这段距离内完成"实心 → 全透视"
const WALLP = { n: { alpha: 1, items: [] }, w: { alpha: 1, items: [] } };   // n=北墙(z) w=西墙(x)
const WALL_SEEN = new Set();

function collectWallAssembly(){
  const p = new THREE.Vector3();
  /* 角色（含随身件 / 气泡 / 工位屏幕）永不参与墙体淡出：他们可能走到贴墙带内，
     一旦被收进墙组，绕到墙外时角色会跟着变半透明 */
  const bodies = new Set();
  Object.keys(characters).forEach(k => bodies.add(characters[k].root));
  scene.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    if (o.userData.ceilingStrip || o.userData.noWallFade) return;
    for (let a = o; a; a = a.parent){ if (bodies.has(a)) return; }
    o.getWorldPosition(p);
    if (p.y < -0.6 || p.y > WALL_H + 0.20) return;                 // 地板 / 顶部灯带不在墙面带内
    if (Math.abs(p.z - 0) <= WALL_BAND) pushWallMesh(WALLP.n, o);
    else if (Math.abs(p.x - 0) <= WALL_BAND) pushWallMesh(WALLP.w, o);
  });
  return { n: WALLP.n.items.length, w: WALLP.w.items.length };
}

function pushWallMesh(g, mesh){
  if (WALL_SEEN.has(mesh)) return;
  WALL_SEEN.add(mesh);
  /* 描边壳与本体同父同几何：本体淡出时壳必须一起淡出，否则墙上残留一圈黑色剪影 */
  const sibs = (mesh.parent && mesh.parent.children) || [];
  const grp = [mesh];
  for (const s of sibs){
    if (s !== mesh && s.isMesh && s.geometry === mesh.geometry) grp.push(s);
  }
  for (const m of grp){
    if (WALL_SEEN.has(m) && m !== mesh) continue;
    WALL_SEEN.add(m);
    const mat = m.material.clone();
    const base = (mat.opacity == null) ? 1 : mat.opacity;
    mat.transparent = true;
    m.material = mat;
    m.userData.wallBaseOpacity = base;
    g.items.push(m);
  }
}

function setWallAlpha(g, camPlane){
  const a = clampN(camPlane / WALL_EDGE, 0, 1);    // 墙外侧 0（全透视）→ 内侧 1（实心）
  if (Math.abs(a - g.alpha) < 0.004) return;
  g.alpha = a;
  const solid = a > 0.999;
  for (const m of g.items){
    m.material.opacity = (m.userData.wallBaseOpacity || 1) * a;
    m.material.depthWrite = solid;                 // 半透明时停写深度，别挡住后方透明件
  }
}

/* 判据用"相机相对墙面的实际位置"而不是方位角符号：注视点都在室内，相机在室内侧
   就没有遮挡，墙不该淡出（按 iso 机位算相机落在 x≈32 / z≈32，两墙都是背景 → 实心）。
   预设机位水平半径 R = dist·√2 ≈ 17–37，远大于房间尺寸，因此相机通常落在室外某侧。 */
function updateWalls(){
  if (!CONFIG.controls.enabled) return;
  const R = camNow.dist * Math.SQRT2;
  setWallAlpha(WALLP.n, camNow.look[2] + R * Math.sin(camNow.azim));
  setWallAlpha(WALLP.w, camNow.look[0] + R * Math.cos(camNow.azim));
}

/* ---------------- 自适应雾距（修"俯视偏暗"） ----------------
   雾只负责压"房间之外的远景"。原实现把 near/far 固定成 42 / 74，是按 iso 机位
   相机距离（≈25）手调的：俯视机位相机距离 ≈118，整间房都被判成 100% 雾，画面
   几乎全是雾色（实测整帧均值亮度 21.6，iso 机位 47.6）。改成跟随"相机到注视点
   的距离 D"外推后，房间本体永远落在雾近端之外，任何机位（含自由环绕）都不会被雾吃掉。 */
function updateFog(){
  if (!scene.fog) return;
  const R = camNow.dist * Math.SQRT2;
  const D = R / Math.max(0.25, Math.cos(camNow.elev));   // 相机到注视点的真实距离
  scene.fog.near = D + 16;
  scene.fog.far  = D + 46;
}

applyCam();   // 首帧即按默认机位就位（applyCam 内含 layout()）

/* ---------------- 光照 ---------------- */
const hemi = new THREE.HemisphereLight(0xc4e0fa, 0x46586b, 1.5);
scene.add(hemi);
const amb = new THREE.AmbientLight(0x4a5c70, 0.55);
scene.add(amb);

const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
key.shadow.radius = 4;
key.position.set(16, 24, 11);
key.target.position.set(CX, 0, CZ);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 2; key.shadow.camera.far = 60;
const SS = 13;
key.shadow.camera.left = -SS; key.shadow.camera.right = SS;
key.shadow.camera.top = SS;   key.shadow.camera.bottom = -SS;
key.shadow.bias = -0.0011;
key.shadow.normalBias = 0.02;
scene.add(key, key.target);

const fill = new THREE.DirectionalLight(0x9cc4f0, 1.0);
fill.position.set(-11, 9, -7);
scene.add(fill);

/* 相机侧补光：把角色从暗背景里拉出来 */
const rim = new THREE.DirectionalLight(0xdcecff, 0.7);
rim.position.set(CX + 22, 14, CZ + 22);
rim.target.position.set(CX, 1, CZ);
scene.add(rim, rim.target);
/* 记下补光基准强度：开灯方案要按比例压暗这两盏冷色"天光补光"
   （室内灯点亮后，冷蓝天光不应该是主光），关灯时回到基准 → 旧画面零回归 */
const FILL_I0 = fill.intensity, RIM_I0 = rim.intensity;

/* ---------------- 卡通材质工具 ---------------- */
const GRAD = (() => {
  const data = new Uint8Array([64, 128, 190, 246]);
  const t = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  t.needsUpdate = true;
  return t;
})();

const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x05080c, side: THREE.BackSide });

/* 角色脚下的接触阴影（canvas 径向渐变） */
const BLOB_MAT = (function(){
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(64, 64, 3, 64, 64, 62);
  g.addColorStop(0.00, "rgba(0,0,0,0.62)");
  g.addColorStop(0.45, "rgba(0,0,0,0.30)");
  g.addColorStop(1.00, "rgba(0,0,0,0.00)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c), transparent: true,
    depthWrite: false, toneMapped: false
  });
})();

function toon(color, opts){
  return new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: GRAD }, opts || {}));
}

/** 往 parent 加一个部件；doOutline=false 时不生成描边壳 */
function part(parent, geo, mat, pos, rot, scl, doOutline){
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scl) m.scale.set(scl[0], scl[1], scl[2]);
  m.castShadow = true;
  m.userData.noOutline = true;
  parent.add(m);
  if (doOutline !== false){
    const o = new THREE.Mesh(geo, OUTLINE_MAT);
    o.position.copy(m.position);
    o.rotation.copy(m.rotation);
    o.scale.copy(m.scale).multiplyScalar(1.075);
    o.userData.noOutline = true;
    parent.add(o);
  }
  return m;
}

/* ---------------- 房间 ---------------- */
const floorMat = new THREE.MeshStandardMaterial({ color: 0x1d2a38, roughness: 0.86, metalness: 0.12 });
const floor = new THREE.Mesh(new THREE.BoxGeometry(ROOM, 0.14, ROOM), floorMat);
floor.position.set(CX, -0.07, CZ);
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(ROOM, 12, 0x35506c, 0x22364a);
grid.position.set(CX, 0.006, CZ);
grid.material.transparent = true;
grid.material.opacity = 0.55;
scene.add(grid);

/* 中央地毯（菱形） */
const rug = new THREE.Mesh(
  new THREE.CircleGeometry(2.7, 4),
  toon(0x24384c)
);
rug.rotation.x = -Math.PI / 2;
rug.rotation.z = Math.PI / 4;
rug.position.set(CX, 0.008, CZ);
rug.receiveShadow = true;
scene.add(rug);

/* 两面后墙 */
const wallMat = toon(0x2a3846);
const wallN = new THREE.Mesh(new THREE.BoxGeometry(ROOM, WALL_H, 0.16), wallMat);
wallN.position.set(CX, WALL_H / 2, 0);
wallN.receiveShadow = true; wallN.castShadow = true;
scene.add(wallN);
const wallW = new THREE.Mesh(new THREE.BoxGeometry(0.16, WALL_H, ROOM), wallMat);
wallW.position.set(0, WALL_H / 2, CZ);
wallW.receiveShadow = true; wallW.castShadow = true;
scene.add(wallW);

/* 墙脚线 */
const skirtMat = toon(0x3d5872);
const skN = new THREE.Mesh(new THREE.BoxGeometry(ROOM, 0.13, 0.06), skirtMat);
skN.position.set(CX, 0.065, 0.11); scene.add(skN);
const skW = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, ROOM), skirtMat);
skW.position.set(0.11, 0.065, CZ); scene.add(skW);

/* ---------------- 窗外：昼夜 + 天气 ---------------- */
const sky = {
  hour: 10, minute: 0, dayPhase: "morning", weather: "clear",
  weatherTimer: 14, t: 0, redraw: 0, views: [], patches: [], lastMin: -1
};
const WEATHER_BY_PHASE = {
  day:   [["clear", 3], ["sunny", 3], ["cloudy", 2], ["rain", 1]],
  night: [["clear", 3], ["cloudy", 2], ["rain", 1]]
};

function dayPhaseOf(h){
  if (h < 5)  return "night";
  if (h < 7)  return "dawn";
  if (h < 11) return "morning";
  if (h < 16) return "noon";
  if (h < 19) return "dusk";
  if (h < 21) return "evening";
  return "night";
}

function skyColors(){
  const ph = sky.dayPhase, w = sky.weather;
  let top, mid, bot;
  if (ph === "dawn")         { top = "#26406e"; mid = "#e0895f"; bot = "#f7c98d"; }
  else if (ph === "morning") { top = "#3f8ede"; mid = "#9ed0f4"; bot = "#e2f2ff"; }
  else if (ph === "noon")    { top = "#2a76cf"; mid = "#8ac6f2"; bot = "#d6ecff"; }
  else if (ph === "dusk")    { top = "#3b3f7d"; mid = "#e0805c"; bot = "#f4bd83"; }
  else if (ph === "evening") { top = "#101a3a"; mid = "#2b3a68"; bot = "#6b5a80"; }
  else                       { top = "#050a16"; mid = "#0d1830"; bot = "#1a2748"; }

  if (w === "sunny")  { top = "#2b7fe0"; mid = "#9fd2f6"; bot = "#e8f5ff"; }
  if (w === "cloudy") { top = "#5c6b7d"; mid = "#93a1b1"; bot = "#c3cdd8"; }
  if (w === "rain")   { top = "#313b48"; mid = "#556373"; bot = "#7f8d9c"; }
  if (ph === "night" || ph === "evening"){
    if (w === "cloudy") { top = "#0a1120"; mid = "#1a2537"; bot = "#2c3a52"; }
    if (w === "rain")   { top = "#080d16"; mid = "#151f2e"; bot = "#25313f"; }
    if (w === "sunny")  { top = "#060c1c"; mid = "#101c38"; bot = "#1f2d50"; }
  }
  return { top, mid, bot };
}

/* 把一段天空画到 2D 画布：太阳/月亮 + 云 + 星空 + 雨丝 + 远处楼群 */
function drawSky(ctx, W, H, seed, t){
  const col = skyColors();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.00, col.top);
  g.addColorStop(0.52, col.mid);
  g.addColorStop(1.00, col.bot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const night = (sky.dayPhase === "night" || sky.dayPhase === "evening");
  const w = sky.weather;

  if (night && (w === "clear" || w === "sunny")){
    for (let i = 0; i < 30; i++){
      const x = (i * 97 + seed * 41) % W, y = (i * 43 + seed * 17) % Math.round(H * 0.72);
      const tw = 0.4 + 0.6 * Math.sin(t * 1.7 + i * 1.3);
      ctx.fillStyle = "rgba(224,238,255," + (0.22 + 0.55 * tw).toFixed(3) + ")";
      ctx.fillRect(x, y, 2, 2);
    }
  }

  /* 太阳 / 月亮：按小时在窗内横向漂移 */
  const span = (sky.hour - 5 + 24) % 24;
  const sunX = W * (0.10 + 0.80 * Math.min(1, Math.max(0, span / 14))) * (seed % 2 ? 1 : 0.92);
  const sunY = H * (0.30 - 0.14 * Math.sin(Math.min(1, span / 14) * Math.PI));
  const showSun = !night && w !== "rain";
  const showMoon = night && w !== "rain" && w !== "cloudy";
  if (showSun || showMoon){
    const cx = showMoon ? W * (0.18 + ((sky.hour + 24 - 19) % 12) / 12 * 0.64) : sunX;
    const cy = showMoon ? H * 0.18 : sunY;
    const r = showMoon ? 9 : 13;
    const gc = ctx.createRadialGradient(cx, cy, 1, cx, cy, r * 3.6);
    gc.addColorStop(0.00, showMoon ? "rgba(226,236,255,0.85)" : "rgba(255,244,214,0.92)");
    gc.addColorStop(0.35, showMoon ? "rgba(190,210,255,0.30)" : "rgba(255,226,160,0.34)");
    gc.addColorStop(1.00, "rgba(255,255,255,0)");
    ctx.fillStyle = gc; ctx.beginPath(); ctx.arc(cx, cy, r * 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = showMoon ? "#eef3ff" : "#fff6dc";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    if (showMoon){
      ctx.fillStyle = "rgba(196,208,232,0.55)";
      ctx.beginPath(); ctx.arc(cx - 3, cy - 2, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 3.5, cy + 3, 1.9, 0, Math.PI * 2); ctx.fill();
    }
    if (showSun && w === "sunny"){
      ctx.strokeStyle = "rgba(255,246,214,0.34)"; ctx.lineWidth = 1.6;
      for (let i = 0; i < 10; i++){
        const a = (i / 10) * Math.PI * 2 + t * 0.06;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (r + 4), cy + Math.sin(a) * (r + 4));
        ctx.lineTo(cx + Math.cos(a) * (r + 15 + 4 * Math.sin(t + i)), cy + Math.sin(a) * (r + 15));
        ctx.stroke();
      }
    }
  }

  /* 云：晴/多云可见，飘动 */
  const cloudN = w === "rain" ? 5 : (w === "cloudy" ? 4 : (w === "sunny" ? 1 : 2));
  if (w !== "clear" || !night){
    for (let i = 0; i < cloudN; i++){
      const cw = 34 + (i % 3) * 12;
      const cx = ((i * 61 + seed * 23 + t * (5 + i)) % (W + cw * 2)) - cw;
      const cy = H * (0.16 + 0.13 * ((i * 7 + seed) % 4));
      const a = w === "rain" ? 0.55 : (w === "cloudy" ? 0.62 : 0.34);
      ctx.fillStyle = w === "rain" ? "rgba(126,140,156," + a + ")"
                    : night ? "rgba(56,72,100," + a + ")" : "rgba(248,252,255," + a + ")";
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw * 0.50, cw * 0.19, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + cw * 0.26, cy - cw * 0.08, cw * 0.34, cw * 0.16, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - cw * 0.24, cy + cw * 0.04, cw * 0.30, cw * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* 远处楼群剪影 */
  const base = H * 0.90;
  ctx.fillStyle = night ? "rgba(8,12,22,0.92)" : "rgba(58,74,96,0.55)";
  for (let i = 0; i < 9; i++){
    const bw = 12 + ((i * 13 + seed * 7) % 16);
    const bh = 16 + ((i * 29 + seed * 11) % 30);
    const bx = (i * (W / 9)) + ((seed * 5) % 8);
    ctx.fillRect(bx, base - bh, bw, bh + H * 0.1);
    if (night){
      ctx.fillStyle = "rgba(255,214,140,0.35)";
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++){
        if (((i + r * 3 + c * 5 + seed) % 3) === 0)
          ctx.fillRect(bx + 2 + c * 4, base - bh + 3 + r * 5, 2, 3);
      }
      ctx.fillStyle = "rgba(8,12,22,0.92)";
    }
  }

  /* 雨丝 */
  if (w === "rain"){
    ctx.strokeStyle = "rgba(196,214,236,0.55)"; ctx.lineWidth = 1.1;
    for (let i = 0; i < 46; i++){
      const x = (i * 37 + seed * 13) % W;
      const y = ((i * 53 + t * 260) % (H + 40)) - 20;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3.5, y + 12); ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fillRect(0, 0, W, H);
  }
  /* 玻璃反光 */
  ctx.fillStyle = "rgba(255,255,255,0.045)";
  ctx.beginPath(); ctx.moveTo(W * 0.05, H); ctx.lineTo(W * 0.42, 0);
  ctx.lineTo(W * 0.60, 0); ctx.lineTo(W * 0.23, H); ctx.closePath(); ctx.fill();
}

/* 阳光斜照进屋：地面上一块暖色光斑 */
function makeSunPatch(){
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "rgba(255,236,190,0.55)");
  g.addColorStop(1, "rgba(255,226,170,0.02)");
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(24, 0); x.lineTo(210, 0); x.lineTo(256, 256); x.lineTo(0, 256);
  x.closePath(); x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.4),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2;
  m.userData.noOutline = true;
  m.renderOrder = 1;
  return m;
}

function addWindow(axis, a, y, w, h, seed){
  const c = document.createElement("canvas");
  c.width = 256; c.height = 160;
  const ctx = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, fog: false }));
  if (axis === "z"){ m.position.set(a, y, 0.085); }
  else { m.position.set(0.085, y, a); m.rotation.y = Math.PI / 2; }
  m.userData.noOutline = true;
  scene.add(m);

  /* 窗框：外框 + 中梃 + 窗台 */
  const fm = toon(0x17222e);
  const up = axis === "z" ? "x" : "z";
  const put = (mesh, dx, dz) => {
    if (axis === "z") mesh.position.set(a + dx, y + dz, 0.10);
    else { mesh.position.set(0.10, y + dz, a + dx); mesh.rotation.y = Math.PI / 2; }
    mesh.castShadow = true; mesh.userData.noOutline = true; scene.add(mesh);
  };
  [h / 2 + 0.035, -h / 2 - 0.035].forEach(dy => put(new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.07, 0.09), fm), 0, dy));
  [w / 2 + 0.035, -w / 2 - 0.035].forEach(dx => put(new THREE.Mesh(new THREE.BoxGeometry(0.07, h + 0.07, 0.09), fm), dx, 0));
  put(new THREE.Mesh(new THREE.BoxGeometry(0.045, h, 0.07), fm), 0, 0);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.22, 0.06, 0.20), toon(0x24313f));
  sill.castShadow = true; sill.userData.noOutline = true;
  if (axis === "z") sill.position.set(a, y - h / 2 - 0.09, 0.13);
  else { sill.position.set(0.13, y - h / 2 - 0.09, a); sill.rotation.y = Math.PI / 2; }
  scene.add(sill);

  sky.views.push({ canvas: c, ctx, tex, seed: seed || 0 });
  return m;
}
addWindow("z", 9.60, 2.05, 2.60, 1.25, 3);
addWindow("z", 2.60, 2.05, 2.00, 1.25, 7);
addWindow("x", 2.60, 2.05, 1.80, 1.25, 5);

/* 两处地面的阳光斑（北窗 / 西窗） */
[[9.60, 2.30, 0], [2.30, 2.60, Math.PI / 2]].forEach(([px, pz, rz]) => {
  const patch = makeSunPatch();
  patch.position.set(px, 0.014, pz);
  patch.rotation.z = rz;
  scene.add(patch);
  sky.patches.push(patch);
});

/* 照明方案：off = 跟随日夜与天气的夜色氛围（旧行为）；on = 明亮偏暖的办公室照明
   on 方案不跟随时间/天气 —— 现实里"开灯"就是把室内光稳定拉到明亮档 */
let lightMode = CONFIG.lights.def === "on" ? "on" : "off";
let lightMix  = lightMode === "on" ? 1 : 0;      // 0=关灯外观，1=开灯外观（用于灯带/雾等过渡）
const _LC1 = new THREE.Color(), _LC2 = new THREE.Color();

function lightFor(){
  if (lightMode === "on"){
    /* 开灯方案：室内照明主导 —— 暖白主光 + 暖环境光/半球光，冷蓝天光补光压到四成。
       P0-4 过曝修复（修"开灯后角色颜色失真"）：原方案 exp 1.95 + hemi 2.05 + 四条灯带
       点光 4×34 三份光叠在一起，浅色面直接被推到纯白（实测过曝像素占比 0.22、角色
       饱和度 0.35→0.21）。这里把总照度收回来：曝光 1.95→1.45（线性总闸）、半球光
       2.05→1.75、环境光 1.14→1.05、主光 2.70→2.55、点光 34→22（与关灯档同值，开灯
       时不再额外追加过曝），保留原来的暖色关系与"开灯更亮"的观感，只把高光拉回
       介质区，角色材质颜色不再被洗白。 */
    return { k: 2.55, a: 1.05, warm: 0xfff0d8, exp: 1.45,
             hemi: 1.75, hemiSky: 0xfff2de, hemiGround: 0x5c4a39,
             ambCol: 0xffe9cf, fillMul: 0.40, rimMul: 0.62 };
  }
  const ph = sky.dayPhase, w = sky.weather;
  let k = 2.2, a = 0.55, warm = 0xfff4e6, exp = 1.78;
  if (ph === "dawn")         { k = 1.45; warm = 0xffd2ab; a = 0.50; }
  else if (ph === "morning") { k = 2.45; }
  else if (ph === "noon")    { k = 2.65; }
  else if (ph === "dusk")    { k = 1.60; warm = 0xffb47c; a = 0.52; }
  else if (ph === "evening") { k = 0.80; warm = 0x9fb6e0; a = 0.44; exp = 1.62; }
  else                       { k = 0.55; warm = 0x8fa8d8; a = 0.40; exp = 1.56; }
  if (w === "sunny")  k *= 1.20;
  if (w === "cloudy") k *= 0.84;
  if (w === "rain")   { k *= 0.70; a *= 0.95; }
  return { k, a, warm, exp };
}

function pickWeather(){
  const night = (sky.dayPhase === "night" || sky.dayPhase === "evening");
  const pool = WEATHER_BY_PHASE[night ? "night" : "day"];
  let total = 0; pool.forEach(p => { total += p[1]; });
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++){ r -= pool[i][1]; if (r <= 0) return pool[i][0]; }
  return "clear";
}

function updateSky(dt){
  sky.t += dt;
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  if (Math.abs(h - sky.hour) > 0.01 || sky.lastMin !== now.getMinutes()){
    sky.lastMin = now.getMinutes();
    const prevPhase = sky.dayPhase;
    sky.hour = h;
    sky.dayPhase = dayPhaseOf(h);
    if (prevPhase !== sky.dayPhase && Math.random() < 0.6){ sky.weather = pickWeather(); sky.weatherTimer = 18 + Math.random() * 30; }
  }

  sky.weatherTimer -= dt;
  if (sky.weatherTimer <= 0){
    const nw = pickWeather();
    if (nw !== sky.weather) sky.weather = nw;
    sky.weatherTimer = 24 + Math.random() * 46;
  }

  /* 每 0.22s 重绘一次窗外（够顺滑又省） */
  sky.redraw -= dt;
  if (sky.redraw <= 0){
    sky.redraw = 0.22;
    sky.views.forEach(v => {
      drawSky(v.ctx, v.canvas.width, v.canvas.height, v.seed, sky.t);
      v.tex.needsUpdate = true;
    });
  }

  const L = lightFor();
  key.intensity += (L.k * (1 + 0.05 * Math.sin(sky.t * 1.7)) - key.intensity) * Math.min(1, dt * 1.4);
  key.color.lerp(_LC1.setHex(L.warm), Math.min(1, dt * 1.2));
  amb.intensity += (L.a - amb.intensity) * Math.min(1, dt * 1.4);
  /* 半球光：开灯时整体提亮 + 转暖（冷蓝天光 → 暖白灯光），关灯时回到日夜氛围 */
  hemi.intensity += ((L.hemi != null ? L.hemi : (L.a > 0.5 ? 1.5 : 1.05)) - hemi.intensity) * Math.min(1, dt * 1.2);
  hemi.color.lerp(_LC1.setHex(L.hemiSky != null ? L.hemiSky : 0xc4e0fa), Math.min(1, dt * 1.2));
  hemi.groundColor.lerp(_LC2.setHex(L.hemiGround != null ? L.hemiGround : 0x46586b), Math.min(1, dt * 1.2));
  renderer.toneMappingExposure += (L.exp - renderer.toneMappingExposure) * Math.min(1, dt * 1.2);
  /* 环境光色温：开灯时由冷蓝转向暖白；关灯时回到旧版的恒定冷蓝 → 零回归 */
  amb.color.lerp(_LC1.setHex(L.ambCol != null ? L.ambCol : 0x4a5c70), Math.min(1, dt * 1.2));
  /* 天光补光（fill/rim）：开灯时按系数压暗，让室内暖光成为主光 */
  fill.intensity += (FILL_I0 * (L.fillMul != null ? L.fillMul : 1) - fill.intensity) * Math.min(1, dt * 1.2);
  rim.intensity  += (RIM_I0  * (L.rimMul  != null ? L.rimMul  : 1) - rim.intensity)  * Math.min(1, dt * 1.2);

  /* 阳光斑：晴天才出现，云一来就慢慢淡掉 */
  const sunny = (sky.weather === "sunny" || sky.weather === "clear") &&
                sky.dayPhase !== "night" && sky.dayPhase !== "evening";
  let target = sunny ? (sky.weather === "sunny" ? 0.85 : 0.45) : 0;
  target *= 0.72 + 0.28 * Math.sin(sky.t * 0.7);
  sky.patches.forEach((pt, i) => {
    if (sky.dayPhase === "night" || sky.dayPhase === "evening") target = 0;
    pt.material.opacity += (target - pt.material.opacity) * Math.min(1, dt * 0.9);
    pt.position.x += Math.sin(sky.t * 0.12 + i) * dt * 0.05;
  });
}

/* 天花板灯带（发光条 + 点光）
   房间不封顶：灯带若用不透明材质，俯视机位下会像"悬空实心条"并挡住角色头部。
   这里改用半透明扩散板质感（真实灯罩即半透）+ 关闭深度写入，角色会被"透出"而不是被遮住。
   共 4 条，呈 2×2 排布，构成"天花板灯带阵列"：
     · 主灯带（对角两条）关灯时也保留旧版的 0.42 微光外观 → 关灯画面与旧版零差异
     · 副灯带（反对角两条）关灯时完全熄灭（opacity 0 / 光强 0），只在开灯时点亮 */
const CEIL_STRIPS = [];
function addCeilingStrip(x, z, nightGlow){
  const p = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.06, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xdff0ff, fog: false,
                                  transparent: true, opacity: nightGlow ? 0.42 : 0.0,
                                  depthWrite: false })
  );
  p.position.set(x, WALL_H - 0.25, z);
  p.userData.ceilingStrip = true;
  p.userData.noOutline = true;   /* 发光条不需要描边壳（描边壳不透明，会重新变成"挡人实心条"） */
  scene.add(p);
  const pl = new THREE.PointLight(0xcfe6ff, nightGlow ? 22 : 0, nightGlow ? 9 : 11, 2);
  pl.position.set(x, WALL_H - 0.45, z);
  scene.add(pl);
  CEIL_STRIPS.push({
    panel: p, light: pl,
    opOff: nightGlow ? 0.42 : 0.0,  opOn: 0.95,
    cOff:  new THREE.Color(0xdff0ff), cOn:  new THREE.Color(0xfff1d0),
    iOff:  nightGlow ? 22 : 0,       iOn: 22,   /* P0-4：开灯不再额外加档，避免四灯带叠加过曝 */
    lcOff: new THREE.Color(0xcfe6ff), lcOn: new THREE.Color(0xffe6bd)
  });
}
[[4.5, 4.5], [7.5, 7.5]].forEach(([x, z]) => addCeilingStrip(x, z, true));
[[4.5, 7.5], [7.5, 4.5]].forEach(([x, z]) => addCeilingStrip(x, z, false));

/* 灯光过渡：灯带亮度/色温、点光强度、雾色一起缓动，避免"啪"地一下换场 */
const FOG_OFF = new THREE.Color(0x0a0f15), FOG_ON = new THREE.Color(0x151d27);
function updateLights(dt){
  const want = lightMode === "on" ? 1 : 0;
  const rate = 1 / Math.max(0.15, CONFIG.lights.tween);
  lightMix += (want - lightMix) * Math.min(1, dt * rate * 2.4);
  if (Math.abs(want - lightMix) < 0.002) lightMix = want;
  CEIL_STRIPS.forEach(s => {
    s.panel.material.opacity = s.opOff + (s.opOn - s.opOff) * lightMix;
    s.panel.material.color.lerpColors(s.cOff, s.cOn, lightMix);
    s.light.intensity = s.iOff + (s.iOn - s.iOff) * lightMix;
    s.light.color.lerpColors(s.lcOff, s.lcOn, lightMix);
  });
  scene.fog.color.lerpColors(FOG_OFF, FOG_ON, lightMix);
}

/* ---------------- 家具 ---------------- */
function makeDesk(accent, facing, key){
  const g = new THREE.Group();
  const woodMat = toon(0x2b3d51);
  const legMat  = toon(0x18212c);
  const steel   = new THREE.MeshStandardMaterial({ color: 0x93a9c0, roughness: 0.36, metalness: 0.68 });

  /* 台面 + 后挡板 */
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.85), woodMat);
  top.position.y = 0.75; top.castShadow = true; top.receiveShadow = true;
  g.add(top);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.025, 0.87), toon(0x35495f));
  edge.position.y = 0.715; g.add(edge);
  [[-0.76, -0.35], [0.76, -0.35], [-0.76, 0.35], [0.76, 0.35]].forEach(([x, z]) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.75, 0.06), legMat);
    l.position.set(x, 0.375, z); l.castShadow = true;
    g.add(l);
  });
  /* 桌下抽屉柜 + 走线槽 */
  const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.52, 0.62), toon(0x22303f));
  drawer.position.set(0.58, 0.34, 0.02); drawer.castShadow = true; g.add(drawer);
  [0.10, -0.14].forEach(y => {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.02, 0.02), steel);
    h.position.set(0.56, 0.34 + y, -0.30); g.add(h);
  });
  const tray = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.05, 0.14), legMat);
  tray.position.set(-0.05, 0.60, -0.34); g.add(tray);
  for (let i = 0; i < 5; i++){
    const cw = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 6), toon(0x0c131b));
    cw.position.set(-0.4 + i * 0.16, 0.66, -0.365); cw.rotation.z = 0.35 + i * 0.05;
    g.add(cw);
  }

  /* 显示器：外框 + 面板 + 屏幕（实时画面） + 摄像头 */
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.42, 0.045), toon(0x0c131b));
  body.position.set(0, 1.08, 0.14); body.castShadow = true;
  g.add(body);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.44, 0.02), toon(0x1b2734));
  bezel.position.set(0, 1.08, 0.125); g.add(bezel);

  const canvas = document.createElement("canvas");
  canvas.width = 384; canvas.height = 216;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = -1; tex.offset.x = 1;                 // 反向显示，避免镜像
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.645, 0.372),
    new THREE.MeshBasicMaterial({ map: tex, fog: false, toneMapped: false,
      side: THREE.DoubleSide }));
  scr.position.set(0, 1.08, 0.113);
  scr.rotation.y = Math.PI;
  scr.userData.noOutline = true;
  g.add(scr);

  const cam = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), toon(0x05080c));
  cam.position.set(0, 1.295, 0.155); g.add(cam);
  const camLed = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0x34d399, fog: false }));
  camLed.position.set(0.03, 1.295, 0.158); camLed.userData.noOutline = true; g.add(camLed);

  const standNeck = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.07), legMat);
  standNeck.position.set(0, 0.89, 0.14); g.add(standNeck);
  const standBase = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.025, 0.20), legMat);
  standBase.position.set(0, 0.765, 0.14); g.add(standBase);

  /* 键盘（键帽可见） + 鼠标垫 + 鼠标 */
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.008, 0.26), toon(0x1a2330));
  pad.position.set(-0.02, 0.786, -0.30); g.add(pad);
  const kb = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.022, 0.155), toon(0x101821));
  kb.position.set(-0.11, 0.801, -0.30); kb.castShadow = true; g.add(kb);
  for (let r = 0; r < 4; r++){
    const row = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.006, 0.026), toon(0x2b3a4d));
    row.position.set(-0.11, 0.814, -0.352 + r * 0.036);
    g.add(row);
  }
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), toon(0x101821));
  mouse.scale.set(0.7, 0.5, 1.0);
  mouse.position.set(0.25, 0.798, -0.30);
  g.add(mouse);
  const mcord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.22, 6), toon(0x0c131b));
  mcord.position.set(0.30, 0.795, -0.19); mcord.rotation.x = 1.35; g.add(mcord);

  /* 桌角小物：杯子 / 笔筒 / 便签 / 小绿植 / 文件 */
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.11, 12), toon(accent));
  mug.position.set(-0.66, 0.835, 0.20); mug.castShadow = true;
  g.add(mug);
  const mugIn = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.02, 12),
    new THREE.MeshBasicMaterial({ color: 0x2b1a12, fog: false }));
  mugIn.position.set(-0.66, 0.885, 0.20); mugIn.userData.noOutline = true; g.add(mugIn);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.007, 6, 12), toon(accent));
  handle.position.set(-0.615, 0.835, 0.20); handle.rotation.y = Math.PI / 2;
  g.add(handle);

  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.10, 10), toon(0x1b2734));
  cup.position.set(-0.56, 0.83, -0.30); g.add(cup);
  for (let i = 0; i < 4; i++){
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.19, 6), toon(i % 2 ? 0xf59e0b : 0x60a5fa));
    pen.position.set(-0.57 + (i % 2) * 0.022, 0.88, -0.31 + (i > 1 ? 0.02 : -0.01));
    pen.rotation.z = 0.16 - 0.08 * i;
    g.add(pen);
  }
  const note = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.006, 0.10), toon(0xfcd34d));
  note.position.set(0.62, 0.783, 0.10); note.rotation.y = 0.3; g.add(note);
  const note2 = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.006, 0.10), toon(0xfda4af));
  note2.position.set(0.60, 0.790, 0.12); note2.rotation.y = -0.22; g.add(note2);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.036, 0.08, 10), toon(0xb45309));
  pot.position.set(0.72, 0.82, 0.26); pot.castShadow = true; g.add(pot);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), toon(0x2f7d4f));
  leaf.position.set(0.72, 0.89, 0.26); leaf.scale.set(1, 0.85, 1); leaf.castShadow = true; g.add(leaf);
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.006, 0.27), toon(0xdbe4ec));
  paper.position.set(0.44, 0.784, -0.12); paper.rotation.y = 0.18; g.add(paper);

  /* 桌角落地灯 */
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.55, 8), legMat);
  pole.position.set(0.86, 0.775, 0.30); pole.castShadow = true;
  g.add(pole);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.20, 12, 1, true), toon(0x233242));
  shade.position.set(0.86, 1.62, 0.30); shade.rotation.x = Math.PI;
  g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8),
    new THREE.MeshBasicMaterial({ color: accent, fog: false }));
  bulb.position.set(0.86, 1.54, 0.30);
  bulb.userData.noOutline = true;
  g.add(bulb);
  const lampLight = new THREE.PointLight(accent, 3.4, 4.2, 2);
  lampLight.position.set(0.86, 1.52, 0.30);
  g.add(lampLight);
  /* P0-2：工位灯可转红告警（error 态），平时保持 accent 原色 */
  g.userData.lamp = { light: lampLight, bulb, base: accent, baseIntensity: 3.4, alarm: false };

  /* 屏幕内容状态（由 tick 驱动重绘） */
  g.userData.screen = {
    canvas, ctx: canvas.getContext("2d"), tex, key: key || "",
    accent: "#" + new THREE.Color(accent).getHexString(),
    mode: "cad", sub: 0, timer: 1.5 + Math.random() * 3, phase: 0,
    scroll: 0, flash: 0, hold: 0
  };
  g.rotation.y = facing;
  return g;
}

function makeChair(facing){
  const g = new THREE.Group();
  const mat  = toon(0x1d2735);
  const mat2 = toon(0x2a3849);
  const steel = toon(0x8798ab);
  /* 座面顶 = cushion.y + 0.025 = 0.50，必须与 CONFIG.character.seatTop 一致：
     角色入座时按该高度反解下沉量，座面偏高会把角色"压"进椅垫、脚跟陷进地板 */
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.09, 0.46), mat2);
  seat.position.y = 0.42; seat.castShadow = true; seat.receiveShadow = true;
  g.add(seat);
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.42), toon(0x35455a));
  cushion.position.y = 0.475; g.add(cushion);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.55, 0.09), mat);
  back.position.set(0, 0.74, -0.20); back.castShadow = true;
  g.add(back);
  const backPad = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.04), toon(0x35455a));
  backPad.position.set(0, 0.74, -0.15); g.add(backPad);
  [-1, 1].forEach(s => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.30), mat);
    arm.position.set(s * 0.255, 0.605, 0.0); g.add(arm);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.035), mat);
    post.position.set(s * 0.255, 0.52, -0.08); g.add(post);
  });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), steel);
  col.position.y = 0.22; g.add(col);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 10), mat);
  hub.position.y = 0.05; g.add(hub);
  for (let i = 0; i < 5; i++){
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.04, 0.42), mat);
    leg.position.set(Math.sin(a) * 0.19, 0.045, Math.cos(a) * 0.19);
    leg.rotation.y = a; leg.castShadow = true;
    g.add(leg);
    const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), toon(0x0a0e13));
    wheel.position.set(Math.sin(a) * 0.38, 0.032, Math.cos(a) * 0.38); g.add(wheel);
  }
  g.rotation.y = facing;
  return g;
}

/* =====================================================================
   左墙（西墙 x≈0）：茶水间 + 健身房 —— 参照「Marvis 办公室」的休闲区气质
   ===================================================================== */
const steelM  = new THREE.MeshStandardMaterial({ color: 0x9fb3c6, roughness: 0.30, metalness: 0.74 });
const darkM   = toon(0x141d28);
const cabinetM = toon(0x24344a);
const counterM = new THREE.MeshStandardMaterial({ color: 0x33506a, roughness: 0.28, metalness: 0.35 });
const rubberM  = new THREE.MeshStandardMaterial({ color: 0x1a2330, roughness: 0.95, metalness: 0.04 });

function buildPantry(){
  const g = new THREE.Group();

  /* 背景墙板 + 竖向木格栅 */
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.55, 5.30), toon(0x2a3a4e));
  panel.position.set(0.11, 1.30, 5.30); g.add(panel);
  for (let i = 0; i < 34; i++){
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.45, 0.055), toon(0x35495f));
    s.position.set(0.14, 1.30, 2.72 + i * 0.155); g.add(s);
  }

  /* 地柜 + 台面 */
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.86, 3.25), cabinetM);
  cab.position.set(0.56, 0.43, 5.32); cab.castShadow = true; g.add(cab);
  const toe = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.10, 3.20), darkM);
  toe.position.set(0.60, 0.05, 5.32); g.add(toe);
  const ctop = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.055, 3.34), counterM);
  ctop.position.set(0.55, 0.885, 5.32); ctop.castShadow = true; g.add(ctop);
  for (let i = 0; i < 4; i++){
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.72, 0.72), toon(0x2d3f57));
    door.position.set(0.885, 0.45, 3.86 + i * 0.78); g.add(door);
    const hd = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.030, 0.20), steelM);
    hd.position.set(0.905, 0.80, 3.86 + i * 0.78); g.add(hd);
  }

  /* 吊柜（玻璃门）+ 开放层板 */
  const up = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.70, 1.44), cabinetM);
  up.position.set(0.34, 1.95, 4.32); g.add(up);
  [-0.36, 0.36].forEach(dz => {
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.60, 0.66),
      new THREE.MeshStandardMaterial({ color: 0xbfe3f5, roughness: 0.06, metalness: 0.20,
        transparent: true, opacity: 0.22 }));
    gl.position.set(0.565, 1.95, 4.32 + dz); gl.userData.noOutline = true; g.add(gl);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.62, 0.68), steelM);
    fr.position.set(0.585, 1.95, 4.32 + dz); g.add(fr);
  });
  [[1.62, 0.10, 5.35], [2.00, 0.10, 5.35], [1.62, 0.10, 6.42], [2.00, 0.10, 6.42]].forEach(([y, dy, z]) => {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 1.02), toon(0x2f4358));
    sh.position.set(0.32, y, z); g.add(sh);
  });
  for (let i = 0; i < 6; i++){          // 层板上的杯子 / 玻璃罐
    const z = 5.02 + i * 0.16;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.10, 12),
      toon(i % 2 ? 0xe6edf5 : 0x8fd4ff));
    cup.position.set(0.30, 1.705 + 0.035, z); g.add(cup);
    const jr = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 12), toon(0xd8c39a));
    jr.position.set(0.31, 2.085 + 0.035, 6.12 + i * 0.06 - 0.18); g.add(jr);
  }

  /* 意式咖啡机（商用双头感） */
  const cm = new THREE.Group(); cm.position.set(0.46, 0.915, 4.35); g.add(cm);
  part(cm, new THREE.BoxGeometry(0.40, 0.36, 0.44), steelM, [0, 0.20, 0], null, null, false);
  part(cm, new THREE.BoxGeometry(0.36, 0.05, 0.40), toon(0x1a232e), [0, 0.40, 0], null, null, false);
  part(cm, new THREE.BoxGeometry(0.24, 0.07, 0.16), darkM, [0, 0.05, 0.02], null, null, false);
  [-0.09, 0.09].forEach(z => {
    part(cm, new THREE.CylinderGeometry(0.028, 0.028, 0.30, 12), steelM, [0, 0.22, z], null, null, false);
    part(cm, new THREE.CylinderGeometry(0.022, 0.030, 0.07, 12), toon(0x101821), [0, 0.05, z], null, null, false);
    part(cm, new THREE.CylinderGeometry(0.036, 0.036, 0.045, 14), toon(0xf3f6fa), [-0.10, -0.03, z], null, null, false);
  });
  part(cm, new THREE.CylinderGeometry(0.012, 0.010, 0.22, 10), steelM, [0.16, 0.10, -0.14], [0.45, 0, 0.35], null, false);
  const cmd = part(cm, new THREE.PlaneGeometry(0.16, 0.09),
    new THREE.MeshBasicMaterial({ color: 0x5eead4, fog: false, toneMapped: false }),
    [0.205, 0.34, 0.06], [0, 1.57, 0], null, false);
  cmd.userData.noOutline = true;
  /* 磨豆机 */
  part(g, new THREE.BoxGeometry(0.18, 0.34, 0.18), steelM, [0.44, 1.09, 3.92], null, null, false);
  part(g, new THREE.CylinderGeometry(0.075, 0.055, 0.16, 14), toon(0x28323f), [0.44, 1.33, 3.92], null, null, false);
  part(g, new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12), toon(0xd8c39a), [0.44, 1.15, 3.92], null, null, false);

  /* 水槽 + 龙头 + 沥水架 */
  const basin = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.14, 0.60), toon(0x2a3846));
  basin.position.set(0.60, 0.83, 6.30); g.add(basin);
  const hole = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.10, 0.50), darkM);
  hole.position.set(0.60, 0.86, 6.30); g.add(hole);
  part(g, new THREE.CylinderGeometry(0.020, 0.022, 0.30, 12), steelM, [0.40, 1.07, 6.30], null, null, false);
  part(g, new THREE.TorusGeometry(0.075, 0.018, 8, 16, Math.PI), steelM, [0.40, 1.22, 6.30], [0, 0, 0], null, false);
  part(g, new THREE.CylinderGeometry(0.016, 0.016, 0.09, 10), steelM, [0.475, 1.19, 6.30], [0, 0, -1.2], null, false);
  part(g, new THREE.BoxGeometry(0.34, 0.02, 0.44), toon(0x3b5468), [0.62, 0.925, 6.95], null, null, false);
  for (let i = 0; i < 4; i++){
    part(g, new THREE.CylinderGeometry(0.085, 0.085, 0.012, 14), toon(0xe8eef5),
         [0.62, 0.94 + i * 0.03, 6.95], [0, 0, 1.57], null, false);
  }

  /* 台面小物：烧水壶 + 马克杯 + 手冲架 */
  part(g, new THREE.CylinderGeometry(0.085, 0.095, 0.20, 16), steelM, [0.46, 1.00, 5.55], null, null, false);
  part(g, new THREE.TorusGeometry(0.075, 0.016, 8, 14, Math.PI), darkM, [0.46, 1.12, 5.55], [0, 1.57, 0], null, false);
  for (let i = 0; i < 3; i++){
    const mug = part(g, new THREE.CylinderGeometry(0.045, 0.040, 0.095, 12),
      toon([0xf0abfc, 0x5eead4, 0xfbbf24][i]), [0.62, 0.955, 5.05 + i * 0.15], null, null, false);
    part(g, new THREE.TorusGeometry(0.032, 0.009, 6, 12), toon(0xf3f4f6),
         [0.62, 0.955, 5.05 + i * 0.15 + 0.045], [0, 1.57, 0], null, false);
    mug.castShadow = true;
  }

  /* 立式饮水机（纯净水桶） */
  const disp = new THREE.Group(); disp.position.set(0.53, 0, 3.25); g.add(disp);
  part(disp, new THREE.BoxGeometry(0.42, 0.98, 0.46), toon(0xdfe7ef), [0, 0.49, 0], null, null, false);
  part(disp, new THREE.BoxGeometry(0.44, 0.10, 0.48), toon(0x2d3f57), [0, 1.02, 0], null, null, false);
  part(disp, new THREE.CylinderGeometry(0.135, 0.155, 0.46, 16),
       new THREE.MeshStandardMaterial({ color: 0x8fd4ff, roughness: 0.16, metalness: 0.10,
         transparent: true, opacity: 0.55 }), [0, 1.30, 0], null, null, false);
  part(disp, new THREE.BoxGeometry(0.16, 0.13, 0.06), toon(0x22303f), [0, 0.70, 0.25], null, null, false);
  part(disp, new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8),
       new THREE.MeshBasicMaterial({ color: 0x5eead4, fog: false }), [0, 0.70, 0.29], [1.57, 0, 0], null, false);

  /* 冰箱 */
  const fr = new THREE.Group(); fr.position.set(0.66, 0, 7.30); g.add(fr);
  part(fr, new THREE.BoxGeometry(0.66, 1.72, 0.70), toon(0xc9d6e2), [0, 0.86, 0], null, null, false);
  part(fr, new THREE.BoxGeometry(0.68, 0.86, 0.72), toon(0xdbe4ee), [0, 1.29, 0], null, null, false);
  part(fr, new THREE.BoxGeometry(0.02, 0.86, 0.72), toon(0xaebccb), [0, 1.29, 0.02], null, null, false);
  [1.52, 1.06, 0.56, 0.12].forEach((y, i) => {
    part(fr, new THREE.CylinderGeometry(0.018, 0.018, 0.34, 10), steelM,
         [0.36, y + 0.16, i % 2 ? 0.20 : -0.20], null, null, false);
  });
  const fscr = part(fr, new THREE.PlaneGeometry(0.20, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, fog: false, toneMapped: false }),
    [0.345, 1.44, 0], [0, 1.57, 0], null, false);
  fscr.userData.noOutline = true;
  for (let i = 0; i < 4; i++){       // 冰箱贴
    const col = [0xfbbf24, 0xfb923c, 0x5eead4, 0xf0abfc][i];
    part(fr, new THREE.BoxGeometry(0.012, 0.075, 0.075), toon(col),
         [0.335, 1.05 - i * 0.14, 0.16 - i * 0.09], [0, 0, i * 0.3], null, false);
  }
  part(fr, new THREE.BoxGeometry(0.30, 0.16, 0.26), toon(0x8b9bb0), [0, 1.80, 0.02], null, null, false);

  /* 吧台高脚凳 ×2 */
  [[4.25], [5.35]].forEach(([z]) => {
    const st = new THREE.Group(); st.position.set(1.18, 0, z); g.add(st);
    part(st, new THREE.CylinderGeometry(0.19, 0.19, 0.055, 16), toon(0x2f4358), [0, 0.63, 0], null, null, false);
    part(st, new THREE.CylinderGeometry(0.16, 0.16, 0.04, 16), toon(0x22303f), [0, 0.60, 0], null, null, false);
    part(st, new THREE.CylinderGeometry(0.032, 0.032, 0.58, 12), steelM, [0, 0.30, 0], null, null, false);
    part(st, new THREE.TorusGeometry(0.16, 0.014, 8, 16), steelM, [0, 0.20, 0], [1.57, 0, 0], null, false);
    for (let i = 0; i < 4; i++){
      const a = i / 4 * Math.PI * 2 + 0.78;
      part(st, new THREE.CylinderGeometry(0.015, 0.015, 0.32, 8), steelM,
           [Math.sin(a) * 0.10, 0.16, Math.cos(a) * 0.10], [Math.cos(a) * 0.42, 0, -Math.sin(a) * 0.42], null, false);
    }
  });

  /* 吊灯 ×2 */
  [[4.35, 0x5eead4], [6.35, 0xfbbf24]].forEach(([z, col]) => {
    part(g, new THREE.CylinderGeometry(0.006, 0.006, 0.55, 6), darkM, [0.95, 2.62, z], null, null, false);
    part(g, new THREE.ConeGeometry(0.17, 0.22, 18, 1, true),
         new THREE.MeshStandardMaterial({ color: 0x2f4358, roughness: 0.5, metalness: 0.4,
           side: THREE.DoubleSide }), [0.95, 2.26, z], null, null, false);
    part(g, new THREE.SphereGeometry(0.055, 12, 10),
         new THREE.MeshBasicMaterial({ color: col, fog: false, toneMapped: false }), [0.95, 2.19, z], null, null, false);
  });

  /* 手写菜单板 + 挂钩 + 插座 */
  const menu = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.62, 0.78), toon(0x1b2734));
  menu.position.set(0.20, 1.72, 6.95); g.add(menu);
  for (let i = 0; i < 4; i++){
    const ln = part(g, new THREE.BoxGeometry(0.012, 0.022, 0.50 - i * 0.06),
      new THREE.MeshBasicMaterial({ color: [0x5eead4, 0xfbbf24, 0xf0abfc, 0xe8eef5][i], fog: false }),
      [0.225, 1.90 - i * 0.12, 6.95], null, null, false);
    ln.userData.noOutline = true;
  }
  part(g, new THREE.BoxGeometry(0.05, 0.05, 0.30), toon(0x2d3f57), [0.16, 1.15, 6.95], null, null, false);

  return g;
}

function buildGym(){
  const g = new THREE.Group();
  const gymM = toon(0x27384c);

  /* 橡胶地垫 + 镜墙 */
  const mat = new THREE.Mesh(new THREE.BoxGeometry(2.20, 0.035, 3.40), rubberM);
  mat.position.set(1.20, 0.018, 10.05); mat.receiveShadow = true; g.add(mat);
  const border = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.02, 0.06), toon(0x5eead4));
  border.position.set(1.20, 0.026, 8.36); g.add(border);
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.20, 2.70),
    new THREE.MeshStandardMaterial({ color: 0xa8c8dc, roughness: 0.06, metalness: 0.92 }));
  mirror.position.set(0.12, 1.20, 10.25); g.add(mirror);
  [-1, 1].forEach(s => {
    const fr = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.30, 0.07), steelM);
    fr.position.set(0.13, 1.20, 10.25 + s * 1.38); g.add(fr);
  });
  const fr2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 2.80), steelM);
  fr2.position.set(0.13, 2.34, 10.25); g.add(fr2);
  const gl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.30, 1.30),
    new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.14 }));
  gl.position.set(0.16, 1.75, 9.70); gl.rotation.x = 0.28; gl.userData.noOutline = true; g.add(gl);

  /* 跑步机（可站人） */
  const tm = new THREE.Group(); tm.position.set(0.58, 0, 8.75); g.add(tm);
  part(tm, new THREE.BoxGeometry(0.62, 0.10, 1.44), gymM, [0, 0.12, 0], null, null, false);
  part(tm, new THREE.BoxGeometry(0.50, 0.045, 1.34), toon(0x101821), [0, 0.18, 0], null, null, false);
  for (let i = 0; i < 9; i++){
    part(tm, new THREE.BoxGeometry(0.48, 0.008, 0.055), toon(0x2b3a4d), [0, 0.205, -0.58 + i * 0.145], null, null, false);
  }
  [-1, 1].forEach(s => {
    part(tm, new THREE.BoxGeometry(0.05, 0.06, 1.36), steelM, [s * 0.28, 0.29, 0], null, null, false);
    part(tm, new THREE.CylinderGeometry(0.026, 0.026, 1.18, 12), steelM,
         [s * 0.26, 0.86, -0.62], [0.16, 0, 0], null, false);
    part(tm, new THREE.CylinderGeometry(0.022, 0.022, 0.34, 10), steelM,
         [s * 0.26, 1.16, -0.36], [1.20, 0, 0], null, false);
    part(tm, new THREE.SphereGeometry(0.028, 10, 8), toon(0x101821), [s * 0.26, 1.02, -0.44], null, null, false);
    part(tm, new THREE.BoxGeometry(0.05, 0.05, 0.05), darkM, [s * 0.30, 0.06, 0.62], null, null, false);
  });
  part(tm, new THREE.BoxGeometry(0.66, 0.30, 0.12), darkM, [0, 1.30, -0.60], null, null, false);
  const scr = part(tm, new THREE.PlaneGeometry(0.50, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x5eead4, fog: false, toneMapped: false }),
    [0, 1.30, -0.535], [0, Math.PI, 0], null, false);
  scr.userData.noOutline = true;
  part(tm, new THREE.BoxGeometry(0.72, 0.14, 0.20), gymM, [0, 0.20, 0.70], [0.10, 0, 0], null, false);
  part(tm, new THREE.CylinderGeometry(0.030, 0.030, 0.04, 12),
       new THREE.MeshBasicMaterial({ color: 0xef4444, fog: false }), [0.26, 1.44, -0.60], null, null, false);

  /* 哑铃架 + 哑铃 */
  const rack = new THREE.Group(); rack.position.set(0.44, 0, 10.45); g.add(rack);
  [-1, 1].forEach(s => {
    part(rack, new THREE.BoxGeometry(0.06, 0.86, 0.06), steelM, [s * 0.16, 0.43, -0.52], null, null, false);
    part(rack, new THREE.BoxGeometry(0.06, 0.86, 0.06), steelM, [s * 0.16, 0.43, 0.52], null, null, false);
  });
  [0.26, 0.62].forEach((y, tier) => {
    part(rack, new THREE.BoxGeometry(0.30, 0.045, 1.20), gymM, [0, y, 0], null, null, false);
    part(rack, new THREE.BoxGeometry(0.32, 0.03, 1.20), toon(0x1b2735), [0, y - 0.035, 0], null, null, false);
    for (let i = 0; i < 4; i++){
      const z = -0.44 + i * 0.30;
      const hx = 0.16 + tier * 0.02;
      [-1, 1].forEach(s => {
        part(rack, new THREE.CylinderGeometry(hx, hx, 0.10, 6), toon(0x2b3a4d),
             [0, y + 0.10, z + s * (hx + 0.055)], [0, 0, 1.57], null, false);
      });
      part(rack, new THREE.CylinderGeometry(0.022, 0.022, 0.22, 10), steelM,
           [0, y + 0.10, z], [1.57, 0, 0], null, false);
    }
  });

  /* 训练凳 */
  const bench = new THREE.Group(); bench.position.set(1.02, 0, 10.82); g.add(bench);
  part(bench, new THREE.BoxGeometry(0.34, 0.08, 1.02), toon(0x24344a), [0, 0.44, 0], null, null, false);
  part(bench, new THREE.BoxGeometry(0.30, 0.05, 0.90), toon(0x2f4358), [0, 0.495, 0], [0.02, 0, 0], null, false);
  [-1, 1].forEach(s => {
    part(bench, new THREE.BoxGeometry(0.05, 0.40, 0.05), steelM, [s * 0.13, 0.22, -0.40], [0, 0, s * 0.12], null, false);
    part(bench, new THREE.BoxGeometry(0.05, 0.40, 0.05), steelM, [s * 0.13, 0.22, 0.40], [0, 0, s * 0.12], null, false);
    part(bench, new THREE.BoxGeometry(0.06, 0.04, 0.16), darkM, [s * 0.16, 0.02, -0.40], null, null, false);
    part(bench, new THREE.BoxGeometry(0.06, 0.04, 0.16), darkM, [s * 0.16, 0.02, 0.40], null, null, false);
  });

  /* 壶铃 + 瑜伽垫 + 卷垫 */
  [[1.35, 9.55, 0.16], [1.62, 9.78, 0.13], [1.42, 9.98, 0.11]].forEach(([x, z, r]) => {
    part(g, new THREE.SphereGeometry(r, 16, 12), toon(0x2f4358), [x, r, z], null, [1, 0.86, 1], false);
    part(g, new THREE.TorusGeometry(r * 0.72, r * 0.20, 8, 16, Math.PI * 1.25), steelM,
         [x, r * 1.62, z], [0, 0, -0.5], null, false);
  });
  const ymat = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.026, 1.58), toon(0x7c6ab5));
  ymat.position.set(1.78, 0.032, 10.42); ymat.receiveShadow = true; g.add(ymat);
  const yline = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.006, 1.50), toon(0x9d8bd8));
  yline.position.set(1.78, 0.046, 10.42); g.add(yline);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.90, 16), toon(0x8f7ccc));
  roll.position.set(2.30, 0.115, 11.58); roll.rotation.x = 1.5708; g.add(roll);

  /* 墙上：洞洞板 + 战绳 + 毛巾桶 */
  const pb = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.90, 1.30), toon(0x1f2d3d));
  pb.position.set(0.14, 1.95, 8.95); g.add(pb);
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 9; j++)
      part(g, new THREE.SphereGeometry(0.016, 6, 5), toon(0x3d5872),
           [0.17, 1.62 + i * 0.13, 8.42 + j * 0.135], null, null, false);
  part(g, new THREE.TorusGeometry(0.14, 0.030, 8, 18), toon(0x2b3a4d), [0.20, 1.72, 8.42], [0, 1.57, 0], null, false);
  part(g, new THREE.CylinderGeometry(0.16, 0.13, 0.50, 14), toon(0x35495f), [0.26, 0.25, 11.62], null, null, false);
  part(g, new THREE.TorusGeometry(0.155, 0.018, 8, 16), toon(0x5eead4), [0.26, 0.50, 11.62], [1.57, 0, 0], null, false);
  return g;
}

/* 白板（北墙，替代旧左墙白板区） */
function buildBoard(){
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.10, 1.16, 0.06), toon(0x2f4358));
  frame.position.set(5.55, 1.62, 0.18); g.add(frame);
  const surf = new THREE.Mesh(new THREE.BoxGeometry(2.00, 1.06, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xe9eef4, roughness: 0.42, metalness: 0.06 }));
  surf.position.set(5.55, 1.62, 0.215); g.add(surf);
  for (let i = 0; i < 3; i++){
    const ln = part(g, new THREE.BoxGeometry(0.72 - i * 0.12, 0.028, 0.012),
      new THREE.MeshBasicMaterial({ color: [0x22d3ee, 0x5eead4, 0xfb923c][i], fog: false }),
      [5.25, 1.90 - i * 0.17, 0.235], null, null, false);
    ln.userData.noOutline = true;
  }
  part(g, new THREE.BoxGeometry(0.30, 0.30, 0.012),
       new THREE.MeshBasicMaterial({ color: 0xfbbf24, fog: false }), [6.05, 1.86, 0.235], [0, 0, 0.08], null, false);
  part(g, new THREE.BoxGeometry(0.26, 0.24, 0.012),
       new THREE.MeshBasicMaterial({ color: 0xf0abfc, fog: false }), [6.06, 1.52, 0.235], [0, 0, -0.06], null, false);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(1.90, 0.05, 0.12), steelM);
  tray.position.set(5.55, 0.98, 0.24); g.add(tray);
  for (let i = 0; i < 4; i++){
    part(g, new THREE.CylinderGeometry(0.013, 0.013, 0.13, 8), toon([0xef4444, 0x22d3ee, 0x34d399, 0x1f2937][i]),
         [5.10 + i * 0.16, 1.02, 0.28], [0, 0, 1.57], null, false);
  }
  part(g, new THREE.BoxGeometry(0.16, 0.05, 0.09), toon(0x8b9bb0), [6.15, 1.02, 0.26], null, null, false);
  return g;
}

/* 左墙分区：地垫 + 分区吊牌，做出「茶水间 / 健身房」两个区块感 */
function zoneSign(en, cn, accent){
  const cv = document.createElement("canvas");
  cv.width = 512; cv.height = 168;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "rgba(10,18,28,0.86)";
  roundRectPath(ctx, 2, 2, 508, 164, 22); ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#" + accent.toString(16).padStart(6, "0");
  ctx.globalAlpha = 0.75; ctx.stroke(); ctx.globalAlpha = 1;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = "700 54px -apple-system, 'PingFang SC', sans-serif";
  ctx.fillStyle = "#e6f0fa";
  ctx.fillText(cn, 34, 60);
  ctx.font = "600 30px -apple-system, 'Helvetica Neue', sans-serif";
  ctx.fillStyle = "#" + accent.toString(16).padStart(6, "0");
  ctx.fillText(en, 34, 116);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.10, 0.36),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false,
      depthWrite: false, toneMapped: false }));
  m.userData.noOutline = true;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.40, 0.05), toon(0x1a2532));
  const grp = new THREE.Group();
  bar.position.z = -0.03; grp.add(bar); grp.add(m);
  return grp;
}

function buildZones(){
  const g = new THREE.Group();
  /* 茶水间防滑地垫 */
  const pm = new THREE.Mesh(new THREE.BoxGeometry(2.00, 0.014, 4.50), toon(0x28343f));
  pm.position.set(1.02, 0.012, 5.20); pm.receiveShadow = true; g.add(pm);
  const pe = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.008, 4.54), toon(0x3d5a72));
  pe.position.set(1.02, 0.006, 5.20); g.add(pe);
  /* 茶水间台面灯带 */
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 3.60),
    new THREE.MeshBasicMaterial({ color: 0x5eead4, fog: false, toneMapped: false }));
  strip.position.set(0.21, 1.42, 5.20); strip.userData.noOutline = true; g.add(strip);

  /* 健身房地胶 + 拼缝 */
  const gm = new THREE.Mesh(new THREE.BoxGeometry(2.30, 0.018, 3.90), toon(0x1b232e));
  gm.position.set(1.20, 0.014, 10.00); gm.receiveShadow = true; g.add(gm);
  for (let i = 1; i < 4; i++){
    const seam = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.004, 0.014), toon(0x2b3a4d));
    seam.position.set(1.20, 0.025, 8.05 + i * 0.98); g.add(seam);
  }
  const seamV = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.004, 3.92), toon(0x2b3a4d));
  seamV.position.set(1.20, 0.025, 10.00); g.add(seamV);

  /* 分区吊牌（贴左墙） */
  const s1 = zoneSign("PANTRY", "茶水间", 0x5eead4);
  s1.position.set(0.14, 2.42, 5.20); s1.rotation.y = Math.PI / 2; g.add(s1);
  const s2 = zoneSign("GYM", "健身房", 0x818cf8);
  s2.position.set(0.14, 2.42, 9.70); s2.rotation.y = Math.PI / 2; g.add(s2);
  return g;
}

scene.add(buildZones());
scene.add(buildPantry());
scene.add(buildGym());
scene.add(buildBoard());

/* 左墙家具碰撞体（角色绕着走，绝不穿模） */
addObst(0.56, 5.32, 0.40, 1.68, 0, "counter", 0.22);
addObst(0.53, 3.25, 0.30, 0.30, 0, "dispenser", 0.24);
addObst(0.66, 7.30, 0.38, 0.40, 0, "fridge", 0.24);
addObst(1.18, 4.25, 0.20, 0.20, 0, "stool", 0.10);
addObst(1.18, 5.35, 0.20, 0.20, 0, "stool", 0.10);
addObst(0.58, 8.75, 0.36, 0.74, 0, "treadmill", 0.26);
addObst(0.44, 10.45, 0.26, 0.60, 0, "rack", 0.22);
addObst(1.02, 10.82, 0.24, 0.56, 0, "bench", 0.20);
addObst(1.45, 9.78, 0.30, 0.30, 0, "kettle", 0.10);
addObst(2.30, 11.58, 0.16, 0.50, 0, "roll", 0.16);
addObst(5.55, 0.20, 1.06, 0.16, 0, "board", 0.16);

/* 中央共识台 */
const podium = new THREE.Group();
{
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.55, 0.10, 24),
    toon(0x1b2735));
  base.position.y = 0.05; base.castShadow = true; base.receiveShadow = true;
  podium.add(base);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.045, 10, 40),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, fog: false, transparent: true, opacity: 0.35 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.79;
  podium.add(ring);

  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.06, 24),
    toon(0x2d3f55));
  top.position.y = 0.76; top.castShadow = true;
  podium.add(top);

  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.52, 0.72, 20),
    toon(0x22303f));
  col.position.y = 0.37;
  podium.add(col);

  /* 台面全息柱 */
  const holo = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, fog: false, transparent: true, opacity: 0.12,
      side: THREE.DoubleSide }));
  holo.position.y = 1.05;
  podium.add(holo);

  const halo = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.02, 20),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, fog: false, transparent: true, opacity: 0.16 }));
  halo.position.y = 1.31;
  podium.add(halo);
  podium.userData.halo = halo;
  podium.userData.holo = holo;

  podium.position.set(CX, 0, CZ);
}
scene.add(podium);

/* ---------------- 程序化角色 ---------------- */
/* 统一按 1.86m 基准建模，再用 scale 调整到目标身高 */

function limb(parent, len, r1, r2, mat){
  /* 圆柱 + 两端球，比 CapsuleGeometry 更好控制上粗下细 */
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 12), mat);
  cone.position.y = -len / 2;
  cone.castShadow = true;
  parent.add(g);
  g.add(cone);
  const o1 = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 12), OUTLINE_MAT);
  o1.position.y = -len / 2; o1.scale.setScalar(1.09);
  g.add(o1);
  const b1 = new THREE.Mesh(new THREE.SphereGeometry(r1, 12, 8), mat);
  b1.castShadow = true; g.add(b1);
  const b1o = new THREE.Mesh(new THREE.SphereGeometry(r1, 12, 8), OUTLINE_MAT);
  b1o.scale.setScalar(1.09); g.add(b1o);
  const b2 = new THREE.Mesh(new THREE.SphereGeometry(r2, 12, 8), mat);
  b2.position.y = -len; b2.castShadow = true; g.add(b2);
  const b2o = new THREE.Mesh(new THREE.SphereGeometry(r2, 12, 8), OUTLINE_MAT);
  b2o.position.y = -len; b2o.scale.setScalar(1.09); g.add(b2o);
  g.traverse(o => { if (o.isMesh) o.userData.noOutline = true; });
  return g;
}

function shade(hex, k){
  const c = new THREE.Color(hex);
  return new THREE.Color(c.r * k, c.g * k, c.b * k).getHex();
}

function buildCharacter(cfg){
  const P = cfg;
  const skinM   = grainMat(P.skin, "skin", 3, 3);            // 皮肤：带毛孔微质感
  const skinD   = grainMat(shade(P.skin, 0.90), "skin", 3, 3);
  const hairM   = grainMat(P.hair, "hair", 4, 2);            // 头发：带发丝纹理
  const hairL   = grainMat(shade(P.hair, 1.28), "hair", 4, 2);
  const hairD   = grainMat(shade(P.hair, 0.58), "hair", 4, 2);         // 内层/发缝阴影
  const hairHi  = P.hair2 ? grainMat(P.hair2, "hair", 4, 2) : hairL;   // 挑染 / 银丝层
  const clothM  = grainMat(P.cloth, "cloth", 8, 6);          // 面料：带织纹
  const clothD  = grainMat(shade(P.cloth, 0.80), "cloth", 8, 6);
  const knitM   = grainMat(P.cloth, "cloth", 16, 11);        // 针织：更密的织纹（开衫/毛衣）
  const cloth2M = grainMat(P.cloth2, "cloth", 8, 6);
  const pantsM  = grainMat(P.pants, "cloth", 10, 7);
  const shoeM   = toon(P.shoes || 0x10151c);
  const soleM   = toon(0x0a0e13);
  const accentM = toon(P.accent);
  const darkM   = toon(0x0c131b);
  const whiteM  = toon(0xeef3f8);

  const F = (P.build === "f" || P.outfit === "yoga");   // 女性体型

  const root = new THREE.Group();                       // 脚底原点，面向 +Z
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.05), BLOB_MAT);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.016;
  blob.renderOrder = 2;
  blob.userData.noOutline = true;
  root.add(blob);

  const torso = new THREE.Group();                      // 髋部原点
  torso.position.y = 1.00;
  root.add(torso);

  /* 身材参数：肩宽 / 胸围 / 腰围 / 手臂粗细 / 下颌（0.x 系数，逐角色微调体型）
     hip = 胯宽、face = 脸圆润度、soft = 软肉感（BBW 体态），0 值即旧版比例 */
  const S = { sh: P.shoulder || 1, ch: P.chest || 1, wa: P.waist || 1,
              ar: P.armR || 1, jaw: P.jaw || 1,
              hip: P.hip || 1, face: P.face || 1, soft: P.soft || 0 };
  const waistW = (F ? 1.30 : 0.96) * S.wa * (1 + S.soft * 0.12);
  const hipW   = (F ? 1.70 * S.hip : 1.12 * (0.62 + 0.38 * S.wa)) * (1 + S.soft * 0.06);
  const chestW = (F ? 1.12 : 1.18) * (F ? 1.0 : S.ch) * (1 + S.soft * 0.05);

  /* ---------- 骨盆 / 腰 / 胸腔 ---------- */
  part(torso, new THREE.CylinderGeometry(0.150, 0.150, 0.24, 20), pantsM,
       [0, 0.00, 0], null, [hipW, 1, F ? 0.86 + S.soft * 0.14 : 0.78]);   // 髋
  part(torso, new THREE.CylinderGeometry(0.152, 0.146, 0.22, 20), clothM,
       [0, 0.22, 0], null, [waistW, 1, F ? 0.82 + S.soft * 0.16 : 0.66]); // 腰
  const chest = part(torso, new THREE.CylinderGeometry(0.330, 0.162, 0.42, 22), clothM,
       [0, 0.50, 0], null, [chestW * 1.04, 1, F ? 0.70 + S.soft * 0.10 : 0.60]); // 胸廓
  if (F){
    /* 圆润臀线：BBW 体态的后侧量感（soft=0 时几乎不可见） */
    [-1, 1].forEach(s => part(torso, new THREE.SphereGeometry(0.118 + S.soft * 0.012, 16, 12), pantsM,
         [s * 0.118 * S.hip, -0.055, -0.088], null, [1.0, 0.92, 0.72 + S.soft * 0.14], false));
  }

  /* 腰带 + 扣 */
  part(torso, new THREE.CylinderGeometry(0.156, 0.156, 0.055, 20), toon(0x141a22),
       [0, 0.075, 0], null, [hipW * 1.02, 1, F ? 0.86 : 0.80], false);
  part(torso, new THREE.BoxGeometry(0.055, 0.035, 0.02), toon(0xb9c4d0),
       [0, 0.075, 0.115], null, null, false);

  /* 胸肌 / 胸型（男性：分离双胸 + 胸中线 + 锁骨；女性：随 soft 变化的丰满胸型） */
  if (!F){
    part(torso, new THREE.SphereGeometry(0.162, 24, 16), clothM,
         [0, 0.572, 0.030], null, [1.30, 0.58, 0.72]);
    [-1, 1].forEach(s => part(torso, new THREE.SphereGeometry(0.112 * (0.55 + 0.45 * S.ch), 18, 14), clothM,
         [s * 0.152, 0.560, 0.020], null, [1.0, 0.74, 0.80], false));
    /* 胸中线：左右胸肌之间的浅沟，肌肉感的关键一笔 */
    part(torso, new THREE.BoxGeometry(0.014, 0.106, 0.026), clothD,
         [0, 0.562, 0.158], null, null, false);
    /* 锁骨：脖子下面两道浅棱 */
    [-1, 1].forEach(s => part(torso, new THREE.BoxGeometry(0.115, 0.016, 0.018), skinM,
         [s * 0.072, 0.674, 0.086], [0, 0, s * 0.16], null, false));
  } else {
    const bs = 1 + S.soft * 0.20;
    [-1, 1].forEach(s => {
      part(torso, new THREE.SphereGeometry(0.152 * bs, 22, 16), cloth2M,
           [s * 0.084, 0.588 + S.soft * 0.006, 0.062 + S.soft * 0.014], null,
           [1.00 + S.soft * 0.06, 0.78, 0.70 + S.soft * 0.12]);
    });
  }

  /* 斜方肌 + 三角肌（肩宽随 shoulder 系数变化，肌肉男呈宽肩倒三角） */
  [-1, 1].forEach(s => {
    part(torso, new THREE.SphereGeometry(0.085 * (0.72 + 0.28 * S.sh), 12, 10), clothM,
         [s * 0.115, 0.695, -0.005], null, [1.5, 0.62 + (S.sh - 1) * 0.10, 0.95]);
    part(torso, new THREE.SphereGeometry(0.132, 16, 12), clothM,
         [s * 0.338 * S.sh, 0.645, 0], null, [1.0 * S.sh, 1.02, 1.0]);
  });

  /* ---------- 男性肌肉线条：背阔肌 / 前锯肌 / 腹直肌 / 颈根 ---------- */
  if (!F){
    /* 背阔肌：从腋下向腰收，形成 V 字倒三角（隔着 T 恤也能看出轮廓） */
    [-1, 1].forEach(s => part(torso, new THREE.SphereGeometry(0.150, 18, 14), clothM,
         [s * 0.152 * S.sh, 0.500, -0.086], null, [0.88, 1.08, 0.60], false));
    /* 前锯肌：肋侧三枚小齿 */
    [-1, 1].forEach(s => { for (let i = 0; i < 3; i++)
      part(torso, new THREE.SphereGeometry(0.034, 8, 6), clothM,
           [s * (0.146 - i * 0.012), 0.436 - i * 0.054, 0.070 - i * 0.006], null,
           [0.72, 1.0, 0.60], false); });
    /* 腹直肌：面料下隐约的块面（越往下越收） */
    for (let i = 0; i < 2; i++) [-1, 1].forEach(s =>
      part(torso, new THREE.SphereGeometry(0.044, 10, 8), clothM,
           [s * 0.052, 0.362 - i * 0.074, 0.106 - i * 0.004], null,
           [1.15, 0.82, 0.50], false));
    /* 颈根斜方肌 + 喉结 */
    [-1, 1].forEach(s => part(torso, new THREE.SphereGeometry(0.060, 10, 8), skinM,
         [s * 0.050, 0.700, -0.030], null, [1.25, 0.60, 0.90], false));
    part(torso, new THREE.SphereGeometry(0.019, 10, 8), skinM,
         [0, 0.742, 0.062], null, [1.0, 1.05, 0.85], false);
  }

  /* ---------- BBW 软肉感：小腹 / 腰侧 / 圆肩 ---------- */
  if (F && S.soft > 0){
    part(torso, new THREE.SphereGeometry(0.176, 20, 14), skinM,
         [0, 0.300, 0.052], null, [1.02 + S.soft * 0.08, 0.84, 0.62 + S.soft * 0.14], false);
    [-1, 1].forEach(s => part(torso, new THREE.SphereGeometry(0.086, 14, 10), skinM,
         [s * 0.150 * S.hip, 0.238, -0.008], null, [0.92, 1.12, 0.82], false));
    [-1, 1].forEach(s => part(torso, new THREE.SphereGeometry(0.070, 12, 10), skinM,
         [s * 0.166 * S.sh, 0.652, 0.010], null, [1.0, 0.80, 0.95], false));   // 圆润肩头
  }

  /* ---------- 服装细节 ---------- */
  if (P.outfit === "suit"){
    const shirtM = P.shirt ? toon(P.shirt) : whiteM;
    const tieM   = toon(P.tie || 0x16304a);
    [-1, 1].forEach(s => {
      part(torso, new THREE.BoxGeometry(0.145, 0.52, 0.105), clothD,
           [s * 0.152, 0.42, 0.132], [0, 0, s * 0.05], null);
      /* 驳头（翻领）：上衣亮面，层次更分明 */
      part(torso, new THREE.BoxGeometry(0.075, 0.20, 0.03), clothM,
           [s * 0.105, 0.585, 0.152], [0, 0, s * 0.55], null, false);
      /* 驳头尖角：叠一小片，领型更挺括 */
      part(torso, new THREE.BoxGeometry(0.032, 0.058, 0.028), clothD,
           [s * 0.084, 0.496, 0.156], [0, 0, s * 0.30], null, false);
    });
    part(torso, new THREE.BoxGeometry(0.205, 0.36, 0.045), shirtM,
         [0, 0.555, 0.146], null, null, false);                     // 衬衫
    part(torso, new THREE.BoxGeometry(0.212, 0.30, 0.030), shirtM,
         [0, 0.374, 0.128], null, null, false);                     // 衬衫下摆
    for (let i = 0; i < 3; i++)
      part(torso, new THREE.SphereGeometry(0.008, 6, 5), whiteM,
           [0, 0.63 - i * 0.075, 0.172], null, null, false);
    part(torso, new THREE.BoxGeometry(0.062, 0.28, 0.032), tieM,
         [0, 0.475, 0.170], null, null, false);                     // 领带
    part(torso, new THREE.BoxGeometry(0.085, 0.05, 0.035), tieM,
         [0, 0.635, 0.166], null, null, false);                     // 领带结
    part(torso, new THREE.BoxGeometry(0.072, 0.026, 0.020), tieM,
         [0, 0.338, 0.168], null, null, false);                     // 领带尖
  }
  if (P.outfit === "open"){
    [-1, 1].forEach(s => {
      part(torso, new THREE.BoxGeometry(0.155, 0.54, 0.105), clothM,
           [s * 0.158, 0.42, 0.130], [0, 0, s * 0.06], null);
      part(torso, new THREE.BoxGeometry(0.075, 0.20, 0.03), clothD,
           [s * 0.108, 0.580, 0.150], [0, 0, s * 0.50], null, false);
    });
    part(torso, new THREE.BoxGeometry(0.225, 0.38, 0.045), cloth2M,
         [0, 0.545, 0.142], null, null, false);
    for (let i = 0; i < 3; i++)
      part(torso, new THREE.SphereGeometry(0.007, 6, 5), toon(0xcbd5e1),
           [0, 0.63 - i * 0.078, 0.168], null, null, false);
    /* 项链 */
    part(torso, new THREE.TorusGeometry(0.075, 0.006, 6, 18), toon(0xd4af37),
         [0, 0.665, 0.060], [1.25, 0, 0], null, false);
  }
  if (P.outfit === "hoodie"){
    /* 帽兜：原来是一个 (0.205) 的球体挂在背后 z=-0.185，是整个角色最显眼的"背部凸起" bug，
       而且它带描边壳，鼓包被描边再放大一圈。这里改成贴背披落的两层扁平披片 + 领口环。 */
    part(torso, new THREE.SphereGeometry(0.190, 20, 14), cloth2M,
         [0, 0.552, -0.104], [0.24, 0, 0], [1.15, 0.44, 0.40], false);   // 披在主背上的帽身
    part(torso, new THREE.SphereGeometry(0.152, 18, 12), clothD,
         [0, 0.456, -0.116], [0.36, 0, 0], [1.06, 0.32, 0.32], false);   // 披落的下缘
    part(torso, new THREE.TorusGeometry(0.105, 0.020, 8, 16), clothD,
         [0, 0.680, -0.030], [1.30, 0, 0], null, false);                 // 领口环
    part(torso, new THREE.CylinderGeometry(0.012, 0.012, 0.20, 6), whiteM,
         [-0.045, 0.545, 0.135], [0.18, 0, 0.10], null, false);     // 抽绳
    part(torso, new THREE.CylinderGeometry(0.012, 0.012, 0.20, 6), whiteM,
         [0.048, 0.545, 0.135], [0.18, 0, -0.10], null, false);
    part(torso, new THREE.BoxGeometry(0.21, 0.075, 0.05), clothD,
         [0, 0.315, 0.132], null, null, false);                     // 口袋
  }
  if (P.outfit === "tee"){
    part(torso, new THREE.TorusGeometry(0.088, 0.017, 8, 16), cloth2M,
         [0, 0.680, 0.010], [1.35, 0, 0], null, false);             // 撞色领口
    part(torso, new THREE.BoxGeometry(0.125, 0.150, 0.018), accentM,
         [0, 0.520, 0.150], null, null, false);                      // 胸前印花
    part(torso, new THREE.BoxGeometry(0.086, 0.022, 0.020), cloth2M,
         [0, 0.556, 0.152], null, null, false);                      // 印花横杠
  }
  if (P.outfit === "cozy"){
    /* 针织开衫：两片前襟敞开露出内搭，下摆与袖口做罗纹 */
    [-1, 1].forEach(s => {
      part(torso, new THREE.BoxGeometry(0.150, 0.50, 0.115), knitM,
           [s * 0.150, 0.430, 0.128], [0, 0, s * 0.05], null);
      part(torso, new THREE.BoxGeometry(0.070, 0.17, 0.032), knitM,
           [s * 0.104, 0.600, 0.152], [0, 0, s * 0.52], null, false);   // 翻领
      part(torso, new THREE.CylinderGeometry(0.048, 0.048, 0.036, 14), clothD,
           [s * 0.150, 0.180, 0.128], null, [1.0, 1, 0.94], false);     // 罗纹下摆
      part(torso, new THREE.BoxGeometry(0.014, 0.44, 0.012), clothD,
           [s * 0.083, 0.430, 0.152], null, null, false);              // 前襟针脚
    });
    /* 内搭吊带 + 肩带 */
    part(torso, new THREE.BoxGeometry(0.185, 0.30, 0.038), cloth2M,
         [0, 0.520, 0.152], null, null, false);
    [-1, 1].forEach(s => part(torso, new THREE.CylinderGeometry(0.010, 0.010, 0.16, 6), cloth2M,
         [s * 0.070, 0.640, 0.126], [0, 0, s * 0.16], null, false));
    /* 高腰阔腿裤腰头 */
    part(torso, new THREE.CylinderGeometry(0.168, 0.174, 0.090, 20), pantsM,
         [0, 0.298, 0], null, [1.04, 1, 0.94], false);
    part(torso, new THREE.BoxGeometry(0.030, 0.024, 0.014), toon(0xd9c8a8),
         [0, 0.298, 0.154], null, null, false);
  }
  if (P.apron){
    /* 3DP 工坊半身围裙：腰以下挡料，胸口留空，肌肉线条不被遮住 */
    part(torso, new THREE.BoxGeometry(0.300, 0.300, 0.020), toon(0x2b3a4f),
         [0, 0.180, 0.128], null, null, false);
    part(torso, new THREE.BoxGeometry(0.302, 0.028, 0.026), accentM,
         [0, 0.318, 0.130], null, null, false);                     // 撞色上沿
    part(torso, new THREE.BoxGeometry(0.190, 0.145, 0.016), toon(0x34455c),
         [0, 0.148, 0.140], null, null, false);                     // 前置口袋
    part(torso, new THREE.BoxGeometry(0.054, 0.030, 0.018), toon(0xd8dee6),
         [0.072, 0.194, 0.146], null, null, false);                 // 3DP 铭牌
    part(torso, new THREE.BoxGeometry(0.062, 0.012, 0.012), accentM,
         [-0.052, 0.194, 0.146], null, null, false);
    [-1, 1].forEach(s => part(torso, new THREE.BoxGeometry(0.014, 0.150, 0.012), toon(0x2b3a4f),
         [s * 0.128, 0.232, -0.062], [0, 0, s * 0.30], null, false));  // 后系带
  }
  if (F && P.outfit === "yoga"){
    part(torso, new THREE.CylinderGeometry(0.205, 0.205, 0.06, 20), pantsM,
         [0, 0.435, 0], null, [1.10, 1, 0.86], false);              // 运动内衣下沿
    part(torso, new THREE.CylinderGeometry(0.152, 0.158, 0.18, 20), skinM,
         [0, 0.275, 0], null, [1.02, 1, 0.72]);                     // 腰腹
    part(torso, new THREE.BoxGeometry(0.02, 0.10, 0.02), skinD,
         [0, 0.30, 0.098], null, null, false);                      // 脐
  }

  /* ---------- 服装细节强化（口袋 / 纽扣 / 罗纹 / 缝线） ---------- */
  if (P.outfit === "suit" || P.outfit === "open"){
    part(torso, new THREE.BoxGeometry(0.050, 0.028, 0.012), whiteM,
         [-0.115, 0.598, 0.182], [0, 0, 0.20], null, false);          // 口袋巾
    part(torso, new THREE.SphereGeometry(0.010, 10, 8), toon(0xc9a24a),
         [-0.028, 0.500, 0.188], null, [1, 1, 0.6], false);           // 纽扣
    part(torso, new THREE.SphereGeometry(0.010, 10, 8), toon(0xc9a24a),
         [-0.028, 0.402, 0.190], null, [1, 1, 0.6], false);
    [-1, 1].forEach(s => part(torso, new THREE.BoxGeometry(0.010, 0.014, 0.006), toon(0xd8dee6),
         [s * 0.196, 0.332, 0.146], null, null, false));              // 袖口扣
  }
  if (P.outfit === "tee" || P.outfit === "hoodie"){
    part(torso, new THREE.CylinderGeometry(0.168, 0.172, 0.040, 20), clothD,
         [0, 0.216, 0], null, [1.0, 1, 0.86], false);                 // 下摆罗纹
    [-1, 1].forEach(s => part(torso, new THREE.BoxGeometry(0.032, 0.008, 0.120), clothD,
         [s * 0.122, 0.688, 0.020], [0, 0, s * 0.30], null, false));  // 肩缝
  }
  if (F && P.outfit === "yoga"){
    part(torso, new THREE.CylinderGeometry(0.158, 0.158, 0.030, 20), toon(0x2a2233),
         [0, 0.455, 0], null, [1.22, 1, 0.86], false);                // 紧身裤腰头
    [-1, 1].forEach(s => part(torso, new THREE.BoxGeometry(0.016, 0.105, 0.012),
         toon(shade(P.cloth, 0.92)), [s * 0.056, 0.562, 0.096], [0, 0, s * 0.28], null, false));
  }
  /* 皮带：金属扣 + 皮面（OOTD 的收腰细节） */
  if (P.belt){
    part(torso, new THREE.CylinderGeometry(0.166, 0.170, 0.032, 20), toon(0x2a2320),
         [0, 0.142, 0], null, [1.02, 1, 0.92], false);
    part(torso, new THREE.BoxGeometry(0.046, 0.030, 0.014), toon(0xc9a24a),
         [0, 0.142, 0.132], null, null, false);
    part(torso, new THREE.BoxGeometry(0.020, 0.014, 0.016), toon(0xf0e4c8),
         [0, 0.142, 0.136], null, null, false);
  }

  /* 工牌挂绳 */
  part(torso, new THREE.BoxGeometry(0.016, 0.24, 0.010), toon(0x2b3a4d),
       [-0.062, 0.615, 0.128], [0, 0, 0.22], null, false);
  part(torso, new THREE.BoxGeometry(0.016, 0.24, 0.010), toon(0x2b3a4d),
       [0.062, 0.615, 0.128], [0, 0, -0.22], null, false);
  part(torso, new THREE.BoxGeometry(0.105, 0.075, 0.014), toon(0xdfe7ef),
       [0, 0.472, 0.150], null, null, false);
  part(torso, new THREE.BoxGeometry(0.088, 0.014, 0.016), accentM,
       [0, 0.492, 0.152], null, null, false);
  part(torso, new THREE.BoxGeometry(0.060, 0.006, 0.016), toon(0x9aa8b6),
       [0, 0.462, 0.152], null, null, false);

  /* ---------- 颈 + 头 ---------- */
  const nk = F ? 0 : (S.sh - 1) * 0.55;                            // 肌肉男的粗颈
  part(torso, new THREE.CylinderGeometry(0.060 * (1 + nk), 0.076 * (1 + nk), 0.15, 14), skinM,
       [0, 0.705, 0.005]);
  if (P.outfit === "suit" || P.outfit === "open"){                 // 衬衫领
    part(torso, new THREE.CylinderGeometry(0.084 * (1 + nk * 0.8), 0.088 * (1 + nk * 0.8), 0.055, 16),
         P.shirt ? toon(P.shirt) : whiteM, [0, 0.700, 0.004], null, null, false);
  } else if (P.outfit === "cozy"){                                 // 针织圆领
    part(torso, new THREE.TorusGeometry(0.082, 0.017, 8, 16), knitM,
         [0, 0.698, 0.008], [1.45, 0, 0], null, false);
  }

  const headG = new THREE.Group();
  headG.position.y = 0.885;
  torso.add(headG);

  const headR = 0.116;
  part(headG, new THREE.SphereGeometry(headR, 30, 24), skinM, [0, 0, 0], null, [0.98, 1.06, 1.00]);
  part(headG, new THREE.SphereGeometry(0.078, 24, 18), skinM,
       [0, -0.058, 0.026], null, [0.94 * S.jaw, 0.86, 0.92]);      // 下颌
  part(headG, new THREE.SphereGeometry(0.036, 18, 14), skinM,
       [0, -0.088, 0.052], null, [1.0 * S.jaw, 0.70, 0.80], false); // 下巴
  [-1, 1].forEach(s => {
    part(headG, new THREE.SphereGeometry(0.040, 18, 14), skinM,
         [s * 0.062 * S.jaw, -0.030, 0.058], null, [1.0, 0.85, 0.75], false);   // 颧骨
    part(headG, new THREE.BoxGeometry(0.026, 0.052, 0.030), skinM,
         [s * 0.086 * S.jaw, -0.046, 0.020], [0, 0, s * 0.22], null, false);    // 下颌角
    part(headG, new THREE.SphereGeometry(0.030, 14, 12), skinD,
         [s * 0.084, -0.014, 0.034], null, [0.55, 0.95, 0.55], false);          // 太阳穴过渡阴影
    part(headG, new THREE.SphereGeometry(0.028, 14, 12), skinM,
         [s * 0.052, -0.052, 0.070], null, [1.05, 0.60, 0.45], false);          // 笑肌
    if (!F){                                                                     // 男性：眉骨 + 咬肌，轮廓更硬朗
      part(headG, new THREE.BoxGeometry(0.060, 0.017, 0.024), skinM,
           [s * 0.048, 0.038, 0.094], [0, 0, s * 0.10], null, false);
      part(headG, new THREE.SphereGeometry(0.026, 12, 10), skinM,
           [s * 0.080 * S.jaw, -0.062, 0.026], null, [0.80, 0.90, 0.85], false);
    }
  });
  part(headG, new THREE.BoxGeometry(0.020, 0.052, 0.024), skinM,
       [0, -0.086, 0.056], [0.10, 0, 0], null, false);              // 下巴中脊

  /* 胡茬：下颌 / 唇上 / 鬓角一带的青色阴影层（帅大叔气质） */
  if (P.stubble){
    const stubM = toon(shade(P.hair, 0.62));
    part(headG, new THREE.SphereGeometry(0.079, 22, 16, 0, Math.PI * 2, Math.PI * 0.60, Math.PI * 0.40), stubM,
         [0, -0.056, 0.024], null, [0.95 * S.jaw, 0.88, 0.93], false);
    part(headG, new THREE.BoxGeometry(0.050, 0.011, 0.014), stubM,
         [0, -0.056, 0.092], null, null, false);                    // 唇上
    [-1, 1].forEach(s => part(headG, new THREE.BoxGeometry(0.020, 0.058, 0.030), stubM,
         [s * 0.090, -0.026, 0.028], [0, 0, s * 0.20], null, false));  // 鬓角胡
  }

  /* 眼：眼白 + 虹膜 + 瞳孔 + 高光；眨眼用整体 Y 压缩模拟 */
  const eyes = [];
  const brows = [];
  const irisM  = toon(P.iris  || 0x2a1d12);
  const lipM   = toon(P.lip   || 0xc9806e);
  const lipD   = toon(shade(P.lip || 0xc9806e, 0.78));
  const browM  = toon(P.brow  || shade(P.hair, 1.10));
  const blushM = toon(P.blush || shade(P.skin, 1.06));
  const lashM  = toon(0x120e0a);
  const scleraM = toon(0xf4f8fc);

  /* 眼：眼白 + 虹膜环 + 虹膜 + 瞳孔 + 双高光 + 眼睑/睫毛（眨眼整体 Y 压缩） */
  [-1, 1].forEach(s => {
    const eye = new THREE.Group();
    eye.position.set(s * 0.047, 0.010, 0.088);
    headG.add(eye);
    part(eye, new THREE.SphereGeometry(0.0245, 14, 12), scleraM,
         [0, 0, 0], null, [0.92, 1.0, 0.62], false);
    part(eye, new THREE.TorusGeometry(0.0138, 0.0032, 8, 20), toon(shade(P.iris || 0x2a1d12, 0.70)),
         [0, -0.001, 0.011], null, [1, 1, 0.60], false);              // 虹膜外环
    part(eye, new THREE.SphereGeometry(0.0132, 14, 12), irisM,
         [0, -0.001, 0.011], null, [1, 1, 0.52], false);              // 虹膜
    part(eye, new THREE.SphereGeometry(0.0062, 10, 8), toon(0x08090c),
         [0, -0.001, 0.0165], null, [1, 1, 0.5], false);              // 瞳孔
    part(eye, new THREE.SphereGeometry(0.0050, 8, 6), toon(0xffffff),
         [s * 0.008, 0.009, 0.019], null, null, false);               // 主高光
    part(eye, new THREE.SphereGeometry(0.0026, 6, 5), toon(0xdff1ff),
         [-s * 0.007, -0.008, 0.018], null, null, false);             // 副高光
    part(eye, new THREE.BoxGeometry(0.052, 0.016, 0.016), skinM,
         [0, 0.021, 0.002], [0.18, 0, 0], null, false);               // 上眼睑
    part(eye, new THREE.BoxGeometry(0.050, 0.008, 0.012), lashM,
         [0, 0.026, 0.006], [0, 0, -s * 0.05], null, false);          // 上睑线
    for (let i = 0; i < 3; i++){                                       // 睫毛（外眼角渐长）
      part(eye, new THREE.BoxGeometry(0.010, 0.0035, 0.006), lashM,
           [s * (0.020 + i * 0.004), 0.028 + i * 0.002, 0.008],
           [0, 0, -s * (0.30 + i * 0.16)], null, false);
    }
    part(eye, new THREE.BoxGeometry(0.044, 0.005, 0.010), skinD,
         [0, -0.020, 0.006], null, null, false);                       // 下眼睑
    part(eye, new THREE.SphereGeometry(0.0058, 8, 6), skinD,
         [-s * 0.021, -0.002, 0.006], [0, 0, 0], [1, 0.8, 0.6], false); // 内眼角
    eyes.push(eye);

    /* 眉：三段式拱形 */
    const bx = s * 0.047, by = 0.052;
    [[-s * 0.013, 0.000, 0.024, 0.012, s * 0.34],
     [0, 0.004, 0.026, 0.013, s * 0.06],
     [s * 0.015, 0.003, 0.021, 0.010, -s * 0.20]].forEach(([dx, dy, w, h, rz]) => {
      brows.push(part(headG, new THREE.BoxGeometry(w, h, 0.013), browM,
        [bx + dx, by + dy, 0.099], [0, 0, rz], null, false));
    });
    /* 眼窝阴影 + 卧蚕 */
    part(headG, new THREE.BoxGeometry(0.050, 0.010, 0.010), skinD,
         [s * 0.047, 0.040, 0.100], [0, 0, s * 0.10], null, false);
    part(headG, new THREE.SphereGeometry(0.016, 10, 8), skinM,
         [s * 0.047, -0.022, 0.098], null, [1.30, 0.42, 0.30], false);
    /* 腮红 */
    part(headG, new THREE.SphereGeometry(0.030, 12, 10), blushM,
         [s * 0.058, -0.030, 0.094], null, [1.0, 0.62, 0.24], false);
  });
  /* 鼻：鼻根 + 鼻梁 + 鼻头 + 鼻翼 + 鼻孔 */
  part(headG, new THREE.BoxGeometry(0.020, 0.030, 0.022), skinM,
       [0, 0.016, 0.094], [0.20, 0, 0], null, false);
  part(headG, new THREE.BoxGeometry(0.024, 0.056, 0.026), skinM,
       [0, -0.006, 0.096], [0.12, 0, 0], null, false);
  part(headG, new THREE.SphereGeometry(0.019, 12, 10), skinM,
       [0, -0.030, 0.106], null, [1.05, 0.85, 0.95], false);
  [-1, 1].forEach(s => {
    part(headG, new THREE.SphereGeometry(0.0085, 8, 6), skinD,
         [s * 0.014, -0.038, 0.100], null, [1, 0.70, 0.80], false);
    part(headG, new THREE.SphereGeometry(0.0048, 6, 5), toon(shade(P.skin, 0.62)),
         [s * 0.0125, -0.043, 0.0995], null, [1, 0.8, 0.7], false);
  });
  /* 嘴：人中 + 唇珠 + 上下唇 + 唇线 + 可开合口腔 + 下巴窝 */
  part(headG, new THREE.BoxGeometry(0.004, 0.017, 0.008), skinD,
       [0, -0.046, 0.098], null, null, false);
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.068, 0.096);
  headG.add(mouth);
  part(mouth, new THREE.BoxGeometry(0.040, 0.0035, 0.010), lipD,
       [0, 0.002, 0.002], null, null, false);                          // 唇线
  [-1, 1].forEach(s => part(mouth, new THREE.BoxGeometry(0.020, 0.010, 0.014), lipM,
       [s * 0.010, 0.008, 0], [0, 0, s * 0.16], null, false));         // 上唇两瓣
  part(mouth, new THREE.SphereGeometry(0.0075, 8, 6), lipM,
       [0, 0.010, 0.004], null, [1.1, 0.75, 0.8], false);              // 唇珠
  part(mouth, new THREE.SphereGeometry(0.023, 12, 10), lipM,
       [0, -0.007, 0.002], null, [1.0, 0.52, 0.62], false);            // 下唇（饱满）
  part(mouth, new THREE.SphereGeometry(0.006, 6, 5), toon(0xffffff),
       [0.006, -0.009, 0.008], null, [1.2, 0.5, 0.5], false);          // 唇部高光
  const mouthIn = part(mouth, new THREE.BoxGeometry(0.036, 0.024, 0.010), toon(0x3a1a17),
       [0, 0.0, -0.004], null, [1, 0.02, 1], false);
  part(headG, new THREE.SphereGeometry(0.014, 10, 8), skinD,
       [0, -0.100, 0.070], null, [1.4, 0.30, 0.50], false);            // 下巴窝
  /* 耳：耳廓 + 耳窝 + 耳垂 */
  [-1, 1].forEach(s => {
    part(headG, new THREE.SphereGeometry(0.026, 12, 10), skinM,
         [s * 0.112, -0.008, -0.004], null, [0.52, 1.0, 0.85], false);
    part(headG, new THREE.SphereGeometry(0.014, 8, 6), skinD,
         [s * 0.114, -0.010, -0.002], null, [0.40, 0.80, 0.70], false);
    part(headG, new THREE.TorusGeometry(0.019, 0.0042, 6, 14, Math.PI * 1.25), skinD,
         [s * 0.114, -0.002, -0.002], [0, s * 1.57, 0.5], null, false);  // 耳廓
    part(headG, new THREE.SphereGeometry(0.0105, 8, 6), skinM,
         [s * 0.111, -0.026, -0.004], null, [0.55, 0.9, 0.8], false);    // 耳垂
  });

  /* ---------- 发型（分层 + 碎发 + 发际线，更接近真人） ---------- */
  const hs = P.hairStyle || "short";
  const hairDark = toon(shade(P.hair, 0.72));
  /* 发壳/帽壳"面部让位"（取值见配置中心 CONFIG.head）：避免头发、冷帽盖住眼睛/眉/鼻 */
  const hairSquash = CONFIG.head.hairFrontSquash, hairShift = CONFIG.head.hairFrontShift;
  if (hs === "swept"){                                    // 背头（公司组）
    part(headG, new THREE.SphereGeometry(headR + 0.014, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.60),
         hairM, [0, 0.004, -0.008 - hairShift], null, [1.04, 1.10, 1.06 * hairSquash]);
    for (let i = 0; i < 3; i++){                          // 顶部三层向后梳的发片
      part(headG, new THREE.BoxGeometry(0.198 - i * 0.014, 0.030, 0.118 - i * 0.016), i ? hairM : hairL,
           [0, 0.096 - i * 0.027, 0.048 - i * 0.032], [0.26 + i * 0.12, 0, 0], null, false);
    }
    part(headG, new THREE.BoxGeometry(0.005, 0.006, 0.088), hairDark,
         [-0.016, 0.114, 0.018], [0.10, 0, 0], null, false);           // 侧分线
    [-1, 1].forEach(s => {
      part(headG, new THREE.BoxGeometry(0.030, 0.082, 0.058), hairM,
           [s * 0.108, 0.028, 0.008], [0, 0, s * 0.10], null, false);  // 两鬓
      part(headG, new THREE.SphereGeometry(0.026, 10, 8), hairM,
           [s * 0.098, -0.014, 0.026], null, [0.62, 1.20, 0.80], false); // 鬓角
    });
    part(headG, new THREE.BoxGeometry(0.150, 0.058, 0.050), hairM,
         [0, 0.016, -0.112], null, null, false);                       // 后颈发脚
  } else if (hs === "fade"){                              // 渐变短寸
    part(headG, new THREE.SphereGeometry(headR + 0.009, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.56),
         hairM, [0, 0.002, -hairShift], null, [1.03, 1.05, 1.02 * hairSquash]);
    part(headG, new THREE.SphereGeometry(headR + 0.004, 20, 16, 0, Math.PI * 2, Math.PI * 0.30, Math.PI * 0.22),
         hairDark, [0, 0.002, -hairShift], null, [1.01, 1.0, 1.0 * hairSquash], false);  // 渐变过渡层
    for (let i = 0; i < 4; i++){                                       // 顶部发丝
      part(headG, new THREE.BoxGeometry(0.026, 0.008, 0.062), hairL,
           [-0.045 + i * 0.030, 0.098, 0.026], [0.20, 0, (i - 1.5) * 0.10], null, false);
    }
    part(headG, new THREE.BoxGeometry(0.150, 0.020, 0.030), hairDark,
         [0, 0.088, 0.078], [0.30, 0, 0], null, false);                // 发际线
    [-1, 1].forEach(s => part(headG, new THREE.SphereGeometry(0.022, 10, 8), hairM,
         [s * 0.096, -0.016, 0.030], null, [0.55, 1.05, 0.75], false)); // 鬓角
    part(headG, new THREE.BoxGeometry(0.140, 0.046, 0.040), hairDark,
         [0, -0.032, -0.092], null, [1, 1, 0.85], false);               // 后颈发脚（短寸也需要，否则后脑露肤色）
  } else if (hs === "curl"){                              // 卷发
    part(headG, new THREE.SphereGeometry(headR + 0.018, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
         hairM, [0, 0.006, -0.004 - hairShift], null, [1.10, 1.14, 1.10 * hairSquash]);
    for (let i = 0; i < 20; i++){
      const ang = (i / 20) * Math.PI * 2 + (i % 3) * 0.10;
      const layer = i % 2;
      const rr = (0.104 + (i % 3) * 0.013) * (layer ? 0.86 : 1.0);
      part(headG, new THREE.SphereGeometry(0.027 + (i % 2) * 0.009, 10, 8), layer ? hairL : hairM,
           [Math.sin(ang) * rr, (layer ? 0.098 : 0.070) + Math.cos(ang * 2) * 0.018,
            Math.cos(ang) * rr * 0.95 - 0.010], null, null, false);
    }
    for (let i = 0; i < 3; i++){                                       // 额前卷
      part(headG, new THREE.SphereGeometry(0.024, 10, 8), hairM,
           [-0.045 + i * 0.045, 0.078, 0.088], null, [1, 0.9, 0.8], false);
    }
    [-1, 1].forEach(s => part(headG, new THREE.SphereGeometry(0.024, 10, 8), hairM,
         [s * 0.100, -0.012, 0.028], null, [0.7, 1.1, 0.8], false));
    /* 层次挑染卷：夹在深色卷之间，光感更有层次 */
    for (let i = 0; i < 6; i++){
      const ang = (i / 6) * Math.PI * 2 + 0.4;
      part(headG, new THREE.SphereGeometry(0.019, 8, 6), hairHi,
           [Math.sin(ang) * 0.108, 0.086 + Math.cos(ang * 3) * 0.014,
            Math.cos(ang) * 0.098 - 0.008], null, null, false);
    }
    /* 外翘碎发：耳侧几撮不服帖 */
    [-1, 1].forEach(s => {
      part(headG, new THREE.CapsuleGeometry(0.013, 0.042, 6, 10), hairHi,
           [s * 0.114, 0.036, 0.030], [0.30, 0, s * 0.55], null, false);
      part(headG, new THREE.CapsuleGeometry(0.011, 0.034, 6, 10), hairM,
           [s * 0.106, -0.048, 0.010], [0.16, 0, s * 0.40], null, false);
    });
  } else if (hs === "ponytail"){                          // 高马尾（协调员）
    part(headG, new THREE.SphereGeometry(headR + 0.014, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.62),
         hairM, [0, 0.002, -0.006 - hairShift], null, [1.06, 1.10, 1.06 * hairSquash]);
    part(headG, new THREE.SphereGeometry(0.098, 16, 12), hairM,
         [0, 0.020, -0.070], null, [1.0, 1.05, 0.72], false);          // 后脑发量
    part(headG, new THREE.SphereGeometry(0.088, 16, 12), hairM,
         [0, -0.045, -0.088], null, [1.0, 0.85, 0.60], false);
    part(headG, new THREE.BoxGeometry(0.200, 0.034, 0.070), hairL,
         [0, 0.092, 0.056], [0.22, 0, 0], null, false);                // 刘海发片
    [-1, 1].forEach(s => {
      part(headG, new THREE.BoxGeometry(0.026, 0.090, 0.062), hairM,
           [s * 0.112, 0.016, -0.004], [0, 0, s * 0.12], null, false); // 侧发
      part(headG, new THREE.BoxGeometry(0.020, 0.070, 0.046), hairM,
           [s * 0.108, -0.030, 0.012], [0.10, 0, s * 0.16], null, false); // 耳前碎发
    });
    part(headG, new THREE.TorusGeometry(0.027, 0.011, 8, 16), accentM,
         [0, 0.064, -0.122], [0.30, 0, 0], null, false);               // 发圈
    if (P.bow){                                                       // 蝴蝶结发饰
      [-1, 1].forEach(s => part(headG, new THREE.SphereGeometry(0.030, 12, 10), cloth2M,
           [s * 0.046, 0.066, -0.130], null, [1.0, 0.72, 0.55], false));
      part(headG, new THREE.SphereGeometry(0.013, 8, 6), cloth2M,
           [0, 0.066, -0.134], null, null, false);
      part(headG, new THREE.BoxGeometry(0.010, 0.026, 0.008), toon(0xd9a8b4),
           [-0.012, 0.044, -0.146], [0.18, 0, 0.25], null, false);     // 飘带
      part(headG, new THREE.BoxGeometry(0.010, 0.024, 0.008), toon(0xd9a8b4),
           [0.012, 0.046, -0.146], [0.18, 0, -0.25], null, false);
    }
    part(headG, new THREE.CapsuleGeometry(0.046, 0.20, 10, 16), hairM,
         [0, -0.031, -0.215], [0.46, 0, 0], null, false);              // 马尾主体（根部仍咬在发根球上，尾部外倾避开上衣后背）
    part(headG, new THREE.SphereGeometry(0.056, 12, 10), hairM,
         [0, 0.062, -0.150], null, [1, 0.9, 0.9], false);              // 发根
    part(headG, new THREE.CapsuleGeometry(0.036, 0.10, 8, 14), hairL,
         [0, -0.105, -0.255], [0.60, 0, 0], null, false);              // 发梢分层
    part(headG, new THREE.CapsuleGeometry(0.021, 0.09, 8, 12), hairL,
         [0.030, -0.175, -0.285], [0.72, 0, 0.12], null, false);       // 碎发
    part(headG, new THREE.BoxGeometry(0.20, 0.030, 0.02), accentM,
         [0, 0.086, 0.058], [0.18, 0, 0], null, false);                // 发带
    part(headG, new THREE.BoxGeometry(0.13, 0.05, 0.042), hairDark,
         [0, -0.034, -0.096], null, null, false);                      // 后颈碎发（避免后脑露肤色）
  } else if (hs === "sidePart"){                          // 侧分背头（韩日帅大叔）
    part(headG, new THREE.SphereGeometry(headR + 0.015, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.58),
         hairM, [0, 0.006, -0.004 - hairShift], null, [1.05, 1.12, 1.06 * hairSquash]);
    /* 大侧背片：向斜后方梳，越上层越亮 */
    for (let i = 0; i < 3; i++){
      part(headG, new THREE.BoxGeometry(0.198 - i * 0.016, 0.028, 0.118 - i * 0.018), i === 1 ? hairHi : hairM,
           [0.008, 0.098 - i * 0.026, 0.044 - i * 0.030], [0.24 + i * 0.10, 0, 0.05], null, false);
    }
    part(headG, new THREE.BoxGeometry(0.006, 0.009, 0.100), hairD,
         [-0.030, 0.116, 0.014], [0.12, 0, 0.16], null, false);        // 侧分缝
    part(headG, new THREE.BoxGeometry(0.086, 0.028, 0.074), hairHi,
         [0.062, 0.112, 0.046], [0.26, 0, -0.10], null, false);        // 顶部高光斜片
    [-1, 1].forEach(s => {
      part(headG, new THREE.BoxGeometry(0.028, 0.084, 0.058), hairM,
           [s * 0.110, 0.030, 0.006], [0, 0, s * 0.10], null, false);  // 两鬓
      part(headG, new THREE.SphereGeometry(0.025, 10, 8), hairM,
           [s * 0.099, -0.014, 0.026], null, [0.60, 1.22, 0.80], false); // 鬓角
      part(headG, new THREE.BoxGeometry(0.011, 0.068, 0.020), hairHi,
           [s * 0.118, 0.050, 0.020], [0, 0, s * 0.12], null, false);  // 侧发高光丝
    });
    part(headG, new THREE.BoxGeometry(0.152, 0.060, 0.052), hairM,
         [0, 0.012, -0.114], null, null, false);                       // 后颈发脚
    part(headG, new THREE.BoxGeometry(0.122, 0.028, 0.040), hairD,
         [0, -0.026, -0.098], null, [1, 1, 0.85], false);
  } else if (hs === "taperFade"){                         // 低位渐变 + 逗号刘海（年轻韩系）
    part(headG, new THREE.SphereGeometry(headR + 0.011, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.58),
         hairM, [0, 0.002, -hairShift], null, [1.03, 1.06, 1.02 * hairSquash]);
    /* 渐变过渡带：耳上收薄压暗 */
    part(headG, new THREE.SphereGeometry(headR + 0.004, 20, 16, 0, Math.PI * 2, Math.PI * 0.34, Math.PI * 0.20),
         hairD, [0, 0.002, -hairShift], null, [1.01, 1.0, 1.0 * hairSquash], false);
    [-1, 1].forEach(s => part(headG, new THREE.SphereGeometry(0.021, 10, 8), hairD,
         [s * 0.096, -0.020, 0.028], null, [0.52, 1.0, 0.72], false)); // 收窄鬓角
    /* 逗号刘海：两撮向内勾的发片，中间留缝 */
    [-1, 1].forEach(s => {
      part(headG, new THREE.BoxGeometry(0.060, 0.026, 0.052), hairM,
           [s * 0.042, 0.086, 0.070], [0.45, 0, s * 0.25], null, false);
      part(headG, new THREE.SphereGeometry(0.019, 10, 8), hairM,
           [s * 0.050, 0.072, 0.084], null, [1.0, 0.72, 0.66], false); // 逗号钩
      part(headG, new THREE.BoxGeometry(0.013, 0.006, 0.026), hairHi,
           [s * 0.028, 0.098, 0.064], [0.42, 0, s * 0.25], null, false); // 发丝高光
    });
    /* 顶上蓬松：三束翘起 */
    for (let i = 0; i < 3; i++)
      part(headG, new THREE.SphereGeometry(0.029, 10, 8), hairM,
           [-0.040 + i * 0.040, 0.112 + (i % 2) * 0.008, 0.020 - i * 0.014], [0.20, 0, 0], null, false);
    part(headG, new THREE.BoxGeometry(0.144, 0.050, 0.042), hairD,
         [0, -0.030, -0.094], null, [1, 1, 0.85], false);              // 后颈发脚
  } else if (hs === "wolfcut"){                           // 狼尾层次（银发帅大叔）
    part(headG, new THREE.SphereGeometry(headR + 0.020, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.60),
         hairM, [0, 0.008, -0.004 - hairShift], null, [1.08, 1.14, 1.08 * hairSquash]);
    /* 上层蓬松：交错两排大卷，银丝层穿插 */
    for (let i = 0; i < 12; i++){
      const ang = (i / 12) * Math.PI * 2;
      const up = i % 2;
      const rr = 0.112 + (i % 3) * 0.010;
      part(headG, new THREE.SphereGeometry(0.032 + (i % 2) * 0.008, 10, 8), up ? hairHi : hairM,
           [Math.sin(ang) * rr, (up ? 0.098 : 0.072) + Math.cos(ang * 2) * 0.014,
            Math.cos(ang) * rr * 0.92 - 0.012], null, null, false);
    }
    /* 两侧鬃状长片 + 后颈狼尾 */
    [-1, 1].forEach(s => {
      part(headG, new THREE.BoxGeometry(0.030, 0.118, 0.070), hairHi,
           [s * 0.112, -0.008, -0.016], [0, 0, s * 0.10], null, false);
      part(headG, new THREE.BoxGeometry(0.024, 0.082, 0.048), hairM,
           [s * 0.108, -0.060, -0.032], [0.14, 0, s * 0.14], null, false);  // 层次碎尾
    });
    part(headG, new THREE.CapsuleGeometry(0.062, 0.10, 10, 14), hairM,
         [0, -0.070, -0.112], [0.30, 0, 0], null, false);              // 后颈尾发
    part(headG, new THREE.CapsuleGeometry(0.038, 0.07, 8, 12), hairHi,
         [0.036, -0.104, -0.120], [0.40, 0, 0.16], null, false);       // 挑染碎尾
    part(headG, new THREE.BoxGeometry(0.188, 0.028, 0.086), hairHi,
         [0, 0.104, 0.038], [0.22, 0, 0], null, false);                // 额前蓬松片
  } else {
    part(headG, new THREE.SphereGeometry(headR + 0.012, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
         hairM, [0, 0.006, -0.010 - hairShift], null, [1.06, 1.12, 1.08 * hairSquash]);
    part(headG, new THREE.SphereGeometry(headR + 0.006, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.42),
         hairDark, [0, 0.004, -0.008 - hairShift], null, [1.02, 1.03, 1.03 * hairSquash], false);
    [-1, 1].forEach(s => part(headG, new THREE.SphereGeometry(0.024, 10, 8), hairM,
         [s * 0.100, -0.010, 0.024], null, [0.68, 1.08, 0.80], false));
    part(headG, new THREE.BoxGeometry(0.142, 0.050, 0.042), hairDark,
         [0, -0.030, -0.094], null, [1, 1, 0.85], false);              // 后颈发脚（避免后脑露肤色）
  }

  /* 配饰：眼镜（方框 / 金丝圆框） */
  if (P.glasses || P.roundGlasses){
    const frameM = toon(P.roundGlasses ? 0xc9a24a : 0xb9c4d0);
    const lensR  = P.roundGlasses ? 0.0315 : 0.030;
    [-1, 1].forEach(s => {
      part(headG, new THREE.TorusGeometry(lensR, P.roundGlasses ? 0.0034 : 0.0042, 8, 18), frameM,
           [s * 0.047, 0.010, 0.104], null, [1.0, P.roundGlasses ? 0.90 : 0.86, 1.0], false);
      part(headG, new THREE.BoxGeometry(0.038, 0.005, 0.005), frameM,
           [s * 0.100, 0.014, 0.062], [0, s * 0.45, 0], null, false);   // 镜腿
      part(headG, new THREE.BoxGeometry(0.010, 0.006, 0.010), frameM,
           [s * 0.022, 0.004, 0.100], null, null, false);               // 鼻托
    });
    part(headG, new THREE.BoxGeometry(P.roundGlasses ? 0.038 : 0.030, 0.005, 0.005), frameM,
         [0, 0.014, 0.112], null, null, false);                         // 鼻梁架
  }
  /* 耳饰：珍珠钉 + 小环 */
  if (P.earrings){
    [-1, 1].forEach(s => {
      part(headG, new THREE.SphereGeometry(0.0095, 10, 8), toon(0xf3e6c0),
           [s * 0.112, -0.034, -0.004], null, null, false);
      part(headG, new THREE.TorusGeometry(0.0072, 0.002, 6, 12), toon(0xf3e6c0),
           [s * 0.112, -0.044, -0.004], [0, s * 1.57, 0], null, false);
    });
  }
  if (P.beanie){
    /* 帽沿原本压到眼睛以下（theta 0.52π），这里抬到眉线以上，翻边同步上移 */
    part(headG, new THREE.SphereGeometry(headR + 0.030, 18, 14, 0, Math.PI * 2, 0, Math.PI * CONFIG.head.beanieEdgeTheta),
         cloth2M, [0, 0.010, -0.004], null, [1.04, 1.05, 1.04]);
    /* 翻边环半径/位置按帽壳切口对齐，避免帽壳边缘与翻边之间出现硬切缝隙 */
    part(headG, new THREE.TorusGeometry(CONFIG.head.beanieBrimR, 0.020, 8, 20), clothM,
         [0, CONFIG.head.beanieBrimY, -0.004], [1.57, 0, 0], null, false);
  }
  if (P.headband){
    /* 原来水平环在眉线高度横切面部；改为沿颅骨斜面后倾（前高后低），前缘抬到发际线、贴合额头 */
    part(headG, new THREE.TorusGeometry(0.112, 0.014, 8, 20), accentM,
         [0, 0.040, -0.004], [Math.PI / 2 - CONFIG.head.headbandTilt, 0, 0], null, false).scale.set(1, 1, 0.72);
  }
  if (P.headphones){
    part(headG, new THREE.TorusGeometry(0.126, 0.011, 8, 20, Math.PI), toon(0x1f2937),
         [0, 0.010, -0.006], [0, 0, 0], null, false);
    [-1, 1].forEach(s => {
      part(headG, new THREE.CylinderGeometry(0.045, 0.045, 0.028, 12), toon(0x111827),
           [s * 0.126, -0.006, 0.004], [0, 0, Math.PI / 2], null, false);
      part(headG, new THREE.CylinderGeometry(0.030, 0.030, 0.030, 12), toon(0x374151),
           [s * 0.141, -0.006, 0.004], [0, 0, Math.PI / 2], null, false);
    });
    part(headG, new THREE.BoxGeometry(0.010, 0.006, 0.05), accentM,
         [-0.150, -0.006, 0.030], null, null, false);
  }

  /* ---------- 手臂 ---------- */
  const arms = {}, hands = {};
  [-1, 1].forEach(s => {
    const arm = new THREE.Group();
    arm.position.set(s * 0.366 * S.sh, 0.620, 0);
    arm.rotation.z = s * (F ? 0.10 : 0.13);
    torso.add(arm);

    const upperR = (F ? 0.070 : 0.086) * (F ? 1.0 : S.ar);
    const foreR  = (F ? 0.047 : 0.060) * (F ? 1.0 : S.ar);
    const sleeve = (P.outfit === "cozy") ? knitM
                 : (P.outfit === "suit" || P.outfit === "hoodie" ||
                    P.outfit === "tee"  || P.outfit === "open") ? clothM : skinM;
    const longSleeve = (P.outfit === "suit" || P.outfit === "hoodie" || P.outfit === "cozy");

    /* 肩：三角肌（男硬朗）/ 圆润肩头（女） */
    part(arm, new THREE.SphereGeometry(upperR + (F ? 0.012 : 0.016), 12, 10), sleeve,
         [0, 0.008, 0], null, [1.0, F ? 0.96 : 1.02, 1.0], false);

    if (P.outfit === "tee" || P.outfit === "hoodie"){
      part(arm, new THREE.CylinderGeometry(upperR + 0.014, upperR + 0.011, 0.18, 14), sleeve, [0, -0.090, 0]);
      part(arm, new THREE.TorusGeometry(upperR + 0.016, 0.008, 6, 14), toon(shade(P.cloth, 0.85)),
           [0, -0.180, 0], [1.57, 0, 0], null, false);                 // 袖口罗纹
      const u = limb(arm, 0.20, upperR, foreR, skinM); u.position.y = -0.17;
      arm.add(u);
    } else if (P.outfit === "suit"){
      const u = limb(arm, 0.30, upperR, foreR, sleeve);
      arm.add(u);
      /* 卷起的袖口 + 袖扣 */
      part(arm, new THREE.TorusGeometry(foreR + 0.016, 0.013, 8, 14), clothD,
           [0, -0.255, 0], [1.57, 0, 0], null, false);
      part(arm, new THREE.CylinderGeometry(0.008, 0.008, 0.005, 8), accentM,
           [0, -0.252, foreR + 0.017], [1.57, 0, 0], null, false);
    } else if (P.outfit === "cozy"){
      const u = limb(arm, 0.30, upperR, foreR, knitM);
      arm.add(u);
      part(arm, new THREE.TorusGeometry(foreR + 0.015, 0.017, 8, 16), toon(shade(P.cloth, 0.88)),
           [0, -0.268, 0], [1.57, 0, 0], null, false);                 // 针织罗纹袖口
    } else {
      const u = limb(arm, 0.30, upperR, foreR, sleeve);
      arm.add(u);
      if (P.outfit === "open"){                                        // 亚麻衬衫：卷两折袖
        part(arm, new THREE.TorusGeometry(foreR + 0.015, 0.014, 8, 16), clothM,
             [0, -0.248, 0], [1.57, 0, 0], null, false);
        part(arm, new THREE.TorusGeometry(foreR + 0.010, 0.012, 8, 16), clothM,
             [0, -0.222, 0], [1.57, 0, 0], null, false);
      } else {
        part(arm, new THREE.TorusGeometry(0.086, 0.018, 8, 16), clothD,
             [0, -0.055, 0], [1.57, 0, 0], null, false);               // 短袖口
      }
      part(arm, new THREE.SphereGeometry(0.070 * (F ? 0.9 : 1.0), 12, 10), skinM,
           [0, -0.115, 0.010], null, [1.0, 0.9, 0.95], false);         // 肱二头肌
      if (!F) part(arm, new THREE.SphereGeometry(0.052, 10, 8), skinM,
           [0, -0.085, -0.030], null, [1.0, 1.25, 0.70], false);       // 肱三头肌
    }

    const elbow = new THREE.Group();
    elbow.position.y = -0.30;
    arm.add(elbow);
    const fab = limb(elbow, 0.285, foreR, foreR * 0.86, longSleeve ? sleeve : skinM);
    elbow.add(fab);
    /* 裸露前臂：肱桡肌起伏 + 手腕收细 */
    if (!longSleeve){
      if (!F) part(elbow, new THREE.SphereGeometry(foreR * 1.02, 10, 8), skinM,
           [0, -0.085, 0.004], null, [1.0, 1.55, 0.95], false);
      part(elbow, new THREE.SphereGeometry(foreR * 0.78, 10, 8), skinM,
           [0, -0.286, 0], null, [1.0, 0.72, 1.0], false);            // 腕骨
    }

    /* 手：掌 + 掌垫 + 四指（指根/指节/指尖）+ 拇指 */
    const hand = new THREE.Group();
    hand.position.y = -0.315;
    elbow.add(hand);
    part(hand, new THREE.BoxGeometry(foreR * 1.35, 0.075, foreR * 1.9), skinM,
         [0, -0.030, 0.006], null, null, false);
    part(hand, new THREE.SphereGeometry(0.017, 8, 6), skinM,
         [s * 0.012, -0.024, 0.018], null, [1.0, 1.30, 0.60], false);   // 掌垫（拇指球）
    part(hand, new THREE.SphereGeometry(0.016, 8, 6), skinM,
         [s * -0.014, -0.052, 0.020], null, [1.0, 1.15, 0.60], false);  // 掌根
    /* 四指：指根 → 指节 两级分组，可按姿态做真实握持（捏/握/松） */
    const fingers = [];
    for (let i = 0; i < 4; i++){
      const fx = -0.020 + i * 0.0145;
      const fg = new THREE.Group();
      fg.position.set(fx, -0.070, 0.004);
      fg.userData.k = 0.72 + i * 0.10;                               // 食指最活、小指偏僵
      hand.add(fg);
      part(fg, new THREE.SphereGeometry(0.0078, 8, 6), skinM, [0, 0, 0], null, null, false);
      part(fg, new THREE.CylinderGeometry(0.0085, 0.0079, 0.028, 6), skinM,
           [0, -0.015, 0.001], [0.10, 0, 0], null, false);
      const mid = new THREE.Group();                                 // 指节（第二关节）
      mid.position.set(0, -0.028, 0.003);
      mid.userData.k = 1.05;
      fg.add(mid);
      part(mid, new THREE.SphereGeometry(0.0085, 6, 5), skinM, [0, 0, 0], null, null, false);
      part(mid, new THREE.CylinderGeometry(0.0079, 0.0072, 0.026, 6), skinM,
           [0, -0.014, 0.002], [0.16, 0, 0], null, false);
      part(mid, new THREE.SphereGeometry(0.0070, 6, 5), skinM,
           [0, -0.027, 0.006], null, [1.0, 0.62, 1.0], false);        // 指尖
      part(mid, new THREE.SphereGeometry(0.0058, 6, 5), toon(shade(P.skin, 1.06)),
           [0, -0.021, 0.010], null, [1.0, 0.55, 0.35], false);       // 指甲基底
      fg.userData.mid = mid;
      fingers.push(fg);
    }
    /* 拇指：单独一组，可对指抓握 */
    const thumb = new THREE.Group();
    thumb.position.set(s * -0.028, -0.058, 0.016);
    thumb.userData.base = 0.30;
    thumb.rotation.set(0.30, 0, s * 0.55);
    hand.add(thumb);
    part(thumb, new THREE.CylinderGeometry(0.0105, 0.0095, 0.048, 6), skinM, [0, -0.020, 0], null, null, false);
    part(thumb, new THREE.SphereGeometry(0.0088, 6, 5), skinM, [0, -0.042, 0.009], null, null, false);
    hand.userData.fingers = fingers;
    hand.userData.thumb = thumb;
    hand.userData.palm = true;
    hand.traverse(o => { if (o.isMesh) o.userData.noOutline = true; });
    /* 腕表 */
    if (P.watch){
      part(elbow, new THREE.TorusGeometry(foreR * 0.95, 0.0075, 6, 14), toon(0x111827),
           [0, -0.255, 0], [1.57, 0, 0], null, false);
      part(elbow, new THREE.CylinderGeometry(0.019, 0.019, 0.012, 12), accentM,
           [0, -0.255, -foreR * 0.95], [1.57, 0, 0], null, false);
    }

    arm.userData.elbow = elbow;
    arm.userData.side = s;
    arms[s < 0 ? "L" : "R"] = arm;
    hands[s < 0 ? "L" : "R"] = hand;
  });

  /* ---------- 腿 ---------- */
  const legs = {};
  [-1, 1].forEach(s => {
    const leg = new THREE.Group();
    leg.position.set(s * (F ? 0.125 : 0.118), -0.02, 0);
    torso.add(leg);

    const thighR = F ? 0.150 : 0.118;
    const calfR  = F ? 0.098 : 0.078;
    const t = limb(leg, 0.46, thighR, calfR * 1.05, pantsM);
    leg.add(t);
    /* 裤缝 / 褶皱 */
    part(leg, new THREE.BoxGeometry(0.012, 0.30, 0.012), toon(shade(P.pants, 0.82)),
         [s * 0.006, -0.20, 0.096], [0.03, 0, 0], null, false);

    const knee = new THREE.Group();
    knee.position.y = -0.46;
    leg.add(knee);
    const c = limb(knee, 0.42, calfR, calfR * 0.78, pantsM);
    knee.add(c);

    const shorts = (P.outfit !== "suit") && !F;                    // 短裤装（可打印性/失效/优化组）：小腿露肤
    if (shorts){
      part(knee, new THREE.CylinderGeometry(calfR * 0.92, calfR * 0.80, 0.40, 14), skinM,
           [0, -0.205, 0], null, null, false);
      /* 裤脚翻边：让短裤有厚度，不再像"截断的柱子" */
      part(knee, new THREE.CylinderGeometry(calfR * 1.16, calfR * 1.10, 0.055, 16), toon(shade(P.pants, 1.06)),
           [0, 0.012, 0], null, null, false);
    } else {
      /* 西装裤脚折线 / 阔腿裤脚口 */
      part(knee, new THREE.CylinderGeometry(calfR * 1.14, calfR * 1.06, 0.045, 16), toon(shade(P.pants, 0.88)),
           [0, -0.372, 0], null, null, false);
    }

    /* 运动袜：高筒袜/中筒袜/隐形袜三档 */
    if (shorts){
      const st = P.socksStyle || "mid";
      const sockHi = (st === "high" || st === "neon");
      const sockCol = st === "neon" ? 0xcdf24f : (P.socks || shade(P.pants, 0.74));
      const sockH = sockHi ? 0.19 : (st === "no" ? 0.05 : 0.11);
      part(knee, new THREE.CylinderGeometry(calfR * 0.95, calfR * 0.86, sockH, 14), toon(sockCol),
           [0, -0.412 + sockH * 0.5, 0], null, null, false);
      if (sockHi){
        part(knee, new THREE.TorusGeometry(calfR * 0.93, 0.009, 8, 16), toon(shade(sockCol, 0.84)),
             [0, -0.412 + sockH, 0], [Math.PI / 2, 0, 0], null, false);   // 袜口罗纹
      }
    }
    part(knee, new THREE.SphereGeometry(calfR * 0.86, 10, 8), skinM, [0, -0.415, 0], null, [1, 0.8, 1], false);

    /* 踝关节分组：脚掌可相对小腿旋转（走路的提踵/落地） */
    const ankle = new THREE.Group();
    ankle.position.y = -0.455;
    knee.add(ankle);

    /* 鞋：按 shoeStyle 分型（乐福鞋 / 跑鞋 / 基础板鞋） */
    const shoe = new THREE.Group();
    ankle.add(shoe);
    const style = P.shoeStyle || "sneaker";
    if (style === "loafer"){
      /* 尖头乐福鞋：鞋身收窄、鞋头前伸、跟部略抬 */
      part(shoe, new THREE.BoxGeometry(0.122, 0.062, 0.268), shoeM, [0, 0.032, 0.048]);
      part(shoe, new THREE.SphereGeometry(0.060, 12, 10), shoeM, [0, 0.028, 0.162], null, [1.0, 0.60, 1.30], false);
      part(shoe, new THREE.BoxGeometry(0.132, 0.026, 0.300), soleM, [0, -0.006, 0.048], null, null, false);
      part(shoe, new THREE.BoxGeometry(0.098, 0.020, 0.020), toon(0x1b1f26),
           [0, 0.062, -0.014], null, null, false);                // 鞋跟围条
      part(shoe, new THREE.BoxGeometry(0.070, 0.014, 0.016), toon(0x9a7a44),
           [0, 0.066, 0.056], null, null, false);                 // 鞋面横带（金属扣）
    } else if (style === "runner"){
      /* 轻量跑鞋：厚中底 + 荧光侧条 + 上翘鞋头 */
      part(shoe, new THREE.BoxGeometry(0.128, 0.070, 0.262), shoeM, [0, 0.034, 0.042]);
      part(shoe, new THREE.BoxGeometry(0.142, 0.052, 0.292), toon(0xe9eef4), [0, -0.014, 0.042], null, null, false);
      part(shoe, new THREE.SphereGeometry(0.062, 12, 10), shoeM, [0, 0.024, 0.164], null, [1.0, 0.66, 1.18], false);
      part(shoe, new THREE.BoxGeometry(0.010, 0.014, 0.130), toon(P.accent),
           [s * 0.066, 0.040, 0.050], null, null, false);         // 荧光侧条
      part(shoe, new THREE.BoxGeometry(0.092, 0.010, 0.048), toon(0xe8eef4),
           [0, 0.072, 0.020], null, null, false);                 // 鞋舌
      part(shoe, new THREE.BoxGeometry(0.084, 0.008, 0.012), toon(0xdbe4ec),
           [0, 0.064, 0.062], null, null, false);
    } else {
      part(shoe, new THREE.BoxGeometry(0.128, 0.075, 0.265), shoeM, [0, 0.030, 0.042]);
      part(shoe, new THREE.BoxGeometry(0.138, 0.038, 0.295), soleM, [0, -0.014, 0.042], null, null, false);
      part(shoe, new THREE.SphereGeometry(0.064, 12, 10), shoeM, [0, 0.010, 0.140], null, [1.0, 0.72, 1.0], false);
      part(shoe, new THREE.BoxGeometry(0.10, 0.010, 0.055), toon(0xe8eef4),
           [0, 0.066, 0.020], null, null, false);                 // 鞋舌
      part(shoe, new THREE.BoxGeometry(0.088, 0.008, 0.012), toon(0xdbe4ec),
           [0, 0.058, 0.062], null, null, false);                 // 鞋带
      part(shoe, new THREE.BoxGeometry(0.088, 0.008, 0.012), toon(0xdbe4ec),
           [0, 0.052, 0.040], null, null, false);
    }

    leg.userData.knee = knee;
    leg.userData.ankle = ankle;
    leg.userData.shoe = shoe;          // 落地校正用：取鞋底世界包围盒最低点
    legs[s < 0 ? "L" : "R"] = leg;
  });

  /* ---------- 手持道具 ---------- */
  const props = {};
  const mkProp = (name, build) => {
    const g = new THREE.Group();
    build(g);
    g.visible = false;
    g.traverse(o => { if (o.isMesh) o.userData.noOutline = true; });
    arms.R.userData.elbow.add(g);
    g.position.set(0, -0.33, 0.03);
    props[name] = g;
  };
  mkProp("cup", g => {
    part(g, new THREE.CylinderGeometry(0.036, 0.030, 0.10, 12), toon(0xf5f7fa), [0, 0, 0], null, null, false);
    part(g, new THREE.CylinderGeometry(0.038, 0.038, 0.016, 12), toon(0xd9b38c), [0, 0.052, 0], null, null, false);
    part(g, new THREE.TorusGeometry(0.026, 0.007, 6, 12), toon(0xf5f7fa), [0.040, 0.005, 0], [0, 1.57, 0], null, false);
  });
  mkProp("phone", g => {
    part(g, new THREE.BoxGeometry(0.050, 0.098, 0.010), toon(0x11161d), [0, 0, 0], null, null, false);
    part(g, new THREE.BoxGeometry(0.042, 0.086, 0.004),
         new THREE.MeshBasicMaterial({ color: 0x8fd4ff, fog: false }), [0, 0, 0.006], null, null, false);
  });
  mkProp("tablet", g => {
    part(g, new THREE.BoxGeometry(0.115, 0.155, 0.010), toon(0x1b2431), [0, 0, 0], null, null, false);
    part(g, new THREE.BoxGeometry(0.100, 0.138, 0.004),
         new THREE.MeshBasicMaterial({ color: 0x63d6ff, fog: false }), [0, 0, 0.006], null, null, false);
  });
  mkProp("tool", g => {
    part(g, new THREE.BoxGeometry(0.030, 0.090, 0.022), toon(0x93a9c0), [0, 0, 0], null, null, false);
    part(g, new THREE.BoxGeometry(0.052, 0.026, 0.026), toon(0x1f2937), [0, 0.050, 0], null, null, false);
  });
  mkProp("camera", g => {         /* 记录打印件的相机 */
    part(g, new THREE.BoxGeometry(0.088, 0.060, 0.048), toon(0x1f2937), [0, 0, 0], null, null, false);
    part(g, new THREE.CylinderGeometry(0.026, 0.030, 0.040, 14), toon(0x0b1017),
         [0, 0, 0.042], [1.57, 0, 0], null, false);
    part(g, new THREE.CylinderGeometry(0.017, 0.017, 0.006, 12),
         new THREE.MeshBasicMaterial({ color: 0x9fd8ff, fog: false }), [0, 0, 0.064], [1.57, 0, 0], null, false);
    part(g, new THREE.BoxGeometry(0.030, 0.020, 0.010), toon(0x475569), [0, 0.038, 0], null, null, false);
  });
  mkProp("dumbbell", g => {       /* 健身房哑铃 */
    part(g, new THREE.CylinderGeometry(0.011, 0.011, 0.135, 10), toon(0x9aa7b6), [0, 0, 0], [0, 0, 1.57], null, false);
    [-1, 1].forEach(s => {
      part(g, new THREE.CylinderGeometry(0.038, 0.038, 0.052, 14), toon(0x2b3542),
           [s * 0.078, 0, 0], [0, 0, 1.57], null, false);
      part(g, new THREE.CylinderGeometry(0.030, 0.030, 0.016, 12), toon(0x64748b),
           [s * 0.056, 0, 0], [0, 0, 1.57], null, false);
    });
  });

  mkProp("kettlebell", g => {     /* 健身器材：壶铃（单手摇摆） */
    part(g, new THREE.SphereGeometry(0.072, 14, 12), toon(0x343b45), [0, -0.034, 0], null, [1, 0.86, 1], false);
    part(g, new THREE.CylinderGeometry(0.030, 0.046, 0.024, 14), toon(0x1f2937), [0, 0.026, 0], null, null, false);
    part(g, new THREE.TorusGeometry(0.046, 0.011, 8, 14, Math.PI), toon(0x8894a6), [0, 0.032, 0], null, null, false);
  });

  mkProp("caliper", g => {        /* 几何分析：数显卡尺 */
    part(g, new THREE.BoxGeometry(0.030, 0.112, 0.014), toon(0x94a3b8), [0, 0, 0], null, null, false);
    part(g, new THREE.BoxGeometry(0.020, 0.044, 0.010),
         new THREE.MeshBasicMaterial({ color: 0x5eead4, fog: false }), [0, 0.020, 0.010], null, null, false);
    part(g, new THREE.BoxGeometry(0.070, 0.026, 0.010), toon(0x64748b), [0, 0.048, 0], null, null, false);
    part(g, new THREE.BoxGeometry(0.014, 0.060, 0.014), toon(0x64748b), [0.030, -0.038, 0], null, null, false);
    part(g, new THREE.BoxGeometry(0.014, 0.060, 0.014), toon(0x475569), [-0.030, 0.020, 0], null, null, false);
  });
  mkProp("loupe", g => {          /* 失效分析：放大镜（看断口） */
    part(g, new THREE.TorusGeometry(0.036, 0.0075, 8, 18), toon(0xcbd5e1), [0, 0.030, 0], null, null, false);
    part(g, new THREE.CylinderGeometry(0.034, 0.034, 0.006, 16),
         new THREE.MeshBasicMaterial({ color: 0xbdf3ff, transparent: true, opacity: 0.45, fog: false }),
         [0, 0.030, 0], [1.57, 0, 0], null, false);
    part(g, new THREE.CylinderGeometry(0.008, 0.009, 0.060, 8), toon(0x334155), [0, -0.010, 0], null, null, false);
  });
  mkProp("spool", g => {          /* 可打印性：耗材料盘（换料/装料） */
    part(g, new THREE.CylinderGeometry(0.066, 0.066, 0.052, 18), toon(0x0ea5e9), [0, 0, 0], [1.57, 0, 0], null, false);
    part(g, new THREE.CylinderGeometry(0.070, 0.070, 0.006, 18), toon(0x1f2937), [0, 0.028, 0], [1.57, 0, 0], null, false);
    part(g, new THREE.CylinderGeometry(0.070, 0.070, 0.006, 18), toon(0x1f2937), [0, -0.028, 0], [1.57, 0, 0], null, false);
    part(g, new THREE.CylinderGeometry(0.019, 0.019, 0.070, 10), toon(0x64748b), [0, 0, 0], [1.57, 0, 0], null, false);
    part(g, new THREE.TorusGeometry(0.062, 0.008, 6, 16), toon(0x38bdf8), [0, 0.030, 0], null, null, false);
  });

  /* 需要双手同时持用的道具：在左手再挂一份同款（卧推哑铃 / 料盘） */
  ["dumbbell", "spool"].forEach(n => {
    const src = props[n];
    if (!src) return;
    const g = src.clone(true);
    g.visible = false;
    arms.L.userData.elbow.add(g);
    g.position.copy(src.position);
    props[n + "L"] = g;
  });
  root.scale.setScalar(P.height / 1.86);

  headG.userData.eyes = eyes;
  headG.userData.mouth = mouth;
  headG.userData.mouthIn = mouthIn;
  return { root, torso, head: headG, arms, legs, hands, props, cfg: P,
           celebrateStyle: Math.floor(Math.random() * 3) };
}

/* ---------------- 组装场景实体 ---------------- */
/* P0-2：状态机（8 态）
   宿主可推：idle | running | done | error | waiting | report | recalibrating | debating
   本机派生：deepIdle（长时间空闲后去茶水间 / 健身区，受 ?leisure=0 总开关约束）
   优先级（高 → 低）：error > waiting > running(=recalibrating=debating) > report > done > deepIdle
   低优先级不得覆盖高优先级：要么等高优先级态保鲜期（STATE_TTL）走完，要么显式 clearAgent(k)。
   recalibrating / debating 复用 running 的动作与屏幕，只换气泡文案。 */
const AGENT_STATES = ["idle", "running", "done", "error", "waiting",
                      "report", "recalibrating", "debating"];
const STATE_PRIO = { error: 5, waiting: 4,
                     running: 3, recalibrating: 3, debating: 3,
                     report: 2, done: 1, idle: 0, deepIdle: 0 };
/* 高优先级态的保鲜期（秒）：宿主中途断连时，画面不会永久钉在 error / waiting */
const STATE_TTL = { error: 40, waiting: 90, report: 15 };
/* 状态 → 姿态（全部复用既有动作，不新增骨骼系统） */
const STATE_MODE = { error: "inspect", waiting: "think", report: "carry" };
/* 故障指示灯（东墙，两台打印机之间）与围观站位 */
const FAULT_AT    = [11.05, 7.15];
const FAULT_STAND = [[10.50, 7.10], [9.95, 7.15], [10.50, 7.42], [9.95, 7.40]];
/* 文件托盘（南侧走道）与放置站位 */
const TRAY_AT     = [6.00, 11.25];
const TRAY_STAND  = [[5.45, 10.55], [6.55, 10.55], [6.00, 10.45], [6.05, 10.85]];
const AGENT_ORDER = ["geometry", "printability", "failure", "optimization"];

/* 状态账本：st=当前状态 / prio=当前优先级 / left=高优先级态剩余保鲜时间
   P1-a：账本条目改为"用则补"的动态入口 ensureStateEntry(k)，
   插件角色（访客）注册时自动进账；四道工序 + 协调员的初值行为完全不变 */
const stateMeta = {};
function ensureStateEntry(k){
  if (!stateMeta[k]) stateMeta[k] = { st: "idle", prio: 0, left: 0 };
  return stateMeta[k];
}
AGENT_ORDER.forEach(k => ensureStateEntry(k));

/* ?leisure=0 关闭 deepIdle 氛围行为（默认开启但温和：同屏最多 2 人外出） */
let leisure = !/[?&]leisure=0(&|$|\b)/.test(location.search);

const state = {
  geometry:     "idle", printability: "idle",
  failure:      "idle", optimization: "idle",
  consensus:    "idle"
};

const characters = {};

function centerFacing(x, z){ return Math.atan2(CX - x, CZ - z); }

function homeSpot(k){
  const [x, z] = DESK_AT[k];
  const dx = x - CX, dz = z - CZ;
  const L = Math.hypot(dx, dz) || 1;
  return [x + (dx / L) * 1.7, z + (dz / L) * 1.7];
}

const AGENT_META = {
  geometry:     { name: "几何分析 Agent",  role: "解析顶点 / 面片 / 包围盒，给模型做几何体检" },
  printability: { name: "可打印性 Agent",  role: "检测悬垂与最小壁厚，并负责送件、盯机" },
  failure:      { name: "失效模式 Agent",  role: "枚举潜在失效模式，评估风险等级" },
  optimization: { name: "优化建议 Agent",  role: "生成结构优化建议与改模方案" },
  coordinator:  { name: "协调员",          role: "串联四道工序，主持共识台" }
};

Object.keys(DESK_AT).forEach((k, idx) => {
  const [dx, dz] = DESK_AT[k];
  const facing = centerFacing(dx, dz);          // 桌子朝向房间中心
  const P = PALETTE[k];
  const fx = Math.sin(facing), fz = Math.cos(facing);

  const desk = makeDesk(P.accent, facing, k);
  desk.position.set(dx, 0, dz);
  desk.userData.tip = { title: AGENT_META[k].name + " 的工位",
                        desc: AGENT_META[k].role, color: P.accent };
  scene.add(desk);
  addObst(dx, dz, 0.92, 0.46, facing, "desk", 0.30);      // 桌子碰撞体：角色绕行

  /* 椅子放在工位外侧，角色入座后面朝自己的屏幕 */
  const seatX = dx - fx * 0.85, seatZ = dz - fz * 0.85;
  const chair = makeChair(facing);
  chair.position.set(seatX, 0, seatZ);
  chair.userData.tip = { title: "工位椅", desc: "可升降人体工学椅", color: 0x35455a };
  scene.add(chair);

  const [hx, hz] = homeSpot(k);
  const ch = buildCharacter(Object.assign({}, P, { height: P.height }));
  ch.root.position.set(hx, 0, hz);
  ch.root.rotation.y = facing;
  ch.home = [hx, hz];
  ch.seat = [seatX, seatZ];
  ch.facing = facing;
  ch.current = [hx, hz];
  ch.offset = idx * 1.7;
  ch.key = k;
  ch.name = AGENT_META[k].name;
  ch.role = AGENT_META[k].role;
  ch.desk = desk;
  ch.chair = chair;
  ch.deskPos = [dx, dz];
  ch.stage = { code: "", hold: 0 };
  ch.busy = false;
  ch.act = null;
  ch.actTimer = 6 + Math.random() * 10;
  ch.root.userData.tip = { title: ch.name, desc: ch.role, color: P.accent, prio: 3 };
  scene.add(ch.root);
  characters[k] = ch;
});

/* 第五位：协调员（瑜伽服），站在中央台旁 */
{
  const P = PALETTE.coordinator;
  const ch = buildCharacter(Object.assign({}, P, { height: P.height }));
  const sx = CX + 2.45, sz = CZ - 0.30;
  const face = centerFacing(sx, sz) + 0.30;
  ch.root.position.set(sx, 0, sz);
  ch.root.rotation.y = face;
  ch.home = [sx, sz];
  ch.seat = [sx, sz];
  ch.current = [sx, sz];
  ch.offset = 2.6;
  ch.facing = face;
  ch.isHost = true;
  ch.key = "coordinator";
  ch.name = AGENT_META.coordinator.name;
  ch.role = AGENT_META.coordinator.role;
  ch.stage = { code: "", hold: 0 };
  ch.busy = false;
  ch.act = null;
  ch.actTimer = 5 + Math.random() * 8;
  ch.root.userData.tip = { title: ch.name, desc: ch.role, color: P.accent, prio: 3 };
  scene.add(ch.root);
  characters.coordinator = ch;
}

/* ---------------------------------------------------------------------
   P0-3：悬停信息卡的宿主数据（阶段 / 进度 / 置信度 / 输出摘要）
   - 只做暂存 + 渲染，不参与任何运动 / 状态机逻辑；
   - 归一化后进度、置信度统一成 0–100 百分数，取不到的字段留空（卡片标"未采集"），不填默认值；
   - 宿主用 __office.setAgentMeta(k, meta) 推送（兼容 office-event 的 d.meta 与站点 AgentTelemetry
     的 currentPhase / workbenchState.output），传空 = 清空并回落"角色名 + 职责"标签；
   - 角色回到 idle（clearAgent）时一并清除，另有 META_TTL 兜底，避免宿主断连后卡片挂死。
   --------------------------------------------------------------------- */
const META_TTL = 120;
const agentMeta = {};                    // k -> { phase, progress, confidence, digest, left }

function normalizeAgentMeta(meta){
  if (!meta || typeof meta !== "object") return null;
  const pct = v => {
    const n = typeof v === "number" ? v : parseFloat(v);
    if (!isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n > 0 && n <= 1 ? n * 100 : n)));
  };
  const txt = v => (typeof v === "string" && v.trim()) ? v.trim() : null;
  const wb = meta.workbenchState || {};
  const out = {
    phase: txt(meta.phase) || txt(meta.currentPhase) || txt(meta.stage),
    progress: pct(meta.progress),
    confidence: pct(meta.confidence),
    digest: txt(meta.digest) || txt(meta.output) || txt(meta.summary) ||
            txt(wb.output) || txt(wb.model)
  };
  if (out.phase == null && out.progress == null &&
      out.confidence == null && out.digest == null) return null;
  out.left = META_TTL;
  return out;
}

/* 宿主推送卡片数据：返回是否被采纳（数据全空 → 清空该角色，卡片回落角色名标签） */
function setAgentMeta(k, meta){
  if (!characters[k]) return false;
  const norm = normalizeAgentMeta(meta);
  if (norm) agentMeta[k] = norm; else delete agentMeta[k];
  return !!norm;
}

function decayAgentMeta(dt){
  Object.keys(agentMeta).forEach(k => {
    const m = agentMeta[k];
    if (!m) return;
    m.left -= dt;
    if (m.left <= 0) delete agentMeta[k];
  });
}

/* =====================================================================
   打印区：大型工业打印机 + 桌面 3D 打印机
   两台都靠东侧贴墙摆放（x≈11），正面朝房间内（-X），
   操作位在 x≈10 的通道上，从工位走过去不会穿过中央共识台。
   ===================================================================== */
const PRINT_AT = {
  big:  [11.00, 5.60],
  desk: [10.80, 8.70]
};
const PRINT_STAND = {
  big:  [10.00, 5.60],
  desk: [10.00, 8.70]
};
const PRINT_ROT = -Math.PI / 2;                    // 正面朝 -X

/* 打印机碰撞体：角色只能站在机前，绝不穿机器 */
addObst(PRINT_AT.big[0],  PRINT_AT.big[1],  0.93, 0.65, PRINT_ROT, "printerBig", 0.28);
addObst(PRINT_AT.desk[0], PRINT_AT.desk[1], 0.78, 0.42, PRINT_ROT, "printerDesk", 0.24);

/* P0-3：机身料卷与机型工况（悬停信息卡与打印机屏幕共用同一份数据，避免两处数字打架）。
   层高（layerH）现有数据源里没有对应字段，卡片如实标"未采集"，不虚构加工参数。 */
const FILAMENT = { material: "PLA", remainPct: 72 };
const MACHINE_PROFILE = {
  big:  { title: "X1 工业机", totalLayers: 420, layerPerPct: 4.2,
          minPerPct: 0.42, chamberC: 38 },
  desk: { title: "A1 桌面机" }
};

const printJobs = {
  big:  { state: "idle", progress: 0, model: "", nozzleT: null, bedT: null,
          part: "", batchNo: 0, seq: 0, seqTotal: 0, doneT: 0 },
  desk: { state: "idle", progress: 0, model: "", nozzleT: null, bedT: null,
          part: "", batchNo: 0, seq: 0, seqTotal: 0, doneT: 0 }
};
const printers = {};

function roundRectPath(ctx, x, y, w, h, r){
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/* =====================================================================
   打印机上方浮牌：两种牌共用一套 canvas 模板
   - title 牌：默认隐藏，只有鼠标悬停 / 点击机器时才显示
   - progress 牌：有打印任务时显示，字号放大到 100% 缩放下可读
   版面参数集中在 PLATE_STYLE，改样式只动这一处
   ===================================================================== */
const PLATE_STYLE = {
  title:    { cw: 560, ch: 160, pw: 1.78, ph: 0.51 },
  progress: { cw: 640, ch: 260, pw: 2.16, ph: 0.88 }
};

/* 机器提示条：文案走 i18n；titleKey 一并保留，方便切换语言时统一刷新 */
function machineTip(key, color){
  const mKey = key === "bigPrinter" ? "big" : key === "deskPrinter" ? "desk" : null;
  return { titleKey: "tip." + key, machine: mKey,   // machine：悬停时点亮该机器上方浮牌
           title: t("tip." + key + ".title"),
           desc:  t("tip." + key + ".desc"), color };
}

/* P0-3：打印件的悬停信息卡（材料 / 温度 / 层 / 时长 / 批次）。
   数据全部来自现有 printJobs + PART_LIB + FILAMENT/MACHINE_PROFILE；取不到的字段如实标"未采集"。
   where：chamber=热床上的件 / held=手里抱着的件 / sample=工位上的二次分析样品 */
function partTipWhereText(where){
  return where === "chamber" ? t("card.whereChamber")
       : where === "held"    ? t("card.whereHeld")
                             : t("card.whereSample");
}
function partRows(k, where){
  const job = printJobs[k] || {}, PROF = MACHINE_PROFILE[k] || {}, rows = [];
  rows.push([t("card.material"),
             FILAMENT.material + " · " + t("card.spool") + " " + FILAMENT.remainPct + "%"]);
  if (where === "chamber"){
    rows.push([t("card.nozzle"), job.nozzleT == null ? null : job.nozzleT + " °C"]);
    rows.push([t("card.bed"),    job.bedT    == null ? null : job.bedT    + " °C"]);
    if (PROF.chamberC != null) rows.push([t("card.chamber"), PROF.chamberC + " °C"]);
    if (job.state === "printing"){
      if (PROF.totalLayers != null)
        rows.push([t("card.layers"),
                   Math.round(job.progress * PROF.layerPerPct) + " / " + PROF.totalLayers]);
      if (PROF.minPerPct != null)
        rows.push([t("card.remain"),
                   "≈ " + Math.max(0, Math.round((100 - job.progress) * PROF.minPerPct)) + " min"]);
    }
    if (job.batchNo)
      rows.push([t("card.batch"), "#" + job.batchNo + " · " + job.seq + "/" + job.seqTotal]);
  } else {
    rows.push([t("card.source"), PROF.title || k]);
  }
  /* 现有数据源没有层高字段 → 明示"未采集"，不编造 */
  rows.push([t("card.layerH"), null]);
  return rows;
}
function partTip(k, key, where){
  const def = PART_LIB[key] || PART_LIB.gear || {};
  const PROF = MACHINE_PROFILE[k] || {};
  return {
    title: def.name || (printJobs[k] || {}).model || k,
    desc: (where === "chamber" && PROF.title)
            ? partTipWhereText(where) + " · " + PROF.title
            : partTipWhereText(where),
    prio: 4, machine: k, where,
    badge: where === "chamber" ? () => plateStateText(printJobs[k] || {}) : null,
    rows: () => partRows(k, where)
  };
}

/* 切语言后刷新所有带 titleKey 的提示条（机器 / 未来插件物件） */
function refreshTips(){
  scene.traverse(o => {
    const tp = o.userData && o.userData.tip;
    if (tp && tp.titleKey){
      tp.title = t(tp.titleKey + ".title");
      tp.desc  = t(tp.titleKey + ".desc");
    }
  });
}

function makePlate(kind, title){
  const st = PLATE_STYLE[kind];
  const canvas = document.createElement("canvas");
  canvas.width = st.cw; canvas.height = st.ch;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(st.pw, st.ph),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false,
      depthWrite: false, toneMapped: false }));
  mesh.userData = { canvas, tex, kind, titleKey: title || "", key: "" };
  mesh.userData.noOutline = true;
  mesh.renderOrder = 6;
  mesh.visible = false;              // 默认隐藏：title 靠悬停，progress 靠任务状态
  return mesh;
}

function plateTone(job){
  return job.state === "done" ? "#34d399"
       : job.state === "printing" ? "#fbbf24"
       : job.state === "upload" ? "#38bdf8" : "#7f93a8";
}

function plateStateText(job){
  if (job.state === "printing") return t("printer.printing");
  if (job.state === "done") return t("printer.done");
  if (job.state === "upload") return t("printer.upload");
  return t("printer.idle");
}

function plateSubText(job){
  if (!job.model) return t("printer.noTask");
  const tag = job.seq
    ? t("printer.batch") + " #" + job.batchNo + " · " + job.seq + "/" + job.seqTotal + " · "
    : "";
  const line = tag + job.model;
  return line.length > 42 ? line.slice(0, 41) + "…" : line;
}

/* 标题牌（悬停 / 点击才显示）：文案按 titleKey 走 i18n，切语言自动重绘 */
function drawTitlePlate(mesh, job){
  const { canvas, tex } = mesh.userData;
  const title = t(mesh.userData.titleKey);
  const key = "T|" + mesh.userData.titleKey + "|" + LOCALE;
  if (mesh.userData.key === key) return;
  mesh.userData.key = key;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(10,18,28,0.82)";
  roundRectPath(ctx, 2, 2, W - 4, H - 4, 20); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = "rgba(120,190,240,0.55)"; ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "600 40px -apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif";
  ctx.fillStyle = "#eaf4ff";
  ctx.fillText(title, W / 2, 58);
  ctx.font = "500 26px -apple-system, 'PingFang SC', sans-serif";
  ctx.fillStyle = "rgba(150,182,212,0.95)";
  ctx.fillText(t("printer.hint"), W / 2, 112);
  tex.needsUpdate = true;
}

/* 进度牌（有任务才显示，超大字号：状态 36px / 百分比 68px） */
function drawProgressPlate(mesh, job){
  const { canvas, tex } = mesh.userData;
  const key = "P|" + LOCALE + "|" + job.state + "|" + Math.round(job.progress) + "|" + plateSubText(job);
  if (mesh.userData.key === key) return;
  mesh.userData.key = key;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(10,18,28,0.84)";
  roundRectPath(ctx, 2, 2, W - 4, H - 4, 22); ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = plateTone(job); ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = "600 36px -apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif";
  ctx.fillStyle = "#dce8f4";
  ctx.fillText(plateStateText(job), 28, 52);

  if (job.state !== "idle"){
    ctx.textAlign = "right";
    ctx.fillStyle = plateTone(job);
    ctx.font = "800 68px -apple-system, 'Helvetica Neue', sans-serif";
    ctx.fillText(job.state === "done" ? "100%" : Math.round(job.progress) + "%", W - 28, 54);
  }

  const bx = 28, by = 116, bw = W - 56, bh = 38;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRectPath(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
  const fillW = bw * Math.max(0, Math.min(100, job.progress)) / 100;
  if (fillW > 0){
    ctx.fillStyle = plateTone(job);
    roundRectPath(ctx, bx, by, Math.max(bh, fillW), bh, bh / 2); ctx.fill();
  }

  ctx.textAlign = "left";
  ctx.font = "500 28px -apple-system, 'PingFang SC', sans-serif";
  ctx.fillStyle = "rgba(186,208,230,0.88)";
  ctx.fillText(plateSubText(job), 28, 194);
  tex.needsUpdate = true;
}

function makePrintLabel(title){ return makePlate("title", title); }
function makePrintProgress(){ return makePlate("progress", ""); }
function drawPrintLabel(mesh, job){
  if (mesh.userData.kind === "progress") drawProgressPlate(mesh, job);
  else drawTitlePlate(mesh, job);
}

/* 打印件材质：带层纹的卡通材质 */
function layeredMat(color){
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  x.fillStyle = "#" + new THREE.Color(color).getHexString();
  x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 64; i += 4){
    x.fillStyle = "rgba(0,0,0,0.22)"; x.fillRect(0, i, 64, 1);
    x.fillStyle = "rgba(255,255,255,0.10)"; x.fillRect(0, i + 2, 64, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  const m = toon(0xffffff);
  m.map = t;
  return m;
}

/* 程序化微观质感贴图：皮肤毛孔 / 面料织纹 / 发丝（近白低对比，乘在卡通材质上提升真人感） */
function grainTex(kind){
  if (GRAIN_TEX[kind]) return GRAIN_TEX[kind];
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, 128, 128);
  let i;
  if (kind === "skin"){
    for (i = 0; i < 1500; i++){
      x.fillStyle = "rgba(90,60,40," + (Math.random() * 0.055).toFixed(3) + ")";
      x.fillRect(Math.random() * 128, Math.random() * 128, 1.7, 1.7);
    }
    for (i = 0; i < 260; i++){
      x.fillStyle = "rgba(255,255,255,0.05)";
      x.fillRect(Math.random() * 128, Math.random() * 128, 2.2, 1.6);
    }
  } else if (kind === "cloth"){
    for (i = 0; i < 128; i += 3){
      x.fillStyle = "rgba(0,0,0,0.05)";  x.fillRect(i, 0, 1, 128);
      x.fillStyle = "rgba(255,255,255,0.04)"; x.fillRect(0, i, 128, 1);
    }
    for (i = 0; i < 400; i++){
      x.fillStyle = "rgba(0,0,0," + (Math.random() * 0.03).toFixed(3) + ")";
      x.fillRect(Math.random() * 128, Math.random() * 128, 2, 1);
    }
  } else {                                   /* hair：竖向发丝 */
    for (i = 0; i < 128; i += 2){
      x.fillStyle = "rgba(0,0,0," + (0.05 + Math.random() * 0.07).toFixed(3) + ")";
      x.fillRect(i, 0, 1, 128);
    }
    for (i = 0; i < 110; i++){
      x.fillStyle = "rgba(255,255,255,0.055)";
      x.fillRect(Math.random() * 128, Math.random() * 128, 1, 12);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  GRAIN_TEX[kind] = t;
  return t;
}
function grainMat(color, kind, rx, ry){
  const m = toon(color);
  const t = grainTex(kind);
  t.repeat.set(rx || 2, ry || rx || 2);
  m.map = t;
  return m;
}

/* 机器自带的小控制屏 */
function makePanel(w, h){
  const canvas = document.createElement("canvas");
  canvas.width = 320; canvas.height = 200;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, fog: false, toneMapped: false }));
  mesh.userData.noOutline = true;
  return { mesh, canvas, ctx: canvas.getContext("2d"), tex, key: "" };
}

function drawPanel(panel, title, job, extra){
  const key = [title, job.state, Math.round(job.progress), extra || ""].join("|");
  if (panel.key === key) return;
  panel.key = key;
  const ctx = panel.ctx, W = panel.canvas.width, H = panel.canvas.height;
  ctx.fillStyle = "#0a1119"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(56,189,248,0.10)"; ctx.fillRect(0, 0, W, 34);
  ctx.fillStyle = "#cfe4f6";
  ctx.font = "600 20px -apple-system, 'PingFang SC', sans-serif";
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  ctx.fillText(title, 12, 18);
  const tone = job.state === "done" ? "#34d399"
             : job.state === "printing" ? "#fbbf24"
             : job.state === "upload" ? "#38bdf8" : "#7f93a8";
  ctx.fillStyle = tone;
  ctx.font = "700 34px -apple-system, 'PingFang SC', sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(job.state === "printing" ? Math.round(job.progress) + "%"
             : job.state === "done" ? "完成"
             : job.state === "upload" ? "接收中" : "待机", W - 14, 44);

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRectPath(ctx, 14, 78, W - 28, 22, 11); ctx.fill();
  if (job.progress > 0){
    ctx.fillStyle = tone;
    roundRectPath(ctx, 14, 78, Math.max(22, (W - 28) * job.progress / 100), 22, 11); ctx.fill();
  }
  ctx.fillStyle = "rgba(190,214,236,0.88)";
  ctx.font = "500 19px -apple-system, 'PingFang SC', sans-serif";
  ctx.textAlign = "left";
  const rows = [
    ["喷嘴", (extra && extra.nozzle) || "—"],
    ["热床", (extra && extra.bed) || "—"],
    ["模型", (job.model || "无任务").slice(0, 16)]
  ];
  rows.forEach((r, i) => {
    ctx.fillStyle = "rgba(140,166,190,0.85)";
    ctx.fillText(r[0], 16, 128 + i * 26);
    ctx.fillStyle = "#dbe7f3";
    ctx.fillText(r[1], 74, 128 + i * 26);
  });
  panel.tex.needsUpdate = true;
}

/* 舱体亚克力：中间整面透明，内部 0→1 打印过程一眼可见 */
const ACRYLIC = new THREE.MeshBasicMaterial({ color: 0xc9ecff, transparent: true,
  opacity: 0.026, side: THREE.DoubleSide, fog: false, depthWrite: false });
const GLASS_SHEEN = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true,
  opacity: 0.10, side: THREE.DoubleSide, fog: false, depthWrite: false });

(function buildPrinters(){
  /* ============ 大型工业级 FDM ============ */
  {
    const g = new THREE.Group();
    const frameM = toon(0x161f2b);
    const panelM = toon(0x22303f);
    const shellM = toon(0x1b2734);
    const steelM = new THREE.MeshStandardMaterial({ color: 0x9db2c8, roughness: 0.30, metalness: 0.78 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x4b5b6e, roughness: 0.45, metalness: 0.62 });
    const rubber = toon(0x0b0f14);

    /* 底座 + 支撑脚 */
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.18, 1.30), frameM);
    base.position.y = 0.12; base.castShadow = true; base.receiveShadow = true;
    g.add(base);
    const baseTrim = new THREE.Mesh(new THREE.BoxGeometry(1.90, 0.05, 1.34), toon(0x0f1720));
    baseTrim.position.y = 0.235; g.add(baseTrim);
    [[-0.82, -0.56], [0.82, -0.56], [-0.82, 0.56], [0.82, 0.56]].forEach(([x, z]) => {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.05, 12), rubber);
      foot.position.set(x, 0.025, z); g.add(foot);
    });

    /* 立柱 + 顶梁 */
    const H = 1.92;
    [[-0.86, -0.58], [0.86, -0.58], [-0.86, 0.58], [0.86, 0.58]].forEach(([x, z]) => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.115, H, 0.115), frameM);
      col.position.set(x, 0.25 + H / 2, z); col.castShadow = true;
      g.add(col);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.122, 0.03, 0.122), toon(0xf59e0b));
      stripe.position.set(x, 1.05, z); g.add(stripe);
    });
    [[-0.58, 0.58], [0.58, -0.58]].forEach(([z1, z2]) => {});
    [-0.58, 0.58].forEach(z => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.13, 0.115), panelM);
      beam.position.set(0, 0.25 + H - 0.065, z); beam.castShadow = true;
      g.add(beam);
    });
    [-0.86, 0.86].forEach(x => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.13, 1.28), panelM);
      beam.position.set(x, 0.25 + H - 0.065, 0); g.add(beam);
    });
    /* 顶盖 + 排风扇：顶盖做成半透"玻璃舱盖"，既符合大型机透明化诉求，
       也避免从默认机位俯视时把旁边的人挡成一堵实心板 */
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.07, 1.34),
      new THREE.MeshStandardMaterial({ color: 0x0d1620, transparent: true, opacity: 0.30,
                                       roughness: 0.18, metalness: 0.05, depthWrite: false }));
    cap.position.y = 0.25 + H + 0.03; cap.castShadow = true;
    cap.userData.noOutline = true;
    cap.renderOrder = 2;
    g.add(cap);
    /* 舱盖金属包边（保留工业感，同时让"玻璃顶盖"有边界） */
    [[-0.85, 0], [0.85, 0]].forEach(([bx]) => {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.075, 1.34), panelM);
      rim.position.set(bx, 0.25 + H + 0.03, 0); g.add(rim);
    });
    [-0.62, 0.62].forEach(bz => {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.075, 0.10), panelM);
      rim.position.set(0, 0.25 + H + 0.03, bz); g.add(rim);
    });
    const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.022, 8, 20), darkSteel);
    fanRing.rotation.x = -Math.PI / 2;
    fanRing.position.set(0.42, 0.25 + H + 0.07, 0.10); g.add(fanRing);
    const fan = new THREE.Group();
    for (let i = 0; i < 5; i++){
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.012, 0.038), toon(0x2a3846));
      bl.position.set(Math.cos(i / 5 * Math.PI * 2) * 0.055, 0, Math.sin(i / 5 * Math.PI * 2) * 0.055);
      bl.rotation.y = i / 5 * Math.PI * 2;
      bl.userData.noOutline = true;
      fan.add(bl);
    }
    fan.position.set(0.42, 0.25 + H + 0.075, 0.10);
    g.add(fan);
    /* 顶部料架：三卷耗材 */
    const rack = new THREE.Mesh(new THREE.BoxGeometry(1.20, 0.04, 0.06), darkSteel);
    rack.position.set(-0.32, 0.25 + H + 0.09, -0.44); g.add(rack);
    const spools = [];
    [-0.78, -0.32, 0.14].forEach((x, i) => {
      const sp = new THREE.Group();
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.13, 20), toon(0x1f2937));
      roll.rotation.z = Math.PI / 2; roll.castShadow = true; sp.add(roll);
      [-0.066, 0.066].forEach(dx => {
        const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.012, 22), toon(0x374151));
        lip.rotation.z = Math.PI / 2; lip.position.x = dx; sp.add(lip);
      });
      const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.15, 20),
        toon([0xf59e0b, 0x38bdf8, 0x34d399][i]));
      fill.rotation.z = Math.PI / 2; sp.add(fill);
      sp.position.set(x, 0.25 + H + 0.30, -0.44);
      sp.rotation.y = Math.PI / 2;
      sp.userData.spin = true;
      sp.traverse(o => { if (o.isMesh) o.userData.noOutline = true; });
      g.add(sp); spools.push(sp);
    });
    /* 料管：从料卷到喷头 */
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.30, 8), toon(0xd7dee6));
    tube.position.set(0.10, 1.75, -0.30); tube.rotation.z = 0.62; tube.rotation.x = 0.30;
    tube.userData.noOutline = true; g.add(tube);

    /* 机身：背板 + 两侧板（带散热格栅） */
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.72, 1.66, 0.05), shellM);
    back.position.set(0, 1.13, -0.58); back.castShadow = true; g.add(back);
    [-0.855, 0.855].forEach(x => {
      const inner = x > 0 ? 0.029 : -0.029;
      /* 侧框：只留四周边框，中间整面透明 —— 内部作业一眼看穿 */
      [["bot", 0, 0.40, 1.16, 0.07], ["top", 0, 1.86, 1.16, 0.07],
       ["front", 0.55, 1.13, 0.06, 1.53], ["back", -0.55, 1.13, 0.06, 1.53]]
      .forEach(([tag, dz, y, hd, hh], i) => {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, hh, hd), shellM);
        bar.position.set(x, y, dz);
        bar.castShadow = i < 2;
        g.add(bar);
      });
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 1.44), ACRYLIC);
      pane.position.set(x + inner, 1.13, 0);
      pane.rotation.y = Math.PI / 2;
      pane.renderOrder = 3;
      pane.userData.noOutline = true;
      g.add(pane);
      const sheen = new THREE.Mesh(new THREE.PlaneGeometry(1.46, 0.085), GLASS_SHEEN);
      sheen.position.set(x + inner * 1.7, 1.52, 0.02);
      sheen.rotation.set(0, Math.PI / 2, 0.68);
      sheen.renderOrder = 4;
      sheen.userData.noOutline = true;
      g.add(sheen);
    });
    const chamberCeil = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.05, 1.16), toon(0x101822));
    chamberCeil.position.set(0, 1.96, 0); g.add(chamberCeil);
    const chamberFloor = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.06, 1.16), toon(0x0f1720));
    chamberFloor.position.set(0, 0.30, 0); g.add(chamberFloor);

    /* 舱内：Z 轴丝杆 + 热床 + 打印件 */
    [-0.72, 0.72].forEach(x => {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.55, 10), steelM);
      screw.position.set(x, 1.10, -0.42); g.add(screw);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.55, 0.05), darkSteel);
      rail.position.set(x, 1.10, -0.50); g.add(rail);
    });
    const bedPlate = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.05, 0.86), darkSteel);
    bedPlate.position.y = 0.66; bedPlate.receiveShadow = true; g.add(bedPlate);
    const pei = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.012, 0.82), toon(0x2b3646));
    pei.position.y = 0.692; pei.userData.noOutline = true; g.add(pei);
    const bedGlow = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.006, 0.84),
      new THREE.MeshBasicMaterial({ color: 0x7c2d12, fog: false, transparent: true, opacity: 0.0 }));
    bedGlow.position.y = 0.699; bedGlow.userData.noOutline = true; g.add(bedGlow);

    /* 打印件容器：按批次换成不同零件，从 0 逐层长到 1 */
    const partSlot = new THREE.Group();
    partSlot.position.set(0, 0.699, 0);
    g.add(partSlot);
    /* 舱内底部轮廓灯，让暗色零件也能看清轮廓 */
    const rimLight = new THREE.PointLight(0x9fd8ff, 1.6, 2.6, 2);
    rimLight.position.set(0, 0.86, 0.34);
    g.add(rimLight);
    /* 喷嘴附近的熔融光 */
    const melt = new THREE.Mesh(new THREE.SphereGeometry(0.030, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc36b, fog: false, transparent: true, opacity: 0.9 }));
    melt.userData.noOutline = true;
    g.add(melt);

    /* 龙门架 + 喷头组件 */
    const gantry = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.10, 0.13), steelM);
    bar.castShadow = true; gantry.add(bar);
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.30, 0.26), panelM);
    block.position.set(0, 0.19, 0.02); block.castShadow = true; gantry.add(block);
    const fanShroud = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.10, 0.10), toon(0x111827));
    fanShroud.position.set(0, 0.06, 0.17); fanShroud.userData.noOutline = true; gantry.add(fanShroud);
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.12, 14), steelM);
    nozzle.position.set(0, -0.02, 0.0); nozzle.rotation.x = Math.PI; gantry.add(nozzle);
    const heat = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.13, 0.13), toon(0xb45309));
    heat.position.set(0, 0.08, 0); gantry.add(heat);
    const cableChain = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.05, 0.50), toon(0x1f2937));
    cableChain.position.set(-0.30, 0.30, -0.24); gantry.add(cableChain);
    gantry.traverse(o => { if (o.isMesh) o.userData.noOutline = true; });
    gantry.position.y = 0.78;
    g.add(gantry);

    /* 舱内可见的料线：顶部导料口 → 喷头，随龙门一起移动，一眼看清"正在走料" */
    const filament = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 1, 6), toon(0xf4f4f5));
    filament.userData.noOutline = true; g.add(filament);
    const filamentTip = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffc36b, fog: false }));
    filamentTip.userData.noOutline = true; g.add(filamentTip);

    /* 舱内 LED 灯带 */
    const ledStrip = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.03, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x3b1d05, fog: false }));
    ledStrip.position.set(0, 1.92, 0.50);
    ledStrip.userData.noOutline = true;
    g.add(ledStrip);
    const ledLight = new THREE.PointLight(0xffb454, 0, 3.6, 2);
    ledLight.position.set(0, 1.80, 0.10);
    g.add(ledLight);

    /* 正面：玻璃门（可开）+ 门框 + 把手 */
    const doorPivot = new THREE.Group();
    doorPivot.position.set(-0.80, 1.13, 0.585);
    g.add(doorPivot);
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.60, 0.05), toon(0x101822));
    doorFrame.position.set(0.015, 0, 0); doorPivot.add(doorFrame);
    const doorTop = new THREE.Mesh(new THREE.BoxGeometry(1.60, 0.05, 0.05), toon(0x101822));
    doorTop.position.set(0.80, 0.79, 0); doorPivot.add(doorTop);
    const doorBot = new THREE.Mesh(new THREE.BoxGeometry(1.60, 0.05, 0.05), toon(0x101822));
    doorBot.position.set(0.80, -0.79, 0); doorPivot.add(doorBot);
    const doorRight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.60, 0.05), toon(0x101822));
    doorRight.position.set(1.585, 0, 0); doorPivot.add(doorRight);
    /* 整面落地观察玻璃（无中缝，正对舱内） */
    const glass1 = new THREE.Mesh(new THREE.PlaneGeometry(1.54, 1.52),
      new THREE.MeshBasicMaterial({ color: 0xd6f1ff, transparent: true, opacity: 0.018,
        side: THREE.DoubleSide, fog: false, depthWrite: false }));
    glass1.position.set(0.80, 0, 0.006); glass1.renderOrder = 3;
    glass1.userData.noOutline = true; doorPivot.add(glass1);
    const sheenA = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 0.10), GLASS_SHEEN);
    sheenA.position.set(0.80, 0.46, 0.010); sheenA.rotation.z = 0.30;
    sheenA.renderOrder = 4; sheenA.userData.noOutline = true; doorPivot.add(sheenA);
    const sheenB = new THREE.Mesh(new THREE.PlaneGeometry(1.30, 0.06), GLASS_SHEEN);
    sheenB.position.set(0.86, -0.52, 0.010); sheenB.rotation.z = -0.26;
    sheenB.renderOrder = 4; sheenB.userData.noOutline = true; doorPivot.add(sheenB);
    /* 门铰链 */
    [0.52, -0.52].forEach(y => {
      const hg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.075), steelM);
      hg.position.set(-0.02, y, 0.01); doorPivot.add(hg);
    });
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.06), steelM);
    handle.position.set(1.55, -0.10, 0.06); doorPivot.add(handle);

    /* 控制面板 + 状态塔灯 + 急停 */
    const panelBase = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.34, 0.10), panelM);
    panelBase.position.set(1.02, 1.24, 0.63); g.add(panelBase);
    const panel = makePanel(0.42, 0.25);
    panel.mesh.position.set(1.02, 1.25, 0.685);
    g.add(panel.mesh);
    const estop = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 14), toon(0xdc2626));
    estop.position.set(0.60, 1.16, 0.64); estop.rotation.x = Math.PI / 2; g.add(estop);
    const towerPole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), darkSteel);
    towerPole.position.set(-1.00, 1.30, 0.60); g.add(towerPole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x475569, fog: false }));
    lamp.position.set(-1.00, 1.50, 0.60);
    lamp.userData.noOutline = true;
    g.add(lamp);
    const lampShade = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 12), toon(0x1f2937));
    lampShade.position.set(-1.00, 1.42, 0.60); g.add(lampShade);

    g.position.set(PRINT_AT.big[0], 0, PRINT_AT.big[1]);
    g.rotation.y = PRINT_ROT;
    g.userData.tip = machineTip("bigPrinter", 0xf59e0b);
    scene.add(g);

    const label = makePrintLabel("printer.big");
    label.position.set(PRINT_AT.big[0] - 0.35, 2.86, PRINT_AT.big[1]);
    label.userData.tip = g.userData.tip;
    scene.add(label);
    const progress = makePrintProgress();
    progress.position.set(PRINT_AT.big[0] - 0.35, 2.26, PRINT_AT.big[1]);
    scene.add(progress);
    printers.big = { partSlot, gantry, head: block, nozzle, lamp, label, progress, maxH: 0.60,
                     bedW: 1.00, bedD: 0.72, rimLight, partKey: "", idleT: 3,
                     fan, melt, ledLight, ledStrip, bedGlow, panel, door: doorPivot,
                     spools, bedY: 0.699, machine: g, filament, filamentTip,
                     feedA: [0.06, 1.90, -0.40], feedB: [0, 0.06, 0.02],
                     clipPlane: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.699) };
  }

  /* ============ 桌面机（放在工作台上） ============ */
  {
    const g = new THREE.Group();
    const frameM = toon(0x161f2b);
    const shellM = toon(0x233242);
    const legM = toon(0x18212c);
    const steelM = new THREE.MeshStandardMaterial({ color: 0x9db2c8, roughness: 0.32, metalness: 0.75 });

    /* 工作台 */
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.50, 0.07, 0.78), toon(0x2b3d51));
    bench.position.y = 0.80; bench.castShadow = true; bench.receiveShadow = true;
    g.add(bench);
    const benchEdge = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.02, 0.80), toon(0x35495f));
    benchEdge.position.y = 0.765; g.add(benchEdge);
    [[-0.66, -0.31], [0.66, -0.31], [-0.66, 0.31], [0.66, 0.31]].forEach(([x, z]) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.78, 0.07), legM);
      l.position.set(x, 0.39, z); l.castShadow = true;
      g.add(l);
    });
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.04, 0.60), toon(0x24313f));
    shelf.position.set(0, 0.30, 0); g.add(shelf);
    /* 台面杂物：零件盒 + 卡尺 + 剪钳 */
    const bin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.16), toon(0x2f7d4f));
    bin.position.set(-0.55, 0.90, 0.18); bin.castShadow = true; g.add(bin);
    const bin2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.16), toon(0xb45309));
    bin2.position.set(-0.55, 1.02, 0.18); g.add(bin2);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.05), steelM);
    cal.position.set(0.42, 0.845, 0.24); cal.rotation.y = 0.4; g.add(cal);
    const plier = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.04), toon(0x3b4a5c));
    plier.position.set(0.20, 0.842, 0.28); plier.rotation.y = -0.6; g.add(plier);

    /* 机身：底板 + 立柱 + 顶盖（正面留出玻璃门，舱内可见） */
    const bot = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.62), frameM);
    bot.position.set(0, 0.865, 0); bot.castShadow = true; g.add(bot);
    [[-0.335, -0.28], [0.335, -0.28], [-0.335, 0.28], [0.335, 0.28]].forEach(([x, z]) => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.66, 0.045), frameM);
      col.position.set(x, 1.20, z); col.castShadow = true; g.add(col);
    });
    const topCap = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.06, 0.64), frameM);
    topCap.position.set(0, 1.545, 0); topCap.castShadow = true; g.add(topCap);
    const backP = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.66, 0.035), shellM);
    backP.position.set(0, 1.20, -0.30); g.add(backP);
    [-0.362, 0.362].forEach(x => {
      const inner = x > 0 ? 0.018 : -0.018;
      /* 侧框只留边框，中间整面透明舱壁 */
      [["bot", 0, 0.90, 0.60, 0.05], ["top", 0, 1.51, 0.60, 0.05],
       ["front", 0.285, 1.205, 0.05, 0.60], ["back", -0.285, 1.205, 0.05, 0.60]]
      .forEach(([tag, dz, y, hd, hh]) => {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, hh, hd), frameM);
        bar.position.set(x, y, dz); g.add(bar);
      });
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.53, 0.58), ACRYLIC);
      pane.position.set(x + inner, 1.205, 0);
      pane.rotation.y = Math.PI / 2;
      pane.renderOrder = 3;
      pane.userData.noOutline = true;
      g.add(pane);
    });
    /* 顶部料卷 + 导料管 */
    const spoolH = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.20, 8), steelM);
    spoolH.position.set(-0.20, 1.65, 0.05); spoolH.rotation.z = Math.PI / 2; g.add(spoolH);
    const spool = new THREE.Group();
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.09, 18), toon(0x1f2937));
    roll.rotation.z = Math.PI / 2; spool.add(roll);
    [-0.047, 0.047].forEach(dx => {
      const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.140, 0.140, 0.010, 20), toon(0x374151));
      lip.rotation.z = Math.PI / 2; lip.position.x = dx; spool.add(lip);
    });
    const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.100, 0.100, 0.10, 18), toon(0xf0abfc));
    fill.rotation.z = Math.PI / 2; spool.add(fill);
    spool.position.set(-0.20, 1.72, 0.05);
    spool.rotation.y = Math.PI / 2;
    spool.traverse(o => { if (o.isMesh) o.userData.noOutline = true; });
    g.add(spool);
    const guide = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.30, 8), toon(0xd7dee6));
    guide.position.set(0.02, 1.62, 0.06); guide.rotation.z = 0.9; guide.rotation.x = -0.2;
    guide.userData.noOutline = true; g.add(guide);

    /* 舱内：热床 + 打印件 + 喷头 */
    const bedRail = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.03, 0.44), steelM);
    bedRail.position.set(0, 0.895, 0.02); g.add(bedRail);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.035, 0.40), toon(0x2b3646));
    bed.position.set(0, 0.925, 0.02); bed.receiveShadow = true; g.add(bed);
    const bedGlow = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.006, 0.40),
      new THREE.MeshBasicMaterial({ color: 0x7c2d12, fog: false, transparent: true, opacity: 0 }));
    bedGlow.position.set(0, 0.945, 0.02); bedGlow.userData.noOutline = true; g.add(bedGlow);

    /* 打印件容器：按批次换不同零件，从 0 逐层长到 1 */
    const partSlot = new THREE.Group();
    partSlot.position.set(0, 0.945, 0.02);
    g.add(partSlot);
    const melt = new THREE.Mesh(new THREE.SphereGeometry(0.020, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc36b, fog: false, transparent: true, opacity: 0.9 }));
    melt.userData.noOutline = true;
    g.add(melt);

    /* X 龙门 + 喷头 */
    const gantry = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.045, 0.05), steelM);
    gantry.add(bar);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.11, 0.10), toon(0x1b2734));
    head.position.set(0, -0.02, 0.02); gantry.add(head);
    const noz = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 10), steelM);
    noz.position.set(0, -0.10, 0.02); noz.rotation.x = Math.PI; gantry.add(noz);
    gantry.traverse(o => { if (o.isMesh) o.userData.noOutline = true; });
    gantry.position.set(0, 1.36, 0.02);
    g.add(gantry);

    /* 舱内可见料线：顶部导料口 → 喷头 */
    const filament = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6), toon(0xf4f4f5));
    filament.userData.noOutline = true; g.add(filament);
    const filamentTip = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffc36b, fog: false }));
    filamentTip.userData.noOutline = true; g.add(filamentTip);

    /* 舱内灯 + 触摸屏 */
    const ledStrip = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.018, 0.03),
      new THREE.MeshBasicMaterial({ color: 0x3b1d05, fog: false }));
    ledStrip.position.set(0, 1.52, 0.26); ledStrip.userData.noOutline = true; g.add(ledStrip);
    const ledLight = new THREE.PointLight(0xffb454, 0, 2.4, 2);
    ledLight.position.set(0, 1.44, 0.05); g.add(ledLight);

    /* 玻璃门（可开）*/
    const doorPivot = new THREE.Group();
    doorPivot.position.set(-0.34, 1.20, 0.29);
    g.add(doorPivot);
    const dFrame = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.60, 0.04), toon(0x101822));
    dFrame.position.set(0.014, 0, 0); doorPivot.add(dFrame);
    const dRight = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.60, 0.04), toon(0x101822));
    dRight.position.set(0.673, 0, 0); doorPivot.add(dRight);
    const dTop = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.04, 0.04), toon(0x101822));
    dTop.position.set(0.343, 0.285, 0); doorPivot.add(dTop);
    const dBot = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.04, 0.04), toon(0x101822));
    dBot.position.set(0.343, -0.285, 0); doorPivot.add(dBot);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.57),
      new THREE.MeshBasicMaterial({ color: 0xd6f1ff, transparent: true, opacity: 0.020,
        side: THREE.DoubleSide, fog: false, depthWrite: false }));
    glass.position.set(0.343, 0, 0.005); glass.renderOrder = 3;
    glass.userData.noOutline = true; doorPivot.add(glass);
    const dSheen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.055), GLASS_SHEEN);
    dSheen.position.set(0.343, 0.16, 0.009); dSheen.rotation.z = 0.34;
    dSheen.renderOrder = 4; dSheen.userData.noOutline = true; doorPivot.add(dSheen);
    /* 舱内轮廓灯 */
    const rimLight = new THREE.PointLight(0x9fd8ff, 1.1, 1.6, 2);
    rimLight.position.set(0, 1.06, 0.20);
    g.add(rimLight);

    const panelBase = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.20, 0.06), shellM);
    panelBase.position.set(0.0, 1.20, 0.325); g.add(panelBase);
    const panel = makePanel(0.24, 0.15);
    panel.mesh.position.set(0.0, 1.20, 0.357);
    g.add(panel.mesh);

    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x475569, fog: false }));
    lamp.position.set(0.32, 1.60, 0.20); lamp.userData.noOutline = true; g.add(lamp);

    g.position.set(PRINT_AT.desk[0], 0, PRINT_AT.desk[1]);
    g.rotation.y = PRINT_ROT;
    g.userData.tip = machineTip("deskPrinter", 0xf0abfc);
    scene.add(g);

    const label = makePrintLabel("printer.desk");
    label.position.set(PRINT_AT.desk[0] - 0.40, 2.16, PRINT_AT.desk[1]);
    label.userData.tip = g.userData.tip;
    scene.add(label);
    const progress = makePrintProgress();
    progress.position.set(PRINT_AT.desk[0] - 0.40, 1.58, PRINT_AT.desk[1]);
    scene.add(progress);
    printers.desk = { partSlot, gantry, head, nozzle: noz, lamp, label, progress, maxH: 0.26,
                      bedW: 0.40, bedD: 0.34, rimLight, partKey: "", idleT: 5,
                      fan: null, melt, ledLight, ledStrip, bedGlow, panel, door: doorPivot,
                      spools: [spool], bedY: 0.945, machine: g, filament, filamentTip,
                      feedA: [0.02, 1.64, 0.06], feedB: [0, 0.06, 0.02],
                      clipPlane: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.945) };
  }
})();

/* 打印推进：分批换件 + 状态机 + 机器动画 + 进度牌 */
/* 每台机器当前打印到批次第几件（循环取不同零件，不重样） */
const batchCount = { big: 0, desk: 0 };
const PART_MATS = {};
function partMat(k, key){
  const id = k + ":" + key;
  if (!PART_MATS[id]){
    PART_MATS[id] = layeredMat(k === "big" ? PALETTE.printability.accent
                                           : PALETTE.coordinator.accent);
  }
  return PART_MATS[id];
}

/* 换件：把当前零件换成 PART_LIB 里的另一件，按舱内热床尺寸缩放，底面贴合床面 */
function setPrintedPart(k, partKey){
  const M = printers[k];
  if (!M) return;
  if (M.partKey === partKey && M.partSlot.children.length && M.partObj) return;
  const def = PART_LIB[partKey] || PART_LIB.gear;
  const obj = normPart(def.build(partMat(k, partKey)));
  /* 舱内打印件材质独立化：挂上裁切面 → 未打印的部分被切掉，逐层堆叠更真实 */
  obj.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    if (o.material && o.material.isMaterial){
      const m = o.material.clone();
      if (m.map){ m.map = m.map.clone(); m.map.needsUpdate = true; }
      if (M.clipPlane) m.clippingPlanes = [M.clipPlane];
      m.clipShadows = true;
      o.material = m;
    }
  });
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj);
  const w = Math.max(0.02, box.max.x - box.min.x);
  const d = Math.max(0.02, box.max.z - box.min.z);
  const s = Math.min(M.maxH, M.bedW / w, M.bedD / d);
  while (M.partSlot.children.length) M.partSlot.remove(M.partSlot.children[0]);
  attachTip(obj, partTip(k, partKey, "chamber"));   // P0-3：悬停热床上的件出专业字段卡
  M.partSlot.add(obj);
  M.partKey = partKey;
  M.partObj = obj;
  M.partScale = s;
  if (M.clipPlane) M.clipPlane.constant = M.bedY;
  M.partSlot.scale.set(s, 1, s);
  M.partSlot.visible = false;
  pickDirty = true;                                 // 新增可悬停对象 → 重建拾取表
}

function clearBed(k){
  const M = printers[k];
  if (!M) return;
  M.partSlot.visible = false;
  M.partSlot.scale.set(M.partScale || 1, 1, M.partScale || 1);
  if (M.clipPlane) M.clipPlane.constant = M.bedY;
  M.partKey = "";
  pickDirty = true;                                 // 打印件已被摘离场景 → 重建拾取表
}

/* 舱内料线：把顶部导料口和喷头连成一条会随龙门运动伸缩的线 */
const UP_V = new THREE.Vector3(0, 1, 0);
const _fv = new THREE.Vector3();
function updateFilament(M, hx, hy, live){
  if (!M.filament) return;
  const a = M.feedA, b = M.feedB;
  const bx = hx + b[0], by = hy + b[1], bz = b[2];
  const dx = bx - a[0], dy = by - a[1], dz = bz - a[2];
  const len = Math.max(0.02, Math.sqrt(dx * dx + dy * dy + dz * dz));
  M.filament.position.set((a[0] + bx) / 2, (a[1] + by) / 2, (a[2] + bz) / 2);
  M.filament.scale.set(1, len, 1);
  _fv.set(dx / len, dy / len, dz / len);
  M.filament.quaternion.setFromUnitVectors(UP_V, _fv);
  M.filament.visible = live;
  M.filamentTip.visible = live;
  M.filamentTip.position.set(bx, by, bz);
}

function updatePrinters(dt, t){
  Object.keys(printers).forEach(k => {
    const M = printers[k], job = printJobs[k];
    const big = (k === "big");

    if (job.state === "idle"){
      /* 自动分批：上一件被取走后，隔几秒自动上下一件不同的零件 */
      if (M.idleT == null) M.idleT = 3 + Math.random() * 5;
      M.idleT -= dt;
      if (M.idleT <= 0){
        const list = PART_CYCLE[k] || PART_CYCLE.desk;
        const key = list[batchCount[k] % list.length];
        batchCount[k]++;
        setPrintedPart(k, key);
        job.part = key;
        job.model = (PART_LIB[key] || {}).name || "零件";
        job.batchNo = batchCount[k];
        const sq = batchSeq(k, job.batchNo);
        job.seq = sq.i; job.seqTotal = sq.n;
        job.progress = 0; job.doneT = 0; job.state = "upload";
        M.idleT = 5 + Math.random() * 7;
      }
    } else if (job.state === "printing"){
      job.progress = Math.min(100, job.progress + dt * (big ? 100 / 26 : 100 / 17));
      if (job.progress >= 100){ job.progress = 100; job.state = "done"; job.doneT = 150; }
    } else if (job.state === "done"){
      /* 打印完成后停在热床上等 Agent 来取件 */
      job.doneT -= dt;
      if (job.doneT <= 0){
        clearBed(k);
        job.state = "idle"; job.progress = 0; job.model = "";
      }
    }

    const p = job.progress / 100;
    const active = job.state === "printing";
    const uploading = job.state === "upload";
    const finished = job.state === "done";
    const h = (M.partScale || M.maxH) * p;

    /* 打印件按真实比例从 0 逐层长到 1：不做 Y 压缩，用裁切面切掉未打印部分 */
    if (M.partObj){
      M.partSlot.visible = job.progress > 0.3;
      M.partSlot.scale.set(M.partScale || 1, 1, M.partScale || 1);
      if (M.clipPlane) M.clipPlane.constant = M.bedY + Math.max(0.0005, h);
      M.partObj.traverse(o => {
        if (o.isMesh && o.material && o.material.map){
          o.material.map.repeat.set(3, Math.max(1, h / 0.014));
        }
      });
    }

    if (big){
      M.gantry.position.y = 0.78 + Math.max(0.002, h);
      M.head.position.x = Math.sin(t * 3.1) * 0.40;
      M.nozzle.position.x = M.head.position.x;
      M.melt.position.set(M.head.position.x, M.gantry.position.y - 0.06, 0);
      updateFilament(M, M.head.position.x, M.gantry.position.y + 0.02,
                     active || uploading || finished);
      if (M.fan) M.fan.rotation.y += dt * (active ? 16 : 1.2) * (active ? 1 : 0.2);
      M.spools.forEach((s, i) => { if (active) s.rotation.y += dt * (1.1 + i * 0.25); });
    } else {
      const sweep = Math.sin(t * 5.2);
      M.head.position.x = sweep * 0.14;
      M.gantry.position.x = sweep * 0.14;
      M.nozzle.position.x = sweep * 0.14;
      M.melt.position.set(sweep * 0.14, 1.24, 0.02);
      updateFilament(M, sweep * 0.14, 1.36, active || uploading || finished);
      if (active) M.spools[0].rotation.y += dt * 0.9;
    }
    /* 熔融珠 & 热床余温 */
    M.melt.material.opacity = active ? 0.55 + 0.4 * Math.sin(t * 12) : (uploading ? 0.25 : 0);
    M.bedGlow.material.opacity = (active || finished) ? 0.16 + 0.08 * Math.sin(t * 2.4) : 0;
    /* 舱内亮度：打印中/待取件时拉满，确保内部一眼看见 */
    M.ledLight.intensity = active ? 5.6 : (uploading ? 3.0 : (finished ? 5.0 : 1.2));
    if (M.rimLight){
      M.rimLight.intensity = (active || finished) ? 2.2 + 0.7 * Math.sin(t * 2.0) : 1.5;
    }
    M.ledStrip.material.color.setHex(active ? 0xffd08a : (finished ? 0x34d399 : 0x3b1d05));
    /* 门：投件时打开，打印/待取件时关上 */
    const wantOpen = uploading ? -1.55 : 0;
    M.door.rotation.y += (wantOpen - M.door.rotation.y) * Math.min(1, dt * 2.6);

    M.lamp.material.color.setHex(
      finished ? (Math.sin(t * 3) > 0 ? 0x34d399 : 0x0f6b4f)
      : active ? (Math.sin(t * 6) > 0 ? 0xfbbf24 : 0x6b4a12)
      : uploading ? 0x38bdf8
      : 0x475569);

    const nozzleT = active ? Math.round(215 + Math.sin(t * 3) * 4)
                  : (finished ? 205 : (uploading ? 190 : 24));
    const bedT = active ? Math.round(60 + Math.sin(t * 2) * 2)
               : (finished ? 55 : (uploading ? 45 : 22));
    /* P0-3：把实时工况挂到 job 上，供悬停信息卡读取（同一份数据，不另算一套） */
    job.nozzleT = nozzleT; job.bedT = bedT;
    drawPanel(M.panel, big ? "X1 工业机" : "A1 桌面机", job,
              { nozzle: nozzleT + " °C", bed: bedT + " °C" });
    /* title 牌：默认隐藏，悬停/点击机器时才画（内容按 key 去重，不重复绘制） */
    if (M.label.visible){
      drawPrintLabel(M.label, job);
      M.label.quaternion.copy(camera.quaternion);
    }
    /* 进度牌：仅在"机器被悬停/点中"且"有任务在跑"时绘制，避免每帧白刷 canvas */
    if (M.progress.visible){
      drawProgressPlate(M.progress, job);
      M.progress.quaternion.copy(camera.quaternion);
    }
  });
}

/* 浮牌可见性总闸：默认全隐藏，鼠标悬停 / 点击（含 pin）才显示对应物件的牌子。
   新增可悬停牌子只需在这里加一行规则，无需改渲染循环。 */
function refreshPlates(tip){
  Object.keys(printers).forEach(k => {
    const M = printers[k];
    if (!M || !M.label) return;
    /* P0-3：悬停该机器舱内的打印件时，机器的 title / 进度牌也一起亮（等同悬停机器本体） */
    const hot = !!tip && (tip === M.machine.userData.tip || tip === M.label.userData.tip ||
                          tip.machine === k);
    M.label.visible = hot;
    M.progress.visible = hot && printJobs[k] && printJobs[k].state !== "idle";
  });
}

function guessModelName(){
  const drop = document.getElementById("drop");
  const txt = drop ? (drop.textContent || "") : "";
  const m = txt.match(/[\w\u4e00-\u9fa5\-. ]+\.(stl|obj|3mf|ply)/i);
  return m ? m[0].trim() : "";
}

function clearPrintJobs(){
  ["big", "desk"].forEach(k => {
    printJobs[k].state = "idle";
    printJobs[k].progress = 0;
    printJobs[k].model = "";
    printJobs[k].doneT = 0;
  });
}

/* ---------------- 家具统一描边（与角色卡通描边风格对齐） ---------------- */
function outlineFurniture(){
  const pairs = [];
  scene.traverse(o => {
    if (!o.isMesh || o.userData.noOutline) return;
    if (o.material === OUTLINE_MAT || o.material === BLOB_MAT) return;
    const g = o.geometry;
    if (!g || !g.attributes || !g.attributes.position) return;
    if (g.type === "PlaneGeometry") return;            // 地板 / 地毯：不描边，避免边界脏线
    pairs.push([o, g]);
  });
  pairs.forEach(([o, g]) => {
    const ol = new THREE.Mesh(g, OUTLINE_MAT);
    ol.position.copy(o.position);
    ol.quaternion.copy(o.quaternion);
    ol.scale.copy(o.scale).multiplyScalar(1.035);
    ol.userData.noOutline = true;
    ol.renderOrder = -1;
    o.parent.add(ol);
  });
  return pairs.length;
}
outlineFurniture();

/* ---------------- 动作 ---------------- */
/* 硬性防穿模：移动后若与家具矩形重叠，沿最小穿透轴推出去 */
const BODY_R = CONFIG.character.bodyR;
const ROLE_GAP = CONFIG.character.roleGap;         // 两位角色的最小间距（避免互相穿身）
function resolveObst(o){
  for (let i = 0; i < OBST.length; i++){
    const r = OBST[i];
    const p = obstLocal(r, o.current[0], o.current[1]);
    const ox = r.hw + BODY_R - Math.abs(p[0]);
    const oz = r.hd + BODY_R - Math.abs(p[1]);
    if (ox > 0 && oz > 0){
      let lx = p[0], lz = p[1];
      if (ox < oz) lx = (p[0] < 0 ? -1 : 1) * (r.hw + BODY_R);
      else         lz = (p[1] < 0 ? -1 : 1) * (r.hd + BODY_R);
      const w = obstWorld(r, lx, lz);
      o.current[0] = w[0]; o.current[1] = w[1];
    }
  }
}

/* 角色之间同样不许穿身：两两检查，按最小间距各退一半（按帧率平滑，不会瞬移）。
   推完各自再和家具做一次碰撞消解，避免被"推进"桌子里。 */
function separateRoles(dt){
  const list = Object.keys(characters).map(k => characters[k]);
  const k2 = Math.min(1, dt * 10);
  for (let i = 0; i < list.length; i++){
    for (let j = i + 1; j < list.length; j++){
      const a = list[i], b = list[j];
      let dx = b.current[0] - a.current[0], dz = b.current[1] - a.current[1];
      let d = Math.hypot(dx, dz);
      if (d >= ROLE_GAP) continue;
      if (d < 1e-4){ dx = 1; dz = 0; d = 1; }
      const push = (ROLE_GAP - d) * 0.5 * k2;
      const ux = dx / d, uz = dz / d;
      a.current[0] -= ux * push; a.current[1] -= uz * push;
      b.current[0] += ux * push; b.current[1] += uz * push;
      resolveObst(a); resolveObst(b);
      /* 已经落座的角色不要被挤离工位 */
      [[a, a.seat], [b, b.seat]].forEach(([ch, seat]) => {
        if (seat && Math.hypot(ch.current[0] - seat[0], ch.current[1] - seat[1]) < 0.06){
          ch.current[0] = seat[0]; ch.current[1] = seat[1];
        }
      });
    }
  }
}

function stepToward(o, target, dist, dt){
  const dx = target[0] - o.current[0];
  const dz = target[1] - o.current[1];
  const L = Math.hypot(dx, dz);
  if (L < 0.03){ o.current[0] = target[0]; o.current[1] = target[1]; return true; }
  const mv = Math.min(dist * dt, L);
  o.current[0] += (dx / L) * mv;
  o.current[1] += (dz / L) * mv;
  resolveObst(o);
  o.walkPhase += mv * 9.0;
  o.walking = true;
  return false;
}

/* 把任意目标点推出家具的"身体半径"范围：
   目的地 / 航点若落在家具里，角色会被碰撞推回、永远走不到而原地打转 */
function freeSpot(x, z, rad){
  const r0 = (rad == null ? BODY_R : rad) + 0.06;
  const p = [x, z];
  for (let pass = 0; pass < 4; pass++){
    let moved = false;
    for (let i = 0; i < OBST.length; i++){
      const r = OBST[i];
      const l = obstLocal(r, p[0], p[1]);
      const ox = r.hw + r0 - Math.abs(l[0]), oz = r.hd + r0 - Math.abs(l[1]);
      if (ox > 0 && oz > 0){
        let lx = l[0], lz = l[1];
        if (ox < oz) lx = (l[0] < 0 ? -1 : 1) * (r.hw + r0);
        else         lz = (l[1] < 0 ? -1 : 1) * (r.hd + r0);
        const w = obstWorld(r, lx, lz);
        p[0] = w[0]; p[1] = w[1]; moved = true;
      }
    }
    if (!moved) break;
  }
  p[0] = Math.max(0.45, Math.min(11.55, p[0]));
  p[1] = Math.max(0.45, Math.min(11.55, p[1]));
  return p;
}

/* 帧计时：不用已废弃的 THREE.Clock（高版本会打印 deprecation 告警），
   用一个极小的本地实现，后续换引擎/换库也不受影响 */
let _lastFrameT = performance.now();
function frameDelta(){
  const now = performance.now();
  const dt = (now - _lastFrameT) / 1000;
  _lastFrameT = now;
  return dt;
}
let tGlobal = 0;

/* ===================== 姿态系统（目标角度 + 平滑插值） ===================== */
/* 各动作的默认握持量 [左手, 右手]：0=完全松开 1=握实。
   只影响手指分组角度，不改任何既有肢体角度，故不会造成动作回归。 */
const GRIP_MODE = {
  walk: [0.30, 0.30], turn: [0.30, 0.30], stand: [0.25, 0.25],
  work: [0.30, 0.55], mouse: [0.20, 0.50], read: [0.50, 0.50], phone: [0.25, 0.70],
  write: [0.30, 0.90], camera: [0.80, 0.80], inspect: [0.75, 0.75], sip: [0.25, 0.92],
  carry: [0.92, 0.92], upload: [0.55, 0.30], lift: [0.95, 0.95], yoga: [0.10, 0.10],
  clap: [0.18, 0.18], talk: [0.30, 0.30], point: [0.20, 0.20], nod: [0.25, 0.25],
  tidy: [0.60, 0.60], cheer: [0.80, 0.80], watch: [0.15, 0.15], think: [0.20, 0.45],
  squat: [0.35, 0.35], hip: [0.55, 0.55], side: [0.15, 0.15], lookOut: [0.25, 0.25],
  stretch: [0.20, 0.20], jog: [0.72, 0.72], run: [0.78, 0.78]
};

/* 手指握持：按组施加弯曲（食指最活、小指偏僵），拇指对指辅助 */
function applyGrip(hand, g){
  if (!hand || !hand.userData.fingers) return;
  const v = Math.max(0, Math.min(1, g == null ? 0 : g));
  hand.userData.fingers.forEach(f => {
    f.rotation.x = -v * (f.userData.k || 1);
    const m = f.userData.mid;
    if (m) m.rotation.x = -v * (m.userData.k || 1);
  });
  const th = hand.userData.thumb;
  if (th) th.rotation.x = (th.userData.base || 0) - v * 0.62;
}

function poseTargets(ch, mode, t){
  const o = { ty: 0.0, tx: 0.0, tz: 0.0, tw: 0.0, oz: 0.0,
              hx: 0.02, hy: 0, hz: 0,
              aLx: 0.0, aLz: -0.15, eL: -0.20, aLy: 0,
              aRx: 0.0, aRz: 0.15, eR: -0.20, aRy: 0,
              lLx: 0.02, kL: 0.0, lRx: -0.02, kR: 0.0,
              anL: 0.0, anR: 0.0,                      // 踝：提踵/勾脚
              gL: -1, gR: -1,                          // 握持量：-1=按模式默认，0=松开 1=握紧
              prop: null, propL: null };
  const S = (ph, amp) => Math.sin(ph) * (amp == null ? 1 : amp);
  switch (mode){
    case "walk": {
      const p = t * 7.6;
      const sl = S(p), sr = S(p + Math.PI);
      o.lLx = sl * 0.62; o.lRx = sr * 0.62;
      o.kL = Math.max(0, -sl) * 0.86; o.kR = Math.max(0, -sr) * 0.86;
      /* 足部细节：后摆腿蹬地压脚背（提踵），前摆腿落地勾脚掌（脚跟先着地） */
      o.anL = Math.max(0, sl) * 0.44 - Math.max(0, -sl) * 0.13;
      o.anR = Math.max(0, sr) * 0.44 - Math.max(0, -sr) * 0.13;
      o.aLx = sr * 0.52; o.aRx = sl * 0.52;            // 摆臂与腿反相
      o.eL = -0.34 - Math.max(0, -sr) * 0.30;          // 前摆侧肘略收、后摆侧略松
      o.eR = -0.34 - Math.max(0, -sl) * 0.30;
      o.gL = 0.30; o.gR = 0.30;
      o.ty = Math.abs(S(p)) * 0.022; o.tx = 0.045;
      o.tz = S(p) * 0.030;                             // 重心左右转移（胯部摆动）
      o.tw = S(p) * 0.10;                              // 躯干随步伐微扭
      o.hx = 0.05; o.hz = S(p) * 0.05;
      o.hy = -S(p) * 0.06;                             // 头稳住朝前，不跟着乱甩
      break;
    }
    case "turn": {    /* 原地转身：头先转 → 肩跟上 → 重心挪 → 脚下小步 */
      const raw = Math.min(1, (t % 2.6) / 1.4);
      const e = raw * raw * (3 - 2 * raw);             // S 形缓动
      o.tw = -0.46 * e; o.tz = -0.08 * e;
      o.hy = 0.42 * (1 - e);                           // 眼睛先到位
      o.aLz = -0.16 - 0.30 * e; o.aRz = 0.16 + 0.20 * e;
      o.eL = -0.24 - 0.46 * e; o.eR = -0.24 - 0.20 * e;
      o.aLx = -0.10 * e; o.aRx = 0.14 * e;
      o.lLx = 0.05 - 0.24 * e; o.lRx = -0.05 + 0.18 * e;   // 两脚先后小挪半步
      o.anL = 0.16 * e; o.anR = -0.10 * e;
      o.ty = -0.014 * e;
      o.gL = 0.30; o.gR = 0.30;
      break;
    }
    case "work": {
      const kk = t * 13.0;
      o.lLx = -1.50; o.lRx = -1.50; o.kL = 1.50; o.kR = 1.50;
      o.aLx = -1.02 + S(kk, 0.055); o.aRx = -1.02 + S(kk + 1.7, 0.05);
      o.aLz = -0.20; o.aRz = 0.20; o.eL = -0.92; o.eR = -0.92;
      o.ty = S(t * 2.2) * 0.008; o.tx = 0.10;
      o.hx = 0.20; o.hz = S(t * 0.9) * 0.05; o.hy = S(t * 0.37) * 0.10;
      break;
    }
    case "mouse": {   /* 右手握鼠标，左手托腮看屏幕 */
      const kk = t * 9.0;
      o.lLx = -1.50; o.lRx = -1.50; o.kL = 1.50; o.kR = 1.50;
      o.aLx = -1.42; o.aLz = -0.34; o.eL = -1.30;
      o.aRx = -0.92 + S(kk, 0.02); o.aRz = 0.30; o.eR = -0.70;
      o.tx = 0.12; o.hx = 0.18; o.hz = S(t * 0.6) * 0.04;
      break;
    }
    case "think": {
      o.aRx = -1.15; o.aRz = 0.42; o.eR = -1.45;
      o.aLx = S(t * 1.4) * 0.06; o.aLz = -0.18; o.eL = -0.22;
      o.ty = S(t * 1.6) * 0.010;
      o.hx = S(t * 1.2) * 0.06 + 0.05; o.hz = S(t * 1.2 + 1) * 0.08;
      o.lLx = 0.02; o.lRx = -0.02;
      break;
    }
    case "talk": {
      const w = t * 1.9;
      o.lLx = 0.05; o.lRx = -0.06;
      o.aLx = -0.60 + S(w, 0.30); o.aRx = -0.54 + S(w + 2.1, 0.26);
      o.aLz = -0.32 - S(w + 0.9) * 0.10; o.aRz = 0.32 + S(w + 0.4) * 0.10;
      o.eL = -1.10; o.eR = -1.05;
      o.ty = S(t * 1.9) * 0.014; o.tz = S(t * 0.8) * 0.035;
      o.hx = S(t * 1.3) * 0.05; o.hz = S(t * 1.1 + 0.6) * 0.10;
      o.hy = S(t * 1.5 + 1.2) * 0.18;
      break;
    }
    case "stand": {
      o.lLx = 0.06; o.lRx = -0.06;
      o.aLx = 0.02 + S(t * 1.1) * 0.04; o.aRx = S(t * 1.1 + 0.8) * 0.04;
      o.aLz = -0.16; o.aRz = 0.16; o.eL = -0.22; o.eR = -0.22;
      o.ty = S(t * 1.5) * 0.012; o.tz = S(t * 0.7) * 0.022;
      o.hx = S(t * 0.9) * 0.03; o.hz = S(t * 0.6) * 0.05;
      break;
    }
    case "watch": {
      o.aLx = -0.95; o.aRx = -0.95; o.aLz = -0.66; o.aRz = 0.66;
      o.eL = -1.38; o.eR = -1.38;
      o.ty = S(t * 1.4) * 0.010; o.tx = 0.15;
      o.hx = 0.30 + S(t * 1.1) * 0.05; o.hz = S(t * 0.7) * 0.04;
      o.lLx = 0.03; o.lRx = -0.03;
      break;
    }
    case "upload": {
      const k = t * 2.6;
      o.aRx = -1.34 + S(k) * 0.07; o.aRz = 0.10; o.eR = -0.40;
      o.aLx = -0.96 + S(k + 1.2) * 0.05; o.aLz = -0.36; o.eL = -1.55;
      o.ty = S(t * 1.7) * 0.012; o.tx = 0.07;
      o.hx = 0.18; o.hz = S(t * 0.9) * 0.05;
      o.prop = "tablet";
      break;
    }
    case "sip": {     /* 端杯喝一口 */
      const k = t * 1.5;
      o.aRx = -1.16 + S(k) * 0.10; o.aRz = 0.44; o.eR = -1.62;
      o.aLx = 0.05 + S(k + 1) * 0.05; o.aLz = -0.20; o.eL = -0.35;
      o.tx = -0.04; o.hx = -0.10 + S(k) * 0.06;
      o.ty = S(t * 1.6) * 0.012;
      o.lLx = 0.06; o.lRx = -0.06;
      o.prop = "cup";
      break;
    }
    case "read": {    /* 双手托平板 */
      o.aLx = -1.16; o.aRx = -1.16; o.aLz = -0.34; o.aRz = 0.34;
      o.eL = -1.52; o.eR = -1.52;
      o.tx = 0.06; o.hx = 0.34 + S(t * 1.2) * 0.03;
      o.ty = S(t * 1.5) * 0.010;
      o.lLx = 0.04; o.lRx = -0.04;
      o.prop = "tablet";
      break;
    }
    case "phone": {
      o.aRx = -1.30; o.aRz = 0.30; o.eR = -1.70;
      o.aLx = -0.20; o.aLz = -0.24; o.eL = -0.60;
      o.tx = 0.02; o.hx = 0.40; o.tz = S(t * 0.9) * 0.02;
      o.ty = S(t * 1.4) * 0.010;
      o.lLx = 0.05; o.lRx = -0.05;
      o.prop = "phone";
      break;
    }
    case "write": {   /* 白板写字 */
      const k = t * 1.25;
      o.aRx = -2.20 + S(k) * 0.22; o.aRz = 0.26; o.eR = -0.62;
      o.aLx = -0.14 + S(k + 1.4) * 0.10; o.aLz = -0.56; o.eL = -1.15;
      o.tx = 0.04; o.ty = S(t * 1.8) * 0.012;
      o.hx = -0.02; o.hz = S(k) * 0.05;
      o.lLx = 0.05; o.lRx = -0.05;
      o.prop = "tool";
      break;
    }
    case "lookOut": { /* 靠在窗边看外面 */
      o.aLx = -0.62; o.aRx = -0.62; o.aLz = -0.30; o.aRz = 0.30;
      o.eL = -1.62; o.eR = -1.62;
      o.tx = -0.03; o.ty = S(t * 1.3) * 0.010;
      o.hx = -0.06 + S(t * 0.8) * 0.03; o.hz = S(t * 0.5) * 0.05;
      o.lLx = 0.08; o.lRx = -0.08;
      break;
    }
    case "stretch": { /* 坐久了伸懒腰：两臂交替上举 + 躯干带动侧倾，不会双手同时举高 */
      const ph = t % 7;
      const up = (x) => { const d = ph - x; if (d < 0) return 0;
        return Math.min(1, d / 0.9) * (1 - Math.max(0, Math.min(1, (d - 2.4) / 0.9))); };
      const lUp = up(0.0), rUp = up(2.4), top = Math.max(lUp, rUp);
      o.aLx = -0.30 - 1.80 * lUp + S(t * 1.1) * 0.04;
      o.aRx = -0.30 - 1.80 * rUp + S(t * 1.1 + 0.5) * 0.04;
      o.aLz = -0.32 - 0.12 * lUp; o.aRz = 0.32 + 0.12 * rUp;
      o.eL = -0.55 - 0.40 * lUp; o.eR = -0.55 - 0.40 * rUp;
      o.tz = 0.12 * (lUp - rUp); o.tx = -0.06 * top;
      o.ty = 0.02 * top + S(t * 1.5) * 0.008;
      o.hx = -0.16 * top; o.hy = 0.22 * (lUp - rUp);
      o.lLx = 0.05; o.lRx = -0.05;
      break;
    }
    case "squat": {   /* 空闲健身：深蹲 */
      const p = t * 2.4;
      const d = (S(p) * 0.5 + 0.5);
      o.lLx = -1.15 * d + 0.05; o.lRx = -1.15 * d - 0.05;
      o.kL = 1.85 * d; o.kR = 1.85 * d;
      o.aLx = -1.15 * d - 0.10; o.aRx = -1.15 * d - 0.10;
      o.aLz = -0.34; o.aRz = 0.34; o.eL = -0.30; o.eR = -0.30;
      o.tx = 0.24 * d; o.ty = -0.30 * d;
      o.hx = -0.10;
      break;
    }
    case "cheer": {   /* 收工庆祝：三种自然小动作轮换（不再双手齐举） */
      const cs = (ch.celebrateStyle || 0) % 3;
      const p = t * 4.6;
      if (cs === 0){          /* 握拳小振臂 + 点头，另一手叉腰 */
        o.aRx = -1.56 + S(p) * 0.22; o.aRz = 0.34; o.eR = -1.40;
        o.aLx = -0.92; o.aLz = -0.74; o.eL = -1.68;
        o.tx = -0.02; o.ty = Math.abs(S(p * 0.5)) * 0.030;
        o.hx = 0.10 + Math.abs(S(p * 0.5)) * 0.14; o.hz = -0.06;
      } else if (cs === 1){   /* 胸前合掌轻拍 + 颔首 */
        o.aLx = -1.30; o.aRx = -1.30;
        o.aLz = -0.58 + S(p * 1.2) * 0.12; o.aRz = 0.58 - S(p * 1.2) * 0.12;
        o.eL = -1.80; o.eR = -1.80;
        o.tx = 0.05; o.ty = Math.abs(S(p * 0.5)) * 0.022;
        o.hx = 0.16 + S(p * 0.6) * 0.06;
      } else {                /* 竖大拇指 + 一手垂放 */
        o.aRx = -1.06; o.aRz = 0.82; o.eR = -1.28;
        o.aLx = -0.30; o.aLz = -0.26; o.eL = -1.86;
        o.tx = -0.02; o.ty = Math.abs(S(p * 0.5)) * 0.020;
        o.hx = -0.04; o.hy = S(p * 0.35) * 0.12;
      }
      o.lLx = 0.05; o.lRx = -0.05;
      break;
    }
    case "carry": {   /* 抱着打印件走动 */
      const p = t * 4.2;
      o.aLx = -1.02; o.aRx = -1.02; o.aLz = -0.30; o.aRz = 0.30;
      o.eL = -1.55; o.eR = -1.55;
      o.tx = -0.05; o.ty = S(p) * 0.020;
      o.hx = 0.10; o.hz = S(p * 0.5) * 0.03;
      o.lLx = S(p) * 0.42; o.lRx = -S(p) * 0.42;
      break;
    }
    case "camera": {  /* 举相机给打印件拍照留档 */
      const k = t * 1.1;
      o.aLx = -1.12; o.aRx = -1.12; o.aLz = -0.44; o.aRz = 0.44;
      o.eL = -1.74; o.eR = -1.74;
      o.tx = 0.10; o.ty = S(t * 1.6) * 0.008;
      o.hx = 0.14 + S(k) * 0.05; o.hy = S(k * 0.7) * 0.10;
      o.prop = "camera";
      break;
    }
    case "tidy": {    /* 弯身整理工位与样品 */
      const k = t * 1.6;
      o.tx = 0.60; o.ty = -0.10;
      o.aLx = -0.95 + S(k) * 0.22; o.aLz = -0.34; o.eL = -1.24;
      o.aRx = -0.95 + S(k + 1.2) * 0.22; o.aRz = 0.34; o.eR = -1.24;
      o.hx = -0.50; o.hz = S(k) * 0.10;
      o.lLx = 0.10; o.lRx = -0.10;
      break;
    }
    case "nod": {     /* 听人说话时点头确认 */
      const k = Math.max(0, Math.sin(t * 3.4));
      o.aLx = -0.24; o.aRx = -0.30; o.aLz = -0.20; o.aRz = 0.22;
      o.eL = -0.72; o.eR = -0.86;
      o.hx = 0.06 + k * 0.20; o.ty = -k * 0.012;
      o.lLx = 0.03; o.lRx = -0.03;
      break;
    }
    case "hip": {     /* 双手叉腰打量现场 */
      o.aLx = -0.86; o.aRx = -0.86; o.aLz = -0.92; o.aRz = 0.92;
      o.eL = -1.62; o.eR = -1.62;
      o.tx = 0.02; o.ty = S(t * 1.2) * 0.010;
      o.hx = 0.02; o.hz = S(t * 0.5) * 0.07; o.hy = S(t * 0.4) * 0.10;
      o.lLx = 0.04; o.lRx = -0.06;
      break;
    }
    case "side": {    /* 体侧拉伸 */
      const w = Math.sin(t * 1.6) * 0.10;
      o.aRx = -2.40; o.aRz = 0.30 + w; o.eR = -0.30;
      o.aLx = 0.16; o.aLz = -0.24; o.eL = -0.50;
      o.tz = 0.16 + w; o.tx = -0.04;
      o.hz = 0.18; o.hx = -0.10;
      o.lLx = 0.05; o.lRx = -0.05;
      break;
    }
    case "clap": {    /* 胸前轻拍手 */
      const k = Math.max(0, S(t * 5.5));
      o.aLx = -1.28; o.aRx = -1.28;
      o.aLz = -0.62 + k * 0.14; o.aRz = 0.62 - k * 0.14;
      o.eL = -1.80; o.eR = -1.80;
      o.ty = Math.abs(S(t * 2.8)) * 0.022; o.tx = 0.04;
      o.hx = 0.10;
      o.lLx = 0.04; o.lRx = -0.04;
      break;
    }
    case "jog": {     /* 跑步机上慢跑：前脚掌落地 + 提膝 + 摆臂 */
      const p = t * 5.0;
      const sl = S(p), sr = S(p + Math.PI);
      o.aLx = -1.05 + sr * 0.62; o.aRx = -1.05 + sl * 0.62;
      o.aLz = -0.26; o.aRz = 0.26; o.eL = -1.52; o.eR = -1.52;
      o.gL = 0.72; o.gR = 0.72;
      o.lLx = sl * 0.82 - 0.05; o.lRx = sr * 0.82 - 0.05;
      o.kL = 0.35 + Math.max(0, sl) * 0.95; o.kR = 0.35 + Math.max(0, sr) * 0.95;
      o.anL = Math.max(0, -sl) * 0.30 - Math.max(0, sl) * 0.14;
      o.anR = Math.max(0, -sr) * 0.30 - Math.max(0, sr) * 0.14;
      o.tx = 0.09; o.ty = Math.abs(S(p)) * 0.030;
      o.tz = S(p) * 0.020; o.tw = S(p) * 0.05;
      o.hx = -0.04; o.hy = -S(p) * 0.04;
      break;
    }
    case "run": {     /* 跑步机进阶跑：躯干更前倾、抬腿更高、落地更沉 */
      const p = t * 8.2;
      const sl = S(p), sr = S(p + Math.PI);
      o.aLx = -1.18 + sr * 0.78; o.aRx = -1.18 + sl * 0.78;
      o.aLz = -0.22; o.aRz = 0.22; o.eL = -1.74; o.eR = -1.74;
      o.gL = 0.78; o.gR = 0.78;
      o.lLx = sl * 0.95 - 0.10; o.lRx = sr * 0.95 - 0.10;
      o.kL = 0.45 + Math.max(0, sl) * 1.15; o.kR = 0.45 + Math.max(0, sr) * 1.15;
      o.anL = Math.max(0, -sl) * 0.34 - Math.max(0, sl) * 0.16;
      o.anR = Math.max(0, -sr) * 0.34 - Math.max(0, sr) * 0.16;
      o.tx = 0.20; o.ty = Math.abs(S(p)) * 0.042;
      o.tz = S(p) * 0.026; o.tw = S(p) * 0.07;
      o.hx = -0.08; o.hy = -S(p) * 0.05;
      break;
    }
    case "press": {   /* 哑铃推举：站姿，落肘到耳侧 → 双臂推起过头（肩推） */
      const pr = S(t * 1.30) * 0.5 + 0.5;              // 0=落肘 1=推直
      o.aLx = -1.62 - 1.04 * pr; o.aRx = -1.62 - 1.04 * pr;
      o.aLz = -0.34 - 0.12 * (1 - pr); o.aRz = 0.34 + 0.12 * (1 - pr);
      o.eL = -1.20 + 1.06 * pr; o.eR = -1.20 + 1.06 * pr;
      o.gL = 0.95; o.gR = 0.95;
      o.tx = 0.04 + 0.06 * (1 - pr); o.ty = S(t * 1.3) * 0.008;   // 落肘时微微后仰稳住核心
      o.hx = 0.10 - 0.16 * pr;
      o.lLx = 0.12; o.lRx = -0.12; o.kL = 0.12; o.kR = 0.12;
      o.prop = "dumbbell"; o.propL = "dumbbellL";
      break;
    }
    case "row": {     /* 训练凳前：一手扶凳、俯身做单臂划船 */
      const pr = S(t * 1.45) * 0.5 + 0.5;              // 0=放到底 1=拉到腰侧
      o.tx = 0.82; o.ty = -0.03 + S(t * 1.2) * 0.008;
      o.lLx = -0.66; o.lRx = -0.74; o.kL = 0.40; o.kR = 0.44;
      o.aLx = -0.78; o.aLz = -0.16; o.eL = -0.52 + 0.16 * pr; o.gL = 0.42;  // 扶凳手撑住
      o.aRx = -0.80 + 0.44 * pr; o.aRz = 0.26;
      o.eR = -0.34 - 0.98 * pr; o.gR = 0.95;
      o.hx = -0.44 + 0.06 * pr; o.hz = Math.sin(t * 0.5) * 0.04;
      o.prop = "dumbbell";
      break;
    }
    case "swing": {   /* 壶铃摇摆：髋铰链发力，单手把壶铃甩到胸高再沉回去 */
      const p = t * 2.1;
      const sw = S(p) * 0.5 + 0.5;                     // 0=沉底 1=甩到胸高
      o.tx = 0.56 - 0.30 * sw; o.ty = -0.06 + 0.06 * sw;
      o.lLx = -0.44 + 0.22 * sw; o.lRx = -0.50 + 0.22 * sw;
      o.kL = 0.34 - 0.10 * sw; o.kR = 0.36 - 0.10 * sw;
      o.aRx = -0.30 - 1.30 * sw; o.aRz = 0.22; o.eR = -0.34 + 0.06 * sw; o.gR = 0.95;
      o.aLx = -0.10 - 0.70 * sw; o.aLz = -0.30; o.eL = -0.60 + 0.20 * sw; o.gL = 0.30;
      o.hx = -0.10 - 0.10 * sw; o.hz = S(p * 0.5) * 0.03;
      o.prop = "kettlebell";
      break;
    }
    case "drink": {   /* 饮水机：压龙头接水 → 仰头喝一口 → 放杯松肩 */
      const c = t % 11;
      if (c < 3.0){                                    // 压住龙头，左手托杯在下
        o.aLx = -1.06; o.aLz = -0.36; o.eL = -1.48; o.gL = 0.80;
        o.aRx = -1.30; o.aRz = 0.18; o.eR = -0.60; o.gR = 0.95;
        o.tx = 0.14; o.ty = -0.010;
        o.hx = -0.18; o.hz = S(t * 1.4) * 0.03;
        o.lLx = 0.05; o.lRx = -0.05;
        o.prop = "cup";
      } else if (c < 6.4){                             // 仰头喝，喉部抬起
        o.aRx = -1.44 + S(t * 1.2) * 0.06; o.aRz = 0.40; o.eR = -1.74; o.gR = 0.95;
        o.aLx = 0.02; o.aLz = -0.18; o.eL = -0.30; o.gL = 0.30;
        o.tx = -0.06; o.hx = -0.36 - S(t * 1.1) * 0.05;
        o.lLx = 0.06; o.lRx = -0.06;
        o.prop = "cup";
      } else {                                         // 放下杯子，活动肩颈
        o.aLx = -0.24; o.aRx = -0.26; o.aLz = -0.22; o.aRz = 0.24;
        o.eL = -0.60; o.eR = -0.62; o.gL = 0.28; o.gR = 0.28;
        o.hx = 0.06 + S(t * 1.3) * 0.05; o.hz = S(t * 0.6) * 0.08;
        o.ty = S(t * 1.5) * 0.012;
        o.lLx = 0.04; o.lRx = -0.04;
      }
      break;
    }
    case "brew": {    /* 水吧冲咖啡：点按面板 → 托杯等萃取 → 端起来闻香 */
      const c = t % 13;
      if (c < 2.6){                                    // 食指轻点面板
        o.aRx = -1.34 + Math.max(0, S(t * 6.0)) * 0.10; o.aRz = 0.14; o.eR = -0.30; o.gR = 0.10;
        o.aLx = -0.34; o.aLz = -0.30; o.eL = -1.00; o.gL = 0.35;
        o.tx = 0.10; o.hx = 0.10;
        o.lLx = 0.05; o.lRx = -0.05;
      } else if (c < 6.6){                             // 机器出液，双手在台面托住杯子等
        o.aLx = -1.10; o.aRx = -1.10; o.aLz = -0.34; o.aRz = 0.34;
        o.eL = -1.62; o.eR = -1.62; o.gL = 0.85; o.gR = 0.85;
        o.tx = 0.12; o.hx = -0.06; o.hz = S(t * 0.9) * 0.05;
        o.lLx = 0.05; o.lRx = -0.05;
        o.prop = "cup";
      } else if (c < 9.4){                             // 端起来闻香，低头贴近杯口
        o.aRx = -1.24 + S(t * 1.1) * 0.05; o.aRz = 0.36; o.eR = -1.76; o.gR = 0.95;
        o.aLx = -0.16; o.aLz = -0.20; o.eL = -0.42; o.gL = 0.30;
        o.tx = -0.02; o.hx = -0.24; o.hz = S(t * 0.7) * 0.06;
        o.lLx = 0.06; o.lRx = -0.06;
        o.prop = "cup";
      } else {                                         // 抿一口
        o.aRx = -1.42; o.aRz = 0.42; o.eR = -1.68; o.gR = 0.95;
        o.aLx = 0.02; o.aLz = -0.18; o.eL = -0.28; o.gL = 0.30;
        o.tx = -0.05; o.hx = -0.30 + S(t * 1.4) * 0.05;
        o.lLx = 0.06; o.lRx = -0.06;
        o.prop = "cup";
      }
      break;
    }
    case "caliper": { /* 几何分析：卡尺卡着打印件量尺寸，边量边转件找基准面 */
      const k = t * 1.5;
      o.aLx = -1.34 + S(k) * 0.04; o.aLz = -0.42; o.eL = -1.28; o.gL = 0.55;
      o.aRx = -1.30 + S(k + 1.6) * 0.06; o.aRz = 0.34; o.eR = -1.24; o.gR = 0.85;
      o.tx = 0.10; o.ty = S(t * 1.6) * 0.010;
      o.hx = 0.30 + S(k * 0.8) * 0.06; o.hz = S(k * 0.6) * 0.07; o.hy = S(k * 0.5) * 0.10;
      o.lLx = 0.04; o.lRx = -0.04;
      o.prop = "caliper";
      break;
    }
    case "slice": {   /* 可打印性：在切片屏上逐层核查，另一手比划支撑位置 */
      const k = t * 1.1;
      const tap = Math.max(0, S(k * 3.4));
      o.aRx = -1.30 - tap * 0.12; o.aRz = 0.22; o.eR = -0.42 + tap * 0.16; o.gR = 0.15 + tap * 0.35;
      o.aLx = -0.98; o.aLz = -0.52; o.eL = -1.30; o.gL = 0.45;
      o.tx = 0.12; o.ty = S(t * 1.3) * 0.010;
      o.hx = 0.14 + S(k * 0.7) * 0.05; o.hz = S(k * 0.5) * 0.10;
      o.lLx = 0.04; o.lRx = -0.04;
      o.prop = "tablet";
      break;
    }
    case "load": {    /* 可打印性：双手端着料盘对准送料槽装料 */
      const c = t % 6.0;
      const push = c > 3.0 ? Math.min(1, (c - 3.0) / 1.0) : 0;
      o.aLx = -1.30 + push * 0.14; o.aRx = -1.30 + push * 0.14;
      o.aLz = -0.40; o.aRz = 0.40;
      o.eL = -1.44 - push * 0.24; o.eR = -1.44 - push * 0.24;
      o.gL = 0.95; o.gR = 0.95;
      o.tx = 0.16 + push * 0.06; o.ty = -0.020 * push;
      o.hx = 0.30 + push * 0.12;
      o.lLx = 0.06; o.lRx = -0.06;
      o.prop = "spool"; o.propL = "spoolL";
      break;
    }
    case "diagnose": { /* 失效分析：举着断件对光找裂纹，另一手扶屏做比对 */
      const k = t * 1.0;
      o.aRx = -1.86 + S(k) * 0.05; o.aRz = 0.26; o.eR = -1.46; o.gR = 0.90;
      o.aLx = -0.86; o.aLz = -0.40; o.eL = -1.16; o.gL = 0.25;
      o.tx = -0.04; o.ty = S(t * 1.4) * 0.010;
      o.hx = 0.30; o.hz = S(k * 0.7) * 0.10; o.hy = S(k * 0.5) * 0.16;
      o.lLx = 0.05; o.lRx = -0.05;
      o.prop = "loupe";
      break;
    }
    case "tune": {    /* 优化：在优化屏上拖参数，双手比划"缩小体积" */
      const k = t * 1.5;
      const sc = S(k);
      o.aLx = -1.18 + sc * 0.10; o.aRx = -1.18 - sc * 0.10;
      o.aLz = -0.40 - sc * 0.16; o.aRz = 0.40 + sc * 0.16;
      o.eL = -1.36 - Math.abs(sc) * 0.12; o.eR = -1.36 - Math.abs(sc) * 0.12;
      o.gL = 0.30; o.gR = 0.55;
      o.tx = 0.08; o.ty = S(t * 1.9) * 0.012;
      o.hx = 0.16; o.hz = S(k * 0.6) * 0.07; o.hy = S(k * 0.4) * 0.12;
      o.lLx = 0.04; o.lRx = -0.04;
      o.prop = "tablet";
      break;
    }
    case "lift": {    /* 哑铃弯举 */
      const p = t * 2.6;
      const u = Math.max(0, S(p)), v = Math.max(0, -S(p));
      o.aRx = -0.42 - u * 0.95; o.aRz = 0.40; o.eR = -1.15 - u * 0.65;
      o.aLx = -0.42 - v * 0.95; o.aLz = -0.40; o.eL = -1.15 - v * 0.65;
      o.tx = -0.05; o.ty = Math.abs(S(p)) * 0.012;
      o.hx = -0.06;
      o.lLx = 0.06; o.lRx = -0.06;
      o.prop = "dumbbell";
      break;
    }
    case "yoga": {    /* 垫上前屈伸展：双手顺着垫面往前伸，始终不高于肩 */
      const q = (S(t * 0.7) * 0.5 + 0.5);
      o.tx = 0.35 + q * 0.85; o.ty = -0.14 * q;
      o.aLx = -0.45 - q * 0.70; o.aRx = -0.45 - q * 0.70;
      o.aLz = -0.24; o.aRz = 0.24; o.eL = -0.30 - q * 0.20; o.eR = -0.30 - q * 0.20;
      o.hx = -0.30 - q * 0.25;
      o.lLx = 0.08; o.lRx = -0.08;
      break;
    }
    case "point": {   /* 指着中央全息台讲解 */
      const k = t * 1.7;
      o.aRx = -1.32 + S(k) * 0.08; o.aRz = 0.16; o.eR = -0.16;
      o.aLx = -0.42; o.aLz = -0.62; o.eL = -1.42;
      o.tx = 0.03; o.ty = S(t * 1.6) * 0.012; o.tz = S(k * 0.4) * 0.02;
      o.hx = 0.06 + S(k) * 0.04; o.hy = S(k * 0.7) * 0.14;
      o.lLx = 0.05; o.lRx = -0.05;
      break;
    }
    case "inspect": { /* 举起零件对着光看 */
      o.aLx = -1.62; o.aRx = -1.62; o.aLz = -0.30; o.aRz = 0.30;
      o.eL = -1.30; o.eR = -1.30;
      o.tx = 0.04; o.hx = 0.24; o.hz = S(t * 0.8) * 0.06;
      o.ty = S(t * 1.4) * 0.010;
      o.lLx = 0.04; o.lRx = -0.04;
      o.prop = "tool";
      break;
    }
    default: {
      o.lLx = 0.02; o.lRx = -0.02;
      o.aLz = -0.14; o.aRz = 0.14; o.eL = -0.16; o.eR = -0.16;
      o.ty = S(t * 1.5) * 0.012;
      break;
    }
  }
  /* 未显式指定握持量的动作，按模式查表补齐 */
  const G = GRIP_MODE[mode] || [0.25, 0.25];
  /* 坐姿适配：叠加按座面高度反解出的小腿前伸角 —— 膝角略小于 90°、小腿前伸、
     脚掌放平贴地；解不出前伸角（座面相对腿长偏高）时自动退化为垂直小腿，
     再交给落地校正兜底，保证"不管坐在哪里都像坐着"。 */
  if (ch && ch.seatLean > 0.01 && SIT_LEG_MODES.indexOf(mode) >= 0){
    const th = ch.seatLean;
    /* 坐姿腿基线：大腿至少抬到水平、膝盖至少弯 90°（-1.50 / 1.50）。
       work / mouse 本来就自带这组角，钳制后原值不变；think / read / caliper /
       slice / diagnose / tune 这些动作只定义了站立腿（≈0/0），此前坐下后会整条腿
       插进地板（实测鞋底埋到 -0.36m），这里补齐。 */
    o.lLx = Math.min(o.lLx, -1.50);
    o.lRx = Math.min(o.lRx, -1.50);
    o.kL = Math.max(o.kL, 1.50);
    o.kR = Math.max(o.kR, 1.50);
    o.kL = Math.max(0, o.kL - th);
    o.kR = Math.max(0, o.kR - th);
    o.anL = (o.anL || 0) - th * 0.88;      // 踝反向补偿：前伸后鞋底仍与地面平行
    o.anR = (o.anR || 0) - th * 0.88;
    o.lLx -= th * 0.12;                    // 大腿随之微抬，避免坐姿"塌胯"
    o.lRx -= th * 0.12;
  }
  if (o.gL < 0) o.gL = G[0];
  if (o.gR < 0) o.gR = G[1];
  return o;
}

/* 落地校正：取两只鞋的世界包围盒最低点（坐/站姿态下把角色精确"贴"到地面，
   替代按身高估算的固定偏移；走路时不调用，避免摆动腿把角色整体抬起） */
const _footBox = new THREE.Box3();
function footMinY(ch){
  let minY = Infinity;
  ["L", "R"].forEach(k => {
    const leg = ch.legs && ch.legs[k];
    const shoe = leg && leg.userData.shoe;
    if (!shoe) return;
    _footBox.setFromObject(shoe);
    if (isFinite(_footBox.min.y) && _footBox.min.y < minY) minY = _footBox.min.y;
  });
  return minY;
}

function poseLimbs(ch, mode, t, dt, look){
  const T = poseTargets(ch, mode, t);
  const A = ch.anim || (ch.anim = Object.assign({}, T));
  const k = Math.min(1, (dt || 0.016) * 8.5);
  Object.keys(T).forEach(key => {
    if (key === "prop") return;
    A[key] += (T[key] - A[key]) * k;
  });

  const { legs, arms, torso } = ch;
  torso.position.y = 1.00 + A.ty;
  torso.position.z = A.oz;                    // 躺姿时躯干沿床面前移（默认 0 → 站立动作零影响）
  torso.rotation.x = A.tx;
  torso.rotation.z = A.tz;
  torso.rotation.y = A.tw;                    // 走路/转身时躯干随步伐微扭
  ch.head.rotation.x = A.hx;
  ch.head.rotation.z = A.hz;
  ch.head.rotation.y = A.hy + (look ? look.yaw || 0 : 0);

  arms.L.rotation.x = A.aLx; arms.L.rotation.z = A.aLz;
  arms.R.rotation.x = A.aRx; arms.R.rotation.z = A.aRz;
  arms.L.userData.elbow.rotation.x = A.eL;
  arms.R.userData.elbow.rotation.x = A.eR;

  legs.L.rotation.x = A.lLx; legs.L.userData.knee.rotation.x = A.kL;
  legs.R.rotation.x = A.lRx; legs.R.userData.knee.rotation.x = A.kR;
  if (legs.L.userData.ankle) legs.L.userData.ankle.rotation.x = A.anL;
  if (legs.R.userData.ankle) legs.R.userData.ankle.rotation.x = A.anR;

  /* 手指握持（左右手独立，道具跟着握紧/松开） */
  applyGrip(ch.hands && ch.hands.L, A.gL);
  applyGrip(ch.hands && ch.hands.R, A.gR);

  /* 手持道具 */
  if (ch.props){
    Object.keys(ch.props).forEach(n => { ch.props[n].visible = (n === T.prop || n === T.propL); });
  }
  /* 说话 / 欢呼时嘴部开合 */
  const talking = (mode === "talk" || mode === "point" || mode === "cheer");
  const mv = talking ? Math.max(0, Math.sin(t * 11.0) * 0.5 + 0.5) : 0;
  if (ch.head.userData.mouthIn){
    ch.head.userData.mouthIn.scale.y = 0.02 + mv * 0.85;
    ch.head.userData.mouth.scale.y = 1 + mv * 0.35;
  }
}

/* ===================== 行动规划 ===================== */

/* 直线若穿过中央共识台，就在台子外圈插一个绕行路点 */
function routeVia(ax, az, bx, bz){
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  if (L2 < 1e-6) return [[bx, bz]];
  let tt = ((CX - ax) * dx + (CZ - az) * dz) / L2;
  tt = Math.max(0, Math.min(1, tt));
  const px = ax + dx * tt, pz = az + dz * tt;
  if (Math.hypot(px - CX, pz - CZ) > 2.15) return [[bx, bz]];
  /* 沿中央台外圈（半径 2.30）走一段圆弧，避免从台子里横穿过去 */
  const R = 2.30;
  const a1 = Math.atan2(az - CZ, ax - CX);
  const a2 = Math.atan2(bz - CZ, bx - CX);
  let da = a2 - a1;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const steps = Math.max(2, Math.ceil(Math.abs(da) / 0.55));
  const pts = [];
  for (let i = 1; i <= steps; i++){
    const a = a1 + da * (i / steps);
    pts.push([CX + Math.cos(a) * R, CZ + Math.sin(a) * R]);
  }
  pts.push([bx, bz]);
  return pts;
}

const near = (p, q, r) => Math.hypot(p[0] - q[0], p[1] - q[1]) < (r || 0.30);

/* 工位 ↔ 外界必须借道自己的"站立点"，避免从桌面里穿过去 */
function planWalk(ch, dest){
  const cur = [ch.root.position.x, ch.root.position.z];
  /* 目标点先推到家具外，避免航点落在家具里导致角色到不了、原地打转 */
  const safe = freeSpot(dest[0], dest[1]);
  const atSeat = near(cur, ch.seat);
  const toSeat = near(dest, ch.seat, 0.05);
  if (toSeat && !atSeat){
    return pathPoints(cur[0], cur[1], ch.home[0], ch.home[1]).concat([ch.seat.slice()]);
  }
  if (atSeat && !toSeat){
    return [ch.home.slice()].concat(pathPoints(ch.home[0], ch.home[1], safe[0], safe[1]));
  }
  return pathPoints(cur[0], cur[1], safe[0], safe[1]);
}

function walkTo(ch, dest, dt){
  const key = dest[0].toFixed(2) + "|" + dest[1].toFixed(2);
  if (!ch.walk || ch.walk.key !== key){
    ch.walk = { key, pts: planWalk(ch, dest), i: 0, stuck: 0, replans: 0 };
  }
  const w = ch.walk;
  if (w.i >= w.pts.length) return true;
  const bx = ch.current[0], bz = ch.current[1];
  if (stepToward(ch, w.pts[w.i], 1.22, dt)){
    w.i++; w.stuck = 0;
    return w.i >= w.pts.length;
  }
  /* 卡死看门狗：被家具顶住原地打转 → 重新规划；仍不行就结束这一段，避免角色永远僵住 */
  const moved = Math.hypot(ch.current[0] - bx, ch.current[1] - bz);
  w.stuck = moved < 0.0025 ? w.stuck + dt : 0;
  if (w.stuck > 0.9){
    w.stuck = 0;
    w.replans = (w.replans || 0) + 1;
    if (w.replans > 2){ w.i = w.pts.length; return true; }
    w.pts = planWalk(ch, dest); w.i = 0;
  }
  return false;
}

function turnTo(ch, want, dt, rate){
  let d = want - ch.root.rotation.y;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  ch.root.rotation.y += d * Math.min(1, dt * (rate || 6));
}

/* ===================== 打印流程 ===================== */
const op = { phase: "seat", queue: [], watchT: 14, alt: 0, collectT: null };

/* 当前批次是本轮第几件 / 共几件（进度牌上显示"分批打不同件"） */
function batchSeq(k, no){
  const list = PART_CYCLE[k] || PART_CYCLE.desk;
  const n = list.length;
  return { i: (((no || 1) - 1) % n) + 1, n };
}

/* 给某台机器安排下一批次的零件（换件 → 待投件） */
function queueBatch(k, name){
  const list = PART_CYCLE[k] || PART_CYCLE.desk;
  if (!printJobs[k].part || printJobs[k].state === "idle" || name){
    const key = list[batchCount[k] % list.length];
    batchCount[k]++;
    setPrintedPart(k, key);
    printJobs[k].part = key;
    printJobs[k].model = (name || (PART_LIB[key] || {}).name || "零件");
    printJobs[k].batchNo = batchCount[k];
    const sq = batchSeq(k, printJobs[k].batchNo);
    printJobs[k].seq = sq.i; printJobs[k].seqTotal = sq.n;
    printJobs[k].progress = 0;
  }
  printJobs[k].doneT = 0;
  printJobs[k].state = "upload";
}

function startPrintRun(model){
  const name = (model || "").trim() || guessModelName() || "";
  ["big", "desk"].forEach(k => { if (printJobs[k].state !== "done") queueBatch(k, name); });
}

/* 走到某台机器前投件启动 */
function startRun(k){
  const ch = characters.printability;
  if (!ch) return;
  ch.roam = { phase: "work", left: 0 };
  ch.actLabel = "";
  op.phase = "run";
  op.queue = [
    { go: PRINT_STAND[k].slice(), label: "走到" + (k === "big" ? "大型机" : "桌面机") + "前投件" },
    { pose: "upload", dur: 2.2, machine: k },
    { do: () => { if (printJobs[k].state === "upload") printJobs[k].state = "printing"; startHuddle(k); } },
    { go: ch.seat.slice() }
  ];
}

/* 取件：开门 → 取下打印件 → 抱回工位 → 拍照 → 分析记录 */
function collectRun(k){
  const ch = characters.printability;
  if (!ch) return;
  const part = (PART_LIB[printJobs[k].part] || {}).name || printJobs[k].model || "打印件";
  ch.roam = { phase: "work", left: 0 };
  op.phase = "run";
  op.queue = [
    { go: PRINT_STAND[k].slice(), label: "去" + (k === "big" ? "大型机" : "桌面机") + "取件" },
    { pose: "inspect", dur: 3.0, machine: k, label: "隔着舱壁检查 " + part },
    { do: () => takePart(k, part) },
    { go: ch.seat.slice(), carry: true, label: "把 " + part + " 抱回工位" },
    { pose: "camera", dur: 3.4, label: "给 " + part + " 拍照存档" },
    { do: () => placePart(ch, k, part) },
    { pose: "inspect", dur: 3.2, label: "对着实物做失效分析记录" },
    { pose: "work", dur: 1.4 },
    { do: () => startHuddle(k), label: "呼叫四道工序到机床前会诊" }
  ];
}

/* 从热床上取下零件：舱内清空，手里抱一个同样的件 */
function takePart(k, part){
  const M = printers[k], job = printJobs[k];
  const key = job.part || "gear";
  clearBed(k);
  job.state = "idle"; job.progress = 0; job.doneT = 0;
  M.idleT = 9 + Math.random() * 7;
  const ch = characters.printability;
  if (!ch) return;
  releaseHeld();
  const def = PART_LIB[key] || PART_LIB.gear;
  const obj = normPart(def.build(partMat(k, key)));
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj);
  const w = Math.max(0.02, box.max.x - box.min.x);
  const d = Math.max(0.02, box.max.z - box.min.z);
  const s = Math.min(0.30, 0.34 / w, 0.30 / d);
  obj.scale.multiplyScalar(s);
  obj.traverse(o => { if (o.isMesh) o.castShadow = true; });
  attachTip(obj, partTip(k, key, "held"));  // P0-3：手里抱着的件也能悬停看字段
  ch.root.add(obj);
  obj.position.set(0, 1.02, 0.30);         // 胸前抱着
  op.held = obj;
  op.heldKey = key;
  ch.actLabel = "取下了 " + (part || "打印件");
  job.part = "";
  job.model = "";
}

function releaseHeld(){
  if (op.held){
    op.held.userData.tip = null;
    if (op.held.parent) op.held.parent.remove(op.held);
  }
  op.held = null;
  pickDirty = true;
}

/* 把零件放到自己工位台面上（最多留 4 件，作为分析样品） */
function placePart(ch, k, part){
  releaseHeld();
  if (!ch || !ch.desk) return;
  const key = op.heldKey || "gear";
  const mat = partMat(k, key);
  const obj = normPart((PART_LIB[key] || PART_LIB.gear).build(mat));
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj);
  const w = Math.max(0.02, box.max.x - box.min.x);
  const d = Math.max(0.02, box.max.z - box.min.z);
  const s = Math.min(0.15, 0.20 / w, 0.16 / d);
  obj.scale.multiplyScalar(s);
  obj.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const shelf = ch.deskParts || (ch.deskParts = []);
  if (shelf.length >= 4){
    ch.desk.remove(shelf.shift());
  }
  const i = shelf.length;
  obj.position.set(-0.60 + (i % 2) * 0.22, 0.79, -0.16);
  attachTip(obj, partTip(k, key, "sample"));   // P0-3：工位样品也纳入悬停拾取
  ch.desk.add(obj);
  obj.visible = true;
  shelf.push(obj);
  ch.desktopSamples = (ch.desktopSamples || 0) + 1;
}

/* 可打印性 Agent 的职责调度：取件 > 投件启动 > 巡检 */
function updateOps(dt){
  /* 会诊（含演示常驻）期间生产线暂停：不下发新的上下料/盯机动作，避免与会诊抢人抢镜 */
  if (huddle.t > 0) return;
  if (op.phase !== "seat") return;
  const ch = characters.printability;
  if (!ch) return;
  if (social.act && (social.act.host === ch || social.act.guest === ch)) return;

  /* 1) 有打完待取的件：优先取回工位 */
  const doneK = ["big", "desk"].find(k => printJobs[k].state === "done");
  if (doneK){
    if (op.collectT == null) op.collectT = 1.0 + Math.random() * 1.8;
    op.collectT -= dt;
    if (op.collectT > 0) return;
    op.collectT = null;
    collectRun(doneK);
    return;
  }
  op.collectT = null;
  /* 2) 有机器在等投件：去启动 */
  const upK = ["big", "desk"].find(k => printJobs[k].state === "upload");
  if (upK){ startRun(upK); return; }
  /* 3) 打印中：时不时过去盯一眼 */
  if (printJobs.big.state !== "printing" && printJobs.desk.state !== "printing") return;
  op.watchT -= dt;
  if (op.watchT > 0) return;
  op.watchT = 10 + Math.random() * 7;
  op.alt = op.alt ? 0 : 1;
  const k = op.alt ? "big" : "desk";
  op.phase = "run";
  op.queue = [
    { go: PRINT_STAND[k].slice(),
      label: "去" + (k === "big" ? "大型机" : "桌面机") + "盯一眼打印进度" },
    { pose: "watch", dur: 5.5, machine: k },
    { go: ch.seat.slice() }
  ];
}

function opWant(ch, dt){
  const st = op.queue[0];
  if (!st){
    op.phase = "seat";
    return { dest: ch.seat, mode: "work", face: ch.facing };
  }
  if (!st._lab){ st._lab = true; ch.actLabel = st.label || ""; }
  if (st.go){
    const arrived = walkTo(ch, st.go, dt);
    if (arrived){ op.queue.shift(); return { dest: st.go, mode: st.carry ? "carry" : "stand" }; }
    return { dest: st.go, mode: st.carry ? "carry" : "walk" };
  }
  if (st.pose){
    if (st.left == null) st.left = st.dur;
    st.left -= dt;
    const cur = [ch.root.position.x, ch.root.position.z];
    if (st.left <= 0){ op.queue.shift(); return { dest: cur, mode: "stand" }; }
    const mk = st.machine || "big";
    return { dest: cur, mode: st.pose, lookAt: { x: PRINT_AT[mk][0], z: PRINT_AT[mk][1] } };
  }
  if (st.do){ st.do(); op.queue.shift(); }
  return { dest: [ch.root.position.x, ch.root.position.z], mode: "stand" };
}

/* ===================== P0-2 状态机运行时 =====================
   8 态语义 + 优先级压制 + 高优先级态保鲜期 + 视觉副作用（灯 / 屏 / 气泡 / 走位）。
   全部复用既有动作与浮层，不新增骨骼系统。会诊期只做色警、不插走位。 */

/* 当前是否"高优先级态"（保鲜期内，接管走位）：error / waiting / report */
function isHighState(k){
  const m = stateMeta[k];
  return !!(m && m.left > 0 && STATE_MODE[m.st]);
}

/* 工位灯告警：error 时灯泡与点光转红，其他态恢复原色 */
const LAMP_IDLE_COLOR = 0xffd9a0;
function setDeskAlarm(k, on){
  const ch = characters[k];
  const L = ch && ch.desk && ch.desk.userData.lamp;
  if (!L || L.alarm === on) return;
  L.alarm = on;
  if (L.light){
    L.light.color.setHex(on ? 0xff3b30 : LAMP_IDLE_COLOR);
    L.light.intensity = on ? 5.4 : L.baseIntensity;
  }
  if (L.bulb && L.bulb.material && L.bulb.material.color)
    L.bulb.material.color.setHex(on ? 0xff5a4f : L.base);
}

/* 状态 → 桌面屏：error 钉在 alert 红屏；释放时复原 */
function applyStateScreen(k, st, on){
  const ch = characters[k];
  const S = ch && ch.desk && ch.desk.userData.screen;
  if (!S) return;
  if (on && st === "error"){ S.mode = "alert"; S.hold = 1e9; S.timer = 0; }
  else if (!on && S.hold > 1e8){ S.hold = 0; S.timer = 2; S.mode = "code"; }
}

/* 故障指示灯：灯泡 + 红色点光，error 时脉冲（没有 error 时完全熄灭） */
let beacon = null;
function buildBeacon(){
  const g = new THREE.Group();
  const pole = part(g, new THREE.CylinderGeometry(0.045, 0.055, 2.05, 10), toon(0x2b3a4d),
                    [FAULT_AT[0], 1.03, FAULT_AT[1]], null, null, false);
  pole.userData.noOutline = true;
  part(g, new THREE.CylinderGeometry(0.16, 0.19, 0.06, 12), toon(0x1f2a36),
       [FAULT_AT[0], 0.03, FAULT_AT[1]], null, null, false);
  const bulbMat = toon(0x39485c);
  bulbMat.emissive = new THREE.Color(0x000000);
  const bulb = part(g, new THREE.SphereGeometry(0.115, 14, 12), bulbMat,
                    [FAULT_AT[0], 2.16, FAULT_AT[1]], null, null, false);
  bulb.castShadow = false;
  const light = new THREE.PointLight(0xff3b30, 0, 6.5, 2);
  light.position.set(FAULT_AT[0], 2.16, FAULT_AT[1]);
  g.add(light);
  g.userData.tip = machineTip("faultBeacon", 0xf87171);
  g.userData.beacon = { bulb: bulbMat, light, on: false, phase: 0 };
  addObst(FAULT_AT[0], FAULT_AT[1], 0.13, 0.13, 0, "faultBeacon", 0.12);
  return g;
}

/* 文件托盘：报告落地的实体锚点 */
let tray = null, trayPapers = null;
function buildTray(){
  const g = new THREE.Group();
  const top = part(g, new THREE.BoxGeometry(0.92, 0.05, 0.60), toon(0x35455a),
                   [TRAY_AT[0], 0.86, TRAY_AT[1]], null, null, false);
  top.receiveShadow = true;
  [[-0.40, -0.24], [0.40, -0.24], [-0.40, 0.24], [0.40, 0.24]].forEach(([dx, dz]) => {
    part(g, new THREE.CylinderGeometry(0.028, 0.028, 0.84, 8), toon(0x27333f),
         [TRAY_AT[0] + dx, 0.42, TRAY_AT[1] + dz], null, null, false);
  });
  /* 已放置的报告：默认一摞，report 态时再多一张 */
  trayPapers = new THREE.Group();
  for (let i = 0; i < 3; i++){
    part(trayPapers, new THREE.BoxGeometry(0.40, 0.018, 0.52), toon(0xe8eef6),
         [TRAY_AT[0], 0.90 + i * 0.019, TRAY_AT[1]], [0, i * 0.05, 0], null, false);
  }
  g.add(trayPapers);
  g.userData.tip = machineTip("reportTray", 0x7dd3fc);
  addObst(TRAY_AT[0], TRAY_AT[1], 0.48, 0.32, 0, "reportTray", 0.16);
  return g;
}

function ensureStateProps(){
  if (!beacon){ beacon = buildBeacon(); scene.add(beacon); }
  if (!tray){ tray = buildTray(); scene.add(tray); }
}

/* waiting：头顶问号浮层（DOM 单例，跟随角色，百分比定位与气泡同坐标系） */
const questionMarks = {};
function markOf(k){
  let m = questionMarks[k];
  if (!m){
    const el = document.createElement("div");
    el.className = "office-mark";
    el.textContent = "?";
    el.style.display = "none";
    bubbleLayer.appendChild(el);
    m = questionMarks[k] = { el, on: false };
  }
  return m;
}
function updateMarks(){
  AGENT_ORDER.forEach(k => {
    const ch = characters[k];
    if (!ch) return;
    const m = markOf(k);
    const meta = stateMeta[k];
    const on = !!(meta && meta.left > 0 && meta.st === "waiting");
    if (!on){
      if (m.on){ m.el.style.display = "none"; m.on = false; }
      return;
    }
    _v.set(ch.root.position.x,
           ch.root.position.y + 2.62 * (ch.cfg.height / 1.86),
           ch.root.position.z);
    _v.project(camera);
    if (_v.z > 1){
      if (m.on){ m.el.style.display = "none"; m.on = false; }
      return;
    }
    m.el.style.display = "block";
    m.el.style.left = ((_v.x * 0.5 + 0.5) * 100).toFixed(2) + "%";
    m.el.style.top  = ((-_v.y * 0.5 + 0.5) * 100).toFixed(2) + "%";
    m.on = true;
  });
}

/* 故障灯脉冲 + 托盘常显 */
function updateBeacon(dt){
  ensureStateProps();
  const anyError = AGENT_ORDER.some(k => stateMeta[k].left > 0 && stateMeta[k].st === "error");
  if (beacon && beacon.userData.beacon){
    const B = beacon.userData.beacon;
    if (B.on !== anyError){
      B.on = anyError;
      B.bulb.emissive.setHex(anyError ? 0xff3b30 : 0x000000);
      B.bulb.color.setHex(anyError ? 0xff7a6f : 0x39485c);
    }
    if (anyError){
      B.phase = (B.phase + dt * 3.1) % (Math.PI * 2);
      if (B.light) B.light.intensity = 1.9 + Math.sin(B.phase) * 0.9;
    } else if (B.light && B.light.intensity !== 0){
      B.light.intensity = 0;
    }
  }
  if (trayPapers) trayPapers.visible = true;
}

/* 高优先级态走位：error → 故障指示灯 / report → 文件托盘 / waiting → 原地转向镜头 */
function stateWant(ch, k, dt){
  const m = stateMeta[k];
  const idx = Math.max(0, AGENT_ORDER.indexOf(k));
  if (m.st === "waiting"){
    return { dest: [ch.root.position.x, ch.root.position.z], mode: "think",
             lookAt: { x: camera.position.x, z: camera.position.z } };
  }
  const spot = (m.st === "error" ? FAULT_STAND : TRAY_STAND)[idx] || ch.seat;
  const tgt  = m.st === "error" ? FAULT_AT : TRAY_AT;
  if (!walkTo(ch, spot, dt)) return { dest: spot, mode: "walk" };
  return { dest: spot, mode: STATE_MODE[m.st] || "stand",
           lookAt: { x: tgt[0], z: tgt[1] } };
}

/* 应用一个状态：优先级压制 + 保鲜期 + 视觉副作用 */
function applyAgentState(k, st){
  const m = stateMeta[k];
  if (!m || AGENT_STATES.indexOf(st) < 0) return false;
  const prio = STATE_PRIO[st] || 0;
  /* 低优先级不得覆盖保鲜期内的高优先级态 */
  if (m.left > 0 && prio < m.prio) return false;
  /* idle 即显式回落：撤掉灯 / 屏 / 气泡残留 */
  if (st === "idle"){ clearAgent(k); return true; }
  const prev = m.st;
  m.st = st;
  m.prio = prio;
  m.left = STATE_TTL[st] || 0;
  /* 仲裁通过后才写入对外态，保证被压制时不产生任何可见副作用 */
  if (k in state) state[k] = st;
  /* recalibrating / debating 复用 running 的角色动作与屏幕，只换气泡文案 */
  setAgentStage(k, (st === "recalibrating" || st === "debating") ? "running" : st);
  const ch = characters[k];
  if (!ch) return true;
  /* 气泡：八态文案，后两态复用 running 动作但换词 */
  if (st !== "idle") sayStage(k, st);
  setDeskAlarm(k, st === "error");
  applyStateScreen(k, st, true);
  if (prev !== "idle" && prev !== st) applyStateScreen(k, prev, false);
  /* 托盘：report 时多放一张报告（上限 8 张，避免长时间运行无限堆积） */
  if (trayPapers && st === "report" && prev !== "report" && trayPapers.children.length < 8){
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.018, 0.52), toon(0xf2f7fd));
    sheet.position.set(TRAY_AT[0], 0.90 + trayPapers.children.length * 0.019, TRAY_AT[1]);
    sheet.rotation.y = trayPapers.children.length * 0.05;
    sheet.castShadow = true;
    trayPapers.add(sheet);
  }
  return true;
}

/* 显式清除：立刻回 idle，撤掉灯 / 屏 / 气泡残留 */
function clearAgent(k){
  delete agentMeta[k];          // P0-3：卡片数据随角色回落 idle 一起清掉
  const m = stateMeta[k];
  if (!m) return false;
  const prev = m.st;
  m.st = "idle"; m.prio = 0; m.left = 0;
  if (k in state) state[k] = "idle";
  const ch = characters[k];
  if (ch){
    applyStateScreen(k, prev, false);
    setDeskAlarm(k, false);
    if (ch.stage){ ch.stage.code = ""; ch.stage.hold = 0; }
    ch.actLabel = "";
  }
  const q = questionMarks[k];
  if (q && q.on){ q.el.style.display = "none"; q.on = false; }
  return true;
}

/* 保鲜期衰减：到期自动回落 idle（宿主断连时画面不会永久钉在 error / waiting）
   P1-a：遍历账本全量 key（含插件角色），而非只扫四道工序 */
function decayAgentState(dt){
  if (!(dt > 0)) return;
  Object.keys(stateMeta).forEach(k => {
    const m = stateMeta[k];
    if (!m || m.left <= 0) return;
    m.left -= dt;
    if (m.left <= 0) clearAgent(k);
  });
}

/* 对外可见状态：推送态优先，空闲期在外散步记为 deepIdle */
function stateOf(k){
  /* P1-d：静态 state 表只含"四道工序 + 会诊"，插件角色（动态 key）回落到 stateMeta 账本，
     二者口径一致；静态 key 行为不变（走同一分支，逐字段一致）。 */
  const pushed = (k in state) ? state[k] : (stateMeta[k] ? stateMeta[k].st : null);
  if (pushed && pushed !== "idle") return pushed;
  const ch = characters[k];
  if (ch && ch.roam && ch.roam.phase !== "work") return "deepIdle";
  return "idle";
}

/* 深空闲总开关：关闭时立即召回在外散步的角色（?leisure=0 走同一入口） */
function setLeisure(on){
  leisure = !!on;
  if (!leisure){
    Object.keys(characters).forEach(k => {
      const ch = characters[k];
      if (ch.roam && ch.roam.phase !== "work") ch.roam = { phase: "back", left: 0 };
    });
  }
  return leisure;
}

/* ===================== 串门社交 ===================== */
const social = { timer: 24 + Math.random() * 12, act: null };
const SOCIAL_POOL = ["geometry", "failure", "optimization"];

function updateSocial(dt){
  if (social.act){
    social.act.left -= dt;
    driveChat(social.act, dt);
    if (social.act.left <= 0){
      social.act = null;
      social.timer = 30 + Math.random() * 18;
    }
    return;
  }
  /* 空闲判定按"人"而不是按"全场"：分批打印是场景常态（大小机连续往复），
     若要求打印流程整体停摆才允许串门，社交会永远排不上队。
     这里仅排除共识作业（全员必须围到全息台）。 */
  if (state.consensus === "running") return;
  /* P1-c：导览期间不新开串门（员工照常干活，只是不互相串门抢导游） */
  if (TOUR.active) return;

  social.timer -= dt;
  if (social.timer > 0) return;

  const hostK = SOCIAL_POOL[Math.floor(Math.random() * SOCIAL_POOL.length)];
  let guestK = hostK;
  while (guestK === hostK) guestK = SOCIAL_POOL[Math.floor(Math.random() * SOCIAL_POOL.length)];

  const host = characters[hostK], guest = characters[guestK];
  /* 有任务在身的就别串门了 */
  if (host.stage.hold > 0 || guest.stage.hold > 0) return;
  host.roam = { phase: "work", left: 0 };
  guest.roam = { phase: "work", left: 0 };
  const dx = guest.home[0] - host.home[0], dz = guest.home[1] - host.home[1];
  const L = Math.hypot(dx, dz) || 1;
  social.act = {
    host, guest, hostK, guestK, left: 12 + Math.random() * 4,
    spot: [host.home[0] + (dx / L) * 1.18, host.home[1] + (dz / L) * 1.18],
    thread: chatThread() || [], line: -1, nextAt: 2.6
  };
}

/* 串门闲聊：按 talkGap 节奏轮流抛出台词，各自冒自己的气泡 */
function driveChat(act, dt){
  if (!act.thread || !act.thread.length) return;
  act.nextAt -= dt;
  if (act.nextAt > 0) return;
  act.nextAt = CONFIG.bubble.talkGap;
  act.line++;
  if (act.line >= act.thread.length){
    /* 台词说完就换成新话题，避免复读 */
    const next = chatThread();
    act.thread = next && next !== act.thread ? next : act.thread.slice().reverse();
    act.line = 0;
  }
  const speakerK = (act.line % 2 === 0) ? act.hostK : act.guestK;
  say(speakerK, act.thread[act.line]);
}

/* ===================== 3DP 主题：大型机下线会诊 ===================== */
/* 大型机每下线一批件，四道工序的 Agent 会一起凑到机床前各干各的活：
   可打印性指舱内讲成型、几何量实物尺寸、失效查层间裂纹、优化对着平板比改模方案，
   协调员在机前串一遍工序 —— 把"四道工序围绕 3D 打印机协作"这条主线演出来。 */
const HUDDLE = {
  printability: { spot: [9.95, 5.60], mode: "point",    note: "指着舱内讲这一批的成型过程" },
  geometry:     { spot: [9.70, 6.30], mode: "caliper",  note: "就着实物量关键尺寸" },
  failure:      { spot: [9.50, 4.90], mode: "diagnose", note: "翻看层间结合与裂纹源" },
  optimization: { spot: [9.05, 6.05], mode: "tune",     note: "对着平板比对改模方案" },
  coordinator:  { spot: [8.65, 6.70], mode: "point",    note: "在机前串了一遍工序" }
};
const huddle = { t: 0, cool: 0, look: [11.0, 5.60] };

function startHuddle(k){
  if (k !== "big") return;
  if (TOUR.active) return;     /* P1-c：导览期间不发起新会诊（已在进行的照常走完） */                 /* 只给大型机下线安排会诊（机位在过道一侧，不会与工位打架） */
  if (huddle.t > 0 || huddle.cool > 0) return;
  huddle.t = 15; huddle.cool = 55;
  const at = PRINT_AT[k] || PRINT_AT.big;
  huddle.look = [at[0], at[1]];
  Object.keys(HUDDLE).forEach(key => {
    const ch = characters[key];
    if (ch) ch.actLabel = "大型机前会诊：" + HUDDLE[key].note;
  });
}
function endHuddle(){
  huddle.t = 0;
  Object.keys(HUDDLE).forEach(key => {
    const ch = characters[key];
    if (ch && ch.actLabel && ch.actLabel.indexOf("会诊") >= 0) ch.actLabel = "";
  });
}
function updateHuddle(dt){
  if (huddle.t > 0){
    huddle.t -= dt;
    if (huddle.t <= 0) endHuddle();
  } else if (huddle.cool > 0){
    huddle.cool -= dt;
  }
}

/* 坐姿动作集合：执行到这些动作时整体下沉（工位/会议桌前） */
const SIT_MODES = ["work", "mouse", "think", "read", "caliper", "slice", "diagnose", "tune"];
/* 需要坐姿腿适配的动作集合（P1-calling）：phone / talk 只定义了站立腿，
   坐姿基座（seatLean>0）下必须走同一套坐姿腿基线，否则坐着接电话会整条腿插进地板。
   注意：与 6250 行的 seated 判定无关，那里用的是走位意图 want.mode。 */
const SIT_LEG_MODES = SIT_MODES.concat(["phone", "talk"]);

/* ===================== 空闲自由活动（各干各的） ===================== */
const ROAM_POOL_WORKER = [
  { key: "coffee",   act: "sip",     dur: 10, label: "去茶水间接了杯咖啡" },
  { key: "water",    act: "sip",     dur: 8,  label: "到饮水机倒水" },
  { key: "pantry",   act: "tidy",    dur: 9,  label: "在茶水间收拾杯具" },
  { key: "board",    act: "write",   dur: 14, label: "在白板上推演方案" },
  { key: "window",   act: "lookOut", dur: 12, label: "站在窗边放空" },
  { key: "treadmill",act: "jog",     dur: 14, label: "上跑步机跑了几分钟" },
  { key: "dumbbell", act: "lift",    dur: 12, label: "在哑铃架前做弯举" },
  { key: "mat",      act: "yoga",    dur: 12, label: "在瑜伽垫上拉伸" },
  { key: "gym",      act: "side",    dur: 10, label: "在健身区做体侧拉伸" },
  { key: "podium",   act: "read",    dur: 12, label: "凑到中央台看全息模型" },
  { key: "seat",     act: "squat",   dur: 9,  label: "在工位旁做几组深蹲" },
  { key: "seat",     act: "tidy",    dur: 10, label: "顺手把工位上的样品归整一下" },
  { key: "seat",     act: "hip",     dur: 8,  label: "叉腰对着屏幕出神" },
  { key: "seat",     act: "stretch", dur: 7,  label: "坐久了站起来伸个懒腰" }
];
const ROAM_POOL_HOST = [
  { key: "podium",   act: "point",   dur: 14, label: "在共识台前串讲进度" },
  { key: "board",    act: "write",   dur: 16, label: "更新白板上的排期" },
  { key: "coffee",   act: "brew",    dur: 13, label: "在水吧给自己冲了杯咖啡" },
  { key: "water",    act: "drink",   dur: 9,  label: "到饮水机接了杯水喝" },
  { key: "pantry",   act: "tidy",    dur: 9,  label: "把茶水间台面擦了一遍" },
  { key: "window",   act: "lookOut", dur: 12, label: "在窗边看看天气" },
  { key: "mat",      act: "yoga",    dur: 12, label: "在瑜伽垫上拉伸放松" },
  { key: "treadmill",act: "run",     dur: 12, label: "上跑步机跑了一会儿" },
  { key: "seat",     act: "nod",     dur: 8,  label: "低头对着清单逐项确认" },
  { key: "seat",     act: "phone",   dur: 10, label: "低头回消息" },
  { key: "seat",     act: "stretch", dur: 6,  label: "站着活动了下肩颈" }
];

/* 通用休闲活动：任何角色都可能去（与职责无关的那部分） */
const ROAM_LEISURE = [
  { key: "coffee",   act: "brew",    dur: 13, label: "去水吧冲了杯咖啡" },
  { key: "water",    act: "drink",   dur: 9,  label: "到饮水机接了杯水喝" },
  { key: "window",   act: "lookOut", dur: 11, label: "站在窗边放空" },
  { key: "pantry",   act: "tidy",    dur: 8,  label: "在茶水间收拾杯具" },
  { key: "treadmill",act: "run",     dur: 12, label: "上跑步机跑了几分钟" },
  { key: "mat",      act: "yoga",    dur: 12, label: "在瑜伽垫上拉伸" },
  { key: "gym",      act: "side",    dur: 10, label: "在健身区做体侧拉伸" },
  { key: "seat",     act: "squat",   dur: 9,  label: "在工位旁做几组深蹲" },
  { key: "seat",     act: "stretch", dur: 7,  label: "坐久了伸个懒腰" }
];

/* 职责化自由活动：空闲时做的事要能看出"四道工序"的分工
   （geometry 量件 / printability 切片+换料 / failure 断口分析 / optimization 调参） */
const ROAM_ROLE = {
  geometry: [
    { key: "seat",       act: "caliper", dur: 13, label: "用卡尺复核打印件的外形尺寸" },
    { key: "seat",       act: "mouse",   dur: 11, label: "在几何体检面板上扫一遍三角面片" },
    { key: "board",      act: "write",   dur: 14, label: "在白板上标注关键公差带" },
    { key: "printerBig", act: "inspect", dur: 10, label: "凑到大型机前比对面形轮廓" },
    { key: "podium",     act: "read",    dur: 12, label: "对着全息模型核对包围盒" },
    { key: "bench",      act: "row",     dur: 11, label: "在训练凳前练了一组单臂划船", face: Math.PI }
  ],
  printability: [
    { key: "seat",        act: "slice",   dur: 13, label: "逐层核查切片里的支撑位置" },
    { key: "seat",        act: "work",    dur: 11, label: "盯着切片预览确认可打印性" },
    { key: "printerDesk", act: "load",    dur: 10, label: "给桌面机换上一盘新料" },
    { key: "printerBig",  act: "load",    dur: 9,  label: "把料盘对准大型机的送料槽" },
    { key: "printerBig",  act: "inspect", dur: 9,  label: "隔着舱壁复核首层粘附" },
    { key: "printerDesk", act: "inspect", dur: 8,  label: "守着桌面机看首层铺料" }
  ],
  failure: [
    { key: "seat",       act: "diagnose", dur: 13, label: "举着断件对光找裂纹源" },
    { key: "seat",       act: "camera",   dur: 10, label: "给失效样件拍照归档" },
    { key: "board",      act: "write",    dur: 12, label: "在白板上画失效树" },
    { key: "printerBig", act: "inspect",  dur: 10, label: "对着机床复核易失效部位" },
    { key: "podium",     act: "read",     dur: 11, label: "在共识台调出历史失效案例" },
    { key: "kettle",     act: "swing",    dur: 11, label: "在壶铃前甩了几组", face: Math.PI }
  ],
  optimization: [
    { key: "seat",       act: "tune",    dur: 13, label: "在优化屏上拖参数收敛体积" },
    { key: "seat",       act: "mouse",   dur: 10, label: "在多方案对比表里挑最优解" },
    { key: "board",      act: "write",   dur: 12, label: "在白板上写改模方案" },
    { key: "podium",     act: "point",   dur: 12, label: "对着全息模型讲减重思路" },
    { key: "printerBig", act: "inspect", dur: 9,  label: "看新结构在机床上的成型效果" },
    { key: "dumbbell",   act: "press",   dur: 11, label: "在哑铃架前做了几组推举" }
  ]
};

function pickRoam(ch){
  const pool = (ROAM_ROLE[ch.key] && !ch.isHost)
    ? ROAM_ROLE[ch.key].concat(ROAM_LEISURE)
    : (ch.isHost ? ROAM_POOL_HOST : ROAM_POOL_WORKER);
  const p = pool[Math.floor(Math.random() * pool.length)];
  const spots = DEST[p.key] || ch.home;
  ch.roam = {
    phase: "go", left: 0, act: p.act, label: p.label,
    face: (p.face != null ? p.face : null),
    spot: [spots[0] + (Math.random() - 0.5) * 0.5, spots[1] + (Math.random() - 0.5) * 0.5],
    dur: p.dur
  };
  ch.actLabel = p.label;
}

function roamWant(ch, dt){
  if (!ch.roam) ch.roam = { phase: "work", left: 13 + Math.random() * 20, mode: idleModeOf(ch) };
  const r = ch.roam;
  if (r.phase === "work"){
    if (r.left > 0) r.left -= dt;
    /* ?leisure=0（setLeisure(false)）时关闭深空闲：没人再外出散步 */
    else if (leisure && roamers() < 2 && (ch.stage.hold || 0) <= 0){
      pickRoam(ch);
      return roamWant(ch, dt);
    } else { r.left = 12 + Math.random() * 10; r.mode = idleModeOf(ch); }
    return { dest: ch.seat, mode: r.mode || idleModeOf(ch), face: ch.facing };
  }
  if (r.phase === "go"){
    const arrived = walkTo(ch, r.spot, dt);
    if (arrived){
      r.phase = "act"; r.left = r.dur;
      return { dest: r.spot, mode: "stand", face: (r.face != null ? r.face : ch.facing) };
    }
    return { dest: r.spot, mode: "walk" };
  }
  if (r.phase === "act"){
    r.left -= dt;
    if (r.left <= 0){
      r.phase = "back";
      return { dest: r.spot, mode: "stand", face: ch.facing };
    }
    return { dest: r.spot, mode: r.act, face: (r.face != null ? r.face : ch.facing) };
  }
  /* back */
  const arrived = walkTo(ch, ch.seat, dt);
  if (arrived){
    ch.roam = { phase: "work", left: 10 + Math.random() * 14, mode: idleModeOf(ch) };
    ch.actLabel = "";
    return { dest: ch.seat, mode: ch.roam.mode, face: ch.facing };
  }
  return { dest: ch.seat, mode: "walk" };
}

/* 待在自己位置上时的姿态：协调员站着讲解/看资料，四位 Agent 坐工位干活 */
function idleModeOf(ch){
  if (ch.isHost) return ["point", "read", "stand", "think"][Math.floor(Math.random() * 4)];
  const r = Math.random();
  return r < 0.72 ? "work" : (r < 0.86 ? "mouse" : "think");
}

function roamers(){
  let n = 0;
  Object.keys(characters).forEach(k => {
    const r = characters[k].roam;
    if (r && (r.phase === "go" || r.phase === "act" || r.phase === "back")) n++;
  });
  return n;
}

/* ===================== 任务联动：chat 分工 → 办公室实时动作 ===================== */
const STAGE_SHOW = {
  geometry:     { run: "work",  screen: "cad",     done: "cheer",  label: "正在解析网格与包围盒" },
  printability: { run: "work",  screen: "print",   done: "cheer",  label: "正在做可打印性判定" },
  failure:      { run: "mouse", screen: "table",   done: "cheer",  label: "正在枚举失效模式" },
  optimization: { run: "work",  screen: "suggest", done: "cheer",  label: "正在生成优化建议" },
  coordinator:  { run: "point", screen: "dash",    done: "cheer",  label: "正在统筹四道工序" }
};

function stageWant(ch, k, dt){
  const st = ch.stage;
  const conf = STAGE_SHOW[k] || STAGE_SHOW.geometry;
  if (st.code === "running"){
    st.hold = Math.max(st.hold, 0.4);
    return { dest: ch.isHost ? ch.home : ch.seat,
             mode: conf.run, face: ch.facing,
             lookAt: ch.isHost ? { x: CX, z: CZ } : null };
  }
  if (st.code === "done" && st.hold > 0){
    return { dest: ch.isHost ? ch.home : ch.seat, mode: "cheer", face: ch.facing,
             lookAt: ch.isHost ? { x: CX, z: CZ } : null };
  }
  if (st.code === "error" && st.hold > 0){
    return { dest: ch.isHost ? ch.home : ch.seat, mode: "think", face: ch.facing };
  }
  return null;
}

/* 阶段台词：chat 里给谁派了活，办公室里就能看到对应的一句话 */
function sayStage(k, status){
  const line = pickLocale(CHAT_LOCALE, "say." + status + "." + k)
            || pickLocale("en-US", "say." + status + "." + k);
  if (line) say(k, line);
}

/* 状态改变入口：SSE → 角色 + 屏幕 */
function setAgentStage(k, status){
  const ch = characters[k];
  if (!ch) return;
  ch.stage.code = status;
  ch.stage.hold = status === "running" ? 0.4 : (status === "done" ? 2.2 : 2.6);
  if (status === "running" || status === "done" || status === "error") sayStage(k, status);
  const conf = STAGE_SHOW[k];
  if (!conf) return;
  const S = ch.desk && ch.desk.userData.screen;
  if (!S) return;
  if (status === "running"){
    S.mode = conf.screen; S.hold = 1e9; S.timer = 0;
  } else if (status === "done" || status === "error"){
    S.hold = 3.0; S.timer = 3.0;
    if (status === "error") S.mode = "alert";
  }
}

/* ===================== 电脑屏幕内容 ===================== */
const CAD_WIRE = (function(){
  const seg = 16, prof = [[-0.55, 0.30], [-0.38, 0.52], [-0.05, 0.60],
                          [0.22, 0.44], [0.40, 0.20], [0.55, 0.06]];
  const rings = prof.map(([y, r]) => {
    const a = [];
    for (let i = 0; i < seg; i++){
      const th = i / seg * Math.PI * 2;
      a.push([Math.cos(th) * r, y, Math.sin(th) * r]);
    }
    return a;
  });
  const L = [];
  rings.forEach(rg => {
    for (let i = 0; i < seg; i++){
      const p = rg[i], q = rg[(i + 1) % seg];
      L.push([p[0], p[1], p[2], q[0], q[1], q[2]]);
    }
  });
  for (let i = 0; i < seg; i += 1){
    for (let j = 0; j < prof.length - 1; j++){
      const p = rings[j][i], q = rings[j + 1][i];
      L.push([p[0], p[1], p[2], q[0], q[1], q[2]]);
    }
  }
  return L;
})();

const IDLE_SCREENS = ["code", "cad", "chat", "game", "video", "chart", "social"];

function scrHead(ctx, W, H, accent, title, right){
  ctx.fillStyle = "#070c13"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.045)"; ctx.fillRect(0, 0, W, 26);
  ctx.fillStyle = accent; ctx.fillRect(0, 0, 3, 26);
  ctx.font = "600 13px -apple-system,'PingFang SC',sans-serif";
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  ctx.fillStyle = "#b9cadd";
  ctx.fillText(title, 10, 13);
  if (right){
    ctx.textAlign = "right"; ctx.fillStyle = accent;
    ctx.fillText(right, W - 10, 13);
  }
  ctx.textAlign = "left";
}

function scrBar(ctx, x, y, w, h, pct, color, bg){
  ctx.fillStyle = bg || "rgba(255,255,255,0.10)";
  roundRectPath(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = color;
  roundRectPath(ctx, x, y, Math.max(2, w * Math.max(0, Math.min(1, pct))), h, h / 2); ctx.fill();
}

function drawScreen(ch, dt, t){
  const S = ch.desk && ch.desk.userData.screen;
  if (!S) return;
  S.phase += dt;
  if (S.hold > 0){
    S.hold -= dt;
    if (S.hold <= 0 && S.mode === "alert") S.mode = "code";
  } else {
    S.timer -= dt;
    if (S.timer <= 0){
      S.mode = IDLE_SCREENS[Math.floor(Math.random() * IDLE_SCREENS.length)];
      S.timer = 9 + Math.random() * 9;
    }
  }
  if (S.phase < 0.11) return;
  S.phase = 0;

  const ctx = S.ctx, W = S.canvas.width, H = S.canvas.height, A = S.accent;
  const m = S.mode;
  const env = sky.phase;                       // 白天/夜晚影响屏幕亮度
  ctx.globalAlpha = 1;

  if (m === "cad"){
    scrHead(ctx, W, H, A, "mesh_view.stl", "BambuVision 3D");
    ctx.strokeStyle = "rgba(120,200,255,0.16)";
    ctx.lineWidth = 1;
    for (let gx = 0; gx < W; gx += 24){ ctx.beginPath(); ctx.moveTo(gx, 28); ctx.lineTo(gx, H - 22); ctx.stroke(); }
    for (let gy = 30; gy < H - 20; gy += 24){ ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
    const ry = t * 0.9, rx = 0.42;
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cx2 = Math.cos(rx), sx2 = Math.sin(rx);
    const R = 96, cx0 = W / 2, cy0 = H / 2 + 8;
    const proj = p => {
      const x1 = p[0] * cy + p[2] * sy, z1 = -p[0] * sy + p[2] * cy;
      const y1 = p[1] * cx2 - z1 * sx2, z2 = p[1] * sx2 + z1 * cx2;
      const d = 2.6 / (2.6 + z2 * 0.6);
      return [cx0 + x1 * R * d, cy0 - y1 * R * d, z2];
    };
    ctx.lineWidth = 1.2;
    CAD_WIRE.forEach(s => {
      const p = proj([s[0], s[1], s[2]]), q = proj([s[3], s[4], s[5]]);
      const sh = (p[2] + q[2]) * 0.5;
      ctx.strokeStyle = "rgba(" + (sh > 0 ? "140,235,255" : "80,150,200") + "," + (sh > 0 ? 0.85 : 0.45) + ")";
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    });
    /* 扫描线与尺寸标注 */
    const sy2 = 34 + ((t * 46) % (H - 60));
    ctx.strokeStyle = "rgba(120,230,255,0.55)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(8, sy2); ctx.lineTo(W - 8, sy2); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath(); ctx.moveTo(20, H - 26); ctx.lineTo(120, H - 26); ctx.stroke();
    ctx.fillStyle = "rgba(190,220,240,0.9)";
    ctx.font = "11px monospace";
    ctx.fillText("86.40 mm", 22, H - 32);
    ctx.fillStyle = A;
    ctx.fillText("V 12,486  F 24,972  T 0.42", 10, H - 10);
  } else if (m === "print"){
    scrHead(ctx, W, H, A, "打印监控", "LIVE");
    const job = printJobs.big;
    const P = MACHINE_PROFILE.big;   // P0-3：屏幕与悬停卡共用机型工况常量
    ctx.fillStyle = "rgba(160,200,230,0.85)";
    ctx.font = "600 13px -apple-system,'PingFang SC',sans-serif";
    ctx.fillText(P.title, 12, 44);
    scrBar(ctx, 12, 54, W - 24, 14, job.progress / 100, "#fbbf24");
    ctx.fillStyle = "#dbe7f3";
    ctx.font = "11px monospace";
    ctx.fillText("进度 " + job.progress.toFixed(0) + "%  层 " +
                 Math.round(job.progress * P.layerPerPct) + "/" + P.totalLayers, 12, 82);
    /* 温度曲线 */
    ctx.strokeStyle = "rgba(255,140,120,0.9)"; ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++){
      const px = 12 + i * ((W - 24) / 60);
      const py = 132 + Math.sin(i * 0.4 + t * 2) * 4 + Math.sin(i * 1.7) * 2;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(180,210,235,0.8)";
    ctx.font = "10px monospace";
    ctx.fillText("喷嘴 " + (job.nozzleT || "--") + "°C   热床 " + (job.bedT || "--") +
                 "°C   舱温 " + P.chamberC + "°C", 12, 152);
    ctx.fillText("剩余 " + Math.max(0, Math.round((100 - job.progress) * P.minPerPct)) + " min", 12, 168);
    /* 料卷余量 */
    ctx.fillStyle = "rgba(120,220,170,0.9)";
    ctx.beginPath(); ctx.arc(W - 44, 132, 22, 0, Math.PI * 2 * 0.72); ctx.stroke();
    ctx.font = "10px monospace";
    ctx.fillText(FILAMENT.material + " " + FILAMENT.remainPct + "%", W - 74, 164);
  } else if (m === "table"){
    scrHead(ctx, W, H, A, "FMEA 失效模式清单", "RPN");
    const rows = [["层间剥离", "8", "中"], ["喷嘴堵塞", "6", "低"],
                  ["翘边变形", "9", "高"], ["支撑断裂", "7", "中"], ["热漂移", "5", "低"]];
    const n = Math.min(rows.length, 1 + Math.floor((t % 6) / 1.1));
    rows.slice(0, n).forEach((r, i) => {
      const y = 38 + i * 30;
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.07)";
      ctx.fillRect(8, y, W - 16, 26);
      ctx.fillStyle = "#cddced";
      ctx.font = "12px -apple-system,'PingFang SC',sans-serif";
      ctx.fillText(r[0], 16, y + 13);
      ctx.fillStyle = "#fbbf24"; ctx.font = "11px monospace";
      ctx.fillText("S" + r[1], W - 92, y + 13);
      const tone = r[2] === "高" ? "#f87171" : r[2] === "中" ? "#fbbf24" : "#34d399";
      ctx.fillStyle = tone; ctx.font = "600 12px -apple-system,'PingFang SC',sans-serif";
      ctx.fillText(r[2], W - 44, y + 13);
    });
    if (n >= rows.length){
      ctx.fillStyle = "rgba(248,113,113,0.9)";
      ctx.font = "12px -apple-system,'PingFang SC',sans-serif";
      ctx.fillText("风险等级：B（需优化后打印）", 12, H - 14);
    } else {
      ctx.fillStyle = "rgba(160,190,215,0.7)";
      ctx.font = "12px -apple-system,'PingFang SC',sans-serif";
      ctx.fillText("扫描中" + ".".repeat(1 + Math.floor(t * 2) % 4), 12, H - 14);
    }
  } else if (m === "suggest"){
    scrHead(ctx, W, H, A, "优化建议 · 待评审", "4 项");
    const items = ["壁厚 0.8→1.2mm，提升强度", "悬垂角 >55° 处加支撑",
                   "圆角 R2 过渡，降低应力集中", "减重 12%，缩短打印 18%"];
    const n = Math.min(items.length, 1 + Math.floor((t % 7) / 1.4));
    items.slice(0, n).forEach((s, i) => {
      const y = 40 + i * 34;
      ctx.strokeStyle = i % 2 ? "#34d399" : "rgba(160,190,215,0.8)";
      ctx.lineWidth = 1.6;
      ctx.strokeRect(14, y, 14, 14);
      if (i % 2){ ctx.beginPath(); ctx.moveTo(17, y + 7); ctx.lineTo(20, y + 11); ctx.lineTo(25, y + 3); ctx.stroke(); }
      ctx.fillStyle = "#d6e3f0";
      ctx.font = "12px -apple-system,'PingFang SC',sans-serif";
      ctx.fillText(s, 38, y + 8);
    });
    scrBar(ctx, 14, H - 30, W - 28, 10, 0.35 + 0.45 * Math.abs(Math.sin(t * 0.6)), A);
  } else if (m === "chat"){
    scrHead(ctx, W, H, A, "Marvis", "在线");
    const msgs = [["M", "帮我出一版可打印的最优结构", A],
                  ["A", "已收到，正在生成优化建议…", "#2b3646"],
                  ["M", "顺便把支撑降到最少", A],
                  ["A", "好的，正在重算悬垂与支撑", "#2b3646"]];
    const n = Math.min(msgs.length, 1 + Math.floor((t % 8) / 1.6));
    msgs.slice(0, n).forEach((mm, i) => {
      const y = 38 + i * 40;
      const right = mm[0] === "M";
      const bw = 150 + (i % 2) * 40;
      ctx.fillStyle = mm[2];
      roundRectPath(ctx, right ? W - bw - 12 : 12, y, bw, 30, 10); ctx.fill();
      ctx.fillStyle = right ? "#eaf6ff" : "#dbe7f3";
      ctx.font = "11px -apple-system,'PingFang SC',sans-serif";
      ctx.fillText(mm[1].slice(0, 20), right ? W - bw - 4 : 20, y + 15);
    });
    if (Math.floor(t * 2) % 2){
      ctx.fillStyle = A; ctx.fillRect(14, H - 22, 26, 9);
    }
  } else if (m === "game"){
    scrHead(ctx, W, H, A, "BREAKOUT", "SCORE 1280");
    const bx = W / 2 + Math.sin(t * 1.3) * 120, by = H / 2 + Math.cos(t * 0.9) * 60;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 7; c++){
        ctx.fillStyle = ["#38bdf8", "#34d399", "#fbbf24"][r];
        if ((c + r + Math.floor(t * 0.5)) % 3 === 0) continue;
        ctx.fillRect(40 + c * 44, 40 + r * 14, 38, 10);
      }
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(bx - 28, H - 30 + Math.sin(t * 3) * 6, 56, 8);
    ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = A;
    ctx.font = "11px monospace";
    ctx.fillText("LIVES ♥♥♥", 12, H - 12);
  } else if (m === "video"){
    scrHead(ctx, W, H, A, "Slicer Tutorial 12", "1080p");
    const g = ctx.createLinearGradient(0, 30, 0, H - 26);
    g.addColorStop(0, "rgba(56,189,248,0.35)"); g.addColorStop(1, "rgba(12,20,30,0.9)");
    ctx.fillStyle = g; ctx.fillRect(8, 30, W - 16, H - 62);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.moveTo(W / 2 - 14, H / 2 - 26); ctx.lineTo(W / 2 + 18, H / 2 - 8);
    ctx.lineTo(W / 2 - 14, H / 2 + 10); ctx.closePath(); ctx.fill();
    const p = (t * 0.05) % 1;
    scrBar(ctx, 12, H - 26, W - 24, 8, p, "#f87171");
    ctx.fillStyle = "rgba(200,220,240,0.8)";
    ctx.font = "11px -apple-system,'PingFang SC',sans-serif";
    ctx.fillText("03:" + String(Math.floor(p * 60)).padStart(2, "0") + " / 12:40", 12, H - 40);
  } else if (m === "chart"){
    scrHead(ctx, W, H, A, "本周产出看板", "↑ 18%");
    for (let i = 0; i < 7; i++){
      const h = 30 + Math.abs(Math.sin(i * 1.7 + t * 0.4)) * 88;
      ctx.fillStyle = i === 6 ? A : "rgba(120,180,230,0.55)";
      ctx.fillRect(22 + i * 48, H - 34 - h, 30, h);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    for (let i = 1; i < 4; i++){
      ctx.beginPath(); ctx.moveTo(14, H - 34 - i * 30); ctx.lineTo(W - 12, H - 34 - i * 30); ctx.stroke();
    }
    ctx.fillStyle = "rgba(180,210,235,0.85)";
    ctx.font = "11px monospace";
    ctx.fillText("打印 128 件   成功率 96.1%", 14, H - 12);
  } else if (m === "social"){
    scrHead(ctx, W, H, A, "动态", "12 条新");
    for (let i = 0; i < 4; i++){
      const y = 36 + i * 40;
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      roundRectPath(ctx, 10, y, W - 20, 34, 8); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.beginPath(); ctx.arc(28, y + 17, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#d6e3f0";
      ctx.font = "11px -apple-system,'PingFang SC',sans-serif";
      ctx.fillText(["优化师", "打工人", "打印哥", "小助理"][i] + "：搞定一版新结构 ✓", 46, y + 17);
      ctx.fillStyle = "#f87171";
      ctx.fillText("♥", W - 34, y + 17);
    }
  } else if (m === "dash"){
    scrHead(ctx, W, H, A, "全域进度", "统筹中");
    ["geometry", "printability", "failure", "optimization"].forEach((k, i) => {
      const y = 40 + i * 40;
      const st = state[k];
      ctx.fillStyle = "rgba(200,220,240,0.9)";
      ctx.font = "12px -apple-system,'PingFang SC',sans-serif";
      ctx.fillText(AGENT_META[k].name, 12, y);
      const tone = st === "running" ? "#fbbf24" : st === "done" ? "#34d399" : "rgba(255,255,255,0.2)";
      scrBar(ctx, 12, y + 8, W - 24, 9, st === "done" ? 1 : st === "running" ? 0.5 + 0.3 * Math.sin(t * 4) : 0.04, tone);
    });
  } else if (m === "alert"){
    scrHead(ctx, W, H, A, "异常", "ERROR");
    ctx.fillStyle = "rgba(248,113,113,0.9)";
    ctx.font = "600 20px -apple-system,'PingFang SC',sans-serif";
    ctx.fillText("工序中断，需人工介入", 20, H / 2 - 8);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "12px monospace";
    ctx.fillText("E_TIMEOUT @ step " + (3 + Math.floor(t) % 4), 20, H / 2 + 20);
  } else {
    /* code：代码编辑器 */
    scrHead(ctx, W, H, A, "pipe.py", "Python");
    const lines = [
      [["def ", "#c084fc"], ["run_pipeline", "#7dd3fc"], ["(mesh):", "#e2e8f0"]],
      [["    ", "#e2e8f0"], ["g = ", "#e2e8f0"], ["Geometry", "#7dd3fc"], ["(mesh)", "#e2e8f0"]],
      [["    ", "#e2e8f0"], ["if ", "#c084fc"], ["g.watertight", "#93c5fd"], [" is ", "#c084fc"], ["False", "#fca5a5"], [":", "#e2e8f0"]],
      [["        ", "#e2e8f0"], ["raise ", "#c084fc"], ["MeshError", "#fca5a5"], ["()", "#e2e8f0"]],
      [["    ", "#e2e8f0"], ["return ", "#c084fc"], ["solver", "#7dd3fc"], [".", "#e2e8f0"], ["optimize", "#7dd3fc"], [".", "#e2e8f0"], ["go", "#7dd3fc"], ["()", "#e2e8f0"]]
    ];
    const scroll = Math.floor((t * 2) % 2);
    lines.forEach((ln, i) => {
      const y = 40 + (i - scroll) * 22;
      if (y < 28 || y > H - 16) return;
      ctx.font = "11px monospace";
      ctx.fillStyle = "rgba(120,150,180,0.55)";
      ctx.fillText(String(i + 1).padStart(2, " "), 8, y);
      let x = 30;
      ln.forEach(tk => {
        ctx.fillStyle = tk[1];
        ctx.fillText(tk[0], x, y);
        x += ctx.measureText(tk[0]).width;
      });
    });
    ctx.fillStyle = "rgba(6,12,20,0.85)";
    ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = "rgba(52,211,153,0.9)";
    ctx.font = "11px monospace";
    ctx.fillText("$ python pipe.py --mesh part.stl", 10, H - 26);
    ctx.fillStyle = "rgba(200,220,240,0.75)";
    ctx.fillText("✓ 校验通过 · " + (42 + Math.floor(t) % 9) + " ms", 10, H - 10);
  }
  S.tex.needsUpdate = true;
}

/* ===================== 眨眼 / 呼吸等细节 ===================== */
function microMotion(ch, dt, t){
  if (ch.blinkT == null){ ch.blinkT = 1.5 + Math.random() * 3.5; ch.blinkOpen = 1; }
  ch.blinkT -= dt;
  const eyes = ch.head.userData.eyes || [];
  if (ch.blinkT <= 0){
    ch.blinkT = 2.0 + Math.random() * 4.0;
    eyes.forEach(e => { e.scale.y = 0.12; });
    ch.blinkHold = 0.11;
  } else if (ch.blinkHold > 0){
    ch.blinkHold -= dt;
    if (ch.blinkHold <= 0) eyes.forEach(e => { e.scale.y = 1; });
  }
  /* 呼吸：胸腔轻微起伏 */
  const br = 1 + Math.sin(t * 1.7 + (ch.offset || 0)) * 0.012;
  ch.torso.scale.set(br, 1, br);
}

/* ===================== 主循环 tick ===================== */
function tick(dt, t){
  updateSky(dt);
  updateLights(dt);
  updateView(dt);
  updateControls(dt);    // 自由缩放的平滑追帧（机位缓动期间自动让位）
  updatePrinters(dt, t);
  updateSocial(dt);
  updateHuddle(dt);
  updateOps(dt);
  tourTick(dt);          // P1-c：导览 FSM 推进（未导览时零开销）

  Object.keys(characters).forEach(k => {
    const ch = characters[k];
    if (!ch.current) ch.current = [ch.root.position.x, ch.root.position.z];

    let want = null;
    /* P1-c：导览进行中，参与者（导游 + 访客）的走位意图由 Tour FSM 接管，
       优先于员工走位链与访客锚点短路 */
    if (TOUR.active) want = tourWant(ch, k);
    /* P1-a：插件角色（访客）不进员工走位链（送件 / 会诊 / 串门 / 状态走位），
       固定留在自己的锚点上，姿态由注册时的 mode 决定（导览接管时让位） */
    const isVisitor = !!ch.isVisitor;
    if (!want && isVisitor && ch.anchor){
      want = { dest: ch.anchor, mode: ch.visitorMode || "stand", face: ch.facing };
    }
    /* P0-2：error / waiting / report 三态接管走位，压过送件与阶段动作
       （会诊期由 stateWant 内部让位，仅保留颜色告警） */
    const hi = isHighState(k);
    /* 打印送件 / 盯机流程：接管 printability（会诊期间让位，高优先级状态例外） */
    if (!want && k === "printability" && op.phase !== "seat" && huddle.t <= 0 && !hi){
      want = opWant(ch, dt);
    }
    /* 会诊期（huddle）不插走位，交给既有会诊排队逻辑，仅保留颜色告警 */
    if (!want && !isVisitor && hi && huddle.t <= 0) want = stateWant(ch, k, dt);
    const stWant = (!want && (k in STAGE_SHOW)) ? stageWant(ch, k, dt) : null;
    if (stWant) want = stWant;
    if (!want && social.act && (social.act.host === ch || social.act.guest === ch)){
      const isHost = social.act.host === ch;
      want = { dest: isHost ? ch.home : social.act.spot, mode: "talk",
               lookAt: isHost ? social.act.guest.root.position : social.act.host.root.position };
    }
    if (!want && !isVisitor && state.consensus === "running"){
      /* 全员共识：停下手里的事，看向中央全息台 */
      want = { dest: ch.isHost ? ch.home : ch.seat, mode: ch.isHost ? "point" : "stand",
               face: ch.facing, lookAt: { x: CX, z: CZ } };
    }
    if (!want && huddle.t > 0){
      /* 大型机下线会诊：四道工序的 Agent 一起围到机床前各干各的 */
      const H = HUDDLE[k];
      if (H){
        want = { dest: H.spot, mode: H.mode,
                 lookAt: { x: huddle.look[0], z: huddle.look[1] } };
      }
    }
    if (!want){
      /* calling v0：通话中的员工不再闲逛，先回自己工位站定再举手机（不打断任务链） */
      if (ch.callAct && !ch.isVisitor) want = { dest: ch.home, mode: "stand" };
    }
    if (!want){
      want = roamWant(ch, dt);
    }

    const arrived = walkTo(ch, want.dest, dt);
    ch.root.position.x = ch.current[0];
    ch.root.position.z = ch.current[1];

    /* 阶段计时：完成态先回位再庆祝，避免路上就把庆祝时间耗光 */
    if (ch.stage.hold > 0 && !(ch.stage.code === "done" && !arrived)){
      ch.stage.hold -= dt;
      if (ch.stage.hold <= 0 && ch.stage.code !== "running") ch.stage.code = "";
    }

    if (!arrived && ch.walk && ch.walk.i < ch.walk.pts.length){
      const p = ch.walk.pts[ch.walk.i];
      turnTo(ch, Math.atan2(p[0] - ch.root.position.x, p[1] - ch.root.position.z), dt, 7);
    } else if (want.lookAt){
      turnTo(ch, Math.atan2(want.lookAt.x - ch.root.position.x,
                            want.lookAt.z - ch.root.position.z), dt, 5);
    } else {
      turnTo(ch, (want.face != null ? want.face : ch.facing), dt, 5);
    }

    /* 入座下沉量由座面高度反解：髋关节略高于座面，小腿前伸角保证脚掌踏地。
       旧实现用固定 seatDrop=0.50，对 1.8m 角色会多沉约 4cm —— 臀部陷进椅垫、脚跟插进地板。 */
    const sc = ch.cfg.height / 1.86;
    const C = CONFIG.character;
    const seated = arrived && !ch.isHost && SIT_MODES.indexOf(want.mode) >= 0;
    let wantY = -C.standGap * sc;    // 站立/走动基准：把鞋底压到地面（模型鞋底离髋略短）
    ch.seatLean = 0;
    if (seated){
      const top = ch.seatTop != null ? ch.seatTop : C.seatTop;
      const hipW = top + 0.005;                                   // 目标髋高：略高于座面
      wantY = Math.max(-C.seatDrop * sc, hipW - C.hipLocal * sc);
      const cosT = Math.max(0, Math.min(1, (hipW / sc - C.thighDrop) / C.shinLen));
      ch.seatLean = Math.acos(cosT);                              // 小腿相对竖直的前伸角
    }
    if (ch.groundFixCur == null) ch.groundFixCur = 0;   // 标定出的落地残差（慢速生效，见下方标定块）
    ch.root.position.y += (wantY + ch.groundFixCur - ch.root.position.y) * Math.min(1, dt * 6);

    /* 头部微注视：目标不在正前方时扭头看 */
    let look = null;
    if (arrived && want.lookAt){
      let d = Math.atan2(want.lookAt.x - ch.root.position.x,
                         want.lookAt.z - ch.root.position.z) - ch.root.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      look = { yaw: Math.max(-0.70, Math.min(0.70, d * 0.55)) };
    }
    /* calling v0：通话中覆盖动作（phone / talk），只影响已到位角色，不改走位链 */
    ch.dbgMode = arrived ? (ch.callAct || want.mode) : "walk";
    poseLimbs(ch, ch.dbgMode, t + (ch.offset || 0), dt, look);
    microMotion(ch, dt, t);
    drawScreen(ch, dt, t);

    /* 落地校正（标定式）：坐/站到位后取 12 次鞋底最低点（每 3 帧一次），把厘米级残差
       一步求解进 ch.groundFix，并叠加到 wantY 上（不直接改 position.y）。
       旧实现每 3 帧把 -fy*0.6 直接加到 position.y，与上面 wantY 的 lerp 互斗形成极限环，
       加上姿势过渡期鞋底高度每帧都在变 —— 就是"坐着/站着一直颤抖"。
       现在 position.y 只由一条平滑曲线驱动，采样结束目标即冻结，稳态零高频抖动。 */
    const gfKey = seated
      ? "sit" + (ch.seatTop != null ? ch.seatTop.toFixed(2) : "")
      : "stand";
    if (!arrived){
      ch.gfKey = null; ch.gfN = 0;          // 走动中不标定，下次到位重来
    } else if (ch.gfKey !== gfKey){
      ch.gfKey = gfKey; ch.gfN = 0;         // 坐/站（或换椅子）切换后重标
    }
    if (ch.groundFix == null) ch.groundFix = 0;
    if (arrived && ch.gfN < 36){
      ch.gfN = (ch.gfN || 0) + 1;
      if (ch.gfN % 3 === 0){
        ch.root.updateMatrixWorld(true);
        const fy = footMinY(ch);
        /* 只学习"脚本来就该踩地"的厘米级残差；残差大于 15cm 说明这个姿势的腿脚本
           就没打算落地（抬腿/伸腿），学进去会把角色整体抬起或压到 clamp 上限。 */
        if (isFinite(fy) && Math.abs(fy) < 0.15)
          ch.groundFix = Math.max(-0.09, Math.min(0.09, ch.groundFixCur - fy));
      }
    }
    ch.groundFixCur += (ch.groundFix - ch.groundFixCur) * Math.min(1, dt * 4.0);

    /* 悬浮介绍随状态更新 */
    if (ch.root.userData.tip){
      const st = state[k] || "idle";
      ch.root.userData.tip.desc = ch.isHost
        ? (ch.actLabel || (st === "running" ? "正在统筹四道工序" : "串联四道工序 · 主持共识台"))
        : (ch.actLabel || (st === "running" ? (STAGE_SHOW[k] ? STAGE_SHOW[k].label : "执行中")
                                            : ch.role));
    }
  });

  /* 角色互不穿身：放在所有人走位之后统一消解 */
  separateRoles(dt);

  /* P0-2：状态保鲜期衰减 + 问号浮层跟随 + 故障灯告警脉冲 */
  decayAgentState(dt);
  decayAgentMeta(dt);          // P0-3：卡片数据保鲜期到期自动清掉
  updateMarks();
  updateBeacon(dt);

  runExtensions("onTick", dt, t);
}

/* ---------------- 悬浮信息卡（默认隐藏，悬停 / 点击才显示） ----------------
   旧实现把角色提示写进宿主页的 #tag-* 元素（web_console 主控台专有），
   /office 纯净页没有这层 DOM → tagEls[k] 全为 null，悬停角色什么都不显示（本次修复的根因）。
   现在统一由本文件自建"单例卡片"渲染，任何宿主页表现一致；宿主标签层仅作兜底，
   需要时加 ?hostTags=1 显式打开。卡片跟随指针，样式集中在 BUBBLE_CSS。 */
const useHostTags = /[?&]hostTags=1/.test(location.search);
const tagEls = {};
Object.keys(characters).forEach(k => { tagEls[k] = document.getElementById("tag-" + k); });

const _v = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pickRoots = [];
let pickDirty = false;
/* 重建可悬停对象表（含运行期新增 / 移除的打印件） */
function rebuildPickRoots(){
  pickRoots.length = 0;
  scene.traverse(o => { if (o.userData && o.userData.tip) pickRoots.push(o); });
  pickDirty = false;
}
rebuildPickRoots();
/* 给任意物件挂 / 摘提示（打印件等运行期对象用这个，挂完自动重建拾取表） */
function attachTip(o, tip){
  if (!o) return;
  o.userData.tip = tip || null;
  pickDirty = true;
}

let hoverTip = null, pinnedTip = null, mouseX = 0, mouseY = 0;
const ownerKey = tip => {
  if (!tip) return null;
  const ent = Object.keys(characters).find(k => characters[k].root.userData.tip === tip);
  return ent || null;
};

/* 单例信息卡 DOM：所有可悬停对象共用，跟随指针 */
const tipDiv = document.createElement("div");
tipDiv.id = "office-tip";
tipDiv.className = "office-card";
tipDiv.style.display = "none";
document.body.appendChild(tipDiv);
/* calling v0：锁定卡上的"通话 / 挂断"按钮（卡片锁定后 pointer-events 放开，见 TIP_CSS） */
tipDiv.addEventListener("click", e => {
  const btn = e.target && e.target.closest ? e.target.closest(".office-card-call") : null;
  if (!btn) return;
  const ck = ownerKey(pinnedTip || hoverTip);
  if (!ck) return;
  e.stopPropagation();
  if (CALL.active && CALL.peer === ck) callEnd(); else call(ck);
  applyHint();
});

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TIP_DASH = '<span style="opacity:.42">—</span>';
/* 状态角标配色：沿用场景既有语义色（异常红 / 待确认琥珀 / 完成绿 / 进行蓝） */
const STATE_TINT = { error: "255,59,48", waiting: "251,191,36",
                     report: "52,211,153", done: "52,211,153",
                     running: "56,189,248", recalibrating: "56,189,248",
                     debating: "56,189,248" };
function badge(k, text, tint){
  const c = tint || STATE_TINT[stateOf(k)] || "148,180,210";
  return '<span class="office-card-badge" style="background:rgba(' + c + ',.16);' +
         'border-color:rgba(' + c + ',.45);color:rgb(' + c + ')">' + esc(text) + "</span>";
}

/* 一行：左侧标签，右侧值（pct 非空时再补一条进度条） */
function cardRow(label, value, pct){
  const v = (value == null || value === "") ? TIP_DASH : esc(value);
  const bar = (pct == null) ? "" :
    '<i class="office-card-bar"><b style="width:' +
      Math.max(0, Math.min(100, pct)) + '%"></b></i>';
  return '<div class="office-card-row"><span class="office-card-k">' + esc(label) + "</span>" +
         '<span class="office-card-v">' + v + bar + "</span></div>";
}

/* 角色卡：角色名 + 状态角标 + 职责，下面挂四行结构化信息（阶段 / 进度 / 置信度 / 输出摘要）。
   宿主没推任何 meta 时只留"角色名 + 职责"，即原有的角色名标签，不显示空卡片。 */
function agentHintHtml(k){
  const ch = characters[k], cfg = AGENT_META[k] || {};
  const meta = agentMeta[k] || null;
  const name = (ch && ch.name) || cfg.name || k;
  const duty = (ch && ch.role) || cfg.role || "";
  let html = '<div class="office-card-head"><b>' + esc(name) + "</b>" +
             badge(k, t("state." + stateOf(k))) + "</div>" +
             (duty ? '<div class="office-card-sub">' + esc(duty) + "</div>" : "");
  if (!meta) return html;
  html += cardRow(t("card.phase"), meta.phase || t("state." + stateOf(k)), null);
  html += cardRow(t("card.progress"),
                  meta.progress == null ? null : meta.progress + "%", meta.progress);
  html += cardRow(t("card.confidence"),
                  meta.confidence == null ? null : meta.confidence + "%", null);
  html += cardRow(t("card.digest"), meta.digest, null);
  return html;
}

/* 任意提示对象 → 卡片 HTML（title / desc / badge / rows；rows、badge 可为函数，取最新值） */
function hintHtml(tip){
  const key = ownerKey(tip);
  if (key) return agentHintHtml(key);
  const bd = typeof tip.badge === "function" ? tip.badge() : tip.badge;
  let html = '<div class="office-card-head"><b>' + esc(tip.title) + "</b>" +
             (bd ? '<span class="office-card-badge" style="background:rgba(148,180,210,.16);' +
                   'border-color:rgba(148,180,210,.45);color:rgb(148,180,210)">' +
                   esc(bd) + "</span>" : "") +
             "</div>" +
             (tip.desc ? '<div class="office-card-sub">' + esc(tip.desc) + "</div>" : "");
  const rows = typeof tip.rows === "function" ? (tip.rows() || []) : (tip.rows || []);
  rows.forEach(r => { html += cardRow(r[0], r[1], r[2] == null ? null : r[2]); });
  return html;
}

/* 悬停拾取：命中多个物件时按 tip.prio 选"主体"（打印件 4 > 角色 3 > 机器 / 家具 1），
   同级取离镜头最近的；避免角色站在打印机前就永远悬停不到机器。 */
function pickAt(){
  if (pickDirty) rebuildPickRoots();
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickRoots, true);
  let best = null, bestPrio = -1;
  for (let i = 0; i < hits.length; i++){
    let o = hits[i].object;
    while (o && !(o.userData && o.userData.tip)) o = o.parent;
    if (!o) continue;
    const tip = o.userData.tip, prio = tip.prio || 1;
    if (prio > bestPrio){ best = tip; bestPrio = prio; }
    if (bestPrio >= 4) break;
  }
  return best;
}

/* 把当前悬停 / 固定的提示渲染到单例卡片上（内容不变则不重排，避免每帧抖动） */
function applyHint(){
  const tip = pinnedTip || hoverTip;
  const key = ownerKey(tip);
  if (useHostTags){
    Object.keys(tagEls).forEach(k => {
      const el = tagEls[k];
      if (el) el.style.display = (tip && key === k) ? "block" : "none";
    });
  }
  if (!tip){
    if (tipDiv.style.display !== "none"){
      tipDiv.style.display = "none"; tipDiv.innerHTML = ""; tipDiv._html = "";
    }
    return;
  }
  /* P0-4：点击锁定后卡片加一圈高亮边 + 底部"已锁定 · 点击解锁"脚注（同一张卡换成锁定态） */
  const pinned = (tip === pinnedTip);
  let html = hintHtml(tip);
  /* calling v0：锁定角色卡挂"通话 / 挂断"入口（点它开面板，通话中再点挂断） */
  if (pinned && key){
    const on = CALL.active && CALL.peer === key;
    html += '<button class="office-card-call' + (on ? " is-on" : "") + '">' +
            esc(on ? t("call.hangup") : t("card.call")) + "</button>";
  }
  if (pinned) html += '<div class="office-card-pin">' + esc(t("card.pinned")) + "</div>";
  const cache = pinned ? "P|" + html : html;
  if (tipDiv._html !== cache){ tipDiv.innerHTML = html; tipDiv._html = cache; }
  tipDiv.classList.toggle("is-pinned", pinned);
  tipDiv.style.display = "block";
  const w = tipDiv.offsetWidth, h = tipDiv.offsetHeight;
  let x = mouseX + 16, y = mouseY - 14;
  if (x + w > window.innerWidth - 8) x = Math.max(8, mouseX - w - 16);
  if (y + h > window.innerHeight - 8) y = Math.max(8, mouseY - h - 10);
  if (y < 8) y = 8;
  tipDiv.style.left = x + "px";
  tipDiv.style.top = y + "px";
}

/* ---------------- 对话气泡（HTML 浮层，淡入淡出；文案走 i18n） ----------------
   用法：say("geometry", "Some line")  或插件里 window.__office.say(k, text)。
   样式集中在 BUBBLE_CSS，改外观只动这一处。 */
const BUBBLE_CSS = `
.office-bubble{
  position:absolute; z-index:38; pointer-events:none; display:none;
  max-width:${CONFIG.bubble.maxWidth}px; padding:7px 12px; border-radius:13px;
  background:rgba(250,252,255,.86); color:#26333f;
  border:1px solid rgba(140,175,215,.38);
  box-shadow:0 6px 16px rgba(0,0,0,.18);
  backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px);
  font:12.5px/1.5 -apple-system,'PingFang SC','Helvetica Neue',sans-serif;
  letter-spacing:.1px;
  transform-origin:50% 100%; will-change:opacity,transform;
}
.office-bubble::after{
  content:''; position:absolute; left:50%; bottom:-6px; margin-left:-6px;
  width:11px; height:11px; background:inherit;
  border-right:1px solid rgba(120,160,200,.45);
  border-bottom:1px solid rgba(120,160,200,.45);
  transform:rotate(45deg);
}
.office-mark{
  position:absolute; z-index:39; pointer-events:none; display:none;
  width:26px; height:26px; margin:-13px 0 0 -13px; border-radius:50%;
  background:rgba(251,191,36,.94); color:#3a2a05;
  border:1px solid rgba(255,255,255,.55);
  box-shadow:0 4px 12px rgba(0,0,0,.35);
  font:700 16px/26px -apple-system,'PingFang SC',sans-serif; text-align:center;
  animation:officeMarkPulse 1.4s ease-in-out infinite;
}
@keyframes officeMarkPulse{
  0%,100%{ transform:translateY(0) scale(1); }
  50%    { transform:translateY(-5px) scale(1.08); }
}
/* P0-3：悬停信息卡（单例 DOM，跟随指针；角色 / 机器 / 打印件共用一套样式） */
.office-card{
  position:fixed; display:none; z-index:41; pointer-events:none;
  min-width:186px; max-width:268px; padding:8px 11px 9px;
  border-radius:11px; background:rgba(9,17,27,.94); color:#dce8f4;
  border:1px solid rgba(120,190,240,.34);
  box-shadow:0 10px 26px rgba(0,0,0,.55);
  font:12px/1.45 -apple-system,'PingFang SC','Helvetica Neue',sans-serif;
  letter-spacing:.1px; will-change:left,top;
}
.office-card-head{ display:flex; align-items:center; gap:6px; }
.office-card-head b{ color:#eaf6ff; font-size:12.5px; font-weight:600; }
.office-card-badge{
  flex:0 0 auto; padding:0 6px; border-radius:8px; border:1px solid transparent;
  font-size:10.5px; line-height:16px; white-space:nowrap;
}
.office-card-sub{ margin-top:3px; opacity:.78; }
.office-card-row{
  display:flex; align-items:baseline; gap:8px; margin-top:4px;
  padding-top:4px; border-top:1px solid rgba(140,175,215,.16);
}
.office-card-k{ flex:0 0 auto; width:52px; opacity:.6; font-size:11px; }
.office-card-v{ flex:1 1 auto; text-align:right; word-break:break-word; }
.office-card-bar{
  display:block; height:3px; margin-top:3px; border-radius:2px;
  background:rgba(140,175,215,.22); overflow:hidden;
}
.office-card-bar b{
  display:block; height:100%; border-radius:2px;
  background:linear-gradient(90deg,rgba(56,189,248,.85),rgba(52,211,153,.9));
}
/* P0-4：点击锁定态 —— 高亮描边 + 底部解锁脚注（悬停态不显示，避免卡片变大跳动） */
.office-card.is-pinned{
  border-color:rgba(125,215,255,.86);
  box-shadow:0 10px 26px rgba(0,0,0,.55), 0 0 0 3px rgba(56,189,248,.20);
}
.office-card-pin{
  margin-top:5px; padding-top:4px; border-top:1px solid rgba(140,175,215,.16);
  font-size:10.5px; letter-spacing:.2px; opacity:.68; text-align:right;
}
/* calling v0：锁定卡才可交互（悬停卡保持穿透，避免挡住画布拖拽） */
.office-card.is-pinned{ pointer-events:auto; }
.office-card-call{
  display:block; width:100%; margin-top:6px; padding:5px 8px; border-radius:8px; cursor:pointer;
  background:rgba(90,200,160,.14); border:1px solid rgba(90,200,160,.48); color:#8ee6bd;
  font:11.5px/1.2 -apple-system,'PingFang SC','Helvetica Neue',sans-serif; letter-spacing:.3px;
}
.office-card-call:hover{ background:rgba(90,200,160,.26); }
.office-card-call.is-on{
  background:rgba(230,120,120,.18); border-color:rgba(240,130,130,.5); color:#ffb8b8;
}
`;
(function injectBubbleCss(){
  if (document.getElementById("office-bubble-css")) return;
  const st = document.createElement("style");
  st.id = "office-bubble-css";
  st.textContent = BUBBLE_CSS;
  document.head.appendChild(st);
})();

const bubbles = {};   // k -> { el, age, ttl, active }
/* 气泡挂在画布容器里（与角色 tag 同一套坐标系，百分比定位才不会跑偏） */
const bubbleLayer = (renderer.domElement && renderer.domElement.parentElement) || document.body;
/* 让某个角色冒一句气泡 */
function say(k, text){
  if (!text || !characters[k]) return;
  let b = bubbles[k];
  if (!b){
    const el = document.createElement("div");
    el.className = "office-bubble";
    el.style.display = "none";
    bubbleLayer.appendChild(el);
    b = bubbles[k] = { el, age: 0, ttl: CONFIG.bubble.life, active: false };
  }
  b.el.textContent = text;
  b.age = 0; b.ttl = CONFIG.bubble.life; b.active = true;
}
/* 每帧推进淡入淡出 + 跟随角色头顶 */
function updateBubbles(dt){
  const cfg = CONFIG.bubble;
  Object.keys(bubbles).forEach(k => {
    const b = bubbles[k], ch = characters[k];
    if (!b.active) return;
    if (!ch){ b.active = false; b.el.style.display = "none"; return; }
    b.age += dt;
    if (b.age >= b.ttl){ b.active = false; b.el.style.display = "none"; return; }
    const a = Math.min(1, b.age / cfg.fadeIn) * Math.min(1, (b.ttl - b.age) / cfg.fadeOut);
    _v.set(ch.root.position.x,
           ch.root.position.y + cfg.headY * (ch.cfg.height / 1.86),
           ch.root.position.z);
    _v.project(camera);
    if (_v.z > 1){ b.el.style.display = "none"; return; }
    b.el.style.display = "block";
    b.el.style.left = ((_v.x * 0.5 + 0.5) * 100).toFixed(2) + "%";
    b.el.style.top  = ((-_v.y * 0.5 + 0.5) * 100).toFixed(2) + "%";
    b.el.style.opacity = (a * cfg.opacity).toFixed(3);
    b.el.style.transform = "translate(-50%,-100%) scale(" + (0.94 + 0.06 * a).toFixed(3) + ")";
  });
}

/* ---------------- calling v0：文字通话原型 ----------------
   链路：点角色（锁定卡）→ 卡片上"通话"→ 右下角通话面板 → 我方发言 → 角色气泡回话 + 姿态切换。
   红线与边界：
   · 不发起通话时零足迹：面板 DOM 懒创建，角色姿态仅在通话中覆盖；
   · 应答走 EXTENSIONS.onCallEvent(peer, kind, text, api) 钩子，插件可在钩子里调
     api.callReply(text) 接管应答（接管后不再走内置兜底文案）；kind ∈ start / user / end；
   · 兜底应答是 v0 占位（见下方 call.ack 文案），接真实 Agent 时由插件覆盖；
   · 姿态复用既有动作库：全程 phone，对方开口后 2.6s 内切 talk，只覆盖 arrived 后的动作选择。 */
const CALL = { active: false, peer: null, msgs: [], t0: 0, pending: 0, el: null, log: null, input: null };
const CALL_TALK_MS = 2600;

const CALL_CSS = `
.office-call{
  position:fixed; right:16px; bottom:16px; z-index:44; display:none; width:290px;
  border-radius:13px; overflow:hidden; background:rgba(9,17,27,.95); color:#dce8f4;
  border:1px solid rgba(120,190,240,.34); box-shadow:0 14px 34px rgba(0,0,0,.55);
  font:12px/1.5 -apple-system,'PingFang SC','Helvetica Neue',sans-serif;
}
.office-call-head{
  display:flex; align-items:center; gap:7px; padding:8px 10px;
  background:rgba(120,190,240,.10); border-bottom:1px solid rgba(120,190,240,.18);
}
.office-call-dot{
  width:7px; height:7px; border-radius:50%; background:#6fe0a8;
  box-shadow:0 0 7px rgba(110,225,170,.85);
}
.office-call-name{ flex:1; font-weight:600; letter-spacing:.2px; }
.office-call-time{ font-size:10.5px; opacity:.62; font-variant-numeric:tabular-nums; }
.office-call-body{
  max-height:188px; overflow-y:auto; padding:9px 10px;
  display:flex; flex-direction:column; gap:6px;
}
.office-call-msg{ max-width:82%; padding:5px 9px; border-radius:10px; word-break:break-word; }
.office-call-msg.me{
  align-self:flex-end; background:rgba(90,190,150,.20);
  border:1px solid rgba(90,200,160,.42); color:#c8f2dc;
}
.office-call-msg.peer{
  align-self:flex-start; background:rgba(120,170,230,.16);
  border:1px solid rgba(130,180,240,.38);
}
.office-call-msg.sys{
  align-self:center; background:none; border:none; opacity:.6; font-size:10.5px; padding:1px 0;
}
.office-call-foot{
  display:flex; gap:6px; padding:8px 10px; border-top:1px solid rgba(120,190,240,.18);
}
.office-call-input{
  flex:1; min-width:0; padding:5px 8px; border-radius:8px; outline:none;
  background:rgba(255,255,255,.06); border:1px solid rgba(120,190,240,.30);
  color:#e6f0fa; font:12px/1.3 inherit;
}
.office-call-input:focus{ border-color:rgba(120,200,250,.62); }
.office-call-btn{
  padding:5px 9px; border-radius:8px; cursor:pointer; background:rgba(120,190,240,.16);
  border:1px solid rgba(120,190,240,.42); color:#cfe6fb; font:11.5px/1.2 inherit;
}
.office-call-btn:hover{ background:rgba(120,190,240,.28); }
.office-call-btn.hang{
  background:rgba(230,120,120,.16); border-color:rgba(240,130,130,.5); color:#ffc0c0;
}
/* calling v1：语音控件样式。仅在开启语音后才会创建对应节点，未开启时 v0 面板逐像素不变 */
.office-call-hint{
  padding:0 10px 7px; font-size:10.5px; line-height:1.45; opacity:.7; display:none;
}
.office-call-hint.is-warn{ color:#ffc78a; opacity:.96; }
.office-call-btn.mic{ min-width:66px; }
.office-call-btn.mic.is-live{
  background:rgba(235,110,110,.32); border-color:rgba(255,140,140,.78); color:#ffe2e2;
}
.office-call-btn.mic.is-off{ opacity:.4; cursor:not-allowed; }
.office-call-btn.voice.is-on{
  background:rgba(90,200,160,.20); border-color:rgba(110,225,180,.55); color:#c9f4e0;
}
`;
/* 样式懒注入：只有真的发起通话才插入 style，保证未通话时零足迹 */
function injectCallCss(){
  if (document.getElementById("office-call-css")) return;
  const st = document.createElement("style");
  st.id = "office-call-css";
  st.textContent = CALL_CSS;
  document.head.appendChild(st);
}

/* 取 i18n 里的文案池（可能是数组）随机一条 */
function callPick(key){
  const v = t(key);
  if (Array.isArray(v)) return v[Math.floor(Math.random() * v.length)];
  return v;
}
function callEnsureDom(){
  if (CALL.el) return CALL.el;
  injectCallCss();
  const el = document.createElement("div");
  el.className = "office-call";
  el.innerHTML =
    '<div class="office-call-head"><i class="office-call-dot"></i>' +
      '<b class="office-call-name"></b><span class="office-call-time"></span></div>' +
    '<div class="office-call-body"></div>' +
    '<div class="office-call-foot">' +
      '<input class="office-call-input" type="text">' +
      '<button class="office-call-btn send"></button>' +
      '<button class="office-call-btn hang"></button></div>';
  document.body.appendChild(el);
  CALL.el = el;
  CALL.log = el.querySelector(".office-call-body");
  CALL.input = el.querySelector(".office-call-input");
  const send = () => { const v = CALL.input.value.trim(); if (v) callSayUser(v); };
  el.querySelector(".send").addEventListener("click", send);
  el.querySelector(".hang").addEventListener("click", () => callEnd());
  /* 输入时把按键留在面板内：C / V / 数字等场景快捷键不该被带动 */
  CALL.input.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter"){ e.preventDefault(); send(); }
  });
  /* calling v1：语音已开启时才往面板里补语音控件（未开启 = v0 面板原样） */
  if (CALLV.on) callVoiceMount();
  return el;
}
function callRenderHead(){
  if (!CALL.el) return;
  const ch = characters[CALL.peer];
  CALL.el.querySelector(".office-call-name").textContent =
    t("call.title") + " · " + ((ch && ch.name) || CALL.peer || "");
  CALL.el.querySelector(".send").textContent = t("call.send");
  CALL.el.querySelector(".hang").textContent = t("call.hangup");
  CALL.input.placeholder = t("call.placeholder");
  /* calling v1：语音控件文案（未开语音时 CALLV.vbtn 为 null，v0 渲染路径不变） */
  callVoiceRender();
}
function callRender(){
  if (!CALL.el) return;
  callRenderHead();
  CALL.log.innerHTML = CALL.msgs.map(m =>
    '<div class="office-call-msg ' + m.who + '">' + esc(m.text) + "</div>").join("");
  CALL.log.scrollTop = CALL.log.scrollHeight;
}
function callPush(who, text){ CALL.msgs.push({ who, text: String(text) }); callRender(); }
/* 广播通话事件给插件（kind: start / user / end） */
function callFire(peer, kind, text){
  runExtensions("onCallEvent", peer, kind, text == null ? null : String(text));
}
function call(id, opts){
  if (!characters[id]) return { ok: false, reason: "no-peer" };
  if (CALL.active && CALL.peer === id) return { ok: true, peer: id, already: true };
  if (CALL.active) callEnd();
  const ch = characters[id];
  CALL.active = true; CALL.peer = id; CALL.msgs = []; CALL.t0 = performance.now(); CALL.pending = 0;
  callEnsureDom();
  CALL.el.style.display = "block";
  CALL.el.querySelector(".office-call-time").textContent = "00:00";
  callPush("sys", t("call.start").replace("{name}", ch.name || id));
  ch.callAct = "phone"; ch.callTalkT = 0;
  callFire(id, "start", null);
  /* 开场问候：钩子方没接管（仍无对方消息）就用内置文案 */
  CALL.pending = 1;
  const hello = callPick("call.hello");
  window.setTimeout(() => {
    if (CALL.active && CALL.peer === id && CALL.pending === 1) callReply(hello, true);
  }, 420);
  return { ok: true, peer: id, name: ch.name || id };
}
/* 我方发言：入面板 → 广播钩子 → 钩子方可在事件内同步调 callReply 接管应答 */
function callSayUser(text){
  if (!CALL.active) return { ok: false, reason: "no-call" };
  const s = String(text == null ? "" : text).trim();
  if (!s) return { ok: false, reason: "empty" };
  const peer = CALL.peer;
  callPush("me", s);
  if (CALL.input) CALL.input.value = "";
  CALL.pending = 1;
  callFire(peer, "user", s);
  if (CALL.pending === 1){
    CALL.pending = 0;
    const ack = callPick("call.ack");      /* v0 占位应答；插件接管后不会走到这里 */
    window.setTimeout(() => {
      if (CALL.active && CALL.peer === peer) callReply(ack, true);
    }, 420);
  }
  return { ok: true, peer };
}
/* 对方回话：插件应答与内置兜底共用；回话时开口姿态（talk）并冒气泡 */
function callReply(text, isFallback){
  if (!CALL.active) return { ok: false, reason: "no-call" };
  const s = String(text == null ? "" : text).trim();
  if (!s) return { ok: false, reason: "empty" };
  CALL.pending = 0;
  callPush("peer", s);
  const ch = characters[CALL.peer];
  if (ch){
    ch.callTalkT = performance.now();
    ch.callAct = "talk";
    say(CALL.peer, s);
  }
  /* calling v1：Agent 回话自动播报。未开语音 / 未打开扬声器时本调用立即返回，零副作用 */
  callSpeak(s);
  return { ok: true, peer: CALL.peer, fallback: !!isFallback };
}
function callEnd(){
  if (!CALL.active) return { ok: false, reason: "no-call" };
  const peer = CALL.peer;
  callFire(peer, "end", null);
  const ch = characters[peer];
  if (ch){ ch.callAct = null; ch.callTalkT = 0; }
  CALL.active = false; CALL.peer = null; CALL.pending = 0;
  if (CALL.el) CALL.el.style.display = "none";
  callVoiceReset();   /* calling v1：挂断即停播报、关麦克风（未开语音时零动作） */
  return { ok: true, peer };
}
function callState(){
  return { active: CALL.active, peer: CALL.peer,
           uptime: CALL.active ? (performance.now() - CALL.t0) / 1000 : 0,
           msgs: CALL.msgs.slice() };
}
/* 每帧：维持通话姿态（开口 2.6s 后收回 phone）+ 刷新计时 */
function callTick(){
  if (!CALL.active) return;
  const ch = characters[CALL.peer];
  if (!ch){ callEnd(); return; }
  ch.callAct = (ch.callTalkT && performance.now() - ch.callTalkT < CALL_TALK_MS) ? "talk" : "phone";
  if (CALL.el){
    const s = Math.floor((performance.now() - CALL.t0) / 1000);
    CALL.el.querySelector(".office-call-time").textContent =
      String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }
}

/* ==========================================================================
 * calling v1：语音通话（TTS 播报 + 浏览器原生语音识别）
 *   三条硬约束：
 *     1) 零新依赖——播报用本机 /usr/bin/say 合成的 wav（后端 GET /tts），
 *        识别用 Chrome 原生 webkitSpeechRecognition(zh-CN)；不装 whisper/ffmpeg/模型；
 *     2) 零足迹——默认 CALLV.on=false，不建 DOM、不探针、不留 Audio 元素，
 *        面板与场景与 v0 逐像素一致；只有 __office.callVoice(true) 或面板语音按钮
 *        才真正建链；
 *     3) 不阻断——TTS 不可用 → 回话只显示文字并在面板明示；识别不可用 / 麦克风
 *        被拒 → 自动退回 v0 文字输入，通话照常继续。
 *   v0 的 call/callSay/callReply/callEnd/callState 签名、返回结构与钩子时序一律未改。
 * ======================================================================== */
const CALLV = {
  on: false,          // 语音总开关（默认关：未开启时对场景与接口零影响）
  probing: false,     // 探针进行中
  tts: false,         // 后端 /tts 是否可用
  voice: "",          // 后端给的默认发音人（仅透传展示）
  sr: false,          // 本浏览器是否支持语音识别
  srState: "idle",    // idle / listening
  micDenied: false,   // 麦克风是否被拒（被拒也不阻断通话）
  hint: "",           // 面板提示文案
  hintWarn: false,    // 提示是否为降级警告
  mounted: false,     // 语音控件是否已创建
  el: null, hintEl: null, micBtn: null, vbtn: null,
  audio: null, rec: null, recBase: "", recFinal: ""
};
const CALLV_TTS_MAX = 280;   // 单次播报字符上限（后端默认 300，留余量）
let _callvProbe = null;      // 探针结果缓存（Promise，避免重复请求）

function callVoiceSupported(){
  const w = typeof window === "undefined" ? null : window;
  return !!(w && (w.SpeechRecognition || w.webkitSpeechRecognition));
}
/* 后端 TTS 能力探针：只查一次；失败（后端没起 / 无 say）一律当作"不可用" */
function callVoiceProbe(force){
  if (CALLV.probing) return _callvProbe || Promise.resolve(false);
  if (!force && _callvProbe) return _callvProbe;
  CALLV.probing = true;
  _callvProbe = (function(){
    if (typeof fetch !== "function"){ CALLV.probing = false; return Promise.resolve(false); }
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => { try { ctl.abort(); } catch(e){} }, 6000) : null;
    return fetch("/tts/status", ctl ? { signal: ctl.signal } : undefined)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        CALLV.tts = !!(j && j.available);
        CALLV.voice = (j && j.default_voice) || "";
        return CALLV.tts;
      })
      .catch(() => { CALLV.tts = false; return false; })
      .then(ok => { CALLV.probing = false; if (timer) clearTimeout(timer); return ok; });
  })();
  return _callvProbe;
}
/* 面板提示（用于明示降级原因，不弹窗、不打断输入） */
function callVoiceHint(text, warn){
  CALLV.hint = text || ""; CALLV.hintWarn = !!warn;
  if (CALLV.hintEl){
    CALLV.hintEl.textContent = CALLV.hint;
    CALLV.hintEl.style.display = CALLV.hint ? "" : "none";
    CALLV.hintEl.classList.toggle("is-warn", CALLV.hintWarn);
  }
}
/* 刷语音控件外观（文案 / 可用态 / 聆听态）；未建控件时立即返回 */
function callVoiceRender(){
  if (CALLV.vbtn){
    CALLV.vbtn.textContent = t(CALLV.on ? "call.voiceOn" : "call.voiceOff");
    CALLV.vbtn.classList.toggle("is-on", CALLV.on);
    CALLV.vbtn.title = t("call.voice");
  }
  if (CALLV.micBtn){
    const usable = CALLV.on && CALLV.sr;
    const m = CALLV.micBtn;
    m.style.display = CALLV.on ? "" : "none";
    m.disabled = !usable;
    m.classList.toggle("is-off", !usable);
    m.classList.toggle("is-live", CALLV.srState === "listening");
    m.textContent = CALLV.srState === "listening" ? t("call.listening") : t("call.ptt");
  }
  callVoiceHint(CALLV.hint, CALLV.hintWarn);
}
/* 在通话面板里建挂语音控件（只建一次；面板不存在时静默跳过，等面板创建时再挂） */
function callVoiceMount(){
  callVoiceProbe();
  if (!CALL.el){ callVoiceRender(); return; }
  if (!CALLV.mounted || CALLV.el !== CALL.el){
    const foot = CALL.el.querySelector(".office-call-foot");
    const hint = document.createElement("div");
    hint.className = "office-call-hint";
    hint.dataset.role = "voice-hint";
    hint.style.display = "none";
    const mic = document.createElement("button");
    mic.className = "office-call-btn mic";
    mic.dataset.role = "voice-mic";
    mic.type = "button";
    const vbtn = document.createElement("button");
    vbtn.className = "office-call-btn voice";
    vbtn.dataset.role = "voice-toggle";
    vbtn.type = "button";
    callVoiceBindMic(mic);
    vbtn.addEventListener("click", () => callVoice(!CALLV.on));
    if (foot && !CALLV.mounted){
      foot.parentNode.insertBefore(hint, foot.nextSibling);
      foot.appendChild(mic); foot.appendChild(vbtn);
    } else if (!CALLV.mounted){
      CALL.el.appendChild(hint); CALL.el.appendChild(mic); CALL.el.appendChild(vbtn);
    }
    CALLV.hintEl = hint; CALLV.micBtn = mic; CALLV.vbtn = vbtn;
    CALLV.mounted = true; CALLV.el = CALL.el;
  }
  CALLV.sr = callVoiceSupported();
  callVoiceRender();
  callVoiceProbe().then(() => callVoiceRender());
}
/* 挂断清理：停播报、收麦克风、清提示（不动 CALLV.on，用户偏好保留到下次通话） */
function callVoiceReset(){
  if (CALLV.audio){ try { CALLV.audio.pause(); } catch(e){} CALLV.audio = null; }
  const w = typeof window === "undefined" ? null : window;
  if (w && w.speechSynthesis){ try { w.speechSynthesis.cancel(); } catch(e){} }
  if (CALLV.rec){ try { CALLV.rec.stop(); } catch(e){} CALLV.rec = null; }
  CALLV.srState = "idle";
  callVoiceHint("");
  callVoiceRender();
}
/* 播报兜底链：后端 wav 不可用 → 浏览器内置 speechSynthesis → 明示"仅文字" */
function callVoiceFallback(sayText){
  const w = typeof window === "undefined" ? null : window;
  if (w && w.speechSynthesis && typeof w.SpeechSynthesisUtterance === "function"){
    try {
      const u = new w.SpeechSynthesisUtterance(sayText);
      u.lang = "zh-CN";
      w.speechSynthesis.cancel();
      w.speechSynthesis.speak(u);
      callVoiceHint("");
      return true;
    } catch(e){}
  }
  CALLV.tts = false;
  callVoiceHint(t("call.ttsFail"), true);
  return false;
}
/* Agent 回话自动播报：未开语音 / 空文本 → 立即返回，对 v0 播放路径零影响 */
function callSpeak(text){
  const s = String(text == null ? "" : text).trim();
  if (!CALLV.on || !s) return false;
  if (CALLV.audio){ try { CALLV.audio.pause(); } catch(e){} CALLV.audio = null; }
  const sayText = s.length > CALLV_TTS_MAX ? s.slice(0, CALLV_TTS_MAX) : s;
  if (CALLV.tts && typeof fetch === "function"){
    const url = "/tts?text=" + encodeURIComponent(sayText)
      + (CALLV.voice ? "&voice=" + encodeURIComponent(CALLV.voice) : "");
    return fetch(url)
      .then(r => { if (!r.ok) throw new Error("tts " + r.status); return r.blob(); })
      .then(blob => {
        const a = new Audio(URL.createObjectURL(blob));
        CALLV.audio = a;
        a.addEventListener("ended", () => {
          try { URL.revokeObjectURL(a.src); } catch(e){}
          if (CALLV.audio === a) CALLV.audio = null;
        });
        a.play().then(() => callVoiceHint("")).catch(() => {
          try { URL.revokeObjectURL(a.src); } catch(e){}
          if (CALLV.audio === a) CALLV.audio = null;
          callVoiceFallback(sayText);
        });
        return true;
      })
      .catch(() => callVoiceFallback(sayText));
  }
  return callVoiceFallback(sayText);
}
/* 按住说话：起停浏览器原生语音识别，识别结果写回输入框并在松手后按 v0 链路发出 */
function callListen(on){
  const w = typeof window === "undefined" ? null : window;
  const SR = w && (w.SpeechRecognition || w.webkitSpeechRecognition);
  if (!on){
    if (CALLV.rec){ try { CALLV.rec.stop(); } catch(e){} }
    CALLV.srState = "idle"; callVoiceRender();
    return { ok: true, listening: false };
  }
  if (!SR){
    CALLV.sr = false;
    callVoiceHint(t("call.srUnavailable"), true);
    callVoiceRender();
    return { ok: false, reason: "unsupported" };
  }
  try {
    if (CALLV.rec){ try { CALLV.rec.stop(); } catch(e){} }
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.continuous = false;
    rec.interimResults = true;
    CALLV.recBase = CALL.input ? CALL.input.value : "";
    CALLV.recFinal = "";
    rec.onstart = () => {
      CALLV.srState = "listening"; CALLV.micDenied = false;
      callVoiceHint(""); callVoiceRender();
    };
    rec.onresult = e => {
      let interim = "", fin = "";
      for (let i = e.resultIndex; i < e.results.length; i++){
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript; else interim += r[0].transcript;
      }
      if (fin) CALLV.recFinal += fin;
      if (CALL.input) CALL.input.value = (CALLV.recBase || "") + CALLV.recFinal + interim;
    };
    rec.onerror = e => {
      const err = (e && e.error) || "error";
      CALLV.srState = "idle";
      if (err === "not-allowed" || err === "service-not-allowed"){
        CALLV.micDenied = true; CALLV.sr = false;
        callVoiceHint(t("call.micDenied"), true);   /* 拒权不阻断：文字输入照常 */
      } else if (err !== "aborted" && err !== "no-speech"){
        callVoiceHint(t("call.srUnavailable"), true);
      }
      callVoiceRender();
    };
    rec.onend = () => {
      if (CALLV.srState === "listening"){ CALLV.srState = "idle"; }
      const txt = (CALLV.recFinal || "").trim();
      CALLV.recBase = ""; CALLV.recFinal = "";
      callVoiceRender();
      if (txt){ if (CALL.input) CALL.input.value = ""; callSayUser(txt); }
    };
    CALLV.rec = rec;
    rec.start();
    return { ok: true, listening: true };
  } catch(err){
    CALLV.sr = false; CALLV.srState = "idle";
    callVoiceHint(t("call.srUnavailable"), true);
    callVoiceRender();
    return { ok: false, reason: String((err && err.message) || err) };
  }
}
/* "按住说话"绑定：指针按住起识别、松开结束；键盘 Space/Enter 等效 */
function callVoiceBindMic(mic){
  const down = e => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (!CALLV.on) return;
    if (e && e.pointerId != null && mic.setPointerCapture){
      try { mic.setPointerCapture(e.pointerId); } catch(err){}
    }
    mic.classList.add("is-live");
    callListen(true);
  };
  const up = () => {
    mic.classList.remove("is-live");
    if (CALLV.srState === "listening") callListen(false);
  };
  mic.addEventListener("pointerdown", down);
  mic.addEventListener("pointerup", up);
  mic.addEventListener("pointercancel", up);
  mic.addEventListener("pointerleave", up);
  mic.addEventListener("keydown", e => {
    e.stopPropagation();
    if ((e.key === " " || e.key === "Enter") && !e.repeat) down(e);
  });
  mic.addEventListener("keyup", e => {
    e.stopPropagation();
    if (e.key === " " || e.key === "Enter") up();
  });
  mic.addEventListener("contextmenu", e => e.preventDefault());
}
/* 语音总开关：开启时探测能力 + 建挂控件；关闭时回收播报/麦克风（控件保留便于再开） */
function callVoice(on){
  CALLV.on = on === undefined ? !CALLV.on : !!on;
  CALLV.sr = callVoiceSupported();
  if (CALLV.on){
    callVoiceMount();
    callVoiceProbe().then(ok => {
      if (!ok) callVoiceHint(t("call.ttsFail"), true);
      else if (!CALLV.sr) callVoiceHint(t("call.srUnavailable"), true);
      else callVoiceHint("");
      callVoiceRender();
    });
  } else {
    callVoiceReset();
  }
  callVoiceRender();
  return callVoiceState();
}
function callVoiceState(){
  const w = typeof window === "undefined" ? null : window;
  return { on: CALLV.on, tts: CALLV.tts, voice: CALLV.voice,
           sr: CALLV.sr, srState: CALLV.srState, micDenied: CALLV.micDenied,
           hint: CALLV.hint, mounted: CALLV.mounted,
           listening: CALLV.srState === "listening",
           speaking: !!CALLV.audio
             || !!(w && w.speechSynthesis && w.speechSynthesis.speaking) };
}

function placeTags(){
  Object.keys(characters).forEach(k => {
    const tagEl = tagEls[k];
    if (!tagEl) return;
    const ch = characters[k];
    _v.set(ch.root.position.x,
            ch.root.position.y + 2.32 * (ch.cfg.height / 1.86),
            ch.root.position.z);
    _v.project(camera);
    if (_v.z > 1){ tagEl.style.display = "none"; return; }
    tagEl.style.left = ((_v.x * 0.5 + 0.5) * 100).toFixed(2) + "%";
    tagEl.style.top  = ((-_v.y * 0.5 + 0.5) * 100).toFixed(2) + "%";
    tagEl.style.transform = "translate(-50%,-100%)";
  });
}

/* =====================================================================
   P1-a：角色注册骨架（插件化角色架构第一阶段）
   - 与固定五角色完全解耦：插件角色走 roleRegistry + characters 注册表，
     不写 AGENT_META / PALETTE，不占用 DESK_AT 四张工位，不新增八态；
   - 注册流程：registerRole(spec) → activateRole(id, opts) → 在场 → unmountRole(id)；
   - 动态补齐：ensureStateEntry(id) 让角色进状态账本；stateMeta 衰减遍历全量 key；
   - 钩子：onRoleEvent(id, event) 与既有 onAgentStatus 同走 runExtensions 异常隔离，
     未实现该钩子的老插件自动跳过；
   - 红线：不加载任何插件时，场景与五角色行为逐帧不变（本段只在被调用时生效）。
   ===================================================================== */
const roleRegistry = {};      // id -> 注册描述符（永久保存，卸载后可再次激活）
let roleSeq = 0;

/* 访客兜底外观：插件未提供 appearance 时复用一套中性配色，字段与 PALETTE 同构 */
const VISITOR_DEFAULT = {
  accent: 0x9aa7b8, skin: 0xe3b189, hair: 0x2b2118, hair2: 0x514437,
  outfit: "tee", cloth: 0x3d4756, cloth2: 0x5a6574, pants: 0x2b3340,
  shoes: 0x1f242c, socks: 0x2c3440, socksStyle: "no", shoeStyle: "sneaker",
  height: 1.78, build: "m", hairStyle: "short",
  iris: 0x3a2a1c, lip: 0xb9705f, brow: 0x2c1f14, blush: 0xf0c3a0,
  shoulder: 1.0, chest: 1.0, waist: 1.0, armR: 1.0, jaw: 1.0, hip: 1.0, face: 1.0, soft: 0
};

/* 角度归一：用于把候选方位按"离参考方向最近"排序 */
function roleWrap(a){
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* 在场角色快照（空位搜索用） */
function liveChars(){
  return Object.keys(characters).map(k => characters[k]).filter(c => c && c.current);
}

/* 空位判据：在房内 + 不压家具（OBST 含 pad 安全边）+ 不贴已有角色（ROLE_GAP + 余量）。
   P1-a 起被 findRoleSpot 使用，P1-b 抽出来给"锚点邻近搜索"共用，判据完全一致 */
function spotFree(x, z, others, margin){
  if (x < 1.0 || x > ROOM - 1.0 || z < 1.0 || z > ROOM - 1.0) return false;
  for (let oi = 0; oi < OBST.length; oi++){
    const o = OBST[oi];
    const l = obstLocal(o, x, z);
    if (Math.abs(l[0]) <= o.hw + o.pad + 0.32 && Math.abs(l[1]) <= o.hd + o.pad + 0.32) return false;
  }
  const list = others || liveChars();
  const gap = ROLE_GAP + (margin == null ? 0.32 : margin);
  for (let ci = 0; ci < list.length; ci++){
    const c = list[ci];
    if (Math.hypot(c.current[0] - x, c.current[1] - z) < gap) return false;
  }
  return true;
}

/* 动态空位搜索（P1-a 极简版）：围绕房间中心由内向外三圈 × 24 方位，
   依次排除与家具（OBST，含 pad 安全边）和既有角色（ROLE_GAP + 余量）冲突的点，
   找不到则返回 null（调用方如实报 no-slot，不做兜底硬塞） */
function findRoleSpot(hint){
  const radii = [3.0, 3.8, 4.6];
  const ref = Array.isArray(hint) ? Math.atan2(hint[1] - CZ, hint[0] - CX) : 0;
  const angles = [];
  for (let i = 0; i < 24; i++) angles.push(i * Math.PI / 12);
  angles.sort((a, b) => Math.abs(roleWrap(a - ref)) - Math.abs(roleWrap(b - ref)));
  const others = liveChars();
  for (let ri = 0; ri < radii.length; ri++){
    for (let ai = 0; ai < angles.length; ai++){
      const x = CX + Math.cos(angles[ai]) * radii[ri];
      const z = CZ + Math.sin(angles[ai]) * radii[ri];
      if (spotFree(x, z, others)) return [x, z];
    }
  }
  return null;
}

/* P1-b：锚点邻近搜索 —— 以给定锚点为圆心由近及远多圈 × 24 方位，
   取第一个可用点（第 0 圈即锚点本身，锚点可用就直接站上去，
   保证"讲台前 / 打印机前"这类语义位置优先）。判据与 findRoleSpot 完全一致 */
function findSpotNear(x, z, margin){
  if (!isFinite(x) || !isFinite(z)) return null;
  const radii = [0, 0.45, 0.72, 1.00, 1.30, 1.65, 2.05, 2.50];
  const others = liveChars();
  for (let ri = 0; ri < radii.length; ri++){
    for (let i = 0; i < 24; i++){
      const a = i * Math.PI / 12;
      const px = x + Math.cos(a) * radii[ri];
      const pz = z + Math.sin(a) * radii[ri];
      if (spotFree(px, pz, others, margin)) return [px, pz];
    }
  }
  return null;
}

/* 注册（只登记描述符，不建网格、不进场景，未激活 ⇒ 场景零变化） */
function registerRole(spec){
  const s = spec || {};
  let id = (s.id == null ? "" : String(s.id)).trim();
  if (!id) id = "role-" + (++roleSeq);
  if (roleRegistry[id] || characters[id]) return { ok: false, id, reason: "duplicate-id" };
  const spot = Array.isArray(s.spot) ? [+s.spot[0], +s.spot[1]] : null;
  if (spot && (!isFinite(spot[0]) || !isFinite(spot[1]))) return { ok: false, id, reason: "bad-spot" };
  /* P1-b：插件私有锚点池（§5.4）—— 只读公共锚点 DEST 由框架提供，
     插件要加自己的落位点就放进这里，用 spawn.anchor 引用，不污染 DEST */
  const anchors = {};
  if (s.anchors && typeof s.anchors === "object"){
    Object.keys(s.anchors).forEach(k => {
      const a = s.anchors[k];
      if (Array.isArray(a) && isFinite(+a[0]) && isFinite(+a[1])) anchors[String(k)] = [+a[0], +a[1]];
    });
  }
  roleRegistry[id] = {
    id,
    name: String(s.name || id),
    role: String(s.role || "外部角色"),
    appearance: (s.appearance && typeof s.appearance === "object") ? s.appearance : null,
    spot,
    anchors,
    face: (s.face == null || !isFinite(+s.face)) ? null : +s.face,
    mode: String(s.mode || "stand"),
    active: false,
    ch: null
  };
  runExtensions("onRoleEvent", id, "registered");
  return { ok: true, id, active: false };
}

/* 激活：建角色 → 入场景 → 进注册表与状态账本（此后悬停卡 / say / setAgentMeta 天然可用） */
function activateRole(id, opts){
  const r = roleRegistry[id];
  if (!r) return { ok: false, id, reason: "not-registered" };
  if (r.active) return { ok: false, id, reason: "already-active" };
  const o = opts || {};
  /* P1-b 落位三级回落（§5.1）：① 显式坐标（或注册时的固定点，最优先，语义明确）
     → ② 显式锚点：命中 DEST 公共锚点或插件私有锚点池时优先站上去，位置被占就在
       锚点附近按 ROLE_GAP 找最近空位 → ③ 动态空位搜索（房间中心由内向外） */
  let spot = Array.isArray(o.spot) ? [+o.spot[0], +o.spot[1]] : (r.spot ? r.spot.slice() : null);
  let via = spot ? "explicit" : null;
  let anchorKey = null;
  if (!spot && o.anchor != null){
    anchorKey = String(o.anchor);
    const a = (r.anchors && r.anchors[anchorKey]) || (DEST[anchorKey] ? DEST[anchorKey] : null);
    if (!a) return { ok: false, id, reason: "unknown-anchor", anchor: anchorKey };
    spot = findSpotNear(a[0], a[1]);
    if (!spot) return { ok: false, id, reason: "no-slot", anchor: anchorKey };
    via = "anchor";
  }
  if (!spot){
    spot = findRoleSpot(r.spot);
    via = spot ? "search" : null;
  }
  if (!spot) return { ok: false, id, reason: "no-slot" };

  const cfg = Object.assign({}, VISITOR_DEFAULT, r.appearance || {});
  if (!cfg.height) cfg.height = VISITOR_DEFAULT.height;
  const face = (o.face != null) ? +o.face : (r.face != null ? r.face : centerFacing(spot[0], spot[1]));
  const ch = buildCharacter(cfg);
  ch.root.position.set(spot[0], 0, spot[1]);
  ch.root.rotation.y = face;
  ch.home = spot.slice();
  ch.seat = spot.slice();
  ch.anchor = spot.slice();                 // 访客锚点：走位链被短路，始终留在锚点
  ch.current = spot.slice();
  ch.facing = face;
  ch.offset = 2.6 + Object.keys(characters).length * 0.7;
  ch.key = id;
  ch.name = r.name;
  ch.role = r.role;
  ch.stage = { code: "", hold: 0 };
  ch.busy = false;
  ch.act = null;
  ch.actTimer = 6 + Math.random() * 8;
  ch.roam = { phase: "work", left: 0 };
  ch.isVisitor = true;
  ch.visitorMode = r.mode;
  ch.root.userData.tip = { title: ch.name, desc: ch.role,
                           color: cfg.accent || VISITOR_DEFAULT.accent, prio: 3 };
  scene.add(ch.root);
  characters[id] = ch;
  ensureStateEntry(id);
  r.active = true;
  r.ch = ch;
  pickDirty = true;                         // 悬停拾取表重建
  collectWallAssembly();                    // 新角色网格排除在墙体淡出之外（bodies 集合已含它）
  runExtensions("onRoleEvent", id, "activated");
  return { ok: true, id, active: true, spot: spot.slice(), via: via || "explicit",
           anchor: anchorKey, count: Object.keys(characters).length };
}

/* 卸载：网格 / 注册表 / 状态账本 / 卡片数据 / 浮层逐项归零，可重复调用（第二次返回 false） */
function unmountRole(id){
  const r = roleRegistry[id];
  if (!r) return false;
  if (!r.active) return false;              // 幂等：重复卸载返回 false
  const ch = characters[id];
  if (!ch){ r.active = false; r.ch = null; return false; }
  /* 剔除运行期引用，避免串门 / 气泡 / 悬停卡残留指向已卸载角色 */
  if (social.act && (social.act.host === ch || social.act.guest === ch)) social.act = null;
  const tip = ch.root.userData.tip;
  if (tip && hoverTip === tip) hoverTip = null;
  if (tip && pinnedTip === tip) pinnedTip = null;
  const q = questionMarks[id];
  if (q && q.el && q.el.parentNode) q.el.parentNode.removeChild(q.el);
  delete questionMarks[id];
  const b = bubbles[id];
  if (b && b.el && b.el.parentNode) b.el.parentNode.removeChild(b.el);
  delete bubbles[id];
  scene.remove(ch.root);
  delete characters[id];
  delete stateMeta[id];
  delete agentMeta[id];
  if (id in state) delete state[id];
  r.active = false;
  r.ch = null;
  pickDirty = true;
  collectWallAssembly();
  runExtensions("onRoleEvent", id, "unmounted");
  return true;
}

/* 注销：摘掉登记表条目（活动中的先卸载），是 unmountRole 的配套收尾 —— 插件收工后调它
   roles() / audit().roles 才能回到基线（零残留，架构文档 §4.2 / §10.2）。
   约束：登记表条目不存在返回 false；卸载没成功则不摘条目，避免账本与场景不一致。 */
function unregisterRole(id){
  const key = String(id);
  const r = roleRegistry[key];
  if (!r) return false;
  if (r.active && !unmountRole(key)) return false;
  if (characters[key]) return false;
  delete roleRegistry[key];
  runExtensions("onRoleEvent", key, "unregistered");
  return true;
}

/* ===================== P1-c 导览流程（Tour FSM） =====================
   summoning → greeting → touring(i) → showcasing → qa → farewell → closing → idle

   设计约束（架构文档 §6）：
   · 导游复用既有 coordinator（不凭空造"导游 Agent"岗位），访客走 P1-a 的
     registerRole / activateRole 通道 —— 来访的是"客人"，不是新工序角色；
   · 站点 anchor 全部取自只读 DEST（或 plan.anchors 私有锚点表）⇒ 零硬编码坐标；
     解说词走 I18N tour.* 池（数组随机取一条）；
   · 镜头只在 plan.camera.sweep 为真时切换（默认绝不劫持用户自由视角），
     closing 精确回放 tourStart 前的相机快照；
   · 导览期间不触发新会诊（updateHuddle 侧短路）；若会诊已在进行，showcasing 原地
     等待 huddle 走完（会诊本身就是很好的展示内容）；导览期间抑制串门；
   · tourStop() 任意阶段可中断，closing 完整回滚（卸载访客 / 恢复镜头 / 交还走位）；
   · P1-d（插件自带访客与文案）：plan.guests 可逐项传 registerRole 的 spec，已到场的
     访客直接纳入导览复用其网格；plan.lines 覆盖同名 tour.* 解说词；
     框架自建访客导览结束连登记表一起清，插件自带者只卸载、由插件 unregisterRole 收尾；
   · 红线：TOUR.active=false 时本模块对场景零副作用（不动镜头、不碰员工走位）。 */
const TOUR = {
  active: false, phase: "idle", plan: null,
  i: 0, t: 0, visited: [], stops: [],
  guideK: null, visitors: [], entryKey: "podium", entrySpot: null, entryFace: 0,
  camSnap: null, camViews: [], camIdx: 0, sweep: false, note: "", last: null,
  /* P1-d：插件自带访客描述符（plan.guests）与文案池（plan.lines）；
     owned=框架自建的访客 id（结束时连登记表一起清），adopted 的交还插件注销 */
  lines: null, owned: []
};
const TOUR_ARRIVE = 0.32;      // 到位判据（米）
const TOUR_RING = 1.08;        // 访客围站半径

/* 解说词：tour.* 池里可写字符串或数组（数组随机取一条）
   P1-d：插件可用 plan.lines 覆盖同名 key（自带文案池，支持双语键 "zh-CN"/"en-US"），
   plan 未给该 key 时回落 I18N 既有文案 —— 框架里不出现任何角色名分支 */
function tourLine(key){
  const box = TOUR.lines;
  let v = null;
  if (box){
    const hit = box[key];
    v = (hit && typeof hit === "object" && !Array.isArray(hit)) ? hit[CHAT_LOCALE] : hit;
  }
  if (v == null) v = tChat("tour." + key);
  if (Array.isArray(v)) return v[Math.floor(Math.random() * v.length)];
  return v == null ? key : String(v);
}
function tourDist(ch, p){ return Math.hypot(ch.root.position.x - p[0], ch.root.position.z - p[1]); }

/* 访客围站：以站点面向为基准左右铺开（序数越大越靠边），候选点避开家具与已有角色 */
function tourRing(p, n, count, face){
  const a0 = face + (n - (count - 1) / 2) * 0.62;
  const cands = [[TOUR_RING, 0], [TOUR_RING + 0.40, 0], [TOUR_RING, 0.5], [TOUR_RING, -0.5], [0, 0]];
  const others = liveChars().filter(c => TOUR.visitors.indexOf(c.key) < 0);
  for (let i = 0; i < cands.length; i++){
    const r = cands[i][0], da = cands[i][1];
    const px = p[0] + Math.sin(a0 + da) * r, pz = p[1] + Math.cos(a0 + da) * r;
    if (spotFree(px, pz, others, 0.20)) return [px, pz];
  }
  return p.slice();
}

/* 走位意图：导览参与者（导游 + 访客）的 want 由 FSM 逐帧发放，优先于员工链与访客锚点短路 */
function tourWant(ch, k){
  const T = TOUR;
  if (!T.active) return null;
  const isGuide = (k === T.guideK);
  const vi = T.visitors.indexOf(k);
  if (!isGuide && vi < 0) return null;
  const count = T.visitors.length;

  if (T.phase === "summoning" || T.phase === "greeting" || T.phase === "farewell"){
    const tgt = isGuide ? T.entrySpot : tourRing(T.entrySpot, vi, count, T.entryFace);
    if (tourDist(ch, tgt) > TOUR_ARRIVE) return { dest: tgt, mode: "walk" };
    return { dest: tgt, mode: isGuide ? "talk" : (T.phase === "farewell" ? "listen" : "stand"),
             face: T.entryFace };
  }
  const stop = T.stops[Math.min(T.i, T.stops.length - 1)];
  if (!stop) return null;
  if (T.phase === "touring"){
    const g = characters[T.guideK];
    const gIn = !g || tourDist(g, stop.spot) <= TOUR_ARRIVE + 0.22;
    if (!isGuide && !gIn){
      /* 导游还没到位：跟在导游身后（间距随序数递增），到站后再散开站位 */
      const yaw = g.root.rotation.y, gap = TOUR_RING + vi * 0.52;
      const dest = [g.root.position.x - Math.sin(yaw) * gap, g.root.position.z - Math.cos(yaw) * gap];
      return { dest, mode: "walk" };
    }
    const tgt = isGuide ? stop.spot : tourRing(stop.spot, vi, count, stop.face);
    if (tourDist(ch, tgt) > TOUR_ARRIVE) return { dest: tgt, mode: "walk" };
    return { dest: tgt, mode: isGuide ? "talk" : stop.watch, face: stop.face };
  }
  if (T.phase === "showcasing" || T.phase === "qa"){
    const tgt = isGuide ? stop.spot : tourRing(stop.spot, vi, count, stop.face);
    if (tourDist(ch, tgt) > TOUR_ARRIVE + 0.18) return { dest: tgt, mode: "walk" };
    if (T.phase === "qa") return { dest: tgt, mode: "think", face: stop.face };
    return { dest: tgt, mode: isGuide ? "talk" : stop.watch, face: stop.face };
  }
  return null;   // closing：交还走位（访客随即被卸载）
}

/* 阶段切换：统一出口，顺带发 onTourStage 钩子（插件可据此推进自己的讲解） */
function tourStage(name, extra){
  TOUR.phase = name;
  TOUR.t = 0;
  runExtensions("onTourStage", name, Object.assign({ i: TOUR.i,
    stop: TOUR.stops[TOUR.i] ? TOUR.stops[TOUR.i].anchor : null,
    visitors: TOUR.visitors.slice() }, extra || {}));
}

/* 收尾 / 中断共用：卸载访客 → 回放镜头快照 → 归零状态（幂等，可反复调） */
function finishTour(outcome){
  const T = TOUR;
  if (!T.active) return null;
  const guests = T.visitors.slice();
  const own = T.owned || [];
  /* 卸载并注销：框架自建的导览访客是框架产物，结束后 roles() / 场景都不该留残项；
     P1-d：插件自带描述符的访客（adopted）只卸载、不注销 —— 登记表归插件所有，
     由插件收工时自行 unregisterRole（此时 unmountRole 幂等返回 false）。 */
  guests.forEach(id => {
    if (roleRegistry[id]) unmountRole(id);
    if (own.indexOf(id) >= 0) delete roleRegistry[id];
  });
  if (T.camSnap){
    Object.assign(camNow, T.camSnap.now);
    camFree = T.camSnap.free;
    activeView = T.camSnap.view;
    ctrl.zoomTarget = T.camSnap.zoomTarget;
    camTween = null;
    applyCam();
    syncHud();
  }
  const last = { outcome: outcome, visited: T.visited.slice(), visitors: guests,
                 guide: T.guideK, stops: T.stops.map(s => s.anchor),
                 entry: T.entryKey, sweep: !!T.sweep };
  T.last = last;
  T.active = false; T.plan = null; T.stops = []; T.i = 0; T.t = 0; T.visited = [];
  T.visitors = []; T.guideK = null; T.owned = []; T.lines = null;
  T.camSnap = null; T.note = ""; T.sweep = false;
  T.phase = "idle";
  runExtensions("onTourEvent", outcome, last);
  return last;
}

/* 启动：plan.stops 逐站 { anchor, dur, lineKey, watch }，anchor 取自 DEST / plan.anchors */
function tourStart(plan){
  if (TOUR.active) return { ok: false, reason: "tour-active" };
  const p = plan || {};
  const req = (Array.isArray(p.stops) && p.stops.length) ? p.stops : [
    { anchor: "pantry",     dur: 6,  lineKey: "pantry" },
    { anchor: "podium",     dur: 8,  lineKey: "desks" },
    { anchor: "printerBig", dur: 12, lineKey: "printBig", watch: "watch" },
    { anchor: "gym",        dur: 5,  lineKey: "gym" }
  ];
  const stops = [];
  for (let i = 0; i < req.length; i++){
    const s = req[i] || {};
    const key = String(s.anchor == null ? "" : s.anchor);
    const raw = (p.anchors && p.anchors[key]) || DEST[key];
    if (!raw) return { ok: false, reason: "unknown-anchor", anchor: key };
    const spot = findSpotNear(raw[0], raw[1], 0.24) || [+raw[0], +raw[1]];
    stops.push({ anchor: key, lineKey: String(s.lineKey || key),
                 dur: Math.max(1.2, +(s.dur == null ? 6 : s.dur)),
                 watch: String(s.watch || (key === "printerBig" ? "watch" : "stand")),
                 spot: spot, face: centerFacing(spot[0], spot[1]) });
  }
  const guideK = String(p.guide || "coordinator");
  if (!characters[guideK]) return { ok: false, reason: "no-guide", guide: guideK };
  const entryKey = String(p.entry || "podium");
  const eRaw = (p.anchors && p.anchors[entryKey]) || DEST[entryKey];
  if (!eRaw) return { ok: false, reason: "unknown-anchor", anchor: entryKey };
  const eSpot = findSpotNear(eRaw[0], eRaw[1], 0.24) || [+eRaw[0], +eRaw[1]];

  /* P1-d：插件可自带访客描述符 —— plan.guests 逐项即 registerRole 的 spec
     （id / name / role / appearance / anchors / mode）。若该 id 已由插件 activateRole 到场
     （characters 里已有），直接纳入导览并复用网格，不重建；未提供 guests 时行为与 P1-c
     完全一致（框架自建 tour-guest-N）。框架自建者记入 owned，结束时连登记表一起清。 */
  const specs = (Array.isArray(p.guests) && p.guests.length) ? p.guests.slice(0, 3) : null;
  const n = specs ? specs.length
                  : Math.max(1, Math.min(3, Math.floor(+(p.visitors == null ? 1 : p.visitors)) || 1));
  const guests = [], owned = [];
  const rollback = () => {                    // 中途失败：只回收本次自建访客，插件自带的交还插件
    owned.forEach(g => { unmountRole(g); delete roleRegistry[g]; });
  };
  for (let i = 0; i < n; i++){
    const spec = specs ? (specs[i] || {}) : null;
    const id = String((spec && spec.id) || ("tour-guest-" + (i + 1)));
    if (characters[id]){                      // 插件已让访客到场：纳入导览，复用其网格
      if (roleRegistry[id] && roleRegistry[id].anchors) roleRegistry[id].anchors.entry = eSpot.slice();
      guests.push(id);
      continue;
    }
    if (roleRegistry[id]) delete roleRegistry[id];   // 同名残留（异常中断）先清，保证可重复导览
    const reg = registerRole(spec
      ? Object.assign({}, spec, { id: id,
          anchors: Object.assign({ entry: eSpot.slice() }, spec.anchors || {}) })
      : { id: id, name: t("tour.visitorName") + " " + (i + 1),
          role: t("tour.visitorRole"), mode: "stand",
          anchors: { entry: eSpot } });
    if (!reg.ok){ rollback(); return { ok: false, reason: "visitor-register-failed", detail: reg }; }
    const act = activateRole(id, { anchor: entryKey, face: centerFacing(eSpot[0], eSpot[1]) });
    if (!act.ok){ rollback(); return { ok: false, reason: "visitor-spawn-failed", detail: act }; }
    guests.push(id); owned.push(id);
  }
  /* 镜头快照（含自由环绕角度 / 缩放），closing 时精确回放 */
  TOUR.camSnap = { now: cloneView(camNow), free: camFree, view: activeView, zoomTarget: ctrl.zoomTarget };
  TOUR.plan = p; TOUR.stops = stops; TOUR.i = 0; TOUR.t = 0; TOUR.visited = [];
  TOUR.visitors = guests; TOUR.guideK = guideK; TOUR.owned = owned.slice();
  /* P1-d：插件文案池（plan.lines：key → string | string[] | {zh-CN,en-US}），随导览归零 */
  TOUR.lines = (p.lines && typeof p.lines === "object") ? p.lines : null;
  TOUR.entryKey = entryKey; TOUR.entrySpot = eSpot; TOUR.entryFace = centerFacing(eSpot[0], eSpot[1]);
  TOUR.camViews = (p.camera && Array.isArray(p.camera.views) && p.camera.views.length)
    ? p.camera.views.slice() : ["desks", "print", "front"];
  TOUR.camIdx = 0;
  TOUR.sweep = !!(p.camera && p.camera.sweep);
  TOUR.note = ""; TOUR.last = null; TOUR.active = true;
  /* 导游被占用前先收掉与它相关的串门，避免导览路上被拽去聊天 */
  if (social.act && (social.act.host === characters[guideK] || social.act.guest === characters[guideK])) social.act = null;
  tourStage("summoning");
  if (TOUR.sweep) useView(TOUR.camViews[0]);
  return { ok: true, guide: guideK, visitors: guests.slice(), owned: owned.slice(),
           entry: entryKey, stops: stops.map(s => s.anchor), sweep: TOUR.sweep,
           custom: !!TOUR.lines, phase: TOUR.phase };
}

/* 中断：任意阶段可调，等同立刻走 closing 的回滚逻辑 */
function tourStop(reason){
  if (!TOUR.active) return { ok: false, reason: "no-tour" };
  const last = finishTour(String(reason || "stopped"));
  return { ok: true, last: last };
}

/* 探针：导览现状（供自动化核对阶段推进 / 站点顺序 / 复原） */
function tourState(){
  return {
    active: TOUR.active, phase: TOUR.phase,
    stop: TOUR.stops[TOUR.i] ? TOUR.stops[TOUR.i].anchor : null,
    i: TOUR.i, visited: TOUR.visited.slice(),
    visitors: TOUR.visitors.slice(), guide: TOUR.guideK,
    owned: TOUR.owned.slice(), custom: !!TOUR.lines,
    entry: TOUR.entryKey, sweep: !!TOUR.sweep, view: activeView,
    note: TOUR.note, elapsed: +TOUR.t.toFixed(2), last: TOUR.last
  };
}

/* 每帧推进 FSM（除 closing 外不直接改角色状态，全部经 tourWant 发放意图） */
function tourTick(dt){
  if (!TOUR.active) return;
  const T = TOUR;
  T.t += dt;
  const g = characters[T.guideK];
  const guests = T.visitors.map(k => characters[k]).filter(Boolean);
  if (!g || guests.length !== T.visitors.length){ finishTour("aborted"); return; }

  if (T.phase === "summoning"){
    const gIn = tourDist(g, T.entrySpot) <= TOUR_ARRIVE + 0.1;
    const vIn = guests.every(c => tourDist(c, T.entrySpot) <= TOUR_RING + 1.2);
    if (gIn && vIn){ tourStage("greeting"); say(T.guideK, tourLine("welcome")); }
    return;
  }
  if (T.phase === "greeting"){
    if (T.t >= 2.6){ T.i = 0; tourStage("touring"); }
    return;
  }
  if (T.phase === "touring"){
    const stop = T.stops[T.i];
    if (!stop){ tourStage("qa"); say(T.guideK, tourLine("qa")); return; }
    const gIn = tourDist(g, stop.spot) <= TOUR_ARRIVE + 0.05;
    const vIn = guests.every(c => tourDist(c, stop.spot) <= TOUR_RING + 1.25);
    if (gIn && vIn){
      T.visited.push(stop.anchor);
      tourStage("showcasing");
      say(T.guideK, tourLine(stop.lineKey));
      if (T.sweep && T.camViews.length) useView(T.camViews[T.camIdx % T.camViews.length]);
    }
    return;
  }
  if (T.phase === "showcasing"){
    if (huddle.t > 0){ T.t -= dt; T.note = tourLine("waitHuddle"); return; }   // 等会诊，不推进
    T.note = "";
    if (T.t >= T.stops[T.i].dur){
      T.i++;
      if (T.i >= T.stops.length){ tourStage("qa"); say(T.guideK, tourLine("qa")); }
      else { T.camIdx++; tourStage("touring"); }
    }
    return;
  }
  if (T.phase === "qa"){
    if (T.t >= 4.2) tourStage("farewell");
    return;
  }
  if (T.phase === "farewell"){
    if (T.t >= 2.4 && !T.note){ T.note = "bye"; say(T.guideK, tourLine("bye")); }
    if (T.t >= 5.0) tourStage("closing");
    return;
  }
  if (T.phase === "closing"){
    if (T.t >= 1.6) finishTour("completed");
    return;
  }
}

/* 查询：注册表快照（只读，不改任何状态；roster() 只列在场角色，这里含未激活的） */
function roles(){
  return Object.keys(roleRegistry).map(id => {
    const r = roleRegistry[id];
    const ch = characters[id];
    return {
      id, name: r.name, role: r.role, mode: r.mode,
      active: !!r.active,
      visitor: !!(ch && ch.isVisitor),
      anchors: Object.keys(r.anchors || {}),
      x: ch ? +ch.root.position.x.toFixed(2) : null,
      z: ch ? +ch.root.position.z.toFixed(2) : null,
      act: ch ? (ch.dbgMode || "") : "",
      state: ch ? stateOf(id) : null
    };
  });
}

/* =====================================================================
   P1-b：机位追加式注册（§5.2）
   - registerView(name, view, { order })：默认 order=false ⇒ 只可 setView 直达，
     不进 VIEW_ORDER、不占数字键、不参与 V 轮换、不改 HUD 序列（红线 R3）；
     插件显式 order:true 时才追加到 VIEW_ORDER 尾部，卸载时由本模块摘掉；
   - unregisterView(name)：只允许卸载插件注册的机位，内置 7 个不可卸载；
     卸载的正在使用的机位会自动切回默认机位；
   - 与内置或已注册机位重名直接拒绝，绝不覆盖。
   ===================================================================== */
const pluginViews = {};                        // name -> { order:bool }

/* 机位参数校验 + 规范化：结构同 VIEWS 项，缺省项按内置机位同构补齐 */
function normalizeView(v){
  if (!v || typeof v !== "object") return null;
  const num = x => (isFinite(+x) ? +x : null);
  const azim = num(v.azim), elev = num(v.elev), dist = num(v.dist);
  const look = Array.isArray(v.look) ? v.look.slice(0, 3).map(num) : null;
  if (azim == null || elev == null || dist == null) return null;
  if (!look || look.length !== 3 || look.some(x => x == null)) return null;
  const b = v.box;
  if (!b || !Array.isArray(b.min) || !Array.isArray(b.max)) return null;
  const min = b.min.slice(0, 3).map(num), max = b.max.slice(0, 3).map(num);
  if (min.length !== 3 || max.length !== 3 || min.some(x => x == null) || max.some(x => x == null)) return null;
  return { tag: String(v.tag || "VIEW").toUpperCase(),
           azim, elev, dist, look,
           box: boxOf(min, max),
           minH: num(v.minH) == null ? 1.8 : num(v.minH),
           maxH: num(v.maxH) == null ? 8.0 : num(v.maxH),
           pad: num(v.pad) == null ? 1.02 : num(v.pad) };
}

function registerView(name, view, opts){
  const n = String(name == null ? "" : name).trim();
  if (!n) return { ok: false, reason: "bad-name" };
  if (VIEWS[n]) return { ok: false, name: n, reason: "name-taken" };
  const v = normalizeView(view);
  if (!v) return { ok: false, name: n, reason: "bad-view" };
  const order = !!(opts && opts.order);
  VIEWS[n] = v;
  pluginViews[n] = { order };
  if (order) VIEW_ORDER.push(n);
  syncHud();
  return { ok: true, name: n, order, views: VIEW_ORDER.slice() };
}

function unregisterView(name){
  const n = String(name == null ? "" : name).trim();
  if (!pluginViews[n]) return { ok: false, name: n, reason: "not-plugin-view" };
  if (activeView === n) useView(VIEWS[CONFIG.views.def] ? CONFIG.views.def : "iso", { instant: true });
  const oi = VIEW_ORDER.indexOf(n);
  if (oi >= 0) VIEW_ORDER.splice(oi, 1);
  delete VIEWS[n];
  delete pluginViews[n];
  syncHud();
  return { ok: true, name: n, view: activeView, views: VIEW_ORDER.slice() };
}

/* ---------------- 主循环 ---------------- */
let running = true, hoverTick = 0;
function loop(){
  if (!running) return;
  requestAnimationFrame(loop);
  const dt = Math.min(frameDelta(), 0.05);
  tGlobal += dt;

  tick(dt, tGlobal);

  /* 共识台全息呼吸 */
  const halo = podium.userData.halo;
  const holo = podium.userData.holo;
  const active = state.consensus === "running";
  const pulse = 0.5 + 0.5 * Math.sin(tGlobal * (active ? 3.4 : 1.1));
  halo.material.opacity = active ? 0.30 + pulse * 0.45 : 0.10 + pulse * 0.06;
  holo.material.opacity = active ? 0.16 + pulse * 0.22 : 0.08 + pulse * 0.05;
  holo.material.color.setHex(active ? 0x22d3ee : 0x2f6f88);

  updateFocus(dt);          // P1-5：点击聚焦（相机缓动 / 光环呼吸 / 设备标记脉冲 / 路径流光）
  updateFlows(dt);          // P1-6：数据流线（产出 / 异常流向的流光粒子推进与回收）
  hoverTick += dt;
  if (hoverTick > 0.08){
    hoverTick = 0;
    hoverTip = pointerActive ? pickAt() : null;
    applyHint();
    refreshPlates(pinnedTip || hoverTip);
  }
  placeTags();
  updateBubbles(dt);
  if (CALL.active) callTick();
  renderer.render(scene, camera);
}

/* ---------------- 鼠标交互：拖拽环绕 / 滚轮缩放 / 悬停 / 单击锁卡 ----------------
   同一套指针事件承担两种语义（P0-4）：
     · 按下到抬起位移 < CONFIG.controls.dragGate → 当作"点击"：锁定 / 解锁信息卡（P0-3 行为不变）
     · 位移 ≥ dragGate / 按下滚轮              → 当作"拖拽"：接管相机自由环绕，抬起时不再锁卡
   拖拽过程中持续刷新悬停拾取，卡片跟着指针走，不会"拖完还挂着旧对象的信息"。 */
let pointerActive = false;
const dom = renderer.domElement;
dom.style.touchAction = "none";        // 让触控板 / 触屏的 pointermove 连续可用
dom.style.cursor = "grab";

function setPointerFrom(e){
  const r = dom.getBoundingClientRect();
  mouseX = e.clientX; mouseY = e.clientY;
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  pointerActive = true;
}

dom.addEventListener("pointermove", e => {
  setPointerFrom(e);
  const d = ctrl.drag;
  if (!d || d.id !== e.pointerId || !CONFIG.controls.enabled) return;
  const dx = e.clientX - d.x, dy = e.clientY - d.y;
  d.x = e.clientX; d.y = e.clientY;
  if (!d.orbiting &&
      Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) >= CONFIG.controls.dragGate){
    d.orbiting = true;                 // 越过阈值才真的开始转，避免手抖就丢点击
    beginOrbit();                      // 接管相机：冻结机位缓动 + 退出预设高亮
  }
  if (d.orbiting){
    orbitBy(dx, dy);
    hoverTip = pickAt();
    applyHint();
  }
});
dom.addEventListener("pointerleave", () => { if (!ctrl.drag) pointerActive = false; });
dom.addEventListener("pointerdown", e => {
  setPointerFrom(e);
  if (ctrl.drag) return;               // 已有指针在按（多指）：忽略后续
  ctrl.drag = { id: e.pointerId, x: e.clientX, y: e.clientY,
                sx: e.clientX, sy: e.clientY, orbiting: false };
  try { dom.setPointerCapture(e.pointerId); } catch (_) {}
  dom.style.cursor = "grabbing";
});
function endDrag(e){
  const d = ctrl.drag;
  if (!d) return;
  if (e && e.pointerId != null && e.pointerId !== d.id) return;
  ctrl.drag = null;
  dom.style.cursor = "grab";
  if (e && e.pointerId != null){ try { dom.releasePointerCapture(e.pointerId); } catch (_) {} }
  if (d.orbiting) return;              // 拖过 → 只当视角操作，不动卡片
  if (e && e.clientX != null) setPointerFrom(e);
  const tip = pickAt();
  /* P1-5 点击角色聚焦：单击角色 = 聚焦该角色（照旧把它的信息卡锁定，一个手势两件事）；
     单击空白处 = 退出聚焦（相机缓动回进入前的机位）；点在别的物件上不动聚焦状态。 */
  const role = ownerKey(tip);
  if (role) focusRole(role);
  else if (FOCUS.on && !tip) exitFocus();
  pinnedTip = (tip && tip === pinnedTip) ? null : tip;   // 再点同一件 = 解锁
  hoverTip = tip;
  applyHint();
  refreshPlates(pinnedTip || hoverTip);
}
dom.addEventListener("pointerup", endDrag);
dom.addEventListener("pointercancel", endDrag);

/* 滚轮 / 触控板捏合：缩放任一方向都是缩放（正交成像大小只由取景半高决定，不靠推拉相机） */
dom.addEventListener("wheel", e => {
  if (!CONFIG.controls.enabled) return;
  e.preventDefault();
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : (e.deltaMode === 2 ? e.deltaY * 340 : e.deltaY);
  zoomBy(Math.exp(-dy * CONFIG.controls.zoomStep));
  applyHint();
}, { passive: false });
/* ---------------- 快捷键：1-6 直达机位 / V 顺次切换 / L 开灯关灯 ----------------
   输入框、可编辑区域、带修饰键的组合一律让行，避免抢走宿主页面的键位 */
function isTypingTarget(el){
  if (!el || el === document || el === window) return false;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" ||
         el.isContentEditable === true;
}

window.addEventListener("keydown", e => {
  if (e.key === "Escape"){
    /* P1-5：Esc 退出聚焦（相机缓动回进入前的机位），同时照旧解锁信息卡 */
    if (FOCUS.on) exitFocus();
    pinnedTip = null;
    applyHint();
  }
  /* calling v0：C 键对锁定 / 悬停的角色接通或挂断通话（输入框内不触发） */
  if ((e.key === "c" || e.key === "C") && !isTypingTarget(e.target) &&
      !isTypingTarget(document.activeElement)){
    const ck = ownerKey(pinnedTip || hoverTip);
    if (ck){
      e.preventDefault();
      if (CALL.active && CALL.peer === ck) callEnd(); else call(ck);
      applyHint();
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!CONFIG.views.enabled || !CONFIG.views.keys) return;
  if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
  const k = e.key;
  if (k >= "1" && k <= "9"){
    const i = k.charCodeAt(0) - 49;
    if (i < VIEW_ORDER.length){ e.preventDefault(); useView(VIEW_ORDER[i]); }
    return;
  }
  if (k === "0"){ e.preventDefault(); useView(CONFIG.views.def || "iso"); return; }
  if (k === "v" || k === "V"){ e.preventDefault(); useView(nextView(1)); return; }
  if (k === "l" || k === "L"){ e.preventDefault(); useLights(lightMode === "on" ? "off" : "on"); }
});

/* =====================================================================
   P1-5 点击角色聚焦（新增能力 · 不改动任何既有对外接口与方法签名）
   ---------------------------------------------------------------------
   · 进入：单击任一角色（= 锁定其信息卡的同一手势）→ 相机平滑推近并框住该角色；
          角色脚下光环跟随、关联设备亮环标记、作业路径亮点朝设备流动；
          其余角色 / 家具 / 设备统一淡化，只留主体清晰。
   · 退出：单击空白处 / 按 Esc / 切任意预设机位 → 相机缓动回进入前的机位（含当时的
          自由缩放系数），光环与淡化逐项还原，零残留。
   · 与既有系统互不打架：只走"聚焦缓动"独立通道（不触发 onView、不改 activeView），
          开始拖拽即让位，导览中点击角色 = 先停导览再聚焦。
   · 角色 → 关联设备 / 作业路径映射：
          geometry      工位台                  自工位一动不动的静态复核
          printability  工业机 · 桌面机 · 取件台   工业机 → 桌面机（投件 → 出件）
          failure       工位台 · 异常信标          信标（异常上报）
          optimization  工位台 · 共识台            共识台（方案复议）
          consensus     共识台 · 取件台            共识台（结果汇总上会）
          插件角色（P1-a 注册进来的）无内置映射时：只亮角色本体，不硬凑设备。
   · 淡化用"高亮集合 + 材质克隆"实现：只淡不删、不改几何、不改可见性；为避免共享材质
     被连带淡化，克隆按"材质 → 克隆体"去重，并在每次进入时重建（退出即 dispose）。
   ===================================================================== */
const FOCUS_DIM = 0.13;                 // 非主体内容的淡化透明度
const FOCUS_PICK = 1.25;                // 角色高亮半径（米）：本体 + 随身道具
const FOCUS_STATION = {                 // 关联设备（位置即高亮判据中心，r 为半径）
  desk:        { p: DESK_AT,          r: 1.35 },
  printerBig:  { p: PRINT_AT.big,     r: 1.45 },
  printerDesk: { p: PRINT_AT.desk,    r: 1.35 },
  beacon:      { p: FAULT_AT,         r: 0.80 },
  tray:        { p: TRAY_AT,          r: 1.05 },
  podium:      { p: [CX, CZ],         r: 1.30 }
};
const FOCUS_SPEC = {
  /* tint 一律沿用角色本身的身份主色（PALETTE[k].accent），聚焦高亮与角色配色同一套语言 */
  geometry:     { tint: 0x22d3ee, stations: ["desk"] },
  printability: { tint: 0x34d399, stations: ["printerBig", "printerDesk", "tray"],
                  path: ["printerBig", "printerDesk"] },
  failure:      { tint: 0xfb923c, stations: ["desk", "beacon"], path: ["beacon"] },
  optimization: { tint: 0xa78bfa, stations: ["desk", "podium"], path: ["podium"] },
  consensus:    { tint: 0xf0abfc, stations: ["podium", "tray"], path: ["tray"] }
};
const FOCUS = {
  on: null,        // 当前聚焦的角色键
  tween: null,     // 聚焦相机缓动 { from, to, t, dur }
  snap: null,      // 进入前的机位快照
  free: false,     // 进入前是否处于自由环绕态
  visual: null,    // 可视化组 { group, ring, pillar, marks, dashes }
  dimmed: [],      // 被淡化的网格（保留原材质引用，退出时逐项写回）
  mats: [],        // 本次进入克隆出的材质（退出即 dispose）
  phase: 0         // 动效相位（光环呼吸 / 路径流动）
};

/* ---------------- 聚焦文案条（进入聚焦后出现，点它 = 退出） ---------------- */
const FOCUS_CSS = `
#o3d-focus{
  position:fixed; left:50%; top:14px; transform:translateX(-50%);
  display:none; align-items:center; gap:9px; z-index:42;
  padding:6px 12px 6px 13px; border-radius:999px;
  background:rgba(9,17,27,.92); color:#dce8f4;
  border:1px solid rgba(120,190,240,.34);
  box-shadow:0 8px 22px rgba(0,0,0,.5);
  font:12px/1.4 -apple-system,'PingFang SC','Helvetica Neue',sans-serif;
  letter-spacing:.1px; cursor:pointer; user-select:none;
  -webkit-user-select:none;
}
#o3d-focus b{ font-weight:600; color:#eaf6ff; }
#o3d-focus i{
  font-style:normal; opacity:.74; padding:1px 7px; border-radius:999px;
  border:1px solid rgba(120,190,240,.28); background:rgba(120,190,240,.10);
}
#o3d-focus:hover{ border-color:rgba(140,205,255,.62); }
`;
(function focusChipInit(){
  const st = document.createElement("style");
  st.id = "o3d-focus-css";
  st.textContent = FOCUS_CSS;
  document.head.appendChild(st);
})();
const focusChip = document.createElement("div");
focusChip.id = "o3d-focus";
focusChip.addEventListener("click", e => { e.stopPropagation(); exitFocus(); });
document.body.appendChild(focusChip);

function focusCue(name){
  return String(t("focus.cue")).replace("{name}", name == null ? "" : name);
}
function focusSyncChip(){
  if (!FOCUS.on){
    if (focusChip.style.display !== "none"){
      focusChip.style.display = "none"; focusChip.innerHTML = ""; focusChip._html = "";
    }
    return;
  }
  const ch = characters[FOCUS.on];
  const name = (ch && ch.name) || FOCUS.on;
  const html = "<b>" + esc(focusCue(name)) + "</b><i>" + esc(t("focus.exit")) + "</i>";
  if (focusChip._html !== html){ focusChip.innerHTML = html; focusChip._html = html; }
  focusChip.style.display = "flex";
}

/* ---------------- 角色 → 关联设备 / 路径（坐标解析 + 兜底） ---------------- */
function focusTint(k){
  const spec = FOCUS_SPEC[k];
  if (spec) return spec.tint;
  const pal = PALETTE[k];
  return (pal && pal.accent) || 0x7dd3fc;
}
function focusAnchor(tag, k){
  const s = FOCUS_STATION[tag];
  if (!s) return null;
  const p = Array.isArray(s.p) ? s.p : (s.p && s.p[k]);
  if (!p) return null;
  return { tag: tag, p: [+p[0], +p[1]], r: s.r };
}
function focusStations(k){
  const spec = FOCUS_SPEC[k];
  const tags = spec ? spec.stations : [];
  return tags.map(tag => focusAnchor(tag, k)).filter(Boolean);
}
/* 作业路径折线：角色当前站位 →（沿用场景既有寻路函数 pathPoints，绕开中央台与家具）
   依次经过路线上的关联设备。无内置路径映射时退回"角色 → 第一个关联设备"。 */
function focusPathDots(k, ch, stations){
  if (!stations.length) return [];
  const spec = FOCUS_SPEC[k] || {};
  const order = (spec.path && spec.path.length) ? spec.path : [stations[0].tag];
  const line = [];
  let from = [ch.root.position.x, ch.root.position.z];
  /* 角色恰好站在第一个目标设备上时（如 error 态守在异常信标旁），改从该角色的工位起画：
     否则整段会退化成零长度、看不到任何"作业路径"亮点。既无工位又与目标重合（如 geometry
     一直在自己的工位台前），则如实不画路径，只留设备亮环。 */
  const head = stations.find(s => s.tag === order[0]);
  if (head && Math.hypot(from[0] - head.p[0], from[1] - head.p[1]) < 0.40){
    const home = (typeof DESK_AT !== "undefined") ? DESK_AT[k] : null;
    if (home && Math.hypot(home[0] - head.p[0], home[1] - head.p[1]) > 0.40) from = [+home[0], +home[1]];
  }
  order.forEach(tag => {
    const st = stations.find(s => s.tag === tag);
    if (!st) return;
    const seg = (typeof pathPoints === "function")
      ? pathPoints(from[0], from[1], st.p[0], st.p[1])
      : [[st.p[0], st.p[1]]];
    seg.forEach(p => line.push([+p[0], +p[1]]));
    from = st.p;
  });
  /* 按 0.42m 等距铺亮点，最多 48 个（既看得到"流向"，也不至于糊成一条实线） */
  const out = [];
  const STEP = 0.42;
  let carry = 0;
  for (let i = 0; i < line.length - 1 && out.length < 48; i++){
    const ax = line[i][0], az = line[i][1], bx = line[i + 1][0], bz = line[i + 1][1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4) continue;
    for (let d = carry; d < len && out.length < 48; d += STEP){
      const u = d / len;
      out.push([ax + (bx - ax) * u, az + (bz - az) * u]);
    }
    carry = (carry + Math.ceil(Math.max(0, len - carry) / STEP) * STEP) - len;
    if (carry < 0) carry = 0;
  }
  return out;
}

/* ---------------- 聚焦可视化（光环 / 光柱 / 设备标记环 / 路径亮点） ---------------- */
function focusVisualMesh(geo, mat, x, y, z, renderOrder){
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.renderOrder = renderOrder || 6;
  return m;
}
function focusBuildVisual(tint, ch, stations, dots){
  const g = new THREE.Group();
  g.userData.focusVisual = true;
  const x = ch.root.position.x, z = ch.root.position.z;
  const flat = (geo, opacity, order) => {
    const mat = new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: opacity, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    return focusVisualMesh(geo, mat, 0, 0, 0, order);
  };
  const ring = flat(new THREE.RingGeometry(0.50, 0.66, 48), 0.75, 6);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.030, z);
  g.add(ring);
  const pillar = flat(new THREE.CylinderGeometry(0.60, 0.60, 2.40, 22, 1, true), 0.09, 5);
  pillar.position.set(x, 1.20, z);
  g.add(pillar);
  const marks = [];
  stations.forEach((st, i) => {
    const m = flat(new THREE.RingGeometry(st.r * 0.74, st.r * 0.94, 40), 0.42, 6);
    m.rotation.x = -Math.PI / 2;
    m.position.set(st.p[0], 0.028, st.p[1]);
    g.add(m);
    marks.push({ mesh: m, mat: m.material, phase: i * 0.9 });
  });
  const dashes = [];
  dots.forEach(p => {
    const d = flat(new THREE.CircleGeometry(0.135, 14), 0.30, 7);
    d.rotation.x = -Math.PI / 2;
    d.position.set(p[0], 0.032, p[1]);
    g.add(d);
    dashes.push({ mesh: d, mat: d.material });
  });
  scene.add(g);
  return { group: g, ring: ring, pillar: pillar, marks: marks, dashes: dashes };
}

/* ---------------- 淡化（只淡不删；退出逐项还原） ---------------- */
function focusOwned(o){
  for (let p = o; p; p = p.parent){ if (p.userData && p.userData.focusVisual) return true; }
  return false;
}
function focusDim(ch, stations){
  const hubs = [{ x: ch.root.position.x, z: ch.root.position.z, r: FOCUS_PICK }];
  stations.forEach(st => hubs.push({ x: st.p[0], z: st.p[1], r: st.r }));
  const dim = [];
  const wp = new THREE.Vector3();
  scene.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.material || Array.isArray(o.material)) return;
    if (focusOwned(o)) return;                        // 聚焦可视化自身
    if (flowOwned(o)) return;                         // P1-6 数据流线：独立于聚焦，不参与淡化
    if (WALL_SEEN.has(o)) return;                     // 贴墙装配：淡出由墙体系统接管
    if (o === floor || o === grid || o === rug) return;   // 地板 / 网格线 / 地毯保持原样
    if (o.userData.ceilingStrip) return;              // 顶部灯带属环境照明，保持原样
    o.getWorldPosition(wp);
    if (hubs.some(h => Math.hypot(wp.x - h.x, wp.z - h.z) <= h.r)) return;   // 高亮主体
    dim.push(o);
  });
  const matMap = new Map(), clones = [];
  dim.forEach(o => {
    const src = o.material;
    let copy = matMap.get(src);
    /* 同一个原材质只克隆一份给所有被淡化的网格共用：原材质（可能同时被高亮主体用着）
       保持不动，既不会"连坐淡化"主体，也不会为每张椅子多占一份材质。 */
    if (!copy){
      copy = src.clone();
      matMap.set(src, copy);
      clones.push(copy);
      copy.transparent = true;
      copy.opacity = FOCUS_DIM;
      copy.depthWrite = false;
    }
    o.userData.focusMat = src;
    o.material = copy;
    FOCUS.dimmed.push(o);
  });
  FOCUS.mats = clones;
}
function focusClearVisual(){
  if (FOCUS.visual){
    scene.remove(FOCUS.visual.group);
    FOCUS.visual.group.traverse(o => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
      if (o.material && o.material.dispose) o.material.dispose();
    });
    FOCUS.visual = null;
  }
  FOCUS.dimmed.forEach(m => {
    if (m.userData.focusMat){
      m.material = m.userData.focusMat;
      delete m.userData.focusMat;
    }
  });
  FOCUS.dimmed = [];
  FOCUS.mats.forEach(c => { if (c && c.dispose) c.dispose(); });
  FOCUS.mats = [];
  FOCUS.phase = 0;
}

/* ---------------- 进入 / 退出 ---------------- */
/* 聚焦机位：小取景盒（角色） + 低 minH（推近）；azim / dist / elev 从当前机位平滑接续，
   避免"点一下角色整个房间翻个面"的突兀感。 */
function focusEnterTween(ch){
  const cx = ch.root.position.x, cz = ch.root.position.z;
  const to = {
    tag: "FOCUS",
    azim: camNow.azim,
    elev: clampN(camNow.elev, 0.40, 0.62),
    dist: clampN(camNow.dist, 9.5, 13.0),
    look: [cx, 1.00, cz],
    box: { min: [cx - 1.15, 0.00, cz - 1.15], max: [cx + 1.15, 2.15, cz + 1.15] },
    minH: 1.16, maxH: 4.60, pad: 1.10, zoomK: 1
  };
  ctrl.zoomTarget = 1;
  FOCUS.tween = { from: cloneView(camNow), to: cloneView(to), t: 0,
                  dur: Math.max(0.45, CONFIG.views.tween) };
}
function focusRole(k){
  const key = String(k == null ? "" : k);
  const ch = characters[key];
  if (!ch) return { ok: false, reason: "unknown-role", role: key };
  if (FOCUS.on === key){ focusSyncChip(); return { ok: true, role: key, again: true }; }
  if (TOUR.active) tourStop("focus");            // 导览中点击角色：先中断导览（快照随之复位）
  /* 换焦点：先清掉上一个角色的可视化与淡化，但相机连续交棒（快照沿用第一次进入前的机位） */
  let snap = null, free = false;
  if (FOCUS.on){
    snap = FOCUS.snap; free = FOCUS.free;
    exitFocus({ keepCam: true });
  }else{
    free = camFree;
  }
  camTween = null;                               // 聚焦独占相机通道
  if (!snap) snap = cloneView(camNow);
  const tint = focusTint(key), stations = focusStations(key);
  const dots = focusPathDots(key, ch, stations);
  FOCUS.on = key;
  FOCUS.snap = snap;
  FOCUS.free = free;
  FOCUS.phase = 0;
  FOCUS.tween = null;
  FOCUS.visual = focusBuildVisual(tint, ch, stations, dots);
  focusDim(ch, stations);
  camFree = true;                                // 聚焦中不属于任何预设机位（HUD 不再高亮）
  syncHud();
  focusEnterTween(ch);
  focusSyncChip();
  return { ok: true, role: key, stations: stations.map(s => s.tag), dots: dots.length };
}
function exitFocus(opts){
  const o = opts || {};
  if (!FOCUS.on) return { ok: false, reason: "not-focused" };
  const role = FOCUS.on;
  const snap = FOCUS.snap, free = FOCUS.free;
  focusClearVisual();
  FOCUS.on = null; FOCUS.snap = null; FOCUS.tween = null;
  focusSyncChip();
  if (o.keepCam) return { ok: true, role: role, keepCam: true };
  if (o.instant || !snap){
    if (snap) Object.assign(camNow, cloneView(snap));
    camFree = free;
    applyCam();
    syncHud();
    return { ok: true, role: role, instant: true };
  }
  camFree = free;
  FOCUS.tween = { from: cloneView(camNow), to: cloneView(snap), t: 0,
                  dur: Math.max(0.35, CONFIG.views.tween) };
  syncHud();
  return { ok: true, role: role };
}
/* P1-5 调试：聚焦现状快照（只读，供自动化探针核对，不改任何状态） */
function focusState(){
  return {
    on: FOCUS.on,
    stations: FOCUS.on ? focusStations(FOCUS.on).map(s => s.tag) : [],
    dimmed: FOCUS.dimmed.length,
    restored: FOCUS.dimmed.filter(m => m.userData.focusMat).length,
    dots: FOCUS.visual ? FOCUS.visual.dashes.length : 0,
    marks: FOCUS.visual ? FOCUS.visual.marks.length : 0,
    tween: !!FOCUS.tween,
    free: camFree,
    camera: { tag: camNow.tag, azim: +camNow.azim.toFixed(3),
              elev: +camNow.elev.toFixed(3), dist: +camNow.dist.toFixed(3),
              look: camNow.look.map(v => +v.toFixed(3)),
              zoomK: +(camNow.zoomK || 1).toFixed(3) }
  };
}

/* 每帧：聚焦相机缓动 + 光环呼吸 + 设备标记脉冲 + 作业路径流光 */
function updateFocus(dt){
  if (FOCUS.tween){
    const T = FOCUS.tween;
    T.t += dt;
    let k = T.dur > 0 ? Math.min(1, T.t / T.dur) : 1;
    k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // easeInOutQuad
    const a = T.from, b = T.to;
    const dAz = wrapAngle(b.azim - a.azim);
    camNow.azim = a.azim + dAz * k;
    camNow.elev = a.elev + (b.elev - a.elev) * k;
    camNow.dist = a.dist + (b.dist - a.dist) * k;
    for (let i = 0; i < 3; i++){
      camNow.look[i]    = a.look[i]    + (b.look[i]    - a.look[i])    * k;
      camNow.box.min[i] = a.box.min[i] + (b.box.min[i] - a.box.min[i]) * k;
      camNow.box.max[i] = a.box.max[i] + (b.box.max[i] - a.box.max[i]) * k;
    }
    camNow.minH = a.minH + (b.minH - a.minH) * k;
    camNow.maxH = a.maxH + (b.maxH - a.maxH) * k;
    camNow.pad  = a.pad  + (b.pad  - a.pad)  * k;
    camNow.zoomK = a.zoomK + (b.zoomK - a.zoomK) * k;
    applyCam();
    if (k >= 1){ camNow.tag = b.tag; FOCUS.tween = null; }
  }
  if (!FOCUS.on || !FOCUS.visual) return;
  const ch = characters[FOCUS.on];
  if (!ch) return;
  FOCUS.phase += dt;
  const p = FOCUS.phase;
  const breathe = 0.5 + 0.5 * Math.sin(p * 3.0);
  const ring = FOCUS.visual.ring, pillar = FOCUS.visual.pillar;
  ring.position.set(ch.root.position.x, 0.030, ch.root.position.z);   // 角色可能仍在走动
  ring.material.opacity = 0.42 + 0.36 * breathe;
  ring.scale.setScalar(1 + 0.06 * breathe);
  pillar.position.set(ring.position.x, 1.20, ring.position.z);
  pillar.material.opacity = 0.055 + 0.055 * breathe;
  FOCUS.visual.marks.forEach(m => {
    const b = 0.5 + 0.5 * Math.sin(p * 2.1 + m.phase);
    m.mat.opacity = 0.26 + 0.30 * b;
    m.mesh.scale.setScalar(1 + 0.05 * b);
  });
  const n = FOCUS.visual.dashes.length;
  if (n){
    const head = (p * 1.30) % 1;              // 亮点从角色端流向设备端（方向 = 作业流向）
    FOCUS.visual.dashes.forEach((d, i) => {
      let gap = head - i / n;
      gap -= Math.floor(gap);
      const glow = Math.pow(1 - Math.min(1, gap / 0.40), 2.2);
      /* 实机验收反馈"路径流光偏弱"：抬高基底与峰值不透明度、放大点径（几何尺寸见下方 0.135） */
      d.mat.opacity = 0.10 + 0.82 * glow;
      d.mesh.scale.setScalar(0.90 + 0.34 * glow);
    });
  }
}

/* =====================================================================
   P1-6 数据流向可视化（数据流线）—— 纯新增能力，不动既有任何对外接口与方法签名
   ---------------------------------------------------------------------
   · 讲什么：任务 / 产出在角色之间流转时，沿"角色 → 下一环节设备"的真实寻路折线
     铺一条流动光带——静止的轨迹点 + 一束沿路径推进的流光粒子（带彗尾衰减），
     一眼能看出"结果从谁流向谁"。覆盖既有链路：
           modeling       geometry     → 可打印性工位      模型交付
           printability   printability → 工业机 · 桌面机     投件打印
           failure        failure      → 优化工位 / 异常信标 风险结论 · 异常上报
           optimization   optimization → 共识台             方案复议
           consensus      consensus    → 取件台             结果取件
   · 何时亮：由既有状态机驱动，不新增消息通道——角色状态迁移到 done（产出交付）
     即点亮一条；迁移到 error（异常上报）点亮一条橙色流线。数据源仍是既有
     office-event → setAgent 通道，零新增 HTTP 端点。
   · 怎么收：单条流寿命 3.4s，头尾各留淡入淡出包络，自然消散；同时最多 6 条，
     超出丢弃最旧一条；reset() / 总开关关闭时整体清空，材质逐个 dispose（几何体
     为模块级共享，不随流销毁），零残留。
   · 与聚焦的关系：只加不减——聚焦淡化遍历时显式跳过流线（flowOwned），
     故聚焦任意角色时数据流线照常可见。
   ===================================================================== */
const FLOW_TINT = { geometry: 0x22d3ee, printability: 0x34d399, failure: 0xfb923c,
                    optimization: 0xa78bfa, consensus: 0xf0abfc, error: 0xf87171 };
/* 产出流向表：角色 → 下一环节（tag 为设备名，p 为落点，name 供探针/卡片显示） */
const FLOW_ROUTE = {
  geometry:     [{ tag: "printability", p: DESK_AT.printability, name: "模型交付" }],
  printability: [{ tag: "printerBig",   p: PRINT_AT.big,         name: "投件打印" },
                 { tag: "printerDesk",  p: PRINT_AT.desk,        name: "投件打印" }],
  failure:      [{ tag: "optimization", p: DESK_AT.optimization, name: "风险结论" }],
  optimization: [{ tag: "podium",       p: [CX, CZ],             name: "方案复议" }],
  consensus:    [{ tag: "tray",         p: TRAY_AT,              name: "结果取件" }]
};
const FLOW = {
  list: [],        // 活跃流
  serial: 0,       // 流水号（探针用）
  enabled: true,   // 总开关（setFlows(false) 即停）
  seen: {}         // 最近一次各角色状态：用于识别"状态迁移"而非"状态存在"
};
const FLOW_LIFE = 3.4;        // 单条流生命（秒）
const FLOW_STEP = 0.55;       // 轨迹点间距（米）
const FLOW_TRACK_MAX = 40;    // 轨迹点上限
const FLOW_PARTS = 22;        // 流光粒子数（串成一段彗尾）
const FLOW_TAIL = 0.55;       // 彗尾覆盖路径的比例
const FLOW_MAX = 6;           // 同时活跃上限

/* 模块级共享几何体：同一批流线复用，销毁流线时只 dispose 材质 */
let _flowGeoTrack = null, _flowGeoPart = null;
function flowGeos(){
  if (!_flowGeoTrack){
    _flowGeoTrack = new THREE.CircleGeometry(0.075, 12);
    _flowGeoPart  = new THREE.CircleGeometry(0.125, 14);
  }
  return [_flowGeoTrack, _flowGeoPart];
}
/* 流线归属判定：供聚焦淡化跳过（与 focusOwned 同构） */
function flowOwned(o){
  for (let p = o; p; p = p.parent){ if (p.userData && p.userData.flowVisual) return true; }
  return false;
}
/* 角色当前位置 → 目标设备：沿用场景既有寻路函数 pathPoints（绕开中央台与家具） */
function flowPolyline(k, tx, tz){
  const ch = characters[k];
  const home = DESK_AT[k] ? [+DESK_AT[k][0], +DESK_AT[k][1]] : null;
  let from = ch ? [ch.root.position.x, ch.root.position.z] : home;
  if (!from) return [];
  /* 角色恰好站在目标设备上（如守在打印机旁）：改从其工位起画，否则整段退化成零长度 */
  if (Math.hypot(from[0] - tx, from[1] - tz) < 0.40 && home &&
      Math.hypot(home[0] - tx, home[1] - tz) > 0.40) from = home;
  if (Math.hypot(from[0] - tx, from[1] - tz) < 0.25) return [];
  const seg = (typeof pathPoints === "function")
    ? pathPoints(from[0], from[1], tx, tz)
    : [[tx, tz]];
  const pts = [[from[0], from[1]]];
  seg.forEach(p => pts.push([+p[0], +p[1]]));
  const last = pts[pts.length - 1];
  if (Math.hypot(last[0] - tx, last[1] - tz) > 1e-3) pts.push([tx, tz]);
  return pts.length >= 2 ? pts : [];
}
/* 折线等距重采样（保留终点），得到轨迹点序列 */
function flowSample(pts, step, max){
  const out = [];
  let carry = 0;
  for (let i = 0; i < pts.length - 1 && out.length < max; i++){
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4) continue;
    for (let d = carry; d < len && out.length < max; d += step){
      const u = d / len;
      out.push([ax + (bx - ax) * u, az + (bz - az) * u]);
    }
    carry = (carry + Math.ceil(Math.max(0, len - carry) / step) * step) - len;
    if (carry < 0) carry = 0;
  }
  const end = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (!out.length || Math.hypot(tail[0] - end[0], tail[1] - end[1]) > step * 0.5) out.push([end[0], end[1]]);
  return out;
}
/* 轨迹点累计弧长（粒子按弧长均匀推进，拐角处不减速、不停顿） */
function flowCum(dots){
  const cum = [0];
  for (let i = 1; i < dots.length; i++){
    cum.push(cum[i - 1] + Math.hypot(dots[i][0] - dots[i - 1][0], dots[i][1] - dots[i - 1][1]));
  }
  return cum;
}
/* 归一化弧长 u∈[0,1] → 路径坐标（二分定位 + 段内线性插值） */
function flowAt(dots, cum, u){
  if (dots.length < 2) return dots[0];
  const total = cum[cum.length - 1] || 1e-4;
  const d = Math.min(total, Math.max(0, u * total));
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1){
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const seg = Math.max(1e-4, cum[hi] - cum[lo]);
  const t = Math.min(1, Math.max(0, (d - cum[lo]) / seg));
  return [dots[lo][0] + (dots[hi][0] - dots[lo][0]) * t,
          dots[lo][1] + (dots[hi][1] - dots[lo][1]) * t];
}
/* 建一条流线：轨迹点（静态微光）+ 流光粒子（推进），材质逐点独立以便各自呼吸 */
function flowBuild(k, tag, tx, tz, tint, name){
  const pts = flowPolyline(k, tx, tz);
  if (pts.length < 2) return null;
  const dots = flowSample(pts, FLOW_STEP, FLOW_TRACK_MAX);
  if (dots.length < 2) return null;
  const geos = flowGeos();
  const group = new THREE.Group();
  group.userData.flowVisual = true;
  const mkMat = op => new THREE.MeshBasicMaterial({
    color: tint, transparent: true, opacity: op, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const track = [];
  dots.forEach((p, i) => {
    const m = new THREE.Mesh(geos[0], mkMat(0.14));
    m.rotation.x = -Math.PI / 2;
    m.position.set(p[0], 0.034, p[1]);
    m.renderOrder = 7;
    group.add(m);
    track.push({ mesh: m, mat: m.material, phase: i / dots.length });
  });
  const parts = [];
  for (let i = 0; i < FLOW_PARTS; i++){
    const m = new THREE.Mesh(geos[1], mkMat(0));
    m.rotation.x = -Math.PI / 2;
    m.position.set(dots[0][0], 0.038, dots[0][1]);
    m.renderOrder = 8;
    group.add(m);
    parts.push({ mesh: m, mat: m.material, off: i / FLOW_PARTS });
  }
  scene.add(group);
  return { id: ++FLOW.serial, from: k, to: tag, name: name, tint: tint,
           group: group, dots: dots, cum: flowCum(dots), track: track, parts: parts,
           t: 0, life: FLOW_LIFE };
}
function flowDispose(f){
  scene.remove(f.group);
  f.track.forEach(d => d.mat.dispose());
  f.parts.forEach(d => d.mat.dispose());
  f.track.length = 0;
  f.parts.length = 0;
}
function flowClear(){
  const n = FLOW.list.length;
  while (FLOW.list.length) flowDispose(FLOW.list.pop());
  return n;
}
function flowReset(){ const n = flowClear(); FLOW.seen = {}; return n; }
function flowSpawn(k, tag, tx, tz, tint, name){
  if (!FLOW.enabled) return null;
  while (FLOW.list.length >= FLOW_MAX) flowDispose(FLOW.list.shift());
  const f = flowBuild(k, tag, tx, tz, tint, name);
  if (!f) return null;
  FLOW.list.push(f);
  return f;
}
/* 状态迁移 → 流线：done（产出交付）按流向表点亮；error（异常上报）流向异常信标。
   同一状态重复推送不重复点亮；只有真的"变了"才画，避免回放刷屏。 */
function flowOnAgent(k, status){
  if (!FLOW.enabled) return false;
  const prev = FLOW.seen[k];
  FLOW.seen[k] = status;
  if (prev === status) return false;
  if (status === "error"){
    return !!flowSpawn(k, "beacon", FAULT_AT[0], FAULT_AT[1], FLOW_TINT.error, "异常上报");
  }
  if (status !== "done") return false;
  const route = FLOW_ROUTE[k];
  if (!route || !route.length) return false;
  let any = false;
  route.forEach(r => {
    if (flowSpawn(k, r.tag, r.p[0], r.p[1], FLOW_TINT[k] || 0x9aa7b8, r.name)) any = true;
  });
  return any;
}
/* 手动点亮一条流线（供宿主 / 调试 / 演示）：tag 省略走该角色流向表首项；
   传设备名（FOCUS_STATION 中的键）可指定目标。返回流水号，未点亮为 null。 */
function flowPulse(k, tag){
  const key = String(k == null ? "" : k);
  if (!characters[key]) return null;
  const route = FLOW_ROUTE[key] || [];
  let dst = tag ? route.find(r => r.tag === String(tag)) : null;
  if (!dst && tag && FOCUS_STATION[tag]){
    dst = { tag: String(tag), p: FOCUS_STATION[tag].p, name: String(tag) };
  }
  if (!dst) dst = route[0];
  if (!dst) return null;
  const f = flowSpawn(key, dst.tag, dst.p[0], dst.p[1], FLOW_TINT[key] || 0x9aa7b8, dst.name);
  return f ? f.id : null;
}
/* P1-6 调试：流线现状快照（只读，供自动化探针核对，不改任何状态） */
function flowStateSnapshot(){
  return {
    enabled: FLOW.enabled,
    active: FLOW.list.length,
    max: FLOW_MAX,
    life: FLOW_LIFE,
    seen: Object.assign({}, FLOW.seen),
    items: FLOW.list.map(f => {
      let peak = 0;
      f.parts.forEach(p => { peak = Math.max(peak, p.mat.opacity); });
      return {
        id: f.id, from: f.from, to: f.to, name: f.name,
        dots: f.dots.length, particles: f.parts.length,
        head: f.dots[0].map(v => +v.toFixed(2)),
        tail: f.dots[f.dots.length - 1].map(v => +v.toFixed(2)),
        length: +(f.cum[f.cum.length - 1] || 0).toFixed(2),
        t: +f.t.toFixed(2), life: f.life,
        peakOpacity: +peak.toFixed(3)
      };
    })
  };
}

/* 每帧：包络淡入淡出 + 粒子沿弧长推进 + 轨迹点呼吸；寿命到期即回收 */
function updateFlows(dt){
  const n = FLOW.list.length;
  if (!n) return;
  for (let i = n - 1; i >= 0; i--){
    const f = FLOW.list[i];
    f.t += dt;
    const k = f.t / f.life;
    const env = k < 0.12 ? k / 0.12 : (k > 0.74 ? Math.max(0, (1 - k) / 0.26) : 1);
    const head = (f.t * 0.62) % 1;                 // 粒子束头沿路径推进（方向 = 产出流向）
    f.parts.forEach(p => {
      let u = head + p.off * FLOW_TAIL;
      u -= Math.floor(u);
      const q = flowAt(f.dots, f.cum, u);
      p.mesh.position.set(q[0], 0.038, q[1]);
      const tail = Math.pow(1 - Math.min(1, p.off / FLOW_TAIL), 1.6);   // 越靠尾越暗越小
      p.mat.opacity = env * (0.18 + 0.78 * tail);
      p.mesh.scale.setScalar(0.85 + 0.55 * tail);
    });
    const breathe = 0.5 + 0.5 * Math.sin(f.t * 3.2);
    f.track.forEach(d => { d.mat.opacity = env * (0.10 + 0.10 * breathe); });
    if (k >= 1){ flowDispose(f); FLOW.list.splice(i, 1); }
  }
}

/* ---------------- 对外接口 ---------------- */
/* 盒体 8 角投影后的最大归一化边距：<=1 表示整个盒体都在画面内（含 pad 预算）
   入参兼容两种形态：THREE.Box3（FIT_BOX）与 {min:[x,y,z],max:[...]}（VIEWS.box） */
function frameEdgeOf(box){
  const mn = box.min.isVector3 ? box.min : { x: box.min[0], y: box.min[1], z: box.min[2] };
  const mx = box.max.isVector3 ? box.max : { x: box.max[0], y: box.max[1], z: box.max[2] };
  const v = new THREE.Vector3();
  let edge = 0;
  for (let i = 0; i < 8; i++){
    v.set(i & 1 ? mx.x : mn.x,
          i & 2 ? mx.y : mn.y,
          i & 4 ? mx.z : mn.z).project(camera);
    edge = Math.max(edge, Math.abs(v.x), Math.abs(v.y));
  }
  return edge;
}

window.__office = {
  setAgent(k, status){
    /* P0-2：八态语义，未知状态直接忽略（不猜测）；优先级与保鲜期由 applyAgentState 裁决，
       被高优先级压制的调用直接返回 false 且不产生任何可见副作用 */
    if (AGENT_STATES.indexOf(status) < 0) return false;
    if (!applyAgentState(k, status)) return false;
    runExtensions("onAgentStatus", k, status);
    flowOnAgent(k, status);          // P1-6：产出交付 / 异常上报时点亮数据流线（只加渲染，不改返回语义）
    /* 可打印性 Agent 一开工，就把模型送进两台打印机 */
    if (k === "printability" && status === "running"){
      const busy = ["big", "desk"].some(m =>
        printJobs[m].state === "upload" || printJobs[m].state === "printing");
      if (!busy) startPrintRun("");
    }
    return true;
  },
  /* 显式清除某角色的高优先级状态（error / waiting / report 立刻释放，回 idle） */
  clearAgent(k){ return clearAgent(k); },
  /* P0-3：推送 / 清空某角色的悬停卡片数据。字段 phase / progress / confidence / digest，
     兼容 office-event 的 d.meta 与站点 AgentTelemetry（currentPhase / workbenchState.output）；
     传 null 或全空对象 = 清空，卡片回落"角色名 + 职责"标签（不显示空行）。
     返回是否被采纳。只影响渲染，不参与运动与状态机。 */
  setAgentMeta(k, meta){ return setAgentMeta(k, meta); },
  /* P0-3：给任意物件挂 / 摘悬停提示（自动重建拾取表），传 null 摘除；
     第一个参数也可传 "big" / "desk" 直接操作整机 */
  attachTip(target, tip){
    const o = (target === "big" || target === "desk")
      ? (printers[target] && printers[target].machine) : target;
    attachTip(o, tip);
    return !!o;
  },
  /* P0-3 调试：卡片现状快照（不改任何状态，供自动化探针核对） */
  probeCard(){
    const tip = hoverTip || pinnedTip, key = ownerKey(tip);
    const q = sel => { const el = tipDiv.querySelector(sel); return el ? el.textContent : ""; };
    const rowsText = [];
    tipDiv.querySelectorAll(".office-card-row").forEach(r => {
      const a = r.querySelector(".office-card-k"), b = r.querySelector(".office-card-v");
      rowsText.push((a ? a.textContent : "") + "=" + (b ? b.textContent : ""));
    });
    return { visible: tipDiv.style.display === "block",
             target: key ? "agent:" + key : (tip ? "obj:" + (tip.title || "") : null),
             machine: (tip && tip.machine) || null,
             where: (tip && tip.where) || null,
             prio: (tip && tip.prio) || null,
             rows: tipDiv.querySelectorAll(".office-card-row").length,
             rowsText,
             html: tipDiv.innerHTML,
             x: parseFloat(tipDiv.style.left), y: parseFloat(tipDiv.style.top),
             head: q(".office-card-head b"), badge: q(".office-card-badge") };
  },
  /* P0-3 调试：可悬停对象清单 + 屏幕像素坐标（供自动化逐项真实鼠标悬停） */
  hoverables(){
    if (pickDirty) rebuildPickRoots();
    const r = dom.getBoundingClientRect();
    const W = r.width || window.innerWidth, H = r.height || window.innerHeight;
    return pickRoots.map(o => {
      const p = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      p.project(camera);
      const t = o.userData.tip || {};
      return { title: t.title || "", machine: t.machine || null, where: t.where || null,
               prio: t.prio || 1,
               x: Math.round(r.left + (p.x * 0.5 + 0.5) * W),
               y: Math.round(r.top + (-p.y * 0.5 + 0.5) * H) };
    });
  },
  /* P0-2 调试：状态道具（故障灯 / 文件托盘）存在性与屏幕投影百分比（供自动化核对） */
  props(){
    const pv = p => {
      _v.set(p[0], p[1], p[2]).project(camera);
      return { x: +((_v.x * 0.5 + 0.5) * 100).toFixed(2),
               y: +((-_v.y * 0.5 + 0.5) * 100).toFixed(2), depth: +_v.z.toFixed(3) };
    };
    const bd = beacon && beacon.userData.beacon;
    const jobs = {};
    Object.keys(printJobs).forEach(k => {
      const j = printJobs[k], P = MACHINE_PROFILE[k] || {};
      jobs[k] = { state: j.state, progress: +j.progress.toFixed(1), part: j.part,
                  model: j.model, batchNo: j.batchNo, seq: j.seq, seqTotal: j.seqTotal,
                  nozzleT: j.nozzleT, bedT: j.bedT, title: P.title || k,
                  rows: partRows(k, "chamber") };
    });
    return { beacon: !!(beacon && beacon.parent), beaconOn: !!(bd && bd.on),
             beaconPulse: bd ? +(bd.pulse || 0).toFixed(2) : 0,
             tray: !!(tray && tray.parent), papers: trayPapers ? trayPapers.children.length : 0,
             beaconAt: pv([FAULT_AT[0], 2.16, FAULT_AT[1]]),
             trayAt: pv([TRAY_AT[0], 0.92, TRAY_AT[1]]),
             jobs };                       // P0-3：打印工况（悬停卡片数据源，供探针核对）
  },
  /* 深空闲氛围开关：setLeisure(false) 等价 URL 参数 ?leisure=0 */
  setLeisure(on){ return setLeisure(on); },
  leisure(){ return leisure; },
  /* 状态机快照（调试 / 自动化核对） */
  agentStates(){
    return AGENT_ORDER.map(k => ({ key: k, state: stateOf(k),
      prio: stateMeta[k].prio, ttl: +Math.max(0, stateMeta[k].left).toFixed(1) }));
  },
  setConsensus(status){
    const was = state.consensus;
    state.consensus = status;
    flowOnAgent("consensus", status);   // P1-6：共识结论落定（done）时点亮"结果取件"流线
    runExtensions("onConsensus", status);
    const host = characters.coordinator;
    if (host){
      host.stage.code = status === "running" ? "running" : (status === "done" ? "done" : "");
      host.stage.hold = status === "running" ? 0.5 : (status === "done" ? 2.4 : 0);
      delete host.actLabel;
      if (status === "running") say("coordinator", tChat("say.consensus"));
      else if (status === "done") sayStage("coordinator", "done");
    }
    if (status === "running" && was !== "running"){
      Object.keys(characters).forEach(k => {
        const ch = characters[k];
        if (!ch.isHost && ch.stage.code !== "running"){ ch.roam = { phase: "work", left: 0 }; ch.actLabel = ""; }
      });
    }
  },
  /* 调试/自动截图用：临时移动机位与视口缩放，不参与正常动画 */
  view(ox, oy, oz, zoom, tx, ty, tz){
    camera.position.set(ox, oy, oz);
    camera.lookAt(tx == null ? CX : tx, ty == null ? 1.05 : ty, tz == null ? CZ : tz);
    if (zoom){ camera.zoom = zoom; camera.updateProjectionMatrix(); }
    return "view " + [ox, oy, oz].join(",") + " z" + (zoom || 1);
  },
  reset(){
    Object.keys(state).forEach(k => { state[k] = "idle"; });
    /* P0-2：状态账本 / 问号浮层 / 托盘纸张一并复位 */
    AGENT_ORDER.forEach(k => { clearAgent(k); });
    clearPrintJobs();
    flowReset();                 // P1-6：复位时清空数据流线与状态记忆，零残留
    op.phase = "seat"; op.queue = [];
    social.act = null; social.timer = 26;
    Object.keys(characters).forEach(k => {
      const ch = characters[k];
      ch.stage.code = ""; ch.stage.hold = 0;
      ch.actLabel = "";
      ch.roam = { phase: "work", left: 3 + Math.random() * 6 };
      const S = ch.desk && ch.desk.userData.screen;
      if (S){ S.mode = "code"; S.hold = 0; S.timer = 3; }
    });
  },
  uploadSTL(name){ startPrintRun(name); },
  printProgress(which, p){
    const job = printJobs[which];
    if (!job) return;
    if (job.state === "idle") job.state = "upload";
    job.progress = Math.max(0, Math.min(100, p));
    if (job.progress >= 100) job.state = "done";
  },
  /* 调试：读取某个角色的实时行为 */
  who(){
    const out = {};
    Object.keys(characters).forEach(k => {
      const ch = characters[k];
      const S = ch.desk && ch.desk.userData.screen;
      out[k] = { at: [+ch.current[0].toFixed(2), +ch.current[1].toFixed(2)],
                 mode: ch.dbgMode || "-", stage: ch.stage.code,
                 act: ch.actLabel || "", roam: ch.roam ? ch.roam.phase : "-",
                 yaw: +ch.root.rotation.y.toFixed(2),
                 bubble: bubbles[k] ? (bubbles[k].active ? bubbles[k].el.textContent : "") : "",
                 screen: S ? S.mode : "-" };
    });
    return out;
  },
  /* 自检（回归测试用）：一屏是否装得下 + 有没有人压在桌子上 / 压在彼此身上 */
  audit(){
    /* 取景自检改为「当前机位的目标盒」：任何机位下都能判断主体是否完整入画
       （全景机位的目标盒 == 整间房，与旧版语义一致）；
       roomInView 保留旧口径，仅默认全景机位为 true。 */
    const edge = frameEdgeOf(camNow.box);
    const roomEdge = frameEdgeOf(FIT_BOX);
    const list = Object.keys(characters);
    let minGap = Infinity;
    for (let i = 0; i < list.length; i++){
      for (let j = i + 1; j < list.length; j++){
        const a = characters[list[i]], b = characters[list[j]];
        minGap = Math.min(minGap, Math.hypot(a.current[0] - b.current[0],
                                             a.current[1] - b.current[1]));
      }
    }
    let overlap = -Infinity;   // > 0 表示有人压进家具
    list.forEach(k => {
      const ch = characters[k];
      OBST.forEach(r => {
        const p = obstLocal(r, ch.current[0], ch.current[1]);
        overlap = Math.max(overlap, Math.min(r.hw + BODY_R - Math.abs(p[0]),
                                             r.hd + BODY_R - Math.abs(p[1])));
      });
    });
    /* 浮牌是否可见（默认应全为 false）+ 打印机在屏幕上的像素位置（自动化悬停测试用） */
    const plates = {}, at = {};
    const rect = renderer.domElement.getBoundingClientRect();
    const v2 = new THREE.Vector3();
    Object.keys(printers).forEach(k => {
      const M = printers[k];
      if (!M) return;
      plates[k] = { title: !!(M.label && M.label.visible),
                    progress: !!(M.progress && M.progress.visible) };
      if (M.machine){
        M.machine.getWorldPosition(v2);
        v2.project(camera);
        at[k] = [Math.round(rect.left + (v2.x * 0.5 + 0.5) * rect.width),
                 Math.round(rect.top + (-v2.y * 0.5 + 0.5) * rect.height)];
      }
    });
    return { inView: edge <= 1.0, edge: +edge.toFixed(3),
             roomInView: roomEdge <= 1.0, roomEdge: +roomEdge.toFixed(3),
             view: activeView, lights: lightMode,
             /* P1-b：机位 / 角色注册面快照 —— 停用插件后这两项应与基线完全一致 */
             views: VIEW_ORDER.slice(), pluginViews: Object.keys(pluginViews),
             roles: Object.keys(roleRegistry),
             minGap: +minGap.toFixed(3), roleGap: ROLE_GAP,
             furnitureOverlap: +overlap.toFixed(3), n: list.length,
             plates: plates, printerAt: at };
  },
  /* 实时花名册：谁在哪、在干什么（Live Floor 监控面板 / 自动化核对都用它） */
  roster(){
    return Object.keys(characters).map(k => {
      const ch = characters[k];
      return {
        key: k,
        x: +ch.root.position.x.toFixed(2),
        y: +ch.root.position.y.toFixed(2),
        z: +ch.root.position.z.toFixed(2),
        face: +ch.root.rotation.y.toFixed(2),
        mode: ch.dbgMode || "",
        act: ch.actLabel || "",
        roam: ch.roam ? (ch.roam.phase + (ch.roam.act ? ":" + ch.roam.act : "")) : "",
        stage: (ch.stage && ch.stage.code) || "",
        /* P0-2：SSE/宿主推送态（含 idle/running/done/error/waiting/report/
           recalibrating/debating 与派生的 deepIdle），mode 为状态驱动出的姿态 */
        state: stateOf(k),
        ttl: stateMeta[k] ? +Math.max(0, stateMeta[k].left).toFixed(1) : 0,
        alarm: !!(ch.desk && ch.desk.userData.lamp && ch.desk.userData.lamp.alarm),
        screen: (ch.desk && ch.desk.userData.screen && ch.desk.userData.screen.mode) || ""
      };
    });
  },
  /* 落地抖动探针（只读，P1 验收用）：逐帧采样各角色 root.position.y，返回
       span    峰峰值（整段最大-最小，米）
       maxStep 相邻两帧最大跳变（米）
       medStep 相邻帧变化的中位数（米）—— 稳态高频颤抖的直接指标，平滑收敛后应≈0
       std     标准差
     修复前（每 3 帧把残差直接加在 position.y 上）：坐姿 medStep 约 0.002~0.010 @20Hz；
     修复后（标定式残差 + 单一平滑曲线驱动）：稳态 medStep < 0.0005。 */
  jitter(ms, opts){
    const dur = Math.max(300, Math.min(8000, ms || 2500));
    const withFeet = !!(opts && opts.feet);
    const keys = Object.keys(characters);
    const acc = {};
    keys.forEach(k => { acc[k] = { y: [], fy: [] }; });
    let t0 = 0, n = 0;
    return new Promise(resolve => {
      const step = ts => {
        if (!t0) t0 = ts;
        keys.forEach(k => {
          const ch = characters[k];
          acc[k].y.push(ch.root.position.y);
          if (withFeet && n % 2 === 0) acc[k].fy.push(footMinY(ch));
        });
        n++;
        if (ts - t0 < dur) requestAnimationFrame(step);
        else {
          const stat = arr => {
            if (arr.length < 3) return { span: 0, maxStep: 0, medStep: 0, std: 0 };
            let mn = Infinity, mx = -Infinity, ms = 0, s = 0;
            const steps = [];
            for (let i = 0; i < arr.length; i++){
              const v = arr[i];
              if (v < mn) mn = v;
              if (v > mx) mx = v;
              s += v;
              if (i){ const d = Math.abs(v - arr[i - 1]); steps.push(d); if (d > ms) ms = d; }
            }
            const mean = s / arr.length;
            let v2 = 0;
            for (let i = 0; i < arr.length; i++) v2 += (arr[i] - mean) * (arr[i] - mean);
            steps.sort((a, b) => a - b);
            return { span: +(mx - mn).toFixed(4), maxStep: +ms.toFixed(4),
                     medStep: +(steps[Math.floor(steps.length / 2)] || 0).toFixed(4),
                     mean: +mean.toFixed(4),
                     std: +Math.sqrt(v2 / arr.length).toFixed(4) };
          };
          const out = {};
          keys.forEach(k => {
            const ys = stat(acc[k].y);
            out[k] = { frames: acc[k].y.length, mode: characters[k].dbgMode || "",
                       span: ys.span, maxStep: ys.maxStep, medStep: ys.medStep, std: ys.std };
            if (withFeet){
              const fs = stat(acc[k].fy);
              out[k].footSpan = fs.span;
              out[k].footMed = fs.mean;   // 鞋底最低点中位数：≈0 贴地 / <0 穿地 / >0 悬空
              out[k].tail = acc[k].fy.slice(-12).map(v => +v.toFixed(4));   // 末端 fy 轨迹
              out[k].tailY = acc[k].y.slice(-12).map(v => +v.toFixed(4));   // 末端 y 轨迹
            }
          });
          resolve({ ms: Math.round(dur), withFeet, roles: out });
        }
      };
      requestAnimationFrame(step);
    });
  },
  /* P1 调试：落地标定内部量快照 —— 诊断"脚到底踩实没有 / 还在漂什么" */
  gfState(){
    const _p = new THREE.Vector3();
    const legsInfo = [];
    Object.keys(characters).forEach(k => {
      const ch = characters[k];
      const info = {};
      ["L", "R"].forEach(side => {
        const leg = ch.legs && ch.legs[side];
        const shoe = leg && leg.userData.shoe;
        if (!shoe){ info[side] = null; return; }
        shoe.getWorldPosition(_p);
        _footBox.setFromObject(shoe);
        info[side] = { ankleY: +_p.y.toFixed(3),
                       boxY: [+_footBox.min.y.toFixed(3), +_footBox.max.y.toFixed(3)],
                       knee: leg.userData.knee ? +leg.userData.knee.rotation.x.toFixed(3) : null };
      });
      legsInfo.push({ key: k, legs: info });
    });
    return Object.keys(characters).map((k, i) => {
      const ch = characters[k];
      return { key: k, mode: ch.dbgMode || "",
               y: +ch.root.position.y.toFixed(4),
               fix: +(ch.groundFix == null ? 0 : ch.groundFix).toFixed(4),
               fixCur: +(ch.groundFixCur == null ? 0 : ch.groundFixCur).toFixed(4),
               gfKey: ch.gfKey || null, gfN: ch.gfN || 0,
               seatLean: +(ch.seatLean || 0).toFixed(3),
               legs: legsInfo[i].legs,
               footY: +footMinY(ch).toFixed(4) };
    });
  },
  /* P0-2 状态机：单角色当前态查询 */
  stateOf(k){ return stateOf(k); },
  /* 外部 / 插件调用：让某个角色冒一句气泡（文案自备，走 i18n 时用 tChat） */
  say(k, text){ say(k, text); },
  /* 切换语言：{ui: 场景牌子文案, chat: 对话气泡文案}，也可直接传字符串只切 UI */
  setLocale(opts){
    if (typeof opts === "string"){ LOCALE = opts; }
    else if (opts){
      if (opts.ui) LOCALE = opts.ui;
      if (opts.chat) CHAT_LOCALE = opts.chat;
    }
    refreshTips();          // 机器提示条文案
    return { ui: LOCALE, chat: CHAT_LOCALE };
  },
  /* P0-4 探针：当前相机（预设机位与自由环绕共用同一套口径，便于自动化比对） */
  camera(){
    const c = camNow;
    return { view: activeView, free: camFree,
             azim: +c.azim.toFixed(4), elev: +c.elev.toFixed(4), dist: +c.dist.toFixed(3),
             zoomK: +c.zoomK.toFixed(4),
             target: [+c.look[0].toFixed(2), +c.look[1].toFixed(2), +c.look[2].toFixed(2)],
             pos: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)],
             fog: scene.fog ? { near: +scene.fog.near.toFixed(2), far: +scene.fog.far.toFixed(2) } : null,
             halfH: +((camera.top - camera.bottom) / 2).toFixed(3),
             inside: camera.position.x > 0.35 && camera.position.x < ROOM - 0.35 &&
                     camera.position.z > 0.35 && camera.position.z < ROOM - 0.35 };
  },
  /* P0-4 探针：可透视墙的淡出系数（1=实心 / 0=全透视）与收集到的墙件数量 */
  walls(){
    const n = WALLP.n, w = WALLP.w;
    return { n: { alpha: +n.alpha.toFixed(3), items: n.items.length },
             w: { alpha: +w.alpha.toFixed(3), items: w.items.length },
             seen: WALL_SEEN.size, band: WALL_BAND, edge: WALL_EDGE };
  },
  /* P0-4 探针：信息卡状态（悬停 / 锁定对象与类型，验收"点击锁卡"用） */
  card(){
    const info = tip => {
      if (!tip) return null;
      const owner = Object.keys(characters).find(k => characters[k].root.userData.tip === tip);
      return { prio: tip.prio || 1, owner: owner || null,
               part: tip.where ? (tip.machine + ":" + tip.where) : null,
               title: tip.title || tip.titleKey || "" };
    };
    return { hover: info(hoverTip), pinned: info(pinnedTip),
             visible: tipDiv.style.display !== "none",
             pinnedCls: tipDiv.classList.contains("is-pinned") };
  },
  /* 程序化环绕 / 缩放（等价于一次鼠标拖拽 / 滚轮；自动化验收与插件调用都用它） */
  orbit(dx, dy){ orbitBy(dx, dy); return this.camera(); },
  zoom(f){ zoomBy(f); return this.camera(); },
  config: CONFIG,
  registerExtension,                    // 插件化扩展点（见文件上部说明）
  extensions: EXTENSIONS,               // 已注册插件（只读查看）
  /* 插件通道（P1-d 用例落地所需的最小补齐）：
     registerExtension 注册扩展点（幂等，同 id 只收一次）；
     THREE 句柄供插件自造道具，挂到 api.roleObject(id) 上，再经 api.attachTip
     并入既有悬停拾取表（不新增拾取通道）。 */
  registerExtension(ext){ return registerExtension(ext); },
  get extensionIds(){ return EXTENSIONS.map(e => e.id); },
  THREE,
  /* P1-a：角色注册接口 —— 注册只登记描述符（零副作用），激活才建网格入场景 */
  registerRole(spec){ return registerRole(spec); },
  activateRole(id, opts){ return activateRole(id, opts); },
  unmountRole(id){ return unmountRole(id); },
  unregisterRole(id){ return unregisterRole(id); },   // 配套收尾：摘登记表条目（卸载幂等）
  roles(){ return roles(); },
  /* P1-b §5.3：角色根节点（插件把自有道具挂到 root 上；未在场返回 null） */
  roleObject(id){ const ch = characters[String(id)]; return (ch && ch.root) ? ch.root : null; },
  /* P1-b §5.3：道具挂载 / 摘除 —— 挂上 tip 即自动进入既有悬停拾取表，不新增拾取通道 */
  attachTip(obj, tip){ attachTip(obj, tip); return true; },
  detachTip(obj){ attachTip(obj, null); return true; },
  /* calling v0：文字通话（call 接通 / callSay 我方发言 / callReply 对方回话供插件接管 /
     callEnd 挂断 / callState 快照）。不调用时对场景零足迹，见 CALL 模块注释。 */
  call(id){ return call(id); },
  callSay(text){ return callSayUser(text); },
  callReply(text){ return callReply(text); },
  callEnd(){ return callEnd(); },
  callState(){ return callState(); },
  /* calling v1：语音（可选增强，默认关，不开时与 v0 完全一致）
     callVoice(true/false) 开/关语音总开关；callVoiceState() 快照（含 TTS/识别可用态与降级原因）；
     callVoiceProbe() 手动重探后端 TTS；callSpeak(text) 手动播报一句；callListen(true/false) 起停聆听。
     说明：麦克风被拒或浏览器不支持识别时不抛错，仅降级为 v0 文字输入并在面板明示。 */
  callVoice(on){ return callVoice(on); },
  callVoiceState(){ return callVoiceState(); },
  callVoiceProbe(force){ return callVoiceProbe(force); },
  callSpeak(text){ return callSpeak(text); },
  callListen(on){ return callListen(on); },
  /* P1-c：导览流程（tour 启动 / tourStop 中断 / tourState 快照）。
     stops 的 anchor 取 dest 表或 plan.anchors；未导览时对场景零副作用。
     阶段钩子：onTourStage(phase, info) / onTourEvent(outcome, last)，插件可接管讲解。 */
  tour(plan){ return tourStart(plan); },
  tourStop(reason){ return tourStop(reason); },
  tourState(){ return tourState(); },
  /* 机位：setView("gym") 直达；不传参返回 { view, views } */
  setView(name, opts){
    if (!name) return { view: activeView, views: VIEW_ORDER.slice() };
    const r = useView(name, opts);
    return r.ok ? { ok: true, view: name, prev: r.prev } : r;
  },
  nextView(){ return useView(nextView(1)); },
  /* P1-5 点击角色聚焦（纯新增，既有方法签名与行为一律不动）：
     focusRole("geometry") 聚焦指定角色（相机推近 + 高亮关联设备与作业路径 + 其余淡化）；
     exitFocus() 退出聚焦（相机缓动回进入前的机位）；exitFocus({instant:true}) 瞬时收尾；
     focusState() 只读快照，供自动化探针核对（不产生任何副作用）。 */
  focusRole(k){ return focusRole(k); },
  exitFocus(opts){ return exitFocus(opts); },
  focusState(){ return focusState(); },
  /* P1-6 数据流向可视化（纯新增，既有方法签名与行为一律不动）：
     flowPulse("geometry") 手动点亮一条产出流线（返回流水号，未点亮为 null），
     第二参数可传设备名（printerBig / printerDesk / podium / tray / beacon）指定目标；
     setFlows(false) 总开关（关闭时清空现有流线）；flowClear() 立即清空（返回条数）；
     flows() 只读快照，供自动化探针核对。 */
  flowPulse(k, tag){ return flowPulse(k, tag); },
  setFlows(on){ FLOW.enabled = !!on; if (!FLOW.enabled) flowClear(); return FLOW.enabled; },
  flowClear(){ return flowClear(); },
  flows(){ return flowStateSnapshot(); },
  /* views 为实时快照（插件注册带 order:true 的机位会追加进来，故用 getter 而非静态数组） */
  get views(){ return VIEW_ORDER.slice(); },
  /* P1-b：机位追加式注册 —— registerView 默认不进 VIEW_ORDER（不占数字键 / 不参与轮换），
     卸载由 unregisterView 负责；内置 7 机位不可被覆盖或卸载 */
  registerView(name, view, opts){ return registerView(name, view, opts); },
  unregisterView(name){ return unregisterView(name); },
  /* P1-b：公共锚点表只读快照（副本 + 冻结；插件要加私有锚点请走 registerRole({anchors})） */
  get dest(){
    const o = {};
    Object.keys(DEST).forEach(k => { o[k] = Object.freeze(DEST[k].slice()); });
    return Object.freeze(o);
  },
  /* P1-b：落位解析（只读试算，不改场景）—— 供插件在下单前预判能不能站 */
  resolveSpot(opts){
    const o = opts || {};
    if (Array.isArray(o.spot)) return { ok: true, spot: [+o.spot[0], +o.spot[1]], via: "explicit" };
    if (o.anchor != null){
      const key = String(o.anchor);
      const a = DEST[key];
      if (!a) return { ok: false, reason: "unknown-anchor", anchor: key };
      const s = findSpotNear(a[0], a[1]);
      return s ? { ok: true, spot: s, via: "anchor", anchor: key }
               : { ok: false, reason: "no-slot", anchor: key };
    }
    const s = findRoleSpot(o.hint);
    return s ? { ok: true, spot: s, via: "search" } : { ok: false, reason: "no-slot" };
  },
  /* 灯光：setLights("on"/"off")，不传参 = 切换 */
  setLights(mode){ return useLights(mode); },
  getLights(){ return lightMode; },
  /* HUD 显隐（外部嵌入时可按需收起控件） */
  hud(show){ return setHudVisible(show !== false); },
  ready: true
};

/* =====================================================================
   HUD：右下角「视角 + 灯光」控件
   ---------------------------------------------------------------------
   自绘 DOM + 自带样式：不依赖宿主页面（主控台 .room / 独立 /office 页 / 前端 iframe）
   的任何 CSS，也绝不改动画布尺寸（position:absolute 覆盖在 canvas 之上）。
   · 关掉方式：CONFIG.views.enabled=false、URL 加 ?hud=0、或 __office.hud(false)
   · 窄画布（前端小屏卡片）自动收起文字说明，只留按钮，避免挤占画面
   ===================================================================== */
const HUD_STYLE_ID = "o3d-hud-style";
let hudEl = null;
const hudRefs = { view: {}, light: {}, caps: [], viewGroup: null };

function injectHudStyle(){
  if (document.getElementById(HUD_STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = HUD_STYLE_ID;
  st.textContent = [
    "#o3d-hud{position:absolute;left:14px;right:14px;bottom:13px;z-index:6",
    ";display:flex;align-items:flex-end;justify-content:space-between;gap:8px;flex-wrap:wrap",
    ";pointer-events:none;font:10px/1 -apple-system,'SF Mono',Menlo,Consolas,monospace",
    ";letter-spacing:.16em;text-transform:uppercase;-webkit-font-smoothing:antialiased}",
    "#o3d-hud .o3d-group{display:flex;align-items:center;gap:5px;pointer-events:auto",
    ";padding:6px 8px;border-radius:10px;border:1px solid rgba(120,150,180,.20)",
    ";background:rgba(9,13,18,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}",
    "#o3d-hud .o3d-cap{color:#5f7288;padding:0 2px 0 1px}",
    "#o3d-hud .o3d-hint{color:#47596d;padding:0 3px}",
    "#o3d-hud .o3d-btn{font:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer",
    ";color:#8ea2b8;background:transparent;border:1px solid rgba(120,150,180,.24)",
    ";border-radius:6px;padding:5px 7px;transition:color .18s,border-color .18s,background .18s}",
    "#o3d-hud .o3d-btn:hover{color:#dbe6f3;border-color:rgba(160,190,220,.5)}",
    "#o3d-hud .o3d-btn:focus-visible{outline:1px solid rgba(120,190,220,.8);outline-offset:1px}",
    "#o3d-hud .o3d-btn.is-on{color:#e7fbf4;border-color:rgba(57,208,165,.72);background:rgba(57,208,165,.14)}",
    "#o3d-hud .o3d-btn[data-light='on'].is-on{color:#fff4e2;border-color:rgba(255,196,110,.75);background:rgba(255,196,110,.16)}",
    "@media (max-width:620px){#o3d-hud .o3d-hint{display:none}}",
    "@media (max-width:520px){#o3d-hud{left:9px;right:9px;bottom:9px;font-size:9px;letter-spacing:.1em}",
    "#o3d-hud .o3d-cap{display:none}#o3d-hud .o3d-group{padding:4px 5px;gap:4px}",
    "#o3d-hud .o3d-btn{padding:4px 5px}}"
  ].join("");
  document.head.appendChild(st);
}

function hudButton(label, title){
  const b = document.createElement("button");
  b.type = "button";
  b.className = "o3d-btn";
  b.textContent = label;
  b.title = title;
  return b;
}

const HUD_OFF_BY_PARAM = /[?&]hud=0\b/.test(location.search);   // 外部嵌入可显式关闭

function buildHud(force){
  if (hudEl || !CONFIG.views.enabled) return hudEl;
  if (HUD_OFF_BY_PARAM && !force) return null;
  const host = canvas.parentElement || document.body;
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  injectHudStyle();

  const bar = document.createElement("div");
  bar.id = "o3d-hud";

  /* 左：视角切换 */
  const gv = document.createElement("div");
  gv.className = "o3d-group";
  gv.setAttribute("role", "group");
  const cv = document.createElement("span");
  cv.className = "o3d-cap";
  gv.appendChild(cv);
  hudRefs.caps.push({ el: cv, key: "viewCap" });
  VIEW_ORDER.forEach((name, i) => {
    const b = hudButton(VIEWS[name].tag, "");
    b.dataset.view = name;
    b.addEventListener("click", () => { b.blur(); useView(name); });
    hudRefs.view[name] = b;
    gv.appendChild(b);
  });
  hudRefs.viewGroup = gv;
  bar.appendChild(gv);

  /* 右：灯光开关 + 键位提示 */
  const gl = document.createElement("div");
  gl.className = "o3d-group";
  gl.setAttribute("role", "group");
  const hint = document.createElement("span");
  hint.className = "o3d-hint";
  gl.appendChild(hint);
  hudRefs.caps.push({ el: hint, key: "hint" });
  const cl = document.createElement("span");
  cl.className = "o3d-cap";
  gl.appendChild(cl);
  hudRefs.caps.push({ el: cl, key: "lightCap" });
  const bOff = hudButton("", "");
  bOff.dataset.light = "off";
  bOff.addEventListener("click", () => { bOff.blur(); useLights("off"); });
  const bOn = hudButton("", "");
  bOn.dataset.light = "on";
  bOn.addEventListener("click", () => { bOn.blur(); useLights("on"); });
  hudRefs.light.off = bOff; hudRefs.light.on = bOn;
  gl.appendChild(bOff); gl.appendChild(bOn);
  bar.appendChild(gl);

  host.appendChild(bar);
  hudEl = bar;
  syncHud();
  return bar;
}

/* 文案与激活态同步（切语言 / 切机位 / 切灯光 都走这里，保证只有一处真相） */
function syncHud(){
  if (!hudEl) return;
  hudRefs.caps.forEach(c => { c.el.textContent = t("hud." + c.key); });
  /* P1-b：按 VIEW_ORDER 增量补齐 / 回收机位按钮（插件注册带 order:true 的机位即出现，
     卸载后按钮随之移除；默认不入 VIEW_ORDER 的插件机位不占 HUD 序列） */
  const vg = hudRefs.viewGroup;
  if (vg){
    VIEW_ORDER.forEach(name => {
      if (hudRefs.view[name] || !VIEWS[name]) return;
      const b = hudButton(VIEWS[name].tag, "");
      b.dataset.view = name;
      b.addEventListener("click", () => { b.blur(); useView(name); });
      hudRefs.view[name] = b;
      vg.appendChild(b);
    });
  }
  Object.keys(hudRefs.view).forEach(k => {
    const b = hudRefs.view[k];
    if (!VIEWS[k]){
      if (b.parentNode) b.parentNode.removeChild(b);
      delete hudRefs.view[k];
      return;
    }
    /* P0-4：自由环绕后不再高亮任何机位（角度已偏离预设，高亮会误导） */
    b.classList.toggle("is-on", !camFree && k === activeView);
    b.title = t("hud.view." + k) + "  (" + (VIEW_ORDER.indexOf(k) + 1) + ")";
  });
  const bOn = hudRefs.light.on, bOff = hudRefs.light.off;
  if (bOn){
    bOn.textContent = t("hud.on");
    bOn.title = t("hud.lightsOn");
    bOn.classList.toggle("is-on", lightMode === "on");
  }
  if (bOff){
    bOff.textContent = t("hud.off");
    bOff.title = t("hud.lightsOff");
    bOff.classList.toggle("is-on", lightMode === "off");
  }
}

function setHudVisible(show){
  if (show === false){ if (hudEl) hudEl.style.display = "none"; return false; }
  const bar = hudEl || buildHud(true);   // 显式打开时忽略 ?hud=0
  if (bar) bar.style.display = "";
  return !!bar;
}

/* 切换照明方案：不传参 = 在 on/off 之间切换 */
function useLights(mode){
  const next = (mode === "on" || mode === "off") ? mode : (lightMode === "on" ? "off" : "on");
  if (next === lightMode) return { lights: lightMode };
  lightMode = next;
  syncHud();
  runExtensions("onLights", lightMode);
  return { lights: lightMode };
}

/* ---------------- URL 直达：机位 / 灯光 / 会诊演示 ----------------
   例：/office?view=print&lights=off&huddle=1
   · view    —— 直接切到某个机位（iso/top/print/gym/pantry/desks）
   · lights  —— 直接指定照明方案 on/off
   · huddle  —— 立刻安排一次「大型机前会诊」并保持不走（截图/演示用）
   外部站点 iframe 或运维截图都靠这几个参数直取画面，不必点 HUD。 */
const _PARAMS = (function(){
  try { return new URLSearchParams(location.search); } catch (_) { return new URLSearchParams(""); }
})();
const VIEW_BY_PARAM = (function(){
  const q = _PARAMS.get("view");
  return (q && VIEWS[q]) ? q : "";
})();
const LIGHTS_BY_PARAM = (function(){
  const q = (_PARAMS.get("lights") || "").toLowerCase();
  return (q === "on" || q === "off") ? q : "";
})();
const HUDDLE_BY_PARAM = /[?&]huddle=1\b/.test(location.search);

/* ---------------- 启动 ---------------- */
/* P0-4：场景搭完后收集一次贴墙装配（自由环视绕到墙外时整组淡出）。
   必须放在这里：此前角色 / 家具 / 机器都已就位，收集判据才是最终位置 */
collectWallAssembly();
layout();
window.addEventListener("resize", layout);
if (window.ResizeObserver){
  new ResizeObserver(layout).observe(canvas);
}
buildHud();
if (VIEW_BY_PARAM) useView(VIEW_BY_PARAM, { instant: true });
if (LIGHTS_BY_PARAM) useLights(LIGHTS_BY_PARAM);
if (HUDDLE_BY_PARAM){ startHuddle("big"); huddle.t = 1e9; }   // 演示模式：会诊常驻
requestAnimationFrame(() => { layout(); frameDelta(); loop(); });


/* ==================== P1-8 性能分级 (START) ==================== */
/* 依据设备能力与实时帧率分档（high / mid / low）：帧率不足自动降档，稳定达标后再升档；
   也可用 __office.setQuality("auto|high|mid|low") 手动指定，__office.perf() 读取快照。
   只新增接口与像素比 / 阴影 / 流线的渲染开销，不改任何既有签名。 */
const PERF = {
  mode: "auto", tier: "high", fps: 60, cap: 2, shadows: true, flows: true,
  samples: 0, acc: 0, n: 0, t0: 0, good: 0, last: ""
};
const PERF_TIER = {
  high: { cap: 2,   shadows: true,  flows: true,  label: "HIGH" },
  mid:  { cap: 1.5, shadows: true,  flows: true,  label: "MID"  },
  low:  { cap: 1,   shadows: false, flows: false, label: "LOW"  }
};
const PERF_ORDER = ["low", "mid", "high"];
const PERF_BADGE = !/[?&]perf=0\b/.test(location.search);
let perfBadge = null;

function perfSnapshot(){
  return { mode: PERF.mode, tier: PERF.tier, fps: PERF.fps, cap: PERF.cap,
    pixelRatio: renderer.getPixelRatio(), shadows: PERF.shadows, flows: PERF.flows,
    samples: PERF.samples, reason: PERF.last };
}
function perfHud(){
  if (!perfBadge) return;
  const t = PERF_TIER[PERF.tier] || PERF_TIER.high;
  perfBadge.textContent = Math.round(PERF.fps) + " fps \u00b7 " + t.label + (PERF.mode === "auto" ? " \u00b7 AUTO" : "");
}
function perfBadgeBuild(){
  if (!PERF_BADGE || !document.body) return;
  perfBadge = document.createElement("div");
  perfBadge.id = "perf-badge";
  perfBadge.style.cssText = "position:fixed;right:14px;bottom:16px;z-index:5;padding:3px 8px;" +
    "border-radius:999px;background:rgba(11,13,16,.62);border:1px solid rgba(255,255,255,.10);" +
    "color:#9fb3c8;font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;" +
    "pointer-events:none;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)";
  document.body.appendChild(perfBadge);
  perfHud();
}
function perfApply(tier, why){
  const t = PERF_TIER[tier] || PERF_TIER.high;
  PERF.tier = tier; PERF.cap = t.cap; PERF.shadows = t.shadows; PERF.flows = t.flows;
  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.cap));
    renderer.shadowMap.enabled = t.shadows;
    renderer.shadowMap.autoUpdate = t.shadows;
    if (typeof layout === "function") layout();
  } catch (_) {}
  try {
    const api = window.__office;
    if (api && typeof api.setFlows === "function") api.setFlows(t.flows);
  } catch (_) {}
  PERF.last = why || "";
  perfHud();
  return perfSnapshot();
}
function perfAuto(fps){
  const i = PERF_ORDER.indexOf(PERF.tier);
  if (i < 0) return;
  if (fps < 42 && i > 0){ perfApply(PERF_ORDER[i - 1], "auto-down"); PERF.good = 0; }
  else if (fps > 56 && i < PERF_ORDER.length - 1){
    if (++PERF.good >= 6){ perfApply(PERF_ORDER[i + 1], "auto-up"); PERF.good = 0; }
  } else PERF.good = 0;
}
function perfSetMode(mode){
  const m = String(mode == null ? "" : mode).toLowerCase();
  if (m === "auto"){ PERF.mode = "auto"; return perfSnapshot(); }
  if (!PERF_TIER[m]) return perfSnapshot();
  PERF.mode = m;
  return perfApply(m, "manual");
}
function perfTick(now){
  requestAnimationFrame(perfTick);
  if (!PERF.t0){ PERF.t0 = now; return; }
  const dt = now - PERF.t0; PERF.t0 = now;
  if (dt <= 0 || dt > 500) return;                 /* 切后台 / 长卡顿不入样 */
  PERF.acc += dt; PERF.n++; PERF.samples++;
  if (PERF.acc >= 1000){
    PERF.fps = Math.round((PERF.n * 1000 / PERF.acc) * 10) / 10;
    PERF.acc = 0; PERF.n = 0;
    if (PERF.mode === "auto") perfAuto(PERF.fps);
    perfHud();
  }
}
(function perfBoot(){
  let start = "high";
  try {
    const cores = (navigator && navigator.hardwareConcurrency) || 4;
    const mem = (navigator && navigator.deviceMemory) || 4;
    if (cores <= 4 || mem <= 4) start = "mid";
  } catch (_) {}
  perfApply(start, "boot");
  perfBadgeBuild();
  try {
    const o = window.__office;
    if (o && typeof o === "object"){
      if (typeof o.setQuality !== "function") o.setQuality = function(m){ return perfSetMode(m); };
      if (typeof o.perf !== "function") o.perf = function(){ return perfSnapshot(); };
    }
  } catch (_) {}
  requestAnimationFrame(perfTick);
  return true;
})();
/* ==================== P1-8 性能分级 (END) ==================== */
