---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 60511e479f736a9399334d56570e10ac_9916289be97a11f1a20652540072b1e8
    ReservedCode1: KVcCBr/jW6gv9BsF0L+jsG6cXtsOOQViH7drNXt3hPg4OfcdkW4EsgO9ToNF5S8/0NqMpQms2qPiBF9ldrmyXhi+50xwi+diuPWzQ9ZKFHt6R9Tmir1udUWA+ffJOkzyXDZ1s+s9d/jhrcm7I0+6NWCuGvCmXguJ3s8hjVL+IkgjeR8XEzGh0tZRjjg=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 60511e479f736a9399334d56570e10ac_9916289be97a11f1a20652540072b1e8
    ReservedCode2: KVcCBr/jW6gv9BsF0L+jsG6cXtsOOQViH7drNXt3hPg4OfcdkW4EsgO9ToNF5S8/0NqMpQms2qPiBF9ldrmyXhi+50xwi+diuPWzQ9ZKFHt6R9Tmir1udUWA+ffJOkzyXDZ1s+s9d/jhrcm7I0+6NWCuGvCmXguJ3s8hjVL+IkgjeR8XEzGh0tZRjjg=
---

# Scale truth — turning a reconstruction into millimetres

Status: **detector + CLI validated on synthetic meshes with known ground truth; not yet run
against a real photo set.**

Photogrammetry returns geometry, not physics. A mesh built from twelve phone photos has no unit:
its coordinates could be millimetres, or metres, or nothing at all. Every downstream number that
matters — wall thickness, bridging distance, whether a part fits — is meaningless until the mesh
is anchored to reality.

## The premise

Put something of known size in the frame, lying flat beside the subject. That object is the ruler.
An A4 sheet (297 × 210 mm, ISO 216) or a bank card (85.60 × 53.98 mm, ISO/IEC 7810 ID-1) works
because both are manufactured to a tolerance far tighter than photogrammetry's own accuracy, and
both are rectangles whose long edge is unambiguous once found.

The reconstruction process does not need to know the ruler is a ruler. It just needs to be
photographed alongside the subject, so both end up in the same arbitrary coordinate space. This
tool then finds the sheet in the mesh, measures it in mesh units, and derives the conversion.

```
mm_per_unit = known_long_edge_mm / measured_long_edge_units
```

## Shooting instructions

The measurement is only as good as the shot. In rough order of how often each failure bites:

1. **The sheet must be fully in frame, in every photo.** A cropped corner changes the measured
   long edge, and the error propagates one-for-one into every dimension.
2. **Keep the sheet clear.** Anything resting on it turns the rectangle into an L shape, which is
   rejected — correctly, because the long edge can no longer be trusted.
3. **Isolate it from coplanar surfaces.** A sheet lying flush on a desk may merge with the desk into
   one continuous plane; the detector then measures the desk. A few centimetres of visible gap, or
   a slight lift, avoids this. Laying it on a contrasting surface helps the reconstruction more
   than it helps this tool.
4. **Keep it flat.** A bent sheet is not a plane. Tape the corners down.
5. **Do not let it dominate the frame.** The subject is what you are measuring; the sheet only
   needs to be big enough to measure reliably — roughly an eighth of the frame is plenty.
6. **Shoot the whole scene from several angles, as usual.** The sheet must be visible in enough
   photos to be reconstructed at all; an object seen in two photos at a grazing angle comes out
   with its edges chewed away.

A credit card works where an A4 sheet will not fit, but its smaller long edge means a larger
relative error for the same reconstruction noise.

## Usage

```bash
# from a mesh file
npx tsx scripts/scale-truth.ts path/to/mesh.stl

# from a reconstruction job
npx tsx scripts/scale-truth.ts job_0ccdc18456d1 --recon-dir ~/recon_data
```

