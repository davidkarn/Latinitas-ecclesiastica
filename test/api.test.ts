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

describe("shortDefinition filters", () => {
  const def = async (glosses: string[]) =>
    (await import("../src/endpoints/words.ts")).shortDefinition([{ level: 1, definition: "", glosses }]);
  it("drops Latin construction words and grammar labels", async () => {
    expect(await def(["cum", "pron"])).toBeUndefined();
    expect(await def(["to commit to one's charge", "order", "alicui aliquid", "ut", "ne"])).toBe("to commit to one's charge, order");
    expect(await def(["Act., to move", "stir"])).toBe("to move, stir");
    expect(await def(["praep", "on the right of"])).toBe("on the right of");
    expect(await def(["to remember", "de", "rel.-clause"])).toBe("to remember");
    expect(await def(["fin."])).toBeUndefined();
    expect(await def(["impers", "it is lawful", "of the demonstr"])).toBe("it is lawful");
    expect(await def(["to threaten", "alicui aliquā re"])).toBe("to threaten");
    expect(await def(["to arm", "contra", "adversus", "fin.—Impers"])).toBe("to arm");
    expect(await def(["easily appeased, placable", "placable", "mild"])).toBe("easily appeased, placable, mild");
  });
  it("falls back to plain sense text, not grammar notes", async () => {
    const { shortDefinition } = await import("../src/endpoints/words.ts");
    expect(shortDefinition([{ level: 1, definition: "to have an ill smell, to stink" }])).toBe("to have an ill smell, to stink");
    expect(shortDefinition([{ level: 1, definition: "v. the foll. art." }])).toBeUndefined();
    expect(shortDefinition([{ level: 1, definition: "fin." }])).toBeUndefined();
  });
  it("rejoins L&S's split \"of or belonging to\"", async () => {
    expect(await def(["of", "belonging to the people"])).toBe("of or belonging to the people");
  });
});

describe("grammar quotations", () => {
  it("matches the Oxford Vulgate's spelling to the Clementine text", async () => {
    const { findQuote, norm } = await import("../src/endpoints/grammar.ts");
    expect(norm("uespere")).toBe(norm("vespere"));
    expect(norm("inluminent")).toBe(norm("illuminent"));
    const verse = "Et vidit Deus lucem quod esset bona et divisit lucem a tenebris".split(" ").map(norm);
    expect(findQuote("uidit Deus lucem quod esset bona", verse)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(findQuote("uidit . . . bona", verse)).toEqual([1, 6]);
    expect(findQuote("os ad os", "ore enim ad os loquor ei".split(" ").map(norm))).toEqual([2, 3]);
    expect(findQuote("Nullus, nullum", "quam suscitare nullus audebit".split(" ").map(norm))).toEqual([2]);
    expect(findQuote("ad imaginem nostram", verse)).toEqual([]);
  });
});
