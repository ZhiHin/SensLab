"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * The five-act scroll narrative (doc 25 §25.1 acts 1–5).
 *
 * ```
 *   REACT  →  FLICK  →  TRACK  →  CONTROL  →  OPTIMIZE
 * ```
 *
 * One persistent reticle element morphs as scroll progress drives it, rather than five stacked
 * cards — doc 26 §26.2 prohibits the card grid as a default, and the point of the sequence is
 * that these are stages of one measurement rather than five features.
 *
 * ## No scroll hijacking
 *
 * Progress is *observed* (`IntersectionObserver`), never *driven*. The page scrolls at exactly
 * the speed the browser scrolls it; what changes is which act is emphasised. FR-102 forbids
 * hijacking, and a narrative that fought the scrollbar would be the thing the design system
 * calls decoration.
 *
 * Under reduced motion every act renders at full opacity from the start: the content is the
 * same, the transitions are not.
 */

export interface Act {
  readonly index: string;
  readonly title: string;
  readonly lead: string;
  readonly body: readonly string[];
  /** What the instrument panel reads for this act. Real quantities, never invented ones. */
  readonly readout: { readonly label: string; readonly value: string; readonly unit: string };
}

export function ActSequence({ acts }: { readonly acts: readonly Act[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const elements = refs.current.filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // The act nearest the middle of the viewport is the active one. Taking the most
        // intersecting entry rather than the first keeps the emphasis stable when two acts
        // are partly visible during a fast scroll.
        let best: { index: number; ratio: number } | null = null;
        for (const entry of entries) {
          const index = elements.indexOf(entry.target as HTMLElement);
          if (index < 0) continue;
          if (best === null || entry.intersectionRatio > best.ratio) {
            best = { index, ratio: entry.intersectionRatio };
          }
        }
        if (best !== null && best.ratio > 0) setActive(best.index);
      },
      { rootMargin: "-35% 0px -35% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [acts.length]);

  const reduced = typeof document !== "undefined" && prefersReducedMotion();

  return (
    <section aria-labelledby="how-it-works" className="relative" data-testid="act-sequence">
      <h2 id="how-it-works" className="sr-only">
        How the calibration works
      </h2>

      {/* The progress rail: five real stages, marked. Sticky on desktop so the reticle
          persists through the narrative rather than reappearing per act. */}
      <ol
        className="sticky top-0 z-10 hidden gap-6 border-b border-hairline bg-void/90 px-6 py-3 backdrop-blur-sm lg:flex"
        aria-label="Calibration stages"
      >
        {acts.map((act, index) => (
          <li key={act.title} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-[6px] w-[6px] border data-[on=true]:border-accent data-[on=true]:bg-accent data-[on=false]:border-hairline-strong"
              data-on={index <= active}
            />
            <span
              className="type-label data-[on=true]:text-text-1 data-[on=false]:text-text-3"
              data-on={index === active}
              aria-current={index === active ? "step" : undefined}
            >
              {act.title}
            </span>
          </li>
        ))}
      </ol>

      {acts.map((act, index) => (
        <article
          key={act.title}
          ref={(element) => {
            refs.current[index] = element;
          }}
          className="mx-auto flex w-full max-w-[1100px] flex-col gap-8 px-6 py-20 lg:flex-row lg:items-center lg:gap-16 lg:py-28 lg:even:flex-row-reverse"
          data-testid={`act-${act.title.toLowerCase()}`}
        >
          <div
            className="flex-1 border-l pl-6 transition-colors duration-500 data-[active=false]:border-transparent data-[active=true]:border-accent-dim"
            data-active={reduced || index === active}
          >
            <p className="type-label text-text-3">
              {act.index} / {act.title}
            </p>
            <p className="mt-4 max-w-[46ch] type-display-s text-text-1">{act.lead}</p>
            {act.body.map((paragraph) => (
              <p key={paragraph} className="mt-4 max-w-[52ch] text-text-2">
                {paragraph}
              </p>
            ))}
          </div>

          <div className="flex-1">
            <div
              className="reticle-corners relative border border-hairline bg-surface p-8 transition-opacity duration-500 data-[active=false]:opacity-60 data-[active=true]:opacity-100"
              data-active={reduced || index === active}
            >
              <div className="instrument-grid pointer-events-none absolute inset-0" aria-hidden />
              <p className="type-label text-text-3">{act.readout.label}</p>
              <p className="mt-2 flex items-baseline gap-3">
                <span className="type-data-l text-accent">{act.readout.value}</span>
                <span className="type-label text-text-3">{act.readout.unit}</span>
              </p>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
