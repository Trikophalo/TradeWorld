import type { TickKind } from "@/config/battles";
import type { BattleParams, BattleSync } from "@/features/game/battle-types";
import {
  battleMaxTicks,
  cloneBattle,
  initBattle,
  stepBattle,
  type AnyBattleState,
  type SimParams,
} from "@/lib/sim/battle";

/*
 * The client side of the deterministic lockstep (ADR-160). The server holds every player's inputs; a tick is final
 * graceMs after it. The client keeps the state at the last final tick ("confirmed") and, every frame, simulates from
 * there to now with the best inputs it knows: the server's, then what the others broadcast (Realtime), then their
 * last input repeated; its own inputs it knows anyway. A wrong guess fixes itself as soon as the server's inputs
 * arrive. The winner is decided by the server alone.
 */

/** Ticks predicted at most per frame (a tab that slept does not freeze the page). */
const MAX_PREDICT = 240;

export interface LockstepView {
  state: AnyBattleState;
  /** The tick the state is at (the next one to simulate). */
  tick: number;
  /** 0..1 into the current tick, for smooth drawing. */
  alpha: number;
}

export class Lockstep {
  readonly kind: TickKind;
  readonly seed: number;
  readonly n: number;
  readonly mySlot: number | null;
  readonly params: BattleParams;
  private readonly sim: SimParams<never>;
  private readonly startedAt: number;
  private confirmed: AnyBattleState;
  private readonly server: string[];
  private readonly peers: string[];
  /** My inputs, one character per tick. */
  private local = "";
  private pendingTaps = 0;
  private held = "0";
  finalTick = 0;
  /** Server clock minus local clock in ms. */
  offsetMs = 0;
  private bestRtt = Number.POSITIVE_INFINITY;
  /** The since of the last request: streams come back from there. */
  readonly maxTicks: number;

  constructor(opts: {
    kind: TickKind;
    seed: number;
    n: number;
    mySlot: number | null;
    params: BattleParams;
    startedAtMs: number;
    offsetMs?: number;
  }) {
    this.kind = opts.kind;
    this.seed = opts.seed;
    this.n = opts.n;
    this.mySlot = opts.mySlot;
    this.params = opts.params;
    this.sim = opts.params as unknown as SimParams<never>;
    this.startedAt = opts.startedAtMs;
    this.offsetMs = opts.offsetMs ?? 0;
    this.confirmed = initBattle(opts.kind, opts.seed, opts.n, this.sim);
    this.server = Array.from({ length: opts.n }, () => "");
    this.peers = Array.from({ length: opts.n }, () => "");
    this.maxTicks = battleMaxTicks(opts.kind, this.sim);
  }

  /** The tick the server clock is in at local time `now` (negative before the start). */
  tickAt(now: number): number {
    return Math.floor((now + this.offsetMs - this.startedAt) / this.params.tickMs);
  }

  msToStart(now: number): number {
    return this.startedAt - (now + this.offsetMs);
  }

  /** What the player holds right now: direction 0..4, action. */
  setHeld(dir: number, action: boolean): void {
    this.held = String(dir + (action ? 5 : 0));
  }

  tap(): void {
    this.pendingTaps = Math.min(3, this.pendingTaps + 1);
  }

  /** Writes the player's input for every tick up to now (each tick gets what was held when it came). */
  record(now: number): void {
    if (this.mySlot === null) return;
    const until = Math.min(this.tickAt(now), this.maxTicks - 1);
    while (this.local.length <= until) {
      if (this.kind === "pump") {
        this.local += this.pendingTaps > 0 ? "1" : "0";
        if (this.pendingTaps > 0) this.pendingTaps -= 1;
      } else if (this.kind === "laser" && this.pendingTaps > 0) {
        // a jump: a tap shorter than a tick still gets one tick with the action
        this.local += String((Number(this.held) % 5) + 5);
        this.pendingTaps -= 1;
      } else this.local += this.held;
    }
  }

