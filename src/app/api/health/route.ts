import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness plus a database round-trip, so an unreachable database marks the
 * container unhealthy instead of letting it serve broken pages.
 */
export async function GET() {
  let database = "error";
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "ok";
  } catch {
    database = "error";
  }

  const healthy = database === "ok";
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", service: "nutricore", database, time: new Date().toISOString() },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
