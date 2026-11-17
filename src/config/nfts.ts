/*
 * NFTs (ADR-135): the pixel artworks of ADR-080, now called NFTs. Creators earn a royalty on every resale, AI
 * collectors buy listed NFTs only at a fair price and write lowball offers, every NFT has an offer chat.
 * Tables and RPCs keep the "artwork" names. Texts in messages/de.json ("art"); the AI lines below are short German
 * chat messages shown as they are.
 */
export const NFT_RULES = {
  /** Every resale (seller is not the creator) pays the creator this share of the price, out of the proceeds. */
  royaltyBps: 1_000,
  /** XP for minting an NFT (before the alpha multiplier). */
  mintXp: 100,
  /** A fixed price ("Sofort kaufen") and an offer in the chat need at least this much. */
  minAskCents: 10_000,
  minOfferCents: 10_000,
  chat: {
    maxLength: 200,
    /** At most this many messages per player and minute (all NFTs together). */
    perMinute: 6,
    /** The chat shows the latest messages. */
    history: 60,
    /** An offer is open this long, then it expires. */
    offerHours: 24,
  },
  /**
   * Art quality (ADR-181): a critic's score 0..100 from the pixel grid, computed once by the server when an NFT is
   * minted (src/lib/sim/art-quality.ts, the same in SQL: public.art_quality). Sub-scores 0..100, weighted.
   */
  quality: {
    /** Below this share of drawn pixels (percent) the coverage score falls linearly. */
    coverageMinPct: 15,
    /** One value (a colour or empty) covering more than this percent of the grid caps coverage at (100 - share) x 10. */
    dominanceMaxPct: 90,
    /** Score by number of distinct colours used (index = count, 16 and more use the last entry). */
    colourScores: [0, 20, 55, 80, 100, 100, 100, 100, 100, 90, 85, 80, 75, 70, 65, 60, 55],
    /** A colour on less than this percent of the drawn pixels is a stray; each costs this many points. */
    strayPct: 1,
    strayPenalty: 8,
    /** Colours with saturation and value of at least this (percent) count for harmony; hues in 30-degree buckets. */
    chromaMinPct: 20,
    /** Up to this many hue buckets are harmonious; each further one costs huePenalty, down to hueFloor. */
    hueBuckets: 3,
    huePenalty: 14,
    hueFloor: 20,
    /** Luminance range (0..255) that gives full contrast. */
    contrastFull: 160,
    /** Isolated pixels (no same-coloured neighbour) up to this percent are fine, then -2 per percent. */
    noiseFreePct: 5,
    /** Regions (same-coloured, connected) per 100 drawn pixels up to this are fine, then -2 per step. */
    fragmentFreePct: 10,
    /** Edge transitions per mille of neighbour pairs: below detailMin the score falls, above detailMax as well. */
    detailMin: 40,
    detailMax: 350,
    /** Percent of drawn pixels inside solid shapes (3+ same-coloured neighbours) for full shape score. */
    shapeFullPct: 40,
    /** Centre of mass within this percent of the middle is balanced, then -3 per percent. */
    balanceFreePct: 10,
    /** Near-copy: at most this percent of the pixels differ from an older NFT (after recolouring). */
    nearCopyPct: 2,
    /** Copies are capped at these scores. */
    copyCap: 5,
    nearCopyCap: 15,
    /** Without coverage, colours or detail it is no picture: the score x (gateBase + gate x (100 - gateBase) / 100). */
    gateBase: 30,
    weights: {
      coverage: 10,
      colours: 12,
      harmony: 12,
      contrast: 10,
      structure: 16,
      outline: 8,
      composition: 10,
      detail: 10,
      shapes: 12,
    },
  },
  /** AI collectors (households money; what they pay comes back to the households when they resell). */
  ai: {
    /** What a collector thinks an NFT is worth: anchor x (1 + bonuses). Anchor = max(last price, mint cost, floor). */
    floorCents: 100_000,
    likeBps: 400,
    maxLikes: 40,
    /** Reputation: per earlier sale of an NFT by the same creator. */
    creatorSaleBps: 300,
    maxCreatorSales: 10,
    /** Vintage: per day since minting. */
    ageBpsPerDay: 100,
    maxAgeDays: 30,
    /** Per minute: a listing at or below the valuation is bought with this chance. */
    buyChanceBps: 2_500,
    /** Per minute and NFT: a collector writes a lowball offer (listing above the value, or not for sale). */
    listedOfferChanceBps: 1_500,
    unlistedOfferChanceBps: 400,
    /** Several collectors may bid on the same NFT at once, each with one open offer (ADR-163). */
    maxOpenAiOffers: 3,
    /** Lowball offers: this share of the valuation, rounded down to whole euros. */
    lowballMinBps: 6_500,
    lowballMaxBps: 9_000,
    /**
     * At most this many purchases from players by all collectors per Berlin day and per hour (ADR-170: spread over
     * the day instead of all in the morning), and this many AI messages per minute.
     */
    maxBuysPerDay: 100,
    maxBuysPerHour: 6,
    maxMessagesPerRun: 10,
    /** What all collectors together pay players per Berlin day at most (purchases, auctions; ADR-170). */
    budgetCentsPerDay: 30_000_000,
    /** A collector's offer is open this long (ADR-170; players' offers keep chat.offerHours), then a new one comes. */
    offerHours: 2,
    /**
     * Collectors bid in auctions (ADR-170): per minute and auction with this chance, the minimum bid, only while it is
     * at most their valuation; at most this many bids per minute.
     */
    auction: { bidChanceBps: 1_000, maxBidsPerRun: 3 },
    /** An NFT the AI holds is offered for its valuation x this. */
    resaleMarkupBps: 12_500,
    /** The AI accepts a player's offer on an NFT it holds from this share of its valuation. */
    acceptBps: 10_500,
    /**
     * Demand (ADR-141): open offers and recent sales make an NFT hot; the collectors then value it higher
     * (on top of likes) and want it more often.
     */
    demand: {
      offerBps: 600,
      maxOffers: 6,
      saleBps: 500,
      maxSales: 6,
      /** Sales of the last this many days count. */
      days: 7,
    },
    /**
     * The collectors trade among themselves (ADR-141): per minute and NFT a collector holds, another one buys it with
     * a chance that grows with popularity. The price follows the buyer's taste around the fair value (mint cost x
     * bonuses, not the last price) and moves only part of the way from the last price, so prices wander up and down
     * instead of climbing for ever. The buyer offers it again at its markup.
     */
    trade: {
      chanceBps: 250,
      /** Popularity raises the chance: per like, per open offer, per recent sale (bps of the base chance). */
      likeWeightBps: 1_500,
      offerWeightBps: 4_000,
      saleWeightBps: 2_500,
      maxChanceBps: 4_000,
      /** A collector keeps a new NFT at least this long. */
      minHoldMinutes: 10,
      perRun: 6,
      /** ADR-170: an hourly cap keeps the trading going all day (before, the day cap was reached by the afternoon). */
      perHour: 24,
      perDay: 480,
      /** Taste of the buying collector: fair value x 85 % .. 125 %. */
      tasteMinBps: 8_500,
      tasteMaxBps: 12_500,
      /** The price moves this share of the way from the last price to the buyer's target. */
      reversionBps: 5_000,
    },
    /**
     * Art quality (ADR-181) steers the collectors. Factor = min + (max - min) x score / 100 (score 50 = x 1.0):
     * value on the mint cost / floor anchor (never on the last price, so it does not compound), chance of offers,
     * purchases and trades among collectors. Below noInterestBelow nobody bids; lowball offers shift by
     * (score - 50) / 50 x lowballShiftBps.
     */
    quality: {
      neutral: 50,
      valueMinBps: 6_000,
      valueMaxBps: 14_000,
      chanceMinBps: 2_000,
      chanceMaxBps: 20_000,
      noInterestBelow: 10,
      lowballShiftBps: 1_500,
      /** Offer texts: mocking below, praise from; comments on a sub-score from goodFrom / below badBelow. */
      mockBelow: 35,
      praiseFrom: 75,
      goodFrom: 85,
      badBelow: 45,
    },
    /**
     * Chat (ADR-181): collectors answer players' messages (after replyDelayMinutes, while the message is at most
     * replyWindowMinutes old) when they took part in the chat in the last memoryHours or hold the NFT; they nudge the
     * owner when an offer is ignored, haggle (a "more" from the owner raises the offer by counterStepBps up to
     * counterCeilingBps of the valuation) and never repeat one of the last recentLines lines of the chat.
     * Intents: keywords (whole words, lower case), checked in this order.
     */
    talk: {
      replyDelayMinutes: 1,
      replyWindowMinutes: 30,
      memoryHours: 6,
      maxRepliesPerRun: 8,
      followupMinutes: 30,
      followupChanceBps: 3_000,
      maxFollowupsPerRun: 4,
      counterStepBps: 800,
      counterCeilingBps: 9_500,
      personaChanceBps: 2_500,
      recentLines: 6,
      intentOrder: ["insult", "higher", "lower", "no", "yes", "question"],
      intents: {
        insult: [
          "idiot",
          "blöd",
          "doof",
          "dumm",
          "depp",
          "trottel",
          "lächerlich",
          "unverschämt",
          "halt die klappe",
          "verpiss",
          "penner",
          "spinner",
        ],
        higher: [
          "mehr",
          "höher",
          "zu wenig",
          "zu niedrig",
          "drauflegen",
          "erhöhen",
          "nachlegen",
          "besseres angebot",
          "aufstocken",
          "legen sie was drauf",
          "leg was drauf",
        ],
        lower: ["weniger", "billiger", "günstiger", "rabatt", "nachlass", "zu teuer", "runter", "preis senken"],
        no: ["nein", "nö", "nee", "ne", "niemals", "nope", "vergiss es", "kein interesse", "auf keinen fall", "no"],
        yes: [
          "ja",
          "jo",
          "jap",
          "ok",
          "okay",
          "deal",
          "gerne",
          "gern",
          "einverstanden",
          "abgemacht",
          "klar",
          "passt",
          "yes",
        ],
        question: ["?", "warum", "wieso", "weshalb", "wer", "was", "wie", "wann", "wo"],
      },
      lines: {
        praise: [
          "Das ist kein NFT, das ist ein Fenster in eine bessere Welt. Mein Angebot.",
          "Ich habe beim Anschauen spontan Gänsehaut bekommen. Oder es zieht. Egal, ich biete.",
          "Endlich mal Pixel mit Haltung. Nimm mein Geld.",
          "Meine Augen bedanken sich persönlich bei dir. Hier ein Angebot.",
          "Das gehört ins Museum. Oder in mein Wohnzimmer, das ist fast dasselbe.",
          "Wer hat dir so malen beigebracht? Ich will auch so ein Gehirn.",
          "Ich habe es meiner Oma gezeigt. Sie hat ihr Testament geändert. Angebot!",
          "Jeder Pixel sitzt. Das ist seltener als ein pünktlicher Zug.",
          "So etwas sieht man nicht alle Tage. Eigentlich nie. Ich biete ordentlich.",
          "Ich musste kurz sitzen. So schön ist das.",
          "Das Bild hat mehr Charakter als mein Schwager. Mein Angebot.",
          "Wenn das nicht in meine Sammlung kommt, kann ich nachts nicht schlafen.",
          "Ich nenne das ab sofort mein Lieblingsbild. Sorry, Mona Lisa.",
          "Das ist so gut, ich biete freiwillig mehr. Sag es keinem.",
        ],
        mock: [
          "Sind das Pixel oder ein Unfall? Ich biete trotzdem was, aus Mitleid.",
          "Mein Toaster hat beim Toasten ein schöneres Muster gemacht. Kleines Angebot.",
          "Ich glaube, dein Bildschirm hat geniest. Ich zahle für das Taschentuch.",
          "Das sieht aus wie ein Tastaturtest. Ich biete wenig, aber mit Herz.",
          "Mutig! Sehr mutig. Zu mutig für viel Geld.",
          "Hat das deine Katze gemalt? Grüß sie, ich biete ihr ein Leckerli.",
          "Ich habe es umgedreht. Wurde nicht besser. Angebot steht trotzdem.",
          "Abstrakt, sagst du? Ich sage: Restposten.",
          "Ich nehme es als Untersetzer. Dafür reicht mein Angebot.",
          "Ich hatte heute einen schlechten Tag. Jetzt hatte ich einen schlechteren. Ein kleines Angebot.",
          "Das ist Kunst. Wahrscheinlich. Vielleicht. Wenig Geld dafür.",
          "Mein Optiker will das Bild als Sehtest. Mehr ist es mir nicht wert.",
          "Wenn ich die Augen zusammenkneife, sieht es fast nach etwas aus. Fast.",
          "Ich biete das. Die Pixel sollen sich ja nicht einsam fühlen.",
        ],
        copy: [
          "Moment mal. Das habe ich doch schon irgendwo gesehen. Fast genauso. Kleines Angebot.",
          "Ein Original ist es nicht, aber ein sehr fleißiges Abbild. Ich biete wenig.",
          "Kopieren ist auch eine Kunst. Eine billige. Mein Angebot.",
          "Ich hatte ein Déjà-vu. Dann habe ich das Original gefunden. Angebot trotzdem.",
          "Strg+C, Strg+V, Strg+Gewinn? Nicht mit mir. Aber ein kleines Angebot.",
          "Das zweite Mal ist es nur halb so aufregend. Halber Preis.",
        ],
        good: {
          coverage: [
            "Die Fläche ist perfekt genutzt. Kein Pixel zu viel, keiner zu wenig.",
            "Wunderbar gefüllt, ohne vollgestopft zu sein. Respekt.",
          ],
          colours: [
            "Diese Farbauswahl! Da hat jemand nachgedacht.",
            "Genau die richtige Zahl an Farben. Kein Farbeimer-Unfall.",
          ],
          harmony: ["Diese Farbpalette ist ein Gedicht.", "Die Farben vertragen sich besser als meine Verwandtschaft."],
          contrast: ["Der Kontrast knallt, ohne zu schreien. Chef’s Kiss.", "Hell und Dunkel tanzen hier Walzer."],
          structure: [
            "So sauber gezeichnet, da könnte man vom Bild essen.",
            "Kein einziger verirrter Pixel. Ich bin beeindruckt.",
          ],
          outline: ["Diese Konturen! Gestochen scharf.", "Die Umrisse sitzen wie ein Maßanzug."],
          composition: [
            "Die Komposition ist perfekt ausbalanciert. Feng-Shui für die Augen.",
            "Alles steht genau da, wo es hingehört.",
          ],
          detail: [
            "So viele kleine Details, ich entdecke immer noch neue.",
            "Detailverliebt bis in den letzten Pixel.",
          ],
          shapes: [
            "Klare Formen, sofort erkennbar. So muss das.",
            "Die Formen sind so deutlich, sogar mein Opa erkennt sie ohne Brille.",
          ],
        },
        bad: {
          coverage: [
            "Da ist ja kaum was drauf. Hast du das Bild im Dunkeln gemalt?",
            "Viel Platz, wenig Bild. Wie mein Kühlschrank.",
          ],
          colours: ["Eine Farbe? Mutig. Oder sparsam. Oder beides.", "So viele Farben, da wird mir schwindelig."],
          harmony: [
            "Die Farben streiten sich hörbar. Ich höre es bis hier.",
            "Diese Farbkombination sollte verboten werden. Ich biete trotzdem.",
          ],
          contrast: ["Alles so ähnlich hell, ich suche noch das Motiv.", "Mehr Kontrast hat mein Nebel im Badezimmer."],
          structure: [
            "So viele einzelne Pixel, ist das Kunst oder Pfeffer?",
            "Da sind Krümel auf dem Bild. Ach, das sind Pixel.",
          ],
          outline: [
            "Ein paar Konturen hätten nicht geschadet. Alles verschwimmt.",
            "Wo hört das Ding auf und wo fängt der Rest an?",
          ],
          composition: [
            "Alles hängt in einer Ecke. Ist das Bild umgekippt?",
            "Das Bild hat Schlagseite. Ich halte mich fest.",
          ],
          detail: [
            "Etwas wenig los auf dem Bild. Ich habe kurz geschlafen.",
            "Das ist so unruhig, meine Augen haben gekündigt.",
          ],
          shapes: [
            "Ich erkenne keine Form. Ist das ein Hund? Ein Haus? Ein Gefühl?",
            "Mehr Gekritzel als Gestalt. Aber charmant.",
          ],
        },
        followup: [
          "Hallo? Mein Angebot steht noch. Ich warte. Geduldig. Fast.",
          "Ich sehe, du hast mein Angebot gelesen. Oder nicht? Huhu!",
          "Kleine Erinnerung: Mein Angebot wird nicht jünger. Ich auch nicht.",
          "Ich habe extra einen Tee gekocht, um auf deine Antwort zu warten. Er ist jetzt kalt.",
          "Klopf, klopf. Wer ist da? Mein Angebot.",
          "Falls du schläfst: Mein Angebot schläft nicht.",
          "Ich starre seit einer halben Stunde auf den Chat. Meine Familie macht sich Sorgen.",
          "Schweigen ist Gold, aber mein Angebot ist Geld.",
          "Ich habe mein Angebot nochmal angeschaut. Es ist immer noch gut. Nur so.",
          "Bist du noch da? Blinzle zweimal, wenn du verkaufen willst.",
          "Mein Angebot läuft bald ab. Wie meine Milch. Bitte entscheide dich vor der Milch.",
          "Ich warte noch. Hab schon das Regal freigeräumt.",
        ],
        counter: [
          "Na gut, na gut. Ich lege etwas drauf. Aber nur, weil heute Dienstag ist. Oder so.",
          "Du verhandelst hart. Ich mag das. Neues Angebot.",
          "Mein Portemonnaie weint, aber hier: etwas mehr.",
          "Okay, ich erhöhe. Erzähl es nicht Baron von Bit.",
          "Für dich lege ich nach. Meine Katze bekommt diese Woche nur Trockenfutter.",
          "Ein letzter Schritt nach oben. Ich habe Höhenangst.",
          "Du bist gut. Hier, mehr Geld. Aber dann ist Schluss. Wahrscheinlich.",
          "Ich habe nochmal nachgezählt und noch ein paar Münzen im Sofa gefunden.",
          "Gegenangebot! Ich fühle mich wie ein echter Händler.",
          "Ich erhöhe, weil das Bild mich so treuherzig anschaut.",
        ],
        final: [
          "Mehr geht wirklich nicht. Sonst muss ich mein Sofa verkaufen.",
          "Das ist mein letztes Wort. Und mein vorletztes auch.",
          "Höher gehe ich nicht. Ich habe Höhenangst, das sagte ich doch.",
          "Mein Limit ist erreicht. Mein Bankberater hat mich blockiert.",
          "Nein, mehr ist nicht drin. Nimm es oder lass es, aber nimm es.",
          "Ich bin bei meinem Maximum. Ab hier zahlen nur noch Träume.",
        ],
        reply: {
          yes: [
            "Wunderbar! Dann klick auf Annehmen, bevor ich wieder vernünftig werde.",
            "Ja? Ja! Dann drück den Knopf und es gehört mir.",
            "Ich wusste, wir verstehen uns. Annehmen und fertig.",
            "Herrlich. Ich halte den Rahmen schon bereit.",
            "Abgemacht? Dann nimm mein Angebot an. Ich tanze schon.",
            "Super, ich warte nur noch auf deinen Klick.",
          ],
          no: [
            "Nein? Das tut weh. Aber ich komme wieder.",
            "Schade. Ich weine kurz in mein Kissen und biete dann wieder.",
            "Ein Nein ist nur ein Ja, das noch nicht weiß, dass es eins ist.",
            "Okay, okay. Ich lasse das Angebot trotzdem liegen. Nur für alle Fälle.",
            "Nein ist auch eine Antwort. Eine falsche, aber eine Antwort.",
            "Verstanden. Ich bin nicht beleidigt. Nur ein bisschen. Sehr.",
          ],
          higher: [
            "Mehr? Ich bin Sammler, kein Goldesel.",
            "Du willst mehr? Ich will auch mehr. Wir haben so viel gemeinsam.",
            "Mehr Geld? Hm. Ich denke darüber nach. Langsam.",
            "Höher? Ich muss erst meine Sparschweine befragen.",
            "Für mehr Geld müsste das Bild auch tanzen können.",
            "Du klingst wie mein Vermieter. Ich überlege es mir.",
          ],
          lower: [
            "Du willst weniger Geld? Du bist der netteste Mensch im ganzen Chat.",
            "Billiger? Gern, ich bin immer für Rabatt zu haben.",
            "Weniger? Ich lehne das nicht ab. Ich bin ja nicht verrückt.",
            "Rabatt? Ich mag dich jetzt noch mehr.",
            "Wenn du es mir billiger gibst, schreibe ich dir ein Gedicht. Ein kurzes.",
          ],
          insult: [
            "Autsch. Ich bin Sammler, kein Sandsack. Mein Angebot bleibt trotzdem.",
            "Na, na, na. Wir reden hier über Kunst, nicht über mich.",
            "Ich ignoriere das, weil ich höflich bin. Und weil ich das Bild will.",
            "So spricht man nicht mit seinem besten Kunden.",
            "Ich habe das nicht gelesen. Wirklich nicht. Mein Angebot steht.",
            "Hart, aber ich bin härter. Na gut, ich bin weich. Aber das Angebot steht.",
          ],
          question: [
            "Gute Frage. Die Antwort ist: Ich mag das Bild. Und Geld habe ich auch.",
            "Warum? Weil Kunst. Und weil mein Wohnzimmer leer ist.",
            "Frag mich lieber, warum ich so gut aussehe. Ach, das war nicht die Frage.",
            "Das weiß niemand genau. Nicht mal ich. Aber mein Angebot ist ernst.",
            "Ich beantworte Fragen nur gegen Kunst. Verkauf mir das Bild, dann erkläre ich alles.",
            "Hm, darüber muss ich nachdenken. Bis morgen. Oder übermorgen.",
            "Meine Antwort: ein klares Vielleicht.",
            "Das fragt mich meine Mutter auch immer. Antwort: weil ich es kann.",
          ],
          other: [
            "Interessant. Ich nicke verständnisvoll und biete weiter.",
            "Ich habe das gelesen und für sehr klug befunden.",
            "Spannend. Ich schreibe es mir auf. Auf eine Serviette.",
            "Ich verstehe. Also nicht ganz. Aber ich tu so.",
            "Haha, du bist ja witzig. Verkauf mir trotzdem das Bild.",
            "Notiert. Mein Papagei hat es auch gehört.",
            "Wie auch immer: Das Bild ist toll und ich bin reich. Fast.",
            "Ich mag, wie du schreibst. Fast so sehr wie dein Bild.",
          ],
        },
      },
      /** Each collector's own catchphrases, used now and then instead of the general line. */
      personas: {
        "Vera Vermeer": [
          "Als Kennerin sage ich: Das Licht! Wo ist das Licht? Ach, da. Angebot.",
          "Ich sammle seit 1987. Damals hatten Pixel noch Manieren.",
          "Vera Vermeer bietet nie zweimal. Heute schon. Ausnahme.",
        ],
        "Konrad Kollektor": [
          "Ich habe 4.000 Bilder und keine Wand mehr. Egal, ich biete.",
          "Konrad hier. Ich katalogisiere das unter: haben wollen.",
          "In meiner Excel-Tabelle ist noch eine Zeile frei. Für dich.",
        ],
        "Pixel-Paula": [
          "Paula findet: mehr Pixel, mehr Liebe. Hier mein Angebot.",
          "Ich zähle jeden Pixel einzeln. Es dauert. Es lohnt sich.",
          "Pixel-Paula ist begeistert. Das passiert nur bei Vollmond.",
        ],
        "Baron von Bit": [
          "Der Baron gestattet sich ein Angebot. Seien Sie geehrt.",
          "In meinem Schloss ist noch ein Platz neben dem Rittersaal-Router frei.",
          "Ein Baron feilscht nicht. Er verhandelt majestätisch.",
        ],
        "Mia Mosaik": [
          "Mia hier. Ich setze dein Bild in mein großes Mosaik. Stück für Stück.",
          "Ich sehe das Bild schon als Teil von etwas Größerem. Angebot!",
          "Kleine Kacheln, große Gefühle. Ich biete.",
        ],
        "Otto Original": [
          "Otto sammelt nur Originale. Ich hoffe, das ist eins.",
          "Ich habe einen Echtheitsdetektor. Er piept. Das ist gut, oder?",
          "Otto Original bietet original. Wortspiel beabsichtigt.",
        ],
        "Gräfin Glitzer": [
          "Darling, das funkelt nicht genug. Ich biete trotzdem.",
          "Die Gräfin wünscht dieses Bild. Mit Glitzer, wenn möglich.",
          "Ich hänge es in den Ballsaal. Gleich neben die Diskokugel.",
        ],
        "Sammler Sam": [
          "Sam hier. Ich war schon wieder zu langsam. Diesmal nicht!",
          "Sammler Sam sammelt. Das ist mein Job. Und mein Hobby. Und mein Problem.",
          "Ich habe ein Bauchgefühl. Es knurrt. Das heißt: kaufen.",
        ],
      },
    },
    collectors: [
      "Vera Vermeer",
      "Konrad Kollektor",
      "Pixel-Paula",
      "Baron von Bit",
      "Mia Mosaik",
      "Otto Original",
      "Gräfin Glitzer",
      "Sammler Sam",
    ],
    lines: {
      offer: [
        "Schönes Stück. Mehr ist es mir aber nicht wert.",
        "Für meine Sammlung würde ich so viel zahlen.",
        "Mein Angebot. Überleg es dir nicht zu lange.",
        "Hübsch! Wäre das ein fairer Preis?",
        "Ich biete das. Nimm es, solange ich gute Laune habe.",
        "Mein Hund hat draufgebellt. Das heißt bei uns: kaufen.",
        "Ich habe keine Ahnung, was das sein soll. Ich nehme es.",
        "Meine Mutter sagt, ich soll aufhören, Pixel zu kaufen. Hier mein Angebot.",
        "Ich wollte eigentlich Brot kaufen. Jetzt bin ich hier.",
        "Das hängt später über meinem Klo. Ehrenplatz.",
        "Mehr habe ich nicht, den Rest hat mein Wellensittich verzockt.",
        "Ist das Kunst oder ist dein Bildschirm kaputt? Egal, Angebot steht.",
        "Ich biete das und lege ein halbes Käsebrot drauf.",
        "Mein Horoskop sagt: heute teuer einkaufen. Bitte sehr.",
        "Ich habe das Bild meinem Zahnarzt gezeigt. Er hat geweint. Ich biete.",
        "Angebot! Bitte schnell, mein Akku hat noch drei Prozent.",
        "Ich sammle nur Dinge, die ich nicht verstehe. Passt perfekt.",
        "Dafür verkaufe ich mein Fahrrad. Na gut, den Sattel.",
        "Wusstest du, dass Otter Händchen halten? Jedenfalls: mein Angebot.",
        "Ich habe gewürfelt. Das ist der Preis. Die Würfel lügen nicht.",
        "Mein Steuerberater ist ohnmächtig geworden, also muss es gut sein.",
        "Das erinnert mich an meinen Ex. Ich will es trotzdem.",
        "Ich zahle in Spielgeld, weil ich nichts anderes habe.",
        "Letztes Angebot. Also das erste. Aber auch das letzte. Vielleicht.",
        "Ich kaufe das nur, damit Baron von Bit es nicht bekommt.",
        "So viel für so wenige Pixel? Ich liebe es.",
        "Meine Wand ist leer und mein Kopf auch. Nimm mein Geld.",
        "Ich habe eine Lasagne im Ofen, bitte entscheide dich fix.",
        "Das sieht aus wie mein Kontostand: wild. Angebot.",
        "Ich habe mich verklickt, aber jetzt ziehe ich es durch.",
      ],
      buy: [
        "Gekauft! Das kommt in meine Sammlung.",
        "Zu diesem Preis konnte ich nicht widerstehen.",
        "Ein fairer Preis. Danke!",
        "Gekauft. Fragt mich nicht, warum.",
        "Meins! Jetzt muss ich nur noch herausfinden, was es ist.",
        "Gekauft, bevor mein Verstand wach wird.",
        "Das kommt neben den Toaster. Da ist das Licht am besten.",
        "Ich habe es. Meine Erben werden mich hassen.",
        "Zack, gekauft. Miete wird überbewertet.",
        "Endlich etwas, das ich meiner Katze vererben kann.",
        "Gekauft! Ich schreibe es als Arbeitskleidung ab.",
        "Schnäppchen. Sagt jedenfalls die Stimme in meinem Kühlschrank.",
        "Ich wollte nur gucken. Tja.",
        "Gekauft. Der Pizzabote kann warten.",
      ],
      accept: [
        "Abgemacht! Viel Freude damit.",
        "Einverstanden, es gehört dir.",
        "Deal. Bitte nicht in der Sonne lagern.",
        "Nimm es, bevor ich es mir anders überlege.",
        "Verkauft! Ich brauche das Geld für Gartenzwerge.",
        "Na gut. Aber du musst es jeden Tag anschauen. Versprich es.",
        "Einverstanden. Es hat mich nachts sowieso angestarrt.",
        "Deal! Grüß deine Oma von mir.",
        "Okay, okay. Du verhandelst wie mein Schwager.",
        "Abgemacht. Der Rahmen kostet extra. Es gibt keinen Rahmen.",
      ],
      trade: [
        "Endlich gehört es mir! Das wollte ich schon lange.",
        "Ich musste es einfach haben.",
        "Gekauft von einer Kollegin. Jetzt steht es zum Verkauf, wer bietet mehr?",
        "Ein Schnäppchen unter Sammlern.",
        "Das Stück ist gefragt. Ich habe zugeschlagen.",
        "Ich habe es Otto Original abgeluchst. Er weint jetzt in sein Müsli.",
        "Getauscht gegen ein Geheimnis und etwas Bargeld.",
        "Gekauft beim Sammlerstammtisch. Es gab Mettbrötchen.",
        "Ich weiß nicht, wem ich es abgekauft habe. Er trug einen Umhang.",
        "Meins. Die anderen Sammler können sich gehackt legen.",
        "Frisch erworben und schon wieder im Angebot. So bin ich.",
        "Ich habe es im Tausch gegen meinen guten Ruf bekommen.",
        "Sammler Sam wollte es auch. Sammler Sam war zu langsam.",
        "Gekauft, dreimal angeschaut, gelangweilt. Wer will?",
        "Das hing eben noch bei Gräfin Glitzer. Jetzt nicht mehr. Ha!",
      ],
      decline: [
        "Nein danke, darunter verkaufe ich nicht.",
        "Netter Versuch. Biete mehr.",
        "Das ist zu wenig für dieses Stück.",
        "Dafür bekommst du bei mir höchstens ein Foto vom Bild.",
        "Hahaha. Nein.",
        "Für den Preis male ich dir ein Strichmännchen. Ein schlechtes.",
        "Mein Goldfisch bietet mehr, und der hat kein Konto.",
        "Zu wenig. Ich habe schließlich eine Yacht aus Pappe zu unterhalten.",
        "Nein. Und meine Katze sagt auch nein.",
        "Bei dem Angebot ist mir kurz schwarz vor Augen geworden.",
        "Ich frage kurz meinen Anwalt. Er lacht noch.",
        "Leg eine Null dran, dann reden wir. Hinten, nicht vorne.",
        "Das ist kein Angebot, das ist eine Beleidigung mit Komma.",
        "Nö. Aber danke, dass du an mich gedacht hast.",
        "Ich verkaufe nicht unter Wert. Außer montags. Heute ist nicht Montag. Glaube ich.",
      ],
    },
  },
} as const;
