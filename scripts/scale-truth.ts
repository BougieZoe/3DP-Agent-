#!/usr/bin/env tsx
/**
 * scale-truth — turn a reconstructed mesh's arbitrary units into real millimetres.
 *
 * The premise: photogrammetry returns a mesh with no physical scale. If the photos include a
 * sheet of known size (A4, or a bank card) lying beside the subject, that sheet *is* the scale
 * bar. This tool finds it in the mesh, derives millimetres-per-unit from it, calibrates a copy
 * of the mesh, then re-measures the result against the same known length as proof.
 *
 * Usage:
 *   npx tsx scripts/scale-truth.ts <mesh.stl>
 *   npx tsx scripts/scale-truth.ts job_0ccdc18456d1 --recon-dir ~/recon_data
 *
 * Options:
 *   --reference a4|card|auto   Which sheet to look for (default auto: whichever fits better)
 *   --long-mm <n>              Override the sheet's long edge in mm (default: the spec's value)
 *   --units mm|cm|in           Units the *output* mesh is expressed in (default mm)
 *   --out <path>               Where to write the calibrated mesh (default <name>.truth.stl)
 *   --report <path>            Where to write the JSON report (default <name>.truth.json)
 *   --recon-dir <path>         Reconstruction data dir, for job-id invocations
 *   --json                     Print the JSON report to stdout instead of prose
 *   --help
 *
 * Exit codes: 0 calibrated and verified · 2 no usable reference found · 3 verification failed
 *             4 bad usage · 5 mesh unreadable
 */
import fs from "node:fs/promises";
import path from "node:path";

import {
  REFERENCE_SPECS,
  detectReference,
  type DetectionResult,
  type ReferenceSpec,
} from "../server/capabilities/reconstruction/referenceDetector.js";
import {
  MM_PER_UNIT,
  applyScaleReferenceToStlFile,
} from "../server/capabilities/reconstruction/scaleCalibration.js";
import type { ScaleReference } from "../server/capabilities/reconstruction/types.js";

type Units = "mm" | "cm" | "in";

interface Args {
  input?: string;
  reference: "a4" | "card" | "auto";
  longMm?: number;
  units: Units;
  out?: string;
  report?: string;
  reconDir?: string;
  json: boolean;
  help: boolean;
}

const USAGE = `see the header of scripts/scale-truth.ts`;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    reference: "auto",
    units: "mm",
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) fail(`missing value for ${a}`);
      i += 1;
      return v;
    };
    switch (a) {
      case "--reference": {
        const v = next();
        if (v !== "a4" && v !== "card" && v !== "auto")
          fail(`--reference must be a4|card|auto`);
        args.reference = v;
        break;
      }
      case "--long-mm": {
        const v = Number(next());
        if (!Number.isFinite(v) || v <= 0)
          fail(`--long-mm must be a positive number`);
        args.longMm = v;
        break;
      }
      case "--units": {
        const v = next();
        if (v !== "mm" && v !== "cm" && v !== "in")
          fail(`--units must be mm|cm|in`);
        args.units = v;
        break;
      }
      case "--out":
        args.out = next();
        break;
      case "--report":
        args.report = next();
        break;
      case "--recon-dir":
        args.reconDir = next();
        break;
      case "--json":
        args.json = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (a.startsWith("-")) fail(`unknown option ${a}`);
        if (args.input !== undefined) fail(`unexpected extra argument ${a}`);
        args.input = a;
    }
  }
  return args;
}

function fail(message: string, code = 4): never {
  console.error(`scale-truth: ${message}`);
  process.exit(code);
}

/** Resolve "<something>.stl" or a reconstruction job id into an existing mesh path. */
async function resolveMeshPath(
  args: Args
): Promise<{ meshPath: string; jobDir?: string }> {
  if (!args.input) fail(`no mesh given. Run with --help for usage.`);
  const looksLikeJob = /^job_[A-Za-z0-9]+$/.test(args.input);
  if (!looksLikeJob) {
    const abs = path.resolve(args.input);
    if (!abs.toLowerCase().endsWith(".stl"))
      fail(`${abs} is not an .stl file`, 5);
    try {
      await fs.access(abs);
    } catch {
      fail(`cannot read ${abs}`, 5);
    }
    return { meshPath: abs };
  }

  const roots = [args.reconDir, process.env.RECON_DATA_DIR].filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  if (roots.length === 0) {
    fail(`looking up a job id needs --recon-dir or RECON_DATA_DIR`, 4);
  }
  for (const root of roots) {
    const jobDir = path.join(path.resolve(root), args.input);
    for (const rel of ["output/mesh.stl", "mesh.stl", "output/model.stl"]) {
      const candidate = path.join(jobDir, rel);
      try {
        await fs.access(candidate);
        return { meshPath: candidate, jobDir };
      } catch {
        /* try the next layout */
      }
    }
  }
  fail(`no mesh.stl found for ${args.input} under ${roots.join(", ")}`, 5);
}

