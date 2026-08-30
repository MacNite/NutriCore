import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/session";
import { exportWeightCsv } from "@/server/export";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = rateLimit(`export:${user.id}`, RATE_LIMITS.export.limit, RATE_LIMITS.export.windowMs);
  if (!limit.allowed) return NextResponse.json({ error: "rateLimited" }, { status: 429 });

  const csv = `﻿${await exportWeightCsv(user.id)}`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nutricore-weight-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
