/*
 * NEXA Nachrichten (ADR-150): once an hour, at the full hour, Mr. Doodle Dangle reads the news live. Every show
 * has a handful of segments with real effects: players who lost money get roasted (and a small consolation), a
 * player's company has a scandal or a hype, stocks and whole sectors jump, open company tasks get more or less
 * valuable, and the show ends with a hint for the coming hour. The server decides the effects; the texts below are
 * the Mini-KI's scripts (Claude rewrites them per company when a key is set, edge function news-anchor).
 * Placeholders: {name} player, {amount}, {pct}, {company}, {idea}, {founder}, {stock}, {sector}, {move}, {what}
 * (what a player did), {title} and {buyer} (NFTs), {person} (a public figure in a rumour).
 * The humour is harsh on purpose, but only about what happened in the game: lost play money, flopped companies.
 * When he digresses he may name public figures: always as an obviously absurd rumour, never about crimes, health
 * or private life (ADR-152).
 * More stories (ADR-169): the topics in news-topics.ts (collectibles, Finanzamt, listed companies, personal news
 * with numbers, odd bits) are scripts like the others; `topics` below says how many a show takes and from which
 * facts they are made.
 */
import { NEWS_RAMBLE_EXTRA, NEWS_TOPICS } from "./news-topics.ts";
import { NEWS_RUNNING_GAGS } from "./running-gags.ts";

type Topics = typeof NEWS_TOPICS;
const topicKeys = Object.keys(NEWS_TOPICS) as (keyof Topics)[];
/** The topics as scripts (frames and reasons), as moods and as the list the draw works on. */
const TOPIC_TEXTS = Object.fromEntries(
  topicKeys.map((key) => [key, { frames: NEWS_TOPICS[key].frames, reasons: NEWS_TOPICS[key].reasons }]),
) as { [K in keyof Topics]: Pick<Topics[K], "frames" | "reasons"> };
const TOPIC_MOODS = Object.fromEntries(topicKeys.map((key) => [key, NEWS_TOPICS[key].moods])) as {
  [K in keyof Topics]: Topics[K]["moods"];
};
const TOPIC_LIST = Object.fromEntries(
  topicKeys.map((key) => {
    const { group, kind, weight, tone, slots } = NEWS_TOPICS[key];
    return [key, { group, kind, weight, tone, slots }];
  }),
) as { [K in keyof Topics]: Pick<Topics[K], "group" | "kind" | "weight" | "tone" | "slots"> };

