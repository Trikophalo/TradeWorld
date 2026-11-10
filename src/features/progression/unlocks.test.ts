import { describe, expect, it } from "vitest";
import messages from "../../../messages/de.json";
import { BALANCE } from "@/config/balance";

describe("level unlocks", () => {
  it("every unlock in the balance config has a German label", () => {
    const missing = BALANCE.progression.unlocks.map((u) => u.key).filter((key) => !(key in messages.unlocks));
    expect(missing).toEqual([]);
  });

  it("no label is left over without an unlock", () => {
    const keys = new Set<string>(BALANCE.progression.unlocks.map((u) => u.key));
    expect(Object.keys(messages.unlocks).filter((key) => !keys.has(key))).toEqual([]);
  });
});
