/*
 * Own strategies (ADR-132): the founder writes in a sentence or two how the company reacts to a crisis or chance,
 * or invents an own business move. Claude judges how well the idea fits and how likely it backfires; a random roll
 * decides. Without a Claude key the built-in Mini-KI judges by keywords (the lists below, lower case).
 */
export const PITCH_RULES = {
  minChars: 12,
  maxChars: 280,
  /** Claude has this long to judge; then the Mini-KI takes over. */
  judgeWaitSeconds: 90,
  /** Time from the judgment to the result. */
  eventMinutes: 20,
  moveMinutes: 30,
  /** Chance = base + fit (0..100) x perFit, at most max. Fit 50 -> 50 %, fit 90 -> 82 %. */
  chanceBaseBps: 1_000,
  chancePerFitBps: 80,
  maxChanceBps: 9_000,
  /** Cost: event = company_event_unit_cents x units; move = the tier's move base cost x factor. */
  eventCostUnits: 2,
  moveCostFactor: 1.2,
  /** A solved crisis keeps this much of its effect away (mitigation), more with a better fit. */
  mitigationBase: 0.35,
  mitigationPerFit: 0.005,
  maxMitigation: 0.9,
  /** Own move, success: cash pays cost x (payoutBase + fit x payoutPerFit); awareness/quality grow by gain. */
  movePayoutBase: 1.3,
  movePayoutPerFit: 0.012,
  moveGainBase: 0.02,
  moveGainPerFit: 0.0006,
  /** Failure of a move: this share of the cost comes back. */
  moveRefundBps: 2_000,
  /** Backfire: awareness lost; for a crisis the company also pays the cost again. */
  backfireAwareness: 0.05,
  /** Mini-KI: fit = base + perHit x good words (at most maxHits) + longText bonus; backfire = base + perRisky x risky. */
  mini: {
    fitBase: 25,
    fitPerHit: 12,
    maxHits: 4,
    longTextChars: 60,
    longTextBonus: 10,
    maxFit: 85,
    backfireBase: 10,
    backfirePerRisky: 20,
    maxBackfire: 70,
    risky: [
      "imagefilm",
      "werbung",
      "werbekampagne",
      "influencer",
      "pr-",
      "greenwashing",
      "ignorieren",
      "leugnen",
      "abstreiten",
      "lügen",
      "vertuschen",
      "schweigen",
      "aussitzen",
      "drohen",
      "verklagen",
      "entlassen",
      "billiger",
      "bestechen",
    ],
    good: {
      regulation: ["anwalt", "recht", "prüfen", "anpassen", "lobby", "verband", "gutachten", "umstellen", "dialog"],
      special_tax: ["steuer", "berater", "kalkul", "preis", "rohstoff", "ersatz", "sparen", "lieferant"],
      supply_shortage: ["lieferant", "lager", "alternativ", "vorrat", "zweit", "ersatz", "vertrag", "regional"],
      quality_scandal: [
        "rückruf",
        "entschuldig",
        "prüf",
        "qualität",
        "kontroll",
        "ersetzen",
        "transparen",
        "entschädig",
      ],
      data_breach: ["sicherheit", "passwort", "verschlüssel", "melden", "experten", "informieren", "update", "audit"],
      price_war: ["qualität", "service", "treue", "nische", "kosten", "bündel", "mehrwert", "marke"],
      strike: ["lohn", "gehalt", "verhandl", "bonus", "gespräch", "kompromiss", "zuhören", "arbeitszeit", "tarif"],
      protest: ["dialog", "einladen", "zuhören", "ändern", "nachhaltig", "transparen", "spenden", "fair"],
      patent_claim: ["anwalt", "patent", "lizenz", "einigung", "gutachten", "umgehen", "vergleich", "eigene"],
      bad_review: ["verbessern", "test", "feedback", "kunden", "nachbessern", "qualität", "gratis", "update"],
      viral_trend: ["nachproduz", "lager", "social", "video", "aktion", "schnell", "limitiert", "community"],
      big_contract: ["kapazität", "personal", "einstellen", "termin", "liefer", "verhandl", "vertrag", "schicht"],
      award: ["pressemitteilung", "werbung", "feiern", "kunden", "messe", "präsentieren", "website", "siegel"],
      subsidy: ["antrag", "förder", "investieren", "forschung", "berater", "unterlagen", "frist", "projekt"],
      partnership: ["vertrag", "gemeinsam", "partner", "teilen", "kooperation", "verhandl", "netzwerk", "vertrieb"],
      cash: ["verkauf", "auftrag", "kunden", "rabatt", "angebot", "großkunde", "export", "abo", "online"],
      awareness: ["werbung", "messe", "social", "video", "presse", "influencer", "sponsor", "event", "kampagne"],
      quality: ["schulung", "test", "prüfen", "verbessern", "material", "zertifi", "forschung", "feedback"],
    } as Readonly<Record<string, readonly string[]>>,
  },
} as const;
