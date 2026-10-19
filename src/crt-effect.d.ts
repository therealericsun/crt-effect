export interface CRTOptions {
  preset?: 'balanced';
  enabled?: boolean;
  /** Cross-axis curvature coefficient, 0–0.15. Default .035. */
  curvature?: number;
  /** Noise opacity, 0–1. Default .025. */
  grain?: number;
  /** Noise updates per second, 1–60. Default 12. */
  grainFPS?: number;
  /** Scanline opacity, 0–1. Default .10. */
  scanlines?: number;
  /** Scanline spacing in CSS pixels, 1–12. Default 3. */
  scanlineSpacing?: number;
  /** Vertical phosphor mask opacity, 0–1. Default .025. */
  mask?: number;
  /** Corner shading opacity, 0–1. Default .45. */
  vignette?: number;
  /** Additive blur contribution, 0–1. Default .08. */
  glow?: number;
  /** Additional CSS selector for undistorted interaction regions. Empty string disables custom protection. */
  protect?: string;
  /** Shared screen geometry for several HTML surfaces. Defaults to the target bounds. */
  viewport?: HTMLElement;
  /** Counter-offset native controls to retain their original hit regions. Default true. */
  alignControls?: boolean;
}
export interface CRTInstance {
  readonly enabled: boolean;
  readonly options: Readonly<Required<Omit<CRTOptions, 'viewport'>> & Pick<CRTOptions, 'viewport'>>;
  update(options?: CRTOptions): void;
  setEnabled(enabled: boolean): void;
  refresh(): void;
  destroy(): void;
}
export declare const balanced: Readonly<Required<Omit<CRTOptions, 'viewport'>> & Pick<CRTOptions, 'viewport'>>;
export declare function createCRT(target: HTMLElement, options?: CRTOptions): CRTInstance;


export interface WebGLCRTOptions extends CRTOptions {
  /** Connected canvas layers, back to front. Defaults to canvas[data-crt-source] descendants. */
  sources?: HTMLCanvasElement[];
  /** Shared curved screen silhouette, composited above native UI. Default false. */
  aperture?: boolean;
  /** Output density, capped independently by maxPixels. Defaults to device density, at most 2. */
  pixelRatio?: number;
  /** Maximum output pixel count. Default 3,000,000. Native HTML is never downsampled. */
  maxPixels?: number;
}
export interface WebGLCRTInstance extends CRTInstance {
  readonly renderer: 'webgl2' | 'webgl';
  readonly contextLost: boolean;
  /** Upload source canvases and draw. Pass false to reuse textures after layout-only changes. */
  render(upload?: boolean): void;
}
export declare function createWebGLCRT(target: HTMLElement, options?: WebGLCRTOptions): WebGLCRTInstance;
