"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * The landing hero's interactive field (doc 25 §25.1 act 0, doc 27 §27.3).
 *
 * A measurement grid with drifting reticle marks that parallax to the pointer by **at most
 * 8 px**. The cap is the whole design: enough that the surface feels responsive, little enough
 * that nothing reads as decoration moving for its own sake.
 *
 * Off entirely under reduced motion and on touch — a parallax driven by a pointer that does
 * not hover has nothing to track, and a device without a fine pointer is one the calibration
 * cannot run on anyway.
 *
 * Implemented as a transform on a static SVG rather than an animation loop over particles: one
 * composited property, no layout, and nothing to schedule when the pointer is still.
 */

const MAX_PARALLAX_PX = 8;

export function HeroField() {
  const fieldRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const field = fieldRef.current;
    if (field === null) return;
    if (prefersReducedMotion()) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let frame = 0;
    let targetX = 0;
    let targetY = 0;

    const onMove = (event: PointerEvent) => {
      // Normalised to [-1, 1] from the viewport centre, then scaled: the field tracks where
      // the pointer is, not how fast it moved.
      targetX = (event.clientX / window.innerWidth - 0.5) * 2;
      targetY = (event.clientY / window.innerHeight - 0.5) * 2;
      if (frame === 0) {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          field.style.transform = `translate3d(${(-targetX * MAX_PARALLAX_PX).toFixed(2)}px, ${(
            -targetY * MAX_PARALLAX_PX
          ).toFixed(2)}px, 0)`;
        });
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={fieldRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-[-8px] will-change-transform"
      data-testid="hero-field"
    >
      <div className="instrument-grid absolute inset-0" />
      <svg className="absolute inset-0 h-full w-full" role="presentation">
        {/* Reticle marks at fixed positions: a scale that corresponds to nothing would be the
            decorative-instrument dishonesty doc 26 §26.5 prohibits, so these are marks, not
            ticks pretending to measure. */}
        {[
          { x: "12%", y: "22%" },
          { x: "78%", y: "18%" },
          { x: "64%", y: "72%" },
          { x: "22%", y: "78%" },
          { x: "88%", y: "48%" },
        ].map((mark) => (
          <g key={`${mark.x}-${mark.y}`} stroke="var(--color-hairline-strong)" strokeWidth="1">
            <line x1={mark.x} y1={mark.y} x2={mark.x} y2={mark.y} />
            <circle cx={mark.x} cy={mark.y} r="14" fill="none" opacity="0.5" />
            <line
              x1={`calc(${mark.x} - 22px)`}
              y1={mark.y}
              x2={`calc(${mark.x} - 8px)`}
              y2={mark.y}
            />
            <line
              x1={`calc(${mark.x} + 8px)`}
              y1={mark.y}
              x2={`calc(${mark.x} + 22px)`}
              y2={mark.y}
            />
            <line
              x1={mark.x}
              y1={`calc(${mark.y} - 22px)`}
              x2={mark.x}
              y2={`calc(${mark.y} - 8px)`}
            />
            <line
              x1={mark.x}
              y1={`calc(${mark.y} + 8px)`}
              x2={mark.x}
              y2={`calc(${mark.y} + 22px)`}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
