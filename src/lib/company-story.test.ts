import { describe, expect, it } from "vitest";
import { companyProfile, fillTemplate, matchFamily, productWord, seedOf, storyValues, tell } from "./company-story";

describe("Mini-KI: understanding what a company makes (ADR-091)", () => {
  it("recognises toilet paper and finds fitting words", () => {
    const p = companyProfile({
      name: "Ultra Tech",
      idea: "Wir stellen das weichste Toilettenpapier her",
      sector: "retail",
    });
    expect(p.family).toBe("hygiene_paper");
    expect(p.words.product[0]).toBe("Toilettenpapier");
    expect(p.words.input).toContain("Zellstoff");
  });

  it("keeps compound products and pairs taxes with their raw material", () => {
    expect(productWord("Energy Drinks mit extra Taurin für Gamer.", "Blitzdose")).toBe("Energy Drinks");
    expect(productWord("Unsere Gartenzwerge aus alten Flaschen", "Zwergenwerk")).toBe("Gartenzwerge");
    const p = companyProfile({ name: "Blitz", idea: "Energy Drink", sector: "retail" });
    for (let seed = 0; seed < 30; seed++) {
      const v = storyValues(p, "Blitz", seed);
      if (v.tax === "Taurin-Steuer") expect(v.input).toBe("Taurin");
      if (v.tax === "Zuckerabgabe") expect(v.input).toBe("Zucker");
    }
  });

  it("an energy drink company gets the taurine tax", () => {
    const p = companyProfile({ name: "Blitz Energy", idea: "Energy Drink mit extra Koffein", sector: "retail" });
    expect(p.family).toBe("energy_drink");
    expect(p.words.tax).toContain("Taurin-Steuer");
  });

  it("unknown products keep the player's own word, with sector words around it", () => {
    const p = companyProfile({
      name: "Zwergenwerk",
      idea: "Wir bauen Gartenzwerge aus alten Flaschen",
      sector: "retail",
    });
    expect(p.family).toBeNull();
    expect(p.words.product[0]).toBe("Gartenzwerge");
    expect(p.words.tax.length).toBeGreaterThan(0);
  });

  it("filler words and the company name are no product", () => {
    expect(productWord("Die beste Firma der Welt", "Beste")).toBeNull();
    expect(matchFamily("Cloud Solution für Toiletten")?.key).toMatch(/cloud|hygiene_paper/);
  });

  it("an AI profile replaces the lexicon words", () => {
    const p = companyProfile({
      name: "Blitz",
      idea: "Energy Drink",
      sector: "retail",
      aiWords: { tax: ["Guarana-Zoll"], product: ["Blitz-Dosen"] },
    });
    expect(p.words.tax).toEqual(["Guarana-Zoll"]);
    expect(p.words.product).toEqual(["Blitz-Dosen"]);
  });

  it("the same seed tells the same story; templates are filled", () => {
    const p = companyProfile({ name: "Blitz", idea: "Energy Drink", sector: "retail" });
    const seed = seedOf("event-1");
    expect(storyValues(p, "Blitz", seed)).toEqual(storyValues(p, "Blitz", seed));
    expect(tell(["Neue {tax}: {company} unter Druck"], p, "Blitz", seed)).toMatch(/^Neue .+: Blitz unter Druck$/);
    expect(fillTemplate("{company} und {unknown}", { company: "X" })).toBe("X und unknown");
  });
});
