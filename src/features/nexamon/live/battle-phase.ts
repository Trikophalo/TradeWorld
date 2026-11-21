import { BALANCE } from "@/config/balance";
import type { NexamonBattle } from "@/features/game/pack-battle-types";
import { multiShownCards, multiTwistAt, multiTwistsShown } from "@/lib/sim/nexamon-battle";

const cfg = BALANCE.nexamon;

export type BattlePhase = "waiting" | "countdown" | "tearing" | "revealing" | "twisting" | "decided";

export interface BattlePhaseState {
  phase: BattlePhase;
  /** Cards of the lineup that show on every seat. */
  shown: number;
  /** Seconds left in the countdown. */
  countdown: number;
  /** The pack of the lineup on screen (1 = the first). */
  pack: number;
  /** Twists that apply to the scores (the clock reached them and the server sent them). */
  twists: number;
}

/**
 * Where the shared clock stands (ADR-172/192): before the start, a pack tearing, revealing card n of the lineup,
 * (ADR-205, Twist) the twist after a pack, decided. The last card of a pack stays on screen for its whole slot: the
 * next pack (or the twist) only comes when that slot is over (multiTwistAt, without twist the same instant).
 */
export function battlePhase(
  b: Pick<NexamonBattle, "packs" | "seats" | "startsAt" | "decideAt" | "winnerSeat" | "twist" | "twists" | "twistMs">,
  now: number | null,
): BattlePhaseState {
  const total = b.packs.length * cfg.packSize;
  const at = (phase: BattlePhase, shown: number, pack: number, twists = 0, countdown = 0): BattlePhaseState => ({
    phase,
    shown,
    countdown,
    pack,
    twists,
  });
  if (!b.startsAt || now === null) return at("waiting", 0, 1);
  const startsAt = Date.parse(b.startsAt);
  if (now < startsAt) return at("countdown", 0, 1, 0, Math.ceil((startsAt - now) / 1000));
  const known = Math.min(...b.seats.map((s) => s.cards.length));
  const twistMs = b.twist ? b.twistMs : 0;
  const shown = Math.min(multiShownCards(startsAt, now, b.packs.length, cfg, twistMs), known);
  const clockTwists = b.twist ? multiTwistsShown(startsAt, now, b.packs.length, cfg, twistMs) : 0;
  const twists = Math.min(clockTwists, b.twists.length);
  const decided = b.winnerSeat !== null && b.decideAt !== null && now >= Date.parse(b.decideAt) && shown >= total;
  if (decided) return at("decided", shown, b.packs.length, twists);
  // ADR-205: the twist after a pack plays for twistMs before the next pack tears
  if (clockTwists > 0 && now < multiTwistAt(startsAt, clockTwists, cfg, twistMs) + twistMs)
    return at("twisting", shown, clockTwists, twists);
  const done = shown / cfg.packSize;
  // before the first card, and between two packs once the slot of the last card is over, the next pack tears
  if (shown === 0 || (shown % cfg.packSize === 0 && shown < total && now >= multiTwistAt(startsAt, done, cfg, twistMs)))
    return at("tearing", shown, done + 1, twists);
  return at("revealing", shown, Math.floor((shown - 1) / cfg.packSize) + 1, twists);
}
