import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { nexamonReleaseAt, nexamonSetReleased } from "@/lib/sim/nexamon";
import { announcementSegments } from "./news-show";

describe("new set release and announcement (ADR-182)", () => {
  it("keeps Titans Revenge and Yin Yang locked until 17:30 Berlin, the other sets open", () => {
    const at = Date.parse("2026-11-17T16:30:00Z");
    expect(nexamonReleaseAt("titans_revenge")).toBe(at);
    expect(nexamonSetReleased("yin_yang", at - 1)).toBe(false);
    expect(nexamonSetReleased("yin_yang", at)).toBe(true);
    expect(nexamonSetReleased("mystic_energy", 0)).toBe(true);
  });

  it("announces both sets in exactly the 17:00 show", () => {
    const slot = Date.parse(BALANCE.newsShow.announcements[0]!.at);
    const segs = announcementSegments(slot);
    expect(segs.map((s) => s.nexamon?.set)).toEqual(["titans_revenge", "yin_yang"]);
    expect(segs[0]!.text).toContain("17:30");
    expect(announcementSegments(slot + 3_600_000)).toEqual([]);
    expect(announcementSegments(slot - 3_600_000)).toEqual([]);
  });
});
