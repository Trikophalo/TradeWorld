import { BALANCE } from "@/config/balance";
import { companySkill, companySkillBps, effectiveLevel, levelPrice, missingSkill } from "@/lib/sim/company-skills";
import { GameError, type CompanySkillsState, type GameEngine } from "../types";

/*
 * Fertigkeiten in the offline demo (ADR-194): same rules and prices as the server. The demo founder is the only
 * holder of skills (no employees); the effects work in the server's hourly close only.
 */
export type DemoCompanySkills = Record<string, { level: number; readyAt: number }>;

export interface CompanySkillsHost {
  company(): { cashCents: number } | null;
  addCompanyCash(cents: number): void;
  learnedSkills(): ReadonlySet<string>;
  state(): DemoCompanySkills;
  setState(next: DemoCompanySkills): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
}

const cfg = BALANCE.companySkills;

export function createCompanySkillsEngine(
  host: CompanySkillsHost,
): Pick<GameEngine, "companySkills" | "learnCompanySkill"> {
  const view = (): CompanySkillsState => {
    const company = host.company();
    if (!company) throw new GameError("company_not_found");
    const now = host.now();
    const st = host.state();
    const held = host.learnedSkills();
    const working: Record<string, number> = {};
    const skills = cfg.skills.map((s) => {
      const own = st[s.key];
      const level = own?.level ?? 0;
      working[s.key] = effectiveLevel(level, own?.readyAt ?? null, now);
      const next = levelPrice(level + 1);
      return {
        key: s.key,
        branch: s.branch,
        effect: s.effect,
        level,
        maxLevel: cfg.maxLevel,
        trainingUntil: own && own.readyAt > now ? new Date(own.readyAt).toISOString() : null,
        requires: [...s.requires],
        nextRequires: next ? (s.requires[level] ?? null) : null,
        missing: next ? missingSkill(s, level + 1, held) : null,
        nextCostCents: next?.costCents ?? null,
        nextHours: next?.hours ?? null,
        effectBps: s.perLevelBps * level,
        nextEffectBps: next ? s.perLevelBps * (level + 1) : null,
      };
    });
    return {
      freeCashCents: Math.max(0, company.cashCents),
      skills,
      totalBps: companySkillBps(working),
      capBps: { ...cfg.capBps },
    };
  };

  return {
    async companySkills() {
      return view();
    },
    async learnCompanySkill(requestId, key) {
      return host.idempotent(requestId, () => {
        const company = host.company();
        if (!company) throw new GameError("company_not_found");
        const skill = companySkill(key);
        if (!skill) throw new GameError("invalid_argument");
        const st = { ...host.state() };
        const own = st[key];
        const level = own?.level ?? 0;
        const next = levelPrice(level + 1);
        if (!next) throw new GameError("invalid_argument");
        if (own && own.readyAt > host.now()) throw new GameError("locked");
        if (missingSkill(skill, level + 1, host.learnedSkills())) throw new GameError("skill_locked");
        if (company.cashCents < next.costCents) throw new GameError("insufficient_funds");
        host.addCompanyCash(-next.costCents);
        st[key] = { level: level + 1, readyAt: host.now() + next.hours * 3_600_000 };
        host.setState(st);
        return view();
      });
    },
  };
}
