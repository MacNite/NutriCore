/**
 * BLS 4.0 mapping, against real records from the bundled dataset.
 *
 * The fixtures in `__fixtures__/bls-records.json` are copied verbatim out of
 * `datasets/bundled/bls-4.0.ndjson.gz`, so these tests fail if the conversion
 * or the mapping ever stops agreeing with the actual Bundeslebensmittel-
 * schlüssel rather than with an idealised version of it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BLS_COMPONENT_MAP,
  assertBlsComponentUnits,
  blsFoodType,
  blsRawState,
  mapBlsRecord,
  mapBlsRecords,
  parseBlsValue,
  splitNameVariants,
  type BlsComponent,
  type BlsRecord,
} from "./bls";
import { NUTRIENT_BY_KEY } from "@/lib/nutrients";

const records = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "bls-records.json"), "utf8"),
) as BlsRecord[];

const components = (
  JSON.parse(readFileSync(join(process.cwd(), "datasets", "bundled", "bls-4.0-components.json"), "utf8")) as {
    components: BlsComponent[];
  }
).components;

const byCode = (code: string) => {
  const record = records.find((entry) => entry.code === code);
  if (!record) throw new Error(`fixture ${code} is missing`);
  return record;
};

const oats = byCode("C131000");
const salt = byCode("R111000");

describe("BLS value parsing", () => {
  it("reads a measurement as a value", () => {
    expect(parseBlsValue(11.45, "Literatur")).toEqual({ known: true, value: 11.45, qualifier: null });
  });

  it("treats the source's own dash as unknown rather than as zero", () => {
    // 110,083 cells in BLS 4.0 hold this. Reading the column as numbers turns
    // every one of them into a zero, which is the single worst thing an
    // importer of this dataset can do.
    expect(parseBlsValue("-", "-")).toEqual({ known: false, value: null, qualifier: null });
  });

  it("keeps a zero the source states as a fact about the food", () => {
    // Oats contain no alcohol, and BLS says so with a value rather than a hole.
    expect(parseBlsValue(0, "Logische Null")).toEqual({ known: true, value: 0, qualifier: "LOGICAL_ZERO" });
  });

  it("records traces and detection limits as present but unquantified", () => {
    expect(parseBlsValue("TR", "Spuren")).toEqual({ known: true, value: null, qualifier: "TRACE" });
    expect(parseBlsValue("<LOD", "Analyse")).toEqual({ known: true, value: null, qualifier: "BELOW_LOD" });
    expect(parseBlsValue("<LOQ", "Analyse")).toEqual({ known: true, value: null, qualifier: "BELOW_LOQ" });
    expect(parseBlsValue("<LOD or <LOQ", "Analyse")).toEqual({
      known: true,
      value: null,
      qualifier: "BELOW_LOD_OR_LOQ",
    });
  });

  it("reports a token it does not recognise instead of inventing a number", () => {
    const parsed = parseBlsValue("n. b.", "Analyse");
    expect(parsed.known).toBe(false);
    expect(parsed.unexpected).toBe("n. b.");
  });

  it("does not mistake a zero from a calculation for a stated logical zero", () => {
    expect(parseBlsValue(0, "Rezeptberechnung")).toEqual({ known: true, value: 0, qualifier: null });
  });
});

describe("BLS nutrient mapping", () => {
  const mapped = mapBlsRecord(oats)!;

  it("maps a real record onto the canonical catalogue", () => {
    expect(mapped.externalId).toBe("C131000");
    expect(mapped.name).toBe("Hafer ganzes Korn, roh");
    expect(mapped.nutrients.energyKcal).toMatchObject({ value: 343, sourceUnit: "kcal" });
    expect(mapped.nutrients.protein?.value).toBeCloseTo(11.375, 5);
  });

  it("converts every unit BLS states differently from NutriCore", () => {
    // The four that differ. Each was verified against the source workbook.
    expect(mapped.nutrients.sodium).toMatchObject({ value: 0.008, sourceValue: 8, sourceUnit: "mg" });
    expect(mapped.nutrients.copper).toMatchObject({ value: 0.484, sourceValue: 484, sourceUnit: "µg" });
    expect(mapped.nutrients.manganese).toMatchObject({ value: 6.16, sourceValue: 6160, sourceUnit: "µg" });
    expect(mapped.nutrients.vitaminB6).toMatchObject({ value: 0.96, sourceValue: 960, sourceUnit: "µg" });
  });

  it("keeps the source's own number and unit beside the converted value", () => {
    for (const nutrient of Object.values(mapped.nutrients)) {
      if (nutrient.value === null) continue;
      expect(nutrient.sourceUnit).toBeTruthy();
      expect(nutrient.sourceValue).not.toBeNull();
    }
  });

  it("records how the source obtained each value", () => {
    expect(mapped.nutrients.water?.origin).toBe("Literatur");
    expect(mapped.nutrients.energyKcal?.origin).toBe("Formelberechnung");
  });

  it("keeps a stated zero as zero and never as unknown", () => {
    expect(mapped.nutrients.alcohol).toMatchObject({ value: 0, qualifier: "LOGICAL_ZERO" });
  });

  it("leaves a nutrient the source does not publish absent", () => {
    // BLS 4.0 carries no selenium and no trans fat at all.
    expect(mapped.nutrients.selenium).toBeUndefined();
    expect(mapped.nutrients.transFat).toBeUndefined();
  });

  it("reports the components no canonical nutrient claims", () => {
    const unmapped: Record<string, number> = {};
    mapBlsRecord(oats, unmapped);
    // Amino acids and the fatty-acid spectrum are deliberately out of scope,
    // and being counted is how that stays a decision rather than an accident.
    expect(unmapped.LEU).toBe(1);
    expect(unmapped.ASH).toBe(1);
    expect(unmapped.ENERCC).toBeUndefined();
  });

  it("never writes a qualified value as a number", () => {
    for (const record of records) {
      const food = mapBlsRecord(record)!;
      for (const nutrient of Object.values(food.nutrients)) {
        if (nutrient.qualifier && nutrient.qualifier !== "LOGICAL_ZERO") {
          expect(nutrient.value).toBeNull();
        }
      }
    }
  });

  it("maps every fixture record to a per-100 g basis", () => {
    for (const record of records) {
      const food = mapBlsRecord(record)!;
      expect(food.basisAmount).toBe(100);
      expect(food.basisUnit).toBe("G");
      // BLS states no portion weights, so none are invented.
      expect(food.servings).toEqual([]);
    }
  });
});

describe("BLS names", () => {
  it("keeps the German name and adds the official English one", () => {
    const mapped = mapBlsRecord(oats)!;
    expect(mapped.locale).toBe("de");
    expect(mapped.translations).toEqual([{ locale: "en", name: "Oat whole grain, raw" }]);
  });

  it("splits the slash-separated synonyms the dataset packs into one name", () => {
    const mapped = mapBlsRecord(salt)!;
    expect(mapped.name).toBe("Speisesalz/Siedesalz/Tafelsalz");
    expect(mapped.aliases).toEqual(
      expect.arrayContaining([
        { locale: "de", name: "Speisesalz" },
        { locale: "de", name: "Siedesalz" },
        { locale: "de", name: "Tafelsalz" },
      ]),
    );
    // The English name is split too, so either language finds the food.
    expect(mapped.aliases.filter((alias) => alias.locale === "en").length).toBeGreaterThan(0);
  });

  it("keeps the qualifying tail on every synonym", () => {
    expect(splitNameVariants("Stielmus/Rübstiel, roh")).toEqual(["Stielmus, roh", "Rübstiel, roh"]);
    expect(splitNameVariants("Salzbrezeln/Salzstangen (Laugendauergebäck)")).toEqual([
      "Salzbrezeln (Laugendauergebäck)",
      "Salzstangen (Laugendauergebäck)",
    ]);
  });

  it("leaves a name without synonyms alone", () => {
    expect(splitNameVariants("Roggenvollkornbrot")).toEqual([]);
    expect(splitNameVariants("Roquefort mind. 50 % Fett i. Tr.")).toEqual([]);
  });
});

describe("BLS food type", () => {
  it("reads the preparation from the name", () => {
    expect(blsRawState("Hafer ganzes Korn, roh")).toBe("raw");
    expect(blsRawState("Hering heiß geräuchert")).toBe("cooked");
    expect(blsRawState("Speisesalz/Siedesalz/Tafelsalz")).toBeNull();
  });

  it("prefers the preparation over the food group", () => {
    // C is cereals, normally GENERIC, but this one says "roh".
    expect(blsFoodType("C131000", "Hafer ganzes Korn, roh")).toBe("RAW");
    expect(blsFoodType("C133000", "Hafer Flocken")).toBe("GENERIC");
  });

  it("keeps a drink a drink however it was made", () => {
    expect(blsFoodType("N500900", "Kaffee gekocht")).toBe("BEVERAGE");
    expect(blsFoodType("P353100", "Apfelwein")).toBe("BEVERAGE");
  });

  it("treats a prepared dish as cooked", () => {
    expect(blsFoodType("Y183013", "Fleischbrühe (Rind)")).toBe("COOKED");
  });

  it("falls back to GENERIC for a group letter it does not know", () => {
    expect(blsFoodType("Z999999", "Etwas Neues")).toBe("GENERIC");
  });
});

describe("the bundled BLS dataset", () => {
  it("publishes every mapped component in the unit the map expects", () => {
    // The real component reference, not a fixture: this is the check that
    // stops a future BLS release from silently rescaling stored values.
    expect(() => assertBlsComponentUnits(components)).not.toThrow();
  });

  it("fails loudly when a release changes a unit", () => {
    const tampered = components.map((component) =>
      component.code === "CU" ? { ...component, unit: "mg" } : component,
    );
    expect(() => assertBlsComponentUnits(tampered)).toThrow(/CU is published in "mg"/);
  });

  it("fails loudly when a mapped component disappears", () => {
    const without = components.filter((component) => component.code !== "VITC");
    expect(() => assertBlsComponentUnits(without)).toThrow(/VITC .* is missing/);
  });

  it("maps only to nutrients the catalogue defines", () => {
    for (const [code, mapping] of Object.entries(BLS_COMPONENT_MAP)) {
      expect(NUTRIENT_BY_KEY.get(mapping.key), `${code} -> ${mapping.key}`).toBeDefined();
    }
  });

  it("claims each canonical nutrient exactly once", () => {
    // Two components writing one key would make the result depend on iteration
    // order, which is precisely the kind of silent mapping to avoid.
    const keys = Object.values(BLS_COMPONENT_MAP).map((mapping) => mapping.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("mapping a batch", () => {
  it("maps every fixture record and reports nothing as skipped", () => {
    const result = mapBlsRecords(records);
    expect(result.foods).toHaveLength(records.length);
    expect(result.issues).toEqual([]);
  });

  it("reports a record it cannot use rather than dropping it silently", () => {
    const result = mapBlsRecords([{ code: "", nameDe: "", nameEn: "", note: null, values: {} }]);
    expect(result.foods).toEqual([]);
    expect(result.issues).toHaveLength(1);
  });
});
