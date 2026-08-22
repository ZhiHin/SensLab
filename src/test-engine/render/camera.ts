import {
  cameraBasis,
  directionFromAngles,
  projectDirection,
  toRadians,
  type Angles,
  type CameraBasis,
  type Projection,
} from "../../core/geometry/angular";
import { verticalHalfFovFromHorizontal } from "../../core/sensitivity/fov";

/**
 * The simulated first-person camera (doc 19 §19.4–§19.5).
 *
 * Counts in, angles out. There is no acceleration, no smoothing, no dead zone and no
 * interpolation anywhere in this file, and there never may be: every one of those would make
 * the relationship between physical movement and view rotation non-linear, which is precisely
 * the relationship SensLab is measuring.
 *
 * The vertical clamp at ±89° is the only non-linearity, and it exists because the projection
 * degenerates at the pole — it matches standard FPS behaviour and is far outside the ±40° band
 * targets are allowed to occupy.
 */

export const MAX_PITCH_DEG = 89;

export interface Camera {
  readonly yawDeg: number;
  readonly pitchDeg: number;
  /** Degrees of rotation produced by one mouse count. Changes only at round boundaries. */
  readonly degreesPerCount: number;
  /** Total counts applied since the last {@link resetCounts}. */
  readonly accumulatedCounts: { readonly dx: number; readonly dy: number };

  /** Applies one raw movement sample. Synchronous, and the only mutation path. */
  applyCounts(dx: number, dy: number): void;
  /** Sets the sensitivity. Rejected while a trial is open — enforced by the caller. */
  setDegreesPerCount(value: number): void;
  setAngles(yawDeg: number, pitchDeg: number): void;
  resetCounts(): void;
  angles(): Angles;
  basis(): CameraBasis;
  /** Projects a world direction with this camera's FOV. Null when behind the camera. */
  project(target: Angles): Projection | null;
  readonly horizontalHalfFovDeg: number;
  readonly verticalHalfFovDeg: number;
}

export interface CameraOptions {
  readonly horizontalHalfFovDeg: number;
  readonly aspectRatio: number;
  readonly degreesPerCount: number;
  readonly yawDeg?: number;
  readonly pitchDeg?: number;
}

export function createCamera(options: CameraOptions): Camera {
  const { horizontalHalfFovDeg, aspectRatio } = options;
  if (!(horizontalHalfFovDeg > 0 && horizontalHalfFovDeg < 90)) {
    throw new RangeError(
      `horizontal half-FOV must be in (0, 90) degrees, received ${horizontalHalfFovDeg}`,
    );
  }
  if (!(aspectRatio > 0)) {
    throw new RangeError(`aspect ratio must be positive, received ${aspectRatio}`);
  }

  const verticalHalfFovDeg = verticalHalfFovFromHorizontal(horizontalHalfFovDeg, aspectRatio);
  const tanHalfX = Math.tan(toRadians(horizontalHalfFovDeg));
  const tanHalfY = Math.tan(toRadians(verticalHalfFovDeg));

  let yaw = options.yawDeg ?? 0;
  let pitch = options.pitchDeg ?? 0;
  let degreesPerCount = options.degreesPerCount;
  let countsX = 0;
  let countsY = 0;

  // Recomputed only when the angles change, so the hot path does not rebuild a basis per
  // projection during a frame with several targets.
  let basisCache: CameraBasis = cameraBasis(yaw, pitch);
  let basisDirty = false;

  const refreshBasis = (): CameraBasis => {
    if (basisDirty) {
      basisCache = cameraBasis(yaw, pitch);
      basisDirty = false;
    }
    return basisCache;
  };

  return {
    get yawDeg() {
      return yaw;
    },
    get pitchDeg() {
      return pitch;
    },
    get degreesPerCount() {
      return degreesPerCount;
    },
    get accumulatedCounts() {
      return { dx: countsX, dy: countsY };
    },
    get horizontalHalfFovDeg() {
      return horizontalHalfFovDeg;
    },
    get verticalHalfFovDeg() {
      return verticalHalfFovDeg;
    },

    applyCounts(dx: number, dy: number): void {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      countsX += dx;
      countsY += dy;
      yaw += dx * degreesPerCount;
      // Screen coordinates grow downward; a positive dy is a downward mouse movement, which
      // lowers the view.
      const nextPitch = pitch - dy * degreesPerCount;
      pitch =
        nextPitch > MAX_PITCH_DEG
          ? MAX_PITCH_DEG
          : nextPitch < -MAX_PITCH_DEG
            ? -MAX_PITCH_DEG
            : nextPitch;
      basisDirty = true;
    },

    setDegreesPerCount(value: number): void {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`degrees per count must be positive, received ${value}`);
      }
      degreesPerCount = value;
    },

    setAngles(nextYaw: number, nextPitch: number): void {
      yaw = nextYaw;
      pitch = Math.min(MAX_PITCH_DEG, Math.max(-MAX_PITCH_DEG, nextPitch));
      basisDirty = true;
    },

    resetCounts(): void {
      countsX = 0;
      countsY = 0;
    },

    angles(): Angles {
      return { yawDeg: yaw, pitchDeg: pitch };
    },

    basis(): CameraBasis {
      return refreshBasis();
    },

    project(target: Angles): Projection | null {
      return projectDirection(
        directionFromAngles(target.yawDeg, target.pitchDeg),
        refreshBasis(),
        tanHalfX,
        tanHalfY,
      );
    },
  };
}
