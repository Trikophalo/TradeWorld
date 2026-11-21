import { describe, expect, it } from "vitest";
import { retryAfterSeconds } from "./rpc";

describe("retryAfterSeconds", () => {
  it("reads the wait of a rate_limited error (api_rate_limited detail)", () => {
    expect(retryAfterSeconds("retry_after=12")).toBe(12);
    expect(retryAfterSeconds("retry_after=60")).toBe(60);
  });
  it("is undefined without a usable wait", () => {
    expect(retryAfterSeconds(undefined)).toBeUndefined();
    expect(retryAfterSeconds(null)).toBeUndefined();
    expect(retryAfterSeconds("")).toBeUndefined();
    expect(retryAfterSeconds("retry_after=0")).toBeUndefined();
    expect(retryAfterSeconds("something else")).toBeUndefined();
  });
});
