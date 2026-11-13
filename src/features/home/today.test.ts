import { describe, expect, it } from "vitest";
import { dayPart, finnLineKey, todayTasks, type TodayInput } from "./today";

const base: TodayInput = {
  level: 3,
  dailyClaimable: false,
  vaultFill: 0,
  missionsClaimable: 0,
  job: { promotionReady: false, workTaskOpen: false },
  firstJobLevel: 2,
  freeSkillPoints: 0,
  newFeature: null,
  company: null,
  canFoundCompany: false,
  dealOffers: 0,
};

describe("Heute dran (ADR-102)", () => {
  it("puts the daily reward, a full vault and claimable missions first", () => {
    const tasks = todayTasks({ ...base, dailyClaimable: true, vaultFill: 1, missionsClaimable: 2, freeSkillPoints: 1 });
    expect(tasks.map((t) => t.key)).toEqual(["daily", "vault", "missions", "skills"]);
    expect(tasks[1]!.tone).toBe("urgent");
    expect(tasks[2]!.count).toBe(2);
  });

  it("shows at most four tasks", () => {
    const tasks = todayTasks({
      ...base,
      dailyClaimable: true,
      vaultFill: 0.5,
      missionsClaimable: 1,
      job: { promotionReady: true, workTaskOpen: true },
    });
    expect(tasks).toHaveLength(4);
    expect(tasks[1]).toMatchObject({ key: "vault", tone: "normal" });
  });

  it("guides a new player to a job, then to a company", () => {
    expect(todayTasks({ ...base, job: null }).map((t) => t.key)).toEqual(["findJob"]);
    expect(todayTasks({ ...base, job: null, level: 6, canFoundCompany: true }).map((t) => t.key)).toEqual([
      "findJob",
      "foundCompany",
    ]);
  });

  it("points to a new feature and to the company's bottleneck", () => {
    const tasks = todayTasks({
      ...base,
      newFeature: { key: "artworks", href: "/artworks" },
      company: { neck: "customers", eventOpen: false },
    });
    expect(tasks.map((t) => t.key)).toEqual(["newFeature", "companyCustomers"]);
    expect(tasks[0]!.href).toBe("/artworks");
  });

  it("an open company event is urgent", () => {
    expect(todayTasks({ ...base, company: { neck: "balanced", eventOpen: true } })[0]).toMatchObject({
      key: "companyEvent",
      tone: "urgent",
    });
  });

  it("with nothing to do, the markets", () => {
    expect(todayTasks(base)).toEqual([{ key: "markets", tone: "normal", href: "/markets" }]);
  });
});

describe("Finn's line", () => {
  it("talks about the most urgent task, else a line of the day part", () => {
    expect(finnLineKey([{ key: "vault", tone: "urgent", href: null }], "morning", 3, 4)).toBe("about.vault");
    expect(finnLineKey([{ key: "markets", tone: "normal", href: "/markets" }], "day", 3, 4)).toBe("about.allDone");
    expect(finnLineKey([{ key: "skills", tone: "normal", href: "/career/skills" }], "evening", 6, 4)).toBe("evening.2");
  });

  it("knows the part of the day", () => {
    expect(dayPart(7)).toBe("morning");
    expect(dayPart(12)).toBe("day");
    expect(dayPart(20)).toBe("evening");
    expect(dayPart(2)).toBe("night");
  });
});
