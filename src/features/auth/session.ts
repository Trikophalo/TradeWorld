/**
 * Whether the in-memory player state must be dropped when the auth session changes.
 * `undefined` = no session event seen yet (the first event only reports who is
 * signed in at start), `null` = signed out.
 */
export function shouldResetPlayer(previous: string | null | undefined, next: string | null): boolean {
  return previous !== undefined && previous !== next;
}
