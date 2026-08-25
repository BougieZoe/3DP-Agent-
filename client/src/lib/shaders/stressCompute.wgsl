// WebGPU Compute Shader — Thermal Stress Analysis
// Computes per-vertex von Mises stress and maps to RGBA color

struct Params {
  vertexCount: u32,
  time: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> normals: array<f32>;
@group(0) @binding(3) var<storage, read_write> colors: array<f32>;

// Color ramp: cool (blue) → warm (amber) → hot (red)
fn stressToColor(stress: f32) -> vec4<f32> {
  let t = clamp(stress, 0.0, 1.0);

  // Blue (low stress)
  let cool = vec3<f32>(0.2, 0.4, 0.8);
  // Amber (medium stress)
  let warm = vec3<f32>(0.8, 0.6, 0.2);
  // Red (high stress)
  let hot = vec3<f32>(0.9, 0.2, 0.2);

  var color: vec3<f32>;
  if (t < 0.5) {
    color = mix(cool, warm, t * 2.0);
  } else {
    color = mix(warm, hot, (t - 0.5) * 2.0);
  }

  // Pulsing effect based on time
  let pulse = 0.85 + 0.15 * sin(params.time * 3.0 + stress * 6.283);

  return vec4<f32>(color * pulse, 1.0);
}

// Simple von Mises stress estimation from geometry
// Uses local curvature as a proxy for stress concentration
fn computeStress(vertexIdx: u32) -> f32 {
  let i3 = vertexIdx * 3u;

  // Get position and normal
  let px = positions[i3];
  let py = positions[i3 + 1u];
  let pz = positions[i3 + 2u];

  let nx = normals[i3];
  let ny = normals[i3 + 1u];
  let nz = normals[i3 + 2u];

  // Stress proxy: combine height (thermal gradient) and normal deviation from vertical
  let heightFactor = clamp((py + 50.0) / 100.0, 0.0, 1.0); // assuming model is ~100mm tall
  let normalFactor = 1.0 - abs(ny); // deviation from vertical (overhang stress)

  // Curvature proxy: how much the normal differs from neighbors
  // (simplified — full curvature needs neighbor lookup)
  let curvatureStress = normalFactor * 0.6;

  // Thermal stress: higher at top (last to cool) and at sharp transitions
  let thermalStress = heightFactor * 0.4;

  // Combined von Mises proxy
  let stress = clamp(curvatureStress + thermalStress, 0.0, 1.0);

  return stress;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let vertexIdx = id.x;
  if (vertexIdx >= params.vertexCount) {
    return;
  }

  let stress = computeStress(vertexIdx);
  let color = stressToColor(stress);

  let i4 = vertexIdx * 4u;
  colors[i4] = color.r;
  colors[i4 + 1u] = color.g;
  colors[i4 + 2u] = color.b;
  colors[i4 + 3u] = color.a;
}
