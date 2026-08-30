import { describe, expect, it } from "vitest";
import de from "../messages/de.json";
import en from "../messages/en.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

const deKeys = flatten(de as Tree);
const enKeys = flatten(en as Tree);

describe("message catalogues", () => {
  it("define exactly the same keys in both languages", () => {
    expect([...deKeys].sort()).toEqual([...enKeys].sort());
  });

  it("has no empty translations", () => {
    for (const [name, tree] of [["de", de], ["en", en]] as const) {
      const values = JSON.stringify(tree).match(/:"([^"]*)"/g) ?? [];
      expect(values.filter((value) => value === ':""'), `${name} has empty strings`).toHaveLength(0);
    }
  });

  it("uses the same placeholders for a key in both languages", () => {
    const placeholders = (tree: Tree, path: string): string[] => {
      const value = path.split(".").reduce<string | Tree>((node, key) => (node as Tree)[key], tree);
      return typeof value === "string" ? [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : [];
    };

    for (const key of deKeys) {
      expect(placeholders(de as Tree, key), `placeholders differ for ${key}`).toEqual(placeholders(en as Tree, key));
    }
  });
});
