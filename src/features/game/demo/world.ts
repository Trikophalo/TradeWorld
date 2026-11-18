import { COUNTRIES, WORLD_RULES } from "@/config/countries";
import { DEMO_COMPANIES } from "@/lib/demo/market";
import {
  hqTier,
  imageBonusAfter,
  imageBonusWithCampaign,
  imageCampaignCostCents,
  relocationCostCents,
  subsidiaryHourlyCostCents,
  subsidiaryRamp,
  subsidiarySetupCostCents,
  subsidiaryUnlocked,
  worldHourEffect,
} from "@/lib/sim/world";
import { GameError } from "../types";
import { toHqStyle } from "../api-world";
import { DEFAULT_HQ_STYLE, type HqStyle, type WorldEngine, type WorldPlace, type WorldState } from "../world-types";

/*
 * Weltkarte in the offline demo (ADR-208): same rules and prices as the server. The demo has no other players: the map
 * shows the own company and the AI companies (deterministic country per ticker, never leaders). The terms of the
 * country work in the server's hourly close only.
 */
export interface DemoWorldState {
  country: string;
  hqTier: number;
  style: HqStyle;
  investedCents: number;
  placedAt: number;
  movedAt: number | null;
  subsidiaries: { country: string; openedAt: number; setupCostCents: number }[];
  image: Record<string, { bonusBps: number; at: number; lastCampaignAt: number; spentCents: number }>;
  feeBps: number;
  feeSetAt: number | null;
}

export interface WorldHost {
  company(): {
    id: string;
    name: string;
    sector: string;
    color: string;
    cashCents: number;
    unpaidCents?: number;
  } | null;
  worthCents(): number;
  listed(): boolean;
  nickname(): string;
  addCompanyCash(cents: number): void;
  state(): DemoWorldState | null;
  setState(next: DemoWorldState | null): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
}

const cfg = WORLD_RULES;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const known = (key: string) => COUNTRIES.some((c) => c.key === key);
const iso = (ms: number) => new Date(ms).toISOString();

/** The country an AI company sits in on the map: stable per ticker. */
export function aiCountry(ticker: string): string {
  let h = 0;
  for (const ch of ticker) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COUNTRIES[h % COUNTRIES.length]!.key;
}

