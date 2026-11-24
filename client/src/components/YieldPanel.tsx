/**
 * Floor yield panel.
 *
 * Reads the same localStorage job store the print dashboard reads, projects it
 * through the yield domain, and closes the loop: a finished part sits in the
 * inspection queue until someone actually marks it. Nothing here upgrades a
 * finished job to a good one by implication.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPrintJobs, getPrinters, markJobQuality } from '@/lib/printFarm';
import type { PrintJob, Printer } from '@/lib/printFarm';
import type { CalibrationMethod } from '@shared/domain/fieldCalibration';
import type { FailureCause } from '@shared/domain/yieldAttribution';
import { CAUSE_LABELS, METHOD_LABELS, buildYieldView } from '@/lib/yieldView';

interface YieldPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const ALL_CAUSES: FailureCause[] = [
  'material',
  'machine',
  'params',
  'model',
  'operator',
  'post-process',
  'design',
  'unknown',
];

const ALL_METHODS: CalibrationMethod[] = ['operator-note', 'part-measurement', 'slicer-log', 'thermocouple'];

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad'; hint?: string }) {
  const color =
    tone === 'bad' ? 'text-rose-400' : tone === 'warn' ? 'text-amber-400' : tone === 'ok' ? 'text-emerald-400' : 'text-zinc-100';
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`font-mono text-lg leading-tight ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] leading-snug text-zinc-500">{hint}</div>}
    </div>
  );
}

export function YieldPanel({ isOpen, onClose }: YieldPanelProps) {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [causes, setCauses] = useState<FailureCause[]>([]);
  const [method, setMethod] = useState<CalibrationMethod>('operator-note');

  const refresh = useCallback(() => {
    setJobs(getPrintJobs());
    setPrinters(getPrinters());
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
  }, [isOpen, refresh]);

  const view = useMemo(() => buildYieldView(jobs, printers), [jobs, printers]);

  const resetDraft = () => {
    setOpenJobId(null);
    setCauses([]);
    setMethod('operator-note');
  };

  const markGood = (jobId: string) => {
    markJobQuality(jobId, 'good');
    resetDraft();
    refresh();
  };

  const markDefect = (jobId: string) => {
    markJobQuality(jobId, 'defect', {
      causes: causes.length > 0 ? causes : ['unknown'],
      method,
    });
    resetDraft();
    refresh();
  };

  const toggleCause = (cause: FailureCause) => {
    setCauses((prev) => (prev.includes(cause) ? prev.filter((c) => c !== cause) : [...prev, cause]));
  };

  if (!isOpen) return null;

  const leaks = view.board.counts['false-pass'] ?? 0;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/95 text-zinc-200 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-wide text-cyan-400">Floor Yield · 车间良率</h2>
          <p className="mt-1 truncate font-mono text-[11px] text-zinc-400" title={view.line}>
            {view.line}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={refresh}
            className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            刷新
          </button>
          <button
            onClick={onClose}
            className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            关闭
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {view.jobCount === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-zinc-300">还没有任何打印任务</p>
            <p className="max-w-md text-[11px] leading-relaxed text-zinc-500">
              良率只统计真正上过机、并且有人看过的零件。先让任务跑起来，这里才有可读的东西。
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col gap-5">
            <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi label="可判定 / 总记录" value={view.decidableText} hint="只有判定与结果都齐的样本才算分母" />
              <Kpi
                label="假通过率"
                value={view.leakRateText}
                tone={view.board.leakRate === null ? 'warn' : leaks > 0 ? 'bad' : 'ok'}
                hint={view.board.leakRate === null ? view.board.blockedBy ?? '样本不足，不出比率' : `本可拦下的报废 ${leaks} 件`}
              />
              <Kpi
                label="误拦截率"
                value={view.falseBlockRateText}
                tone={view.board.falseBlockRate === null ? 'warn' : 'ok'}
                hint={view.board.falseBlockRate === null ? '样本不足，不出比率' : '被挡住但本可成功'}
              />
              <Kpi
                label="待检验"
                value={String(view.harvest.awaitingInspection)}
                tone={view.harvest.awaitingInspection > 0 ? 'warn' : 'ok'}
                hint="机器跑完了，但没人看过"
              />
              <Kpi
                label="无判定记录"
                value={String(view.harvest.unjudged)}
                tone={view.harvest.unjudged > 0 ? 'warn' : 'ok'}
                hint="上机前没留判定，无法记入良率"
              />
              <Kpi
                label="强行放行 / 未绑定机台"
                value={`${view.harvest.overrides} / ${view.harvest.unboundMachines}`}
                tone={view.harvest.overrides > 0 || view.harvest.unboundMachines > 0 ? 'warn' : 'ok'}
                hint="放行后出问题会被记为 overrides"
              />
            </section>

            <p className="text-[11px] leading-relaxed text-zinc-500">
              策略 {view.policyVersion}
              {view.excludedByVersionText ? ` · ${view.excludedByVersionText}` : ''}
            </p>

            <section>
              <h3 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">结果分类</h3>
              <div className="flex flex-wrap gap-1.5">
                {view.outcomes.map((row) => (
                  <span
                    key={row.key}
                    className={`rounded border px-2 py-1 font-mono text-[11px] ${
                      row.leak && row.count > 0
                        ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                        : row.count > 0
                          ? 'border-zinc-700 bg-zinc-900 text-zinc-200'
                          : 'border-zinc-800 bg-transparent text-zinc-600'
                    }`}
                  >
                    {row.label} <span className="font-semibold">{row.count}</span>
                  </span>
                ))}
              </div>
              {!view.attribution.attributed && view.attribution.scraps > 0 && (
                <p className="mt-2 text-[11px] leading-snug text-amber-400">
                  未归因 {view.attribution.unresolved} 件：报废 {view.unresolvedDefect} 件、中断 {view.unresolvedAborted} 件
                  （含被拦截未上机的中断）——不会补一个默认值上去。
                </p>
              )}
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <h3 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">
                  待检验队列 <span className="text-zinc-400">{view.pending.length}</span>
                </h3>
                {view.pending.length === 0 ? (
                  <p className="py-4 text-center text-[11px] text-zinc-500">没有待检验的零件</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {view.pending.map((job) => (
                      <li key={job.id} className="rounded border border-zinc-800 bg-black/40 px-2.5 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[12px] text-zinc-200">{job.name}</div>
                            <div className="truncate font-mono text-[10px] text-zinc-500">
                              {job.printerName} · {new Date(job.finishedAt).toLocaleString()} · {job.verdictText}
                            </div>
                          </div>
                          {openJobId !== job.id && (
                            <div className="flex shrink-0 gap-1">
                              <button
                                onClick={() => markGood(job.id)}
                                className="rounded border border-emerald-600/50 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/20"
                              >
                                合格
                              </button>
                              <button
                                onClick={() => {
                                  setOpenJobId(job.id);
                                  setCauses([]);
                                  setMethod('operator-note');
                                }}
                                className="rounded border border-rose-600/50 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/20"
                              >
                                报废
                              </button>
                            </div>
                          )}
                        </div>

                        {openJobId === job.id && (
                          <div className="mt-2 border-t border-zinc-800 pt-2">
                            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                              报废原因（可多选，未选则记为「未查明」）
                            </div>
                            <div className="mb-2 flex flex-wrap gap-1">
                              {ALL_CAUSES.map((cause) => {
                                const active = causes.includes(cause);
                                return (
                                  <button
                                    key={cause}
                                    onClick={() => toggleCause(cause)}
                                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                                      active
                                        ? 'border-rose-500/60 bg-rose-500/15 text-rose-200'
                                        : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
                                    }`}
                                  >
                                    {CAUSE_LABELS[cause]}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-2">
                              <select
                                value={method}
                                onChange={(e) => setMethod(e.target.value as CalibrationMethod)}
                                className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-300"
                              >
                                {ALL_METHODS.map((m) => (
                                  <option key={m} value={m}>
                                    {METHOD_LABELS[m]}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => markDefect(job.id)}
                                className="rounded border border-rose-600/60 bg-rose-600/20 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-600/30"
                              >
                                提交报废
                              </button>
                              <button
                                onClick={resetDraft}
                                className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <h3 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">
                  报废归因 <span className="text-zinc-400">{view.attribution.scraps} 件</span>
                </h3>
                {view.causeRows.length === 0 ? (
                  <p className="py-4 text-center text-[11px] text-zinc-500">还没有报废记录可归因</p>
                ) : (
                  <table className="w-full text-left text-[11px]">
                    <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                      <tr>
                        <th className="pb-1 font-normal">原因</th>
                        <th className="pb-1 font-normal">件数</th>
                        <th className="pb-1 font-normal">占比</th>
                        <th className="pb-1 font-normal">最强证据</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-zinc-300">
                      {view.causeRows.map((row) => (
                        <tr key={row.cause} className="border-t border-zinc-800/70">
                          <td className="py-1 font-sans">{row.label}</td>
                          <td className="py-1">{row.count}</td>
                          <td className="py-1">{row.sharePct === null ? '—' : `${row.sharePct}%`}</td>
                          <td className="py-1">{row.methodLabel ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-2 text-[10px] leading-snug text-zinc-500">
                  一件报废可能带上多个原因，所以占比相加未必等于 100%。
                </p>
              </section>
            </div>

            <section>
              <h3 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">机台能力声明（现场叠层后）</h3>
              {view.machines.length === 0 ? (
                <p className="py-3 text-center text-[11px] text-zinc-500">还没有绑定机台型号的可判定记录</p>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {view.machines.map((machine) => (
                    <div key={machine.modelId} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] text-zinc-200">{machine.name}</div>
                          <div className="font-mono text-[10px] text-zinc-500">{machine.modelId}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="rounded border border-cyan-700/50 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">
                            {machine.gradeLabel}
                          </span>
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] ${
                              machine.publishable
                                ? 'border-emerald-700/50 bg-emerald-500/10 text-emerald-300'
                                : 'border-amber-700/50 bg-amber-500/10 text-amber-300'
                            }`}
                          >
                            {machine.publishable ? '可对外声明' : '不可对外声明'}
                          </span>
                        </div>
                      </div>
                      <table className="w-full text-left text-[11px]">
                        <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                          <tr>
                            <th className="pb-1 font-normal">能力轴</th>
                            <th className="pb-1 font-normal">上限</th>
                            <th className="pb-1 font-normal">状态</th>
                            <th className="pb-1 font-normal">证据</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono text-zinc-300">
                          {machine.axes.map((axis) => (
                            <tr key={axis.axis} className="border-t border-zinc-800/70">
                              <td className="py-1 font-sans">{axis.label}</td>
                              <td className="py-1">{axis.ceilingText}</td>
                              <td className="py-1">{axis.applicabilityLabel}</td>
                              <td className="py-1">{axis.gradeLabel}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {machine.axes.some((axis) => axis.contradictionText) && (
                        <ul className="mt-2 flex flex-col gap-0.5">
                          {machine.axes
                            .filter((axis) => axis.contradictionText)
                            .map((axis) => (
                              <li key={`${axis.axis}-c`} className="text-[10px] leading-snug text-rose-400">
                                {axis.label}：{axis.contradictionText}
                              </li>
                            ))}
                        </ul>
                      )}
                      {machine.notes.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-0.5">
                          {machine.notes.map((note) => (
                            <li key={note} className="text-[10px] leading-snug text-zinc-500">
                              · {note}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <p className="pb-2 text-[10px] leading-relaxed text-zinc-500">
              完成不等于合格：机器跑完只进入待检验，没人看过的零件一律不计入合格。现场读数只能把机台上限压窄或坐实，不能抬高。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default YieldPanel;