| flag | meaning |
| --- | --- |
| `--reference a4\|card\|auto` | which sheet to look for; `auto` picks whichever fits better |
| `--long-mm <n>` | override the sheet's long edge, for non-standard paper or a printed target |
| `--units mm\|cm\|in` | units the output mesh is expressed in (default `mm`) |
| `--out <path>` | where to write the calibrated mesh (default `<name>.truth.stl`) |
| `--report <path>` | where to write the JSON report |
| `--json` | print the JSON report instead of prose |
| `--recon-dir <path>` | reconstruction data dir, for job-id invocations |

The input mesh is never modified: the calibrated mesh is written to a copy, and the same detector
then re-measures that copy. A factor that cannot reproduce the known length is a bug, so the
re-measurement is a hard gate, not a formality.

Exit codes: `0` calibrated and verified · `2` no usable sheet found (with shooting advice) ·
`3` calibration failed its own re-measurement · `4` bad usage · `5` mesh unreadable.

## What the detector does

1. Read the binary STL and take each triangle's normal, area and centroid.
2. Cluster triangles greedily by normal *and* plane offset, so two parallel sheets (a sheet and the
   desk it lies on) do not merge into one cluster. Without the offset test, a sheet photographed on
   a desk produces a cluster whose extent is the desk's, and the measurement is silently wrong.
3. For the largest clusters, project onto the plane and compute the minimum-area bounding rectangle
   via convex hull plus rotating calipers.
4. Score each cluster against each spec on aspect ratio, fill ratio (rectangle area over bounding
   rectangle), planarity (out-of-plane spread over long edge) and size relative to the whole scan.
5. Report every candidate with its rejection reasons, so a failure explains itself.

The long edge of the winning rectangle is returned as two endpoints in mesh coordinates, which is
exactly the `two_point` scale reference the reconstruction router already accepts. The CLI feeds it
through `applyScaleReferenceToStlFile`, so there is one calibration code path, not two.

## Validation

Synthetic meshes with known ground truth, because a real photo set with a measured subject is not
available yet. All numbers below are reproducible with `scripts/scale-truth-fixture.ts` +
`scripts/check-reference-detector.ts`.

| case | expected | result |
| --- | --- | --- |
| A4 + subject, 7.3 mm/unit | 7.3 | 7.3000, long edge 297.00 mm after calibration |
| same scene at 3× mesh scale | 7.3 | 2.4333 recovered, equivalent to 7.3 |
| subject only | reject | rejected, closest patch 1.99 aspect |
| 2:1 rectangle | reject | rejected on aspect |
| A4 中间挖 25% 的洞（真实重建常态） | accept | accepted, 13.700 mm/unit, fill 0.750 但轮廓 1.000 |
| A4 缺掉一个角 | reject | rejected on outline (93%) |
| A4 带内部破洞 + 数毫米外扩毛刺 | accept | accepted, 长宽比误差 0.0% |
| A4 flush on a coplanar desk | reject | rejected: merged patch has 1.50 aspect |
| A4 but `--reference card` | reject | rejected, names the mismatch |
| `--units cm` | factor ÷ 10 | 0.73, re-measure gives 10 mm/unit |

The unit-conversion invariance is the load-bearing test: the same scene at 3× scale must produce a
factor three times smaller and the same physical answer.

## Known limits

- **Flush coplanar surfaces merge.** A sheet lying perfectly flat on a desk of similar colour can be
  indistinguishable from the desk. Rejected here because the desk's aspect ratio happens not to
  match, but that is luck, not a guarantee. Lift the sheet slightly.
- **No OCR, no colour, no texture.** The detector is purely geometric, which makes it robust to
  lighting and cheap to run, but it cannot read "A4" off a label or distinguish a sheet from a
  screen of the same size.
- **Rotation-free assumption inside a cluster.** Each cluster must be one plane; a sheet folded
  along a crease has two planes and is measured as two clusters, both too small.
- **The router still does not accept `calibration_board`.** A printed target with four known markers
  would be more robust than a plain rectangle, and is the natural next step; it needs a detector
  that can find four corners, not one rectangle.
*（内容由AI生成，仅供参考）*
