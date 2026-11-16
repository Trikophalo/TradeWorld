import { describe, expect, it } from "vitest";
import { serverDetail } from "./rpc";
import { clockSkew } from "./server-clock";

describe("clock skew against the server", () => {
  it("ignores network delay and snapshot age, keeps a clock that is really off", () => {
    expect(clockSkew(0)).toBe(0);
    expect(clockSkew(12_000)).toBe(0);
    expect(clockSkew(-59_999)).toBe(0);
    // Two hours ahead: a 45 minute cooldown would look over at once without the correction.
    expect(clockSkew(2 * 3_600_000)).toBe(2 * 3_600_000);
    expect(clockSkew(-90_000)).toBe(-90_000);
  });
});

describe("serverDetail", () => {
  it("keeps what the server said for errors without a sentence of their own", () => {
    expect(serverDetail("set_company_banner", { code: "22003", message: "bigint out of range" })).toBe(
      "set_company_banner · 22003 · bigint out of range",
    );
    expect(serverDetail("get_my_company", { message: "  canceling statement\n due to statement timeout " })).toBe(
      "get_my_company · canceling statement due to statement timeout",
    );
    expect(serverDetail("x", { message: "a".repeat(500) }).length).toBeLessThan(180);
  });
});
