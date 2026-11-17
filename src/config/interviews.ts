/*
 * CEO interviews (ADR-173): now and then NEXA Nachrichten asks a founder for an interview. Three questions drawn from
 * pools tied to the company's situation, answered in free text or with a quick answer; the finished interview (or
 * the "kein Kommentar") airs in the next hourly show. The server writes the questions and the show, so the German
 * texts live here like the show's scripts (news-show.ts). Pure data, no imports; money in cents, rates in bps.
 */

/** What a question needs to be asked; the server checks it against the company's facts (interviewFacts). */
export type InterviewWhen =
  | "always"
  | "profit"
  | "loss"
  | "listed"
  | "unhappy"
  | "happy"
  | "layoffs"
  | "scandal"
  | "big"
  | "small"
  | "solo"
  | "famous"
  | "unknown";

export type InterviewTone = "good" | "ok" | "bad";

export interface InterviewQuestionConfig {
  readonly key: string;
  readonly when: InterviewWhen;
  /** Placeholders: {ceo}, {company}, {profit}, {satisfaction}, {staff}. */
  readonly text: string;
  /** Three ready answers with how they land. */
  readonly quick: readonly { readonly text: string; readonly tone: InterviewTone }[];
  /** Words (lower case, prefixes) that make a free answer to this question land well. */
  readonly good?: readonly string[];
}

const q = (
  key: string,
  when: InterviewWhen,
  text: string,
  quick: [string, InterviewTone][],
  good: string[] = [],
): InterviewQuestionConfig => ({ key, when, text, quick: quick.map(([t, tone]) => ({ text: t, tone })), good });