export const NEWS_SHOW_RULES = {
  /** The draft of a show is written this long before it airs (time for Claude to polish it). */
  prepareMinutes: 10,
  /** The opener: a small montage about Mr. Doodle Dangle. */
  introSeconds: 12,
  segmentSeconds: 22,
  outroSeconds: 6,
  /** Typewriter speed of the anchor's speech bubble. */
  charsPerSecond: 28,
  maxSegments: 12,
  /**
   * A show only happens when a real player watches: it starts when the first viewer is in the stream, at the full
   * hour or up to this long after it; without viewers it is cancelled and nothing happens.
   */
  waitMinutes: 10,
  /** The last show can be watched again this long. */
  replayMinutes: 55,
  /** The News tab is marked this long before the show. */
  teaserMinutes: 5,
  /**
   * The studio audience under the TV (ADR-157): everyone watching right now stands there as their dressed figure
   * (friends first), the made-up chat viewers too while they write. What someone writes pops up as a speech bubble
   * above their figure.
   */
  audience: {
    /** Players the server sends; on the stage at most this many figures, the rest as "+N". */
    max: 12,
    /** A speech bubble stays this long. */
    bubbleSeconds: 6,
    /** Bubbles shown at once; later ones wait for a free place. */
    bubblesAtOnce: 2,
    /** A bubble that waited longer than this is dropped (the chat still has the line). */
    bubbleMaxDelaySeconds: 12,
    /** A made-up viewer stands in the audience this long after their last line. */
    /** The made-up chat viewers stand in the studio too (owner: no, only real players are on the stage). */
    botsOnStage: false,
    botMinutes: 8,
    /** Accessories a made-up viewer wears at most (picked from the catalogue, seeded by the name). */
    botAccessoriesMax: 3,
  },
  chat: {
    maxLength: 200,
    perMinute: 10,
    history: 60,
    keepHours: 24,
    emojis: ["😂", "💀", "🔥", "📉", "📈", "🤡", "👏", "😱", "🍿", "💸", "🚀", "😭"],
    /**
     * Made-up viewers with everyday names write during a show: furious about Mr. Doodle Dangle, worshipping him, or
     * commenting on whoever is in the news ({name}). One line every everySecondsMin..Max seconds.
     */
    bots: {
      everySecondsMin: 6,
      everySecondsMax: 14,
      /** Share of lines about whoever is in the news right now, and of furious lines; the rest worships him. */
      aboutShareBps: 3_000,
      angryShareBps: 3_500,
      names: [
        "Jürgen Kowalski",
        "Chantal Schröder",
        "Dieter Brömmelkamp",
        "Uschi Hoppenstedt",
        "Kevin Pawlak",
        "Renate Zielinski",
        "Horst Kaczmarek",
        "Mandy Wuttke",
        "Günter Pototschnik",
        "Jacqueline Meier",
        "Rüdiger Fasselt",
        "Sabine Dombrowski",
        "Emre Yıldırım",
        "Nadine Krüger",
        "Wolfgang Stratmann",
        "Tamara Nowak",
      ],
      lines: {
        angry: [
          "Wer hat diesem Mann ein Mikrofon gegeben?? 😤",
          "Ich zahle keine Rundfunkgebühren für DAS.",
          "Der Schnurrbart lügt. Ich sehe es ihm an.",
          "Unverschämtheit! Ich schreibe einen Leserbrief!!",
          "Mr. Doodle Dangle hat mal mein Fahrrad schlechtgeredet. Ich vergesse nie.",
          "Früher waren Nachrichten noch seriös. Also vor diesem Kerl.",
          "So redet man nicht über Leute, du Schnauzbartträger 😡",
          "Abschalten. Sofort. Ich schaue natürlich weiter.",
          "Der Mann ist eine Zumutung mit Krawatte.",
          "Meine Frau sagt, ich soll mich nicht aufregen. ICH REGE MICH AUF.",
          "Wer kontrolliert eigentlich diesen Sender??",
          "Dangle raus!!! 👎",
          "Das melde ich dem Presserat. Sobald ich weiß, was das ist.",
          "Der hat doch selbst keine Ahnung von Aktien 🤡",
          "Ich habe Puls. Wegen DIESEM Mann.",
          "Schämen Sie sich, Herr Dangle! Und rasieren Sie sich!",
        ],
        glaze: [
          "Mr. Doodle Dangle ist der einzige Mann, dem ich vertraue ❤️",
          "Dieser Schnurrbart gehört ins Museum. Lebend.",
          "KÖNIG. LEGENDE. VATERFIGUR. 👑",
          "Ich habe mir sein Gesicht auf den Rücken tätowieren lassen.",
          "Er hat immer recht. Auch wenn er falsch liegt.",
          "Doodle Dangle for Bundeskanzler 🙏",
          "Ich schaue nur wegen ihm. Meine Familie ist ausgezogen. Egal.",
          "So ein schöner Mann. So eine schöne Stimme. 😍",
          "Jedes Wort ein Geschenk.",
          "Ich habe meinen Sohn nach ihm benannt. Er heißt jetzt Mister.",
          "Der beste Journalist seit Erfindung des Schnurrbarts.",
          "Bitte niemals aufhören zu senden 😭❤️",
          "Ich würde ihm mein Depot anvertrauen. Und meine Niere.",
          "Ein Gott unter Moderatoren 🔥",
          "Ich habe geweint. Vor Ehrfurcht.",
          "Wie er die Papiere hält. Meisterhaft.",
        ],
        about: [
          "{name} 💀💀💀",
          "Arme Sau, {name}. Kleiner Scherz. Hahaha.",
          "{name} erholt sich davon nie wieder 😂",
          "Ich kenne {name} persönlich. Es ist alles wahr.",
          "Lasst {name} in Ruhe!! ...oder macht weiter, ist lustig 🍿",
          "{name}, falls du zuschaust: Kopf hoch. Oder auch nicht.",
          "Team {name} 💪",
          "Screenshot gemacht. Das bekommt {name} jetzt jeden Tag geschickt.",
          "{name} hat das nicht verdient. Doch. Doch, hat {name}.",
          "Wer ist {name} und warum lache ich so?",
        ],
      },
    },
  },
  /** Running gags (ADR-179): stories that come back every show while their player company exists. */
  runningGags: NEWS_RUNNING_GAGS,
  /**
   * Announcements (ADR-182): exactly one show carries an entry, the one airing in the hour that starts at `at`
   * (the server remembers the slot, a later show never repeats it). It opens with one segment per entry of `sets`
   * (kind "release"): the pack and a highlight card on the studio TV, "{time}" in the text is `releaseAt` in Berlin
   * time. Claude's rewrite keeps these segments as drafted.
   */
  announcements: [
    {
      at: "2026-11-17T16:00:00Z",
      releaseAt: "2026-11-17T16:30:00Z",
      sets: [
        {
          set: "titans_revenge",
          cardKey: "tr-027",
          mood: "shocked",
          headline: "Neu: Titans Revenge",
          text:
            "Achtung, Sammler! Die Titanen sind erwacht: Titans Revenge, das neue Nexamon-Set für 100.000 € je Pack. " +
            "Iron in jedem Booster, dazu Titanium und Diamond, und wer ganz viel Glück hat, zieht Uranium: nur in " +
            "einem von fünfhundert Packs! Ab {time} Uhr im Shop.",
        },
        {
          set: "yin_yang",
          cardKey: "yy-109",
          mood: "proud",
          headline: "Neu: Yin Yang",
          text:
            "Und gleich noch eins: Yin Yang, 110 Karten in Schwarz und Weiß, einsame Krieger und epische Landschaften, " +
            "für 2.000 € je Pack. Die Legendaries Yin und Yang gehören zusammen. Ebenfalls ab {time} Uhr!",
        },
      ],
    },
  ] as readonly NewsShowAnnouncement[],
  /** The loser of the day: biggest loss of net worth in this window, at least minLossBps. Gets a consolation. */
  loser: { windowHours: 24, minLossBps: 300, consolationCents: 50_000 },
  /** The winner of the day: biggest gain, at least minGainBps. */
  winner: { windowHours: 24, minGainBps: 300 },
  /** A player's company in the headlines: scandal (awareness and share price down) or hype (up). */
  company: {
    count: 2,
    scandalShareBps: 6_000,
    awarenessMinBps: 1_000,
    awarenessMaxBps: 2_500,
    stockMinBps: 800,
    stockMaxBps: 2_000,
    /** A scandal costs this share of the task momentum above 1 (ADR-148). */
    momentumLossBps: 5_000,
  },
  /** Listed stocks of the AI companies: an absurd event moves the price at once. */
  stock: { count: 1, minBps: 600, maxBps: 1_800 },
  /** A whole sector moves. */
  sector: { minBps: 400, maxBps: 1_000 },
  /** Open company tasks of every company get more or less valuable. */
  tasks: { minBps: 2_000, maxBps: 4_000 },
  /**
   * Personal news about real players (kind "gossip"): what they did in the last hours (level, job, car, deals, a
   * failed IPO, a rug pull, missing for days, first or last in the rich list). Bad news pay a little hush money.
   */
  gossip: { count: 2, windowHours: 24, absentDays: 3, hushMoneyCents: 10_000 },
  /** The most expensive NFT sale of the last hours (kind "nft"). */
  nft: { windowHours: 24 },
  /**
   * He digresses (kind "ramble"): with chanceBps per show. With investShareBps of those a public figure "is said to"
   * have bought a stock (obvious satire, told as a rumour), which lifts that stock a little; otherwise pure nonsense.
   */
  ramble: {
    chanceBps: 7_000,
    investShareBps: 5_000,
    minBps: 300,
    maxBps: 900,
    people: [
      "Friedrich Merz",
      "Markus Söder",
      "Elon Musk",
      "Christian Lindner",
      "Heidi Klum",
      "Thomas Gottschalk",
      "Dieter Bohlen",
      "Robert Habeck",
      "Günther Jauch",
      "Donald Trump",
    ],
  },
  /**
   * More stories per show (ADR-169). Every topic in `list` is a script (texts and moods under its key) with a group,
   * the kind of segment, a weight and a tone. A show takes `count` topics out of those that have something to tell
   * right now: never one that ran in the last show while others are there, groups that are not in the show yet
   * first, then by weight. They go to the places `ords` in the running order (loser 10, gossip 20, company 30,
   * NFT 40, winner 50, gossip 60, company 70, digression 80, world 90, AI stock 100). A fact is told once.
   * Topics with tone "bad" in the group "person" or "cards" pay the player hush money.
   */
  topics: {
    /** 0 switches the topics off. */
    count: 3,
    ords: [25, 45, 65],
    /** Facts from this many hours back count ("heute"). */
    windowHours: 24,
    hushMoneyCents: 10_000,
    rarityNames: {
      common: "Common",
      rare: "Rare",
      ultra: "Ultra Rare",
      prisma: "Prisma",
      legendary: "Legendär",
      one_of_one: "One of One",
      iron: "Eisen",
      titanium: "Titan",
      diamond: "Diamant",
      uranium: "Uran",
    },
    cards: {
      /** A pull of these rarities is a story; a spree of at least dudMinPacks packs without any of hitRarities too. */
      pullRarities: ["prisma", "legendary", "diamond", "uranium"],
      hitRarities: ["ultra", "prisma", "legendary", "titanium", "diamond", "uranium"],
      dudMinPacks: 5,
      /** A sale from this price on; a card whose value left the day's first value by at least minMoveBps. */
      minSaleCents: 100_000,
      minMoveBps: 500,
      /** A grade up to this one hurts (a slab from 8 on is worth more than the raw card). */
      lowGradeMax: 6,
      collectionMinCards: 5,
      aiMinListings: 2,
    },
    tax: { streakMinDays: 5, debtMinCents: 100_000 },
    corp: { moodLow: 30, moodHigh: 85, quitMin: 2 },
    person: {
      /** One trade with at least this much realised loss or gain. */
      tradeMinCents: 100_000,
      /** Net worth change within the last hour. */
      hourMinBps: 200,
      rentMinCents: 10_000,
      accessoryMinCents: 100_000,
      /** Accessories worn at once. */
      outfitMin: 4,
      rerollMin: 2,
      chatMin: 30,
      pokeMin: 5,
      /** A founder's share of the profit and what it paid out in the window. */
      founderPayMinBps: 5_000,
      founderPayMinCents: 100_000,
    },
    list: TOPIC_LIST,
  },
  /** The anchor's face per script; one is picked at random. Claude may choose another one. */
  moods: {
    ...TOPIC_MOODS,
    loser: ["laughing", "smug"],
    winner: ["proud", "shocked"],
    scandal: ["shocked", "angry"],
    hype: ["proud", "laughing"],
    stockUp: ["proud", "smug"],
    stockDown: ["crying", "shocked"],
    sectorUp: ["proud"],
    sectorDown: ["crying", "angry"],
    tasksUp: ["laughing", "proud"],
    tasksDown: ["angry", "crying"],
    tip: ["smug"],
    filler: ["confused", "angry"],
    gossipBad: ["laughing", "smug", "shocked"],
    gossipGood: ["shocked", "proud"],
    nftSale: ["confused", "shocked", "laughing"],
    ramble: ["confused", "angry", "crying"],
    rambleInvest: ["shocked", "smug"],
  },
  /** Mr. Doodle Dangle's hint: a stock that probably moves in the coming hour (like the stock hints, ADR-119). */
  tip: { leadMinMinutes: 15, leadMaxMinutes: 45, minBps: 500, maxBps: 1_500, reliabilityBps: 7_000 },
  /**
   * Scripts of the Mini-KI as a construction kit: every kind has frames (headline and text) and a pool of reasons
   * ({reason}). A show picks the combination that was used longest ago (news_show_used), so with a few frames and
   * many reasons nothing repeats for hundreds of shows.
   */
  texts: {
    ...TOPIC_TEXTS,
    loser: {
      frames: [
        {
          headline: "{name} verbrennt {amount}",
          text: "Unser Verlierer des Tages: {name} hat {amount} versenkt, das sind {pct} des Vermögens. {reason} Die Redaktion schickt ein Trostpflaster.",
        },
        {
          headline: "Depot-Massaker bei {name}",
          text: "{name} hat heute {amount} verloren, {pct} einfach weg. {reason} Ein kleines Almosen ist unterwegs.",
        },
        {
          headline: "{name}: minus {pct} an einem Tag",
          text: "Eilmeldung aus der Abteilung Fremdscham: {name} hat {amount} in den Sand gesetzt. {reason} Wir spenden Trost, mehr können wir nicht tun.",
        },
        {
          headline: "Wo ist das Geld von {name}?",
          text: "{amount} futsch, {pct} Minus: {name} schreibt heute Börsengeschichte, leider die falsche. {reason} Das Trostpflaster kommt per Eilbote.",
        },
      ],
      reasons: [
        "Meine Großmutter handelt besser, und die ist seit 1987 tot.",
        "Experten nennen die Strategie „Augen zu und hoffen“.",
        "Wer so anlegt, braucht keine Feinde, nur jemanden, der ihm das Handy wegnimmt.",
        "Wenn Dummheit Rendite brächte, wäre das hier ein Milliardär.",
        "Das Motto lautet offenbar: teuer kaufen, billig verkaufen, laut heulen.",
        "Ein Affe mit Dartpfeilen hätte heute besser abgeschnitten, wir haben es nachgerechnet.",
        "Man kann auch mit Spielgeld scheitern, aber so gründlich schafft es nicht jeder.",
        "Selbst der Tresor hat sich aus Scham kurz geschlossen.",
        "Die Bank hat vorsorglich schon mal das Mitleid erhöht.",
        "Im Lehrbuch steht das unter „Wie man es nicht macht“, Kapitel eins bis zwölf.",
        "Das war kein Handel, das war eine Spende an den Markt.",
        "Unsere Praktikantin wollte helfen, wir haben sie zurückgehalten.",
        "Die Kurve des Depots sieht aus wie eine Rutsche, und zwar eine gute.",
        "Angeblich war ein Plan vorhanden. Er wurde nie gefunden.",
        "Was für ein Vollpfosten, und das meine ich wissenschaftlich.",
        "Ich habe Mitleid. Kleiner Scherz, habe ich nicht.",
        "Geh arbeiten, an der Börse wird das nichts mehr.",
        "Der Markt sagt danke, du Geldautomat auf zwei Beinen.",
        "So verbrennt man Geld, Kinder. Bitte nicht nachmachen, außer es ist seins.",
        "Für so ein Depot muss man sich schon am frühen Morgen Mühe geben.",
      ],
    },
    winner: {
      frames: [
        {
          headline: "{name} sahnt ab: plus {amount}",
          text: "Und nun zu jemandem, der es kann: {name} hat heute {amount} gemacht, {pct} im Plus. {reason}",
        },
        {
          headline: "Glückspilz des Tages: {name}",
          text: "{name} ist heute um {amount} reicher, {pct} rauf. {reason}",
        },
        {
          headline: "{name} schwimmt im Geld",
          text: "{pct} Plus, {amount} Gewinn: {name} zeigt dem Rest, wie es geht. {reason}",
        },
      ],
      reasons: [
        "Ob das Können war oder pures Glück, klärt die Staatsanwaltschaft.",
        "Alle anderen dürfen jetzt neidisch sein. Bitte der Reihe nach.",
        "Der Rest schaut zu und heult leise ins Depot.",
        "Wir gratulieren zähneknirschend.",
        "Bitte nicht nachmachen, ihr könnt das nicht.",
        "Insider vermuten eine Glaskugel im Keller.",
        "Das Finanzamt hat bereits freundlich gewunken.",
        "Neid ist die ehrlichste Form der Anerkennung, also bitte sehr.",
        "Man munkelt von einem Pakt mit dem Teufel, der Teufel dementiert.",
        "Wer jetzt um einen Kredit bittet, wird ausgelacht. Zu Recht.",
      ],
    },
    scandal: {
      frames: [
        {
          headline: "Skandal bei {company}",
          text: "Ausgerechnet {company}, die Firma mit dem Motto „{idea}“: {reason} Die Kunden laufen davon.",
        },
        {
          headline: "{company}: Chef {founder} unter Beschuss",
          text: "Bei {company} brennt die Hütte. {reason} {founder} spricht von einem Missverständnis. Zur Erinnerung, das Geschäftsmodell lautet: „{idea}“.",
        },
        {
          headline: "Kunden fliehen vor {company}",
          text: "Peinlich für {founder}: {reason} „{idea}“ klang auf dem Papier besser. Das Image von {company} ist im Eimer.",
        },
        {
          headline: "{company} blamiert sich bis auf die Knochen",
          text: "{company} wollte heute groß rauskommen. {reason} {founder} erklärte, das gehöre zum Konzept. Die Kundschaft erklärte, sie sei dann mal weg.",
        },
        {
          headline: "Shitstorm über {company}",
          text: "Das Netz zerreißt {company}. {reason} Seitdem will niemand mehr „{idea}“. {founder} hat das Firmenhandy im Fluss versenkt.",
        },
      ],
      reasons: [
        "Im Lager wurde ein Praktikant gefunden, der seit drei Wochen vermisst war. Er hatte niemandem gefehlt.",
        "Die Firmenkasse wurde offenbar mit dem Kicker-Budget verwechselt.",
        "Ein Kunde hat das Produkt tatsächlich benutzt und das Ergebnis im Internet gezeigt.",
        "Die Gewerbeaufsicht fand vierzig leere Pizzakartons, einen schlafenden Buchhalter und null Qualitätskontrolle.",
        "Statt der Kundschaft kam heute die Feuerwehr.",
        "Ein Werbespot wurde versehentlich mit dem Ton einer Karaoke-Nacht veröffentlicht.",
        "Die Kundenhotline wurde seit Monaten von einem Papagei bedient, und der war noch der Freundlichste.",
        "Das Qualitätssiegel an der Wand stellte sich als Kinderzeichnung heraus.",
        "Auf der Weihnachtsfeier wurde versehentlich die halbe Belegschaft befördert, die andere Hälfte gefeuert.",
        "Die Jahresbilanz wurde mit Buntstiften erstellt, immerhin innerhalb der Linien.",
        "Ein Großkunde bekam statt der Ware eine Kiste mit Entschuldigungsbriefen.",
        "Das Firmenmaskottchen hat gekündigt und packt in einem Buch aus.",
        "Die Geschäftsführung hat das wichtigste Meeting des Jahres verschlafen, im Meetingraum.",
        "Der Sicherheitsdienst hat sich selbst ausgesperrt und die Tür aufgebrochen.",
        "Das neue Logo sieht aus wie etwas, das man Kindern nicht zeigen sollte.",
        "Ein Mitarbeiter hat die gesamte Kundendatei alphabetisch nach Vornamen des Haustiers sortiert.",
        "Die Kaffeekasse war die einzige Abteilung mit Gewinn.",
        "Auf dem Firmenparkplatz wurde ein illegales Bobbycar-Rennen ausgehoben.",
      ],
    },
    hype: {
      frames: [
        {
          headline: "Alle wollen {company}",
          text: "Unfassbar, aber wahr: {company} ist der Renner. {reason} „{idea}“ geht weg wie warme Semmeln. {founder} soll vor Freude geweint haben.",
        },
        {
          headline: "{company} geht viral",
          text: "{reason} Plötzlich will jeder „{idea}“. {founder} tut so, als sei das alles geplant gewesen. Wir tun so, als würden wir das glauben.",
        },
        {
          headline: "Ritterschlag für {company}",
          text: "{company} räumt ab. {reason} {founder} hängt sich das gerahmt ins Büro. Die Kundschaft rennt die Tür ein.",
        },
      ],
      reasons: [
        "Ein Video über die Firma hat heute das Internet geflutet.",
        "Ein Testmagazin urteilt: „Besser als erwartet, und wir hatten nichts erwartet.“",
        "Ein Promi wurde mit dem Produkt gesehen, vermutlich aus Versehen.",
        "Eine Oma hat im Fernsehen geschworen, es habe ihr Leben verändert.",
        "Die Konkurrenz hat aus Versehen Werbung für sie gemacht.",
        "Ein Kind hat im Schulaufsatz darüber geschrieben, die Klasse war begeistert.",
        "Die Warteschlange vor der Tür reicht bis zur nächsten Postleitzahl.",
        "Selbst die Praktikanten wurden heute um Autogramme gebeten.",
        "Ein Bürgermeister hat spontan eine Straße danach benannt.",
        "Sogar die Steuerprüfung kam privat vorbei, um einzukaufen.",
      ],
    },
    stockUp: {
      frames: [
        { headline: "{stock} schießt nach oben", text: "{stock} legt {move} zu. {reason} Analysten sind fassungslos." },
        {
          headline: "Kursrakete {stock}",
          text: "{reason} Die Börse feiert: {stock} steigt um {move}. Wer nicht dabei ist, darf sich jetzt ärgern.",
        },
        {
          headline: "{stock}: Gerücht treibt den Kurs",
          text: "Neues von {stock}: {reason} Niemand weiß, ob es stimmt, alle kaufen trotzdem. Plus {move}.",
        },
        {
          headline: "Jubel bei {stock}",
          text: "{reason} Die Aktie von {stock} springt um {move}. Der Vorstand öffnet den guten Sekt, den für Besuch.",
        },
      ],
      reasons: [
        "Der Vorstand hat versehentlich etwas richtig gemacht.",
        "Ein Hund hat auf der Hauptversammlung einen Antrag gestellt, und er wurde angenommen.",
        "Angeblich wurde das Rad neu erfunden, diesmal eckig.",
        "Hinter einem Sofa in der Zentrale wurden vergessene Millionen entdeckt.",
        "Die Konkurrenz hat geschlossen Betriebsferien, niemand weiß warum.",
        "Der neue Chef kann lesen, schreiben und rechnen, ein Novum.",
        "Ein Tippfehler in der Bilanz macht aus Verlust Gewinn, niemand will ihn korrigieren.",
        "Die Mitarbeiter haben einen Tag lang wirklich gearbeitet, nur so zum Spaß.",
        "Ein Wahrsager auf dem Jahrmarkt hat der Firma eine goldene Zukunft vorausgesagt.",
        "Das Produkt funktioniert plötzlich, die Ingenieure sind ratlos.",
        "Ein Großinvestor hat die Firma mit einer anderen verwechselt und kräftig gekauft.",
        "Die Kantine hat einen Stern bekommen, mehr brauchte es nicht.",
        "Der Aufsichtsrat hat sich im Fahrstuhl eingeschlossen und kann nichts mehr kaputt machen.",
        "Eine Brieftaube hat einen Großauftrag überbracht.",
        "Im Keller wurde Öl gefunden, es war zwar Salatöl, aber die Stimmung ist prächtig.",
        "Der Praktikant hat aus Versehen ein Patent angemeldet.",
      ],
    },
    stockDown: {
      frames: [
        { headline: "{stock} stürzt ab", text: "{stock} verliert {move}. {reason} Die Anleger nehmen Reißaus." },
        {
          headline: "Panik bei {stock}",
          text: "{reason} Der Kurs von {stock} sackt um {move} ab. Ein Krisenstab tagt.",
        },
        {
          headline: "{stock} im Sinkflug",
          text: "Schlechte Nachrichten von {stock}: {reason} Minus {move}, und der Tag ist noch jung.",
        },
        {
          headline: "Katastrophe bei {stock}",
          text: "{reason} Die Börse straft {stock} mit {move} Minus ab. Der Pressesprecher wurde zuletzt am Flughafen gesehen.",
        },
      ],
      reasons: [
        "Der Chef hat im Interview das eigene Produkt nicht erkannt und es „billigen Schrott“ genannt.",
        "Die Kaffeemaschine ist ausgefallen, die Produktivität sank um neunzig Prozent.",
        "Der gesamte Vorstand ist nach dem Betriebsausflug nicht zurückgekehrt. Letztes Lebenszeichen: ein Foto aus einer Karaoke-Bar.",
        "Durch einen Fehler der Rechtsabteilung hat sich die Firma selbst verklagt und droht zu gewinnen.",
        "Die Buchhaltung hat ein Jahr lang in der falschen Währung gerechnet, nämlich in Gummibärchen.",
        "Das Hauptquartier wurde versehentlich bei einer Kleinanzeige mitverkauft.",
        "Ein Mitarbeiter hat „Allen antworten“ gedrückt. Mit Anhang.",
        "Der Firmenserver stand unter Wasser, weil jemand die Blumen gießen wollte.",
        "Das neue Produkt wurde vorgestellt und sofort wieder eingepackt.",
        "Der Finanzchef hat die Rücklagen in Rubbellose investiert.",
        "Eine Möwe hat das Firmenlogo vom Dach gestohlen, die Aktionäre deuten das als Omen.",
        "Der Sicherheitscode der Tresore lautete 1234 und stand auf einem Zettel am Tresor.",
        "Die Geschäftszahlen wurden mit einem Würfel ermittelt, und selbst der hatte Pech.",
        "Der Chef hat den Jahresbericht als Gedicht vorgetragen. Es reimte sich nicht.",
        "Im Werk wurde drei Wochen lang das falsche Produkt gebaut, niemandem fiel es auf.",
        "Die Firma hat ihren größten Kunden geghostet.",
      ],
    },
    sectorUp: {
      frames: [
        {
          headline: "Die Branche {sector} dreht durch",
          text: "Die ganze Branche {sector} steigt um {move}. {reason} So funktioniert Wirtschaft, liebe Kinder.",
        },
        {
          headline: "Goldrausch in {sector}",
          text: "Plötzlich wollen alle {sector}. {reason} Die Kurse der Branche springen um {move}.",
        },
      ],
      reasons: [
        "Ein Influencer hat das Wort im Vorbeigehen erwähnt, mehr war nicht nötig.",
        "Unsere Experten wissen nicht warum, aber sie nicken sehr überzeugend.",
        "Ein Minister hat die Branche gelobt, er meinte allerdings eine andere.",
        "Eine Zeitung hat sich vertippt, und niemand hat es gemerkt.",
        "Das Horoskop hat es vorhergesagt.",
        "Ein Schulkind hat in einem Referat behauptet, das sei die Zukunft.",
        "Die Konkurrenzbranche hat geschlossen verschlafen.",
        "Angeblich ist das jetzt wieder modern, sagt jemand, der es wissen muss.",
      ],
    },
    sectorDown: {
      frames: [
        {
          headline: "{sector} im freien Fall",
          text: "Die Branche {sector} sackt um {move} ab. {reason} Bis das geklärt ist, verkaufen erst mal alle.",
        },
        {
          headline: "Katerstimmung in {sector}",
          text: "Schlechte Nachrichten für {sector}: {reason} Die Kurse geben um {move} nach.",
        },
      ],
      reasons: [
        "Ein Minister hat die Branche versehentlich mit etwas Verbotenem verwechselt.",
        "Eine Studie zeigt, dass niemand weiß, was die Branche eigentlich macht.",
        "Ein Fernsehmoderator hat schlecht geträumt und es live erzählt.",
        "Die Branchenmesse fand statt, aber niemand ging hin, nicht einmal die Aussteller.",
        "Ein Gerücht aus einem Friseursalon hat die Runde gemacht.",
        "Das wichtigste Fachmagazin hat versehentlich einen Nachruf gedruckt.",
        "Ein Orakel aus dem Frühstücksfernsehen hat den Daumen gesenkt.",
        "Jemand hat laut gefragt, wofür man das eigentlich braucht.",
      ],
    },
    tasksUp: {
      frames: [
        {
          headline: "Auftragsflut im ganzen Land",
          text: "{reason} Alle offenen Firmen-Aufgaben sind ab sofort {move} mehr wert. An die Arbeit, ihr faulen Säcke!",
        },
        {
          headline: "Kunden zahlen jeden Preis",
          text: "{reason} Offene Aufgaben bringen {move} mehr. Wer jetzt Pause macht, ist selbst schuld.",
        },
      ],
      reasons: [
        "Die Kundschaft hat Geld und keine Ahnung, wohin damit.",
        "Eine Massenhysterie sorgt dafür, dass heute jeder alles sofort will.",
        "Der Staat hat versehentlich doppelt ausgezahlt und will es nicht zurück.",
        "Ein Feiertag wurde abgesagt, alle haben Langeweile und Bargeld.",
        "Die Leute haben gemerkt, dass Sparen keinen Spaß macht.",
        "Ein Lottogewinner verteilt Geld in der Fußgängerzone.",
      ],
    },
    tasksDown: {
      frames: [
        {
          headline: "Kunden entdecken das Sparen",
          text: "{reason} Alle offenen Firmen-Aufgaben sind {move} weniger wert. Die Chefs dürfen ruhig ein bisschen schwitzen.",
        },
        {
          headline: "Flaute bei den Aufträgen",
          text: "{reason} Offene Aufgaben bringen {move} weniger. Durchhalten, es wird auch wieder schlechter.",
        },
      ],
      reasons: [
        "Ein Fernsehkoch hat erklärt, man könne Geld auch behalten.",
        "Das halbe Land ist kollektiv im Urlaub, natürlich unbezahlt.",
        "Alle warten auf das Sonderangebot, das nie kommt.",
        "Die Kundschaft hat ihre Geldbeutel verlegt, und zwar alle gleichzeitig.",
        "Ein Sparfuchs hat ein Buch geschrieben, leider ist es gut.",
        "Es regnet, und niemand hat Lust auf irgendwas.",
      ],
    },
    tip: {
      frames: [
        {
          headline: "Mr. Doodle Dangles Geheimtipp",
          text: "Und zum Schluss mein Geheimtipp für alle, die bis jetzt durchgehalten haben: Bei {stock} tut sich in der nächsten Stunde etwas, und zwar {move}. {reason}",
        },
        {
          headline: "Vom Flurfunk: {stock}",
          text: "Ein Vögelchen hat mir gezwitschert: {stock} dürfte in der kommenden Stunde {move} gehen. {reason}",
        },
        {
          headline: "Der heiße Draht: {stock}",
          text: "Aus gewöhnlich gut betrunkenen Kreisen höre ich: {stock} geht bald {move}. {reason}",
        },
      ],
      reasons: [
        "Garantie gibt es keine. Haftung übernehme ich grundsätzlich nie.",
        "Das Vögelchen lag bisher meistens richtig. Meistens.",
        "Wer mir nicht glaubt, ist selbst schuld. Wer mir glaubt, auch.",
        "Bei Verlusten bitte nicht bei mir beschweren, ich bin dann im Urlaub.",
        "Meine Quelle ist seriös, sie trägt immerhin eine Krawatte.",
        "Ich selbst handle nie nach meinen Tipps, aus Gründen.",
      ],
    },
    gossipBad: {
      frames: [
        {
          headline: "{name}: {what}",
          text: "Aus der Abteilung Privatsachen, die uns nichts angehen: {name}. Die Meldung: {what}. {reason} Die Redaktion überweist Schweigegeld und redet trotzdem weiter.",
        },
        {
          headline: "Peinlich, {name}",
          text: "Wir müssen über {name} reden. Stand heute: {what}. {reason} Ein kleines Schmerzensgeld ist unterwegs.",
        },
        {
          headline: "Das Tagebuch von {name}",
          text: "Liebes Tagebuch, schreibt {name} heute vermutlich: {what}. {reason} Wir legen etwas Schmerzensgeld bei.",
        },
        {
          headline: "Fremdschämen mit {name}",
          text: "{what}: Das ist die Tagesbilanz von {name}. {reason} Schmerzensgeld gibt es obendrauf, Würde leider nicht.",
        },
      ],
      reasons: [
        "Was für ein Lappen.",
        "So eine Pfeife sehe ich sonst nur morgens im Spiegel, und ich bin wenigstens im Fernsehen.",
        "Selbst mein Schnurrbart hat mehr Geschäftssinn.",
        "Wir haben in der Redaktion gelacht, bis der Praktikant geweint hat.",
        "Das ist kein Tiefpunkt, das ist ein Lebensstil.",
        "Ich habe schon Topfpflanzen mit mehr Ehrgeiz gegossen.",
        "Bitte einmal kollektiv auslachen, danke.",
        "Manche lernen aus Fehlern. Andere sammeln sie.",
        "Der Tresor zu Hause ist vermutlich auch nur ein Schuhkarton.",
        "Wer so spielt, sollte das Handy sicherheitshalber im Fluss versenken.",
        "Ich sage es ungern, aber ich sage es mit Vergnügen: erbärmlich.",
        "Die Verwandtschaft tut ab heute so, als kenne sie dich nicht.",
        "Hut ab, so konsequent scheitert sonst nur die Bahn.",
        "Ich würde ja helfen, aber dann hätte ich nichts mehr zu lachen.",
      ],
    },
    gossipGood: {
      frames: [
        {
          headline: "Na so was: {name}",
          text: "Ich fasse es nicht, aber es stimmt. {name} meldet: {what}. {reason}",
        },
        {
          headline: "{name} hat es geschafft",
          text: "Gute Nachrichten, ausnahmsweise. Bei {name} heißt es: {what}. {reason}",
        },
        {
          headline: "Applaus für {name}",
          text: "Bitte festhalten: {what}, und zwar bei {name}. {reason}",
        },
      ],
      reasons: [
        "Ich bin fast stolz. Fast.",
        "Auch ein blindes Huhn findet mal ein Korn, aber immerhin.",
        "Glückwunsch, und jetzt bloß nichts anfassen.",
        "Die Konkurrenz darf sich gern ein Beispiel nehmen, ihr Luschen.",
        "Ich hätte keinen Cent darauf gewettet, und ich wette auf alles.",
        "Meine Schwiegermutter hat es vorausgesagt, und die liegt sonst immer falsch.",
        "Dafür gibt es von mir ein ehrliches Schulterklopfen, mit der Faust.",
        "Genieß es, nächste Woche lachen wir wieder über dich.",
        "So, und jetzt alle anderen: Schämt euch.",
        "Das musste auch mal gesagt werden, ich fühle mich schon ganz schmutzig.",
      ],
    },
    nftSale: {
      frames: [
        {
          headline: "{amount} für ein paar Pixel",
          text: "Kunstmarkt, oder was man dafür hält: „{title}“ von {name} ging für {amount} an {buyer}. {reason}",
        },
        {
          headline: "NFT-Wahnsinn um „{title}“",
          text: "{buyer} zahlt {amount} für „{title}“, gemalt von {name}. {reason}",
        },
        {
          headline: "„{title}“ wechselt den Besitzer",
          text: "Aus der Welt der bunten Kästchen: {buyer} hat sich „{title}“ von {name} für {amount} gegönnt. {reason}",
        },
      ],
      reasons: [
        "Mein Enkel malt so etwas mit Fingerfarbe, und der will dafür nur ein Eis.",
        "Früher bekam man dafür ein Haus, heute bekommt man ein Bild von einem Haus.",
        "Ich habe mir das Werk angesehen. Ich habe Fragen. Viele.",
        "Kunst ist, wenn einer zahlt. Glückwunsch an alle Beteiligten.",
        "Der Käufer nennt es eine Wertanlage, sein Bankberater nennt es einen Hilferuf.",
        "Ich verstehe es nicht, also muss es teuer sein.",
        "Wer das kauft, kauft auch Luft in Dosen.",
        "Das Bild hat sechzehn mal sechzehn Pixel. Ich habe nachgezählt, ich hatte Zeit.",
        "Immerhin kann man es nicht fallen lassen.",
        "Die Künstlerseele jubelt, der Geldbeutel des Käufers ruft die Polizei.",
      ],
    },
    ramble: {
      frames: [
        {
          headline: "Mr. Doodle Dangle schweift ab",
          text: "Wo war ich? Egal. {reason} Zurück zu den Nachrichten, falls jemand weiß, wo sie liegen.",
        },
        {
          headline: "Kurze Durchsage in eigener Sache",
          text: "Bevor es weitergeht, etwas völlig anderes: {reason} Das musste raus.",
        },
        {
          headline: "Was ich noch sagen wollte",
          text: "Die Regie winkt, ich ignoriere sie. {reason} So. Weiter im Text.",
        },
      ],
      reasons: [
        "Friedrich Merz soll neulich sein Flugzeug mit Bargeld betankt haben. Sagt der Schwager meines Friseurs.",
        "Markus Söder hat angeblich wieder eine Bratwurst fotografiert. Die Bratwurst wollte anonym bleiben.",
        "Die Deutsche Bahn meldet, mein Zug von gestern komme heute. Ich warte seit Dienstag.",
        "Elon Musk will angeblich den Mond kaufen, um darauf zu parken. Ich habe ihm meinen Stellplatz angeboten.",
        "Mein Nachbar grillt seit drei Tagen dasselbe Würstchen. Ich bewundere seine Geduld.",
        "Christian Lindner soll einen Sportwagen gesehen und kurz geweint haben. Vor Glück, sagt man.",
        "Donald Trump will angeblich Zölle auf Pixel erheben. Ich habe vorsorglich zwei gehortet.",
        "Meine Ex-Frau hat angerufen. Sie will den Schnurrbart zurück. Den bekommt sie nicht.",
        "Der Berliner Flughafen funktioniert inzwischen. Ich traue dem Frieden nicht.",
        "Heidi Klum hat heute leider kein Foto für mich. Ich hatte auch keins bestellt.",
        "Die Butter kostet inzwischen mehr als mein erstes Auto. Das Auto war allerdings ein Fahrrad.",
        "Robert Habeck soll eine Wärmepumpe gestreichelt haben. Die Pumpe schnurrte.",
        "Mein Arzt sagt, ich soll weniger Kaffee trinken. Ich habe den Arzt gewechselt.",
        "Thomas Gottschalk will angeblich mein Wohnzimmer moderieren. Ich habe abgeschlossen.",
        "Dieter Bohlen hat meinen Schnurrbart bewertet. Es reicht nicht für den Recall.",
        "Günther Jauch hat mich angerufen, ich war der Telefonjoker. Ich wusste es nicht.",
        ...NEWS_RAMBLE_EXTRA,
      ],
    },
    rambleInvest: {
      frames: [
        {
          headline: "{person} steigt bei {stock} ein",
          text: "Völlig anderes Thema: {person} soll das Sparschwein geschlachtet und alles in {stock} gesteckt haben. {reason} Der Kurs macht {move} nach oben.",
        },
        {
          headline: "Promi-Alarm bei {stock}",
          text: "Ich habe es aus dritter Hand, also stimmt es: {person} hat angeblich heimlich {stock} gekauft. {reason} Die Anleger rennen hinterher, plus {move}.",
        },
        {
          headline: "Gerücht des Tages: {person} und {stock}",
          text: "Man erzählt sich, {person} habe bei {stock} zugeschlagen. {reason} Ob es stimmt, ist dem Kurs egal: {move} rauf.",
        },
      ],
      reasons: [
        "Quelle: der Schwager meines Friseurs, und der irrt sich nie zweimal am selben Tag.",
        "Eine Bestätigung gibt es nicht, auf meine Brieftaube hat niemand geantwortet.",
        "Ich habe es auf einer Raststätte gehört, zwischen Kaffee und Reue.",
        "Mein Taxifahrer schwört es, und der kennt jemanden, der jemanden kennt.",
        "Dementiert wurde es noch nicht, vermutlich weil niemand gefragt hat.",
        "Falls es nicht stimmt, habe ich es nie gesagt.",
        "Die Info stammt aus einer Gruppe, in die ich versehentlich eingeladen wurde.",
        "Ich habe es geträumt, aber meine Träume sind börsennotiert.",
      ],
    },
    filler: {
      frames: [
        {
          headline: "Heute keine Katastrophen",
          text: "Es ist erschreckend ruhig. {reason} Strengt euch gefälligst an.",
        },
        {
          headline: "Nichts passiert, und das ist die Nachricht",
          text: "{reason} Ich bin persönlich enttäuscht von euch allen.",
        },
      ],
      reasons: [
        "Niemand hat sein Vermögen verzockt, keine Firma brennt.",
        "Kein Skandal, keine Pleite, nicht einmal ein kleiner Betrug.",
        "Die Redaktion hat drei Stunden gesucht und nur eine verlorene Socke gefunden.",
        "Selbst die Gerüchteküche hat heute Ruhetag.",
      ],
    },
  },
  /** Words for a hint's direction ({move} in tip texts). */
  tipWords: { up: "nach oben", down: "nach unten" },
} as const;

export type NewsShowRules = typeof NEWS_SHOW_RULES;
/** A show segment that announces new Nexamon sets (ADR-182). */
export interface NewsShowAnnouncement {
  at: string;
  releaseAt: string;
  sets: readonly { set: string; cardKey: string; mood: string; headline: string; text: string }[];
}
export type NewsShowTextKey = keyof typeof NEWS_SHOW_RULES.texts;
