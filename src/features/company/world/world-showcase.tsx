"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { countryFlag, hqArt } from "@/components/pixel/hq";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { HourCostsSheet, type CostKind } from "../components/hour-costs";
import { Card } from "@/components/ui/card";
import { COUNTRIES, WORLD_RULES } from "@/config/countries";
import { aiCountry } from "@/features/game/demo/world";
import { DEFAULT_HQ_STYLE, type WorldPlace, type WorldState } from "@/features/game/world-types";
import { DEMO_COMPANIES } from "@/lib/demo/market";
import { worldHourEffect } from "@/lib/sim/world";
import { HqPreview } from "./hq-editor";
import { LocationTab } from "./location-tab";

const ai: WorldPlace[] = DEMO_COMPANIES.slice(0, 8).map((c) => ({
  companyId: `demo-company-${c.ticker}`,
  name: c.name,
  owner: null,
  country: aiCountry(c.ticker),
  kind: "ai",
  hqTier: 0,
  hqStyle: DEFAULT_HQ_STYLE,
  worthCents: c.marketCapCents,
  sector: c.sector,
  brandColor: c.color,
  mine: false,
  leader: false,
}));

const player = (name: string, owner: string, country: string, tier: number, wall: number): WorldPlace => ({
  companyId: `sample-${name}`,
  name,
  owner,
  country,
  kind: "hq",
  hqTier: tier,
  hqStyle: { ...DEFAULT_HQ_STYLE, wall, roofKind: tier > 3 ? "antenna" : "gable", deco: "trees" },
  worthCents: 1_500_000_000 * tier,
  sector: "tech",
  brandColor: null,
  mine: false,
  leader: false,
});

/** A placed company with a campus in Germany, one subsidiary in Vietnam and three other players. */
export const SAMPLE_WORLD: WorldState = {
  company: {
    id: "sample-own",
    name: "Pixel Werke",
    worthCents: 6_000_000_000,
    freeCashCents: 900_000_000,
    listed: false,
  },
  unlockWorthCents: WORLD_RULES.unlockWorthCents,
  me: {
    country: "de",
    hqTier: 3,
    hqStyle: { wall: 1, roof: 2, sign: 0, roofKind: "dome", deco: "fountain", flag: true },
    investedCents: 2_000_000_000,
    placedAt: "2026-11-01T10:00:00Z",
    movedAt: null,
    relocateReadyAt: "2026-11-08T10:00:00Z",
    relocationCostCents: 400_000_000,
    nextTierCostCents: WORLD_RULES.hqTiers[3]!.costCents,
    subsidiaries: [
      {
        country: "vn",
        openedAt: "2026-11-10T10:00:00Z",
        setupCostCents: 300_000_000,
        ramp: 0.6,
        hourlyCostCents: 108_000,
      },
    ],
    nextSubsidiaryCostCents: 480_000_000,
    subsidiaryUnlocked: true,
    image: { de: { bonusBps: 500, readyAt: null, spentCents: 30_000_000 } },
    imageCampaignCostCents: 30_000_000,
    effect: worldHourEffect({ country: "de", imageBonusBps: 500, tier: 3, leader: true }, [
      { country: "vn", imageBonusBps: 0, hoursOpen: 200 },
    ]),
    leader: true,
    feeBps: 150,
    feeReadyAt: null,
    payingFee: null,
    feesPaidCents: 0,
    feesReceivedCents: 12_345_600,
  },
  places: [
    {
      ...player("Pixel Werke", "Du", "de", 3, 1),
      companyId: "sample-own",
      mine: true,
      leader: true,
      hqStyle: { wall: 1, roof: 2, sign: 0, roofKind: "dome", deco: "fountain", flag: true },
    },
    { ...player("Pixel Werke", "Du", "vn", 0, 1), companyId: "sample-own", kind: "subsidiary", mine: true },
    player("Bruno Bau", "Bruno", "de", 1, 2),
    player("Clara Chips", "Clara", "cn", 4, 6),
    player("Dora Digital", "Dora", "us", 2, 4),
    ...ai,
  ],
  countries: COUNTRIES.map((c) => ({
    key: c.key,
    leaderId: c.key === "de" ? "sample-own" : null,
    feeBps: c.key === "de" ? 150 : 0,
  })),
};

/** Showcase (/dev/ui): every HQ tier, the tab locked and placed. */
export function WorldShowcase() {
  const tt = useTranslations("world.tiers");
  const de = COUNTRIES.find((c) => c.key === "de");
  const [costs, setCosts] = useState<CostKind | null>(null);
  return (
    <div className="space-y-4" data-testid="world-showcase">
      <Card padding="lg" className="space-y-3">
        <p className="label-pixel text-fg-3">Zentralen (ADR-208)</p>
        <div className="flex flex-wrap items-end gap-4">
          {WORLD_RULES.hqTiers.map((tier) => (
            <figure key={tier.key} className="flex flex-col items-center gap-1">
              <HqPreview
                tier={tier.tier}
                style={{
                  ...DEFAULT_HQ_STYLE,
                  wall: tier.tier,
                  roof: tier.tier,
                  roofKind: tier.tier === 4 ? "antenna" : "flat",
                }}
                name="Pixel Werke"
                country={de}
                scale={3}
              />
              <figcaption className="text-2xs text-fg-3">{tt(tier.key)}</figcaption>
            </figure>
          ))}
        </div>
      </Card>
      <Card padding="lg" className="space-y-3">
        <p className="label-pixel text-fg-3">Flaggen (ADR-208)</p>
        <ul className="flex flex-wrap gap-3">
          {COUNTRIES.map((c) => (
            <li key={c.key} className="flex items-center gap-2 text-xs text-fg-2">
              <PixelIcon {...countryFlag(c)} scale={2} className="ring-1 ring-line-2" />
              <PixelIcon {...hqArt({ tier: 1, flag: c.flag, country: c.key })} scale={1} />
              {c.name}
            </li>
          ))}
        </ul>
      </Card>
      <Card padding="lg" className="space-y-3">
        <p className="label-pixel text-fg-3">Kosten je Stunde (Dashboard)</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setCosts("fixed")}>
            Fixkosten
          </Button>
          <Button variant="secondary" onClick={() => setCosts("variable")}>
            Variable Kosten
          </Button>
        </div>
        <HourCostsSheet kind={costs} onClose={() => setCosts(null)} />
      </Card>
      <LocationTab preview={SAMPLE_WORLD} />
      <LocationTab
        preview={{ ...SAMPLE_WORLD, me: null, company: { ...SAMPLE_WORLD.company!, worthCents: 420_000_000 } }}
      />
    </div>
  );
}
