import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPANY_EVENTS } from "./company-events.ts";

const messages = JSON.parse(readFileSync(new URL("../../messages/de.json", import.meta.url), "utf8"));

describe("company event texts (ADR-091)", () => {
  it("every archetype, strategy and step has German texts with headlines and bodies", () => {
    for (const a of COMPANY_EVENTS.archetypes) {
      const m = messages.companyEvents.archetypes[a.key];
      expect(m, a.key).toBeDefined();
      expect(m.name).toBeTruthy();
      expect(m.headlines.length).toBeGreaterThanOrEqual(3);
      expect(m.bodies.length).toBeGreaterThanOrEqual(2);
      for (const s of a.strategies) {
        expect(m.strategies[s.key], `${a.key}.${s.key}`).toBeTruthy();
        expect(m.strategyText[s.key], `${a.key}.${s.key}`).toBeTruthy();
        for (const step of s.steps) expect(m.steps[step.key], `${a.key}.${step.key}`).toBeTruthy();
      }
    }
  });

  it("templates only use known placeholders", () => {
    const known = new Set(["company", "product", "input", "tax", "rule", "risk", "trend", "buyer", "critic", "place"]);
    for (const a of COMPANY_EVENTS.archetypes) {
      const m = messages.companyEvents.archetypes[a.key];
      for (const text of [...m.headlines, ...m.bodies, ...Object.values(m.strategyText)] as string[]) {
        for (const [, key] of text.matchAll(/\{(\w+)\}/g)) expect(known.has(key!), `${a.key}: ${key}`).toBe(true);
      }
    }
  });
});
