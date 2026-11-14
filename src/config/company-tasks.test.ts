import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPANY_TASK_RULES, COMPANY_TASKS } from "./company-tasks.ts";

const messages = JSON.parse(readFileSync(new URL("../../messages/de.json", import.meta.url), "utf8"));
const items = messages.companyTasks.items as Record<string, Record<string, unknown>>;
const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);

describe("company task texts (ADR-129, ADR-144)", () => {
  it("keys are unique and every game has a name and a time limit", () => {
    expect(new Set(COMPANY_TASKS.map((t) => t.key)).size).toBe(COMPANY_TASKS.length);
    for (const game of new Set(COMPANY_TASKS.map((t) => t.game))) {
      expect(messages.companyTasks.games[game], game).toBeTruthy();
      expect(COMPANY_TASK_RULES.games[game].seconds, game).toBeGreaterThan(0);
    }
  });

  it("every task has German texts that fit its game", () => {
    const g = COMPANY_TASK_RULES.games;
    for (const task of COMPANY_TASKS) {
      const m = items[task.key];
      expect(m, task.key).toBeDefined();
      for (const field of ["name", "how"]) expect(m![field], `${task.key}.${field}`).toBeTruthy();
      for (const field of ["ok", "fail"]) expect(String(m![field]), `${task.key}.${field}`).toContain("{company}");
      switch (task.game) {
        case "slider":
          expect(list(m!.labels), task.key).toHaveLength(g.slider.sliders);
          break;
        case "rotate":
          expect(list(m!.labels), task.key).toHaveLength(g.rotate.dials);
          break;
        case "match":
          expect(list(m!.boxes), task.key).toHaveLength(g.match.boxes);
          expect(list(m!.groups), task.key).toHaveLength(g.match.boxes);
          for (const group of list(m!.groups)) expect(list(group), task.key).toHaveLength(g.match.groupSize);
          // every card exists once, or the rule could not tell where it goes
          expect(new Set(list(m!.groups).flatMap(list)).size, task.key).toBe(g.match.boxes * g.match.groupSize);
          break;
        case "path":
          for (const field of ["start", "goal", "wall"]) expect(m![field], `${task.key}.${field}`).toBeTruthy();
          break;
        default:
          break;
      }
    }
  });
});
