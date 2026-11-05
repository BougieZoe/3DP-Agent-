/**
 * Single message catalogue for the whole app (UI chrome + analysis content).
 *
 * Why one file: there used to be two independent stores — a flat
 * `translations: { en, ja, zh }` in client/src/lib/i18n.ts for UI labels and a
 * keyed `CONTENT` in shared/i18n/content.ts for generated analysis text. They
 * had disjoint keys and no conflicts, but adding a string meant choosing a
 * store, and the same concept could be (and once was) translated twice with
 * different wording.
 *
 * Now: one entry per message, all three languages required, one lookup path.
 * UI code calls getTranslation(); pipeline text calls translate() — both read
 * this object.
 *
 * Rules for editing:
 *  - Every entry carries en, ja and zh. A missing translation is a build error,
 *    not a runtime fallback.
 *  - Placeholders use {name} and are substituted by the caller.
 *  - Keep keys stable; they are referenced from tests and PDF output.
 */
export const MESSAGES = {
  "title": {
    en: "3DP Agent",
    ja: "3DP Agent",
    zh: "3DP Agent",
  },
  "subtitle": {
    en: "AI Consultant for 3D Printing",
    ja: "3Dプリント AI コンサルタント",
    zh: "3D 打印 AI 顾问",
  },
  "scrollHint": {
    en: "Scroll to Initialize",
    ja: "スクロールして開始",
    zh: "向下滚动以初始化",
  },
  "designIntelligence": {
    en: "Design Intelligence",
    ja: "デザイン インテリジェンス",
    zh: "设计智能",
  },
  "designDesc": {
    en: "Upload your STL model. Our AI advisor analyzes printability, identifies potential issues, and provides optimization recommendations in real-time.",
    ja: "STL モデルをアップロードしてください。AI アドバイザーが印刷可能性を分析し、潜在的な問題を特定し、リアルタイムで最適化の推奨事項を提供します。",
    zh: "上传您的 STL 模型。我们的 AI 顾问分析可打印性，识别潜在问题，并实时提供优化建议。",
  },
  "beginAnalysis": {
    en: "Begin Analysis",
    ja: "分析を開始",
    zh: "开始分析",
  },
  "uploadHint": {
    en: "Drag STL file here or click to upload",
    ja: "STL ファイルをここにドラッグするか、クリックしてアップロード",
    zh: "将 STL 文件拖到此处或点击上传",
  },
  "uploadButton": {
    en: "Upload Model",
    ja: "モデルをアップロード",
    zh: "上传模型",
  },
  "analysisFeatures": {
    en: "Analysis Features",
    ja: "分析機能",
    zh: "分析功能",
  },
  "wallThickness": {
    en: "Wall Thickness",
    ja: "壁厚検出",
    zh: "壁厚检测",
  },
  "wallThicknessDesc": {
    en: "Detects areas too thin for reliable printing",
    ja: "印刷に適さない薄い領域を検出",
    zh: "检测过薄而不适合打印的区域",
  },
  "overhangDetection": {
    en: "Overhang Detection",
    ja: "オーバーハング検出",
    zh: "悬垂检测",
  },
  "overhangDesc": {
    en: "Identifies angles requiring support structures",
    ja: "サポート構造が必要な角度を特定",
    zh: "识别需要支撑结构的角度",
  },
  "materialOptimization": {
    en: "Material Optimization",
    ja: "材料最適化",
    zh: "材料优化",
  },
  "materialDesc": {
    en: "Recommends optimal materials and settings",
    ja: "最適な材料と設定を推奨",
    zh: "推荐最优的材料和设置",
  },
  "supplierMatching": {
    en: "Supplier Matching",
    ja: "サプライヤー マッチング",
    zh: "供应商匹配",
  },
  "supplierDesc": {
    en: "Connects you with ideal manufacturing partners",
    ja: "理想的な製造パートナーとつなぐ",
    zh: "连接您与理想的制造合作伙伴",
  },
  "footer": {
    en: "3DP Agent © 2026 | Powered by Advanced AI Analysis",
    ja: "3DP Agent © 2026 | 高度な AI 分析により提供",
    zh: "3DP Agent © 2026 | 由先进 AI 分析提供支持",
  },
  "copyrightNotice": {
    en: "© 2026 Zoe · 3DP Agent™ · All rights reserved",
    ja: "© 2026 Zoe · 3DP Agent™ · 無断転載禁止",
    zh: "© 2026 Zoe · 3DP Agent™ · 保留所有权利",
  },
  "viewport": {
    en: "VIEWPORT",
    ja: "ビューポート",
    zh: "视图",
  },
  "viewportHint": {
    en: "drag: rotate · scroll: zoom",
    ja: "ドラッグ: 回転 · スクロール: ズーム",
    zh: "拖动: 旋转 · 滚轮: 缩放",
  },
  "input": {
    en: "INPUT",
    ja: "入力",
    zh: "输入",
  },
  "ordersTab": {
    en: "ORDERS",
    ja: "注文",
    zh: "订单",
  },
  "loopTab": {
    en: "LOOP",
    ja: "ループ",
    zh: "循环",
  },
  "verdictTris": {
    en: "tris",
    ja: "三角形",
    zh: "三角面",
  },
  "verdictFaces": {
    en: "faces",
    ja: "面",
    zh: "个面",
  },
  "analysisTabs": {
    en: "Analysis views",
    ja: "分析ビュー",
    zh: "分析视图",
  },
  "geometry": {
    en: "GEOMETRY",
    ja: "ジオメトリ",
    zh: "几何",
  },
  "report": {
    en: "REPORT",
    ja: "レポート",
    zh: "报告",
  },
  "chatAI": {
    en: "CHAT AI",
    ja: "チャットAI",
    zh: "AI 聊天",
  },
  "agents": {
    en: "AGENTS",
    ja: "エージェント",
    zh: "智能体",
  },
  "toolbarHeatmap": {
    en: "Heatmap",
    ja: "ヒートマップ",
    zh: "热力图",
  },
  "toolbarSupports": {
    en: "Supports",
    ja: "サポート",
    zh: "支撑",
  },
  "toolbarRisks": {
    en: "Risks",
    ja: "リスク",
    zh: "风险",
  },
  "toolbarPrintPath": {
    en: "Print Path",
    ja: "プリントパス",
    zh: "打印路径",
  },
  "toolbarLayerReveal": {
    en: "Layer Reveal",
    ja: "レイヤー表示",
    zh: "图层显示",
  },
  "toolbarFailure": {
    en: "Failure",
    ja: "故障予測",
    zh: "故障预测",
  },
  "toolbarThermal": {
    en: "Thermal",
    ja: "熱分布",
    zh: "热分布",
  },
  "toolbarWallThickness": {
    en: "Wall Thickness",
    ja: "肉厚分布",
    zh: "壁厚分布",
  },
  "tbOverhangThreshold": {
    en: "Overhang threshold",
    ja: "オーバーハング角",
    zh: "悬垂角",
  },
  "tbCurvatureWeight": {
    en: "Curvature weight",
    ja: "曲率の重み",
    zh: "曲率权重",
  },
  "tbThicknessWeight": {
    en: "Thickness weight",
    ja: "肉厚の重み",
    zh: "壁厚权重",
  },
  "tbBridgeDetection": {
    en: "Bridge detection",
    ja: "ブリッジ検出",
    zh: "桥接检测",
  },
  "tbMaxAngle": {
    en: "Max angle",
    ja: "最大角度",
    zh: "最大角度",
  },
  "tbDensity": {
    en: "Density",
    ja: "密度",
    zh: "密度",
  },
  "tbSensitivity": {
    en: "Sensitivity",
    ja: "感度",
    zh: "灵敏度",
  },
  "tbMinSeverity": {
    en: "Min severity",
    ja: "最小深刻度",
    zh: "最低严重度",
  },
  "overlaysMore": {
    en: "More overlays",
    ja: "その他のオーバーレイ",
    zh: "更多叠加层",
  },
  "tbMinThickness": {
    en: "Min thickness",
    ja: "最小肉厚",
    zh: "最小壁厚",
  },
  "tbMaxThickness": {
    en: "Max thickness",
    ja: "最大肉厚",
    zh: "最大壁厚",
  },
  "tbShowThinOnly": {
    en: "Thin only",
    ja: "薄い部分のみ",
    zh: "仅显示偏薄",
  },
  "legendTitle": {
    en: "Legend",
    ja: "凡例",
    zh: "图例说明",
  },
  "legendHeatHigh": {
    en: "High risk — optimise",
    ja: "高リスク — 要最適化",
    zh: "高风险 — 需要优化",
  },
  "legendHeatMid": {
    en: "Medium — check",
    ja: "中リスク — 要確認",
    zh: "中风险 — 建议检查",
  },
  "legendHeatSafe": {
    en: "Safe — no action",
    ja: "安全 — 対応不要",
    zh: "安全 — 无需处理",
  },
  "legendOverhangFace": {
    en: "Overhang face — needs support",
    ja: "オーバーハング面 — サポート必要",
    zh: "悬垂面 — 需要支撑",
  },
  "legendBridge": {
    en: "Bridge — support from above",
    ja: "ブリッジ — 上部にサポート",
    zh: "桥接 — 顶部需支撑",
  },
  "legendRiskHigh": {
    en: "High — may fail",
    ja: "高 — 失敗の恐れ",
    zh: "高风险 — 可能失败",
  },
  "legendRiskMid": {
    en: "Medium — watch",
    ja: "中 — 要注意",
    zh: "中风险 — 需注意",
  },
  "legendRiskLow": {
    en: "Low — cosmetic",
    ja: "低 — 軽微",
    zh: "低风险 — 轻微",
  },
  "legendWallTooThin": {
    en: "Too thin — will crack",
    ja: "薄すぎ — 破損しやすい",
    zh: "太薄 — 容易破裂",
  },
  "legendWallThin": {
    en: "Thin — watch",
    ja: "薄い — 要注意",
    zh: "偏薄 — 需要注意",
  },
  "legendWallOk": {
    en: "Nominal",
    ja: "適正",
    zh: "适中",
  },
  "legendWallThick": {
    en: "Thick — safe",
    ja: "厚い — 安全",
    zh: "较厚 — 安全",
  },
  "toolbarLightMode": {
    en: "Light Mode",
    ja: "ライトモード",
    zh: "浅色模式",
  },
  "toolbarDarkMode": {
    en: "Dark Mode",
    ja: "ダークモード",
    zh: "深色模式",
  },
  "geometryDataLabel": {
    en: "GEOMETRY DATA",
    ja: "ジオメトリデータ",
    zh: "几何数据",
  },
  "generateReport": {
    en: "GENERATE REPORT →",
    ja: "レポート生成 →",
    zh: "生成报告 →",
  },
  "analyze": {
    en: "ANALYZING...",
    ja: "分析中...",
    zh: "分析中...",
  },
  "generateQuickReport": {
    en: "⚡ GENERATE QUICK REPORT (FREE)",
    ja: "⚡ クイックレポート生成 (無料)",
    zh: "⚡ 生成快速报告 (免费)",
  },
  "analysisReport": {
    en: "ANALYSIS REPORT",
    ja: "分析レポート",
    zh: "分析报告",
  },
  "localEngine": {
    en: "[LOCAL ENGINE]",
    ja: "[ローカルエンジン]",
    zh: "[本地引擎]",
  },
  "regenerate": {
    en: "↺ REGENERATE",
    ja: "↺ 再生成",
    zh: "↺ 重新生成",
  },
  "deepAnalysis": {
    en: "DEEP AI ANALYSIS",
    ja: "深層AI分析",
    zh: "深度AI分析",
  },
  "deepAnalysisDesc": {
    en: "Full AI report with Claude / GPT-4o / Gemini",
    ja: "Claude / GPT-4o / Gemini による完全なAIレポート",
    zh: "完整的 Claude / GPT-4o / Gemini AI 报告",
  },
  "deepAnalysisRun": {
    en: "RUN AI SECOND OPINION",
    ja: "AIセカンドオピニオンを実行",
    zh: "运行 AI 第二意见",
  },
  "deepAnalysisAdvisory": {
    en: "Advisory only — deterministic mesh results remain authoritative.",
    ja: "参考情報です。決定論的なメッシュ解析結果が優先されます。",
    zh: "仅供参考；确定性网格分析结果始终优先。",
  },
  "deepAnalysisScore": {
    en: "AI SECOND-OPINION SCORE",
    ja: "AIセカンドオピニオン・スコア",
    zh: "AI 第二意见评分",
  },
  "scoreComparison": {
    en: "WHY TWO SCORES?",
    ja: "なぜ2つのスコアがあるのか",
    zh: "为什么有两个评分？",
  },
  "scoreComparisonDesc": {
    en: "The deterministic score uses a weighted rubric (wall thickness 35%, overhang 25%, aspect ratio 15%, volume 10%, feature detail 15%). The AI score is an independent LLM opinion — it may differ because it uses different reasoning. Neither is \"wrong\"; they reflect different analysis methods.",
    ja: "決定論スコアは加重ルーブリック（壁厚35%、オーバーハング25%、アスペクト比15%、体積10%、ディテール15%）を使用します。AIスコアは独立したLLM見解で、異なる推論を行うため結果が異なる場合があります。どちらも「間違い」ではなく、異なる分析方法を反映しています。",
    zh: "确定性评分使用加权评分标准（壁厚35%、悬垂25%、长宽比15%、体积10%、特征细节15%）。AI评分是独立的LLM意见，由于推理方式不同，结果可能有差异。两者都不是\"错误\"，而是反映了不同的分析方法。",
  },
  "lowConfidenceBanner": {
    en: "Low measurement confidence — this verdict is advisory only.",
    ja: "測定の信頼性が低いため、この判定は参考情報です。",
    zh: "本次测量置信度低，结论仅供参考。",
  },
  "deepAnalysisStep": {
    en: "Step {n}/5",
    ja: "ステップ {n}/5",
    zh: "步骤 {n}/5",
  },
  "deepAnalysisError": {
    en: "AI second opinion failed (timeout or no active provider). Try again.",
    ja: "AIセカンドオピニオンに失敗しました（タイムアウトまたは利用可能なプロバイダーがありません）。もう一度お試しください。",
    zh: "AI 第二意见失败（超时或没有可用的 AI 提供方）。请重试。",
  },
  "expertReview": {
    en: "AI EXPERT REVIEW",
    ja: "AI専門家レビュー",
    zh: "AI 专家解读",
  },
  "expertReviewRun": {
    en: "RUN EXPERT REVIEW",
    ja: "専門家レビューを実行",
    zh: "运行专家解读",
  },
  "expertReviewDesc": {
    en: "A material-specialist AI explains your report in plain language",
    ja: "材料専門家のAIがレポートをわかりやすく説明します",
    zh: "材料领域专家 AI 用大白话解释你的报告",
  },
  "expertReviewLoading": {
    en: "EXPERT REVIEWING...",
    ja: "専門家がレビュー中...",
    zh: "专家解读中...",
  },
  "expertReviewPlain": {
    en: "PLAIN-LANGUAGE SUMMARY",
    ja: "わかりやすい要約",
    zh: "大白话总结",
  },
  "expertReviewFindings": {
    en: "WHAT THE EXPERT SEES",
    ja: "専門家が指摘する問題",
    zh: "专家看到的问题",
  },
  "expertReviewActions": {
    en: "WHAT TO DO NEXT",
    ja: "次にやるべきこと",
    zh: "接下来怎么做",
  },
  "expertReviewAdvisory": {
    en: "Expert opinion only — deterministic mesh results remain authoritative.",
    ja: "専門家の意見です — 確定したメッシュ解析結果が正です。",
    zh: "专家意见仅供参考 — 确定的网格解析结果为准。",
  },
  "expertReviewError": {
    en: "Expert review failed (timeout or no active provider). Try again.",
    ja: "専門家レビューに失敗しました（タイムアウトまたは利用可能なプロバイダーがありません）。もう一度お試しください。",
    zh: "专家解读失败（超时或没有可用的 AI 提供方）。请重试。",
  },
  "signInToExpertReview": {
    en: "SIGN IN TO RUN EXPERT REVIEW",
    ja: "サインインして専門家レビューを実行",
    zh: "登录后运行专家解读",
  },
  "modeAnalyze": {
    en: "ANALYZE",
    ja: "分析",
    zh: "分析",
  },
  "loading3d": {
    en: "LOADING...",
    ja: "読み込み中...",
    zh: "加载中...",
  },
  "recalculating": {
    en: "RECALCULATING...",
    ja: "再計算中...",
    zh: "重新计算中...",
  },
  "meshDiagnostics": {
    en: "MESH DIAGNOSTICS",
    ja: "メッシュ診断",
    zh: "网格诊断",
  },
  "resinPrintability": {
    en: "RESIN PRINTABILITY",
    ja: "レジン印刷適性",
    zh: "树脂打印性",
  },
  "resinShells": {
    en: "Shells",
    ja: "シェル",
    zh: "壳体",
  },
  "resinEnclosedCavity": {
    en: "Enclosed cavity",
    ja: "密閉空洞",
    zh: "封闭空腔",
  },
  "resinIslands": {
    en: "Floating islands",
    ja: "浮遊アイランド",
    zh: "悬浮孤岛",
  },
  "resinSuction": {
    en: "Suction risk",
    ja: "吸引力リスク",
    zh: "吸力风险",
  },
  "resinOverCure": {
    en: "Over-cure risk",
    ja: "過硬化リスク",
    zh: "过固化风险",
  },
  "orientation": {
    en: "Orientation",
    ja: "方向",
    zh: "方向",
  },
  "footprint": {
    en: "Footprint",
    ja: "フットプリント",
    zh: "底面投影",
  },
  "fgfLargeFormat": {
    en: "FGF LARGE-FORMAT",
    ja: "FGF 大判",
    zh: "FGF 大尺寸",
  },
  "fgfPartScale": {
    en: "Part scale",
    ja: "パーツ規模",
    zh: "零件规模",
  },
  "fgfMaxDim": {
    en: "Max dimension",
    ja: "最大寸法",
    zh: "最大尺寸",
  },
  "fgfWarpage": {
    en: "Warpage risk",
    ja: "反りリスク",
    zh: "翘曲风险",
  },
  "fgfDelamination": {
    en: "Delamination risk",
    ja: "層間剥離リスク",
    zh: "分层风险",
  },
  "fgfSlenderness": {
    en: "Slenderness",
    ja: "細長比",
    zh: "细长比",
  },
  "pbfLabel": {
    en: "POWDER BED FUSION",
    ja: "粉末床溶融",
    zh: "粉末床融合",
  },
  "pbfGeometricProxy": {
    en: "geometric proxies — not thermal simulation",
    ja: "幾何学的プロキシ — 熱解析ではありません",
    zh: "几何代理指标 — 非热力学仿真",
  },
  "pbfPowderTrap": {
    en: "Powder trap",
    ja: "粉末トラップ",
    zh: "粉末陷阱",
  },
  "pbfPowderTrapValue": {
    en: "⚠ enclosed cavity — needs escape holes",
    ja: "⚠ 密閉空洞 — 排粉穴が必要",
    zh: "⚠ 封闭空腔 — 需排粉孔",
  },
  "pbfLargestFlatPlate": {
    en: "Largest flat plate",
    ja: "最大水平面",
    zh: "最大水平面",
  },
  "pbfOverhangRatio": {
    en: "Overhang ratio",
    ja: "オーバーハング率",
    zh: "悬垂比例",
  },
  "pbfSupport": {
    en: "Support",
    ja: "サポート",
    zh: "支撑",
  },
  "pbfSelfSupporting": {
    en: "self-supporting (powder)",
    ja: "自己支持（粉末）",
    zh: "自支撑（粉末）",
  },
  "pbfSupportsRequired": {
    en: "supports required",
    ja: "サポート必須",
    zh: "需加支撑",
  },
  "pbfDistortion": {
    en: "Distortion risk",
    ja: "変形リスク",
    zh: "变形风险",
  },
  "none": {
    en: "none",
    ja: "なし",
    zh: "无",
  },
  "objectTitle": {
    en: "OBJECT",
    ja: "用途",
    zh: "用途",
  },
  "objectRisk": {
    en: "Risk",
    ja: "リスク",
    zh: "风险",
  },
  "objectGeneral": {
    en: "General",
    ja: "一般",
    zh: "通用",
  },
  "objectStructural": {
    en: "Furniture · Structural",
    ja: "家具 · 構造",
    zh: "家具 · 结构",
  },
  "objectLarge": {
    en: "Large · Construction",
    ja: "大型 · 建設",
    zh: "大型 · 建筑",
  },
  "objectDetailed": {
    en: "Fine · Jewelry/Dental",
    ja: "精密 · 宝飾/歯科",
    zh: "精细 · 珠宝/牙科",
  },
  "consensusScore": {
    en: "CONSENSUS SCORE",
    ja: "合意スコア",
    zh: "共识评分",
  },
  "consensusWeightedNote": {
    en: "weighted quality score — not the report gate",
    ja: "加重品質スコア — レポートのゲートとは別",
    zh: "加权质量分 — 与报告闸门分不同",
  },
  "multiAgentRunning": {
    en: "MULTI-AGENT ANALYSIS RUNNING",
    ja: "マルチエージェント解析中",
    zh: "多智能体分析运行中",
  },
  "deepAgentLlm": {
    en: "Deep Agent · LLM",
    ja: "ディープエージェント · LLM",
    zh: "深度智能体 · LLM",
  },
  "deterministicEngine": {
    en: "Deterministic Engine",
    ja: "決定論エンジン",
    zh: "确定性引擎",
  },
  "visionUsed": {
    en: "Vision",
    ja: "ビジョン",
    zh: "视觉",
  },
  "strongAgreement": {
    en: "Strong agreement",
    ja: "強い一致",
    zh: "高度一致",
  },
  "moderateAgreement": {
    en: "Moderate agreement",
    ja: "中程度の一致",
    zh: "中度一致",
  },
  "verdictPass": {
    en: "PASS",
    ja: "合格",
    zh: "通过",
  },
  "verdictWarning": {
    en: "WARNING",
    ja: "警告",
    zh: "警告",
  },
  "verdictFail": {
    en: "FAIL",
    ja: "不合格",
    zh: "失败",
  },
  "overlays": {
    en: "OVERLAYS",
    ja: "オーバーレイ",
    zh: "叠加层",
  },
  "minAbs": {
    en: "Min (abs)",
    ja: "最小（絶対）",
    zh: "最小（绝对）",
  },
  "objectLiquidCooling": {
    en: "Liquid Cooling · Heat Exchanger",
    ja: "液冷 · 熱交換器",
    zh: "液冷 · 换热器",
  },
  "lcTitle": {
    en: "LIQUID COOLING",
    ja: "液冷",
    zh: "液冷",
  },
  "lcLeak": {
    en: "Leak risk",
    ja: "漏れリスク",
    zh: "泄漏风险",
  },
  "lcChannel": {
    en: "Channel risk",
    ja: "流路リスク",
    zh: "通道风险",
  },
  "lcHeatExchange": {
    en: "Heat exchange",
    ja: "熱交換効率",
    zh: "散热效率",
  },
  "lcPressureWall": {
    en: "Pressure wall",
    ja: "耐圧壁",
    zh: "承压壁",
  },
  "lcOverallRisk": {
    en: "Cooling risk",
    ja: "冷却リスク",
    zh: "液冷风险",
  },
  "expertFeedback": {
    en: "Was this helpful?",
    ja: "参考になりましたか?",
    zh: "这条解读有用吗?",
  },
  "expertFeedbackThanks": {
    en: "Thanks — this helps us improve.",
    ja: "ご協力ありがとうございます。品質向上に役立てます。",
    zh: "谢谢 — 这有助于我们改进。",
  },
  "batchReport": {
    en: "BATCH OVERVIEW",
    ja: "バッチ概要",
    zh: "批量总览",
  },
  "batchPart": {
    en: "PART",
    ja: "パーツ",
    zh: "零件",
  },
  "batchVerdict": {
    en: "VERDICT",
    ja: "判定",
    zh: "判定",
  },
  "batchScore": {
    en: "SCORE",
    ja: "スコア",
    zh: "分数",
  },
  "batchConcern": {
    en: "TOP CONCERN",
    ja: "主な懸念",
    zh: "最要紧的问题",
  },
  "batchNotWatertight": {
    en: "not watertight",
    ja: "水密でない",
    zh: "不密封",
  },
  "batchThinWalls": {
    en: "thin walls",
    ja: "薄壁",
    zh: "薄壁",
  },
  "batchOverhang": {
    en: "overhangs need support",
    ja: "オーバーハングに要サポート",
    zh: "悬垂需支撑",
  },
  "batchSupport": {
    en: "support risk",
    ja: "サポートリスク",
    zh: "支撑风险",
  },
  "concreteTitle": {
    en: "CONCRETE",
    ja: "コンクリート",
    zh: "混凝土",
  },
  "concreteProxy": {
    en: "geometric proxies — not structural engineering",
    ja: "幾何学的プロキシ — 構造解析ではありません",
    zh: "几何代理指标 — 非结构工程",
  },
  "concreteFeature": {
    en: "Feature resolution",
    ja: "解像度",
    zh: "特征分辨率",
  },
  "concreteOverhang": {
    en: "Overhang sag",
    ja: "オーバーハング垂下",
    zh: "悬垂下坠",
  },
  "concreteCrack": {
    en: "Drying cracks",
    ja: "乾燥ひび割れ",
    zh: "干燥开裂",
  },
  "concreteTime": {
    en: "Print time",
    ja: "印刷時間",
    zh: "打印时间",
  },
  "ecoTitle": {
    en: "ECO",
    ja: "エコ",
    zh: "环保",
  },
  "ecoProxy": {
    en: "material advisory — properties + thin-wall geometry",
    ja: "材料アドバイザリ — 特性＋薄壁幾何",
    zh: "材料提示 — 特性 + 薄壁几何",
  },
  "ecoMoisture": {
    en: "Moisture sensitivity",
    ja: "吸湿性",
    zh: "吸湿性",
  },
  "ecoDegradation": {
    en: "Heat/UV degradation",
    ja: "熱・UV劣化",
    zh: "热/UV 降解",
  },
  "ecoBrittleness": {
    en: "Brittleness",
    ja: "脆性",
    zh: "脆性",
  },
  "prodTitle": {
    en: "PRODUCTION SUITABILITY",
    ja: "量産適合性",
    zh: "量产适性",
  },
  "prodPerBatch": {
    en: "Parts per build",
    ja: "1ビルドあたり部品数",
    zh: "每炉件数",
  },
  "prodPerPartCost": {
    en: "Per-part cost",
    ja: "単品コスト",
    zh: "单件成本",
  },
  "prodProduction": {
    en: "Production-ready",
    ja: "量産向き",
    zh: "适合量产",
  },
  "prodSmallBatch": {
    en: "Small-batch",
    ja: "小ロット向き",
    zh: "适合小批量",
  },
  "prodPrototype": {
    en: "Prototype only",
    ja: "試作向き",
    zh: "仅适合原型",
  },
  "prodAdvisory": {
    en: "Directional estimate — not a manufacturing quote.",
    ja: "方向性の推定 — 製造見積りではありません。",
    zh: "方向性估算 — 不是制造报价。",
  },
  "privacyTitle": {
    en: "PRIVACY",
    ja: "プライバシー",
    zh: "隐私",
  },
  "privacyLocal": {
    en: "Your uploaded models are analyzed in your browser (web workers) — they are never uploaded to our servers.",
    ja: "アップロードしたモデルはブラウザ内（Web Worker）で解析され、当社サーバーにはアップロードされません。",
    zh: "你上传的模型在浏览器内（Web Worker）分析，不会上传到我们的服务器。",
  },
  "privacyAnalytics": {
    en: "Anonymous usage analytics (Vercel Analytics) — page views and feature use, used to improve the product.",
    ja: "匿名の利用分析（Vercel Analytics）— ページビューと機能利用状況を製品改善に使用します。",
    zh: "匿名使用分析（Vercel Analytics）— 页面浏览与功能使用，用于改进产品。",
  },
  "privacyTraces": {
    en: "When you run AI analysis (deep analysis / expert review) and rate it, the request and your rating are logged to improve our models — only where the self-hosted bridge is enabled.",
    ja: "AI解析（ディープ分析／専門家レビュー）とその評価は、モデル改善のため記録されます — 自己ホストのブリッジが有効な場合のみ。",
    zh: "运行 AI 分析（深度分析/专家解读）并评分时，请求与你的评分会被记录用于改进模型 — 仅在自托管桥接启用时。",
  },
  "privacyNoSale": {
    en: "We never sell your data or your uploaded models.",
    ja: "お客様のデータやアップロードしたモデルを販売することはありません。",
    zh: "我们绝不会出售你的数据或上传的模型。",
  },
  "modelsLoaded": {
    en: "Loaded {n} models",
    ja: "{n} 件のモデルを読み込みました",
    zh: "已加载 {n} 个模型",
  },
  "modelsPartial": {
    en: "Loaded {a} of {b} models — some failed",
    ja: "{a} / {b} 件を読み込みました — 一部失敗",
    zh: "已加载 {a}/{b} 个模型 — 部分失败",
  },
  "chatNeedsModel": {
    en: "upload a model to chat about it",
    ja: "モデルをアップロードするとチャットできます",
    zh: "上传模型后即可对话",
  },
  "diagTitle": {
    en: "FAILED PRINT DIAGNOSIS",
    ja: "失敗プリント診断",
    zh: "失败打印诊断",
  },
  "diagDesc": {
    en: "Upload a photo of a failed print — AI identifies the likely cause and how to fix it",
    ja: "失敗したプリントの写真をアップロード — AIが原因と修正方法を特定します",
    zh: "上传失败打印件的照片 — AI 识别可能原因与修复方法",
  },
  "diagUpload": {
    en: "UPLOAD FAILED PRINT PHOTO",
    ja: "失敗プリントの写真をアップロード",
    zh: "上传失败打印照片",
  },
  "diagAnalyzing": {
    en: "DIAGNOSING...",
    ja: "診断中...",
    zh: "诊断中...",
  },
  "diagCauses": {
    en: "Likely causes",
    ja: "考えられる原因",
    zh: "可能的原因",
  },
  "diagFixes": {
    en: "How to fix",
    ja: "修正方法",
    zh: "怎么修复",
  },
  "diagProbability": {
    en: "Likelihood",
    ja: "可能性",
    zh: "可能性",
  },
  "diagConfidence": {
    en: "Confidence",
    ja: "確信度",
    zh: "置信度",
  },
  "diagError": {
    en: "Diagnosis failed (sign in, or try again).",
    ja: "診断に失敗しました（サインインするか、再試行してください）。",
    zh: "诊断失败（请登录或重试）。",
  },
  "diagSignIn": {
    en: "SIGN IN TO DIAGNOSE",
    ja: "サインインして診断",
    zh: "登录后诊断",
  },
  "diagAdvisory": {
    en: "Photo-based diagnosis — surface symptoms only, not guaranteed.",
    ja: "写真ベースの診断 — 表面の症状のみ、保証はありません。",
    zh: "基于照片的诊断 — 仅表面症状，不保证。",
  },
  "diagErrorAuth": {
    en: "Please sign in to diagnose.",
    ja: "診断にはサインインが必要です。",
    zh: "请登录后诊断。",
  },
  "diagErrorConfig": {
    en: "Diagnosis is temporarily unavailable (server AI key not configured).",
    ja: "診断は一時的に利用できません（サーバーのAIキー未設定）。",
    zh: "诊断暂时不可用（服务器 AI key 未配置）。",
  },
  "diagErrorQuota": {
    en: "Monthly AI quota reached — try again later.",
    ja: "月間AIクォータに達しました — 後でお試しください。",
    zh: "本月 AI 额度已用完 — 请稍后再试。",
  },
  "diagErrorTimeout": {
    en: "Diagnosis timed out — the photo may be too complex. Try again.",
    ja: "診断がタイムアウトしました — 写真が複雑すぎる可能性があります。再試行してください。",
    zh: "诊断超时 — 照片可能太复杂。请重试。",
  },
  "diagErrorParse": {
    en: "The AI returned an unreadable result — please try again.",
    ja: "AIが解釈できない結果を返しました — もう一度お試しください。",
    zh: "AI 返回了无法解析的结果 — 请重试。",
  },
  "diagAlternatives": {
    en: "RULED OUT ALTERNATIVES",
    ja: "除外した代替案",
    zh: "排除的备择",
  },
  "diagIsFailure": {
    en: "Failure occurred",
    ja: "失敗の可能性",
    zh: "是否失败",
  },
  "diagModeConfidence": {
    en: "Mode confidence",
    ja: "モード確信度",
    zh: "模式置信度",
  },
  "diagWarping": {
    en: "Warping",
    ja: "反り",
    zh: "翘曲",
  },
  "diagLayerShift": {
    en: "Layer shift",
    ja: "レイヤーずれ",
    zh: "层移",
  },
  "diagUnderExtrusion": {
    en: "Under-extrusion",
    ja: "過少押出",
    zh: "挤出不足",
  },
  "diagOverExtrusion": {
    en: "Over-extrusion",
    ja: "過多押出",
    zh: "挤出过多",
  },
  "diagStringing": {
    en: "Stringing",
    ja: "糸引き",
    zh: "拉丝",
  },
  "diagBedAdhesion": {
    en: "Bed adhesion failure",
    ja: "ベッド密着不良",
    zh: "床附着失败",
  },
  "diagElephantFoot": {
    en: "Elephant foot",
    ja: "エレファントフット",
    zh: "大象脚",
  },
  "diagZBanding": {
    en: "Z-banding",
    ja: "Zバンディング",
    zh: "Z 轴纹",
  },
  "diagDelamination": {
    en: "Delamination",
    ja: "層間剥離",
    zh: "分层",
  },
  "diagOverhangSagging": {
    en: "Overhang sagging",
    ja: "オーバーハング垂れ",
    zh: "悬垂下坠",
  },
  "diagCloggedNozzle": {
    en: "Clogged nozzle",
    ja: "ノズル詰まり",
    zh: "喷嘴堵塞",
  },
  "diagFirstLayer": {
    en: "First-layer failure",
    ja: "初層不良",
    zh: "首层失败",
  },
  "configureApiKey": {
    en: "CONFIGURE API KEY →",
    ja: "API キーを設定 →",
    zh: "配置 API 密钥 →",
  },
  "switchToChat": {
    en: "SWITCH TO CHAT →",
    ja: "チャットに切り替え →",
    zh: "切换到聊天 →",
  },
  "uploadStlBegin": {
    en: "Upload STL to begin",
    ja: "STLをアップロードして開始",
    zh: "上传 STL 开始",
  },
  "analyzeRepair": {
    en: "REPAIR & PROCESS",
    ja: "修復と処理",
    zh: "修复并处理",
  },
  "featureFree": {
    en: "FREE",
    ja: "無料",
    zh: "免费",
  },
  "featureAiKey": {
    en: "AI KEY",
    ja: "AIキー",
    zh: "AI密钥",
  },
  "feature1": {
    en: "Geometry analysis — wall, overhang, dims",
    ja: "ジオメトリ分析 — 壁厚、オーバーハング、寸法",
    zh: "几何分析 — 壁厚、悬垂、尺寸",
  },
  "feature2": {
    en: "Quick report — material, settings, time estimate",
    ja: "クイックレポート — 材料、設定、時間予測",
    zh: "快速报告 — 材料、设置、时间估算",
  },
  "feature3": {
    en: "Common Q&A — instant local answers",
    ja: "よくある質問 — インスタント回答",
    zh: "常见问题 — 即时本地回答",
  },
  "feature4": {
    en: "Deep chat — Claude / GPT-4o / Gemini",
    ja: "ディープチャット — Claude / GPT-4o / Gemini",
    zh: "深度聊天 — Claude / GPT-4o / Gemini",
  },
  "feature5": {
    en: "Complex design optimization advice",
    ja: "複雑な設計最適化アドバイス",
    zh: "复杂设计优化建议",
  },
  "featuresIncludedTitle": {
    en: "INCLUDED — RUNS LOCALLY",
    ja: "含まれる — ローカルで実行",
    zh: "已包含 — 本地运行",
  },
  "featuresAiTitle": {
    en: "AI FEATURES — SIGN IN",
    ja: "AI機能 — サインイン",
    zh: "AI 功能 — 登录",
  },
  "featuresGeometryTitle": {
    en: "Geometry analysis",
    ja: "ジオメトリ分析",
    zh: "几何分析",
  },
  "featuresGeometryDesc": {
    en: "wall thickness, overhang, dims",
    ja: "壁厚、オーバーハング、寸法",
    zh: "壁厚、悬垂、尺寸",
  },
  "featuresReportTitle": {
    en: "Quick report",
    ja: "クイックレポート",
    zh: "快速报告",
  },
  "featuresReportDesc": {
    en: "material, settings, time estimate",
    ja: "材料、設定、時間予測",
    zh: "材料、设置、时间估算",
  },
  "featuresQaTitle": {
    en: "Common Q&A",
    ja: "よくある質問",
    zh: "常见问答",
  },
  "featuresQaDesc": {
    en: "instant local answers",
    ja: "インスタントなローカル回答",
    zh: "即时本地回答",
  },
  "featuresChatTitle": {
    en: "Deep chat",
    ja: "ディープチャット",
    zh: "深度聊天",
  },
  "featuresChatDesc": {
    en: "bring your own AI provider",
    ja: "AIプロバイダーを持ち込む",
    zh: "自带 AI 提供商",
  },
  "featuresOptimizeTitle": {
    en: "Design optimization",
    ja: "設計最適化",
    zh: "设计优化",
  },
  "featuresOptimizeDesc": {
    en: "complex design optimization advice",
    ja: "複雑な設計最適化アドバイス",
    zh: "复杂设计优化建议",
  },
  "featuresDiagnoseTitle": {
    en: "Failed print diagnosis",
    ja: "失敗プリント診断",
    zh: "失败打印诊断",
  },
  "featuresDiagnoseDesc": {
    en: "photo-based — AI identifies why it failed",
    ja: "写真ベース — AIが失敗原因を特定",
    zh: "基于照片 — AI 识别失败原因",
  },
  "featuresOfficeTitle": {
    en: "Live Floor",
    ja: "Live Floor",
    zh: "Live Floor",
  },
  "featuresOfficeSubtitle": {
    en: "Agent Office · Live monitoring",
    ja: "Agent Office · リアルタイム監視",
    zh: "Agent Office · 实时监工",
  },
  "featuresOfficeDesc": {
    en: "Live 3D view — watch the agents walk, print and talk in the office.",
    ja: "リアルタイム3Dビュー — エージェントの移動・造形・会話をそのまま覗けます。",
    zh: "实时 3D 视角：看每位 Agent 在办公室里走动、打印、对话。",
  },
  "officeFullscreen": {
    en: "FULLSCREEN",
    ja: "全画面",
    zh: "全屏进入",
  },
  "officeStatusLive": {
    en: "LIVE",
    ja: "LIVE",
    zh: "LIVE",
  },
  "officeStatusChecking": {
    en: "CONNECTING…",
    ja: "接続中…",
    zh: "连接中…",
  },
  "officeOfflineTitle": {
    en: "OFFICE SERVICE OFFLINE",
    ja: "オフィスサービス未起動",
    zh: "办公室服务未连接",
  },
  "officeOfflineDesc": {
    en: "The live office is served by the local console service. Start it with the command below, then retry.",
    ja: "ライブオフィスはローカルコンソールサービスが配信します。下のコマンドで起動してから再試行してください。",
    zh: "实时办公室由本地控制台服务提供。按下方命令启动后重试即可。",
  },
  "officeRetry": {
    en: "RETRY",
    ja: "再試行",
    zh: "重试",
  },
  "officeExit": {
    en: "EXIT · ESC",
    ja: "終了 · ESC",
    zh: "退出 · ESC",
  },
  "cadStudio": {
    en: "CAD",
    ja: "CAD",
    zh: "CAD",
  },
  "cadDescribePlaceholder": {
    en: "Describe your object...",
    ja: "オブジェクトを説明してください...",
    zh: "描述你的对象...",
  },
  "cadGenerate": {
    en: "GENERATE",
    ja: "生成",
    zh: "生成",
  },
  "cadCancel": {
    en: "CANCEL",
    ja: "キャンセル",
    zh: "取消",
  },
  "cadNewDesign": {
    en: "New Design",
    ja: "新規デザイン",
    zh: "新建设计",
  },
  "cadDownloadStl": {
    en: "Download STL",
    ja: "STLをダウンロード",
    zh: "下载 STL",
  },
  "cadDownloadStep": {
    en: "Download STEP",
    ja: "STEPをダウンロード",
    zh: "下载 STEP",
  },
  "cadDesignStarters": {
    en: "DESIGN STARTERS",
    ja: "デザインスターター",
    zh: "设计起点",
  },
  "cadRecentDesigns": {
    en: "RECENT DESIGNS",
    ja: "最近のデザイン",
    zh: "最近的设计",
  },
  "cadImproveDesign": {
    en: "IMPROVE DESIGN",
    ja: "デザインを改善",
    zh: "改进设计",
  },
  "cadReset": {
    en: "RESET",
    ja: "リセット",
    zh: "重置",
  },
  "cadGenerating": {
    en: "GENERATING",
    ja: "生成中",
    zh: "生成中",
  },
  "cadTotal": {
    en: "Total",
    ja: "合計",
    zh: "总计",
  },
  "cadStageBridge": {
    en: "Connect to CAD bridge",
    ja: "CADブリッジに接続",
    zh: "连接 CAD 桥",
  },
  "cadStageLlm": {
    en: "Generate CAD (build123d / LLM)",
    ja: "CADを生成（build123d / LLM）",
    zh: "生成 CAD（build123d / LLM）",
  },
  "cadStageParse": {
    en: "Parse STL mesh",
    ja: "STLメッシュを解析",
    zh: "解析 STL 网格",
  },
  "cadStageAnalysis": {
    en: "Run analysis pipeline",
    ja: "分析パイプラインを実行",
    zh: "运行分析管线",
  },
  "cadTabCad": {
    en: "CAD",
    ja: "CAD",
    zh: "CAD",
  },
  "cadTabAnalysis": {
    en: "ANALYSIS",
    ja: "分析",
    zh: "分析",
  },
  "cadMfgConfidence": {
    en: "MANUFACTURING CONFIDENCE",
    ja: "製造信頼度",
    zh: "制造置信度",
  },
  "cadTemplate": {
    en: "TEMPLATE",
    ja: "テンプレート",
    zh: "模板",
  },
  "cadAiGenerated": {
    en: "AI GENERATED",
    ja: "AI生成",
    zh: "AI 生成",
  },
  "cadAutoRepair": {
    en: "AUTO REPAIR",
    ja: "自動修復",
    zh: "自动修复",
  },
  "cadAutoRepairNotNeeded": {
    en: "AUTO REPAIR · NOT NEEDED",
    ja: "自動修復・不要",
    zh: "自动修复 · 不需要",
  },
  "cadPrintCheck": {
    en: "PRINT CHECK",
    ja: "印刷チェック",
    zh: "打印检查",
  },
  "cadBedFit": {
    en: "Bed fit",
    ja: "ベッド適合",
    zh: "平台适配",
  },
  "cadMaterial": {
    en: "Material",
    ja: "材料",
    zh: "材料",
  },
  "cadSupport": {
    en: "Support",
    ja: "サポート",
    zh: "支撑",
  },
  "cadPrintTime": {
    en: "Print time",
    ja: "印刷時間",
    zh: "打印时间",
  },
  "cadMaterialWt": {
    en: "Material wt",
    ja: "材料重量",
    zh: "材料重量",
  },
  "cadCost": {
    en: "Cost",
    ja: "コスト",
    zh: "成本",
  },
  "cadKeyIssues": {
    en: "KEY ISSUES",
    ja: "主な問題",
    zh: "关键问题",
  },
  "cadOptimizationPlan": {
    en: "AI OPTIMIZATION PLAN",
    ja: "AI最適化プラン",
    zh: "AI 优化方案",
  },
  "cadDetected": {
    en: "Detected:",
    ja: "検出:",
    zh: "检测到:",
  },
  "cadAction": {
    en: "Action:",
    ja: "アクション:",
    zh: "操作:",
  },
  "cadThickenWalls": {
    en: "Thicken walls",
    ja: "壁を厚く",
    zh: "加厚壁",
  },
  "cadRotateOrientation": {
    en: "Rotate orientation",
    ja: "向きを回転",
    zh: "旋转方向",
  },
  "cadNoAction": {
    en: "No action needed",
    ja: "対応不要",
    zh: "无需操作",
  },
  "cadDesignEvolution": {
    en: "DESIGN EVOLUTION",
    ja: "デザイン進化",
    zh: "设计演进",
  },
  "cadConfidence": {
    en: "Confidence",
    ja: "信頼度",
    zh: "置信度",
  },
  "cadIssues": {
    en: "Issues",
    ja: "問題数",
    zh: "问题数",
  },
  "cadOverhangArea": {
    en: "Overhang area",
    ja: "オーバーハング面積",
    zh: "悬垂面积",
  },
  "cadSupportVol": {
    en: "Support vol",
    ja: "サポート体積",
    zh: "支撑体积",
  },
  "cadMfgRisk": {
    en: "Mfg risk",
    ja: "製造リスク",
    zh: "制造风险",
  },
  "cadViewFullReport": {
    en: "+ VIEW FULL REPORT",
    ja: "+ 詳細レポートを見る",
    zh: "+ 查看完整报告",
  },
  "cadHideFullReport": {
    en: "— HIDE FULL REPORT",
    ja: "— 詳細レポートを隠す",
    zh: "— 隐藏完整报告",
  },
  "cadReadiness": {
    en: "READINESS",
    ja: "準備度",
    zh: "就绪度",
  },
  "cadStructural": {
    en: "STRUCTURAL",
    ja: "構造",
    zh: "结构",
  },
  "cadPrint": {
    en: "PRINT",
    ja: "印刷",
    zh: "打印",
  },
  "cadMfg": {
    en: "MFG",
    ja: "製造",
    zh: "制造",
  },
  "cadConfidenceBreakdown": {
    en: "CONFIDENCE BREAKDOWN",
    ja: "信頼度の内訳",
    zh: "置信度细分",
  },
  "cadRepairSuggestions": {
    en: "REPAIR SUGGESTIONS",
    ja: "修復提案",
    zh: "修复建议",
  },
  "cadRiskAnalysis": {
    en: "RISK ANALYSIS",
    ja: "リスク分析",
    zh: "风险分析",
  },
  "cadTechnicalMetrics": {
    en: "TECHNICAL METRICS",
    ja: "技術メトリクス",
    zh: "技术指标",
  },
  "cadTopology": {
    en: "TOPOLOGY",
    ja: "トポロジー",
    zh: "拓扑",
  },
  "cadGeometry": {
    en: "GEOMETRY",
    ja: "形状",
    zh: "几何",
  },
  "cadPrintability": {
    en: "PRINTABILITY",
    ja: "印刷性",
    zh: "可打印性",
  },
  "cadTri": {
    en: "Tri",
    ja: "三角形",
    zh: "三角形",
  },
  "cadVerts": {
    en: "Verts",
    ja: "頂点",
    zh: "顶点",
  },
  "cadShells": {
    en: "Shells",
    ja: "シェル",
    zh: "壳体",
  },
  "cadManifold": {
    en: "Manifold",
    ja: "多様体",
    zh: "流形",
  },
  "cadWatertight": {
    en: "Watertight",
    ja: "水密",
    zh: "水密",
  },
  "cadHoles": {
    en: "Holes",
    ja: "穴",
    zh: "孔",
  },
  "cadEdges": {
    en: "Edges",
    ja: "辺",
    zh: "边",
  },
  "cadBoundaryEdges": {
    en: "Boundary edges",
    ja: "境界辺",
    zh: "边界边",
  },
  "cadNonManifoldEdges": {
    en: "Non-manifold edges",
    ja: "非多様体辺",
    zh: "非流形边",
  },
  "cadNormalOrientation": {
    en: "Normal orientation",
    ja: "法線方向",
    zh: "法线方向",
  },
  "cadFlippedFaces": {
    en: "Flipped faces",
    ja: "反転面",
    zh: "翻转面",
  },
  "cadVolume": {
    en: "Volume",
    ja: "体積",
    zh: "体积",
  },
  "cadSurface": {
    en: "Surface",
    ja: "表面積",
    zh: "表面积",
  },
  "cadBBox": {
    en: "BBox",
    ja: "バウンディング",
    zh: "包围盒",
  },
  "cadAvgWall": {
    en: "Avg wall",
    ja: "平均壁厚",
    zh: "平均壁厚",
  },
  "cadMinWall": {
    en: "Min wall",
    ja: "最小壁厚",
    zh: "最小壁厚",
  },
  "cadOverhang": {
    en: "Overhang",
    ja: "オーバーハング",
    zh: "悬垂",
  },
  "cadDifficulty": {
    en: "Difficulty",
    ja: "難易度",
    zh: "难度",
  },
  "cadBed": {
    en: "Bed",
    ja: "ベッド",
    zh: "平台",
  },
  "cadTime": {
    en: "Time",
    ja: "時間",
    zh: "时间",
  },
  "cadMeshDetails": {
    en: "MESH DETAILS",
    ja: "メッシュ詳細",
    zh: "网格详情",
  },
  "cadErrorLogs": {
    en: "ERROR LOGS",
    ja: "エラーログ",
    zh: "错误日志",
  },
  "cadParametricControl": {
    en: "Parametric Control",
    ja: "パラメトリック制御",
    zh: "参数化控制",
  },
  "cadUndo": {
    en: "Undo (Ctrl+Z)",
    ja: "元に戻す（Ctrl+Z）",
    zh: "撤销（Ctrl+Z）",
  },
  "cadRedo": {
    en: "Redo (Ctrl+Y)",
    ja: "やり直す（Ctrl+Y）",
    zh: "重做（Ctrl+Y）",
  },
  "cadFitView": {
    en: "Fit View",
    ja: "ビューを合わせる",
    zh: "适配视图",
  },
  "cadBridgeOnline": {
    en: "engine online",
    ja: "エンジン接続中",
    zh: "引擎在线",
  },
  "cadBridgeOffline": {
    en: "engine offline — run pnpm dev:server",
    ja: "エンジン未接続 — pnpm dev:server を実行",
    zh: "引擎离线 — 请运行 pnpm dev:server",
  },
  "cadBridgeChecking": {
    en: "checking engine…",
    ja: "エンジンを確認中…",
    zh: "正在检查引擎…",
  },
  "meshGenerate": {
    en: "GENERATE",
    ja: "生成",
    zh: "生成",
  },
  "meshPlaceholder": {
    en: "Describe a shape — e.g. a vase, a figurine, a gear",
    ja: "形を説明してください — 花瓶、フィギュア、歯車など",
    zh: "描述一个形状 — 例如花瓶、手办、齿轮",
  },
  "meshProviderMock": {
    en: "MOCK ENGINE",
    ja: "モックエンジン",
    zh: "模拟引擎",
  },
  "meshProviderTripo": {
    en: "TRIPO ENGINE",
    ja: "TRIPOエンジン",
    zh: "TRIPO 引擎",
  },
  "meshGenerating": {
    en: "GENERATING…",
    ja: "生成中…",
    zh: "生成中…",
  },
  "meshEmptyHint": {
    en: "Describe a shape to generate a 3D mesh.",
    ja: "形を説明すると 3D メッシュを生成します。",
    zh: "描述一个形状以生成 3D 网格。",
  },
  "meshNoMesh": {
    en: "Generation returned no usable mesh.",
    ja: "生成結果に利用可能なメッシュがありませんでした。",
    zh: "生成结果中没有可用的网格。",
  },
  "meshStudio": {
    en: "MESH",
    ja: "メッシュ",
    zh: "网格",
  },
  "meshDownloadStl": {
    en: "DOWNLOAD STL",
    ja: "STLをダウンロード",
    zh: "下载 STL",
  },
  "meshRegenerate": {
    en: "REGENERATE",
    ja: "再生成",
    zh: "重新生成",
  },
  "meshExamplesLabel": {
    en: "TRY",
    ja: "試す",
    zh: "试试",
  },
  "meshDecimate": {
    en: "DECIMATE",
    ja: "減面",
    zh: "减面",
  },
  "meshProcess": {
    en: "REPAIR & PROCESS",
    ja: "修復と処理",
    zh: "修复并处理",
  },
  "meshBodies": {
    en: "BODIES",
    ja: "ボディ数",
    zh: "实体数",
  },
  "meshDownload3mf": {
    en: "3MF",
    ja: "3MF",
    zh: "3MF",
  },
  "meshPrintStats": {
    en: "reported prints {n} · ok {pct}%",
    ja: "報告された印刷 {n} · OK {pct}%",
    zh: "已报告打印 {n} · 成功 {pct}%",
  },
  "meshPrintOk": {
    en: "printed OK",
    ja: "正常に印刷",
    zh: "打印成功",
  },
  "meshPrintIssue": {
    en: "printed with issues",
    ja: "問題ありで印刷",
    zh: "有问题的打印",
  },
  "meshPrintFail": {
    en: "failed to print",
    ja: "印刷失敗",
    zh: "打印失败",
  },
  "meshPrintFeedback": {
    en: "PRINT FEEDBACK",
    ja: "印刷フィードバック",
    zh: "打印反馈",
  },
  "cadNoParams": {
    en: "No editable parameters detected for this design.",
    ja: "このデザインには編集可能なパラメータが検出されませんでした。",
    zh: "未检测到该设计可编辑的参数。",
  },
  "cadSectionDimensions": {
    en: "DIMENSIONS",
    ja: "寸法",
    zh: "尺寸",
  },
  "cadSectionHoles": {
    en: "HOLES",
    ja: "穴",
    zh: "孔",
  },
  "cadSectionDetails": {
    en: "DETAILS",
    ja: "詳細",
    zh: "细节",
  },
  "cadSectionManufacturing": {
    en: "MANUFACTURING",
    ja: "製造",
    zh: "制造",
  },
  "cadCatArchitecture": {
    en: "Architecture",
    ja: "建築",
    zh: "建筑",
  },
  "cadCatFurniture": {
    en: "Furniture",
    ja: "家具",
    zh: "家具",
  },
  "cadCatAutomotive": {
    en: "Automotive",
    ja: "自動車",
    zh: "汽车",
  },
  "cadCatSustainable": {
    en: "Sustainable",
    ja: "持続可能",
    zh: "可持续",
  },
  "cadStarterHouseWall": {
    en: "House Wall",
    ja: "住宅壁",
    zh: "房屋墙面",
  },
  "cadStarterArchFacade": {
    en: "Architectural Facade",
    ja: "建築ファサード",
    zh: "建筑立面",
  },
  "cadStarterBridge": {
    en: "Bridge",
    ja: "橋",
    zh: "桥梁",
  },
  "cadStarterChair": {
    en: "Chair",
    ja: "椅子",
    zh: "椅子",
  },
  "cadStarterTable": {
    en: "Table",
    ja: "テーブル",
    zh: "桌子",
  },
  "cadStarterLamp": {
    en: "Lamp",
    ja: "ランプ",
    zh: "台灯",
  },
  "cadStarterCarPart": {
    en: "Car Part",
    ja: "車部品",
    zh: "汽车零件",
  },
  "cadStarterDroneFrame": {
    en: "Drone Frame",
    ja: "ドローンフレーム",
    zh: "无人机机架",
  },
  "cadStarterRecycledPanel": {
    en: "Recycled Panel",
    ja: "リサイクルパネル",
    zh: "再生面板",
  },
  "cadStarterBioComposite": {
    en: "Bio Composite Product",
    ja: "生体複合材製品",
    zh: "生物复合材料产品",
  },
  "stlParsed": {
    en: "STL parsed — ",
    ja: "STL解析完了 — ",
    zh: "STL 解析完成 — ",
  },
  "api": {
    en: "AI",
    ja: "AI",
    zh: "AI",
  },
  "apiKeys": {
    en: "API KEYS",
    ja: "API キー",
    zh: "API 密钥",
  },
  "install": {
    en: "INSTALL",
    ja: "インストール",
    zh: "安装",
  },
  "installGuideTitle": {
    en: "Install 3DP Agent",
    ja: "3DP Agent をインストール",
    zh: "安装 3DP Agent",
  },
  "installStep1": {
    en: "Open this page in Safari",
    ja: "このページを Safari で開いてください",
    zh: "在 Safari 中打开此页面",
  },
  "installStep2": {
    en: "Tap the Share button at the bottom",
    ja: "下の「共有」ボタンをタップ",
    zh: "点底部「分享」按钮",
  },
  "installStep3": {
    en: "Tap \"Add to Home Screen\"",
    ja: "「ホーム画面に追加」をタップ",
    zh: "选择「添加到主屏幕」",
  },
  "installStep4": {
    en: "Tap \"Add\" at the top-right",
    ja: "右上の「追加」をタップ",
    zh: "点右上角「添加」",
  },
  "installDone": {
    en: "The app is now on your home screen.",
    ja: "ホーム画面に追加されました。",
    zh: "已添加到主屏幕。",
  },
  "installNote": {
    en: "Open in Safari (not another browser) to install.",
    ja: "Safari で開いてください(他のブラウザではインストールできません)。",
    zh: "请在 Safari 中打开(其他浏览器无法安装)。",
  },
  "installManualStep1": {
    en: "Tap your browser's menu button (⋯)",
    ja: "ブラウザのメニューボタン(⋯)をタップ",
    zh: "点浏览器的菜单按钮(⋯)",
  },
  "installManualStep2": {
    en: "Choose \"Add to Home Screen\" or \"Add to Desktop\"",
    ja: "「ホーム画面に追加」か「デスクトップに追加」を選択",
    zh: "选「添加到主屏幕」或「添加到桌面」",
  },
  "installManualStep3": {
    en: "Tap \"Add\" / \"Done\" to confirm",
    ja: "「追加 / 完了」で確認",
    zh: "点「添加 / 完成」确认",
  },
  "installManualNote": {
    en: "The menu button is usually at the bottom or top-right; the option may also be under Share.",
    ja: "メニューボタンは通常、下部か右上にあります。項目は「共有」の中にある場合もあります。",
    zh: "菜单按钮一般在底部或右上角;选项可能叫「添加到桌面」,也可能在「分享」里。",
  },
  "installClose": {
    en: "DONE",
    ja: "完了",
    zh: "完成",
  },
  "signIn": {
    en: "SIGN IN",
    ja: "サインイン",
    zh: "登录",
  },
  "signUp": {
    en: "SIGN UP",
    ja: "新規登録",
    zh: "注册",
  },
  "signOut": {
    en: "SIGN OUT",
    ja: "ログアウト",
    zh: "退出",
  },
  "signInWithGoogle": {
    en: "Continue with Google",
    ja: "Google で続行",
    zh: "使用 Google 登录",
  },
  "email": {
    en: "Email",
    ja: "メールアドレス",
    zh: "邮箱",
  },
  "password": {
    en: "Password",
    ja: "パスワード",
    zh: "密码",
  },
  "planFree": {
    en: "FREE PLAN",
    ja: "無料プラン",
    zh: "免费版",
  },
  "aiCallsLeft": {
    en: "AI calls this month",
    ja: "今月のAI利用",
    zh: "本月 AI 调用",
  },
  "signInToDeepAnalysis": {
    en: "SIGN IN TO RUN DEEP ANALYSIS",
    ja: "ディープ分析にはサインイン",
    zh: "登录后运行深度分析",
  },
  "signInToChat": {
    en: "Sign in to chat",
    ja: "チャットにはサインイン",
    zh: "登录后聊天",
  },
  "close": {
    en: "CLOSE",
    ja: "閉じる",
    zh: "关闭",
  },
  "wallThicknessLabel": {
    en: "WALL THICKNESS",
    ja: "壁厚",
    zh: "壁厚",
  },
  "overhangLabel": {
    en: "OVERHANG",
    ja: "オーバーハング",
    zh: "悬垂",
  },
  "verdictReady": {
    en: "READY TO PRINT",
    ja: "印刷可能",
    zh: "可直接打印",
  },
  "verdictMinor": {
    en: "MINOR FIXES",
    ja: "軽微な修正",
    zh: "建议微调",
  },
  "verdictFix": {
    en: "FIX BEFORE PRINT",
    ja: "印刷前に修正",
    zh: "打印前需修复",
  },
  "verdictBlocked": {
    en: "NOT PRINT-READY",
    ja: "印刷不可",
    zh: "暂不可打印",
  },
  "verdictUnknown": {
    en: "INCONCLUSIVE",
    ja: "判定不能",
    zh: "无法判定",
  },
  "verdictConfidence": {
    en: "confidence",
    ja: "信頼度",
    zh: "置信度",
  },
  "verdictMinWall": {
    en: "MIN WALL",
    ja: "最小肉厚",
    zh: "最小壁厚",
  },
  "verdictOverhang": {
    en: "OVERHANG",
    ja: "オーバーハング",
    zh: "悬垂",
  },
  "verdictMesh": {
    en: "MESH",
    ja: "メッシュ",
    zh: "网格",
  },
  "verdictVolume": {
    en: "VOLUME",
    ja: "体積",
    zh: "体积",
  },
  "verdictSealed": {
    en: "sealed",
    ja: "閉じている",
    zh: "封闭",
  },
  "verdictOpen": {
    en: "open",
    ja: "開いている",
    zh: "开放",
  },
  "verdictUnknownValue": {
    en: "unknown",
    ja: "不明",
    zh: "未知",
  },
  "verdictModuleUnavailable": {
    en: "not measured",
    ja: "未計測",
    zh: "未测量",
  },
  "verdictModuleErrors": {
    en: "{n} module(s) failed: {list}. Values marked * are placeholders, not measurements.",
    ja: "{n} 個のモジュールが失敗: {list}。* 付きの値は測定値ではなくプレースホルダーです。",
    zh: "{n} 个模块失败：{list}。标有 * 的数值是占位符，不是测量结果。",
  },
  "verdictAgainstWall": {
    en: "threshold {v} mm",
    ja: "しきい値 {v} mm",
    zh: "阈值 {v} mm",
  },
  "verdictAgainstOverhang": {
    en: "over {v}°",
    ja: "{v}° 超",
    zh: "超过 {v}°",
  },
  "verdictAgainstMesh": {
    en: "{n} boundary edges",
    ja: "境界エッジ {n}",
    zh: "边界边 {n}",
  },
  "verdictAgainstVolume": {
    en: "closed shell only",
    ja: "閉じたシェルのみ",
    zh: "仅闭合网格",
  },
  "verdictActionRepair": {
    en: "Mesh is not watertight ({n} boundary edges). Repair before slicing — an open shell makes every downstream measurement unreliable.",
    ja: "メッシュが水密ではありません（境界エッジ {n}）。スライス前に修復してください。開いたシェルでは他の測定値も信頼できません。",
    zh: "网格不是水密的（边界边 {n} 条）。请先修复再切片——开放网格会让后续所有测量都不可信。",
  },
  "verdictActionRepairGeneric": {
    en: "Mesh is not watertight. Repair before slicing — an open shell makes every downstream measurement unreliable.",
    ja: "メッシュが水密ではありません。スライス前に修復してください。開いたシェルでは他の測定値も信頼できません。",
    zh: "网格不是水密的。请先修复再切片——开放网格会让后续所有测量都不可信。",
  },
  "verdictActionNonManifold": {
    en: "{n} non-manifold edges. Slicers bridge these unpredictably, so the printed result will not match the model.",
    ja: "非多様体エッジが {n} 本あります。スライサーの補間結果が不定になり、印刷結果がモデルと一致しません。",
    zh: "存在 {n} 条非流形边。切片器的桥接结果不可预测，打印结果将无法与模型一致。",
  },
  "verdictActionThinWall": {
    en: "{p}% of sampled walls are under {v} mm (thinnest {min} mm). Thicken or resize up.",
    ja: "サンプリングした壁の {p}% が {v} mm 未満です（最小 {min} mm）。肉厚を増やすかスケールを上げてください。",
    zh: "{p}% 的采样壁厚低于 {v} mm（最薄 {min} mm）。请加厚或整体放大。",
  },
  "verdictActionOverhang": {
    en: "{n} faces exceed {v}°. Compare orientations or add supports.",
    ja: "{n} 面が {v}° を超えています。向きを比較するかサポートを追加してください。",
    zh: "{n} 个面超过 {v}°。请比较不同摆放方向或添加支撑。",
  },
  "verdictActionReady": {
    en: "No blocking geometry issue found. Export and slice.",
    ja: "印刷を妨げる幾何学的な問題は見つかりませんでした。書き出してスライスしてください。",
    zh: "未发现阻碍打印的几何问题。可直接导出并切片。",
  },
  "verdictActionNoVolume": {
    en: "Volume is withheld because the shell is open — print time and cost stay unset until it is repaired.",
    ja: "シェルが開いているため体積は非表示です。修復するまで印刷時間とコストは算出しません。",
    zh: "网格未封闭，体积数据已隐藏；修复前不计算打印时间与成本。",
  },
  "orientationTitle": {
    en: "ORIENTATION",
    ja: "向き",
    zh: "方向",
  },
  "orientationCheck": {
    en: "CHECK ORIENTATION",
    ja: "向きをチェック",
    zh: "检查方向",
  },
  "orientationAnalyzing": {
    en: "RE-ANALYZING…",
    ja: "再解析中…",
    zh: "重新分析中…",
  },
  "orientationRotated": {
    en: "Better orientation found — rotate {label}",
    ja: "より良い向きが見つかりました — {label} 回転",
    zh: "发现更优方向 — {label} 旋转",
  },
  "orientationKept": {
    en: "Current orientation is already the best available.",
    ja: "現在の向きが最適です。",
    zh: "当前方向已是最佳。",
  },
  "orientationNoGood": {
    en: "No stable orientation exists for this part.",
    ja: "このパーツには安定した向きがありません。",
    zh: "该零件没有稳定的放置方向。",
  },
  "orientationAccept": {
    en: "ACCEPT",
    ja: "適用",
    zh: "应用",
  },
  "orientationRevert": {
    en: "REVERT",
    ja: "元に戻す",
    zh: "还原",
  },
  "orientationBefore": {
    en: "BEFORE",
    ja: "変更前",
    zh: "之前",
  },
  "orientationAfter": {
    en: "AFTER",
    ja: "変更後",
    zh: "之后",
  },
  "orientationOverhang": {
    en: "Overhang area",
    ja: "オーバーハング面積",
    zh: "悬垂面积",
  },
  "orientationSupportVol": {
    en: "Support volume",
    ja: "サポート体積",
    zh: "支撑体积",
  },
  "orientationSupportVolNote": {
    en: "estimate, conservative (overlapping columns counted separately)",
    ja: "推定値・保守的（重複する柱を別々に計上）",
    zh: "估算值，偏保守（重叠立柱分别计数）",
  },
  "orientationSupportDiff": {
    en: "Support difficulty",
    ja: "サポート難度",
    zh: "支撑难度",
  },
  "orientationHeight": {
    en: "Build height",
    ja: "造形高さ",
    zh: "构建高度",
  },
  "orientationBase": {
    en: "Stability footprint (hull)",
    ja: "安定フットプリント（包）",
    zh: "稳定覆盖范围（凸包）",
  },
  "orientationTrueContact": {
    en: "Actual contact",
    ja: "実接触面積",
    zh: "实际接触面积",
  },
  "orientationTallSlender": {
    en: "Tall, slender pose — wobble risk. Consider a brim.",
    ja: "高く細い姿勢 — ぐらつきの恐れ。ブリムを検討。",
    zh: "又高又细的姿势 — 有晃动风险，建议加裙边。",
  },
  "orientationScopeNote": {
    en: "Preview only — model unchanged until accepted.",
    ja: "プレビュー — 適用までモデルは変更されません。",
    zh: "预览 — 接受前模型不变。",
  },
  "minThickness": {
    en: "MIN THICKNESS",
    ja: "最小厚度",
    zh: "最小厚度",
  },
  "volume": {
    en: "VOLUME",
    ja: "体積",
    zh: "体积",
  },
  "surfaceArea": {
    en: "SURFACE AREA",
    ja: "表面積",
    zh: "表面积",
  },
  "dimX": {
    en: "DIM X",
    ja: "寸法X",
    zh: "尺寸X",
  },
  "dimY": {
    en: "DIM Y",
    ja: "寸法Y",
    zh: "尺寸Y",
  },
  "dimZ": {
    en: "DIM Z",
    ja: "寸法Z",
    zh: "尺寸Z",
  },
  "overhangFaces": {
    en: "OVERHANG FACES",
    ja: "オーバーハング面",
    zh: "悬垂面",
  },
  "good": {
    en: "NOMINAL",
    ja: "正常",
    zh: "正常",
  },
  "warning": {
    en: "CAUTION",
    ja: "警告",
    zh: "警告",
  },
  "critical": {
    en: "CRITICAL",
    ja: "重大",
    zh: "严重",
  },
  "watertightWarning": {
    en: "MESH INTEGRITY ISSUE",
    ja: "メッシュ整合性の問題",
    zh: "网格完整性问题",
  },
  "watertightWarningDesc": {
    en: "This mesh has open boundaries or non-manifold edges and may not be watertight. Slicing may produce artifacts or failed regions.",
    ja: "このメッシュには開いた境界または非多様体辺があり、水密でない可能性があります。スライス時にアーティファクトや失敗領域が生じる場合があります。",
    zh: "此网格存在开放边界或非流形边，可能不是水密的。切片时可能产生伪影或失败区域。",
  },
  "wallHistTitle": {
    en: "WALL THICKNESS DISTRIBUTION",
    ja: "壁厚分布",
    zh: "壁厚分布",
  },
  "wallHistNoData": {
    en: "Insufficient raycast samples for distribution",
    ja: "サンプル不足により分布を表示できません",
    zh: "射线投射样本不足，无法显示分布",
  },
  "wallHistSparse": {
    en: "Sparse data — distribution may be incomplete",
    ja: "サンプル数が少なため、分布が不完全な場合があります",
    zh: "样本较少，分布可能不完整",
  },
  "wallHistSamples": {
    en: "samples",
    ja: "サンプル",
    zh: "样本",
  },
  "wallHistRange": {
    en: "range",
    ja: "範囲",
    zh: "范围",
  },
  "mfgTitle": {
    en: "MANUFACTURING RECOMMENDATIONS",
    ja: "製造方法の推奨",
    zh: "制造工艺推荐",
  },
  "mfgEmpty": {
    en: "Upload a model to see process recommendations",
    ja: "モデルをアップロードすると推奨が表示されます",
    zh: "上传模型后查看推荐工艺",
  },
  "mfgPrototype": {
    en: "PROTOTYPE",
    ja: "プロトタイプ",
    zh: "原型",
  },
  "mfgProduction": {
    en: "PRODUCTION",
    ja: "量産",
    zh: "量产",
  },
  "mfgLargeFormat": {
    en: "LARGE FORMAT",
    ja: "大型",
    zh: "大幅面",
  },
  "mfgHighDetail": {
    en: "HIGH DETAIL",
    ja: "高精度",
    zh: "高精度",
  },
  "mfgOptimal": {
    en: "OPTIMAL",
    ja: "最適",
    zh: "最优",
  },
  "mfgViable": {
    en: "VIABLE",
    ja: "可能",
    zh: "可行",
  },
  "mfgMarginal": {
    en: "MARGINAL",
    ja: "条件付き",
    zh: "有风险",
  },
  "mfgNotRecommended": {
    en: "NOT RECOMMENDED",
    ja: "非推奨",
    zh: "不推荐",
  },
  "mfgClickNext": {
    en: "click to see next →",
    ja: "クリックして次へ →",
    zh: "点击查看下一个 →",
  },
  "mfgHandoff": {
    en: "MANUFACTURER HANDOFF",
    ja: "メーカー向けエクスポート",
    zh: "制造商交付",
  },
  "mfgHandoffDesc": {
    en: "Includes geometry, wall thickness, overhang, support, thermal, and DfAM notes — ready for factory review.",
    ja: "幾何・壁厚・オーバーハング・サポート・熱解析・DfAMノートを含む、工場レビュー用データ。",
    zh: "包含几何、壁厚、悬挑、支撑、热分析和DfAM建议，可直接发给工厂评审。",
  },
  "mfgExportJson": {
    en: "EXPORT JSON ↓",
    ja: "JSON出力 ↓",
    zh: "导出JSON ↓",
  },
  "mfgDfam": {
    en: "DfAM",
    ja: "DfAM",
    zh: "DfAM",
  },
  "printPath": {
    en: "Print Path",
    ja: "プリントパス",
    zh: "打印路径",
  },
  "layerReveal": {
    en: "Layer Reveal",
    ja: "レイヤー表示",
    zh: "层显示",
  },
  "failure": {
    en: "Failure",
    ja: "故障予測",
    zh: "故障预测",
  },
  "thermal": {
    en: "Thermal",
    ja: "熱分布",
    zh: "热分布",
  },
  "causality": {
    en: "CAUSALITY",
    ja: "因果関係",
    zh: "因果关系",
  },
  "phaseBase": {
    en: "BASE",
    ja: "ベース",
    zh: "基底",
  },
  "phaseSupport": {
    en: "SUPPORT",
    ja: "サポート",
    zh: "支撑",
  },
  "phaseBridge": {
    en: "BRIDGE",
    ja: "ブリッジ",
    zh: "桥接",
  },
  "phaseThermal": {
    en: "THERMAL",
    ja: "熱",
    zh: "热",
  },
  "phaseOverhang": {
    en: "OVERHANG",
    ja: "オーバーハング",
    zh: "悬垂",
  },
  "phaseFailure": {
    en: "FAILURE ZONE",
    ja: "故障ゾーン",
    zh: "故障区",
  },
  "causalChain": {
    en: "CAUSAL CHAIN",
    ja: "因果連鎖",
    zh: "因果链",
  },
  "clearSelection": {
    en: "← Clear selection",
    ja: "← 選択を解除",
    zh: "← 清除选择",
  },
  "patternsTitle": {
    en: "RECOGNIZED PATTERNS",
    ja: "認識されたパターン",
    zh: "已识别的模式",
  },
  "noPatterns": {
    en: "No structural patterns detected.",
    ja: "構造パターンは検出されませんでした。",
    zh: "未检测到结构模式。",
  },
  "suggestionsTitle": {
    en: "COUNTERFACTUAL SUGGESTIONS",
    ja: "反事実的提案",
    zh: "反事实建议",
  },
  "noSuggestions": {
    en: "No counterfactual suggestions available for this geometry.",
    ja: "このジオメトリに対する反事実的提案はありません。",
    zh: "此几何体没有可用的反事实建议。",
  },
  "metricRisk": {
    en: "Risk",
    ja: "リスク",
    zh: "风险",
  },
  "metricThermal": {
    en: "Thermal",
    ja: "熱",
    zh: "热",
  },
  "metricSupport": {
    en: "Support",
    ja: "サポート",
    zh: "支撑",
  },
  "playbackPlay": {
    en: "▶",
    ja: "▶",
    zh: "▶",
  },
  "playbackPause": {
    en: "⏸",
    ja: "⏸",
    zh: "⏸",
  },
  "layerLabel": {
    en: "Layer",
    ja: "レイヤー",
    zh: "层",
  },
  "confidence": {
    en: "confidence",
    ja: "信頼度",
    zh: "置信度",
  },
  "severity": {
    en: "severity",
    ja: "深刻度",
    zh: "严重性",
  },
  "markers": {
    en: "markers",
    ja: "マーカー",
    zh: "标记",
  },
  "consequenceChain": {
    en: "CONSEQUENCE CHAIN",
    ja: "結果連鎖",
    zh: "结果链",
  },
  "before": {
    en: "before",
    ja: "前",
    zh: "前",
  },
  "after": {
    en: "after",
    ja: "後",
    zh: "后",
  },
  "found": {
    en: "found",
    ja: "検出",
    zh: "发现",
  },
  "suggestions": {
    en: "suggestions",
    ja: "提案",
    zh: "建议",
  },
  "geometryAnalyst.widespreadThinWalls": {
    en: "{pct}% of sampled regions below FDM threshold",
    ja: "サンプリング領域の{pct}%がFDM閾値未満",
    zh: "{pct}%的采样区域低于FDM阈值",
  },
  "geometryAnalyst.someThinWalls": {
    en: "Some walls thinner than recommended — consider thickening",
    ja: "推奨値より薄い壁があります — 肉厚の追加を検討",
    zh: "部分壁厚低于推荐值 — 建议加厚",
  },
  "geometryAnalyst.overhangSupport": {
    en: "{faces} faces exceed {threshold}° overhang — support required",
    ja: "{faces}面が{threshold}°超のオーバーハング — サポートが必要",
    zh: "{faces}个面超过{threshold}°悬垂角 — 需要支撑",
  },
  "geometryAnalyst.extremeAspectRatio": {
    en: "Extreme aspect ratio — model may be fragile",
    ja: "アスペクト比が極端 — モデルが脆弱な可能性",
    zh: "纵横比极端 — 模型可能易碎",
  },
  "geometryAnalyst.lowTriangles": {
    en: "Very low triangle count — model may lack detail",
    ja: "三角形数が非常に少ない — 詳細不足の可能性",
    zh: "三角形数量极少 — 模型细节可能不足",
  },
  "geometryAnalyst.concernsFound": {
    en: "Geometry analysis found {count} area(s) of concern:",
    ja: "ジオメトリ解析で{count}件の懸念点を検出しました:",
    zh: "几何分析发现 {count} 个关注点:",
  },
  "geometryAnalyst.passed": {
    en: "Geometry analysis passed — no significant issues detected",
    ja: "ジオメトリ解析は合格 — 顕著な問題は検出されませんでした",
    zh: "几何分析通过 — 未检测到重大问题",
  },
  "geometryAnalyst.markerOverhang": {
    en: "Overhang face at {angle}°",
    ja: "{angle}°のオーバーハング面",
    zh: "{angle}°悬垂面",
  },
  "geometryAnalyst.markerThinWall": {
    en: "Thin wall area (est. {t}mm)",
    ja: "薄肉領域（推定{t}mm）",
    zh: "薄壁区域（约{t}mm）",
  },
  "failurePredictor.noRisks": {
    en: "No significant failure risks predicted. Model appears structurally sound for printing.",
    ja: "重大な破損リスクは予測されません。モデルは造形可能な構造です。",
    zh: "未预测到重大失效风险。模型结构适合打印。",
  },
  "failurePredictor.assessment": {
    en: "Failure Risk Assessment: {level}",
    ja: "破損リスク評価: {level}",
    zh: "失效风险评估: {level}",
  },
  "failurePredictor.riskCount": {
    en: "{count} risk(s) identified",
    ja: "{count}件のリスクを検出",
    zh: "识别到 {count} 项风险",
  },
  "failurePredictor.overhangDesc": {
    en: "{faces} faces exceed {threshold}° overhang angle — supports required to prevent sagging",
    ja: "{faces}面が{threshold}°超のオーバーハング角 — たわみ防止のためサポートが必要",
    zh: "{faces}个面超过{threshold}°悬垂角 — 需支撑防止下垂",
  },
  "failurePredictor.overhangRecHigh": {
    en: "Add supports in slicer or redesign overhangs to be <{threshold}°",
    ja: "スライサーでサポートを追加するか、オーバーハングを{threshold}°未満に再設計",
    zh: "在切片软件中添加支撑，或将悬垂角重新设计为小于 {threshold}°",
  },
  "failurePredictor.overhangRecStandard": {
    en: "Standard supports recommended in slicer",
    ja: "スライサーで標準サポートを推奨",
    zh: "建议在切片软件中使用标准支撑",
  },
  "failurePredictor.wallCriticalDesc": {
    en: "{pct}% of sampled walls below FDM threshold — widespread thin wall failure risk",
    ja: "サンプリング壁の{pct}%がFDM閾値未満 — 広範囲の薄肉破損リスク",
    zh: "{pct}%的采样壁低于FDM阈值 — 大范围薄壁失效风险",
  },
  "failurePredictor.wallCriticalRec": {
    en: "Increase wall thickness model-wide to at least 2mm. Use 3+ perimeters in slicer.",
    ja: "モデル全体の肉厚を最低2mmに増やしてください。スライサーで外周3以上に設定。",
    zh: "将模型整体壁厚增加到至少2mm。切片软件中使用3层以上外壁。",
  },
  "failurePredictor.wallHighDesc": {
    en: "Thin walls detected ({extra}{pct}% of samples) — moderate failure risk",
    ja: "薄肉を検出（{extra}{pct}%のサンプル）— 中程度の破損リスク",
    zh: "检测到薄壁（{extra}{pct}%的样本）— 中度失效风险",
  },
  "failurePredictor.wallHighRec": {
    en: "Thin areas detected. Increase wall thickness or use 3 perimeters.",
    ja: "薄い領域を検出。肉厚を増やすか、外周3に設定してください。",
    zh: "检测到薄壁区域。请增加壁厚或使用3层外壁。",
  },
  "failurePredictor.warpDesc": {
    en: "Large flat area ({maxDim}mm) — risk of corner warping during cooling",
    ja: "広い平面部（{maxDim}mm）— 冷却中の角部の反りリスク",
    zh: "大面积平面（{maxDim}mm）— 冷却时边角翘曲风险",
  },
  "failurePredictor.warpRec": {
    en: "Add brim/raft in slicer, use enclosure, consider mouse ears on corners",
    ja: "スライサーでブリム/ラフトを追加し、筐体を使用。角部のマウスイヤーを検討",
    zh: "切片软件中添加裙边/底座，使用封闭仓，考虑在边角加防翘曲耳",
  },
  "failurePredictor.bridgeDesc": {
    en: "Large overhang area with {areas} affected faces — bridging may cause sagging",
    ja: "{areas}面が影響する広いオーバーハング部 — ブリッジでたわみが発生する可能性",
    zh: "大面积悬垂区域，涉及{areas}个面 — 桥接可能导致下垂",
  },
  "failurePredictor.bridgeRec": {
    en: "Enable bridging calibration in slicer, increase part cooling fan speed",
    ja: "スライサーでブリッジ較正を有効にし、冷却ファン速度を上げる",
    zh: "在切片软件中启用桥接校准，提高零件冷却风扇转速",
  },
  "failurePredictor.supportRemovalRec": {
    en: "Use tree/organic supports for easier breakaway. Consider splitting model or adjusting orientation.",
    ja: "取り外しやすいツリー/オーガニックサポートを使用。モデルの分割や向きの調整を検討。",
    zh: "使用树形/有机支撑便于拆除。可考虑拆分模型或调整摆放方向。",
  },
  "failurePredictor.supportCollapseRec": {
    en: "Add support interface brims in slicer. Consider splitting large overhang regions with support blockers.",
    ja: "スライサーでサポート接合面のブリムを追加。サポートブロッカーで大きなオーバーハング部を分割検討。",
    zh: "在切片软件中添加支撑接触面裙边。可考虑用支撑阻挡块拆分大面积悬垂区域。",
  },
  "failurePredictor.supportDensityRec": {
    en: "Ensure adequate support density and interface layers in slicer. Consider tree supports.",
    ja: "スライサーでサポート密度と接合層を十分に設定。ツリーサポートを検討。",
    zh: "确保切片软件中支撑密度和接触层充足。可考虑树形支撑。",
  },
  "failurePredictor.delamDesc": {
    en: "Tall model ({z}mm) — risk of layer delamination, especially with thin walls",
    ja: "高さのあるモデル（{z}mm）— 特に薄肉部で層間剥離のリスク",
    zh: "高模型（{z}mm）— 层间剥离风险，薄壁处尤甚",
  },
  "failurePredictor.delamRec": {
    en: "Increase nozzle temperature by 5-10°C, reduce layer height, enable Z-hop",
    ja: "ノズル温度を5〜10°C上げ、層高を下げ、Zホップを有効に",
    zh: "喷嘴温度提高5-10°C，降低层高，启用Z-hop",
  },
  "failurePredictor.markerOverhang": {
    en: "Steep overhang ({angle}°) — support recommended",
    ja: "急なオーバーハング（{angle}°）— サポート推奨",
    zh: "陡峭悬垂（{angle}°）— 建议支撑",
  },
  "failurePredictor.markerThinWall": {
    en: "Thin wall — p5 thickness {t}mm",
    ja: "薄肉 — p5肉厚 {t}mm",
    zh: "薄壁 — p5壁厚 {t}mm",
  },
  "failurePredictor.visionRec": {
    en: "Visually confirmed anomaly — inspect the model closely before printing; consider manual inspection or re-exporting the source geometry",
    ja: "視覚的に確認された異常 — 印刷前にモデルをよく点検し、ソースジオメトリの再エクスポートを検討",
    zh: "视觉确认异常 — 打印前仔细检查模型，考虑手工检验或重新导出几何源文件",
  },
  "printabilityScorer.score": {
    en: "Printability Score: {score}/100 ({category})",
    ja: "プリント適性スコア: {score}/100（{category}）",
    zh: "可打印性评分: {score}/100（{category}）",
  },
  "printabilityScorer.breakdown": {
    en: "Breakdown:",
    ja: "内訳:",
    zh: "明细:",
  },
  "printabilityScorer.wallThicknessLine": {
    en: "Wall Thickness ({weight}%): {score}/100 — {status}",
    ja: "肉厚（{weight}%）: {score}/100 — {status}",
    zh: "壁厚（{weight}%）: {score}/100 — {status}",
  },
  "printabilityScorer.overhangLine": {
    en: "Overhang ({weight}%): {score}/100 — {status}",
    ja: "オーバーハング（{weight}%）: {score}/100 — {status}",
    zh: "悬垂（{weight}%）: {score}/100 — {status}",
  },
  "printabilityScorer.aspectRatioLine": {
    en: "Aspect Ratio ({weight}%): {score}/100",
    ja: "アスペクト比（{weight}%）: {score}/100",
    zh: "纵横比（{weight}%）: {score}/100",
  },
  "printabilityScorer.volumeLine": {
    en: "Volume ({weight}%): {score}/100",
    ja: "体積（{weight}%）: {score}/100",
    zh: "体积（{weight}%）: {score}/100",
  },
  "printabilityScorer.featureDetailLine": {
    en: "Feature Detail ({weight}%): {score}/100",
    ja: "フィーチャー詳細（{weight}%）: {score}/100",
    zh: "细节特征（{weight}%）: {score}/100",
  },
  "printabilityScorer.thinWalls": {
    en: "⚠ Thin walls: {pct}% of sampled regions below FDM threshold (p5={minLabel}mm). Consider thickening.",
    ja: "⚠ 薄肉: サンプリング領域の{pct}%がFDM閾値未満（p5={minLabel}mm）。肉厚の追加を検討。",
    zh: "⚠ 薄壁: {pct}%的采样区域低于FDM阈值（p5={minLabel}mm）。建议加厚。",
  },
  "printabilityScorer.primaryConcern": {
    en: "⚠ Primary concern: wall thickness ({minLabel}mm). Consider thickening to 2mm+ for reliable printing.",
    ja: "⚠ 主な懸念: 肉厚（{minLabel}mm）。確実な造形のため2mm以上への増肉を検討。",
    zh: "⚠ 主要问题: 壁厚（{minLabel}mm）。为确保可靠打印，建议加厚至2mm以上。",
  },
  "printabilityScorer.secondaryConcern": {
    en: "⚠ Secondary concern: {areas} overhang faces need support.",
    ja: "⚠ 二次的な懸念: {areas}面のオーバーハングにサポートが必要。",
    zh: "⚠ 次要问题: {areas}个悬垂面需要支撑。",
  },
  "printabilityScorer.review.failureRisks": {
    en: "Failure predictor found significant risks — adjusted score down",
    ja: "破損予測で重大リスクを検出 — スコアを減点",
    zh: "失效预测发现重大风险 — 评分下调",
  },
  "printabilityScorer.review.geometryCritical": {
    en: "Geometry analyst flagged critical issues — adjusted score down",
    ja: "ジオメトリ解析が重大問題を検出 — スコアを減点",
    zh: "几何分析标记了严重问题 — 评分下调",
  },
  "printabilityScorer.review.noAdjustments": {
    en: "No significant adjustments from peer review",
    ja: "ピアレビューによる大きな調整なし",
    zh: "同行评审未做重大调整",
  },
  "printabilityScorer.marker.wallThickness": {
    en: "Wall thickness score: {score}/100",
    ja: "肉厚スコア: {score}/100",
    zh: "壁厚评分: {score}/100",
  },
  "printabilityScorer.marker.overhang": {
    en: "Overhang score: {score}/100",
    ja: "オーバーハングスコア: {score}/100",
    zh: "悬垂评分: {score}/100",
  },
  "optimizationAdvisor.wallCriticalDesc": {
    en: "Widespread thin walls — {pct}% of sampled regions below FDM threshold (p5={minLabel}mm)",
    ja: "広範囲の薄肉 — サンプリング領域の{pct}%がFDM閾値未満（p5={minLabel}mm）",
    zh: "大范围薄壁 — {pct}%的采样区域低于FDM阈值（p5={minLabel}mm）",
  },
  "optimizationAdvisor.wallCriticalImpl": {
    en: "Increase wall thickness to at least 2mm model-wide. Use 3-4 perimeters in slicer. Consider shell offset in CAD.",
    ja: "モデル全体の肉厚を最低2mmに。スライサーで外周3〜4に設定。CADでシェルオフセットを検討。",
    zh: "将模型整体壁厚增加到至少2mm。切片软件使用3-4层外壁。可在CAD中考虑外壳偏移。",
  },
  "optimizationAdvisor.wallCriticalExp": {
    en: "Reduces collapse risk by 60-80%",
    ja: "崩壊リスクを60〜80%低減",
    zh: "降低60-80%坍塌风险",
  },
  "optimizationAdvisor.wallWarningDesc": {
    en: "Some thin regions — {pct}% of samples thin (p5={minLabel}mm)",
    ja: "一部の薄い領域 — サンプルの{pct}%が薄肉（p5={minLabel}mm）",
    zh: "部分薄壁区域 — {pct}%的样本偏薄（p5={minLabel}mm）",
  },
  "optimizationAdvisor.wallWarningImpl": {
    en: "Increase to 3 perimeters. If structural, thicken to 2.5mm+ in CAD.",
    ja: "外周3に増やしてください。構造部品ならCADで2.5mm以上に増肉。",
    zh: "外壁增加到3层。若是结构件，在CAD中加厚至2.5mm以上。",
  },
  "optimizationAdvisor.wallWarningExp": {
    en: "Eliminates isolated thin spots",
    ja: "孤立した薄肉部を解消",
    zh: "消除孤立的薄壁点",
  },
  "optimizationAdvisor.overhangDesc": {
    en: "{areas} overhang faces exceed {threshold}°",
    ja: "{areas}面のオーバーハングが{threshold}°超",
    zh: "{areas}个悬垂面超过{threshold}°",
  },
  "optimizationAdvisor.overhangImpl": {
    en: "Rotate model so most overhangs face upward. Use {threshold}° rule — overhangs under {threshold}° print without support. For remaining overhangs, enable auto-tree supports in slicer.",
    ja: "オーバーハングが上を向くようモデルを回転。{threshold}°ルールを使用 — {threshold}°未満ならサポートなしで造形可能。残りのオーバーハングはスライサーで自動ツリーサポートを有効に。",
    zh: "旋转模型使大部分悬垂朝上。使用{threshold}°规则 — 小于{threshold}°的悬垂可无支撑打印。剩余悬垂在切片软件中启用自动树形支撑。",
  },
  "optimizationAdvisor.overhangExp": {
    en: "Reduces support material by 40-60%",
    ja: "サポート材を40〜60%削減",
    zh: "减少40-60%支撑材料",
  },
  "optimizationAdvisor.supportDesc": {
    en: "Support structures required for {areas} overhang faces",
    ja: "{areas}面のオーバーハングにサポート構造が必要",
    zh: "{areas}个悬垂面需要支撑结构",
  },
  "optimizationAdvisor.supportImpl": {
    en: "Enable tree/organic supports in slicer (PrusaSlicer organic, Orca tree). Set overhang threshold to 50°. Use support blocker where not needed.",
    ja: "スライサーでツリー/オーガニックサポートを有効に（PrusaSlicer有機、Orcaツリー）。オーバーハング閾値を50°に設定。不要箇所にはサポートブロッカーを使用。",
    zh: "在切片软件中启用树形/有机支撑（PrusaSlicer有机、Orca树形）。悬垂阈值设为50°。不需要处使用支撑阻挡块。",
  },
  "optimizationAdvisor.supportExp": {
    en: "Eliminates sagging on overhangs",
    ja: "オーバーハング部のたわみを解消",
    zh: "消除悬垂下垂",
  },
  "optimizationAdvisor.largeIslandImpl": {
    en: "Use organic/tree supports for easier breakaway. Consider splitting model at the overhang boundary.",
    ja: "取り外しやすいオーガニック/ツリーサポートを使用。オーバーハング境界でモデル分割を検討。",
    zh: "使用有机/树形支撑便于拆除。可考虑在悬垂边界处拆分模型。",
  },
  "optimizationAdvisor.largeIslandExp": {
    en: "Simplifies support removal and improves surface finish",
    ja: "サポート除去を簡素化し、表面品質を向上",
    zh: "简化支撑拆除并改善表面质量",
  },
  "optimizationAdvisor.islandsImpl": {
    en: "Consider consolidating overhangs into fewer continuous regions by adjusting orientation or adding bridging geometry.",
    ja: "向きの調整やブリッジ形状の追加でオーバーハングをより少数の連続領域にまとめる検討。",
    zh: "可考虑通过调整方向或添加桥接结构，将悬垂合并为更少的连续区域。",
  },
  "optimizationAdvisor.islandsExp": {
    en: "Reduces support interface area and post-processing time",
    ja: "サポート接合面積と後処理時間を削減",
    zh: "减少支撑接触面积和后处理时间",
  },
  "optimizationAdvisor.tallImpl": {
    en: "Consider reorienting model to reduce Z-height of supports. Use support blockers where possible.",
    ja: "サポートのZ高さを減らすためモデル向きを再検討。可能ならサポートブロッカーを使用。",
    zh: "可考虑重新调整模型方向以降低支撑高度。尽可能使用支撑阻挡块。",
  },
  "optimizationAdvisor.tallExp": {
    en: "Reduces tall support wobble and post-processing time",
    ja: "高いサポートの揺れと後処理時間を削減",
    zh: "减少高支撑晃动和后处理时间",
  },
  "optimizationAdvisor.directionalImpl": {
    en: "Test rotations that spread overhang faces across multiple axes. 15-30° tilt can significantly reduce peak overhang severity.",
    ja: "オーバーハング面を複数軸に分散する回転をテスト。15〜30°の傾きで最大オーバーハングを大幅に低減可能。",
    zh: "尝试将悬垂面分散到多个轴的旋转角度。倾斜15-30°可显著降低最大悬垂严重度。",
  },
  "optimizationAdvisor.directionalExp": {
    en: "More uniform support distribution, lower peak support height",
    ja: "より均一なサポート分布、低い最大サポート高さ",
    zh: "支撑分布更均匀，最大支撑高度更低",
  },
  "optimizationAdvisor.difficultImpl": {
    en: "Enable tree/organic supports in slicer (PrusaSlicer organic, Orca tree). Set overhang threshold to 50°. Use support blockers where not needed.",
    ja: "スライサーでツリー/オーガニックサポートを有効に。オーバーハング閾値を50°に設定。不要箇所にはサポートブロッカーを使用。",
    zh: "在切片软件中启用树形/有机支撑。悬垂阈值设为50°。不需要处使用支撑阻挡块。",
  },
  "optimizationAdvisor.difficultExp": {
    en: "Reduces sagging and support failure risk",
    ja: "たわみとサポート破損リスクを低減",
    zh: "减少下垂和支撑失效风险",
  },
  "optimizationAdvisor.bridgeAspectDesc": {
    en: "Extreme aspect ratio ({ratio}:1)",
    ja: "極端なアスペクト比（{ratio}:1）",
    zh: "极端纵横比（{ratio}:1）",
  },
  "optimizationAdvisor.bridgeAspectImpl": {
    en: "Consider splitting model into parts and assembling post-print. Or print at 45° angle to reduce Z-height.",
    ja: "モデルを分割して印刷後に組み立てる検討。またはZ高さを減らすため45°で造形。",
    zh: "可考虑拆分模型分件打印后组装。或以45°倾斜打印以降低高度。",
  },
  "optimizationAdvisor.bridgeAspectExp": {
    en: "Eliminates tall-print failure modes",
    ja: "高さのある造形の失敗モードを解消",
    zh: "消除高件打印的失效模式",
  },
  "optimizationAdvisor.lowPolyDesc": {
    en: "Low polygon count ({tri} triangles) — model may have holes or non-manifold edges",
    ja: "ポリゴン数が少ない（{tri}三角形）— 穴や非マニフォールド辺の可能性",
    zh: "多边形数量少（{tri}个三角形）— 模型可能有孔洞或非流形边",
  },
  "optimizationAdvisor.lowPolyImpl": {
    en: "Run mesh repair (Netfabb, PrusaSlicer repair, or Meshmixer). Simplify3D and Windows 3D Builder have free repair tools.",
    ja: "メッシュ修復を実行（Netfabb、PrusaSlicer修復、Meshmixer）。Simplify3DやWindows 3D Builderにも無料修復ツールあり。",
    zh: "运行网格修复（Netfabb、PrusaSlicer修复或Meshmixer）。Simplify3D和Windows 3D Builder也有免费修复工具。",
  },
  "optimizationAdvisor.lowPolyExp": {
    en: "Ensures watertight model for reliable slicing",
    ja: "信頼できるスライスのため水密モデルを確保",
    zh: "确保模型水密以可靠切片",
  },
  "optimizationAdvisor.orientationOverhang": {
    en: "Rotate model to minimize overhangs facing downward. Print flat faces parallel to build plate. Consider tilting 15-20° to reduce stair-stepping on curved surfaces.",
    ja: "下向きのオーバーハングを最小化するようモデルを回転。平面部をビルドプレートと平行に。曲面の段差低減のため15〜20°の傾きを検討。",
    zh: "旋转模型以减少朝下的悬垂。使平面与打印平台平行。可考虑倾斜15-20°以减少曲面阶梯纹。",
  },
  "optimizationAdvisor.orientationOk": {
    en: "Model can be printed in current orientation. For best surface finish, orient the most visible face upward.",
    ja: "現在の向きで造形可能。最良の表面品質のため、最も目立つ面を上に向けてください。",
    zh: "模型可按当前方向打印。为获得最佳表面质量，请将最显眼的面朝上。",
  },
  "optimizationAdvisor.report": {
    en: "Optimization Report (Score: {score}/100)",
    ja: "最適化レポート（スコア: {score}/100）",
    zh: "优化报告（评分: {score}/100）",
  },
  "optimizationAdvisor.orientationLine": {
    en: "Orientation: {orientation}",
    ja: "向き: {orientation}",
    zh: "方向: {orientation}",
  },
  "optimizationAdvisor.materialsHeader": {
    en: "Recommended Process & Materials:",
    ja: "推奨プロセスと材料:",
    zh: "推荐工艺与材料:",
  },
  "optimizationAdvisor.improvementsHeader": {
    en: "Suggested Improvements ({count}):",
    ja: "推奨改善（{count}件）:",
    zh: "建议改进（{count}项）:",
  },
  "optimizationAdvisor.expectedLine": {
    en: "→ Expected: {expected}",
    ja: "→ 期待効果: {expected}",
    zh: "→ 预期效果: {expected}",
  },
  "optimizationAdvisor.noImprovements": {
    en: "No improvements needed — model is well-optimized for printing.",
    ja: "改善は不要 — モデルは造形用に最適化されています。",
    zh: "无需改进 — 模型已针对打印良好优化。",
  },
  "optimizationAdvisor.matReason.plaLarge": {
    en: "Best for large parts — low cost, easy printing, good layer adhesion",
    ja: "大型部品に最適 — 低コスト、造形が容易、良好な層密着",
    zh: "最适合大型零件 — 成本低、易打印、层间附着好",
  },
  "optimizationAdvisor.matReason.petgLarge": {
    en: "Stronger than PLA, better layer adhesion, slightly harder to print",
    ja: "PLAより強く、層密着も良好、やや造形が難しい",
    zh: "比PLA更强，层间附着更好，打印难度略高",
  },
  "optimizationAdvisor.matReason.slaSmall": {
    en: "Perfect for fine details and thin walls — much higher resolution than FDM",
    ja: "微細なディテールと薄肉に最適 — FDMよりはるかに高解像度",
    zh: "非常适合精细细节和薄壁 — 分辨率远高于FDM",
  },
  "optimizationAdvisor.matReason.plaSmall": {
    en: "If using FDM, use smallest nozzle (0.2mm) for thin walls",
    ja: "FDMなら最小ノズル（0.2mm）で薄肉を造形",
    zh: "若使用FDM，请用最小喷嘴（0.2mm）打印薄壁",
  },
  "optimizationAdvisor.matReason.plaGeneral": {
    en: "Versatile, easy to print, good strength for general parts",
    ja: "汎用的で造形が容易、一般部品に十分な強度",
    zh: "通用性好、易打印，对一般零件强度足够",
  },
  "optimizationAdvisor.matReason.petgFunctional": {
    en: "Better for functional parts — stronger, more durable",
    ja: "機能部品に最適 — より強く耐久性が高い",
    zh: "更适合功能件 — 更强、更耐用",
  },
  "optimizationAdvisor.matReason.absOutdoor": {
    en: "For outdoor/heat-resistant applications",
    ja: "屋外・耐熱用途向け",
    zh: "适用于户外/耐热应用",
  },
  "optimizationAdvisor.matSupport.minimal": {
    en: "Minimal",
    ja: "最小限",
    zh: "最少",
  },
  "optimizationAdvisor.matSupport.standard": {
    en: "Standard",
    ja: "標準",
    zh: "标准",
  },
  "optimizationAdvisor.matSupport.required": {
    en: "Required",
    ja: "必須",
    zh: "必需",
  },
  "optimizationAdvisor.matSupport.asNeeded": {
    en: "As needed",
    ja: "必要に応じて",
    zh: "按需",
  },
  "orchestrator.consensusScore": {
    en: "Consensus Score: {score}/100 ({verdict})",
    ja: "合意スコア: {score}/100（{verdict}）",
    zh: "共识评分: {score}/100（{verdict}）",
  },
  "orchestrator.agreementDelta": {
    en: "Agreement Delta: {delta} ({label})",
    ja: "合意デルタ: {delta}（{label}）",
    zh: "一致性差值: {delta}（{label}）",
  },
  "orchestrator.debateRounds": {
    en: "Debate Rounds: {rounds}",
    ja: "討議ラウンド: {rounds}",
    zh: "辩论轮数: {rounds}",
  },
  "orchestrator.agentLine": {
    en: "{name}: {score}/100 ({verdict})",
    ja: "{name}: {score}/100（{verdict}）",
    zh: "{name}: {score}/100（{verdict}）",
  },
  "orchestrator.agreement.strong": {
    en: "strong agreement",
    ja: "強い合意",
    zh: "高度一致",
  },
  "orchestrator.agreement.moderate": {
    en: "moderate agreement",
    ja: "中程度の合意",
    zh: "中度一致",
  },
  "orchestrator.agreement.disagreement": {
    en: "disagreement",
    ja: "不一致",
    zh: "存在分歧",
  },
  "orchestrator.verdict.pass": {
    en: "Model is print-ready. Minor optimizations may still improve quality.",
    ja: "モデルは造形可能です。軽微な最適化で品質がさらに向上します。",
    zh: "模型可直接打印。轻微优化仍可提升质量。",
  },
  "orchestrator.verdict.warning": {
    en: "Model has moderate issues. Review recommendations before printing.",
    ja: "モデルに中程度の問題があります。造形前に推奨事項を確認してください。",
    zh: "模型存在中度问题。打印前请查看建议。",
  },
  "orchestrator.verdict.fail": {
    en: "Model has critical issues. Significant modifications recommended before printing.",
    ja: "モデルに重大な問題があります。造形前に大幅な修正を推奨します。",
    zh: "模型存在严重问题。打印前建议做重大修改。",
  },
  "orchestrator.noResults": {
    en: "No agent results available",
    ja: "エージェントの結果がありません",
    zh: "暂无智能体分析结果",
  },
  "orchestrator.timedOut": {
    en: "Agent timed out after {ms}ms",
    ja: "エージェントが{ms}msでタイムアウトしました",
    zh: "智能体在{ms}ms后超时",
  },
  "notMeasured": {
    en: "not measured",
    ja: "未測定",
    zh: "未测量",
  },
  "agent.unknownError": {
    en: "Unknown agent error",
    ja: "不明なエージェントエラー",
    zh: "未知的智能体错误",
  },
  "agent.failed": {
    en: "Agent failed: {message}",
    ja: "エージェントが失敗: {message}",
    zh: "智能体失败: {message}",
  },
  "agent.debateRound": {
    en: "Debate Round {round}",
    ja: "討議ラウンド {round}",
    zh: "辩论轮 {round}",
  },
  "agent.votingRecord": {
    en: "Voting & Debate Record",
    ja: "投票と討議の記録",
    zh: "投票与辩论记录",
  },
  "agent.weight": {
    en: "weight",
    ja: "重み",
    zh: "权重",
  },
  "agent.score": {
    en: "score",
    ja: "スコア",
    zh: "评分",
  },
  "agent.confidence": {
    en: "confidence",
    ja: "信頼度",
    zh: "置信度",
  },
  "vision.geometrySummary": {
    en: "File: {file}\nTriangles: {triangles}\nSurface Area: {area}mm²\nVolume: {volume}mm³",
    ja: "ファイル: {file}\n三角形: {triangles}\n表面積: {area}mm²\n体積: {volume}mm³",
    zh: "文件: {file}\n三角形: {triangles}\n表面积: {area}mm²\n体积: {volume}mm³",
  },
  "agentName.geometry_analyst": {
    en: "Geometry Analyst",
    ja: "ジオメトリ解析",
    zh: "几何分析师",
  },
  "agentName.printability_scorer": {
    en: "Printability Scorer",
    ja: "プリント適性評価",
    zh: "可打印性评估",
  },
  "agentName.failure_predictor": {
    en: "Failure Predictor",
    ja: "破損予測",
    zh: "失效预测",
  },
  "agentName.optimization_advisor": {
    en: "Optimization Advisor",
    ja: "最適化アドバイザー",
    zh: "优化顾问",
  },
  "agentDesc.geometry_analyst": {
    en: "Analyzes mesh geometry, wall thickness, overhangs, and features",
    ja: "メッシュ形状、肉厚、オーバーハング、フィーチャーを解析",
    zh: "分析网格几何、壁厚、悬垂和特征",
  },
  "agentDesc.printability_scorer": {
    en: "Scores overall printability based on weighted geometry metrics",
    ja: "重み付けした幾何指標に基づき総合的なプリント適性を評価",
    zh: "基于加权几何指标评估整体可打印性",
  },
  "agentDesc.failure_predictor": {
    en: "Identifies potential failure modes during printing",
    ja: "造形中の潜在的な破損モードを特定",
    zh: "识别打印过程中潜在的失效模式",
  },
  "agentDesc.optimization_advisor": {
    en: "Suggests geometry improvements and orientation changes",
    ja: "形状の改善と向きの変更を提案",
    zh: "建议几何改进与方向调整",
  },
  "metrics.noPositionData": {
    en: "No position data",
    ja: "位置データがありません",
    zh: "无位置数据",
  },
  "analysis.failed": {
    en: "Failed: {message}",
    ja: "失敗: {message}",
    zh: "失败: {message}",
  },
  "analysis.unknownError": {
    en: "Unknown error",
    ja: "不明なエラー",
    zh: "未知错误",
  },
  "metrics.nonIndexed": {
    en: "Non-indexed geometry — volume and wall thickness cannot be computed accurately",
    ja: "非インデックス形状 — 体積と肉厚を正確に計算できません",
    zh: "非索引几何 — 无法精确计算体积与壁厚",
  },
  "metrics.volume": {
    en: "Volume: {volume} mm³",
    ja: "体積: {volume} mm³",
    zh: "体积: {volume} mm³",
  },
  "metrics.surfaceArea": {
    en: "Surface area: {area} mm²",
    ja: "表面積: {area} mm²",
    zh: "表面积: {area} mm²",
  },
  "metrics.dimensions": {
    en: "Dimensions: {x} × {y} × {z} mm",
    ja: "寸法: {x} × {y} × {z} mm",
    zh: "尺寸: {x} × {y} × {z} mm",
  },
  "metrics.minWallSampled": {
    en: "Min wall thickness (sampled): {t} mm (approximate)",
    ja: "最小肉厚（サンプリング）: {t} mm（概算）",
    zh: "最小壁厚（采样）: {t} mm（近似）",
  },
  "metrics.wallNotSampled": {
    en: "Wall thickness: could not be sampled (no opposing faces found)",
    ja: "肉厚: サンプリング不可（対向面が見つかりません）",
    zh: "壁厚: 无法采样（未找到相对面）",
  },
  "metrics.overhangSummary": {
    en: "Overhang: {faces}/{total} faces, {pct}% of surface area",
    ja: "オーバーハング: {faces}/{total}面、表面積の{pct}%",
    zh: "悬垂: {faces}/{total}个面，占表面积{pct}%",
  },
  "support.noSupport": {
    en: "No support structures needed",
    ja: "サポート構造は不要です",
    zh: "无需支撑结构",
  },
  "support.veryDifficult": {
    en: "Very difficult support structure",
    ja: "非常に困難なサポート構造",
    zh: "非常困难的支撑结构",
  },
  "support.largeIslandRemoval": {
    en: "Large continuous support island with tall supports — removal risk",
    ja: "高さのある大きな連続サポート島 — 除去リスク",
    zh: "大型连续支撑岛且支撑较高 — 有拆除风险",
  },
  "support.difficult": {
    en: "Difficult support structure",
    ja: "困難なサポート構造",
    zh: "困难的支撑结构",
  },
  "support.moderate": {
    en: "Moderate support complexity",
    ja: "中程度のサポート複雑度",
    zh: "中度支撑复杂度",
  },
  "support.islands": {
    en: "{count} separate support islands",
    ja: "{count}個の独立したサポート島",
    zh: "{count}个独立的支撑岛",
  },
  "support.tallSupports": {
    en: "{pct}% of support faces in top half — tall supports",
    ja: "サポート面の{pct}%が上半分 — 高いサポート",
    zh: "{pct}%的支撑面位于上半部 — 支撑较高",
  },
  "support.directional": {
    en: "Directionally concentrated supports — consider rotation",
    ja: "一方向に集中したサポート — 回転を検討",
    zh: "支撑方向集中 — 可考虑旋转",
  },
  "support.isolated": {
    en: "Isolated manageable supports",
    ja: "孤立した管理可能なサポート",
    zh: "孤立且易管理的支撑",
  },
  "support.noIndexedGeometry": {
    en: "Cannot estimate supports: need indexed geometry",
    ja: "サポート推定不可: インデックス形状が必要です",
    zh: "无法估算支撑: 需要索引几何",
  },
  "support.none": {
    en: "No supports needed",
    ja: "サポート不要",
    zh: "无需支撑",
  },
  "support.volume": {
    en: "Estimated support volume: {volume} mm³ ({grams}g)",
    ja: "推定サポート体積: {volume} mm³（{grams}g）",
    zh: "估算支撑体积: {volume} mm³（{grams}g）",
  },
  "support.difficultyLabel": {
    en: "Difficulty: {difficulty}",
    ja: "難易度: {difficulty}",
    zh: "难度: {difficulty}",
  },
  "support.overhangFaces": {
    en: "{count} overhang faces with average angle {angle}°",
    ja: "{count}面のオーバーハング、平均角度{angle}°",
    zh: "{count}个悬垂面，平均角度{angle}°",
  },
  "bedFit.noPositionData": {
    en: "No position data",
    ja: "位置データがありません",
    zh: "无位置数据",
  },
  "bedFit.fits": {
    en: "Fits with {x}mm X, {y}mm Y, {z}mm Z clearance",
    ja: "適合 — X {x}mm、Y {y}mm、Z {z}mm のクリアランス",
    zh: "可放置 — X {x}mm、Y {y}mm、Z {z}mm 间隙",
  },
  "bedFit.noFit": {
    en: "Does not fit ({x}×{y}×{z})",
    ja: "適合しません（{x}×{y}×{z}）",
    zh: "无法放置（{x}×{y}×{z}）",
  },
  "bedFit.fitsProfile": {
    en: "Model fits on {name} ({w}×{d}×{h}mm). Best orientation: {reason}",
    ja: "{name}（{w}×{d}×{h}mm）に適合。最適向き: {reason}",
    zh: "模型可放入{name}（{w}×{d}×{h}mm）。最佳方向: {reason}",
  },
  "bedFit.noFitProfile": {
    en: "Model does NOT fit on {name} in any orientation. Largest dimension: {max}mm",
    ja: "{name}にはどの向きでも適合しません。最大寸法: {max}mm",
    zh: "模型无法以任何方向放入{name}。最大尺寸: {max}mm",
  },
  "printTime.zeroVolume": {
    en: "Cannot estimate: zero volume",
    ja: "推定不可: 体積がゼロです",
    zh: "无法估算: 体积为零",
  },
  "printTime.unreliableVolume": {
    en: "Cannot estimate: the shell is not watertight, so its volume is unreliable",
    ja: "推定不可: メッシュが水密でないため、体積を信頼できません",
    zh: "无法估算: 模型不水密，体积不可信",
  },
  "printTime.estimate": {
    en: "Est. {minutes}min ({hours}h) at {layerHeight}mm layer height. Material: {weight}g (${materialCost}). Total cost: ${totalCost}. {layers} layers.",
    ja: "推定 {minutes}分（{hours}時間）、層高{layerHeight}mm。材料: {weight}g（${materialCost}）。合計コスト: ${totalCost}。{layers}層。",
    zh: "预计 {minutes}分钟（{hours}小时），层高{layerHeight}mm。材料: {weight}g（${materialCost}）。总成本: ${totalCost}。共{layers}层。",
  },
  "topology.noPositionData": {
    en: "No position data",
    ja: "位置データがありません",
    zh: "无位置数据",
  },
  "topology.nonIndexed": {
    en: "Geometry is not indexed — each triangle is treated as an independent shell.",
    ja: "非インデックス形状 — 各三角形が独立したシェルとして扱われます。",
    zh: "几何未索引 — 每个三角形被当作独立壳体处理。",
  },
  "topology.manifold": {
    en: "Mesh is manifold",
    ja: "メッシュはマニフォールドです",
    zh: "网格为流形",
  },
  "topology.nonManifoldEdges": {
    en: "{count} non-manifold edge(s) detected",
    ja: "{count}個の非マニフォールド辺を検出",
    zh: "检测到{count}条非流形边",
  },
  "topology.shellSummary": {
    en: "{shells} shell(s), {triangles} triangles, {vertices} vertices",
    ja: "{shells}シェル、{triangles}三角形、{vertices}頂点",
    zh: "{shells}个壳体、{triangles}个三角形、{vertices}个顶点",
  },
  "topology.boundaryEdges": {
    en: "{count} boundary edge(s) — mesh has holes",
    ja: "{count}個の境界辺 — メッシュに穴があります",
    zh: "{count}条边界边 — 网格有孔洞",
  },
  "validation.noPositionData": {
    en: "No position data",
    ja: "位置データがありません",
    zh: "无位置数据",
  },
  "validation.nonIndexed": {
    en: "Cannot validate non-indexed geometry",
    ja: "非インデックス形状は検証できません",
    zh: "无法验证非索引几何",
  },
  "validation.watertight": {
    en: "Mesh is watertight",
    ja: "メッシュは水密です",
    zh: "网格是水密的",
  },
  "validation.notWatertight": {
    en: "Mesh is NOT watertight — {holes} hole(s), {boundary} boundary edge(s)",
    ja: "メッシュは水密ではありません — 穴{holes}個、境界辺{boundary}本",
    zh: "网格不水密 — {holes}个孔洞、{boundary}条边界边",
  },
  "validation.flippedNormals": {
    en: "{count} face(s) ({pct}%) have flipped normals",
    ja: "{count}面（{pct}%）に法線反転があります",
    zh: "{count}个面（{pct}%）法线翻转",
  },
  "validation.degenerateFaces": {
    en: "{count} degenerate face(s)",
    ja: "{count}個の退化面",
    zh: "{count}个退化面",
  },
  "validation.normalOrientation": {
    en: "Normal orientation: {orientation}",
    ja: "法線方向: {orientation}",
    zh: "法线方向: {orientation}",
  },
  "report.confidence.low": {
    en: "Low",
    ja: "低",
    zh: "低",
  },
  "report.confidence.moderate": {
    en: "Moderate",
    ja: "中",
    zh: "中",
  },
  "report.confidence.high": {
    en: "High",
    ja: "高",
    zh: "高",
  },
  "report.verdict": {
    en: "VERDICT: {verdict}",
    ja: "判定: {verdict}",
    zh: "结论: {verdict}",
  },
  "report.issues": {
    en: "ISSUES:",
    ja: "問題点:",
    zh: "问题:",
  },
  "report.tips": {
    en: "TIPS:",
    ja: "ヒント:",
    zh: "提示:",
  },
  "chat.header": {
    en: "FABRICATION CONSULTANT",
    ja: "製造コンサルタント",
    zh: "制造顾问",
  },
  "chat.localMode": {
    en: "LOCAL MODE",
    ja: "ローカルモード",
    zh: "本地模式",
  },
  "chat.localBadge": {
    en: "[LOCAL]",
    ja: "[ローカル]",
    zh: "[本地]",
  },
  "chat.analyzing": {
    en: "▋ analyzing...",
    ja: "▋ 分析中...",
    zh: "▋ 分析中...",
  },
  "chat.errorPrefix": {
    en: "// ERROR: {message}",
    ja: "// エラー: {message}",
    zh: "// 错误: {message}",
  },
  "chat.errorFallback": {
    en: "API call failed",
    ja: "API呼び出しに失敗",
    zh: "API调用失败",
  },
  "chat.placeholder": {
    en: "Ask about this model...",
    ja: "このモデルの製造について質問...",
    zh: "问关于这个模型的制造问题...",
  },
  "chat.needApiKey": {
    en: "This needs AI reasoning. Add an API key and I can give you a proper fabrication analysis.",
    ja: "この質問にはAI推論が必要です。API Keyを設定すると、より深い製造分析が可能になります。",
    zh: "这个问题需要AI推理。配置API Key后我可以给你更深入的制造分析。",
  },
  "chat.needSignIn": {
    en: "Sign in to use AI chat — the model runs on our servers.",
    ja: "AIチャットを利用するにはサインインしてください(モデルはサーバー側で動作)。",
    zh: "登录后即可使用 AI 聊天(模型在服务器端运行)。",
  },
  "chat.assessment.scanned": {
    en: "Scanned {file} ({dims}).",
    ja: "{file}（{dims}）をスキャンしました。",
    zh: "已扫描 {file}（{dims}）。",
  },
  "chat.assessment.criticalLead": {
    en: "\n\n⚠ Critical issues found:",
    ja: "\n\n⚠ 重大な問題を検出：",
    zh: "\n\n⚠ 发现严重问题：",
  },
  "chat.assessment.criticalWall": {
    en: "\n— Min wall thickness {t}mm — below the FDM survival threshold. These walls will not hold.",
    ja: "\n— 最小肉厚 {t}mm はFDM印刷の閾値以下です。",
    zh: "\n— 最小壁厚 {t}mm，低于FDM可打印阈值。",
  },
  "chat.assessment.criticalOverhang": {
    en: "\n— {faces} faces with severe overhang. Support strategy is not optional here.",
    ja: "\n— {faces} 箇所の深刻なオーバーハングを検出。",
    zh: "\n— 检测到 {faces} 个严重悬垂面。",
  },
  "chat.assessment.criticalTail": {
    en: "\n\nThis needs to be addressed before you send this to a printer. What do you want to tackle first?",
    ja: "\n\n印刷前にこれらを修正する必要があります。どこから確認しますか？",
    zh: "\n\n打印前必须处理这些问题。你想先从哪里开始？",
  },
  "chat.assessment.warningLead": {
    en: "\n\nPrintable, but there are things to watch:",
    ja: "\n\n基本的には印刷可能ですが、注意点があります：",
    zh: "\n\n模型基本可打印，但有几个需要注意的地方：",
  },
  "chat.assessment.warningWall": {
    en: "\n— Some areas are thin (min {t}mm). Material choice and orientation will matter here.",
    ja: "\n— 一部の壁が薄い（最小 {t}mm）。素材と向きの選択が重要です",
    zh: "\n— 部分区域壁厚偏薄（最小 {t}mm），材料选择和摆放方向会影响结果",
  },
  "chat.assessment.warningOverhang": {
    en: "\n— {faces} faces beyond 45°. Worth evaluating orientation before committing to supports.",
    ja: "\n— {faces} 箇所が45°を超えるオーバーハング。サポートを検討してください",
    zh: "\n— {faces} 个悬垂面超过45°，建议评估是否需要支撑",
  },
  "chat.assessment.warningTail": {
    en: "\n\nWhat do you want to dig into?",
    ja: "\n\nどこから対処しますか？",
    zh: "\n\n你想优先解决哪个问题？",
  },
  "chat.assessment.good": {
    en: "\n\nGeometry looks clean — wall thickness and overhangs are both within acceptable range. Low print risk.\n\nWhat do you want to talk through — material, settings, or something else?",
    ja: "\n\nジオメトリは良好です。肉厚とオーバーハングともに許容範囲内です。印刷リスクは低いと判断します。\n\n素材選択や印刷設定について質問はありますか？",
    zh: "\n\n几何结构良好——壁厚和悬垂角度都在可接受范围内。这个模型打印风险较低。\n\n你想讨论材料选择、打印参数，还是有其他问题？",
  },
  "prompt.languageName": {
    en: "English",
    ja: "日本語",
    zh: "简体中文",
  },
  "prompt.language": {
    en: "## LANGUAGE\nReply in {language}. Use professional {language} 3D-printing terminology throughout.",
    ja: "## 言語\n{language}で回答してください。専門的な{language}の3Dプリント用語を使用してください。",
    zh: "## 语言\n请用{language}回复，并在整个回答中使用专业的{language}3D打印术语。",
  },
  "prompt.criticalWall": {
    en: "⚠ CRITICAL: Walls below 0.8mm will not survive FDM printing. Structural failure likely.",
    ja: "⚠ 重大: 0.8mm未満の壁はFDM造形に耐えられません。構造破損の可能性が高いです。",
    zh: "⚠ 严重: 低于0.8mm的壁无法承受FDM打印。很可能发生结构失效。",
  },
  "prompt.warningWall": {
    en: "⚠ WARNING: Some walls are thin. Material choice and orientation matter here.",
    ja: "⚠ 警告: 一部の壁が薄いです。素材と向きの選択が重要です。",
    zh: "⚠ 警告: 部分壁较薄。材料选择和摆放方向很重要。",
  },
  "prompt.criticalOverhang": {
    en: "⚠ CRITICAL: Severe overhangs detected. Support strategy is mandatory.",
    ja: "⚠ 重大: 深刻なオーバーハングを検出。サポート戦略が必須です。",
    zh: "⚠ 严重: 检测到严重悬垂。支撑策略是必需的。",
  },
  "prompt.warningOverhang": {
    en: "⚠ WARNING: Moderate overhangs. Evaluate orientation before adding supports.",
    ja: "⚠ 警告: 中程度のオーバーハング。サポート追加前に向きを評価してください。",
    zh: "⚠ 警告: 中度悬垂。添加支撑前请评估摆放方向。",
  },
  "vision.langInstr": {
    en: "\n\nPlease respond in {language}. Use natural and professional {language} terms. Current interface language is {language}.",
    ja: "\n\n{language}で回答してください。自然で専門的な{language}の用語を使用してください。現在のインターフェース言語は{language}です。",
    zh: "\n\n请用{language}回复，并使用自然、专业的{language}术语。当前界面语言为{language}。",
  },
  "vision.noAssessment": {
    en: "No assessment available",
    ja: "評価データがありません",
    zh: "暂无评估",
  },
  "vision.unavailable": {
    en: "Vision analysis unavailable (no API key configured or API call failed)",
    ja: "視覚分析は利用できません（API Keyが未設定か、API呼び出しに失敗）",
    zh: "视觉分析不可用（未配置API Key或API调用失败）",
  },
  "causality.chainHeader": {
    en: "CAUSAL CHAIN",
    ja: "因果連鎖",
    zh: "因果链",
  },
  "causality.roots": {
    en: "{count} roots",
    ja: "{count} 根因",
    zh: "{count} 根因",
  },
  "causality.patternCount": {
    en: "{count} patterns",
    ja: "{count} パターン",
    zh: "{count} 个模式",
  },
  "causality.bestFix": {
    en: "best fix −{pct}%",
    ja: "最良の修正 −{pct}%",
    zh: "最佳修复 −{pct}%",
  },
  "causality.noSuggestion": {
    en: "no suggestion yet",
    ja: "提案なし",
    zh: "暂无建议",
  },
  "causality.eventCount": {
    en: "{count} events",
    ja: "{count} イベント",
    zh: "{count} 个事件",
  },
  "causality.patternsHover": {
    en: "Patterns · hover to highlight",
    ja: "パターン · ホバーで強調",
    zh: "模式 · 悬停高亮",
  },
  "causality.hoverHint": {
    en: "Hover a tag to isolate it — the 3D view follows",
    ja: "タグにホバーで単独表示 — 3Dビューが追従",
    zh: "悬停标签即可单独高亮 — 3D 视图同步",
  },
  "causality.patternsHeader": {
    en: "RECOGNIZED PATTERNS",
    ja: "認識済みパターン",
    zh: "识别模式",
  },
  "causality.suggestionsHeader": {
    en: "COUNTERFACTUAL SUGGESTIONS",
    ja: "反実仮想の提案",
    zh: "反事实建议",
  },
  "causality.noData": {
    en: "No causal data available.",
    ja: "因果データがありません。",
    zh: "暂无因果数据。",
  },
  "causality.noPatterns": {
    en: "No structural patterns detected in this analysis.",
    ja: "この分析では構造パターンは検出されませんでした。",
    zh: "本次分析未检测到结构模式。",
  },
  "causality.noSuggestions": {
    en: "No counterfactual suggestions available for this geometry.",
    ja: "このジオメトリに対する反実仮想の提案はありません。",
    zh: "当前几何暂无反事实建议。",
  },
  "causality.patternsFound": {
    en: "{count} found",
    ja: "{count}件",
    zh: "发现 {count} 个",
  },
  "causality.suggestionsCount": {
    en: "{count} suggestions",
    ja: "{count}件の提案",
    zh: "{count} 项建议",
  },
  "causality.occurrence": {
    en: "occurrence(s)",
    ja: "件",
    zh: "个",
  },
  "causality.seen": {
    en: "seen {count}×",
    ja: "出現 {count}回",
    zh: "出现 {count} 次",
  },
  "causality.severity": {
    en: "severity",
    ja: "深刻度",
    zh: "严重度",
  },
  "causality.markers": {
    en: "markers",
    ja: "マーカー",
    zh: "标记",
  },
  "causality.bestMatch": {
    en: "best match",
    ja: "最良一致",
    zh: "最佳匹配",
  },
  "causality.clearSelection": {
    en: "← Clear selection",
    ja: "← 選択をクリア",
    zh: "← 清除选择",
  },
  "causality.consequenceChain": {
    en: "CONSEQUENCE CHAIN",
    ja: "結果の連鎖",
    zh: "后果链",
  },
  "causality.confidence": {
    en: "confidence",
    ja: "信頼度",
    zh: "置信度",
  },
  "causality.event.support_instability": {
    en: "Support Instability",
    ja: "サポート不安定性",
    zh: "支撑不稳定",
  },
  "causality.event.overhang_sag": {
    en: "Overhang Sag",
    ja: "オーバーハング下垂",
    zh: "悬垂下坠",
  },
  "causality.event.bridge_oscillation": {
    en: "Bridge Oscillation",
    ja: "ブリッジ振動",
    zh: "桥接振荡",
  },
  "causality.event.wall_vibration": {
    en: "Wall Vibration",
    ja: "壁振動",
    zh: "壁面振动",
  },
  "causality.event.thermal_accumulation": {
    en: "Thermal Accumulation",
    ja: "熱蓄積",
    zh: "热量积聚",
  },
  "causality.event.cooling_imbalance": {
    en: "Cooling Imbalance",
    ja: "冷却アンバランス",
    zh: "冷却不均",
  },
  "causality.event.delamination_risk": {
    en: "Delamination Risk",
    ja: "層間剥離リスク",
    zh: "层间剥离风险",
  },
  "causality.event.failure_spike": {
    en: "Failure Probability",
    ja: "破損確率",
    zh: "失效概率",
  },
  "causality.desc.support_instability": {
    en: "{count} support regions with potential instability",
    ja: "不安定性が懸念されるサポート領域が{count}箇所",
    zh: "{count}个潜在不稳定的支撑区域",
  },
  "causality.desc.support_instability_critical": {
    en: "Critical support instability — high risk of support failure or difficult removal",
    ja: "重大なサポート不安定性 — サポート破損や除去困難の高いリスク",
    zh: "严重支撑不稳定 — 支撑失效或难以拆除的风险很高",
  },
  "causality.desc.support_instability_warning": {
    en: "Moderate support concerns — review support strategy before printing",
    ja: "中程度のサポート懸念 — 印刷前にサポート戦略を確認",
    zh: "中度支撑问题 — 打印前请复核支撑策略",
  },
  "causality.desc.overhang_sag": {
    en: "{count} overhanging surfaces at sag risk",
    ja: "{count}面がたわみリスク",
    zh: "{count}个悬垂面存在下垂风险",
  },
  "causality.desc.bridge_oscillation": {
    en: "Unsupported spans oscillating under thermal stress",
    ja: "熱応力で振動する未支持スパン",
    zh: "未支撑跨段在热应力下振荡",
  },
  "causality.desc.wall_vibration": {
    en: "{count} thin-walled regions vulnerable to vibration",
    ja: "振動に弱い薄肉領域が{count}箇所",
    zh: "{count}个易受振动的薄壁区域",
  },
  "causality.desc.thermal_accumulation": {
    en: "Heat building up in dense feature regions",
    ja: "高密度領域に熱が蓄積",
    zh: "密集特征区域热量积聚",
  },
  "causality.desc.delamination_risk": {
    en: "High-severity regions prone to layer separation",
    ja: "層分離しやすい高深刻度領域",
    zh: "易发生层分离的高严重度区域",
  },
  "causality.desc.failure_spike": {
    en: "Aggregate failure risk across {count} active events",
    ja: "{count}件のアクティブな事象にわたる総合破損リスク",
    zh: "{count}个活跃事件的综合失效风险",
  },
  "causality.edge.thermal_support": {
    en: "heating weakens supports",
    ja: "熱がサポートを弱める",
    zh: "热量削弱支撑",
  },
  "causality.edge.support_bridge": {
    en: "unstable supports amplify oscillation",
    ja: "不安定なサポートが振動を増幅",
    zh: "不稳定支撑放大振荡",
  },
  "causality.edge.thermal_sag": {
    en: "heat softens overhangs",
    ja: "熱がオーバーハングを軟化",
    zh: "热量软化悬垂",
  },
  "causality.edge.sag_bridge": {
    en: "sagging increases span stress",
    ja: "たわみがスパン応力を増加",
    zh: "下垂增加跨段应力",
  },
  "causality.edge.thermal_wall": {
    en: "thermal gradient excites walls",
    ja: "温度勾配が壁を励起",
    zh: "热梯度激发壁面",
  },
  "causality.edge.bridge_delam": {
    en: "oscillation propagates to layers",
    ja: "振動が層に伝播",
    zh: "振荡传播至各层",
  },
  "causality.edge.wall_delam": {
    en: "vibration stresses layer bond",
    ja: "振動が層間結合に応力",
    zh: "振动使层间结合承受应力",
  },
  "causality.edge.delam_failure": {
    en: "layer separation leads to failure",
    ja: "層分離が破損につながる",
    zh: "层分离导致失效",
  },
  "causality.edge.bridge_failure": {
    en: "oscillation increases failure probability",
    ja: "振動が破損確率を上昇",
    zh: "振荡增加失效概率",
  },
  "causality.edge.wall_failure": {
    en: "wall fatigue contributes to failure",
    ja: "壁の疲労が破損に寄与",
    zh: "壁面疲劳导致失效",
  },
  "causality.edge.sag_failure": {
    en: "sagging reduces structural integrity",
    ja: "たわみが構造的健全性を低下",
    zh: "下垂降低结构完整性",
  },
  "causality.pattern.unsupported_thin_bridge.name": {
    en: "Unsupported Thin Bridge",
    ja: "未支持の薄いブリッジ",
    zh: "无支撑薄桥",
  },
  "causality.pattern.unsupported_thin_bridge.desc": {
    en: "Narrow horizontal span with thin walls, at risk of sagging or fracture under load",
    ja: "薄肉で幅の狭い水平スパン。荷重でたわみや破損のリスク",
    zh: "窄而薄壁的水平跨段，存在下垂或承重断裂风险",
  },
  "causality.pattern.dense_overhang_cluster.name": {
    en: "Dense Overhang Cluster",
    ja: "密集オーバーハングクラスタ",
    zh: "密集悬垂簇",
  },
  "causality.pattern.dense_overhang_cluster.desc": {
    en: "Concentrated region of steep overhangs requiring support or redesign",
    ja: "急峻なオーバーハングが集中する領域。サポートか再設計が必要",
    zh: "陡峭悬垂集中区域，需要支撑或重新设计",
  },
  "causality.pattern.thermal_trap_cavity.name": {
    en: "Thermal Trap Cavity",
    ja: "熱閉じ込めキャビティ",
    zh: "热量积聚腔体",
  },
  "causality.pattern.thermal_trap_cavity.desc": {
    en: "Enclosed or concave region where heat accumulates, causing warping and layer adhesion issues",
    ja: "熱がこもる閉鎖・凹状領域。反りや層密着不良の原因",
    zh: "热量积聚的封闭或凹陷区域，导致翘曲和层间附着问题",
  },
  "causality.pattern.oscillating_vertical_wall.name": {
    en: "Oscillating Vertical Wall",
    ja: "振動する垂直壁",
    zh: "振荡垂直壁",
  },
  "causality.pattern.oscillating_vertical_wall.desc": {
    en: "Tall thin wall prone to vibration during printing, risking delamination",
    ja: "造形中に振動しやすい高く薄い壁。層間剥離のリスク",
    zh: "高而薄的壁在打印中易振动，有层间剥离风险",
  },
  "causality.pattern.unstable_support_island.name": {
    en: "Unstable Support Island",
    ja: "不安定なサポート島",
    zh: "不稳定支撑岛",
  },
  "causality.pattern.unstable_support_island.desc": {
    en: "Isolated region requiring dense supports, prone to tipping or layer shift",
    ja: "高密度サポートが必要な孤立領域。転倒や層ずれの恐れ",
    zh: "需要密集支撑的孤立区域，易倾倒或层错位",
  },
  "causality.pattern.stress_concentration_void.name": {
    en: "Stress Concentration Void",
    ja: "応力集中ボイド",
    zh: "应力集中空腔",
  },
  "causality.pattern.stress_concentration_void.desc": {
    en: "Sharp internal corner or hole where stress concentrates, likely cracking point",
    ja: "応力が集中する鋭い内部コーナーや穴。割れの起点になりやすい",
    zh: "应力集中的尖锐内角或孔洞，易成为开裂点",
  },
  "causality.phase.base": {
    en: "BASE",
    ja: "ベース",
    zh: "基座",
  },
  "causality.phase.support": {
    en: "SUPPORT",
    ja: "サポート",
    zh: "支撑",
  },
  "causality.phase.bridge": {
    en: "BRIDGE",
    ja: "ブリッジ",
    zh: "桥梁",
  },
  "causality.phase.thermal": {
    en: "THERMAL",
    ja: "熱",
    zh: "热",
  },
  "causality.phase.overhang": {
    en: "OVERHANG",
    ja: "オーバーハング",
    zh: "悬垂",
  },
  "causality.phase.failure": {
    en: "FAILURE ZONE",
    ja: "破損領域",
    zh: "失效区",
  },
  "causality.metric.risk": {
    en: "Risk",
    ja: "リスク",
    zh: "风险",
  },
  "causality.metric.thermal": {
    en: "Thermal",
    ja: "熱",
    zh: "热",
  },
  "causality.metric.support": {
    en: "Support",
    ja: "サポート",
    zh: "支撑",
  },
  "causality.suggestion.thicken_wall.label": {
    en: "Thicken Wall",
    ja: "壁を厚くする",
    zh: "加厚壁面",
  },
  "causality.suggestion.thicken_wall.desc": {
    en: "Increase wall thickness to reduce fracture and vibration risk",
    ja: "肉厚を増やして破損と振動リスクを低減",
    zh: "增加壁厚以降低断裂和振动风险",
  },
  "causality.suggestion.reduce_overhang.label": {
    en: "Reduce Overhang",
    ja: "オーバーハングを減らす",
    zh: "减少悬垂",
  },
  "causality.suggestion.reduce_overhang.desc": {
    en: "Decrease overhang angle or add chamfer supports",
    ja: "オーバーハング角を減らすか面取りサポートを追加",
    zh: "减小悬垂角或添加倒角支撑",
  },
  "causality.suggestion.add_support.label": {
    en: "Add Support",
    ja: "サポートを追加",
    zh: "添加支撑",
  },
  "causality.suggestion.add_support.desc": {
    en: "Insert support columns beneath unstable overhangs",
    ja: "不安定なオーバーハング下にサポート柱を追加",
    zh: "在不稳定悬垂下方插入支撑柱",
  },
  "causality.suggestion.split_bridge.label": {
    en: "Split Bridge",
    ja: "ブリッジを分割",
    zh: "拆分桥接",
  },
  "causality.suggestion.split_bridge.desc": {
    en: "Divide long unsupported span into shorter segments",
    ja: "長い未支持スパンを短い区間に分割",
    zh: "将长跨未支撑段拆分为更短段",
  },
  "causality.suggestion.hollow_region.label": {
    en: "Hollow Region",
    ja: "領域を中空化",
    zh: "区域掏空",
  },
  "causality.suggestion.hollow_region.desc": {
    en: "Remove internal mass from dense areas to reduce thermal mass",
    ja: "高密度領域の内部質量を除去し熱質量を低減",
    zh: "去除密集区域的内部质量以降低热容量",
  },
  "cad.risk.severeOverhang": {
    en: "Severe overhang",
    ja: "深刻なオーバーハング",
    zh: "严重悬垂",
  },
  "cad.risk.moderateOverhang": {
    en: "Moderate overhang",
    ja: "中程度のオーバーハング",
    zh: "中度悬垂",
  },
  "cad.risk.extensiveThinWalls": {
    en: "Extensive thin walls",
    ja: "広範囲の薄肉",
    zh: "大面积薄壁",
  },
  "cad.risk.someThinWalls": {
    en: "Some thin walls",
    ja: "一部の薄肉",
    zh: "部分薄壁",
  },
  "cad.risk.nonManifold": {
    en: "Non-manifold mesh",
    ja: "非マニフォールドメッシュ",
    zh: "非流形网格",
  },
  "cad.risk.disconnectedShells": {
    en: "Multiple disconnected shells",
    ja: "複数の分離シェル",
    zh: "多个不连通的壳体",
  },
  "cad.risk.notWatertight": {
    en: "Mesh not watertight",
    ja: "メッシュが水密でない",
    zh: "网格不水密",
  },
  "cad.risk.complexSupport": {
    en: "Complex support required",
    ja: "複雑なサポートが必要",
    zh: "需要复杂支撑",
  },
  "cad.risk.moderateSupport": {
    en: "Moderate support needed",
    ja: "中程度のサポートが必要",
    zh: "需要中度支撑",
  },
  "cad.risk.exceedsBed": {
    en: "Model exceeds printer bed",
    ja: "モデルがプリントベッドを超えています",
    zh: "模型超出打印平台",
  },
  "cad.risk.largeVolume": {
    en: "Large print volume",
    ja: "大きな造形体積",
    zh: "大打印体积",
  },
  "cad.risk.longPrint": {
    en: "Estimated print time exceeds 12 hours",
    ja: "推定印刷時間が12時間を超えています",
    zh: "预计打印时间超过12小时",
  },
  "cad.risk.intentMismatch": {
    en: "Significant intent mismatch",
    ja: "意図との大きな不一致",
    zh: "与设计意图严重不符",
  },
  "cad.repair.reduceOverhang.action": {
    en: "Reduce overhang angle",
    ja: "オーバーハング角を低減",
    zh: "减小悬垂角",
  },
  "cad.repair.reduceOverhang.desc": {
    en: "Overhangs >45° require supports. Flatten steep faces or split the model into parts that print without bridging.",
    ja: "45°超のオーバーハングはサポートが必要。急斜面を平坦化するか、ブリッジなしで造形できる部品に分割してください。",
    zh: "超过45°的悬垂需要支撑。请将陡峭面放平，或将模型拆分为无需桥接即可打印的部件。",
  },
  "cad.repair.thickenWall.action": {
    en: "Increase wall thickness",
    ja: "肉厚を増やす",
    zh: "增加壁厚",
  },
  "cad.repair.thickenWall.desc": {
    en: "{pct}% of surface has walls <0.8mm. Thicken to at least 1.2mm for structural integrity and reliable printing.",
    ja: "表面の{pct}%が0.8mm未満の壁です。構造強度と安定造形のため最低1.2mmまで増肉してください。",
    zh: "{pct}%的表面壁厚低于0.8mm。为确保结构强度和可靠打印，请加厚至至少1.2mm。",
  },
  "cad.repair.reinforceThin.action": {
    en: "Reinforce thin walls",
    ja: "薄肉部を補強",
    zh: "加固薄壁",
  },
  "cad.repair.reinforceThin.desc": {
    en: "{pct}% of surface is thin. Consider thickening problem areas to at least 1.0mm.",
    ja: "表面の{pct}%が薄いです。問題領域を最低1.0mmまで増肉してください。",
    zh: "{pct}%的表面偏薄。请将问题区域加厚至至少1.0mm。",
  },
  "cad.repair.repairNonManifold.action": {
    en: "Repair non-manifold geometry",
    ja: "非マニフォールド形状を修復",
    zh: "修复非流形几何",
  },
  "cad.repair.repairNonManifold.desc": {
    en: "Non-manifold edges cause slicing errors. Use mesh repair tools (netfabb, PrusaSlicer) to fix problem edges.",
    ja: "非マニフォールド辺はスライスエラーの原因。メッシュ修復ツール（netfabb、PrusaSlicer）で修正してください。",
    zh: "非流形边会导致切片错误。请使用网格修复工具（netfabb、PrusaSlicer）修复问题边。",
  },
  "cad.repair.closeHoles.action": {
    en: "Close mesh holes",
    ja: "メッシュの穴を塞ぐ",
    zh: "封闭网格孔洞",
  },
  "cad.repair.closeHoles.desc": {
    en: "{count} holes detected. Watertight mesh is required for slicing. Use hole-filling tools in your CAD software.",
    ja: "{count}個の穴を検出。スライスには水密メッシュが必要です。CADの穴埋めツールを使用してください。",
    zh: "检测到{count}个孔洞。切片需要水密网格。请使用CAD软件中的补洞工具。",
  },
  "cad.repair.fitBed.action": {
    en: "Rotate or scale to fit build plate",
    ja: "回転・拡縮でビルドプレートに適合",
    zh: "旋转或缩放以适配打印平台",
  },
  "cad.repair.fitBed.desc": {
    en: "Model exceeds {name} bed ({w}×{d}×{h}mm). Try 45° rotation or uniform scaling.",
    ja: "{name}のベッド（{w}×{d}×{h}mm）を超えています。45°回転または均一スケーリングを試してください。",
    zh: "模型超出{name}平台（{w}×{d}×{h}mm）。请尝试45°旋转或等比缩放。",
  },
  "cad.repair.reduceSupport.action": {
    en: "Reduce support complexity",
    ja: "サポート複雑度を低減",
    zh: "降低支撑复杂度",
  },
  "cad.repair.reduceSupport.desc": {
    en: "Complex supports increase print time and post-processing. Consider splitting the model or redesigning overhanging features to be self-supporting.",
    ja: "複雑なサポートは印刷時間と後処理を増やします。モデル分割や、自己支持となるオーバーハングの再設計を検討してください。",
    zh: "复杂支撑会增加打印时间和后处理。请考虑拆分模型，或重新设计悬垂特征使其自支撑。",
  },
  "cad.repair.optimizeOrientation.action": {
    en: "Optimize print orientation",
    ja: "造形向きを最適化",
    zh: "优化打印方向",
  },
  "cad.repair.optimizeOrientation.desc": {
    en: "Large contiguous support region suggests suboptimal orientation. Rotate to minimize total overhang area.",
    ja: "大きな連続サポート領域は向きが最適でない可能性。総オーバーハング面積が最小になるよう回転してください。",
    zh: "大型连续支撑区域提示方向非最优。请旋转以最小化总悬垂面积。",
  },
  "cad.repair.mergeComponents.action": {
    en: "Merge disconnected components",
    ja: "分離コンポーネントを結合",
    zh: "合并不连通组件",
  },
  "cad.repair.mergeComponents.desc": {
    en: "{count} disconnected shells detected. If these should be a single part, use boolean union operations.",
    ja: "{count}個の分離シェルを検出。単一部品として扱う場合はブール和を使用してください。",
    zh: "检测到{count}个不连通壳体。若应为单一零件，请使用布尔并集运算。",
  },
  "cad.repair.gradualOverhang.action": {
    en: "Add gradual overhang transitions",
    ja: "オーバーハングの漸次遷移を追加",
    zh: "添加渐进悬垂过渡",
  },
  "cad.repair.gradualOverhang.desc": {
    en: "Moderate overhangs benefit from chamfered or filleted transitions that reduce the effective overhang angle.",
    ja: "中程度のオーバーハングは面取りやフィレットで実効角度を下げると効果的です。",
    zh: "中度悬垂可受益于倒角或圆角过渡，以降低有效悬垂角。",
  },
  "cad.issue.severeOverhang": {
    en: "Severe overhang — supports required",
    ja: "深刻なオーバーハング — サポート必須",
    zh: "严重悬垂 — 需要支撑",
  },
  "cad.issue.moderateOverhang": {
    en: "Moderate overhang may need supports",
    ja: "中程度のオーバーハングはサポートが必要かも",
    zh: "中度悬垂可能需要支撑",
  },
  "cad.issue.paintSupports": {
    en: "Use paint-on supports in slicer",
    ja: "スライサーでペイントサポートを使用",
    zh: "在切片软件中使用笔刷支撑",
  },
  "cad.issue.nonManifold": {
    en: "Non-manifold mesh — may cause slicing errors",
    ja: "非マニフォールドメッシュ — スライスエラーの可能性",
    zh: "非流形网格 — 可能导致切片错误",
  },
  "cad.issue.runRepair": {
    en: "Run mesh repair",
    ja: "メッシュ修復を実行",
    zh: "运行网格修复",
  },
  "cad.issue.notWatertight": {
    en: "Mesh is not watertight (has holes)",
    ja: "メッシュが水密でない（穴あり）",
    zh: "网格不水密（有孔洞）",
  },
  "cad.issue.closeHoles": {
    en: "Close mesh holes in CAD",
    ja: "CADでメッシュの穴を塞ぐ",
    zh: "在CAD中封闭网格孔洞",
  },
  "cad.issue.thinWalls": {
    en: "Thin walls on {pct}% of surface",
    ja: "表面の{pct}%が薄肉",
    zh: "{pct}%的表面为薄壁",
  },
  "cad.issue.thickenTo12": {
    en: "Increase wall thickness to ≥1.2mm",
    ja: "肉厚を1.2mm以上に",
    zh: "壁厚增加到1.2mm以上",
  },
  "cad.issue.someThinWalls": {
    en: "Some thin walls ({pct}% of surface)",
    ja: "一部薄肉（表面の{pct}%）",
    zh: "部分薄壁（{pct}%的表面）",
  },
  "cad.issue.reinforce": {
    en: "Reinforce problem areas",
    ja: "問題領域を補強",
    zh: "加固问题区域",
  },
  "cad.issue.difficultSupport": {
    en: "Very difficult support structure required",
    ja: "非常に困難なサポート構造が必要",
    zh: "需要非常困难的支撑结构",
  },
  "cad.issue.splitModel": {
    en: "Split model or redesign overhangs",
    ja: "モデル分割またはオーバーハング再設計",
    zh: "拆分模型或重新设计悬垂",
  },
  "cad.issue.complexSupport": {
    en: "Complex support structure needed",
    ja: "複雑なサポート構造が必要",
    zh: "需要复杂支撑结构",
  },
  "cad.issue.considerOrientation": {
    en: "Consider print orientation",
    ja: "造形向きを検討",
    zh: "可考虑打印方向",
  },
  "cad.explanation.recommended": {
    en: "Model appears manufacturable. Consider running a test print.",
    ja: "モデルは造形可能と思われます。テスト印刷を検討してください。",
    zh: "模型可制造。可考虑进行试印。",
  },
  "cad.explanation.review": {
    en: "Review highlighted issues and consider adjusting design parameters before printing.",
    ja: "強調表示された問題を確認し、印刷前に設計パラメータの調整を検討してください。",
    zh: "打印前请复核标记的问题，并考虑调整设计参数。",
  },
  "cad.explanation.regenerate": {
    en: "Significant design issues detected. Consider regenerating with modified parameters.",
    ja: "重大な設計問題を検出。パラメータを変更して再生成を検討してください。",
    zh: "检测到重大设计问题。可考虑修改参数后重新生成。",
  },
  "cad.catLabel.topology": {
    en: "Topology",
    ja: "トポロジー",
    zh: "拓扑",
  },
  "cad.catLabel.validation": {
    en: "Validation",
    ja: "検証",
    zh: "验证",
  },
  "cad.catLabel.geometry": {
    en: "Geometry",
    ja: "ジオメトリ",
    zh: "几何",
  },
  "cad.catLabel.printability": {
    en: "Printability",
    ja: "プリント適性",
    zh: "可打印性",
  },
  "cad.cat.nonManifold": {
    en: "Non-manifold mesh",
    ja: "非マニフォールドメッシュ",
    zh: "非流形网格",
  },
  "cad.cat.disconnectedShells": {
    en: "{count} disconnected shells",
    ja: "{count}個の分離シェル",
    zh: "{count}个不连通壳体",
  },
  "cad.cat.lowTriangles": {
    en: "Very low triangle count",
    ja: "三角形数が非常に少ない",
    zh: "三角形数量极少",
  },
  "cad.cat.notWatertight": {
    en: "Mesh is not watertight",
    ja: "メッシュが水密でない",
    zh: "网格不水密",
  },
  "cad.cat.holes": {
    en: "{count} holes detected",
    ja: "{count}個の穴を検出",
    zh: "检测到{count}个孔洞",
  },
  "cad.cat.flippedNormals": {
    en: "Flipped normals detected",
    ja: "法線反転を検出",
    zh: "检测到法线翻转",
  },
  "cad.cat.moderateOverhang": {
    en: "Moderate overhang",
    ja: "中程度のオーバーハング",
    zh: "中度悬垂",
  },
  "cad.cat.severeOverhang": {
    en: "Severe overhang",
    ja: "深刻なオーバーハング",
    zh: "严重悬垂",
  },
  "cad.cat.someThinWalls": {
    en: "Some thin walls",
    ja: "一部の薄肉",
    zh: "部分薄壁",
  },
  "cad.cat.extensiveThinWalls": {
    en: "Extensive thin walls",
    ja: "広範囲の薄肉",
    zh: "大面积薄壁",
  },
  "cad.cat.zeroVolume": {
    en: "Zero or negative volume",
    ja: "体積がゼロ以下",
    zh: "体积为零或负值",
  },
  "cad.cat.moderateSupport": {
    en: "Moderate support needed",
    ja: "中程度のサポートが必要",
    zh: "需要中度支撑",
  },
  "cad.cat.complexSupport": {
    en: "Complex support required",
    ja: "複雑なサポートが必要",
    zh: "需要复杂支撑",
  },
  "cad.cat.exceedsBed": {
    en: "Model exceeds printer bed",
    ja: "モデルがプリントベッドを超えています",
    zh: "模型超出打印平台",
  },
  "cad.cat.largeVolume": {
    en: "Large print volume — long print time expected",
    ja: "大きな造形体積 — 長い印刷時間が見込まれます",
    zh: "大打印体积 — 预计打印时间较长",
  },
  "cad.intent.dimsVerified": {
    en: "{passed}/{total} requested dimensions verified",
    ja: "要求寸法 {passed}/{total} を検証",
    zh: "已核验 {passed}/{total} 个所需尺寸",
  },
  "cad.intent.dimsNotVerifiable": {
    en: "Dimensions extracted but not verifiable from geometry",
    ja: "寸法は抽出できたがジオメトリから検証不可",
    zh: "已提取尺寸，但无法从几何验证",
  },
  "cad.intent.processCompatible": {
    en: "{process} process compatible with geometry",
    ja: "{process}プロセスはジオメトリと互換",
    zh: "{process}工艺与几何兼容",
  },
  "cad.intent.processNeedsAdjust": {
    en: "{process} process may require support or orientation adjustments",
    ja: "{process}プロセスにはサポートや向きの調整が必要かも",
    zh: "{process}工艺可能需要支撑或方向调整",
  },
  "cad.intent.requirementsMet": {
    en: "Geometry supports stated functional requirements",
    ja: "ジオメトリは機能要件を満たしています",
    zh: "几何满足所述功能要求",
  },
  "cad.intent.requirementsNotMet": {
    en: "Geometry may not meet all stated requirements",
    ja: "ジオメトリが全要件を満たさない可能性",
    zh: "几何可能无法满足全部要求",
  },
  "cad.intent.limited": {
    en: "Design intent parsed; verification limited by prompt specificity",
    ja: "設計意図を解析。プロンプトの具体性により検証は限定的",
    zh: "已解析设计意图；验证受提示词具体性限制",
  },
  "pdf.title": {
    en: "Print Analysis Report",
    ja: "プリント分析レポート",
    zh: "打印分析报告",
  },
  "pdf.brand": {
    en: "3DP AGENT · PRINTABILITY ASSESSMENT",
    ja: "3DPエージェント · プリント性評価",
    zh: "3DP 智能体 · 可打印性评估",
  },
  "pdf.verdict.ready": {
    en: "Ready to print",
    ja: "印刷可能です",
    zh: "可直接打印",
  },
  "pdf.verdict.review": {
    en: "Review recommended",
    ja: "要確認",
    zh: "建议复核",
  },
  "pdf.verdict.notReady": {
    en: "High print-failure risk",
    ja: "印刷リスクが高い",
    zh: "打印失败风险较高",
  },
  "pdf.verdict.readyShort": {
    en: "Ready to print",
    ja: "印刷可能",
    zh: "可直接打印",
  },
  "pdf.verdict.issuesFound": {
    en: "Issues found",
    ja: "問題が検出されました",
    zh: "发现问题",
  },
  "pdf.verdictDesc.noIssues": {
    en: "No issues detected",
    ja: "特に問題はありません",
    zh: "未发现问题",
  },
  "pdf.verdictDesc.minor": {
    en: "Minor issues found",
    ja: "軽微な問題があります",
    zh: "发现轻微问题",
  },
  "pdf.verdictDesc.count": {
    en: "{count} issue(s) found",
    ja: "{count}件の問題があります",
    zh: "发现{count}个问题",
  },
  "pdf.verdictDesc.fixFirst": {
    en: "Fix before print",
    ja: "印刷前に修正推奨",
    zh: "打印前建议修复",
  },
  "pdf.verdictDesc.cautions": {
    en: "Minor cautions",
    ja: "軽微な注意点あり",
    zh: "有轻微注意点",
  },
  "pdf.verdictDesc.clean": {
    en: "No issues",
    ja: "問題なし",
    zh: "无问题",
  },
  "pdf.section.dimensions": {
    en: "DIMENSIONS & ESTIMATES",
    ja: "寸法と推定",
    zh: "尺寸与估算",
  },
  "pdf.section.dimensionsShort": {
    en: "DIMENSIONS",
    ja: "寸法",
    zh: "尺寸",
  },
  "pdf.section.issuesFound": {
    en: "ISSUES FOUND",
    ja: "検出された問題",
    zh: "发现的问题",
  },
  "pdf.section.keyMetrics": {
    en: "KEY METRICS",
    ja: "主要指標",
    zh: "关键指标",
  },
  "pdf.section.issues": {
    en: "ISSUES",
    ja: "問題点",
    zh: "问题",
  },
  "pdf.section.issuesContinued": {
    en: "ISSUES (continued)",
    ja: "問題点（続き）",
    zh: "问题（续）",
  },
  "pdf.section.topology": {
    en: "TOPOLOGY",
    ja: "トポロジー",
    zh: "拓扑",
  },
  "pdf.section.validation": {
    en: "VALIDATION",
    ja: "検証",
    zh: "验证",
  },
  "pdf.section.metrics": {
    en: "METRICS",
    ja: "指標",
    zh: "指标",
  },
  "pdf.section.support": {
    en: "SUPPORT",
    ja: "サポート",
    zh: "支撑",
  },
  "pdf.section.printTime": {
    en: "PRINT TIME & MATERIAL",
    ja: "印刷時間と材料",
    zh: "打印时间与材料",
  },
  "pdf.section.overhangBreakdown": {
    en: "OVERHANG BREAKDOWN",
    ja: "オーバーハング内訳",
    zh: "悬垂明细",
  },
  "pdf.label.size": {
    en: "Size",
    ja: "サイズ",
    zh: "尺寸",
  },
  "pdf.label.dimensions": {
    en: "Dimensions",
    ja: "寸法",
    zh: "尺寸",
  },
  "pdf.label.weight": {
    en: "Est. weight",
    ja: "推定重量",
    zh: "估算重量",
  },
  "pdf.label.time": {
    en: "Est. print time",
    ja: "推定印刷時間",
    zh: "估算打印时间",
  },
  "pdf.label.cost": {
    en: "Est. cost",
    ja: "推定コスト",
    zh: "估算成本",
  },
  "pdf.label.volume": {
    en: "Volume",
    ja: "体積",
    zh: "体积",
  },
  "pdf.label.minWall": {
    en: "Min wall thickness",
    ja: "最小壁厚",
    zh: "最小壁厚",
  },
  "pdf.label.p5Wall": {
    en: "p5 wall thickness",
    ja: "5パーセンタイル壁厚",
    zh: "p5壁厚",
  },
  "pdf.label.overhang": {
    en: "Overhang",
    ja: "オーバーハング",
    zh: "悬垂",
  },
  "pdf.label.support": {
    en: "Support",
    ja: "サポート",
    zh: "支撑",
  },
  "pdf.label.supportRegions": {
    en: "Support regions",
    ja: "サポート領域",
    zh: "支撑区域",
  },
  "pdf.label.largestIsland": {
    en: "Largest island",
    ja: "最大島比率",
    zh: "最大支撑岛",
  },
  "pdf.label.watertight": {
    en: "Watertight",
    ja: "密閉性",
    zh: "水密性",
  },
  "pdf.label.triangles": {
    en: "Triangles",
    ja: "三角形",
    zh: "三角形",
  },
  "pdf.label.vertices": {
    en: "Vertices",
    ja: "頂点",
    zh: "顶点",
  },
  "pdf.label.manifoldEdges": {
    en: "Manifold edges",
    ja: "マニフォールド辺",
    zh: "流形边",
  },
  "pdf.label.nonManifoldEdges": {
    en: "Non-manifold edges",
    ja: "非マニフォールド辺",
    zh: "非流形边",
  },
  "pdf.label.manifold": {
    en: "Manifold",
    ja: "多様体",
    zh: "流形",
  },
  "pdf.label.shells": {
    en: "Shells",
    ja: "シェル",
    zh: "壳体",
  },
  "pdf.label.boundaryEdges": {
    en: "Boundary edges",
    ja: "境界辺",
    zh: "边界边",
  },
  "pdf.label.normalOrientation": {
    en: "Normal orientation",
    ja: "法線方向",
    zh: "法线方向",
  },
  "pdf.label.holes": {
    en: "Holes",
    ja: "穴",
    zh: "孔洞",
  },
  "pdf.label.flippedNormalRatio": {
    en: "Flipped normal ratio",
    ja: "法線反転率",
    zh: "法线翻转率",
  },
  "pdf.label.degenerateFaces": {
    en: "Degenerate faces",
    ja: "退化面",
    zh: "退化面",
  },
  "pdf.label.surfaceArea": {
    en: "Surface area",
    ja: "表面積",
    zh: "表面积",
  },
  "pdf.label.overhangFaces": {
    en: "Overhang faces",
    ja: "オーバーハング面",
    zh: "悬垂面",
  },
  "pdf.label.overhangRatio": {
    en: "Overhang ratio",
    ja: "オーバーハング率",
    zh: "悬垂比例",
  },
  "pdf.label.overhangSeverity": {
    en: "Overhang severity",
    ja: "オーバーハング深刻度",
    zh: "悬垂严重度",
  },
  "pdf.label.status": {
    en: "Status",
    ja: "状態",
    zh: "状态",
  },
  "pdf.label.supportVolume": {
    en: "Support volume",
    ja: "サポート体積",
    zh: "支撑体积",
  },
  "pdf.label.tallSupportRatio": {
    en: "Tall support ratio",
    ja: "高いサポート比率",
    zh: "高支撑比例",
  },
  "pdf.label.directionality": {
    en: "Directionality",
    ja: "方向性",
    zh: "方向性",
  },
  "pdf.label.printTime": {
    en: "Print time",
    ja: "印刷時間",
    zh: "打印时间",
  },
  "pdf.label.materialWeight": {
    en: "Material weight",
    ja: "材料重量",
    zh: "材料重量",
  },
  "pdf.label.materialCost": {
    en: "Material cost",
    ja: "材料費",
    zh: "材料成本",
  },
  "pdf.label.totalCost": {
    en: "Total cost",
    ja: "合計コスト",
    zh: "总成本",
  },
  "pdf.label.layerCount": {
    en: "Layer count",
    ja: "層数",
    zh: "层数",
  },
  "pdf.label.faces": {
    en: "faces",
    ja: "面",
    zh: "个面",
  },
  "pdf.status.critical": {
    en: "Critical",
    ja: "重大",
    zh: "严重",
  },
  "pdf.status.warning": {
    en: "Warning",
    ja: "警告",
    zh: "警告",
  },
  "pdf.status.good": {
    en: "Good",
    ja: "良好",
    zh: "良好",
  },
  "pdf.noIssues": {
    en: "No issues found.",
    ja: "問題は見つかりませんでした。",
    zh: "未发现问题。",
  },
  "pdf.noIssuesDetected": {
    en: "No issues detected.",
    ja: "問題は検出されませんでした。",
    zh: "未检测到问题。",
  },
  "pdf.suggestion.good": {
    en: "This model looks good. Proceed with printing.",
    ja: "このモデルは良好です。そのまま印刷してください。",
    zh: "该模型良好，请直接打印。",
  },
  "pdf.suggestion.increaseWall": {
    en: "Increase wall thickness",
    ja: "壁厚を増やしてください",
    zh: "增加壁厚",
  },
  "pdf.suggestion.enableSupport": {
    en: "Enable support structures",
    ja: "サポート材を有効にしてください",
    zh: "启用支撑结构",
  },
  "pdf.suggestion.runRepair": {
    en: "Run mesh repair",
    ja: "メッシュ修復を実行してください",
    zh: "运行网格修复",
  },
  "pdf.suggest": {
    en: "Suggest: {parts}",
    ja: "推奨: {parts}",
    zh: "建议: {parts}",
  },
  "pdf.reviewIssues": {
    en: "Review issues and adjust",
    ja: "問題点を確認して調整してください",
    zh: "复核问题并调整",
  },
  "pdf.estimate.unavailable": {
    en: "Weight / time / cost unavailable — open shell. Repair first, then re-export.",
    ja: "体積未確定のため重量・時間・コストは算出不可。修復後に再出力してください。",
    zh: "体积未确定，重量/时间/成本无法计算。请修复后再重新导出。",
  },
  "pdf.nextStep.cheapest": {
    en: "Cheapest next step",
    ja: "最安の次の一手",
    zh: "成本最低的下一步",
  },
  "pdf.cheapest.repair": {
    en: "Run mesh repair first — estimates return once the shell is closed.",
    ja: "まずメッシュ修復 — 閉じれば推定が出ます。",
    zh: "先运行网格修复 — 封闭后即可给出估算。",
  },
  "pdf.cheapest.scale": {
    en: "Scale up 2× or switch to SLA — cheapest way out of thin walls.",
    ja: "2倍に拡大かSLAへ — 薄肉の最安回避策。",
    zh: "放大2倍或改用SLA — 薄壁最省钱的解法。",
  },
  "pdf.cheapest.support": {
    en: "Enable supports / adjust orientation — cheapest fix for overhangs.",
    ja: "サポート有効化か向き調整 — 張り出しの最安修正。",
    zh: "启用支撑或调整方向 — 悬垂最省钱的修正。",
  },
  "pdf.nextStep": {
    en: "Next step: share this report with your designer, or visit 3dp-agent.vercel.app for assistance.",
    ja: "次のステップ: このレポートをデザイナーと共有するか、3dp-agent.vercel.app にアクセスして支援を受けてください。",
    zh: "下一步: 与设计师分享此报告，或访问 3dp-agent.vercel.app 获取帮助。",
  },
  "handoff.quoteTitle": {
    en: "Quote (draft)",
    ja: "見積書（ドラフト）",
    zh: "报价单（草稿）",
  },
  "handoff.copyQuote": {
    en: "COPY QUOTE",
    ja: "見積コピー",
    zh: "复制报价",
  },
  "handoff.copied": {
    en: "✓ Copied — fill in rates",
    ja: "✓ コピー済 — 金額を記入",
    zh: "✓ 已复制 — 请填写金额",
  },
  "handoff.jsonExport": {
    en: "JSON",
    ja: "JSON出力",
    zh: "导出 JSON",
  },
  "handoff.jsonHint": {
    en: "Download handoff.json — one machine-readable file for optimizers and factory systems.",
    ja: "handoff.jsonを保存 — 最適化・工場システム用の機械可読ファイル。",
    zh: "下载 handoff.json — 给优化器和工厂系统的机器可读文件。",
  },
  "handoff.quoteFooter": {
    en: "Rates to fill: material / machine time / failure cover (see docs/handoff).",
    ja: "金額欄は手入力：材料費 / 機時 / 失敗保険（docs/handoff参照）。",
    zh: "金额栏请手填：材料费 / 机时 / 失败险（见 docs/handoff）。",
  },
  "pdf.disclaimer": {
    en: "This report is an automated estimate. Actual print results may vary based on material, slicer settings, and printer calibration. Report ID: {id}",
    ja: "このレポートは自動推定です。実際の印刷結果は素材・スライサー設定・プリンター校正により異なる場合があります。レポート ID: {id}",
    zh: "此报告为自动估算。实际打印结果可能因材料、切片设置和打印机校准而异。报告ID: {id}",
  },
  "pdf.expertReview": {
    en: "AI EXPERT REVIEW",
    ja: "AI専門家レビュー",
    zh: "AI 专家解读",
  },
  "pdf.expertFindings": {
    en: "WHAT THE EXPERT SEES",
    ja: "専門家の所見",
    zh: "专家看到的问题",
  },
  "pdf.expertActions": {
    en: "WHAT TO DO NEXT",
    ja: "次のアクション",
    zh: "接下来怎么做",
  },
  "pdf.limitsTitle": {
    en: "METHODOLOGY & LIMITS",
    ja: "手法と限界",
    zh: "方法与边界",
  },
  "pdf.limitsMeasured": {
    en: "MEASURED — geometry metrics (wall, overhang, watertight, support): deterministic, reliable.",
    ja: "測定値 — 幾何メトリクス（肉厚・オーバーハング・水密・サポート）：決定論的で信頼できます。",
    zh: "测量值 — 几何指标（壁厚、悬垂、水密、支撑）：确定性计算，可靠。",
  },
  "pdf.limitsAi": {
    en: "AI OPINION — expert review & deep analysis: interpretation only; may err on details; measured results remain authoritative.",
    ja: "AI の意見 — 専門家レビューとディープ分析：あくまで解釈。詳細は誤る可能性があります。測定結果が優先です。",
    zh: "AI 意见 — 专家解读与深度分析：仅为解读，细节可能有误；以测量结果为准。",
  },
  "pdf.limitsNotAnalyzed": {
    en: "NOT ANALYZED — thermal/FEA simulation, slicer settings, and real printer calibration.",
    ja: "未分析 — 熱/FEA シミュレーション、スライサー設定、実機キャリブレーション。",
    zh: "未分析 — 热力学/FEA 仿真、切片参数、真实打印机校准。",
  },
  "pdf.limitsNote": {
    en: "Boundary: geometry is measured; AI text is opinion (may be wrong); thermal/slicer behavior is not simulated.",
    ja: "境界: 幾何は測定値、AI テキストは意見（誤る可能性あり）、熱/スライサー挙動は未シミュレーション。",
    zh: "边界: 几何为测量值，AI 文案为意见（可能出错），热力学/切片行为未仿真。",
  },
  "pdf.production": {
    en: "PRODUCTION SUITABILITY",
    ja: "量産適合性",
    zh: "量产适性",
  },
  "pdf.prodPerBatch": {
    en: "Parts per build",
    ja: "1ビルドあたり部品数",
    zh: "每炉件数",
  },
  "pdf.prodPerPartCost": {
    en: "Per-part cost",
    ja: "単品コスト",
    zh: "单件成本",
  },
  "pdf.prodVerdict": {
    en: "Verdict",
    ja: "判定",
    zh: "判定",
  },
  "pdf.prodProduction": {
    en: "Production-ready",
    ja: "量産向き",
    zh: "适合量产",
  },
  "pdf.prodSmallBatch": {
    en: "Small-batch",
    ja: "小ロット向き",
    zh: "适合小批量",
  },
  "pdf.prodPrototype": {
    en: "Prototype only",
    ja: "試作向き",
    zh: "仅适合原型",
  },
  "pdf.prodAdvisory": {
    en: "Directional estimate — not a manufacturing quote.",
    ja: "方向性の推定 — 製造見積りではありません。",
    zh: "方向性估算 — 不是制造报价。",
  },
  "pdf.issue.client.thinWallsCritical": {
    en: "{pct}% of sampled walls are below safe thickness — risk of print failure.",
    ja: "サンプル壁の{pct}%が安全肉厚未満 — 印刷失敗のリスク。",
    zh: "{pct}%的采样壁低于安全厚度 — 存在打印失效风险。",
  },
  "pdf.issue.client.thinWallsWarning": {
    en: "{pct}% of areas have thin walls — review recommended.",
    ja: "{pct}%の領域で壁が薄いです。印刷前に確認を推奨。",
    zh: "{pct}%的区域壁偏薄 — 建议打印前复核。",
  },
  "pdf.issue.client.lowConfidence": {
    en: "{prefix}Low confidence measurement, results are approximate.",
    ja: "{prefix}信頼度が低いため、壁厚測定は参考値です。",
    zh: "{prefix}置信度较低，壁厚测量值仅供参考。",
  },
  "pdf.issue.client.gaps": {
    en: "The model has gaps — it's not fully closed.",
    ja: "モデルに隙間があり、完全に閉じていません。",
    zh: "模型存在缝隙，未完全封闭。",
  },
  "pdf.issue.client.holes": {
    en: "{count} hole(s) found in the model.",
    ja: "{count}ヶ所に穴があります。",
    zh: "模型中发现{count}个孔洞。",
  },
  "pdf.issue.client.flipped": {
    en: "Some surfaces are facing the wrong way — this may affect appearance.",
    ja: "一部の面が裏返しになっています。見た目に影響するかもしれません。",
    zh: "部分表面方向错误 — 可能影响外观。",
  },
  "pdf.issue.client.overhangCritical": {
    en: "Large overhanging areas will need support material.",
    ja: "大きく張り出した部分があります。サポート材が必要です。",
    zh: "大面积悬垂区域需要支撑材料。",
  },
  "pdf.issue.client.overhangWarning": {
    en: "Some areas stick out — consider using supports.",
    ja: "やや張り出した部分があります。サポート材を検討してください。",
    zh: "部分区域外凸 — 可考虑使用支撑。",
  },
  "pdf.issue.client.supportCritical": {
    en: "Complex support structure — removal may be difficult.",
    ja: "サポート構造が複雑で、除去が難しい可能性があります。",
    zh: "支撑结构复杂 — 拆除可能困难。",
  },
  "pdf.issue.client.supportWarning": {
    en: "Support caution: {reason}",
    ja: "サポートに関する注意: {reason}",
    zh: "支撑注意: {reason}",
  },
  "pdf.issue.designer.wallsCritical": {
    en: "Walls: {pct}% of samples below FDM threshold (p5={p5} mm) — widespread thin walls",
    ja: "壁厚: サンプルの{pct}%がFDM閾値未満 (p5={p5} mm) — 広範囲に薄い壁",
    zh: "壁厚: {pct}%的样本低于FDM阈值（p5={p5} mm）— 大范围薄壁",
  },
  "pdf.issue.designer.wallsWarning": {
    en: "Walls: {pct}% of areas thin (p10={p10} mm)",
    ja: "壁厚: {pct}%の領域で薄い (p10={p10} mm)",
    zh: "壁厚: {pct}%的区域偏薄（p10={p10} mm）",
  },
  "pdf.issue.designer.lowConfidence": {
    en: "Wall thickness confidence low ({conf}%). {prefix}",
    ja: "壁厚測定の信頼度が低い ({conf}%)。{prefix}",
    zh: "壁厚测量置信度低（{conf}%）。{prefix}",
  },
  "pdf.issue.designer.notWatertight": {
    en: "Mesh is not watertight. May cause slicing errors.",
    ja: "メッシュが密閉されていません。スライサーエラーの原因になります。",
    zh: "网格不水密，可能导致切片错误。",
  },
  "pdf.issue.designer.holes": {
    en: "{count} hole(s) found. Repair before slicing.",
    ja: "メッシュに{count}個の穴があります。印刷前に修正してください。",
    zh: "发现{count}个孔洞。切片前请修复。",
  },
  "pdf.issue.designer.flipped": {
    en: "{pct}% of faces have inverted normals. May cause slicing artifacts.",
    ja: "面の{pct}% で法線が反転しています。スライスアーティファクトの原因に。",
    zh: "{pct}%的面法线反转，可能导致切片伪影。",
  },
  "pdf.issue.designer.overhangCritical": {
    en: "Severe overhang. Support structures are required.",
    ja: "深刻なオーバーハング。サポート構造が必須です。",
    zh: "严重悬垂。必须使用支撑结构。",
  },
  "pdf.issue.designer.overhangWarning": {
    en: "Moderate overhang. Support structures are advisable.",
    ja: "中程度のオーバーハング。サポート構造を推奨します。",
    zh: "中度悬垂。建议使用支撑结构。",
  },
  "pdf.issue.designer.supportCritical": {
    en: "Support structure issue detected",
    ja: "サポート構造に問題があります",
    zh: "检测到支撑结构问题",
  },
  "pdf.issue.designer.supportWarning": {
    en: "Support: {reason}",
    ja: "サポート: {reason}",
    zh: "支撑: {reason}",
  },
  "pdf.labelWeightNote": {
    en: "varies by infill",
    ja: "インフィルにより変動",
    zh: "随填充率变化",
  },
  "pdf.labelTimeNote": {
    en: "excl. supports",
    ja: "サポート除く",
    zh: "不含支撑",
  },
  "pdf.labelQuickCheck": {
    en: "QUICK CHECK",
    ja: "クイックチェック",
    zh: "快速检查",
  },
  "pdf.labelPenalty": {
    en: "Gate score — a hard-block check, not a quality rating. The Agents tab holds the weighted quality score.",
    ja: "ゲートスコア — 可否判定であり品質評価ではありません。品質の加重スコアはエージェントタブにあります。",
    zh: "闸门分 — 用于判定能否打印，不是质量评分；质量加权分在智能体页。",
  },
  "pdf.gateTag": {
    en: "GATE",
    ja: "ゲート",
    zh: "闸门",
  },
  "pdf.labelExport": {
    en: "EXPORT REPORT",
    ja: "レポート出力",
    zh: "导出报告",
  },
  "pdf.exportPdf": {
    en: "EXPORT PDF",
    ja: "PDF出力",
    zh: "导出 PDF",
  },
  "pdf.tier.client": {
    en: "CLIENT",
    ja: "クライアント",
    zh: "客户",
  },
  "pdf.tier.designer": {
    en: "DESIGNER",
    ja: "デザイナー",
    zh: "设计师",
  },
  "pdf.tier.factory": {
    en: "FACTORY",
    ja: "工場",
    zh: "工厂",
  },
  "rule.wallCritical": {
    en: "Widespread thin walls: {pct}% of sampled regions below FDM threshold. Minimum measured: {t}. Confidence: {conf}",
    ja: "壁厚過小: サンプルの{pct}%がFDM閾値未満。最小測定: {t}。信頼度: {conf}",
    zh: "壁厚过薄: {pct}% 采样区域低于FDM阈值。最小测量值: {t}。置信度: {conf}",
  },
  "rule.wallCriticalIsolated": {
    en: "Isolated thin wall anomaly. Minimum measured: {t}, but only {pct}% of sampled regions below threshold. Confidence: {conf}",
    ja: "孤立した薄壁異常を検出。最小測定: {t}、ただしサンプルの{pct}%のみが閾値未満。信頼度: {conf}",
    zh: "检测到孤立薄壁异常。最小测量值: {t}，但仅{pct}%采样区域低于阈值。置信度: {conf}",
  },
  "rule.wallWarning": {
    en: "{pct}% of sampled walls are thin (p5={t}). Consider thickening to 2mm+",
    ja: "サンプルの{pct}%が薄い壁 (p5={t})。2mm以上を推奨",
    zh: "{pct}% 采样区域壁厚偏薄 (p5={t})。建议加厚至2mm以上",
  },
  "rule.overhang": {
    en: "{areas} faces exceed {threshold}° — support structures required",
    ja: "{areas}面が{threshold}°超 — サポート必要",
    zh: "{areas} 个悬垂面超过{threshold}°，需要支撑",
  },
  "rule.sizeUnusual": {
    en: "This size looks unusual for millimeters (longest side={max}mm) — was this modeled in inches?",
    ja: "サイズが不自然です (最大辺={max}mm) —— インチでモデリングされていませんか？",
    zh: "尺寸看起来不寻常 (最长边={max}mm) —— 这个模型是用英寸建模的吗？",
  },
  "rule.processLarge": {
    en: "FDM (large part)",
    ja: "FDM（大型）",
    zh: "FDM (大型件)",
  },
  "rule.processMid": {
    en: "FDM / SLA",
    ja: "FDM / SLA",
    zh: "FDM / SLA",
  },
  "rule.processSmall": {
    en: "SLA / SLS (fine detail)",
    ja: "SLA / SLS（精細）",
    zh: "SLA / SLS (精细件)",
  },
  "rule.processUnknown": {
    en: "Process TBD (open shell)",
    ja: "工法未定（非水密）",
    zh: "工艺待定（非水密件）",
  },
  "rule.volumeUnmeasurable": {
    en: "Volume-based estimate unavailable: this mesh is not closed, so it encloses no defined volume. Seal the shell to enable volume, mass, time and cost estimates.",
    ja: "体積ベースの推定は不可：メッシュが閉じていないため体積が定義されません。閉じたシェルにすると体積・重量・時間・コストの推定が有効になります。",
    zh: "无法给出基于体积的估算：模型非水密，不存在封闭体积。封闭网格后即可启用体积、重量、时间与成本估算。",
  },
  "rule.verdictOk": {
    en: "✓ Print-ready",
    ja: "✓ 印刷可能",
    zh: "✓ 可直接打印",
  },
  "rule.verdictFix": {
    en: "⚠ Needs fixes before printing",
    ja: "⚠ 修正が必要",
    zh: "⚠ 需要修复后打印",
  },
  "rule.dims": {
    en: "Dims: {x} × {y} × {z} mm",
    ja: "寸法: {x} × {y} × {z} mm",
    zh: "尺寸: {x} × {y} × {z} mm",
  },
  "rule.processLabel": {
    en: "Recommended: {process}",
    ja: "推奨工法: {process}",
    zh: "推荐工艺: {process}",
  },
  "rule.layer": {
    en: "Layer: 0.2mm  Infill: 20%",
    ja: "積層ピッチ: 0.2mm  充填率: 20%",
    zh: "层高建议: 0.2mm  填充率: 20%",
  },
} as const;

export type MessageKey = keyof typeof MESSAGES;
