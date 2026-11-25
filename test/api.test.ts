import { describe, expect, it } from "vitest";
import { lookupCandidates, lookupKey, shardFor, slug } from "../src/api/index.ts";
import { planShards } from "../src/endpoints/forms.ts";

describe("lookupKey", () => {
  it("strips vowel-length marks and folds spelling variants", () => {
    expect(lookupKey("ămō")).toBe("amo");
    expect(lookupKey("Jūstitia")).toBe("iustitia");
    expect(lookupKey("præcepit")).toBe("praecepit");
    expect(lookupKey("cœlum")).toBe("coelum");
  });
});

describe("slug", () => {
  it("is filesystem-safe", () => {
    expect(slug("aqua rēgia")).toBe("aqua_regia");
    expect(slug("-que")).toBe("-que");
    expect(slug("a.d.")).toBe("a_d");
    expect(slug("☿")).toBe("_");
  });
});

describe("lookupCandidates", () => {
  it("tries the whole word, then without an enclitic", () => {
    expect(lookupCandidates("Dixitque,")).toEqual(["dixitque", "dixit"]);
    expect(lookupCandidates("que")).toEqual(["que"]);
  });
});

describe("shards", () => {
  it("every form resolves to the shard that contains it", () => {
    const keys = Array.from({ length: 20000 }, (_, i) => `con${String.fromCharCode(97 + (i % 26))}${i}`)
      .concat(["con", "co", "cx"]);
    const plan = new Map<string, { s: string; key: string }[]>();
    planShards("c", keys.map(key => ({ s: slug(key), key })), plan);
    const shards = [...plan.keys()];
    expect(shards.length).toBeGreaterThan(1);
    for (const [prefix, items] of plan) {
      expect(items.length).toBeLessThanOrEqual(4000);
      for (const it of items) expect(shardFor(it.key, shards)).toBe(prefix);
    }
  });
});

describe("dropSubsets", () => {
  it("keeps the fullest tag sets", async () => {
    const { dropSubsets } = await import("../src/endpoints/forms.ts");
    expect(dropSubsets([["genitive"], ["genitive", "singular"], ["dative", "singular"]]))
      .toEqual([["genitive", "singular"], ["dative", "singular"]]);
  });
});

describe("shortDefinition", () => {
  it("skips L&S grammar labels and keeps English glosses", async () => {
    const { shortDefinition } = await import("../src/endpoints/words.ts");
    expect(shortDefinition([{ level: 1, definition: "", glosses: ["praes.", "Perf. sync.", "(2d pers.", "to say", "tell"] }]))
      .toBe("to say, tell");
    expect(shortDefinition([{ level: 1, definition: "", glosses: ["gen.", "voc. sing."], senses: [{ level: 2, definition: "", glosses: ["the earth", "land"] }] }]))
      .toBe("the earth, land");
  });
});
