/**
 * Angular geometry for the simulated first-person camera (doc 19 §19.5, ADR-006).
 *
 * SensLab's test world is angular, not pixel-based: a target is "20° to the right", and
 * reaching it costs the same physical mouse travel regardless of window size, resolution or
 * FOV. That is what makes cm/360 the real independent variable, and it is why this module
 * exists in `core/` rather than in the renderer — the metrics need the same maths the camera
 * uses, and two implementations would eventually disagree.
 *
 * Conventions (standard FPS):
 *   yaw   — rotation about the world Y axis, increasing to the right
 *   pitch — elevation, positive upward, clamped to ±89° by the camera
 *   forward at (yaw=0, pitch=0) is +Z; right is +X; up is +Y
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Angles {
  readonly yawDeg: number;
  readonly pitchDeg: number;
}

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export const toRadians = (degrees: number): number => degrees * DEG;
export const toDegrees = (radians: number): number => radians * RAD;

/** Unit direction vector for a yaw/pitch pair. */
export function directionFromAngles(yawDeg: number, pitchDeg: number): Vec3 {
  const yaw = toRadians(yawDeg);
  const pitch = toRadians(pitchDeg);
  const cosPitch = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: Math.cos(yaw) * cosPitch,
  };
}

/** Inverse of {@link directionFromAngles}. Yaw is returned in (-180, 180]. */
export function anglesFromDirection(direction: Vec3): Angles {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length === 0) throw new RangeError("anglesFromDirection() requires a non-zero vector");
  const y = direction.y / length;
  return {
    yawDeg: toDegrees(Math.atan2(direction.x, direction.z)),
    pitchDeg: toDegrees(Math.asin(Math.min(1, Math.max(-1, y)))),
  };
}

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  if (length === 0) throw new RangeError("normalise() requires a non-zero vector");
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/**
 * True angular separation between two view directions, in degrees.
 *
 * The great-circle angle rather than a planar approximation (doc 10 §10.1). The planar form is
 * adequate near the horizon and wrong near the poles; using the exact form everywhere costs
 * one `acos` and removes a whole class of latitude-dependent bias from the metrics.
 *
 * Computed via `atan2` of the cross and dot products rather than `acos` alone, because `acos`
 * loses precision catastrophically for the small angles that dominate micro-adjustment data.
 */
export function angularDistanceBetween(a: Vec3, b: Vec3): number {
  const c = cross(a, b);
  const sine = Math.hypot(c.x, c.y, c.z);
  return toDegrees(Math.atan2(sine, dot(a, b)));
}

/** Angular separation between two yaw/pitch pairs, in degrees. */
export function angularDistance(a: Angles, b: Angles): number {
  return angularDistanceBetween(
    directionFromAngles(a.yawDeg, a.pitchDeg),
    directionFromAngles(b.yawDeg, b.pitchDeg),
  );
}

/**
 * Yaw difference wrapped to (-180, 180].
 *
 * Needed wherever a *signed* horizontal component matters — tracking lead/lag, along-axis
 * progress — because raw subtraction jumps by 360 as the camera crosses the seam.
 */
export function wrapDegrees(delta: number): number {
  const wrapped = ((((delta + 180) % 360) + 360) % 360) - 180;
  // `% 360` maps exactly -180 onto -180; the convention here is the half-open (-180, 180].
  return wrapped === -180 ? 180 : wrapped;
}

/* ------------------------------------------------------------------ camera basis */

export interface CameraBasis {
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

/**
 * Orthonormal basis for a camera with no roll.
 *
 * `right` depends only on yaw, which is what keeps the horizon level at every pitch — the
 * standard FPS behaviour, and a property the projection tests assert directly.
 */
export function cameraBasis(yawDeg: number, pitchDeg: number): CameraBasis {
  const forward = directionFromAngles(yawDeg, pitchDeg);
  const yaw = toRadians(yawDeg);
  const right: Vec3 = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  return { forward, right, up: cross(forward, right) };
}

/* ------------------------------------------------------------------ projection */

export interface Projection {
  /** Normalised device coordinates: -1 (left/bottom) to +1 (right/top). */
  readonly ndcX: number;
  readonly ndcY: number;
  /** Depth along the camera's forward axis. Positive means in front of the camera. */
  readonly depth: number;
}

/**
 * Projects a world direction into normalised device coordinates.
 *
 * Returns `null` when the direction is at or behind the camera plane — a target 100° away is
 * not "far off screen", it is not on screen at all, and returning a huge coordinate would let
 * a renderer draw it in the wrong place.
 */
export function projectDirection(
  direction: Vec3,
  basis: CameraBasis,
  tanHalfFovX: number,
  tanHalfFovY: number,
): Projection | null {
  const depth = dot(direction, basis.forward);
  if (depth <= 1e-6) return null;

  return {
    ndcX: dot(direction, basis.right) / depth / tanHalfFovX,
    ndcY: dot(direction, basis.up) / depth / tanHalfFovY,
    depth,
  };
}

/** Projects a yaw/pitch pair relative to a camera. */
export function projectAngles(
  target: Angles,
  camera: Angles,
  tanHalfFovX: number,
  tanHalfFovY: number,
): Projection | null {
  return projectDirection(
    directionFromAngles(target.yawDeg, target.pitchDeg),
    cameraBasis(camera.yawDeg, camera.pitchDeg),
    tanHalfFovX,
    tanHalfFovY,
  );
}

/**
 * Offsets a direction by an angular amount within the plane tangent at that direction.
 *
 * Used to size a target on screen: a circle of angular radius `r` projects to an ellipse, so
 * the renderer measures the projected offset rather than assuming a pixel radius. Hit testing
 * never uses this — that happens in angular space, where a circle is a circle.
 */
export function offsetDirection(direction: Vec3, tangent: Vec3, angleDeg: number): Vec3 {
  const angle = toRadians(angleDeg);
  const t = normalise(tangent);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  return normalise({
    x: direction.x * cosA + t.x * sinA,
    y: direction.y * cosA + t.y * sinA,
    z: direction.z * cosA + t.z * sinA,
  });
}

/**
 * A tangent vector at `direction`, perpendicular to it and to the world up axis where
 * possible. Falls back to a stable alternative at the poles.
 */
export function tangentAt(direction: Vec3): Vec3 {
  const worldUp: Vec3 = { x: 0, y: 1, z: 0 };
  const candidate = cross(worldUp, direction);
  if (Math.hypot(candidate.x, candidate.y, candidate.z) > 1e-6) return normalise(candidate);
  return normalise(cross({ x: 1, y: 0, z: 0 }, direction));
}
