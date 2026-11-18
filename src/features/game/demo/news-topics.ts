import { BALANCE } from "@/config/balance";
import { NEWS_TOPICS, type NewsTopicKey } from "@/config/news-topics";
import { NEXAMON_CARDS } from "@/config/nexamon";
import { formatMoney } from "@/lib/format";
import { movePercent, type TopicCandidate } from "@/lib/sim/news-show";

/*
 * NEXA Nachrichten, topics in the offline demo (ADR-169). The server tells them from what really happened; the demo
 * has one player, so the stories are about made-up fellow players (friends who are online first) with made-up
 * numbers inside the limits of the config. Every topic is a candidate in every show; the draw is the server's
 * (pickTopics). Pure: names, stocks and randomness come in.
 */
const cfg = BALANCE.newsShow.topics;
const fresh = BALANCE.newsShow.fresh;

/** Fellow players of the demo when no friend is online. */
const DEMO_PLAYERS = ["Dax_Dieter", "Bullen_Berta", "Kurs_Kalle", "Hebel_Hanna", "Rendite_Rudi", "Zins_Zoe"] as const;
const DEMO_COMPANIES = [
  "Knusperkönig",
  "Wolkenschloss",
  "Brezel & Byte",
  "Hundefernsehen 24",
  "Socken-Abo Nord",
] as const;

/** Talents and job titles of the demo stories (ADR-210). */
const DEMO_TALENTS = ["Greta Sonnenschein", "Bodo Wirbelwind", "Lotte Feinschliff", "Malte Pfennigfuchs"] as const;
const DEMO_TITLES = ["Junior-Analyst", "Teamleitung Vertrieb", "Lagerprofi", "Werkstudentin"] as const;

export interface DemoTopicContext {
  /** Nicknames the stories may be about (friends); the made-up players fill up. */
  players: readonly string[];
  /** Names of listed stocks. */
  stocks: readonly string[];
  random(): number;
}

export interface DemoTopicCandidate extends TopicCandidate {
  topic: NewsTopicKey;
  values: Record<string, string | number>;
}

