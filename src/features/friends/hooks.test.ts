import { describe, expect, it } from "vitest";
import { friendStatus } from "./hooks";

const list = {
  friends: [{ nickname: "Mira", level: 5, at: "" }],
  incoming: [{ nickname: "Jonas", level: 3, at: "" }],
  outgoing: [{ nickname: "Lea", level: 7, at: "" }],
};

describe("friendStatus (ADR-084)", () => {
  it("knows every relation, case-insensitive", () => {
    expect(friendStatus(list, "me", "Me")).toBe("self");
    expect(friendStatus(list, "mira", "Me")).toBe("friends");
    expect(friendStatus(list, "JONAS", "Me")).toBe("incoming");
    expect(friendStatus(list, "Lea", "Me")).toBe("outgoing");
    expect(friendStatus(list, "Tom", "Me")).toBe("none");
    expect(friendStatus(undefined, "Tom", "Me")).toBe("none");
  });
});
