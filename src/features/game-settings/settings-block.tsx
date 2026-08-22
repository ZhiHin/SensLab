import { Callout, Label, Panel, Readout, StatusPill } from "@/components/primitives";
import type { GameSettingsView } from "@/services/conversion-service";
import { CANONICAL_STILL_VALID, REFUSAL_COPY, STATUS_COPY, WHY_NO_NUMBER } from "./copy";

/**
 * The settings block (FR-080, doc 24 SCR-032).
 *
 * Entirely data-driven: it renders whatever set of fields the adapter declares, in whatever
 * order, with whatever labels — because a game's settings menu is the adapter's business and
 * a component that hardcoded field names would have to change every time a game is added.
 * Doc 12 §12.1's promise is that adding a game is data plus one module; a switch statement
 * in here would quietly break that.
 *
 * The canonical targets render **first and always**. That ordering is the argument: the
 * measurement is the result, and the game setting is a convenience derived from it.
 */

function formatNumber(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

export function CanonicalBlock({ view }: { view: GameSettingsView }) {
  const { canonical } = view;
  return (
    <Panel title="Your calibrated sensitivity">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Readout label="Distance / 360°" value={formatNumber(canonical.cmPer360, 1)} unit="cm" />
        <Readout
          label="Counts / 360°"
          value={formatNumber(canonical.countsPer360, 0)}
          unit="counts"
        />
        <Readout label="Inches / 360°" value={formatNumber(canonical.inchesPer360, 2)} unit="in" />
        <Readout label="Degrees / cm" value={formatNumber(canonical.degreesPerCm, 1)} unit="°/cm" />
      </div>
      <p className="mt-4 max-w-[68ch] text-sm text-text-3">{CANONICAL_STILL_VALID}</p>
    </Panel>
  );
}

export function SettingsBlock({ view }: { view: GameSettingsView }) {
  const { game, settings, refusal } = view;

  if (game === null) {
    return (
      <Callout tone="neutral" title="No game selected">
        Your result above works in any game: match the centimetres per 360° and you have the same
        physical sensitivity, whatever the game calls its number.
      </Callout>
    );
  }

  const status = STATUS_COPY[game.status];

  return (
    <Panel title="Game settings">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="type-label text-text-1">{game.displayName.en}</span>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        <span className="type-label text-text-3">
          adapter {game.adapterVersion} · build {game.gameVersionLabel}
        </span>
      </div>

      <p className="mb-5 max-w-[68ch] text-sm text-text-2">{status.summary}</p>

      {settings === null ? (
        <div className="flex flex-col gap-4">
          <Callout tone="unverified" title="No number, on purpose">
            <p>
              {refusal === null
                ? REFUSAL_COPY.EXTERNAL_VERIFICATION_REQUIRED
                : REFUSAL_COPY[refusal.code]}
            </p>
            {refusal?.registerEntry !== undefined && (
              <p className="mt-2 text-text-3">
                Tracked as <span className="type-data-s">{refusal.registerEntry}</span>.
              </p>
            )}
          </Callout>
          <p className="max-w-[68ch] text-sm text-text-3">{WHY_NO_NUMBER}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <dl className="flex flex-col gap-3" data-testid="emitted-settings">
            {settings.settings.map((setting) => (
              <div
                key={setting.key}
                className="flex items-baseline justify-between gap-4 border-b border-hairline pb-3"
              >
                <dt className="type-label text-text-2">{setting.label.en}</dt>
                <dd className="type-data-l text-text-1" data-setting-key={setting.key}>
                  {setting.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="grid grid-cols-2 gap-6">
            <Readout
              label="You will actually get"
              value={formatNumber(settings.achievedCmPer360, 2)}
              unit="cm/360°"
            />
            <Readout
              label="Difference from target"
              value={`${settings.quantisationErrorPct >= 0 ? "+" : ""}${formatNumber(settings.quantisationErrorPct, 2)}`}
              unit="%"
            />
          </div>

          {settings.settings.some((setting) => setting.clamped) && (
            <Callout tone="caution" title="Outside this game's range">
              This game cannot be set that slow or that fast at your current DPI. The value shown is
              the closest it allows — changing your DPI is the way to actually reach your target.
            </Callout>
          )}

          {view.dpiSuggestion !== null && (
            <Callout tone="caution" title="A DPI that lands exactly">
              This game&rsquo;s setting steps are coarse enough that no value lands on your target.
              At <span className="type-data-s">{view.dpiSuggestion.dpi}</span> DPI, a setting of{" "}
              <span className="type-data-s">{view.dpiSuggestion.settingValue}</span> would be exact.
            </Callout>
          )}

          {settings.verification === "needs_recheck" && settings.lastVerifiedAt !== undefined && (
            <p className="text-sm text-text-3">
              Last verified against build {settings.gameVersionLabel} on{" "}
              {settings.lastVerifiedAt.slice(0, 10)}.
            </p>
          )}

          {settings.conversionMethod !== "direct" && (
            <p className="text-sm text-text-3">
              Matched using the {settings.conversionMethod.replace(/_/g, " ")} criterion
              {settings.conversionCoefficient !== null
                ? ` at ${settings.conversionCoefficient} of the half screen`
                : ""}
              . There is no single correct criterion — this one is our default, and it is yours to
              change.
            </p>
          )}
        </div>
      )}

      {game.openRegisterEntries.length > 0 && (
        <p className="mt-5 type-label text-text-3">
          Outstanding verification: {game.openRegisterEntries.join(", ")}
        </p>
      )}
    </Panel>
  );
}

export function ScopeList({ view }: { view: GameSettingsView }) {
  if (view.game === null || view.game.scopes.length === 0) return null;

  return (
    <Panel title="Scopes">
      <ul className="flex flex-col gap-2">
        {view.game.scopes.map((scope) => {
          const status = STATUS_COPY[scope.status];
          return (
            <li key={scope.scopeKey} className="flex items-center justify-between gap-4">
              <span className="text-sm text-text-2">
                {scope.displayName.en}
                <Label className="ml-3 text-text-3">{scope.settingLabel.en}</Label>
              </span>
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