export function demoTopicCandidates(ctx: DemoTopicContext): DemoTopicCandidate[] {
  const between = (lo: number, hi: number) => lo + Math.floor(ctx.random() * (hi - lo + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(ctx.random() * list.length))]!;
  const money = (loCents: number, hiCents: number) =>
    formatMoney(between(loCents / 100, hiCents / 100) * 100, { whole: true });
  const names = [...new Set([...ctx.players, ...DEMO_PLAYERS])];
  const sellers = BALANCE.nexamon.ai.sellers;
  const accessories = BALANCE.accessories.items;

  /** One value per placeholder of a topic. */
  function slot(topic: NewsTopicKey, key: string, name: string, company: string): string | number {
    const hit = pick(NEXAMON_CARDS.filter((c) => (cfg.cards.pullRarities as readonly string[]).includes(c.rarity)));
    switch (key) {
      case "name":
        return name;
      case "victim":
      case "buyer":
        return topic === "cardSale" ? pick(sellers) : pick(names.filter((n) => n !== name));
      case "seller":
        return topic === "cardSale" ? name : pick(sellers);
      case "card":
        return topic === "cardPull" ? hit.name : pick(NEXAMON_CARDS).name;
      case "rarity":
        return cfg.rarityNames[hit.rarity];
      case "set":
        return BALANCE.nexamon.sets[hit.set].name;
      case "packs":
        return topic === "cardDud"
          ? between(cfg.cards.dudMinPacks, 24)
          : topic === "cardSpree"
            ? between(fresh.facts.spreeMinPacks, 80)
            : between(1, 12);
      case "grade":
        return between(1, cfg.cards.lowGradeMax);
      case "fee":
        return money(2_000, 90_000);
      case "pct":
        return movePercent(
          topic === "worldFee"
            ? between(100, 1_500)
            : topic === "rankWeekLoser"
              ? between(fresh.facts.weekLossMinBps, 6_000)
              : topic === "corpGreedy" || topic === "pFounderPay"
                ? between(cfg.person.founderPayMinBps, 9_800)
                : topic === "pHourLoser" || topic === "pHourWinner"
                  ? between(cfg.person.hourMinBps, 2_500)
                  : between(cfg.cards.minMoveBps, 1_900),
        );
      case "amount":
        return topic === "cardSale"
          ? money(cfg.cards.minSaleCents, 60 * cfg.cards.minSaleCents)
          : topic === "pLandlord"
            ? money(cfg.person.rentMinCents, 400_000)
            : topic === "talentMarket"
              ? money(5_000, 400_000)
              : topic === "pVault"
                ? money(fresh.facts.vaultMinCents, 50_000_000)
                : topic === "pVaultPaid"
                  ? money(fresh.facts.vaultInterestMinCents, 2_000_000)
                  : topic === "corpLogo"
                    ? formatMoney(BALANCE.startups.logoRedrawCents, { whole: true })
                    : topic === "taxLate"
                      ? money(5_000, 250_000)
                      : topic === "cardUp" || topic === "cardDown"
                        ? money(500, 900_000)
                        : money(100_000, 9_000_000);
      case "count":
        return topic === "worldSub"
          ? between(1, 6)
          : topic === "cardTwist"
            ? between(2, 4)
            : topic === "pChatty"
              ? between(cfg.person.chatMin, 240)
              : topic === "pPoke"
                ? between(cfg.person.pokeMin, 40)
                : topic === "pOutfit"
                  ? between(cfg.person.outfitMin, 6)
                  : topic === "pReroll"
                    ? between(cfg.person.rerollMin, 5)
                    : topic === "pFriends" || topic === "pLandlord" || topic === "pAccessory"
                      ? between(1, 4)
                      : topic === "cardCollection"
                        ? between(40, 400)
                        : topic === "cardAi"
                          ? between(20, 200)
                          : topic === "corpQuit"
                            ? between(cfg.corp.quitMin, 12)
                            : between(3, 8);
      case "days":
        return topic === "pVault"
          ? pick([1, 3, 7])
          : topic === "pStreak"
            ? between(fresh.facts.streakMinDays, 120)
            : topic === "taxStreak"
              ? between(cfg.tax.streakMinDays, 30)
              : between(BALANCE.newsShow.gossip.absentDays, 21);
      case "value":
        return topic === "corpMoodLow" ? between(3, cfg.corp.moodLow) : between(cfg.corp.moodHigh, 99);
      case "company":
        return company;
      case "stock":
        return ctx.stocks.length > 0 ? pick(ctx.stocks) : "NEXA AG";
      case "item":
        return pick(accessories).name;
      // ---- season three (ADR-210)
      case "country":
        return pick(BALANCE.world.countries).name;
      case "tier":
        return topic === "talentMarket" ? pick(fresh.tierNames) : between(fresh.facts.hqMinTier, 10);
      case "event":
        return pick(Object.values(fresh.eventNames));
      case "severity":
        return pick(fresh.events.severityNames);
      case "response": {
        const r = fresh.events.responses;
        const strategy = pick(Object.values(fresh.events.strategyNames));
        return topic === "worldEventLost"
          ? r.sitOut
          : topic === "worldEventWon"
            ? r.strategy.replace("{strategy}", strategy)
            : `${r.insured.replace("{pct}", movePercent(between(5_000, 8_000)))} ${r.noStrategy}`;
      }
      case "talent":
        return pick(DEMO_TALENTS);
      case "role":
        return pick(Object.values(fresh.roleNames));
      case "rival":
        return pick(DEMO_COMPANIES.filter((c) => c !== company));
      case "title":
        return pick(DEMO_TITLES);
      case "rank":
        return between(1, 40);
      case "places":
        return between(fresh.facts.rankMinPlaces, 25);
      case "skill":
        return pick(Object.values(fresh.skillNames));
      case "level":
        return between(fresh.facts.skillMinLevel, 20);
      case "what":
        if (topic === "marketEvent")
          return pick(["Gewinnmitnahmen", "Leerverkäufer-Report", "Marktkorrektur", "Blasenwarnung", "Erholung"]);
        return ctx.random() < 0.5
          ? "ein neues Zuhause bezogen"
          : `ein neues Auto gekauft für ${money(1_000_000, 20_000_000)}`;
      default:
        return "";
    }
  }

  return (Object.keys(NEWS_TOPICS) as NewsTopicKey[]).map((topic) => {
    const slots = NEWS_TOPICS[topic].slots as readonly string[];
    const about = slots.includes("name") || topic === "cardSale" ? pick(names) : null;
    const company = pick(DEMO_COMPANIES);
    return {
      topic,
      player: about,
      values: Object.fromEntries(slots.map((key) => [key, slot(topic, key, about ?? "", company)])),
    };
  });
}