  /** The inputs the server does not have yet: from its stream's end. */
  chunk(): { from: number; data: string } {
    if (this.mySlot === null) return { from: 0, data: "" };
    const from = this.server[this.mySlot]!.length;
    return { from, data: this.local.slice(from, from + 300) };
  }

  /** The inputs of mine to broadcast to the others (the last few ticks, so a lost message does not matter). */
  recent(count = 12): { from: number; data: string } {
    const from = Math.max(0, this.local.length - count);
    return { from, data: this.local.slice(from) };
  }

  get since(): number {
    return this.confirmed.tick;
  }

  /** Merges an answer of battle_sync (asked with since = this.since at sentAt). */
  applySync(r: BattleSync, since: number, sentAt: number, receivedAt: number): void {
    const rtt = receivedAt - sentAt;
    const estimate = Date.parse(r.now) - (sentAt + rtt / 2);
    if (rtt <= this.bestRtt * 1.5 || !Number.isFinite(this.bestRtt)) {
      this.offsetMs = Number.isFinite(this.bestRtt) ? this.offsetMs * 0.7 + estimate * 0.3 : estimate;
      this.bestRtt = Math.min(this.bestRtt, rtt);
    }
    for (const s of r.streams) {
      if (s.slot < 0 || s.slot >= this.n) continue;
      // ticks before `since` are final: what the server did not have there counts as nothing
      this.server[s.slot] = this.server[s.slot]!.padEnd(since, "x").slice(0, since) + s.data;
    }
    this.finalTick = Math.max(this.finalTick, Math.min(r.finalTick, this.maxTicks));
    while (!this.confirmed.done && this.confirmed.tick < this.finalTick) {
      const t = this.confirmed.tick;
      let inputs = "";
      for (let j = 0; j < this.n; j++) inputs += this.server[j]![t] ?? "x";
      stepBattle(this.kind, this.confirmed, inputs, this.sim);
    }
  }

  /** Inputs another player broadcast (Realtime): only a guess until the server confirms them. */
  applyPeer(slot: number, from: number, data: string): void {
    if (slot < 0 || slot >= this.n || slot === this.mySlot) return;
    const known = this.peers[slot]!;
    if (from > known.length) this.peers[slot] = known.padEnd(from, known.at(-1) ?? "0") + data;
    else if (from + data.length > known.length) this.peers[slot] = known.slice(0, from) + data;
  }

  private guess(slot: number, t: number): string {
    if (t < this.finalTick) return this.server[slot]![t] ?? "x";
    if (slot === this.mySlot) return this.local[t] ?? this.local.at(-1) ?? "0";
    const s = this.server[slot]![t] ?? this.peers[slot]![t];
    if (s !== undefined) return s;
    const last =
      this.peers[slot]!.length > this.server[slot]!.length ? this.peers[slot]!.at(-1) : this.server[slot]!.at(-1);
    return last === undefined || last === "q" ? "x" : this.kind === "pump" ? "0" : last;
  }

  /** The predicted state at local time `now`. */
  view(now: number): LockstepView {
    const exact = (now + this.offsetMs - this.startedAt) / this.params.tickMs;
    const target = Math.min(Math.floor(exact), this.maxTicks - 1);
    const state = cloneBattle(this.kind, this.confirmed);
    let steps = 0;
    while (!state.done && state.tick <= target && steps < MAX_PREDICT) {
      const t = state.tick;
      let inputs = "";
      for (let j = 0; j < this.n; j++) inputs += this.guess(j, t);
      stepBattle(this.kind, state, inputs, this.sim);
      steps++;
    }
    return { state, tick: state.tick, alpha: state.done ? 1 : Math.max(0, Math.min(1, exact - Math.floor(exact))) };
  }

  /** The game is over by the server's inputs: the end tick to claim, or null. */
  endClaim(): number | null {
    return this.confirmed.done ? this.confirmed.endTick : null;
  }

  get confirmedState(): AnyBattleState {
    return this.confirmed;
  }
}