function describeFailure(result: DetectionResult, args: Args): string[] {
  const lines: string[] = [];
  const closest = result.closest;
  if (!closest) {
    lines.push(
      "没有找到足以构成参照物的平面：可能只拍到了主体，或者纸被拍出了画面。"
    );
    return lines;
  }
  lines.push(
    `最接近的平面：长宽比 ${closest.aspect.toFixed(2)}（A4 为 ` +
      `${REFERENCE_SPECS.a4.aspect.toFixed(2)}，银行卡为 ${REFERENCE_SPECS.card.aspect.toFixed(2)}），` +
      `占其外接矩形 ${(closest.fill * 100).toFixed(0)}%，` +
      `起伏占长边 ${(closest.planarity * 100).toFixed(1)}%。`
  );
  for (const reason of closest.rejectedBy) {
    switch (reason) {
      case "aspect":
        lines.push(
          "→ 比例不符：这块多半是桌面、笔记本顶盖之类的矩形。重拍时让纸张完整入镜、平铺、不与别的矩形边缘重叠。"
        );
        break;
      case "fill":
        lines.push(
          "→ 形状不是实心矩形（像 L 形或 T 形）：纸上有东西压着，或两处平行面被并成了一块。把纸面清空，并让它与桌面、地面这类共面物体拉开几厘米。"
        );
        break;
      case "planarity":
        lines.push(
          "→ 平面不平：纸被折弯了，或多块共面被合并。把纸压平，或垫在硬质平板上拍。"
        );
        break;
      case "scale":
        lines.push(
          "→ 这块矩形相对整个扫描太小，不像你要用的那张纸（可能是窗、屏幕、或桌上的一张照片）。请让整张纸完整入镜。"
        );
        break;
      case "size":
        lines.push("→ 该平面占总表面积比例太小，不足以采信。");
        break;
    }
  }
  lines.push(
    `诊断所用规格：${args.reference === "auto" ? "A4 与银行卡中较优者" : args.reference}。`
  );
  return lines;
}

interface Report {
  ok: boolean;
  mesh: string;
  job_dir?: string;
  reference: {
    spec: string;
    label: string;
    long_mm: number;
    short_mm: number;
  } | null;
  detected: {
    mm_per_unit: number;
    long_edge_units: number;
    short_edge_units: number;
    fill: number;
    confidence: number;
    planarity_ratio: number;
  } | null;
  calibrated: {
    scale_reference: ScaleReference | null;
    factor: number;
    units: Units;
    out_path: string | null;
  } | null;
  verification: {
    long_edge_mm: number;
    expected_mm: number;
    tolerance_mm: number;
    mm_per_unit: number;
    expected_mm_per_unit: number;
    passed: boolean;
  } | null;
  diagnostics?: string[];
  error?: string;
}

