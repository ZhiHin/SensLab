import { NextResponse } from "next/server";
import { runBootChecks } from "@/services/boot-service";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger({ base: { component: "health" } });

/**
 * Health and integrity endpoint.
 *
 * Reports whether the compiled algorithm parameter sets and the registered game adapters
 * agree with what the database recorded (doc 14 §14.9, doc 12 §12.4). A mismatch means the
 * running code and the stored results disagree about what produced them, so it returns 503:
 * a load balancer should take this instance out of rotation rather than serve
 * recommendations it cannot explain.
 *
 * The response body names the *category* of problem, never internals — the detail goes to
 * the structured log (`SENS-SEC-016`).
 */
export async function GET(): Promise<NextResponse> {
  try {
    const result = await runBootChecks();
    if (result.ok) {
      return NextResponse.json({ status: "ok" }, { status: 200 });
    }

    return NextResponse.json(
      {
        status: "degraded",
        problems: {
          parameterSets: result.parameterProblems.length,
          adapters: result.adapterProblems.length,
        },
      },
      { status: 503 },
    );
  } catch (error: unknown) {
    log.error("health check failed", {
      detail: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
