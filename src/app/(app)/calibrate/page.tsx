import type { Metadata } from "next";
import { CalibrationSurface } from "@/features/calibrate/calibration-surface";
import { outputGameOptions } from "@/services/recommendation-service";

/**
 * The calibration session (doc 04 journey J-01).
 *
 * Guest-first: no account is needed to calibrate (`SENS-BR-001`). A guest's result keeps for
 * seven days; the results page says so and offers the save.
 */
export const metadata: Metadata = {
  title: "Calibrate",
  description: "Find the mouse sensitivity your hands actually perform best with.",
};

export default function CalibratePage() {
  return <CalibrationSurface games={outputGameOptions()} />;
}
