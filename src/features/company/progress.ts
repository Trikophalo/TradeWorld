/*
 * One way up (ADR-191): the growth stages of the product (ADR-062) and the endless expansion levels (ADR-083) as one
 * continuous path. Pure: the server keeps both values; this only counts them as one step number.
 */

export interface ProgressInput {
  stages: readonly { reached: boolean }[];
  expansionLevel: number;
}

export interface Progress {
  /** Growth stages reached (0 … stages.length). */
  stagesDone: number;
  /** Position on the whole path: stages reached plus expansion levels bought. */
  step: number;
  /** The next thing on the path. */
  next: { kind: "stage"; n: number } | { kind: "level"; n: number };
}

export function companyProgress(company: ProgressInput): Progress {
  const stagesDone = company.stages.filter((s) => s.reached).length;
  const level = Math.max(0, Math.floor(company.expansionLevel));
  const next =
    stagesDone < company.stages.length
      ? ({ kind: "stage", n: stagesDone + 1 } as const)
      : ({ kind: "level", n: level + 1 } as const);
  return { stagesDone, step: stagesDone + level, next };
}