export const INTERVIEW_QUESTIONS: readonly InterviewQuestionConfig[] = [
  q(
    "profit_secret",
    "profit",
    "{company} hat zuletzt {profit} Gewinn gemacht. Verraten Sie uns das Geheimnis, oder ist es Glück?",
    [
      ["Ein starkes Team und zufriedene Kunden. Kein Glück.", "good"],
      ["Ein bisschen von beidem, ehrlich gesagt.", "ok"],
      ["Das Geheimnis behalte ich schön für mich.", "bad"],
    ],
    ["team", "kunde", "qualität", "fleiß", "arbeit"],
  ),
  q(
    "profit_bonus",
    "profit",
    "Bei so viel Gewinn: Bekommt das Team einen Bonus oder kauft sich {ceo} eine Yacht?",
    [
      ["Das Team bekommt einen Bonus, die Yacht kann warten.", "good"],
      ["Wir investieren erst mal in die Firma.", "ok"],
      ["Die Yacht ist schon bestellt.", "bad"],
    ],
    ["bonus", "team", "investier", "mitarbeit"],
  ),
  q(
    "loss_plan",
    "loss",
    "{company} schreibt rote Zahlen, zuletzt {profit}. Wie lange schauen Sie sich das noch an?",
    [
      ["Wir haben einen klaren Plan und sparen an den richtigen Stellen.", "good"],
      ["Das wird schon wieder.", "ok"],
      ["Schuld sind die Kunden, nicht wir.", "bad"],
    ],
    ["plan", "spar", "kosten", "verbesser", "umbau"],
  ),
  q(
    "loss_blame",
    "loss",
    "Wer ist schuld am Verlust: der Markt, das Team oder der Chef im Spiegel?",
    [
      ["Am Ende trage ich die Verantwortung.", "good"],
      ["Der Markt war schwierig.", "ok"],
      ["Das Team, ganz klar.", "bad"],
    ],
    ["verantwort", "ich", "lernen", "fehler"],
  ),
  q(
    "listed_price",
    "listed",
    "Die Aktie von {company} hüpft auf und ab. Was sagen Sie den Aktionären, die nachts nicht schlafen können?",
    [
      ["Wir denken langfristig, und das zahlt sich aus.", "good"],
      ["Baldrian hilft.", "ok"],
      ["Die sollen halt verkaufen.", "bad"],
    ],
    ["langfristig", "dividende", "vertrauen", "strategie", "wachstum"],
  ),
  q(
    "listed_dividend",
    "listed",
    "Wann gibt es endlich eine ordentliche Dividende, oder geht alles in neue Bürostühle?",
    [
      ["Die Dividende wächst mit dem Gewinn, versprochen.", "good"],
      ["Wir prüfen das im Geschäftsrat.", "ok"],
      ["Die Bürostühle sind wirklich sehr bequem.", "bad"],
    ],
    ["dividende", "aktionär", "gewinn", "ausschütt"],
  ),
  q(
    "unhappy_staff",
    "unhappy",
    "Die Stimmung bei {company} liegt bei {satisfaction} Prozent. Ist das Büro ein Gefängnis mit Kaffeemaschine?",
    [
      ["Wir hören zu und ändern konkret etwas, ab Montag.", "good"],
      ["Es gibt bessere Tage.", "ok"],
      ["Wem es nicht passt, der kann gehen.", "bad"],
    ],
    ["zuhören", "gehalt", "stimmung", "ändern", "mitarbeit"],
  ),
  q(
    "happy_staff",
    "happy",
    "Bei {company} sind {satisfaction} Prozent zufrieden. Was gibt es da in der Kantine, Glückspillen?",
    [
      ["Faire Gehälter und echtes Vertrauen.", "good"],
      ["Sehr guten Kuchen.", "ok"],
      ["Ich weiß auch nicht, ehrlich.", "bad"],
    ],
    ["vertrauen", "fair", "gehalt", "team"],
  ),
  q(
    "layoffs",
    "layoffs",
    "Bei {company} wurden zuletzt Leute rausgeworfen. War das nötig oder hatten Sie einfach schlechte Laune?",
    [
      ["Es war schwer, und wir helfen allen beim Neuanfang.", "good"],
      ["Es musste leider sein.", "ok"],
      ["Die waren eh faul.", "bad"],
    ],
    ["helfen", "schwer", "leid", "fair", "abfindung"],
  ),
  q(
    "scandal",
    "scandal",
    "Ganz NEXA spricht über den Skandal bei {company}. Ihre Entschuldigung, bitte. Jetzt. Live.",
    [
      ["Wir entschuldigen uns und machen alles transparent.", "good"],
      ["Wir prüfen die Vorwürfe.", "ok"],
      ["Welcher Skandal?", "bad"],
    ],
    ["entschuldig", "transparen", "aufklär", "verantwort"],
  ),
  q(
    "big_monopoly",
    "big",
    "{company} ist inzwischen riesig. Wollen Sie eigentlich die ganze Stadt kaufen?",
    [
      ["Wir wollen besser werden, nicht nur größer.", "good"],
      ["Nur die schönen Ecken.", "ok"],
      ["Ja. Und danach das Land.", "bad"],
    ],
    ["besser", "kunde", "verantwort", "qualität"],
  ),
  q(
    "small_dream",
    "small",
    "{company} ist noch klein. Wann sehen wir Sie auf dem Cover der Wirtschaftspresse?",
    [
      ["Wenn unsere Kunden uns weiterempfehlen. Bald.", "good"],
      ["Gut Ding will Weile haben.", "ok"],
      ["Nächste Woche, ich habe schon ein Foto gemacht.", "bad"],
    ],
    ["kunde", "geduld", "schritt", "wachs"],
  ),
  q(
    "solo_founder",
    "solo",
    "Sie machen bei {company} alles allein. Reden Sie in der Mittagspause mit dem Drucker?",
    [
      ["Noch, aber bald stelle ich die ersten Leute ein.", "good"],
      ["Der Drucker ist ein guter Zuhörer.", "ok"],
      ["Ich brauche niemanden.", "bad"],
    ],
    ["einstell", "team", "suche", "wachs"],
  ),
  q(
    "famous",
    "famous",
    "Jeder kennt {company}. Wie fühlt es sich an, berühmter zu sein als ich?",
    [
      ["Das verdanken wir unseren Kunden.", "good"],
      ["Ungewohnt, aber schön.", "ok"],
      ["Das war ja auch nicht schwer.", "bad"],
    ],
    ["kunde", "danke", "dankbar", "team"],
  ),
  q(
    "unknown",
    "unknown",
    "Ehrlich gesagt kannte ich {company} bis heute nicht. Warum sollte sich das ändern?",
    [
      ["Weil wir ein Problem lösen, das alle kennen.", "good"],
      ["Weil Sie uns jetzt kennen.", "ok"],
      ["Ihr Problem, nicht meins.", "bad"],
    ],
    ["problem", "lösung", "kunde", "besser", "produkt"],
  ),
  q(
    "vision",
    "always",
    "Wo steht {company} in fünf Jahren? Und bitte nicht „auf dem Mond“.",
    [
      ["Marktführer, mit glücklichen Kunden und Team.", "good"],
      ["Hoffentlich noch da.", "ok"],
      ["Auf dem Mond.", "bad"],
    ],
    ["kunde", "team", "wachs", "nachhaltig", "marktführer"],
  ),
  q(
    "morning",
    "always",
    "Wie sieht der Morgen eines CEOs aus? Kalte Dusche, grüner Smoothie, Kurse checken?",
    [
      ["Kaffee mit dem Team und ein Blick auf die Zahlen.", "good"],
      ["Schlummertaste, dreimal.", "ok"],
      ["Ich stehe nie vor zwölf auf.", "bad"],
    ],
    ["team", "zahlen", "kunde", "früh"],
  ),
  q(
    "competition",
    "always",
    "Was sagen Sie Ihrer Konkurrenz, die gerade zuschaut?",
    [
      ["Danke, ihr macht uns besser.", "good"],
      ["Gute Unterhaltung.", "ok"],
      ["Ihr seid bald pleite.", "bad"],
    ],
    ["danke", "respekt", "besser", "fair"],
  ),
  q(
    "mistake",
    "always",
    "Was war Ihr teuerster Fehler als Chef von {company}? Wir haben Zeit.",
    [
      ["Zu spät zugehört. Daraus habe ich gelernt.", "good"],
      ["Die neue Kaffeemaschine.", "ok"],
      ["Ich mache keine Fehler.", "bad"],
    ],
    ["gelernt", "lernen", "fehler", "zuhören"],
  ),
  q(
    "product_pitch",
    "always",
    "Sie haben zehn Sekunden: Warum sollen unsere Zuschauer bei {company} kaufen?",
    [
      ["Beste Qualität zum fairen Preis, mit Service.", "good"],
      ["Weil es da ist.", "ok"],
      ["Weil die anderen noch schlechter sind.", "bad"],
    ],
    ["qualität", "preis", "service", "fair", "kunde"],
  ),
  q(
    "ai_workers",
    "always",
    "Ersetzen bei {company} bald Roboter alle Menschen, auch den Chef?",
    [
      ["Die KI hilft dem Team, sie ersetzt es nicht.", "good"],
      ["Den Chef hoffentlich zuletzt.", "ok"],
      ["Am liebsten sofort, Menschen sind so teuer.", "bad"],
    ],
    ["helfen", "team", "mensch", "unterstütz"],
  ),
  q(
    "doodle_tie",
    "always",
    "Letzte Frage, sehr wichtig: Wie finden Sie meine Krawatte?",
    [
      ["Mutig. Fast so mutig wie unser nächstes Produkt.", "good"],
      ["Sie ist… eine Krawatte.", "ok"],
      ["Ehrlich? Furchtbar.", "bad"],
    ],
    ["schön", "mutig", "toll", "elegant", "super"],
  ),
];