function specLabel(spec: ReferenceSpec): string {
  return `${spec.label}，长边 ${spec.longMm} mm`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const { meshPath, jobDir } = await resolveMeshPath(args);
  const buffer = await fs.readFile(meshPath);

  const result = detectReference(buffer);
  const wanted: ReferenceSpec[] =
    args.reference === "auto"
      ? [REFERENCE_SPECS.a4, REFERENCE_SPECS.card]
      : [REFERENCE_SPECS[args.reference]];

  const report: Report = {
    ok: false,
    mesh: meshPath,
    ...(jobDir ? { job_dir: jobDir } : {}),
    reference: null,
    detected: null,
    calibrated: null,
    verification: null,
  };

  // `auto` keeps whichever reference scored best; an explicit --reference must actually match,
  // otherwise we would silently calibrate against a sheet the user did not ask for.
  const chosen =
    result.best && wanted.some(s => s.id === result.best?.specId)
      ? result.best
      : undefined;

  if (!chosen) {
    report.diagnostics = describeFailure(result, args);
    report.error = result.best
      ? `detected ${result.best.specId} but --reference=${args.reference} was requested`
      : "no reference sheet detected";
    if (args.report) {
      await fs.writeFile(
        path.resolve(args.report),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
      );
    }
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error(`✗ ${meshPath}`);
      console.error(`  ${report.error}`);
      for (const line of report.diagnostics) console.error(`  ${line}`);
    }
    process.exit(2);
  }

  const spec = REFERENCE_SPECS[chosen.specId];
  const longMm = args.longMm ?? spec.longMm;
  if (
    args.longMm !== undefined &&
    Math.abs(args.longMm - spec.longMm) > spec.longMm * 0.02
  ) {
    console.warn(
      `! --long-mm ${args.longMm} differs from ${spec.id}'s ${spec.longMm} mm by more than 2%; ` +
        `the calibrated scale inherits that error one-for-one.`
    );
  }

  const [p, q] = chosen.longEdgePoints;
  const scaleReference: ScaleReference = {
    kind: "two_point",
    known_mm: longMm,
    points: [
      { x: p[0], y: p[1], z: p[2] },
      { x: q[0], y: q[1], z: q[2] },
    ],
  };

  // Calibrate a copy: the reconstruction's own numbers stay recoverable, and this tool never
  // mutates a file it was pointed at by accident.
  const baseDir = path.dirname(meshPath);
  const stem = path.basename(meshPath, path.extname(meshPath));
  const outPath = path.resolve(
    args.out ?? path.join(baseDir, `${stem}.truth.stl`)
  );
  if (outPath === meshPath) {
    fail(
      `--out must differ from the input mesh; calibrating in place would discard the original`,
      4
    );
  }
  const reportPath = path.resolve(
    args.report ??
      path.join(
        path.dirname(outPath),
        `${path.basename(outPath, path.extname(outPath))}.json`
      )
  );

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.copyFile(meshPath, outPath);
  const applied = await applyScaleReferenceToStlFile(
    outPath,
    scaleReference,
    args.units
  );

  // Verification: measure the calibrated mesh with the same detector that produced the factor.
  // A factor that cannot reproduce the known length is a bug, not a rounding detail.
  const verified = detectReference(await fs.readFile(outPath));
  const expectedMmPerUnit = MM_PER_UNIT[args.units];
  const tolerance = Math.max(longMm * 0.01, 0.5);
  let verification: Report["verification"] = null;
  if (!verified.best) {
    report.error =
      "the calibrated mesh no longer contains a detectable reference";
    report.diagnostics = describeFailure(verified, args);
  } else {
    const longEdgeMm = verified.best.longEdge * verified.best.mmPerUnit;
    verification = {
      long_edge_mm: Number(longEdgeMm.toFixed(4)),
      expected_mm: longMm,
      tolerance_mm: tolerance,
      mm_per_unit: Number(verified.best.mmPerUnit.toFixed(6)),
      expected_mm_per_unit: expectedMmPerUnit,
      passed:
        Math.abs(longEdgeMm - longMm) <= tolerance &&
        Math.abs(verified.best.mmPerUnit - expectedMmPerUnit) <=
          expectedMmPerUnit * 0.01,
    };
  }

  report.reference = {
    spec: spec.id,
    label: spec.label,
    long_mm: longMm,
    short_mm: spec.shortMm,
  };
  report.detected = {
    mm_per_unit: Number(chosen.mmPerUnit.toFixed(6)),
    long_edge_units: Number(chosen.longEdge.toFixed(6)),
    short_edge_units: Number(chosen.shortEdge.toFixed(6)),
    fill: Number(chosen.fill.toFixed(4)),
    confidence: Number(chosen.confidence.toFixed(4)),
    planarity_ratio: Number(chosen.planarity.toFixed(5)),
  };
  report.calibrated = {
    scale_reference: scaleReference,
    factor: Number(applied.factor.toFixed(8)),
    units: args.units,
    out_path: outPath,
  };
  report.verification = verification;
  report.ok = verification?.passed === true;

  await fs.writeFile(
    reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `参照物  ${specLabel(spec)} — 置信度 ${(chosen.confidence * 100).toFixed(0)}%`
    );
    console.log(
      `检测    长边 ${chosen.longEdge.toFixed(3)} 单元 × 短边 ` +
        `${chosen.shortEdge.toFixed(3)} 单元，填充率 ${(chosen.fill * 100).toFixed(1)}%，` +
        `平面度 ${(chosen.planarity * 100).toFixed(2)}%`
    );
    console.log(
      `换算    1 单元 = ${chosen.mmPerUnit.toFixed(4)} mm（长边 ${longMm} mm ÷ ` +
        `${chosen.longEdge.toFixed(3)}）`
    );
    console.log(
      `缩放    顶点 ×${applied.factor.toFixed(6)}，输出单位 ${args.units}`
    );
    if (chosen.fill < 0.95) {
      console.log(
        `注意    该平面只填充了外接矩形的 ${(chosen.fill * 100).toFixed(1)}%：纸张边缘可能被遮挡；` +
          `若长边端点被切掉，换算会整体偏小，建议对照实测尺寸核对。`
      );
    }
    console.log(`输出    ${outPath}`);
    console.log(`报告    ${reportPath}`);
    if (verification) {
      const mark = verification.passed ? "✓" : "✗";
      console.log(
        `复检    ${mark} 校准后长边 ${verification.long_edge_mm.toFixed(2)} mm ` +
          `(期望 ${verification.expected_mm} ± ${verification.tolerance_mm.toFixed(2)})，` +
          `1 单元 = ${verification.mm_per_unit.toFixed(4)} mm ` +
          `(期望 ${verification.expected_mm_per_unit})`
      );
    } else if (report.diagnostics) {
      for (const line of report.diagnostics) console.log(`        ${line}`);
    }
  }

  if (!report.ok) process.exit(3);
}

await main();
