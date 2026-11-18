import { describe, expect, it } from "vitest";
import { MISSION_TEMPLATES } from "@/features/game/demo/missions";
import { missionRoute } from "./mission-routes";

describe("missionRoute", () => {
  it("leads every Nexamon mission to the Nexamon page", () => {
    const nexamon = MISSION_TEMPLATES.filter((m) => m.requires === "nexamon");
    expect(nexamon.length).toBeGreaterThanOrEqual(7);
    for (const mission of nexamon) expect(missionRoute(mission.key), mission.key).toBe("/nexamon");
    expect(missionRoute("d_nexamon_pack")).toBe("/nexamon");
    expect(missionRoute("M_NEXAMON_FIRST_TEN")).toBe("/nexamon");
  });

  it("leads crypto, NFT and upgrade missions to their pages (ADR-202)", () => {
    expect(missionRoute("q_crypto_buy")).toBe("/crypto");
    expect(missionRoute("w_crypto_coins")).toBe("/crypto");
    expect(missionRoute("q_nft_mint")).toBe("/nfts");
    expect(missionRoute("q_nft_offer")).toBe("/nfts");
    expect(missionRoute("q_upgrade")).toBe("/upgrades");
    expect(missionRoute("m_upgrades_10")).toBe("/upgrades");
  });

  it("leaves all other missions without a link", () => {
    const others = MISSION_TEMPLATES.filter((m) => m.requires !== "nexamon" && !m.key.split("_").includes("nft"));
    expect(others.length).toBeGreaterThan(10);
    for (const mission of others) expect(missionRoute(mission.key), mission.key).toBeNull();
    expect(missionRoute("")).toBeNull();
    expect(missionRoute("d_trade_3")).toBeNull();
  });
});
