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

4. **Film** — ffmpeg, 33 s:

   ```
   [intro card] split → gblur(16) + sharpen via
                blend='A*(1-min(T/0.9,1))+B*min(T/0.9,1)'   ← blur-to-focus
                zoompan 1.00 → 1.02
   [clip]       zoompan 1.00 → 1.05
   [end card]   fade-in + zoompan 1.02 → 1.00
   intro ⨯ clip ⨯ end  with 0.6 s xfade, h264 crf 22, faststart
   ```

5. **GIFs** — 12 fps, 900–960 px wide, palettegen 96–128 colours, bayer
   dithering. `hero.gif` is the upload→verdict range at 0.75× time; `fix.gif` is
   the thicken range at 1× so the numbers stay readable.

## Re-shooting

The scripts are intentionally not committed: they hard-code local model paths
and the dev servers (`:3000` app, `:3001` bridge with `manifold3d`). Keep the
shapes above and swap the model — the framing is viewport-relative, so it
survives a different part.
