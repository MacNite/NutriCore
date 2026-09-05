/**
 * Turning approved backfill into something another NutriCore can import.
 *
 * The values an instance's administrator has approved are useful to every other
 * instance running the same bundled databases, and there is no reason for each
 * of them to spend the same model calls rediscovering that BLS carries no
 * iodine figure for a cheese. This produces the artifact that carries them.
 *
 * Two rules decide what may travel, and both are about identity rather than
 * quality:
 *
 *  - **Only foods with an external id.** A BLS code or an FDC id means the same
 *    food on every deployment; an internal cuid does not, and a food somebody
 *    created has no cross-deployment identity at all. That filter also happens
 *    to remove every private food from the shared artifact, which is why the
 *    export needs no consent question of its own.
 *  - **Only values still live and still the model's.** Read from
 *    `FoodNutrient.origin`, not from what a run once recorded writing: a value
 *    a dataset has since reclaimed, or a reviewer has since refused, is simply
 *    no longer there and must not be shipped as though it were.
 *
 * Every exported value carries the page it was read from and the model that
 * read it, so the AI tag survives the journey and the receiving instance can
 * mark it exactly as this one does.
 */
import { prisma } from "@/lib/db";
import { AI_ENRICHMENT_ORIGIN } from "@/lib/nutrients";

/** One value, with the provenance that lets the far end attribute it. */
export interface ExportedValue {
  key: string;
  value: number;
  sourceUrl: string | null;
  model: string | null;
  retrievedAt: string;
}

/** One catalogue food's contribution, keyed by an identity that travels. */
export interface ExportedFood {
  provider: string;
  externalId: string;
  /** For a human reading the artifact's diff. Never used to match anything. */
  name: string;
  values: ExportedValue[];
}

/** How many foods are read per round trip while building the artifact. */
const EXPORT_PAGE = 500;

/**
 * Collects every approved, still-live backfilled value on a catalogue food.
 *
 * Paged, because this runs over the whole catalogue and an instance that has
 * swept it has tens of thousands of foods.
 */
export async function collectEnrichmentExport(): Promise<ExportedFood[]> {
  const exported: ExportedFood[] = [];
  let cursor: string | undefined;

  for (;;) {
    const foods = await prisma.food.findMany({
      where: {
        // The identity that means the same thing on another deployment. A food
        // somebody owns has none, and is excluded by construction.
        externalProvider: { not: null },
        externalId: { not: null },
        ownerId: null,
        nutrients: { some: { origin: AI_ENRICHMENT_ORIGIN, value: { not: null } } },
      },
      select: {
        id: true,
        name: true,
        externalProvider: true,
        externalId: true,
        nutrients: {
          where: { origin: AI_ENRICHMENT_ORIGIN, value: { not: null } },
          select: { nutrientKey: true, value: true },
        },
        enrichmentProposals: {
          select: {
            sourceUrl: true,
            model: true,
            retrievedAt: true,
            values: {
              where: { status: "APPROVED" },
              select: { nutrientKey: true },
            },
          },
        },
      },
      orderBy: { id: "asc" },
      take: EXPORT_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!foods.length) break;
    cursor = foods[foods.length - 1].id;

    for (const food of foods) {
      // Which run each live value came from, newest first so a re-approval
      // supersedes the run it replaced.
      const provenance = new Map<string, { sourceUrl: string | null; model: string | null; retrievedAt: Date }>();
      const runs = [...food.enrichmentProposals].sort((a, b) => b.retrievedAt.getTime() - a.retrievedAt.getTime());
      for (const run of runs) {
        for (const value of run.values) {
          if (!provenance.has(value.nutrientKey)) {
            provenance.set(value.nutrientKey, { sourceUrl: run.sourceUrl, model: run.model, retrievedAt: run.retrievedAt });
          }
        }
      }

      const values = food.nutrients.flatMap((nutrient) => {
        const source = provenance.get(nutrient.nutrientKey);
        // A value nothing can account for is not shipped. Everything this
        // instance wrote has a proposal behind it - including the rows the
        // review migration reconstructed - so an unattributable value means
        // something is off, and guessing is the wrong answer for data that
        // becomes everybody's baseline.
        if (!source || nutrient.value === null) return [];
        return [{
          key: nutrient.nutrientKey,
          value: Number(nutrient.value),
          sourceUrl: source.sourceUrl,
          model: source.model,
          retrievedAt: source.retrievedAt.toISOString(),
        }];
      });

      if (!values.length) continue;
      exported.push({
        provider: food.externalProvider!,
        externalId: food.externalId!,
        name: food.name,
        // Stable order, so regenerating an unchanged catalogue produces an
        // identical artifact and the repo diff shows only real changes.
        values: values.sort((a, b) => a.key.localeCompare(b.key)),
      });
    }

    if (foods.length < EXPORT_PAGE) break;
  }

  return exported.sort((a, b) => a.provider.localeCompare(b.provider) || a.externalId.localeCompare(b.externalId));
}

/** The artifact's body: one JSON object per line, in the bundled-dataset shape. */
export const enrichmentNdjson = (foods: ExportedFood[]) =>
  foods.map((food) => `${JSON.stringify(food)}\n`).join("");
