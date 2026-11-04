import { describe, expect, it } from "vitest";
import { en, ja, ko, zh } from "../shared/messages";

function keys(resource: object, prefix = ""): string[] {
  return Object.entries(resource).flatMap(([key, value]) => (typeof value === "string" ? [prefix + key] : keys(value, `${prefix}${key}.`))).sort();
}

function placeholders(resource: object): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (node: object, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string") out[prefix + key] = [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]!).sort();
      else walk(value, `${prefix}${key}.`);
    }
  };
  walk(resource, "");
  return out;
}

function values(resource: object): string[] {
  return Object.values(resource).flatMap((value) => (typeof value === "string" ? [value] : values(value)));
}

const translations = [
  ["ko", ko],
  ["ja", ja],
  ["zh", zh],
] as const;

describe("UI messages", () => {
  it.each(translations)("has the same keys in English and %s", (_name, resource) => {
    expect(keys(resource)).toEqual(keys(en));
  });

  it.each(translations)("uses the same placeholders in English and %s", (_name, resource) => {
    expect(placeholders(resource)).toEqual(placeholders(en));
  });

  it.each(translations)("does not just copy the English text in %s", (_name, resource) => {
    const english = values(en);
    const translated = values(resource);
    const differing = translated.filter((value, index) => value !== english[index]).length;
    expect(differing / english.length).toBeGreaterThan(0.5);
  });

  it("keeps the English text free of Hangul", () => {
    expect(JSON.stringify(en)).not.toMatch(/[가-힣]/);
  });

  it("keeps the English text free of Japanese kana and CJK ideographs", () => {
    expect(JSON.stringify(en)).not.toMatch(/[぀-ヿ㐀-䶿一-鿿]/);
  });
});
