/**
 * 判定真值墙 —— 把"能不能打"从打分收敛成闸门。
 *
 * 为什么要有这一层：
 *  - 前端 ExecutiveSummary.verdict 与 server 的 AnalyzeGate 曾各自聚合 severity，
 *    本质是"数缺陷数量"，看起来像分数，实际不可解释，也无法回答"到底谁说了算"。
 *  - 真值墙的立场：判定必须落到一条可复现的硬门（阈值 + 观测值 + 出处），
 *    status 只有三态 pass / blocked / inconclusive，禁止用加权分抹平。
 *  - 前置真值缺失时（非水密、体积不可靠），不是"降权继续算"，而是
 *    直接把下游派生值（打印时间、成本、克重）标为受抑制，不出数。
 *
 * 阈值全部集中在此，前端与服务端引用同一份 POLICY，避免两套口径漂移。
 */

/**
 * 每次改阈值必须同时升版本号，报告与决策记录会引用它。
 *
 * 版本字面量的唯一真源在 shared/domain/verdictPolicy.ts：若此处再写一份，
 * 一旦两处拼写漂移，pin 与记录的版本对不上而不报错，看板会静默变空。
 * 这里只做转出，保持既有 import 路径不变。
 */
import { VERDICT_POLICY_VERSION } from '../shared/domain/verdictPolicy';

export { VERDICT_POLICY_VERSION };

export interface VerdictPolicy {
  version: string;
  /**
   * 薄壁硬门。取值依据：0.4mm 喷嘴双道挤出线宽约 0.84mm，
   * 低于此值在量产 FDM 上无法保证连续实体壁，属结构性不可打印，不进"提示"层。
   */
  minWallMm: number;
  /** 悬垂告警角。仅产生 warning，不构成硬门（多数悬垂可靠支撑解决）。 */
  overhangWarnDeg: number;
  /** 体积派生值的前提：网格必须水密且体积判定可靠。 */
  requireWatertightForVolume: boolean;
  /** 体积不可靠时一律抑制的派生字段（打印时间 / 支撑克重 / 成本）。 */
  suppressDerivedWhenVolumeUnreliable: boolean;
}

export const DEFAULT_VERDICT_POLICY: VerdictPolicy = {
  version: VERDICT_POLICY_VERSION,
  minWallMm: 0.8,
  overhangWarnDeg: 45,
  requireWatertightForVolume: true,
  suppressDerivedWhenVolumeUnreliable: true,
};

/** 判定所需的最小观测面，避免与 analyzeService 互相 import。 */
export interface VerdictObservation {
  isWatertight: boolean;
  holeCount: number;
  boundaryEdgeCount: number;
  volumeReliable: boolean;
  minWallThicknessMm: number | null;
  fitsBuildVolume: boolean | null;
  estimatedPrintTimeMinutes: number | null;
  estimatedSupportGrams: number | null;
}

export type VerdictStatus = 'pass' | 'blocked' | 'inconclusive';

export type VerdictReasonCode =
  | 'WALL_BELOW_MIN'
  | 'BED_OVERFLOW'
  | 'TOPOLOGY_UNVERIFIED'
  | 'VOLUME_UNRELIABLE'
  | 'WALL_UNMEASURED';

export interface VerdictReason {
  code: VerdictReasonCode;
  /** block = 硬门不通过；unknown = 真值缺失，不能下结论。 */
  kind: 'block' | 'unknown';
  field: string;
  observed: number | boolean | null;
  limit: number | boolean | null;
  message: string;
}

export interface Verdict {
  status: VerdictStatus;
  policyVersion: string;
  /** 结论只由一个 position 承载：blocked > inconclusive > pass。 */
  reasons: VerdictReason[];
  /** 被真值墙挡下的派生字段名，消费方必须 early-return，不得默认 0。 */
  suppressed: (keyof VerdictObservation)[];
}

const DERIVED_FIELDS: (keyof VerdictObservation)[] = [
  'estimatedPrintTimeMinutes',
  'estimatedSupportGrams',
];

/**
 * 真值墙判定。纯函数，不做 IO，便于在 worker / server / 测试中复用。
 *
 * 语义纪律：
 *  1. 有一条 block 就是 blocked，不因为别处"很多 info"而回到 pass；
 *  2. 没有 block 但有 unknown → inconclusive，绝不写成"基本没问题"；
 *  3. 只有既无 block 也无 unknown 才是 pass。
 */
export function evaluateVerdict(
  observation: VerdictObservation,
  policy: VerdictPolicy = DEFAULT_VERDICT_POLICY,
): Verdict {
  const reasons: VerdictReason[] = [];
  const suppressed: (keyof VerdictObservation)[] = [];

  // 1) 薄壁硬门
  const wall = observation.minWallThicknessMm;
  if (wall === null) {
    reasons.push({
      code: 'WALL_UNMEASURED',
      kind: 'unknown',
      field: 'minWallThicknessMm',
      observed: null,
      limit: policy.minWallMm,
      message: `未测得最小壁厚，无法比对本版硬门 ${policy.minWallMm}mm`,
    });
  } else if (wall < policy.minWallMm) {
    reasons.push({
      code: 'WALL_BELOW_MIN',
      kind: 'block',
      field: 'minWallThicknessMm',
      observed: wall,
      limit: policy.minWallMm,
      message: `最小壁厚 ${wall.toFixed(2)}mm 低于硬门 ${policy.minWallMm}mm`,
    });
  }

  // 2) 成型尺寸 / 机台包络
  if (observation.fitsBuildVolume === false) {
    reasons.push({
      code: 'BED_OVERFLOW',
      kind: 'block',
      field: 'fitsBuildVolume',
      observed: false,
      limit: true,
      message: '模型超出机台成型包络，需换机台或分段',
    });
  }

  // 3) 拓扑真值缺失：非水密 / 有孔洞 / 有边界边 → 体积不可作为依据
  const topologyBroken =
    !observation.isWatertight || observation.holeCount > 0 || observation.boundaryEdgeCount > 0;
  if (topologyBroken) {
    reasons.push({
      code: 'TOPOLOGY_UNVERIFIED',
      kind: 'unknown',
      field: 'isWatertight',
      observed: observation.isWatertight,
      limit: true,
      message: `拓扑未闭合（孔洞 ${observation.holeCount}，边界边 ${observation.boundaryEdgeCount}），体积不可作依据`,
    });
  }

  // 4) 体积可靠性单独记账：它是所有派生值的总前提
  const volumeUntrusted =
    topologyBroken || (policy.requireWatertightForVolume && !observation.volumeReliable);
  if (!observation.volumeReliable && !topologyBroken) {
    reasons.push({
      code: 'VOLUME_UNRELIABLE',
      kind: 'unknown',
      field: 'volumeReliable',
      observed: false,
      limit: true,
      message: '体积计算被标记为不可靠，派生数值不出数',
    });
  }

  if (volumeUntrusted && policy.suppressDerivedWhenVolumeUnreliable) {
    for (const field of DERIVED_FIELDS) {
      const value = observation[field];
      if (value !== null) suppressed.push(field);
    }
  }

  const status: VerdictStatus = reasons.some((r) => r.kind === 'block')
    ? 'blocked'
    : reasons.length > 0
      ? 'inconclusive'
      : 'pass';

  return { status, policyVersion: policy.version, reasons, suppressed };
}

/** 供 /api/analyze/policy 与报告层引用的可序列化快照。 */
export function describeVerdictPolicy(policy: VerdictPolicy = DEFAULT_VERDICT_POLICY) {
  return { ...policy };
}
