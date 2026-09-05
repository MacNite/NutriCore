import { NextResponse } from "next/server";
import { gzipSync } from "node:zlib";
import { getSessionUser } from "@/server/session";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { collectEnrichmentExport, enrichmentNdjson } from "@/server/enrichment-export";

/**
 * The same artifact `npm run datasets:export:enrichment` writes, as a download.
 *
 * The CLI is the contribution path - it writes straight into `datasets/bundled`
 * where the file has to be committed from anyway - but an operator without a
 * checkout should still be able to get the file out, so this hands it over.
 * What it produces is identical, and neither one publishes anything: opening
 * the pull request stays a human act.
 *
 * Administrators only, and rate limited like the other bulk exports: this reads
 * the whole catalogue.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const limit = rateLimit(`enrichment-export:${user.id}`, RATE_LIMITS.export.limit, RATE_LIMITS.export.windowMs);
  if (!limit.allowed) return NextResponse.json({ error: "rateLimited" }, { status: 429 });

  const foods = await collectEnrichmentExport();
  // Byte-identical to what the CLI writes for the same catalogue: Node's gzip
  // header carries no timestamp, and the records are sorted before serialising.
  const artifact = gzipSync(Buffer.from(enrichmentNdjson(foods)), { level: 9 });

  return new NextResponse(new Uint8Array(artifact), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="ai-enrichment-${new Date().toISOString().slice(0, 10)}.ndjson.gz"`,
      "Cache-Control": "no-store",
      // So an operator can write the manifest entry by hand if they need to.
      "X-Enrichment-Foods": String(foods.length),
    },
  });
}
