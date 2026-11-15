/*
 * The timeline of the opener of NEXA Nachrichten: a montage about Mr. Doodle Dangle, cut on the beat of the jingle.
 * The shots are laid out in beats, as shares of the length of the intro, so any length works and every viewer who
 * knows `elapsedMs` sees the same frame. Pure: no clock.
 */

/** The shots in order, with their length in beats of the jingle (seven bars of four). */
export const INTRO_SHOTS = [
  /** A close-up of the moustache being combed. */
  { id: "comb", beats: 4 },
  /** He points at the camera. */
  { id: "point", beats: 4 },
  /** He slams his coffee mug on the desk. */
  { id: "mug", beats: 4 },
  /** Money and newspapers fly around him. */
  { id: "money", beats: 4 },
  /** A hero pose in front of the skyline. */
  { id: "hero", beats: 4 },
  /** The title card: "NEXA Nachrichten mit Mr. Doodle Dangle". */
  { id: "title", beats: 8 },
] as const;

export type IntroShotId = (typeof INTRO_SHOTS)[number]["id"];

export const INTRO_BEATS = INTRO_SHOTS.reduce((sum, shot) => sum + shot.beats, 0);

export interface IntroFrame {
  id: IntroShotId;
  /** 0-based position of the shot in the montage. */
  index: number;
  /** Beats since the shot started (fractional); the full length of the last shot once the intro is over. */
  beat: number;
  /** Length of the shot in beats. */
  beats: number;
  /** ms since the shot started; Infinity once the intro is over. */
  sinceMs: number;
  /** Length of one beat in ms. */
  beatMs: number;
}

/** Which shot of the montage is on screen `elapsedMs` into an intro that is `introMs` long. */
export function introShot(elapsedMs: number, introMs: number): IntroFrame {
  const beatMs = Math.max(1, introMs) / INTRO_BEATS;
  const at = Math.max(0, elapsedMs) / beatMs;
  let start = 0;
  for (const [index, shot] of INTRO_SHOTS.entries()) {
    if (at < start + shot.beats) {
      return { id: shot.id, index, beat: at - start, beats: shot.beats, sinceMs: (at - start) * beatMs, beatMs };
    }
    start += shot.beats;
  }
  const last = INTRO_SHOTS[INTRO_SHOTS.length - 1]!;
  return {
    id: last.id,
    index: INTRO_SHOTS.length - 1,
    beat: last.beats,
    beats: last.beats,
    sinceMs: Number.POSITIVE_INFINITY,
    beatMs,
  };
}
