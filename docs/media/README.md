# README media — how it was made

Everything here comes from a real session against the running app (Playwright
recording + ffmpeg compositing). Nothing is mocked or hand-animated.

## Recipe

1. **Stills** — Playwright, 1600×1000 viewport at `deviceScaleFactor: 2`, then
   `sips -Z 2000` and JPEG-88. The current set is one part (`black_ak47_rifle`,
   362k triangles): geometry, wall heatmap, blocked gate, agent floor. The fix
   GIF uses a different, printable part on purpose — the AK is over the
   thicken budget, and the caption says so.

2. **Clip** — Playwright `recordVideo` at 1600×1000. For the AK tour: load, then
   pre-warm the AGENTS office (its iframe takes ~5 s on first open, and that
   wait is trimmed), then visit every tab in narrative order — GEOMETRY (verdict,
   heatmap on/off, scroll) → AGENTS (office, consensus, scroll) → CAUSALITY
   (chain, patterns) → REPORT (gate, deductions, CTA) → LOOP → CHAT → REPORT
   (scrolled back to the gate, so the film ends on the receipt). The script logs
   TOUR_START/TOUR_END so the trim is exact instead of guessed.

3. **Cards** — an HTML page (`Know before you print.` / `The failure is visible
   before the first layer.`) rendered at 1600×1000, matching the app's palette
   (`#04070a` background, `#66ccff` accent, SF Mono overlines).

4. **Film** — ffmpeg, 28 s (AK tour):

   ```
   [title]  2.4 s card on the app's own background (#04070a + cyan glow),
            blur-to-focus: gblur(22) cross-dissolves over 0.9 s while the frame
            settles from z=1.06 to 1.00. No device mockup, no dolly from a room
            — the product is the screen, so the film opens on typography and
            hard-cuts into the UI, the way product films do.
   [clip]    four trims concatenated (1.5x / 1.5x / 1.05x / 1.2x)
            the 1.05x segment holds the thicken click → READY TO PRINT un-rushed
   [end]     card, fade-in, xfade 0.8 s from the live block
   finish:   noise=alls=2:allf=t (grain) → h264 crf 20, faststart
   letterbox: 2.39:1 bars over the orbit/heatmap insert only
   ```

   The zoom lands full-bleed on the screen, so the cut to the live app is
   invisible — that is the whole trick of the opening.

5. **Inline preview** — GitHub cannot play a relative `.mp4`, so an excerpt
   ships as an animated **WebP** (760px, 12fps, q74, 0.94MB), which GitHub
   renders and loops like an image. Frames come from the film: 0.6–5.2s
   (dolly), 6.0–12.6s (verdict + heatmap), 22.0–26.4s (report).
   ffmpeg here has no libwebp, so the frames are encoded with ImageMagick:

   ```
   magick -delay 8.33 -loop 0 frames/f-*.png -quality 78 \
          -define webp:method=6 film.webp
   ```

6. **GIFs** — deliberately small, because a heavy GIF is the most common way a
   README "fails to load": 8-10 fps, 720–760 px, palettegen 48–64 colours,
   bayer dithering. `hero.gif` (1.9 MB) is the upload→verdict range at 0.75×
   time; `fix.gif` (1.1 MB) is the thicken range at 1× so the numbers stay
   readable. The top of the README uses a still (240 KB), never a GIF.

## Importing a Sand3D / Objaverse `.usda`

`scripts/usda-to-stl.py` converts ASCII USDA to a binary STL with no USD
runtime (regex over `def Mesh` blocks). Two things the file itself will not tell
you:

- `metersPerUnit = 1` — pass `--scale 1000`, or the part arrives 1000x small.
- The scenes are Z-up. Without `--rotate-x -90` the app's auto-orient stands a
  bike on its nose; with it, the part lands in a natural 3/4 pose.

```
python3 scripts/usda-to-stl.py bike.usda docs/_stls/sand3d-sportbike.stl \
        --scale 1000 --rotate-x -90 --rotate-y 45
```

`--rotate-y` is what lands the camera in a 3/4 view: with only `-90` on X the
app's default camera gives a dead-on front view, and any orbit drifts to a
top-front pose. 45 trades that for a side-quarter read.

On this part, colour comes from the **overhang** layer (5,777 faces), not the
wall layer: 4.9mm walls are all above threshold, so the wall heatmap is a
uniform green.

61,152 triangles, watertight, 2.1m long — and 4.91mm walls, which is why its
wall heatmap is mostly green. Colour in the viewport is a product decision
(neutral clay + overlays), not a limitation of the import: `color3f`/materials
in the USDA are not rendered.

## Re-shooting

The scripts are intentionally not committed: they hard-code local model paths
and the dev servers (`:3000` app, `:3001` bridge with `manifold3d`). Keep the
shapes above and swap the model — the framing is viewport-relative, so it
survives a different part. The room still's screen coordinates (1200, 949.5,
width 1290.7) are the numbers to re-measure if the laptop mockup changes; they
come from the Playwright `boundingBox()` of `#screen`.
