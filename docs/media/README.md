# README media — how it was made

Everything here comes from a real session against the running app (Playwright
recording + ffmpeg compositing). Nothing is mocked or hand-animated.

## Recipe

1. **Stills** — Playwright, 1600×1000 viewport at `deviceScaleFactor: 2`, then
   `sips -Z 2000` and JPEG-88. Captures: empty state, geometry, heatmap,
   thickened, report, agents.

2. **Clip** — Playwright `recordVideo` at 1600×1000: load → drop STL → verdict →
   wall overlay → `thicken now` → report. ~31 s raw.

3. **Cards** — an HTML page (`Know before you print.` / `The failure is visible
   before the first layer.`) rendered at 1600×1000, matching the app's palette
   (`#04070a` background, `#66ccff` accent, SF Mono overlines).

4. **Film** — ffmpeg, 24 s:

   ```
   [room]   2400x1500 still: dark desk, Mac, screen = the app's empty state
            zoompan z: 1.00 → 1.86, smoothstep, 1.0 s hold then 3.6 s move
            x/y pin the laptop screen centre (1200, 949.5); clamp ≥ 0
   [clip]    four trims concatenated (1.5x / 1.5x / 1.05x / 1.2x)
            the 1.05x segment holds the thicken click → READY TO PRINT un-rushed
   [end]     card, fade-in, xfade 0.8 s from the live block
   finish:   noise=alls=2:allf=t (grain) → h264 crf 20, faststart
   ```

   The zoom lands full-bleed on the screen, so the cut to the live app is
   invisible — that is the whole trick of the opening.

5. **GIFs** — deliberately small, because a heavy GIF is the most common way a
   README "fails to load": 8-10 fps, 720–760 px, palettegen 48–64 colours,
   bayer dithering. `hero.gif` (1.9 MB) is the upload→verdict range at 0.75×
   time; `fix.gif` (1.1 MB) is the thicken range at 1× so the numbers stay
   readable. The top of the README uses a still (240 KB), never a GIF.

## Re-shooting

The scripts are intentionally not committed: they hard-code local model paths
and the dev servers (`:3000` app, `:3001` bridge with `manifold3d`). Keep the
shapes above and swap the model — the framing is viewport-relative, so it
survives a different part. The room still's screen coordinates (1200, 949.5,
width 1290.7) are the numbers to re-measure if the laptop mockup changes; they
come from the Playwright `boundingBox()` of `#screen`.