export const INTERVIEW_RULES = {
  /** Questions per interview, at most maxSituational tied to the situation (the rest from "always"). */
  count: 3,
  maxSituational: 2,
  /**
   * Chance of an interview request per company and day; the job rolls every hour with a 24th of it. More likely for
   * bigger and listed companies and after a notable event (scandal in the show, layoffs, losses).
   */
  chancePerDayBps: 2_500,
  tierBonusBps: { garage: 0, small_business: 1_000, gmbh: 2_500, ag: 4_000 },
  listedBonusBps: 3_000,
  eventBonusBps: 2_500,
  maxChancePerDayBps: 9_000,
  /** Only for founders who were active this recently; at most one request in this many hours per company. */
  activeHours: 48,
  cooldownHours: 20,
  /** The request expires after this time ("kein Kommentar"). */
  expiresHours: 6,
  /** Free answers: at most this long; shorter than minChars counts as no answer. */
  maxChars: 240,
  minChars: 2,
  /** Facts: a "layoff" is a dismissal within this many hours; "famous" from awarenessFamousBps, "unknown" below. */
  layoffHours: 72,
  scandalHours: 24,
  awarenessFamousBps: 3_000,
  awarenessUnknownBps: 1_000,
  unhappyBelow: 40,
  happyFrom: 75,
  /** Mini-KI judgement of a free answer: points -2..+2 (see judgeInterviewAnswer). */
  judge: {
    longChars: 60,
    shortChars: 8,
    maxGood: 2,
    maxBad: 2,
    good: ["kunde", "team", "danke", "verantwort", "transparen", "qualität", "fair", "investier", "zuhör", "gelernt"],
    bad: [
      "kein kommentar",
      "egal",
      "lüge",
      "dumm",
      "idiot",
      "pleite",
      "faul",
      "schuld sind",
      "keine ahnung",
      "halt die",
    ],
    quickPoints: { good: 1, ok: 0, bad: -1 },
    /** An empty or too short answer in an interview that was given. */
    nonePoints: -1,
  },
  /** Effects of the whole interview, capped: awareness in bps of the 0..1 scale (100 = +1 point). */
  effects: {
    awarenessPerPointBps: 60,
    maxAwarenessBps: 300,
    /** Reputation of listed companies (0..100 scale) per point, capped. */
    reputationPerPoint: 0.5,
    maxReputation: 3,
    declineAwarenessBps: -80,
    declineReputation: -0.5,
    ignoreAwarenessBps: -120,
    ignoreReputation: -1,
  },
  /** Interviews per show (each answered one is three segments) and the place in the running order. */
  perShow: 1,
  ord: 15,
  /** Not aired within this many hours: dropped from the show (the effects already applied). */
  airWithinHours: 30,
  texts: {
    notifyTitle: "Interviewanfrage von NEXA Nachrichten",
    notifyBody: "Mr. Doodle Dangle will {company} interviewen. Antworte innerhalb von {hours} Stunden.",
    headline: "Interview mit {ceo} ({company}) · Frage {n}/{total}",
    text: "{question} {ceo} sagt: »{answer}« {reaction}",
    noAnswer: "…",
    noCommentHeadline: "{company}: kein Kommentar",
    declined: [
      "Wir wollten mit {ceo} von {company} sprechen. Antwort: „Kein Kommentar.“ Wie mutig. Ich notiere: hat etwas zu verbergen.",
      "{ceo} hat unser Interview abgelehnt. {company} schweigt. Das Schweigen war übrigens sehr laut.",
      "Kein Kommentar von {company}. {ceo}, ich nehme das persönlich. Und meine Krawatte auch.",
    ],
    ignored: [
      "Sechs Stunden haben wir auf {ceo} von {company} gewartet. Nichts. Ich habe in der Zeit drei Kaffee und eine Krise gehabt.",
      "{company} hat unsere Interviewanfrage einfach liegen lassen. {ceo}, wir sehen uns. Wir sehen alles.",
      "Funkstille bei {company}. Entweder ist {ceo} sehr beschäftigt oder sehr ängstlich. Ich tippe auf beides.",
    ],
    reactions: {
      good: [
        "Oh. Das war tatsächlich gut. Ich bin fast gerührt.",
        "Starke Antwort. Ich hasse es, wenn Leute vorbereitet sind.",
        "Applaus aus der Regie! Na gut, von einer Person.",
        "Sehr souverän. Notiert: {ceo} kann reden.",
      ],
      ok: [
        "Hm. Das war eine Antwort. Technisch gesehen.",
        "Lauwarm, wie der Kaffee in unserer Kantine.",
        "Geht so. Ich gebe eine Fünf von Zehn.",
        "Diplomatisch. Langweilig, aber diplomatisch.",
      ],
      bad: [
        "Autsch. Das schneiden wir nicht raus.",
        "Die PR-Abteilung von {company} weint gerade leise.",
        "Ich habe mich verhört, oder? Nein? Wunderbar.",
        "Das kommt in den Jahresrückblick. Unter Peinlichkeiten.",
      ],
      none: [
        "Schweigen. Sehr tiefgründig. Oder einfach nichts.",
        "Keine Antwort ist auch eine Antwort. Eine schlechte.",
      ],
    },
    effectAwareness: "Bekanntheit",
    effectReputation: "Ruf",
  },
  moods: {
    good: ["proud", "laughing"],
    ok: ["smug", "confused"],
    bad: ["shocked", "angry"],
    none: ["angry", "crying"],
  },
} as const;
