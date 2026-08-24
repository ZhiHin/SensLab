import type { Metadata } from "next";
import { CalibrationSurface } from "@/features/calibrate/calibration-surface";
import { listProfiles } from "@/services/hardware-service";
import { outputGameOptions } from "@/services/recommendation-service";
import { getActor } from "@/services/session-context";

/**
 * The calibration session (doc 04 journey J-01).
 *
 * Guest-first: no account is needed to calibrate (`SENS-BR-001`). A guest's result keeps for
 * seven days; the results page says so and offers the save. A signed-in user's saved hardware
 * profiles are offered as a prefill — never as a requirement.
 */
export const metadata: Metadata = {
  title: "Calibrate",
  description: "Find the mouse sensitivity your hands actually perform best with.",
};

export default async function CalibratePage() {
  const profiles = await listProfiles(await getActor());
  return (
    <CalibrationSurface
      games={outputGameOptions()}
      profiles={profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        dpi: profile.dpi,
        dpiSource: profile.dpiSource,
        mousepadWidthMm: profile.mousepadWidthMm,
        isDefault: profile.isDefault,
      }))}
    />
  );
}
