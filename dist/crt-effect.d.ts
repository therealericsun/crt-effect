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
}
export interface CRTInstance {
  readonly enabled: boolean;
  readonly options: Readonly<Required<CRTOptions>>;
  update(options?: CRTOptions): void;
  setEnabled(enabled: boolean): void;
  refresh(): void;
  destroy(): void;
}
export declare const balanced: Readonly<Required<CRTOptions>>;
export declare function createCRT(target: HTMLElement, options?: CRTOptions): CRTInstance;
