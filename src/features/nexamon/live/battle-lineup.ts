/*
 * The lineup of a new Pack Battle in the create sheet (ADR-192 Nachtrag): per set a count (0..maxPerSet), the packs
 * of one set stand together as a group, the groups keep the order the player gives them. The server gets the flat
 * list of sets in that order.
 */

export interface LineupGroup<S extends string> {
  set: S;
  count: number;
}

/** The flat lineup as groups of consecutive packs of the same set. */
export function lineupGroups<S extends string>(lineup: readonly S[]): LineupGroup<S>[] {
  const out: LineupGroup<S>[] = [];
  for (const set of lineup) {
    const last = out[out.length - 1];
    if (last && last.set === set) last.count++;
    else out.push({ set, count: 1 });
  }
  return out;
}

const flatten = <S extends string>(groups: readonly LineupGroup<S>[]): S[] =>
  groups.flatMap((g) => Array.from({ length: g.count }, () => g.set));

/** How many packs of `set` the lineup holds. */
export const lineupCount = <S extends string>(lineup: readonly S[], set: S): number =>
  lineup.reduce((n, s) => (s === set ? n + 1 : n), 0);

/**
 * The lineup with `count` packs of `set` (clamped to 0..maxPerSet and to what fits under maxTotal): the set keeps its
 * place (its first group, the others of it merge into it), a new set goes to the end, 0 takes it out.
 */
export function setLineupCount<S extends string>(
  lineup: readonly S[],
  set: S,
  count: number,
  maxPerSet: number,
  maxTotal: number,
): S[] {
  const others = lineup.length - lineupCount(lineup, set);
  const n = Math.max(0, Math.min(Math.trunc(count), maxPerSet, maxTotal - others));
  const groups: LineupGroup<S>[] = [];
  let placed = false;
  for (const g of lineupGroups(lineup)) {
    if (g.set !== set) groups.push({ ...g });
    else if (!placed) {
      placed = true;
      if (n > 0) groups.push({ set, count: n });
    }
  }
  if (!placed && n > 0) groups.push({ set, count: n });
  return flatten(lineupGroups(flatten(groups)));
}

/** The lineup with group `from` moved to position `to` (indices over lineupGroups); out of range: unchanged. */
export function moveLineupGroup<S extends string>(lineup: readonly S[], from: number, to: number): S[] {
  const groups = lineupGroups(lineup);
  if (from < 0 || from >= groups.length || to < 0 || to >= groups.length || from === to) return [...lineup];
  const [g] = groups.splice(from, 1);
  groups.splice(to, 0, g!);
  return flatten(groups);
}

/** The lineup without group `index`. */
export function removeLineupGroup<S extends string>(lineup: readonly S[], index: number): S[] {
  return flatten(lineupGroups(lineup).filter((_, i) => i !== index));
}
