#!/usr/bin/env node
/**
 * COLMAP pipeline driver.
 *
 * Runs as an independent child process so the API server never blocks on a minutes-long
 * reconstruction (rule 8: the data plane is separable; a remote worker could run this exact
 * file). Each step is one `colmap` invocation — no shell is involved, so image paths can
 * never be interpreted as syntax.
 *
 * Progress is written by the pipeline itself rather than guessed from log text: a step is
 * only reported as reached once its command has actually started.
 *
 * Usage: node colmapPipeline.mjs <colmap-binary> <work-dir>
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const [, , binArg, workDirArg] = process.argv;
if (!binArg || !workDirArg) {
  process.stderr.write("usage: colmapPipeline.mjs <colmap-binary> <work-dir>\n");
  process.exit(2);
}

const bin = binArg;
const workDir = workDirArg;
const imagesDir = path.join(workDir, "images");
const dbPath = path.join(workDir, "database.db");
const sparseDir = path.join(workDir, "sparse");
const denseDir = path.join(workDir, "dense");
const outDir = path.join(workDir, "output");
const progressPath = path.join(workDir, "progress.json");
const logPath = path.join(workDir, "colmap.log");

async function writeProgress(payload) {
  await fs.writeFile(progressPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function log(chunk) {
  await fs.appendFile(logPath, chunk);
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (stdout) void log(stdout);
      if (stderr) void log(stderr);
      if (error) {
        reject(Object.assign(error, { stderrTail: String(stderr ?? "").slice(-1200) }));
        return;
      }
      resolve();
    });
    child.on("error", reject);
  });
}

/**
 * Dense stereo needs a CUDA/OpenGL build of COLMAP. The Homebrew bottle on Apple silicon is
 * CPU-only, so dense steps are attempted and, if the build cannot do them, reported as an
 * explicit capability gap rather than producing a hollow success.
 */
const steps = [
  {
    stage: "feature_extraction",
    percent: 10,
    args: [
      "feature_extractor",
      "--database_path", dbPath,
      "--image_path", imagesDir,
      "--ImageReader.single_camera", "1",
      "--FeatureExtraction.use_gpu", "0",
    ],
  },
  {
    stage: "feature_matching",
    percent: 22,
    args: ["exhaustive_matcher", "--database_path", dbPath, "--FeatureMatching.use_gpu", "0"],
  },
  {
    stage: "structure_from_motion",
    percent: 42,
    args: [
      "mapper",
      "--database_path", dbPath,
      "--image_path", imagesDir,
      "--output_path", sparseDir,
    ],
  },
  {
    stage: "undistortion",
    percent: 52,
    args: [
      "image_undistorter",
      "--image_path", imagesDir,
      "--input_path", path.join(sparseDir, "0"),
      "--output_path", denseDir,
      "--output_type", "COLMAP",
      "--max_image_size", "2000",
    ],
  },
  {
    stage: "depth_maps",
    percent: 72,
    args: [
      "patch_match_stereo",
      "--workspace_path", denseDir,
      "--workspace_format", "COLMAP",
      "--PatchMatchStereo.geom_consistency", "true",
    ],
  },
  {
    stage: "fusion",
    percent: 84,
    args: [
      "stereo_fusion",
      "--workspace_path", denseDir,
      "--workspace_format", "COLMAP",
      "--input_type", "geometric",
      "--output_path", path.join(denseDir, "fused.ply"),
    ],
  },
  {
    stage: "meshing",
    percent: 92,
    args: [
      "poisson_mesher",
      "--input_path", path.join(denseDir, "fused.ply"),
      "--output_path", path.join(outDir, "mesh.ply"),
    ],
  },
];

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(sparseDir, { recursive: true });
  await fs.mkdir(denseDir, { recursive: true });

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    await writeProgress({
      stage: step.stage,
      percent: step.percent,
      step_index: index,
      steps_total: steps.length,
      updated_at: new Date().toISOString(),
    });
    try {
      await run(step.args);
    } catch (error) {
      await writeProgress({
        stage: step.stage,
        percent: step.percent,
        step_index: index,
        steps_total: steps.length,
        error: error?.stderrTail?.trim() || error?.message || String(error),
        failed_at: new Date().toISOString(),
      });
      process.exit(1);
    }
    // The mapper can exit 0 having registered too few images; that is a real failure even
    // though the command "succeeded", and it must not be reported as progress.
    if (step.stage === "structure_from_motion") {
      let models = [];
      try {
        models = await fs.readdir(sparseDir);
      } catch {
        models = [];
      }
      if (models.length === 0) {
        await writeProgress({
          stage: step.stage,
          percent: step.percent,
          step_index: index,
          steps_total: steps.length,
          error:
            "COLMAP could not register the images into a sparse model. Overlapping, sharp, " +
            "well-lit photos of the same object are required.",
          failed_at: new Date().toISOString(),
        });
        process.exit(1);
      }
    }
  }

  await writeProgress({
    stage: "completed",
    percent: 100,
    step_index: steps.length,
    steps_total: steps.length,
    updated_at: new Date().toISOString(),
  });
}

main().catch(async (error) => {
  await writeProgress({
    stage: "failed",
    percent: 0,
    error: error?.message ?? String(error),
    failed_at: new Date().toISOString(),
  });
  process.exit(1);
});
