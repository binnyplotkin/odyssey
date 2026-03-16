import { NextRequest, NextResponse } from "next/server";
import { traceTurnPipeline } from "@/lib/service";

const traceStats = {
  requests: 0,
  failures: 0,
  totalLatencyMs: 0,
};

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  traceStats.requests += 1;

  try {
    const body = await request.json();
    const result = await traceTurnPipeline(body);
    const latencyMs = Date.now() - startedAt;
    traceStats.totalLatencyMs += latencyMs;

    return NextResponse.json({
      ...result,
      observability: {
        latencyMs,
        rollingErrorRate:
          traceStats.requests === 0 ? 0 : traceStats.failures / traceStats.requests,
        requests: traceStats.requests,
        failures: traceStats.failures,
        avgLatencyMs:
          traceStats.requests === 0 ? 0 : traceStats.totalLatencyMs / traceStats.requests,
        estimatedCostUsd: result.meta.estimatedCostUsd,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build engine trace.";
    const status = message.includes("required") || message.includes("Unknown") ? 400 : 500;
    const latencyMs = Date.now() - startedAt;
    traceStats.failures += 1;
    traceStats.totalLatencyMs += latencyMs;

    return NextResponse.json(
      {
        error: message,
        observability: {
          latencyMs,
          rollingErrorRate:
            traceStats.requests === 0 ? 0 : traceStats.failures / traceStats.requests,
          requests: traceStats.requests,
          failures: traceStats.failures,
          avgLatencyMs:
            traceStats.requests === 0 ? 0 : traceStats.totalLatencyMs / traceStats.requests,
          estimatedCostUsd: null,
        },
      },
      { status },
    );
  }
}
