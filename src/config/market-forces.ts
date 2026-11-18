/**
 * Market forces from outside (ADR-214): stocks may rise and fall without a daily limit, but an overheated stock draws
 * profit taking, short-seller reports, downgrades, audits, corrections and bubble warnings. The hotter the stock (price
 * far above its fair value, big gains in 24 hours or 7 days), the more often and the harder. A few positive forces
 * lift stocks that fell far below their fair value, and a small background rate reaches every stock (AI stocks too).
 *
 * Every force is a stock hint with a lead (ADR-119, table stock_tips with source 'market'): it is announced in the
 * stock news and the news feed and moves only the price after the lead, never the fair value. So it always pulls the
 * price back towards the fair value instead of moving the anchor with it.
 *
 * Formulas in src/lib/sim/market-forces.ts, mirrored in Postgres
 * (supabase/migrations/20261204010900_stock_unbounded.sql). Plain data, no imports (part of BALANCE as "marketForces").
 */
export const MARKET_FORCES = {
  /**
   * heat = Σ max(0, ln(x) − free) / scale over premium = price / fair value, the gain over 24 hours and over 7 days,
   * capped at maxHeat. cold is the same for a price below the fair value and a loss over 24 hours. ln(1,25) ≈ 0,22.
   */
  heat: {
    premiumFree: 0.25,
    premiumScale: 0.5,
    gain24hFree: 0.2,
    gain24hScale: 0.4,
    gain7dFree: 0.5,
    gain7dScale: 0.8,
    /** Gains count only while ln(price / fair value) ≥ −gainGate (a stock below its value is not overheated). */
    gainGate: 0.1,
    discountFree: 0.3,
    discountScale: 0.6,
    loss24hFree: 0.3,
    loss24hScale: 0.5,
    maxHeat: 4,
  },
  /** Chance per stock and hour: base + perHeat × heat + perCold × cold, at most maxPerHour. */
  chance: {
    basePerHour: 0.012,
    perHeatPerHour: 0.9,
    perColdPerHour: 0.35,
    maxPerHour: 3,
  },
  /** Announced this long before the price moves (shorter than ordinary stock news: the market reacts quickly). */
  leadMinMinutes: 3,
  leadMaxMinutes: 15,
  /** Share of forces that come true. */
  reliabilityBps: 8_500,
  /** Move = uniform(min, max) × (1 + severityPerHeat × heat) (cold for positive forces), at most maxMoveBps. */
  severityPerHeat: 0.45,
  maxMoveBps: 4_500,
  /**
   * The news also turns the mood (sentiment, −1..1, fades within about an hour): Δ = direction × move × this. Small
   * investors keep selling after a crash and keep buying after a rally, so a force is not undone within minutes.
   */
  sentimentPerMove: 2,
  /**
   * Waves hit several stocks at once: a market correction (the hottest stocks of all), a sector correction (the hottest
   * sector) or rate fears. Checked once per minute: basePerHour + perHeatPerHour × mean heat of the hot stocks.
   * A relief rally lifts the coldest stocks.
   */
  waves: {
    basePerHour: 0.02,
    perHeatPerHour: 0.25,
    maxPerHour: 1,
    reliefPerHour: 0.02,
    minHeat: 0.2,
    maxStocks: 6,
  },
  /**
   * Single forces. when: hot (weight × heat, from minHeat), cold (weight × cold), any (weight, the background rate).
   * {name} is the company, {w} the strength word (leicht, spürbar, deutlich).
   */
  forces: [
    {
      key: "profit_taking",
      direction: -1,
      when: "hot",
      minHeat: 0,
      weight: 4,
      minMoveBps: 400,
      maxMoveBps: 1_200,
      headline: "Gewinnmitnahmen bei {name}",
      body: "Nach dem steilen Anstieg wollen viele Anleger ihre Gewinne sichern. Der Kurs dürfte {w} nachgeben.",
    },
    {
      key: "analyst_downgrade",
      direction: -1,
      when: "hot",
      minHeat: 0,
      weight: 3,
      minMoveBps: 300,
      maxMoveBps: 1_000,
      headline: "Analysten stufen {name} ab",
      body: "Nach dem Lauf halten mehrere Häuser die Aktie für ausgereizt und raten zum Verkauf.",
    },
    {
      key: "dilution_rumor",
      direction: -1,
      when: "hot",
      minHeat: 0.5,
      weight: 2,
      minMoveBps: 400,
      maxMoveBps: 1_200,
      headline: "Gerüchte über eine Kapitalerhöhung bei {name}",
      body: "Der hohe Kurs lädt zu neuen Aktien ein. Anleger fürchten, dass ihre Anteile {w} verwässert werden.",
    },
    {
      key: "short_report",
      direction: -1,
      when: "hot",
      minHeat: 1,
      weight: 3,
      minMoveBps: 800,
      maxMoveBps: 2_000,
      headline: "Leerverkäufer-Report: {name} sei massiv überbewertet",
      body: "Ein bekannter Fonds veröffentlicht eine Studie gegen {name} und wettet auf fallende Kurse.",
    },
    {
      key: "insider_probe",
      direction: -1,
      when: "hot",
      minHeat: 1,
      weight: 2,
      minMoveBps: 500,
      maxMoveBps: 1_500,
      headline: "Insider-Verdacht: Aufsicht prüft Käufe bei {name}",
      body: "Die Börsenaufsicht schaut sich die auffälligen Käufe der letzten Tage genauer an.",
    },
    {
      key: "margin_calls",
      direction: -1,
      when: "hot",
      minHeat: 1.5,
      weight: 2,
      minMoveBps: 600,
      maxMoveBps: 1_800,
      headline: "Margin Calls bei {name}",
      body: "Spekulanten auf Kredit müssen nachschießen oder verkaufen. Der Kurs dürfte {w} fallen.",
    },
    {
      key: "special_audit",
      direction: -1,
      when: "hot",
      minHeat: 1.5,
      weight: 2,
      minMoveBps: 800,
      maxMoveBps: 2_500,
      headline: "Sonderprüfung bei {name} angekündigt",
      body: "Wirtschaftsprüfer sollen die Bücher von {name} durchleuchten. Bis dahin halten sich Anleger zurück.",
    },
    {
      key: "bubble_warning",
      direction: -1,
      when: "hot",
      minHeat: 2,
      weight: 3,
      minMoveBps: 1_000,
      maxMoveBps: 3_000,
      headline: "Blasenwarnung: {name} weit über jedem Wert",
      body: "Ökonomen warnen in den Nachrichten vor einer Blase bei {name}. Der Kurs dürfte {w} einbrechen.",
    },
    {
      key: "rotation",
      direction: -1,
      when: "any",
      minHeat: 0,
      weight: 1,
      minMoveBps: 200,
      maxMoveBps: 600,
      headline: "Anleger schichten aus {name} um",
      body: "Große Fonds verkaufen Teile ihrer Position. Der Kurs dürfte {w} nachgeben.",
    },
    {
      key: "fund_entry",
      direction: 1,
      when: "any",
      minHeat: 0,
      weight: 1,
      minMoveBps: 200,
      maxMoveBps: 600,
      headline: "Fonds steigt bei {name} ein",
      body: "Ein großer Fonds baut eine Position auf. Der Kurs dürfte {w} anziehen.",
    },
    {
      key: "bargain_hunters",
      direction: 1,
      when: "cold",
      minHeat: 0,
      weight: 3,
      minMoveBps: 400,
      maxMoveBps: 1_200,
      headline: "Schnäppchenjäger greifen bei {name} zu",
      body: "Nach dem Absturz gilt die Aktie als günstig. Käufer dürften den Kurs {w} anheben.",
    },
    {
      key: "buyback_rumor",
      direction: 1,
      when: "cold",
      minHeat: 0,
      weight: 2,
      minMoveBps: 300,
      maxMoveBps: 900,
      headline: "Gerücht: {name} kauft eigene Aktien zurück",
      body: "Bei diesem Kurs soll die Firma selbst zugreifen wollen. Das stützt den Kurs {w}.",
    },
    {
      key: "analyst_upgrade",
      direction: 1,
      when: "cold",
      minHeat: 0,
      weight: 2,
      minMoveBps: 300,
      maxMoveBps: 1_000,
      headline: "Analysten sehen Nachholbedarf bei {name}",
      body: "Der Kurs liege weit unter dem Wert der Firma. Mehrere Häuser raten zum Kauf.",
    },
  ],
  /** Waves: one news item for all hit stocks, one hint per stock. {sector} is the sector name. */
  waveTexts: {
    market: {
      headline: "Marktkorrektur: Anleger nehmen heiße Werte vom Tisch",
      body: "Nach den starken Wochen sichern große Anleger Gewinne. Betroffen sind vor allem: {names}.",
    },
    sector: {
      headline: "Korrektur in der Branche {sector}",
      body: "Die Branche gilt als heiß gelaufen. Anleger verkaufen {names}.",
    },
    rates: {
      headline: "Zinssorgen belasten heiße Aktien",
      body: "Anleger fürchten höhere Zinsen und trennen sich von teuren Werten wie {names}.",
    },
    relief: {
      headline: "Erholung: Anleger kaufen gefallene Werte",
      body: "Nach dem Ausverkauf greifen Anleger wieder zu, vor allem bei {names}.",
    },
  },
  /** Words for strength 1..3, as in the stock news. */
  strengthWords: ["leicht", "spürbar", "deutlich"],
} as const;

export type MarketForcesConfig = typeof MARKET_FORCES;
export type MarketForce = MarketForcesConfig["forces"][number];