export function createWorldEngine(host: WorldHost): WorldEngine {
  const bonus = (st: DemoWorldState, country: string) => {
    const i = st.image[country];
    return i ? imageBonusAfter(i.bonusBps, (host.now() - i.at) / DAY) : 0;
  };

  const view = (): WorldState => {
    const company = host.company();
    const st = host.state();
    const now = host.now();
    const worth = company ? host.worthCents() : 0;
    const leader = st !== null && worth >= cfg.lobby.minWorthCents;
    const places: WorldPlace[] = [];
    if (company && st) {
      places.push({
        companyId: company.id,
        name: company.name,
        owner: host.nickname(),
        country: st.country,
        kind: "hq",
        hqTier: st.hqTier,
        hqStyle: st.style,
        worthCents: worth,
        sector: company.sector,
        brandColor: company.color,
        mine: true,
        leader,
      });
      for (const s of st.subsidiaries) {
        places.push({
          ...places[0]!,
          country: s.country,
          kind: "subsidiary",
          hqTier: 0,
          worthCents: null,
          leader: false,
        });
      }
    }
    for (const ai of DEMO_COMPANIES.slice(0, 12)) {
      places.push({
        companyId: `demo-company-${ai.ticker}`,
        name: ai.name,
        owner: null,
        country: aiCountry(ai.ticker),
        kind: "ai",
        hqTier: 0,
        hqStyle: DEFAULT_HQ_STYLE,
        worthCents: ai.marketCapCents,
        sector: ai.sector,
        brandColor: ai.color,
        mine: false,
        leader: false,
      });
    }
    const subs = st?.subsidiaries ?? [];
    return {
      company: company
        ? {
            id: company.id,
            name: company.name,
            worthCents: worth,
            freeCashCents: company.cashCents - (company.unpaidCents ?? 0),
            listed: host.listed(),
          }
        : null,
      unlockWorthCents: cfg.unlockWorthCents,
      me: st
        ? {
            country: st.country,
            hqTier: st.hqTier,
            hqStyle: st.style,
            investedCents: st.investedCents,
            placedAt: iso(st.placedAt),
            movedAt: st.movedAt ? iso(st.movedAt) : null,
            relocateReadyAt: iso((st.movedAt ?? st.placedAt) + cfg.relocation.cooldownHours * HOUR),
            relocationCostCents: relocationCostCents(st.investedCents),
            nextTierCostCents: hqTier(st.hqTier + 1)?.costCents ?? null,
            subsidiaries: subs.map((s) => ({
              country: s.country,
              openedAt: iso(s.openedAt),
              setupCostCents: s.setupCostCents,
              ramp: subsidiaryRamp((now - s.openedAt) / HOUR),
              hourlyCostCents: subsidiaryHourlyCostCents((now - s.openedAt) / HOUR),
            })),
            nextSubsidiaryCostCents:
              subs.length < cfg.subsidiaries.max ? subsidiarySetupCostCents(subs.length + 1) : null,
            subsidiaryUnlocked: subsidiaryUnlocked(worth, st.hqTier),
            image: Object.fromEntries(
              Object.entries(st.image).map(([k, v]) => [
                k,
                {
                  bonusBps: bonus(st, k),
                  readyAt: iso(v.lastCampaignAt + cfg.imageCampaign.cooldownHours * HOUR),
                  spentCents: v.spentCents,
                },
              ]),
            ),
            imageCampaignCostCents: imageCampaignCostCents(worth),
            effect: worldHourEffect(
              { country: st.country, imageBonusBps: bonus(st, st.country), tier: st.hqTier, leader },
              subs.map((s) => ({
                country: s.country,
                imageBonusBps: bonus(st, s.country),
                hoursOpen: (now - s.openedAt) / HOUR,
              })),
            ),
            leader,
            feeBps: leader ? st.feeBps : 0,
            feeReadyAt: leader && st.feeSetAt ? iso(st.feeSetAt + cfg.lobby.feeChangeCooldownHours * HOUR) : null,
            payingFee: null,
            feesPaidCents: 0,
            feesReceivedCents: 0,
          }
        : null,
      places,
      countries: COUNTRIES.map((c) => ({
        key: c.key,
        leaderId: leader && st?.country === c.key && company ? company.id : null,
        feeBps: leader && st?.country === c.key ? st.feeBps : 0,
      })),
    };
  };

  const own = () => {
    const company = host.company();
    if (!company) throw new GameError("company_not_found");
    return company;
  };
  const placed = () => {
    const st = host.state();
    if (!st) throw new GameError("world_not_placed");
    return st;
  };
  const pay = (cents: number) => {
    const company = own();
    if (company.cashCents - (company.unpaidCents ?? 0) < cents) throw new GameError("insufficient_funds");
    host.addCompanyCash(-cents);
  };
  const write = (requestId: string, run: () => void) =>
    host.idempotent(requestId, () => {
      run();
      return view();
    });

  return {
    async world() {
      return view();
    },
    async worldPlaceHq(requestId, country) {
      return write(requestId, () => {
        own();
        if (!known(country)) throw new GameError("invalid_argument");
        if (host.state()) throw new GameError("world_placed");
        if (host.worthCents() < cfg.unlockWorthCents) throw new GameError("world_locked");
        const cost = hqTier(1)!.costCents;
        pay(cost);
        host.setState({
          country,
          hqTier: 1,
          style: DEFAULT_HQ_STYLE,
          investedCents: cost,
          placedAt: host.now(),
          movedAt: null,
          subsidiaries: [],
          image: {},
          feeBps: 0,
          feeSetAt: null,
        });
      });
    },
    async worldUpgradeHq(requestId) {
      return write(requestId, () => {
        const st = placed();
        const next = hqTier(st.hqTier + 1);
        if (!next) throw new GameError("world_max_tier");
        pay(next.costCents);
        host.setState({ ...st, hqTier: next.tier, investedCents: st.investedCents + next.costCents });
      });
    },
    async worldRelocateHq(requestId, country) {
      return write(requestId, () => {
        const st = placed();
        if (!known(country)) throw new GameError("invalid_argument");
        if (st.country === country || st.subsidiaries.some((s) => s.country === country)) {
          throw new GameError("world_same_country");
        }
        if ((st.movedAt ?? st.placedAt) + cfg.relocation.cooldownHours * HOUR > host.now())
          throw new GameError("locked");
        pay(relocationCostCents(st.investedCents));
        host.setState({ ...st, country, movedAt: host.now() });
      });
    },
    async worldSaveHqStyle(requestId, style) {
      return write(requestId, () => {
        const st = placed();
        host.setState({ ...st, style: toHqStyle(style) });
      });
    },
    async worldOpenSubsidiary(requestId, country) {
      return write(requestId, () => {
        const st = placed();
        if (!known(country)) throw new GameError("invalid_argument");
        if (!subsidiaryUnlocked(host.worthCents(), st.hqTier)) throw new GameError("world_subsidiary_locked");
        if (st.country === country || st.subsidiaries.some((s) => s.country === country)) {
          throw new GameError("world_same_country");
        }
        if (st.subsidiaries.length >= cfg.subsidiaries.max) throw new GameError("world_subsidiary_cap");
        const cost = subsidiarySetupCostCents(st.subsidiaries.length + 1);
        pay(cost);
        host.setState({
          ...st,
          subsidiaries: [...st.subsidiaries, { country, openedAt: host.now(), setupCostCents: cost }],
        });
      });
    },
    async worldCloseSubsidiary(requestId, country) {
      return write(requestId, () => {
        const st = placed();
        if (!st.subsidiaries.some((s) => s.country === country)) throw new GameError("invalid_argument");
        host.setState({ ...st, subsidiaries: st.subsidiaries.filter((s) => s.country !== country) });
      });
    },
    async worldImageCampaign(requestId, country) {
      return write(requestId, () => {
        const st = placed();
        if (!known(country)) throw new GameError("invalid_argument");
        if (st.country !== country && !st.subsidiaries.some((s) => s.country === country)) {
          throw new GameError("world_not_placed");
        }
        const prev = st.image[country];
        if (prev && prev.lastCampaignAt + cfg.imageCampaign.cooldownHours * HOUR > host.now()) {
          throw new GameError("locked");
        }
        const cost = imageCampaignCostCents(host.worthCents());
        pay(cost);
        const now = host.now();
        host.setState({
          ...st,
          image: {
            ...st.image,
            [country]: {
              bonusBps: imageBonusWithCampaign(bonus(st, country)),
              at: now,
              lastCampaignAt: now,
              spentCents: (prev?.spentCents ?? 0) + cost,
            },
          },
        });
      });
    },
    async worldSetLocationFee(requestId, feeBps) {
      return write(requestId, () => {
        const st = placed();
        if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > cfg.lobby.maxFeeBps) {
          throw new GameError("invalid_argument");
        }
        if (host.worthCents() < cfg.lobby.minWorthCents) throw new GameError("world_not_leader");
        if (st.feeSetAt && st.feeSetAt + cfg.lobby.feeChangeCooldownHours * HOUR > host.now()) {
          throw new GameError("locked");
        }
        host.setState({ ...st, feeBps, feeSetAt: host.now() });
      });
    },
  };
}
