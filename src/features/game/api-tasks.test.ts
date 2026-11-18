import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TASK_GAMES } from "@/config/company-tasks";
import { TASK_RPC_SCHEMAS, isKnownTaskGame, toTasks } from "./api-tasks";

/*
 * ADR-211: the task board must survive what the server sends next. A task of a game this client does not know yet
 * (server updated first) and a clone in the team used to fail the whole get_company_tasks answer or offer the clone
 * as a delegate target.
 */
const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/get_company_tasks.json", import.meta.url)), "utf8"),
) as Record<string, unknown> & { tasks: Record<string, unknown>[]; people: Record<string, unknown>[] };

describe("company task board answer", () => {
  it("knows every game of the catalogue", () => {
    expect(TASK_GAMES.every(isKnownTaskGame)).toBe(true);
    expect(isKnownTaskGame("future_game")).toBe(false);
  });

  it("leaves out a task of an unknown game instead of failing the whole board", () => {
    const first = fixture.tasks[0]!;
    const raw = { ...fixture, tasks: [...fixture.tasks, { ...first, id: 999_999, game: "future_game" }] };
    const parsed = TASK_RPC_SCHEMAS.get_company_tasks.safeParse(raw);
    expect(parsed.success).toBe(true);
    const board = toTasks(parsed.data!);
    expect(board.tasks).toHaveLength(fixture.tasks.length);
    expect(board.tasks.some((t) => t.id === 999_999)).toBe(false);
  });

  it("leaves clones out of the people a task can go to, older answers without is_clone still parse", () => {
    const person = fixture.people[0]!;
    const raw = {
      ...fixture,
      people: [
        ...fixture.people.map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== "is_clone"))),
        { ...person, nickname: "Klon_Kim", is_me: false, is_clone: true },
      ],
    };
    const parsed = TASK_RPC_SCHEMAS.get_company_tasks.safeParse(raw);
    expect(parsed.success).toBe(true);
    const board = toTasks(parsed.data!);
    expect(board.people.map((p) => p.nickname)).not.toContain("Klon_Kim");
    expect(board.people).toHaveLength(fixture.people.length);
  });
});
