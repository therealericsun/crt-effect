# Agent guide

- Import `createCRT` / `createWebGLCRT` from `dist/crt-effect.js`; see README for options.
- Use WebGL for canvases; call `render()` after drawing. Keep HTML semantic and selectable.
- Share one `viewport` and curvature across HTML/GPU layers; avoid styled `crt-*` div IDs (ad blockers hide them).
- Safari may bypass SVG filters on composited children. Put canvas graphics in WebGL and avoid CSS animation inside filtered HTML.
- Keep native panels below the GPU host’s texture overlay (z-index 8), so grain and scanlines cover HTML too; match HTML glow with `text-shadow`.
- Respect reduced motion, visibility, native interaction and `destroy()` cleanup.
- Edit `src/`, then run `npm run build` to regenerate `dist/`.
- Validate with `npm test` and `npm run test:browser`; keep both demos working.
- Vendoring requires the built module, `dist/version.json` and `LICENSE`.
