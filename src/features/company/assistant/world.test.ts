import { describe, expect, it } from "vitest";
import { countryInText, isWorldQuestion, worldTurnLines } from "./world";

describe("Mira and the world map (ADR-208)", () => {
  it("finds a country by name or alias", () => {
    expect(countryInText("Wie ist China?")?.key).toBe("cn");
    expect(countryInText("lohnt sich die Türkei")?.key).toBe("tr");
    expect(countryInText("Was ist mit den USA")?.key).toBe("us");
    expect(countryInText("Wie mache ich mehr Umsatz?")).toBeNull();
  });

  it("knows world questions without mixing them up with others", () => {
    expect(isWorldQuestion("Wo soll meine Zentrale hin?")).toBe(true);
    expect(isWorldQuestion("Was bringt eine Tochterfirma?")).toBe(true);
    expect(isWorldQuestion("Gib das Packen an Anna")).toBe(false);
  });

  it("names traits, strength and weakness of a country", () => {
    const lines = worldTurnLines(countryInText("Deutschland"));
    expect(lines.map((l) => l.key)).toEqual(["world.country", "world.strength", "world.risks"]);
    expect(lines[0]!.values?.name).toBe("Deutschland");
    expect(worldTurnLines(null)[0]!.key).toBe("world.about");
  });
});
