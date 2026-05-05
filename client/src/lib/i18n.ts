/**
 * 3DP Agent - Internationalization
 * Supports: English, Japanese, Chinese
 */

export type Language = 'en' | 'ja' | 'zh';

export const translations = {
  en: {
    title: '3DP Agent',
    subtitle: 'AI Consultant for 3D Printing',
    scrollHint: 'Scroll to Initialize',
    designIntelligence: 'Design Intelligence',
    designDesc:
      'Upload your STL model. Our AI advisor analyzes printability, identifies potential issues, and provides optimization recommendations in real-time.',
    beginAnalysis: 'Begin Analysis',
    uploadHint: 'Drag STL file here or click to upload',
    uploadButton: 'Upload Model',
    analysisFeatures: 'Analysis Features',
    wallThickness: 'Wall Thickness',
    wallThicknessDesc: 'Detects areas too thin for reliable printing',
    overhangDetection: 'Overhang Detection',
    overhangDesc: 'Identifies angles requiring support structures',
    materialOptimization: 'Material Optimization',
    materialDesc: 'Recommends optimal materials and settings',
    supplierMatching: 'Supplier Matching',
    supplierDesc: 'Connects you with ideal manufacturing partners',
    footer: '3DP Agent © 2026 | Powered by Advanced AI Analysis',
  },
  ja: {
    title: '3DP Agent',
    subtitle: '3Dプリント AI コンサルタント',
    scrollHint: 'スクロールして開始',
    designIntelligence: 'デザイン インテリジェンス',
    designDesc:
      'STL モデルをアップロードしてください。AI アドバイザーが印刷可能性を分析し、潜在的な問題を特定し、リアルタイムで最適化の推奨事項を提供します。',
    beginAnalysis: '分析を開始',
    uploadHint: 'STL ファイルをここにドラッグするか、クリックしてアップロード',
    uploadButton: 'モデルをアップロード',
    analysisFeatures: '分析機能',
    wallThickness: '壁厚検出',
    wallThicknessDesc: '印刷に適さない薄い領域を検出',
    overhangDetection: 'オーバーハング検出',
    overhangDesc: 'サポート構造が必要な角度を特定',
    materialOptimization: '材料最適化',
    materialDesc: '最適な材料と設定を推奨',
    supplierMatching: 'サプライヤー マッチング',
    supplierDesc: '理想的な製造パートナーとつなぐ',
    footer: '3DP Agent © 2026 | 高度な AI 分析により提供',
  },
  zh: {
    title: '3DP Agent',
    subtitle: '3D 打印 AI 顾问',
    scrollHint: '向下滚动以初始化',
    designIntelligence: '设计智能',
    designDesc:
      '上传您的 STL 模型。我们的 AI 顾问分析可打印性，识别潜在问题，并实时提供优化建议。',
    beginAnalysis: '开始分析',
    uploadHint: '将 STL 文件拖到此处或点击上传',
    uploadButton: '上传模型',
    analysisFeatures: '分析功能',
    wallThickness: '壁厚检测',
    wallThicknessDesc: '检测过薄而不适合打印的区域',
    overhangDetection: '悬垂检测',
    overhangDesc: '识别需要支撑结构的角度',
    materialOptimization: '材料优化',
    materialDesc: '推荐最优的材料和设置',
    supplierMatching: '供应商匹配',
    supplierDesc: '连接您与理想的制造合作伙伴',
    footer: '3DP Agent © 2026 | 由先进 AI 分析提供支持',
  },
};

export function getTranslation(lang: Language, key: keyof (typeof translations)['en']): string {
  return translations[lang][key] || translations.en[key];
}
