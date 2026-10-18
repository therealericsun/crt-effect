# Validation — v1.0.0

Validated on 2026-10-18 with Node.js 26.11.1 and Playwright 1.64.1 on macOS ARM64.

## Automated checks

- `npm test`: 3 geometry tests pass (viewport scaling and symmetry; exact protected interiors and smooth taper; overlapping protected regions).
- Browser suite: 36 checks pass across Chromium 156, Firefox 157, and WebKit 27.2 at 1280×800 desktop and 390×844 with 2× display density. The initial 30 checks passed together; the six added resource-release checks passed in a targeted run after fixing the test harness's native timer bindings.
- Screenshot pixel assertions verify actual curvature, straight output while disabled, protected/native control interaction, and unchanged fixed-element painting after scrolling. Root curvature assertions explicitly account for Firefox's known limitation; non-root displacement is verified in every engine.
- Resizing, CSS transitions on protected regions, partial option updates, invalid option rejection, original filter composition/restoration (including `!important`), repeated toggling, destroy/recreate, and harmless calls after destruction pass.
- Grain animates, freezes for reduced motion, suspends for simulated hidden-document visibility events, and stays quiet while disabled.
- Instrumented destruction leaves zero pending timers, animation frames, live observers, or registered library event listeners.
- `npm pack --dry-run`: six files, approximately 10 KB compressed. Browser distribution has no imports or runtime dependencies; declarations and MIT license are included.

## Visual and integration review

Reviewed generic demo screenshots in all three engines at desktop and 2× phone sizes, including the oscilloscope, calibration lines, 11px text, protected controls, and dark corners. Reviewed the portfolio integration with the full-page effect enabled/disabled and after scrolling. Small text remains readable; curvature bends live text, borders, and canvases together.

The static portfolio was separately checked in all three engines at 1440×1000 desktop and 390×844 with 2× density. All asset requests and JavaScript checks pass. Drawer opening/closing, Escape focus restoration, native keyboard sliders, repeated CRT toggling, preference persistence across reload, scroll-relative maps, and renderer independence pass. Blocked local storage falls back to enabled; blocking effect initialization leaves renderer startup working. Reduced-motion canvases remain unchanged when the effect is toggled. A normal-motion Chromium run also exercises the independent entrance sequence.

## Browser limitation and tradeoffs

Firefox currently ignores the SVG filter chain on the document root, consistent with [Mozilla bug 1769223](https://bugzilla.mozilla.org/show_bug.cgi?id=1769223). Root mode there provides scanlines, phosphor mask, grain, and vignette, without curvature or additive glow. Non-root Firefox curvature works, with the usual CSS containing-block implications for fixed descendants. This release preserves native root scrolling and fixed positioning rather than introducing a body wrapper or relocating content.

A stable document-sized root filter region fixes WebKit's rescaling of moving filter regions. The small displacement map follows the viewport, but filter buffers can scale with document size. Very long pages and large high-density displays need application-specific performance testing. Browser emulation does not replace testing on physical mobile devices. Text selection remains native; highlights follow unfiltered geometry.
