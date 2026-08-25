import type { Metadata } from "next";
import { CapabilityGate } from "@/features/calibrate/capability-gate";
import { CalibrationSurface } from "@/features/calibrate/calibration-surface";
import { listProfiles } from "@/services/hardware-service";
import { estimatedSessionMinutes, outputGameOptions } from "@/services/recommendation-service";
import { getActor } from "@/services/session-context";

/**
 * The calibration session (doc 04 journey J-01).
 *
 * Guest-first: no account is needed to calibrate (`SENS-BR-001`). A guest's result keeps for
 * seven days; the results page says so and offers the save. A signed-in user's saved hardware
 * profiles are offered as a prefill — never as a requirement.
 *
 * The capability gate wraps the whole surface (FR-100): a device that cannot produce this
 * measurement is told so plainly rather than offered a degraded version of it.
 */
export const metadata: Metadata = {
  title: "Calibrate",
  description: "Find the mouse sensitivity your hands actually perform best with.",
};

export default async function CalibratePage() {
  const profiles = await listProfiles(await getActor());
  return (
    <CapabilityGate>
      <CalibrationSurface
        games={outputGameOptions()}
        estimatedMinutes={{
          quick: estimatedSessionMinutes("quick"),
          standard: estimatedSessionMinutes("standard"),
          advanced: estimatedSessionMinutes("advanced"),
        }}
        profiles={profiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          dpi: profile.dpi,
          dpiSource: profile.dpiSource,
          mousepadWidthMm: profile.mousepadWidthMm,
          isDefault: profile.isDefault,
        }))}
      />
    </CapabilityGate>
  );
}
