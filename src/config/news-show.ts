/*
 * NEXA Nachrichten (ADR-150): once an hour, at the full hour, Mr. Doodle Dangle reads the news live. Every show
 * has a handful of segments with real effects: players who lost money get roasted (and a small consolation), a
 * player's company has a scandal or a hype, stocks and whole sectors jump, open company tasks get more or less
 * valuable, and the show ends with a hint for the coming hour. The server decides the effects; the texts below are
 * the Mini-KI's scripts (Claude rewrites them per company when a key is set, edge function news-anchor).
 * Placeholders: {name} player, {amount}, {pct}, {company}, {idea}, {founder}, {stock}, {sector}, {move}.
 * The humour is harsh on purpose, but only about what happened in the game: lost play money, flopped companies.
 */
export const NEWS_SHOW_RULES = {
  /** The draft of a show is written this long before it airs (time for Claude to polish it). */
  prepareMinutes: 10,
  introSeconds: 8,
  segmentSeconds: 22,
  outroSeconds: 6,
  /** Typewriter speed of the anchor's speech bubble. */
  charsPerSecond: 28,
  maxSegments: 7,
  /**
   * A show only happens when a real player watches: it starts when the first viewer is in the stream, at the full
   * hour or up to this long after it; without viewers it is cancelled and nothing happens.
   */
  waitMinutes: 10,
  /** The last show can be watched again this long. */
  replayMinutes: 55,
  /** The News tab is marked this long before the show. */
  teaserMinutes: 5,
  chat: {
    maxLength: 200,
    perMinute: 10,
    history: 60,
    keepHours: 24,
    emojis: ["😂", "💀", "🔥", "📉", "📈", "🤡", "👏", "😱", "🍿", "💸", "🚀", "😭"],
  },
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
  stock: { count: 2, minBps: 600, maxBps: 1_800 },
  /** A whole sector moves. */
  sector: { minBps: 400, maxBps: 1_000 },
  /** Open company tasks of every company get more or less valuable. */
  tasks: { minBps: 2_000, maxBps: 4_000 },
  /** Mr. Doodle Dangle's hint: a stock that probably moves in the coming hour (like the stock hints, ADR-119). */
  tip: { leadMinMinutes: 15, leadMaxMinutes: 45, minBps: 500, maxBps: 1_500, reliabilityBps: 7_000 },
  /**
   * Scripts of the Mini-KI as a construction kit: every kind has frames (headline and text) and a pool of reasons
   * ({reason}). A show picks the combination that was used longest ago (news_show_used), so with a few frames and
   * many reasons nothing repeats for hundreds of shows.
   */
  texts: {
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
export type NewsShowTextKey = keyof typeof NEWS_SHOW_RULES.texts;
