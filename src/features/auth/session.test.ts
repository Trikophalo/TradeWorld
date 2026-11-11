import { describe, expect, it } from "vitest";
import { useGame } from "../game/store";
import { useTutorial } from "../tutorial/store";
import { shouldResetPlayer } from "./session";

describe("account switch", () => {
  it("resets on sign-out and on a different account, not on the first event or a token refresh", () => {
    expect(shouldResetPlayer(undefined, "a")).toBe(false);
    expect(shouldResetPlayer(undefined, null)).toBe(false);
    expect(shouldResetPlayer("a", "a")).toBe(false);
    expect(shouldResetPlayer("a", null)).toBe(true);
    expect(shouldResetPlayer(null, "b")).toBe(true);
    expect(shouldResetPlayer("a", "b")).toBe(true);
  });

  it("a reset brings the tutorial back to loading, so the next account starts it right away", () => {
    useTutorial.setState({ status: "done", step: 3, accountId: "old", seenTours: ["bonds"], tour: null });
    useGame.setState({ missions: [] });
    useTutorial.getState().reset();
    useGame.getState().resetPlayer();
    expect(useTutorial.getState()).toMatchObject({ status: "loading", step: 0, seenTours: [], tour: null });
    expect(useGame.getState().portfolio).toBeNull();
    expect(useGame.getState().missions).toBeNull();
  });
});
