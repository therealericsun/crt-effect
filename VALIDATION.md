# Validation · v1.1.1

Checked on 2026-10-18 with Node 26.11.1 and Playwright 1.64.1 on macOS ARM64.

- Three geometry tests cover symmetry, axis scaling and smooth protected regions.
- 90 browser checks cover Chromium 156, Firefox 157 and WebKit 27.2 at 1280×800 and 390×844 with 2× density.
- Pixel assertions verify SVG/GPU curvature, shared viewport geometry, painting beyond shallow surface bounds, changed canvas uploads, inherited source visibility and disabled output.
- Native interaction, selection, scrolling, resizing, protected transitions, option validation, style restoration, repeated toggling and teardown are exercised.
- GPU checks cover WebGL 1 fallback, context loss/restoration, collapsed hosts and output/source texture limits. Hidden hosts and lost contexts hide the aperture; teardown removes it.
- Reduced motion freezes grain; hidden-document events suspend work. Instrumented SVG teardown leaves no pending jobs, observers or listeners.

Firefox ignores SVG filters on the document root; use non-root HTML surfaces or GPU canvas mode. WebKit's positioned HTML requires normalized filter primitive coordinates; this path is covered by pixel tests. Native HTML remains semantic and selectable above GPU output. Painted selection/hit regions retain the browser's original geometry when native control alignment is disabled.

The portfolio integration separately checks the GPU pass, desktop/mobile layout, startup hold and native controls. Firefox improved from roughly 11 to 26 rendered frames/sec at 1440×1000 with 2× density in local measurements. Physical devices may differ.

Safari 26.5 was inspected directly. Initial maps and a first GPU frame must be prepared even in hidden windows; automatic animation remains suspended. Twelve added checks cover this initialization path. Primitive bounds are assigned before the displacement image loads.

Four generic showcase scenes and their enable/disable controls were checked in all three engines. The portfolio’s ad-block false match was reproduced using EasyList’s `div[id^="crt-"][style]` rule; integrations should avoid those IDs.

Linux CI uses Xvfb and Mesa software rendering. WebKitGTK retains its drawing buffer to avoid [stale frames in its non-DMABUF path](https://bugs.webkit.org/show_bug.cgi?id=324549).
