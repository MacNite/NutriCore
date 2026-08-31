import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/server/session";
import { searchFoods } from "@/server/foods";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";

const query = z.object({
  q: z.string().trim().max(200),
  meal: z.string().trim().max(20).optional(),
  remote: z.enum(["0", "1"]).optional(),
});

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = rateLimit(`search:${user.id}`, RATE_LIMITS.search.limit, RATE_LIMITS.search.windowMs);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rateLimited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const url = new URL(request.url);
  const parsed = query.safeParse({
    q: url.searchParams.get("q") ?? "",
    meal: url.searchParams.get("meal") ?? undefined,
    remote: url.searchParams.get("remote") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });

  const outcome = await searchFoods({
    userId: user.id,
    query: parsed.data.q,
    locale: user.language,
    meal: parsed.data.meal,
    includeRemote: parsed.data.remote === "1",
  });

  return NextResponse.json(outcome, { headers: { "Cache-Control": "no-store" } });
}
