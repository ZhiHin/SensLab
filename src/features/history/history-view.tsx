"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Callout, StatusPill } from "@/components/primitives";
import type { HistoryView } from "@/services/history-service";

/**
 * SCR-041 — History (doc 25 §25.12, FR-090).
 *
 * A row per session with what doc 25 lists: date, game, DPI, cm/360, confidence and profile.
 * Sessions run on a different hardware profile are marked, because comparing across them is
 * flagged (`SENS-BR-019`) and the mark is what makes that predictable rather than surprising.
 *
 * Comparison is a **two-step selection** rather than a per-row button: a comparison needs two
 * sessions, and a control that pretends otherwise would have to guess the second.
 */

const fmt = (value: number | null, decimals = 1): string =>
  value === null ? "—" : value.toFixed(decimals);

const dateOf = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const VALIDATION_PILL: Readonly<Record<string, string>> = {
  improved: "validated · improved",
  no_measurable_difference: "validated · no difference",
  worse: "validated · original kept",
};

export function HistoryList({ view }: { view: HistoryView }) {
  const router = useRouter();
  const params = useSearchParams();
  const [selected, setSelected] = useState<readonly string[]>([]);

  const comparable = view.items.filter((item) => item.recommendationId !== null);
  const toggle = (sessionId: string) => {
    setSelected((current) =>
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId].slice(-2),
    );
  };

  const filter = (profileId: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (profileId === null) next.delete("profile");
    else next.set("profile", profileId);
    router.push(`/history${next.size > 0 ? `?${next.toString()}` : ""}`);
  };

  return (
    <main id="main" className="mx-auto flex w-full max-w-[1000px] flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <span className="type-label">History</span>
          <h1 className="type-display-s">YOUR SESSIONS</h1>
        </div>
        <Link
          href="/calibrate"
          className="border border-text-1 px-6 py-3 type-label"
          data-testid="recalibrate"
        >
          Re-calibrate
        </Link>
      </header>

      {view.profiles.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="profile-filter">
          <span className="type-label text-text-3">Hardware</span>
          <button
            type="button"
            className="border px-3 py-1 type-label data-[on=true]:border-text-1 data-[on=false]:border-hairline"
            data-on={view.filteredProfileId === null}
            onClick={() => filter(null)}
            data-testid="filter-all"
          >
            All
          </button>
          {view.profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className="border px-3 py-1 type-label data-[on=true]:border-text-1 data-[on=false]:border-hairline"
              data-on={view.filteredProfileId === profile.id}
              onClick={() => filter(profile.id)}
              data-testid={`filter-${profile.id}`}
            >
              {profile.name}
            </button>
          ))}
        </div>
      )}

      {view.items.length === 0 ? (
        <section
          className="flex flex-col gap-4 border border-hairline p-8"
          data-testid="history-empty"
        >
          <h2 className="type-display-s">NOTHING MEASURED YET</h2>
          <p className="max-w-[60ch] text-text-2">
            Sessions appear here once you finish one. Each keeps its own evidence — the response
            curve, the confidence breakdown, the hardware it ran on — so a result from months ago is
            still readable exactly as it was produced.
          </p>
          <Link href="/calibrate" className="type-label underline">
            Start your first calibration
          </Link>
        </section>
      ) : (
        <div className="flex flex-col" data-testid="history-list">
          {view.items.map((item) => {
            const differentHardware =
              view.filteredProfileId === null &&
              item.hardwareProfileId !== view.items[0]?.hardwareProfileId;
            return (
              <article
                key={item.sessionId}
                className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-hairline py-4"
                data-testid={`history-row-${item.sessionId}`}
              >
                <span className="type-label w-24 text-text-3">{dateOf(item.startedAt)}</span>
                <span className="type-label w-24">{item.gameName ?? "No game"}</span>
                <span className="type-data-s w-24 text-text-3">{item.dpi ?? "—"} DPI</span>
                <span className="type-data-s w-28">
                  {item.recommendedCm360 === null ? (
                    <span className="text-text-3">no single peak</span>
                  ) : (
                    `${fmt(item.recommendedCm360)} cm`
                  )}
                </span>
                <span className="type-data-s w-16 text-text-3">
                  {item.confidenceIndex === null ? "—" : `${item.confidenceIndex}/100`}
                </span>
                <span className="type-label w-40 text-text-2">{item.aimProfileName ?? "—"}</span>

                <span className="flex flex-1 flex-wrap items-center justify-end gap-2">
                  {item.validationVerdict !== null && (
                    <StatusPill tone={item.validationVerdict === "worse" ? "caution" : "verified"}>
                      {VALIDATION_PILL[item.validationVerdict] ?? "validated"}
                    </StatusPill>
                  )}
                  {item.superseded && <StatusPill tone="neutral">superseded</StatusPill>}
                  {differentHardware && (
                    <StatusPill tone="caution">
                      {item.hardwareProfileName ?? "different hardware"}
                    </StatusPill>
                  )}
                  {item.recommendationId !== null ? (
                    <>
                      <label className="flex items-center gap-2 text-sm text-text-3">
                        <input
                          type="checkbox"
                          checked={selected.includes(item.sessionId)}
                          onChange={() => toggle(item.sessionId)}
                          data-testid={`compare-${item.sessionId}`}
                        />
                        compare
                      </label>
                      <Link
                        href={`/results/${item.recommendationId}`}
                        className="type-label underline"
                        data-testid={`open-${item.sessionId}`}
                      >
                        Open
                      </Link>
                    </>
                  ) : (
                    <span className="type-label text-text-3">{item.status}</span>
                  )}
                </span>

                <span className="basis-full text-xs text-text-3">
                  {item.mode}
                  {item.hardwareProfileName === null ? "" : ` · ${item.hardwareProfileName}`}
                  {item.hardwareProfileDeleted ? " (deleted profile)" : ""}
                  {item.environmentClass === "degraded" ? " · degraded environment" : ""}
                  {item.versions.calibration === null ? "" : ` · ${item.versions.calibration}`}
                </span>
              </article>
            );
          })}
        </div>
      )}

      {comparable.length >= 2 && (
        <div className="flex flex-wrap items-center gap-4" data-testid="compare-bar">
          <span className="text-sm text-text-3">
            {selected.length === 0
              ? "Tick two sessions to compare them."
              : selected.length === 1
                ? "Tick one more."
                : "Ready."}
          </span>
          <Link
            href={
              selected.length === 2
                ? `/history/compare?a=${selected[0] ?? ""}&b=${selected[1] ?? ""}`
                : "/history"
            }
            className="border border-hairline px-5 py-2 type-label data-[ready=false]:pointer-events-none data-[ready=false]:opacity-40"
            data-ready={selected.length === 2}
            data-testid="compare-selected"
          >
            Compare the two
          </Link>
        </div>
      )}

      <Callout tone="neutral" title="Two numbers are not a trend">
        A comparison only calls a change meaningful when the two high-performance ranges do not
        overlap, and it flags a comparison whose sessions used different hardware, a different mode,
        or a different version of the algorithm.
      </Callout>
    </main>
  );
}
