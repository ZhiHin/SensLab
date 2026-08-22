import { describe, expect, it } from "vitest";
import {
  anglesFromDirection,
  angularDistance,
  angularDistanceBetween,
  cameraBasis,
  cross,
  directionFromAngles,
  dot,
  normalise,
  offsetDirection,
  projectAngles,
  projectDirection,
  tangentAt,
  toDegrees,
  toRadians,
  wrapDegrees,
} from "@/core/geometry/angular";

/**
 * Angular geometry (doc 19 §19.5, ADR-006).
 *
 * These tests underwrite the claim that makes cm/360 meaningful: a target "20° away" costs the
 * same physical mouse travel regardless of where it sits on screen, what the FOV is, or how
 * large the window is.
 */

const TAN_HALF_X = Math.tan(toRadians(51.5));
const TAN_HALF_Y = Math.tan(toRadians(31.4));

describe("direction vectors", () => {
  it("puts the origin direction on +Z", () => {
    const forward = directionFromAngles(0, 0);
    expect(forward.x).toBeCloseTo(0, 12);
    expect(forward.y).toBeCloseTo(0, 12);
    expect(forward.z).toBeCloseTo(1, 12);
  });

  it("turns right for positive yaw and up for positive pitch", () => {
    expect(directionFromAngles(90, 0).x).toBeCloseTo(1, 12);
    expect(directionFromAngles(0, 90).y).toBeCloseTo(1, 12);
  });

  it("always produces a unit vector", () => {
    for (const yaw of [-170, -40, 0, 33, 179]) {
      for (const pitch of [-85, -20, 0, 20, 85]) {
        const d = directionFromAngles(yaw, pitch);
        expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
      }
    }
  });

  it("round-trips through angles", () => {
    for (const yaw of [-170, -40, 0, 33, 179]) {
      for (const pitch of [-80, -20, 0, 20, 80]) {
        const back = anglesFromDirection(directionFromAngles(yaw, pitch));
        expect(back.yawDeg).toBeCloseTo(yaw, 9);
        expect(back.pitchDeg).toBeCloseTo(pitch, 9);
      }
    }
  });

  it("rejects a zero vector rather than returning a meaningless angle", () => {
    expect(() => anglesFromDirection({ x: 0, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => normalise({ x: 0, y: 0, z: 0 })).toThrow(RangeError);
  });

  it("provides the vector primitives the projection needs", () => {
    expect(dot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
    expect(cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
    const unit = normalise({ x: 3, y: 4, z: 0 });
    expect(Math.hypot(unit.x, unit.y, unit.z)).toBeCloseTo(1, 12);
  });

  it("converts between degrees and radians", () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI, 12);
    expect(toDegrees(Math.PI)).toBeCloseTo(180, 12);
  });
});

describe("angular distance", () => {
  it("is zero for identical directions", () => {
    expect(
      angularDistance({ yawDeg: 33, pitchDeg: -12 }, { yawDeg: 33, pitchDeg: -12 }),
    ).toBeCloseTo(0, 9);
  });

  it("equals the yaw difference along the horizon", () => {
    expect(angularDistance({ yawDeg: 0, pitchDeg: 0 }, { yawDeg: 20, pitchDeg: 0 })).toBeCloseTo(
      20,
      9,
    );
    expect(angularDistance({ yawDeg: -10, pitchDeg: 0 }, { yawDeg: 35, pitchDeg: 0 })).toBeCloseTo(
      45,
      9,
    );
  });

  it("equals the pitch difference along a meridian", () => {
    expect(
      angularDistance({ yawDeg: 77, pitchDeg: -10 }, { yawDeg: 77, pitchDeg: 25 }),
    ).toBeCloseTo(35, 9);
  });

  it("is symmetric", () => {
    const a = { yawDeg: 12, pitchDeg: -30 };
    const b = { yawDeg: -47, pitchDeg: 18 };
    expect(angularDistance(a, b)).toBeCloseTo(angularDistance(b, a), 12);
  });

  it("uses the great circle, not a planar approximation", () => {
    // Near the pole, two directions 90° apart in yaw are far closer than 90° in space. A
    // planar approximation would report 90 and make every high-pitch metric wrong.
    //
    // The exact answer: cos θ = cos²(80°)·cos(90°) + sin²(80°) = sin²(80°), so
    // θ = acos(sin²80°) = 14.1060…°
    const separation = angularDistance({ yawDeg: 0, pitchDeg: 80 }, { yawDeg: 90, pitchDeg: 80 });
    const expected = (Math.acos(Math.sin(toRadians(80)) ** 2) * 180) / Math.PI;
    expect(separation).toBeCloseTo(expected, 9);
    expect(separation).toBeLessThan(15);
  });

  it("retains precision at the tiny angles micro-adjustment data is made of", () => {
    // acos alone loses roughly half its significant digits here; atan2 of cross and dot does not.
    const tiny = angularDistance({ yawDeg: 0, pitchDeg: 0 }, { yawDeg: 1e-6, pitchDeg: 0 });
    expect(tiny).toBeCloseTo(1e-6, 12);
  });

  it("reaches 180° for opposite directions", () => {
    expect(
      angularDistanceBetween(directionFromAngles(0, 0), directionFromAngles(180, 0)),
    ).toBeCloseTo(180, 9);
  });
});

describe("wrapDegrees", () => {
  it("wraps into the half-open range (-180, 180]", () => {
    expect(wrapDegrees(0)).toBe(0);
    expect(wrapDegrees(90)).toBe(90);
    expect(wrapDegrees(180)).toBe(180);
    expect(wrapDegrees(-180)).toBe(180);
    expect(wrapDegrees(190)).toBeCloseTo(-170, 12);
    expect(wrapDegrees(-190)).toBeCloseTo(170, 12);
    expect(wrapDegrees(720)).toBeCloseTo(0, 12);
  });

  it("keeps a signed difference meaningful across the seam", () => {
    // Without wrapping, a camera crossing 180° would report a 350° movement instead of -10°.
    expect(wrapDegrees(175 - -175)).toBeCloseTo(-10, 12);
  });
});

describe("camera basis", () => {
  it("is orthonormal at every orientation", () => {
    for (const yaw of [-120, 0, 45, 170]) {
      for (const pitch of [-60, 0, 30, 80]) {
        const basis = cameraBasis(yaw, pitch);
        expect(dot(basis.forward, basis.right)).toBeCloseTo(0, 9);
        expect(dot(basis.forward, basis.up)).toBeCloseTo(0, 9);
        expect(dot(basis.right, basis.up)).toBeCloseTo(0, 9);
        for (const axis of [basis.forward, basis.right, basis.up]) {
          expect(Math.hypot(axis.x, axis.y, axis.z)).toBeCloseTo(1, 9);
        }
      }
    }
  });

  it("keeps the horizon level: `right` never tilts, at any pitch", () => {
    // This is what makes the camera behave like an FPS rather than a flight sim.
    for (const pitch of [-80, -30, 0, 30, 80]) {
      expect(cameraBasis(20, pitch).right.y).toBeCloseTo(0, 12);
    }
  });
});

describe("projection", () => {
  it("puts the camera's forward direction at the screen centre", () => {
    const projected = projectAngles(
      { yawDeg: 25, pitchDeg: -10 },
      { yawDeg: 25, pitchDeg: -10 },
      TAN_HALF_X,
      TAN_HALF_Y,
    );
    expect(projected?.ndcX).toBeCloseTo(0, 9);
    expect(projected?.ndcY).toBeCloseTo(0, 9);
    expect(projected?.depth).toBeCloseTo(1, 9);
  });

  it("puts a target at the horizontal FOV edge at ndc ±1", () => {
    const right = projectAngles(
      { yawDeg: 51.5, pitchDeg: 0 },
      { yawDeg: 0, pitchDeg: 0 },
      TAN_HALF_X,
      TAN_HALF_Y,
    );
    expect(right?.ndcX).toBeCloseTo(1, 6);

    const left = projectAngles(
      { yawDeg: -51.5, pitchDeg: 0 },
      { yawDeg: 0, pitchDeg: 0 },
      TAN_HALF_X,
      TAN_HALF_Y,
    );
    expect(left?.ndcX).toBeCloseTo(-1, 6);
  });

  it("returns null for anything at or behind the camera plane", () => {
    // A target 100° away is not "far off screen" — it is not on screen. Returning a huge
    // coordinate would let the renderer draw it in the wrong place entirely.
    expect(
      projectAngles(
        { yawDeg: 100, pitchDeg: 0 },
        { yawDeg: 0, pitchDeg: 0 },
        TAN_HALF_X,
        TAN_HALF_Y,
      ),
    ).toBeNull();
    expect(
      projectAngles(
        { yawDeg: 180, pitchDeg: 0 },
        { yawDeg: 0, pitchDeg: 0 },
        TAN_HALF_X,
        TAN_HALF_Y,
      ),
    ).toBeNull();
    expect(
      projectAngles(
        { yawDeg: 90, pitchDeg: 0 },
        { yawDeg: 0, pitchDeg: 0 },
        TAN_HALF_X,
        TAN_HALF_Y,
      ),
    ).toBeNull();
  });

  it("moves a target left on screen when the camera turns right", () => {
    const before = projectAngles(
      { yawDeg: 20, pitchDeg: 0 },
      { yawDeg: 0, pitchDeg: 0 },
      TAN_HALF_X,
      TAN_HALF_Y,
    );
    const after = projectAngles(
      { yawDeg: 20, pitchDeg: 0 },
      { yawDeg: 10, pitchDeg: 0 },
      TAN_HALF_X,
      TAN_HALF_Y,
    );
    expect(after?.ndcX ?? 0).toBeLessThan(before?.ndcX ?? 0);
  });

  it("projects a direction directly with a supplied basis", () => {
    const basis = cameraBasis(0, 0);
    const projected = projectDirection(directionFromAngles(10, 5), basis, TAN_HALF_X, TAN_HALF_Y);
    expect(projected).not.toBeNull();
    expect(projected?.ndcX ?? 0).toBeGreaterThan(0);
    expect(projected?.ndcY ?? 0).toBeGreaterThan(0);
  });
});

describe("angular offsets", () => {
  it("offsets by exactly the requested angle", () => {
    const centre = directionFromAngles(15, 10);
    const offset = offsetDirection(centre, tangentAt(centre), 3);
    expect(angularDistanceBetween(centre, offset)).toBeCloseTo(3, 9);
  });

  it("produces a tangent perpendicular to the direction", () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [40, -20],
      [-120, 60],
    ] as const) {
      const direction = directionFromAngles(yaw, pitch);
      expect(dot(direction, tangentAt(direction))).toBeCloseTo(0, 9);
    }
  });

  it("falls back to a stable tangent at the pole, where the usual construction degenerates", () => {
    const pole = directionFromAngles(0, 90);
    const tangent = tangentAt(pole);
    expect(Math.hypot(tangent.x, tangent.y, tangent.z)).toBeCloseTo(1, 9);
    expect(dot(pole, tangent)).toBeCloseTo(0, 9);
  });
});
