/**
 * PriceListManager — Manage supplier price lists
 *
 * Upload CSV, view/edit prices, download sample template.
 */

import { useState, useRef } from 'react';
import type { SupplierPriceList } from '@shared/domain/order';
import { parsePriceListCSV, generateSampleCSV } from '@/lib/priceListImporter';

interface PriceListManagerProps {
  language: 'en' | 'ja' | 'zh';
  onPriceListUpdate?: (prices: SupplierPriceList[]) => void;
}

const L = {
  en: {
    title: 'PRICE LIST',
    upload: 'Upload CSV',
    download: 'Download Template',
    clear: 'Clear All',
    import: 'Import',
    material: 'Material',
    tech: 'Tech',
    priceKg: '$/kg',
    machineHr: '$/hr',
    moq: 'MOQ',
    leadTime: 'Lead',
    actions: 'Actions',
    delete: 'Delete',
    empty: 'No price data. Upload a CSV or download the template.',
    success: 'Imported {n} items',
    error: 'Import failed',
  },
  ja: {
    title: '価格リスト',
    upload: 'CSVアップロード',
    download: 'テンプレートDL',
    clear: '全削除',
    import: 'インポート',
    material: '材料',
    tech: '技術',
    priceKg: '円/kg',
    machineHr: '円/hr',
    moq: '最低',
    leadTime: '納期',
    actions: '操作',
    delete: '削除',
    empty: '価格データなし。CSVをアップロードまたはテンプレートをダウンロード。',
    success: '{n}件インポート完了',
    error: 'インポート失敗',
  },
  zh: {
    title: '价格表',
    upload: '上传 CSV',
    download: '下载模板',
    clear: '清空',
    import: '导入',
    material: '材料',
    tech: '工艺',
    priceKg: '$/kg',
    machineHr: '$/hr',
    moq: '起订',
    leadTime: '交期',
    actions: '操作',
    delete: '删除',
    empty: '暂无价格数据。上传 CSV 或下载模板。',
    success: '成功导入 {n} 条',
    error: '导入失败',
  },
};

export function PriceListManager({ language, onPriceListUpdate }: PriceListManagerProps) {
  const t = L[language] || L.en;
  const [prices, setPrices] = useState<SupplierPriceList[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      const result = parsePriceListCSV(content, 'current-supplier');

      if (result.errors.length > 0) {
        setMessage({ type: 'error', text: result.errors.join(', ') });
      } else {
        setPrices(prev => [...prev, ...result.data]);
        setMessage({ type: 'success', text: t.success.replace('{n}', String(result.data.length)) });
        onPriceListUpdate?.([...prices, ...result.data]);
      }
    } catch (err) {
      setMessage({ type: 'error', text: t.error });
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
    setTimeout(() => setMessage(null), 3000);
  };

  const handleDownloadTemplate = () => {
    const csv = generateSampleCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '3dp-agent-price-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = (index: number) => {
    setPrices(prev => prev.filter((_, i) => i !== index));
    onPriceListUpdate?.(prices.filter((_, i) => i !== index));
  };

  const handleClear = () => {
    setPrices([]);
    onPriceListUpdate?.([]);
  };

  return (
    <div className="border border-border/50 rounded-lg bg-card/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{t.title}</span>
        <span className="text-[10px] font-mono text-muted-foreground/40">{prices.length} items</span>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex-1 px-3 py-1.5 text-[10px] font-mono border border-cyan-400/30 rounded text-cyan-400 hover:bg-cyan-400/10 transition-colors"
        >
          {t.upload}
        </button>
        <button
          onClick={handleDownloadTemplate}
          className="flex-1 px-3 py-1.5 text-[10px] font-mono border border-border/30 rounded text-muted-foreground/60 hover:bg-muted/20 transition-colors"
        >
          {t.download}
        </button>
        {prices.length > 0 && (
          <button
            onClick={handleClear}
            className="px-3 py-1.5 text-[10px] font-mono border border-red-400/30 rounded text-red-400/60 hover:bg-red-400/10 transition-colors"
          >
            {t.clear}
          </button>
        )}
      </div>

      {/* Message */}
      {message && (
        <div className={`text-[10px] font-mono ${message.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </div>
      )}

      {/* Table */}
      {prices.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[9px] font-mono">
            <thead>
              <tr className="text-muted-foreground/40 border-b border-border/20">
                <th className="text-left py-1 pr-2">{t.material}</th>
                <th className="text-left py-1 pr-2">{t.tech}</th>
                <th className="text-right py-1 pr-2">{t.priceKg}</th>
                <th className="text-right py-1 pr-2">{t.machineHr}</th>
                <th className="text-right py-1 pr-2">{t.moq}</th>
                <th className="text-right py-1 pr-2">{t.leadTime}</th>
                <th className="text-right py-1">{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p, i) => (
                <tr key={i} className="text-foreground/60 border-b border-border/10 hover:bg-muted/10">
                  <td className="py-1 pr-2">{p.material}</td>
                  <td className="py-1 pr-2">{p.technology}</td>
                  <td className="text-right py-1 pr-2">${p.pricePerKg}</td>
                  <td className="text-right py-1 pr-2">${p.machineRatePerHour}</td>
                  <td className="text-right py-1 pr-2">{p.minOrderQuantity}kg</td>
                  <td className="text-right py-1 pr-2">{p.leadTimeDays}d</td>
                  <td className="text-right py-1">
                    <button
                      onClick={() => handleDelete(i)}
                      className="text-red-400/40 hover:text-red-400 transition-colors"
                    >
                      {t.delete}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-6 text-[10px] font-mono text-muted-foreground/30">
          {t.empty}
        </div>
      )}
    </div>
  );
}
