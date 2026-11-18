/*
 * NEXA Nachrichten, topics (ADR-169): many more stories for Mr. Doodle Dangle. A topic is a script of its own
 * (frames and reasons like every other script of the show) plus where it belongs: its group (collectibles,
 * Finanzamt, listed companies, a person, odd bits), the kind of segment the studio shows, a weight for the draw and
 * the placeholders its texts may use. The server (news_show_topics) and the demo fill the placeholders from what
 * really happened; topics without placeholders need no data and keep a show alive on a quiet server.
 *
 * Limits for every text (non-negotiable): players are only teased for what they did in the game. Nothing about
 * origin, religion, gender, sexuality, disability or the looks of real people, no slurs, nothing sexual, no
 * self-harm, no violence against real people, no real tragedies. Invented people and institutions only (Oberamtsrat
 * Griesgram of the Finanzamt Nexa-Mitte is one of them); real public figures stay in the "ramble" script.
 * Season three (ADR-210) adds the topics of news-topics-fresh.ts: Weltkarte, events from outside, Talente, clones,
 * toplists and more.
 * Pure data (part of BALANCE).
 */
import { NEWS_TOPIC_GROUPS_FRESH, NEWS_TOPICS_FRESH } from "./news-topics-fresh.ts";

export const NEWS_TOPIC_GROUPS = ["cards", "tax", "corp", "person", "odd", ...NEWS_TOPIC_GROUPS_FRESH] as const;

const NEWS_TOPICS_BASE = {
  // ------------------------------------------------------------------ collectibles (Nexamon, ADR-165)
  cardPull: {
    group: "cards",
    kind: "cards",
    weight: 12,
    tone: "good",
    slots: ["name", "card", "rarity", "set", "packs"],
    moods: ["shocked", "proud", "smug"],
    frames: [
      {
        headline: "{name} zieht {card}",
        text: "Aus der Welt der bedruckten Pappe: {name} hat aus {set} die Karte {card} gezogen, Seltenheit {rarity}, und brauchte dafür heute {packs} Booster. {reason}",
      },
      {
        headline: "Pappe des Tages: {card}",
        text: "{name} reißt heute {packs} Booster auf und hält plötzlich {card} in der Hand, Seltenheit {rarity}. {reason}",
      },
      {
        headline: "{rarity}-Alarm bei {name}",
        text: "Es ist passiert: {card} aus {set} liegt jetzt bei {name}. {reason} Der Rest von euch zieht weiter Staub.",
      },
    ],
    reasons: [
      "Statistisch ist das seltener als ein pünktlicher Steuerbescheid.",
      "Ich habe als Kind auch gesammelt. Meine Mutter hat alles weggeworfen, ich habe ihr nie verziehen.",
      "Bitte sofort in eine Hülle damit, und die Hülle in einen Tresor, und den Tresor in einen Bunker.",
      "Glück gehabt. Können war es nicht, bei Pappe gibt es kein Können.",
      "Die übrigen Karten aus dem Booster eignen sich hervorragend als Untersetzer.",
      "Neid ist keine Tugend, aber ich trage ihn heute mit Stolz.",
      "Wer jetzt weitermacht, verliert alles wieder. Also bitte weitermachen, ich brauche Stoff für morgen.",
      "Ein Stück Pappe, das mehr wert ist als mein Dienstwagen. Der Dienstwagen ist ein Tretroller.",
    ],
  },
  cardSale: {
    group: "cards",
    kind: "cards",
    weight: 10,
    tone: "neutral",
    slots: ["seller", "buyer", "card", "amount"],
    moods: ["shocked", "confused", "laughing"],
    frames: [
      {
        headline: "{amount} für {card}",
        text: "Vom Kartenmarkt: {seller} verkauft {card} für {amount} an {buyer}. {reason}",
      },
      {
        headline: "{buyer} kauft Pappe für {amount}",
        text: "{buyer} legt {amount} auf den Tisch, und zwar für {card} von {seller}. {reason}",
      },
      {
        headline: "Teuerste Karte der Stunde: {card}",
        text: "Rekord am Sammeltisch: {card} wechselt für {amount} von {seller} zu {buyer}. {reason}",
      },
    ],
    reasons: [
      "Es ist bedrucktes Papier. Ich wiederhole: bedrucktes Papier.",
      "Für das Geld bekäme man ein Auto. Aber ein Auto kann man nicht in eine Klarsichthülle stecken.",
      "Beide Seiten halten sich für den Gewinner. Einer irrt sich, ich sage nicht, wer.",
      "Der Verkäufer feiert, der Käufer nennt es eine Wertanlage, und die Karte hat niemand gefragt.",
      "Mein Finanzberater hat bei der Summe kurz die Fassung verloren und dann seinen Kugelschreiber.",
      "Früher hat man so etwas auf dem Schulhof gegen ein Pausenbrot getauscht.",
      "Die Karte kann nichts, außer teuer sein. Darin ist sie allerdings hervorragend.",
      "Ich hätte sie für die Hälfte gemalt. Mit Filzstift, aber mit Herz.",
    ],
  },
  cardUp: {
    group: "cards",
    kind: "cards",
    weight: 8,
    tone: "neutral",
    slots: ["card", "pct", "amount"],
    moods: ["shocked", "proud", "confused"],
    frames: [
      {
        headline: "{card} steigt um {pct}",
        text: "Kursrakete aus Pappe: {card} ist heute {pct} mehr wert und steht bei {amount}. {reason}",
      },
      {
        headline: "Alle wollen {card}",
        text: "Am Kartenmarkt dreht {card} durch: plus {pct}, jetzt {amount}. {reason}",
      },
      {
        headline: "Pappe schlägt Aktie: {card}",
        text: "{card} legt {pct} zu, Marktwert {amount}. {reason} Meine Aktien können das nicht.",
      },
    ],
    reasons: [
      "Niemand weiß, warum. Das hat am Kartenmarkt noch nie jemanden gestört.",
      "Wer sie gestern verkauft hat, darf jetzt kurz in ein Kissen schreien.",
      "Irgendwo sortiert gerade jemand hektisch seinen Ordner.",
      "Angeblich hat ein Sammler geniest, und der Markt hat es als Kaufsignal gedeutet.",
      "Das ist kein Hype, das ist eine Massenbewegung mit Klarsichthüllen.",
      "Die Karte selbst gibt sich bescheiden. Sie ist ja auch aus Papier.",
      "Ich habe meine Exemplare natürlich letzte Woche verschenkt. Natürlich.",
    ],
  },
  cardDown: {
    group: "cards",
    kind: "cards",
    weight: 8,
    tone: "neutral",
    slots: ["card", "pct", "amount"],
    moods: ["crying", "laughing", "smug"],
    frames: [
      {
        headline: "{card} verliert {pct}",
        text: "Trauer am Sammeltisch: {card} ist heute {pct} weniger wert, nur noch {amount}. {reason}",
      },
      {
        headline: "Pappe im freien Fall: {card}",
        text: "{card} rauscht um {pct} nach unten und landet bei {amount}. {reason}",
      },
      {
        headline: "Niemand will mehr {card}",
        text: "Gestern Schatz, heute Lesezeichen: {card} gibt {pct} nach, Marktwert {amount}. {reason}",
      },
    ],
    reasons: [
      "Zu viele Exemplare, zu wenige Abnehmer, zu viel Hoffnung.",
      "Wer zu Höchstpreisen gekauft hat, besitzt jetzt eine sehr teure Erinnerung.",
      "Die Karte ist noch dieselbe. Nur die Liebe ist weg.",
      "Sammler nennen das eine Kaufgelegenheit. Sammler nennen alles eine Kaufgelegenheit.",
      "Der Markt hat sich die Karte noch einmal genau angesehen. Das war der Fehler.",
      "Als Untersetzer bleibt sie voll funktionsfähig.",
      "Bitte keine Beileidskarten schicken. Auch die verlieren an Wert.",
    ],
  },
  cardGradeTop: {
    group: "cards",
    kind: "cards",
    weight: 10,
    tone: "good",
    slots: ["name", "card", "fee"],
    moods: ["proud", "shocked", "smug"],
    frames: [
      {
        headline: "Eine 10 für {name}",
        text: "Das Bewertungsinstitut ASP hat gesprochen: {card} von {name} bekommt die 10. Die Prüfung hat {fee} gekostet. {reason}",
      },
      {
        headline: "{card} ist makellos",
        text: "{name} hat {fee} an ASP überwiesen und bekommt {card} mit der Bestnote zurück. {reason}",
      },
      {
        headline: "Bestnote: {card}",
        text: "Zehn von zehn: Die Prüfer bei ASP fanden an {card} von {name} nichts auszusetzen, und für {fee} haben die wirklich gesucht. {reason}",
      },
    ],
    reasons: [
      "Die Karte liegt jetzt in Plastik und darf nie wieder angefasst werden. Ein Leben wie mein gutes Geschirr.",
      "Makellos. Ein Wort, das über mein Depot noch nie gefallen ist.",
      "Ein Mann mit Lupe und weißen Handschuhen hat genickt. Mehr Anerkennung gibt es in diesem Land nicht.",
      "Ich gönne es von Herzen. Mein Herz ist allerdings sehr klein.",
      "Zehn Punkte für Pappe. Ich habe für meine Doktorarbeit weniger bekommen, und die war abgeschrieben.",
      "Jetzt bloß nicht daraufsetzen.",
      "Der Prüfer soll kurz geweint haben. Vor Glück oder wegen des Gehalts, das ist unklar.",
    ],
  },
  cardGradeLow: {
    group: "cards",
    kind: "cards",
    weight: 10,
    tone: "bad",
    slots: ["name", "card", "grade", "fee"],
    moods: ["laughing", "smug", "crying"],
    frames: [
      {
        headline: "Nur eine {grade} für {name}",
        text: "{name} hat {fee} bezahlt, damit Profis {card} begutachten. Das Urteil von ASP: Note {grade}. {reason}",
      },
      {
        headline: "ASP zerlegt {card}",
        text: "Bittere Post vom Bewertungsinstitut: {card} von {name} bekommt die {grade}, und die {fee} Gebühr sind trotzdem weg. {reason}",
      },
      {
        headline: "{fee} für eine {grade}",
        text: "Man kann Geld verbrennen oder es zu ASP schicken. {name} wählte ASP: {card}, Note {grade}, Kosten {fee}. {reason}",
      },
    ],
    reasons: [
      "Die Prüfer fragten, ob die Karte schon einmal mitgewaschen wurde.",
      "Im Gutachten steht das Wort „Kaffeerand“. Zweimal.",
      "Die Karte ist jetzt offiziell in Plastik versiegelt, damit die Schande haltbar bleibt.",
      "Für eine Expertenmeinung zu zahlen und sie dann zu bekommen: Das tut immer weh.",
      "Vorher war sie einfach nur eine Karte. Jetzt ist sie eine Karte mit Aktenzeichen.",
      "Der Prüfer trug Handschuhe. Nicht zum Schutz der Karte.",
      "Mein Mitgefühl ist wie diese Karte: vorhanden, aber stark beschädigt.",
      "Tipp von mir: nächstes Mal nicht als Bierdeckel benutzen.",
    ],
  },
  cardDud: {
    group: "cards",
    kind: "cards",
    weight: 10,
    tone: "bad",
    slots: ["name", "packs", "amount"],
    moods: ["laughing", "smug", "crying"],
    frames: [
      {
        headline: "{name}: {packs} Booster, kein Treffer",
        text: "{name} hat heute {packs} Booster aufgerissen, {amount} ausgegeben und nichts gezogen, was den Namen Treffer verdient. {reason}",
      },
      {
        headline: "{amount} für einen Stapel Altpapier",
        text: "Die Pechsträhne des Tages: {packs} Booster, {amount} weg, und {name} hält nur gewöhnliche Pappe in der Hand. {reason}",
      },
      {
        headline: "Der Booster-Friedhof von {name}",
        text: "{packs} Booster hat {name} heute geöffnet. Bilanz: {amount} Kosten, null Glanz. {reason}",
      },
    ],
    reasons: [
      "Der nächste Booster ist bestimmt der richtige. Das sagt man seit dem ersten.",
      "Die Wahrscheinlichkeit war auf deiner Seite. Sie ist dann aber gegangen.",
      "Immerhin reicht es jetzt für eine sehr dünne Tapete.",
      "Der Kartenhersteller bedankt sich und hat ein Schwimmbecken nach dir benannt.",
      "Mathematiker nennen das Varianz. Ich nenne es Unterhaltung.",
      "Irgendwo zieht gerade jemand mit einem einzigen Booster eine Legendäre. Nur so als Information.",
      "Das ist kein Hobby mehr, das ist eine Spende mit Verpackungsmüll.",
      "Die Folien bitte getrennt entsorgen, wenigstens das soll ordentlich laufen.",
    ],
  },
  cardCollection: {
    group: "cards",
    kind: "cards",
    weight: 6,
    tone: "good",
    slots: ["name", "count", "amount"],
    moods: ["smug", "shocked", "proud"],
    frames: [
      {
        headline: "{name} hortet Pappe für {amount}",
        text: "Die wertvollste Sammlung im Land gehört {name}: {count} Karten, zusammen {amount} wert. {reason}",
      },
      {
        headline: "Der Kartenthron gehört {name}",
        text: "{count} Karten, Marktwert {amount}: Niemand sitzt auf mehr bedrucktem Papier als {name}. {reason}",
      },
      {
        headline: "{amount} im Sammelordner",
        text: "Andere haben ein Depot, {name} hat einen Ordner: {count} Karten für {amount}. {reason}",
      },
    ],
    reasons: [
      "Ein Glas Wasser im falschen Moment, und das Vermögen ist Geschichte.",
      "Die Hausratversicherung hat vorsorglich den Vertrag gekündigt.",
      "Das ist kein Vermögen, das ist ein Brandrisiko mit Sammlerwert.",
      "Früher nannte man das Zimmer unaufgeräumt, heute heißt es Portfolio.",
      "Bitte regelmäßig lüften, sonst riecht der Reichtum.",
      "Ich hoffe, niemand im Haushalt besitzt eine Schere.",
      "Reich an Pappe ist auch reich. Sagt zumindest die Pappe.",
    ],
  },
  cardAi: {
    group: "cards",
    kind: "cards",
    weight: 5,
    tone: "neutral",
    slots: ["seller", "count", "amount"],
    moods: ["confused", "smug", "angry"],
    frames: [
      {
        headline: "{seller} sitzt auf {count} Karten",
        text: "Neues von den Händlern: {seller} bietet gerade {count} Karten an, zusammen für {amount}. {reason}",
      },
      {
        headline: "Was treibt eigentlich {seller}?",
        text: "{seller} hat {count} Karten im Schaufenster und will dafür {amount} sehen. {reason}",
      },
      {
        headline: "Am Kartenstand von {seller}",
        text: "Am Kartenmarkt wartet {seller} mit {count} Angeboten für insgesamt {amount} auf Kundschaft. {reason}",
      },
    ],
    reasons: [
      "Verhandeln zwecklos, die Preise stehen fest wie die schlechte Laune.",
      "Zehn Prozent Aufschlag für das Privileg, überhaupt bedient zu werden.",
      "Geöffnet rund um die Uhr, Freundlichkeit auf Anfrage und gegen Aufpreis.",
      "Gerüchten zufolge wurde der Laden noch nie gelüftet.",
      "Die Karten riechen leicht nach Pommesbude, das gilt in der Szene als Echtheitsmerkmal.",
      "Reklamationen werden entgegengenommen und sofort feierlich vergessen.",
      "Der Stand hat keine Kasse, nur einen Schuhkarton und einen sehr wachsamen Blick.",
      "Angeblich schläft dort jemand auf den Commons. Bequem soll es nicht sein.",
    ],
  },

  // ------------------------------------------------------------------ Finanzamt (ADR-167)
  taxLate: {
    group: "tax",
    kind: "tax",
    weight: 12,
    tone: "bad",
    slots: ["name", "company", "amount"],
    moods: ["laughing", "smug", "angry"],
    frames: [
      {
        headline: "Verspätungszuschlag für {company}",
        text: "Post vom Finanzamt Nexa-Mitte: {name} hat die Bücher von {company} verschlampt und zahlt {amount} Verspätungszuschlag. {reason}",
      },
      {
        headline: "{amount} Strafe: {name} und die Bücher",
        text: "Oberamtsrat Griesgram meldet sich: Die Bücher von {company} sind überfällig, {name} schuldet dem Staat {amount} extra. {reason}",
      },
      {
        headline: "Das Finanzamt mahnt {company}",
        text: "{name} wollte die Buchhaltung von {company} aussitzen. Das Finanzamt saß länger: {amount} Zuschlag. {reason}",
      },
    ],
    reasons: [
      "Oberamtsrat Griesgram hat beim Stempeln gelächelt. Kollegen sprechen vom ersten Mal seit 1994.",
      "Das Schreiben kam in dreifacher Ausfertigung, damit auch jede Hand etwas zum Zittern hat.",
      "Der Zuschlag ist steuerlich nicht absetzbar. Der Hinweis darauf kostet extra.",
      "Belege im Schuhkarton gelten übrigens nicht als Buchführung, auch nicht mit Schleife.",
      "Im Amt wurde angestoßen. Mit Leitungswasser, aber immerhin.",
      "Bürokratie ist geduldig. Sie ist nur nicht kostenlos.",
      "Der Bescheid ist maschinell erstellt und ohne Mitgefühl gültig.",
      "Wer zu spät bucht, den bestraft das Formular.",
    ],
  },
  taxEstimate: {
    group: "tax",
    kind: "tax",
    weight: 12,
    tone: "bad",
    slots: ["name", "company"],
    moods: ["laughing", "shocked", "smug"],
    frames: [
      {
        headline: "Finanzamt schätzt {company}",
        text: "{name} hat die Bücher von {company} so lange ignoriert, bis das Finanzamt selbst gerechnet hat. Großzügig, aber nur zu den eigenen Gunsten. {reason}",
      },
      {
        headline: "Griesgram würfelt die Steuer von {company}",
        text: "Keine Bücher, kein Problem: Oberamtsrat Griesgram hat den Gewinn von {company} einfach geschätzt. {name} darf zahlen und staunen. {reason}",
      },
      {
        headline: "{name} lässt das Amt rechnen",
        text: "Bei {company} macht jetzt das Finanzamt die Buchhaltung, mit Zuschlag und ohne Rückfragen. {name} hatte offenbar Wichtigeres vor. {reason}",
      },
    ],
    reasons: [
      "Geschätzt wurde mit der bewährten Methode: Daumen hoch, dann verdoppeln.",
      "Im Amt nennt man das eine Schätzung. Außerhalb des Amts nennt man es Rache.",
      "Die Schätzung erfolgte nach Aktenlage. Die Akte war leer, also wurde es teuer.",
      "Griesgram soll dabei gesummt haben. Das Lied ist nicht bekannt, es klang nach Moll.",
      "Wer seine Zahlen nicht nennt, bekommt welche zugeteilt. So funktioniert Fürsorge.",
      "Einspruch ist möglich, das Formular dafür ist leider vergriffen.",
      "Das Amt hat aufgerundet. Zweimal, zur Sicherheit.",
    ],
  },
  taxEnforce: {
    group: "tax",
    kind: "tax",
    weight: 14,
    tone: "bad",
    slots: ["name", "company"],
    moods: ["shocked", "laughing", "angry"],
    frames: [
      {
        headline: "Zwangsvollstreckung bei {company}",
        text: "Jetzt wird es ernst: Das Finanzamt holt sich die Steuerschuld von {company} direkt vom Firmenkonto. {name} darf zusehen. {reason}",
      },
      {
        headline: "Das Finanzamt bedient sich bei {company}",
        text: "{name} hat nicht gezahlt, also hat Oberamtsrat Griesgram bei {company} selbst zugegriffen. {reason}",
      },
      {
        headline: "Kuckuck! {company} wird gepfändet",
        text: "Mahnung ignoriert, Frist verpasst: Bei {company} vollstreckt jetzt das Amt, und {name} lernt das Wort Zwangseinzug. {reason}",
      },
    ],
    reasons: [
      "Der Kuckuck klebt jetzt auf allem, sogar auf der Kaffeemaschine. Besonders auf der Kaffeemaschine.",
      "Griesgram kam persönlich, mit Aktentasche und einer Thermoskanne voller Genugtuung.",
      "Die Auszahlungen sind erst einmal gesperrt. Das Jammern bleibt erlaubt.",
      "Das Amt nimmt nur, was ihm zusteht. Die Würde gab es gratis dazu.",
      "Im Flur des Finanzamts hängt jetzt ein Foto davon, neben dem Mitarbeiter des Monats.",
      "Man hätte auch einfach zahlen können. Aber wo bliebe da meine Sendung?",
      "Der Staat vergisst nichts, er sortiert nur langsam.",
    ],
  },
  taxAudit: {
    group: "tax",
    kind: "tax",
    weight: 12,
    tone: "bad",
    slots: ["name", "company"],
    moods: ["shocked", "laughing", "smug"],
    frames: [
      {
        headline: "Betriebsprüfung bei {company}",
        text: "Bei {company} klingelt es: Die Betriebsprüfung ist da und möchte von {name} jeden einzelnen Beleg sehen. {reason}",
      },
      {
        headline: "Griesgram besucht {name}",
        text: "Oberamtsrat Griesgram prüft ab sofort {company}. {name} sucht bereits hektisch nach Quittungen. {reason}",
      },
      {
        headline: "{company} unter der Lupe",
        text: "Das Finanzamt Nexa-Mitte hat {company} zur Prüfung ausgewählt. {name} spricht von Zufall, das Amt von Vorfreude. {reason}",
      },
    ],
    reasons: [
      "Die Prüfer haben eigene Stühle mitgebracht. Sie bleiben länger.",
      "Erste Frage der Prüfung: „Was genau ist das hier?“ Gemeint war die gesamte Firma.",
      "Griesgram liest Bilanzen wie andere Leute Krimis, nur dass er den Täter schon kennt.",
      "Der Bewirtungsbeleg über vierzig Bratwürste für eine Person wird noch Thema.",
      "Es wurde ein Ordner gefunden. Er war leer, aber ordentlich beschriftet.",
      "Die Prüfung dauert, bis jemand weint. Das Amt hat Zeit.",
      "Im Kopierraum riecht es bereits nach Angst und Toner.",
      "Bitte keine Geschenke an die Prüfer, außer es sind sehr gute.",
    ],
  },
  taxStreak: {
    group: "tax",
    kind: "tax",
    weight: 6,
    tone: "good",
    slots: ["name", "company", "days"],
    moods: ["confused", "proud", "smug"],
    frames: [
      {
        headline: "{days} Tage saubere Bücher bei {company}",
        text: "Es geschehen Wunder: {name} macht seit {days} Tagen pünktlich die Bücher von {company}. {reason}",
      },
      {
        headline: "Musterfall {company}",
        text: "Das Finanzamt meldet einen verdächtigen Fall von Ordnung: {company}, {days} Tage in Folge alles korrekt verbucht, verantwortlich ist {name}. {reason}",
      },
      {
        headline: "{name} und die Liebe zum Beleg",
        text: "{days} Tage ohne Mahnung: {name} führt {company} so ordentlich, dass es dem Amt unheimlich wird. {reason}",
      },
    ],
    reasons: [
      "Oberamtsrat Griesgram ist misstrauisch. So viel Ordnung kann nur eine Falle sein.",
      "Im Finanzamt wurde ein Dankesschreiben aufgesetzt und sicherheitshalber nie abgeschickt.",
      "Streberei. Ich sage das mit dem Neid eines Mannes, dessen Belege in einer Tüte wohnen.",
      "So sieht ein Leben ohne Risiko aus. Trostlos, aber abzugsfähig.",
      "Das Amt gewährt dafür Rabatt, denn selbst Bürokraten belohnen Dressur.",
      "Irgendwann vergisst es jeder einmal. Wir warten gern, wir haben eine Sendung zu füllen.",
      "Griesgram hat die Akte gestreichelt. Das war allen unangenehm.",
    ],
  },
  taxDebt: {
    group: "tax",
    kind: "tax",
    weight: 8,
    tone: "bad",
    slots: ["name", "company", "amount"],
    moods: ["smug", "laughing", "angry"],
    frames: [
      {
        headline: "{company} schuldet dem Amt {amount}",
        text: "Offene Rechnung beim Finanzamt: {company} von {name} hat noch {amount} Steuern zu zahlen. {reason}",
      },
      {
        headline: "{name}, das Finanzamt wartet",
        text: "Auf dem Schreibtisch von Oberamtsrat Griesgram liegt ein Bescheid über {amount}, adressiert an {company}. {name} tut so, als sei niemand zu Hause. {reason}",
      },
      {
        headline: "Steuerschuld des Tages: {amount}",
        text: "{amount} will der Staat von {company} sehen. {name} hat die Frist angeblich im Blick. {reason}",
      },
    ],
    reasons: [
      "Das Amt verschickt Erinnerungen. Erst freundlich, dann förmlich, dann mit Besuch.",
      "Die Uhr tickt. Im Finanzamt tickt sie sogar pünktlich.",
      "Zahlen macht keinen Spaß, aber die Alternative trägt Aktentasche.",
      "Griesgram hat das Datum im Kalender markiert, mit einem kleinen Herz.",
      "Steuern sind der Preis der Zivilisation. Die Zivilisation möchte ihr Geld bitte bis Fristende.",
      "Wer jetzt noch wartet, finanziert dem Amt die Weihnachtsfeier.",
      "Verstecken ist zwecklos, das Amt kennt die Adresse und das Lieblingscafé.",
    ],
  },
  taxBit: {
    group: "tax",
    kind: "tax",
    weight: 4,
    tone: "neutral",
    slots: [],
    moods: ["angry", "confused", "crying"],
    frames: [
      {
        headline: "Das Finanzamt informiert",
        text: "Eine Durchsage von Oberamtsrat Griesgram, Finanzamt Nexa-Mitte, die ich verlesen muss, weil er mein Kennzeichen kennt: {reason}",
      },
      {
        headline: "Griesgrams Sprechstunde",
        text: "Und nun unsere beliebteste Rubrik, sagt das Finanzamt. Oberamtsrat Griesgram lässt mitteilen: {reason} Ende der Durchsage.",
      },
      {
        headline: "Amtliche Bekanntmachung",
        text: "Achtung, es wird behördlich. Das Finanzamt Nexa-Mitte teilt mit: {reason} Ich gebe das nur weiter.",
      },
    ],
    reasons: [
      "Formular 27b ersetzt ab sofort Formular 27a. Wer 27a schon abgegeben hat, füllt bitte Formular 27c aus, um das zu bereuen.",
      "Die Sprechzeiten sind dienstags von 9:00 bis 9:15 Uhr. Am Dienstag ist geschlossen.",
      "Freude ist ab sofort als geldwerter Vorteil zu versteuern. Schadenfreude bleibt begünstigt.",
      "Wer seine Belege in der richtigen Reihenfolge einreicht, erhält nichts. Aber es fällt angenehm auf.",
      "Das Amt sucht den Besitzer eines einzelnen Cents, der 2019 zu viel gezahlt wurde. Die Abholung ist gebührenpflichtig.",
      "Die Warteschleife der Hotline wurde um eine zweite Melodie erweitert. Sie ist schlechter.",
      "Im Aufzug des Amts steckt seit Montag ein Steuerberater. Er rechnet die Zeit bereits ab.",
      "Ehrlichkeit bleibt steuerfrei, da die Einnahmen daraus zu gering sind.",
      "Der Kopierer im dritten Stock ist kaputt. Alle Fristen laufen selbstverständlich weiter.",
      "Verluste aus eigener Dummheit können nicht mehr vorgetragen werden. Der Speicherplatz reicht nicht.",
      "Griesgram bittet darum, ihn im Supermarkt nicht mehr anzusprechen. Er merkt sich die Gesichter.",
      "Mitleid kann beantragt werden. Die Bearbeitung dauert sechs bis acht Jahre.",
    ],
  },

  // ------------------------------------------------------------------ listed companies (ADR-167)
  corpGreedy: {
    group: "corp",
    kind: "corp",
    weight: 12,
    tone: "bad",
    slots: ["name", "company", "pct"],
    moods: ["angry", "laughing", "shocked"],
    frames: [
      {
        headline: "{name} bedient sich bei {company}",
        text: "Bei {company} landet {pct} des Gewinns direkt in der Tasche von {name}. Die Aktionäre bekommen den Rest und einen feuchten Händedruck. {reason}",
      },
      {
        headline: "Selbstbedienung bei {company}",
        text: "{name} zahlt sich bei {company} satte {pct} vom Gewinn selbst aus. {reason}",
      },
      {
        headline: "{pct} für die Chefetage",
        text: "Gewinnverteilung bei {company}: {pct} für {name}, der Rest für alle anderen zusammen. {reason}",
      },
    ],
    reasons: [
      "Der Ruf der Firma hat daraufhin stillschweigend das Gebäude verlassen.",
      "Die Aktionäre haben einen Blumenstrauß geschickt. Es waren Disteln.",
      "Gier ist menschlich. In dieser Dosierung ist sie allerdings eher olympisch.",
      "Die Belegschaft wurde gefragt, was sie davon hält. Die Antwort war nicht sendefähig.",
      "Auf dem Chefparkplatz steht jetzt ein zweiter Chefparkplatz.",
      "Wer so teilt, sollte bei Kindergeburtstagen nie den Kuchen schneiden.",
      "Die Kaffeekasse wurde vorsorglich angekettet.",
      "Immerhin bleibt das Geld in der Familie, nämlich bei einer einzigen Person.",
    ],
  },
  corpQuit: {
    group: "corp",
    kind: "corp",
    weight: 12,
    tone: "bad",
    slots: ["name", "company", "count"],
    moods: ["shocked", "laughing", "crying"],
    frames: [
      {
        headline: "Kündigungswelle bei {company}",
        text: "Bei {company} haben heute {count} Leute hingeschmissen. {name} nennt das eine natürliche Verschlankung. {reason}",
      },
      {
        headline: "{count} Kündigungen an einem Tag",
        text: "Massenflucht bei {company}: {count} Beschäftigte sind weg, {name} steht allein im Großraumbüro. {reason}",
      },
      {
        headline: "Alle weg bei {company}",
        text: "{count} Kündigungen an einem einzigen Tag, das schafft nur {company} unter der Führung von {name}. {reason}",
      },
    ],
    reasons: [
      "Der Letzte hat das Licht ausgemacht und die Kaffeemaschine mitgenommen.",
      "Auf dem Abschiedskuchen stand nur: „Endlich.“",
      "Im Flur hängt noch das Poster „Wir sind eine Familie“. Es hängt schief.",
      "Die Kündigungen kamen als Sammelmappe, alphabetisch sortiert. So viel Ordnung war dort nie.",
      "Sogar die Zimmerpflanze hat sich versetzen lassen.",
      "Der Obstkorb war am Ende wohl doch kein vollwertiger Gehaltsersatz.",
      "Die Stellenanzeigen sind schon geschaltet: „Suchen irgendwen. Bitte.“",
      "Zurück blieben ein Tischkicker und eine sehr unangenehme Stille.",
    ],
  },
  corpDividend: {
    group: "corp",
    kind: "corp",
    weight: 10,
    tone: "good",
    slots: ["name", "company", "amount"],
    moods: ["proud", "shocked", "smug"],
    frames: [
      {
        headline: "Rekorddividende bei {company}",
        text: "{company} schüttet {amount} aus, so viel wie noch nie. {name} lässt sich feiern. {reason}",
      },
      {
        headline: "{amount} für die Aktionäre",
        text: "Geldregen bei {company}: {name} verteilt {amount} Dividende. {reason}",
      },
      {
        headline: "{name} macht Aktionäre glücklich",
        text: "Bei {company} gibt es {amount} Dividende, ein Rekord. {reason} Ich habe natürlich keine einzige Aktie davon.",
      },
    ],
    reasons: [
      "Die Aktionäre haben spontan eine Polonaise durch die Hauptversammlung gestartet.",
      "So viel Großzügigkeit ist verdächtig. Wir bleiben dran.",
      "Wer keine Aktie hat, darf jetzt neidisch auf den Bildschirm starren. Ich mache das auch.",
      "Das Finanzamt hat bereits höflich gehustet.",
      "Geld verschenken und dafür Applaus bekommen: Davon träumt jeder Lottogewinner.",
      "Die Hälfte davon wird in Pappkarten angelegt, ich kenne meine Zuschauer.",
      "Ein Aktionär hat sich aus Dankbarkeit das Firmenlogo auf die Tasse drucken lassen.",
    ],
  },
  corpRevolt: {
    group: "corp",
    kind: "corp",
    weight: 12,
    tone: "neutral",
    slots: ["name", "company"],
    moods: ["shocked", "laughing", "proud"],
    frames: [
      {
        headline: "Aufstand bei {company}",
        text: "Der Geschäftsrat von {company} hat gegen die Chefetage entschieden. Den Antrag dazu hat {name} gestellt. {reason}",
      },
      {
        headline: "Putsch im Sitzungssaal",
        text: "Bei {company} wurde abgestimmt, und die Chefetage hat verloren. {name} hat den Antrag durchgebracht. {reason}",
      },
      {
        headline: "{name} probt den Aufstand",
        text: "Revolution mit Tagesordnung: {name} setzt sich im Geschäftsrat von {company} durch. {reason}",
      },
    ],
    reasons: [
      "Es flogen Kekse. Die guten, mit Schokolade.",
      "Das Protokoll vermerkt: „Die Chefetage verließ den Raum und kam mit schlechterer Laune zurück.“",
      "Demokratie ist, wenn die Aktionäre plötzlich lesen können.",
      "Die Abstimmung dauerte vier Minuten, das Schmollen hält noch an.",
      "Im Sitzungssaal wurde danach der Chefsessel einen Zentimeter niedriger gestellt.",
      "Man nennt es Mitbestimmung. Die Chefetage nennt es anders, aber das dürfen wir nicht senden.",
      "Es war die erste Sitzung, bei der niemand eingeschlafen ist.",
    ],
  },
  corpMoodLow: {
    group: "corp",
    kind: "corp",
    weight: 8,
    tone: "bad",
    slots: ["name", "company", "value"],
    moods: ["laughing", "shocked", "angry"],
    frames: [
      {
        headline: "Miese Stimmung bei {company}",
        text: "Die Zufriedenheit bei {company} liegt bei {value} von 100 Punkten. {name} hält das für ein Kommunikationsproblem. {reason}",
      },
      {
        headline: "{company}: Belegschaft kurz vor dem Absprung",
        text: "{value} von 100: So zufrieden sind die Leute bei {company}. {name} überlegt, einen zweiten Obstkorb anzuschaffen. {reason}",
      },
      {
        headline: "Betriebsklima: Eiszeit",
        text: "Bei {company} zeigt das Stimmungsbarometer {value} von 100. Verantwortlich: {name}. {reason}",
      },
    ],
    reasons: [
      "Der Betriebsausflug führte zuletzt auf den Parkplatz. Und zurück.",
      "In der Kaffeeküche wird nur noch geflüstert, und zwar Stellenanzeigen.",
      "Das Motivationsposter mit dem Adler wurde von Unbekannten umgedreht.",
      "Der Kummerkasten ist voll. Es ist bereits der dritte.",
      "Die Weihnachtsfeier wurde durch eine Rundmail ersetzt. Sie hatte einen Tippfehler.",
      "Selbst der Drucker streikt, und der bekommt gar kein Gehalt.",
      "Als Benefit gibt es Leitungswasser, auf Wunsch auch lauwarm.",
      "Die Mitarbeiter des Monats wurden gebeten, sich nicht mehr zu melden.",
    ],
  },
  corpMoodHigh: {
    group: "corp",
    kind: "corp",
    weight: 6,
    tone: "good",
    slots: ["name", "company", "value"],
    moods: ["confused", "proud", "shocked"],
    frames: [
      {
        headline: "Verdächtig gute Laune bei {company}",
        text: "{value} von 100 Punkten Zufriedenheit: Bei {company} gehen die Leute gern zur Arbeit. {name} hat offenbar etwas richtig gemacht. {reason}",
      },
      {
        headline: "{company}: Alle glücklich, niemand weiß warum",
        text: "Das Stimmungsbarometer bei {company} steht auf {value} von 100. {name} nimmt Glückwünsche entgegen. {reason}",
      },
      {
        headline: "Traumjob bei {company}",
        text: "Bei {company} von {name} liegt die Zufriedenheit bei {value} von 100. {reason} So etwas habe ich in meiner Redaktion nie geschafft.",
      },
    ],
    reasons: [
      "Die Leute singen auf dem Weg ins Büro. Die Nachbarn haben sich bereits beschwert.",
      "Es gibt dort einen Tischkicker, und er wird sogar benutzt. Während der Arbeitszeit. Mit Erlaubnis.",
      "Ein Headhunter rief an und wurde ausgelacht.",
      "Ich habe mich beworben. Man hat nie zurückgerufen.",
      "So viel Harmonie hält erfahrungsgemäß bis zur nächsten Gehaltsrunde.",
      "Niemand hat gekündigt, nicht einmal innerlich.",
      "Die Kaffeeflatrate allein kann es nicht sein. Oder doch? Es ist die Kaffeeflatrate.",
    ],
  },
  corpResearch: {
    group: "corp",
    kind: "corp",
    weight: 8,
    tone: "good",
    slots: ["name", "company"],
    moods: ["proud", "confused", "shocked"],
    frames: [
      {
        headline: "Durchbruch im Labor von {company}",
        text: "Die Forschung bei {company} meldet einen Erfolg. {name} versteht das Ergebnis selbst nicht ganz, freut sich aber sichtbar. {reason}",
      },
      {
        headline: "{company} erfindet etwas",
        text: "Im Labor von {company} wurde ein Projekt abgeschlossen. {name} spricht von einem Meilenstein. {reason}",
      },
      {
        headline: "Heureka bei {name}",
        text: "{company} hat fertig geforscht, und es hat tatsächlich funktioniert. {name} lässt bereits Urkunden drucken. {reason}",
      },
    ],
    reasons: [
      "Der zuständige Forscher wurde dabei zum ersten Mal seit Wochen bei Tageslicht gesehen.",
      "Was genau erfunden wurde, ist geheim. Vermutlich, weil es niemand erklären kann.",
      "Im Labor roch es drei Tage nach verbranntem Toast. Das gehörte angeblich zum Verfahren.",
      "Die Konkurrenz hat sofort das Gegenteil erforscht, um sicherzugehen.",
      "Der Durchbruch gelang beim Versuch, etwas völlig anderes zu reparieren.",
      "Ein Laborkittel wurde dabei geopfert. Er war sehr tapfer.",
      "Die Patentanmeldung umfasst vierzig Seiten und eine Zeichnung, die niemand deuten kann.",
    ],
  },

  // ------------------------------------------------------------------ a person (what they did in the game)
  pTradeLoss: {
    group: "person",
    kind: "gossip",
    weight: 12,
    tone: "bad",
    slots: ["name", "amount", "stock"],
    moods: ["laughing", "smug", "shocked"],
    frames: [
      {
        headline: "{name} verzockt {amount} mit {stock}",
        text: "Der Fehlgriff des Tages: {name} hat mit {stock} auf einen Schlag {amount} verloren. {reason}",
      },
      {
        headline: "{stock} frisst das Geld von {name}",
        text: "{name} wollte mit {stock} reich werden. Ergebnis: minus {amount} in einem einzigen Handel. {reason}",
      },
      {
        headline: "Ein Handel, {amount} weg",
        text: "Kaufen, hoffen, weinen: {name} hat bei {stock} {amount} Verlust mitgenommen. {reason}",
      },
      {
        headline: "{name} und der schlechteste Handel des Tages",
        text: "Minus {amount} mit {stock}. Das war kein Handel von {name}, das war eine Abschiedsfeier fürs Geld. {reason}",
      },
    ],
    reasons: [
      "Der Verkaufsknopf wurde offenbar mit dem Notausgang verwechselt.",
      "Das Geld ist nicht weg, es gehört jetzt nur jemandem mit mehr Verstand.",
      "Die Aktie hat nichts falsch gemacht. Sie wurde nur von der falschen Person gekauft.",
      "Ruhe in Frieden, liebes Geld. Du hattest keine Chance.",
      "Timing ist alles. Das hier war das Gegenteil von allem.",
      "Ich habe den Handel in Zeitlupe angesehen. Es wurde nicht besser.",
      "An der Börse wird nicht geklingelt, wenn man aussteigen soll. Hier hätte man eine Sirene gebraucht.",
      "Als Abschreckung für andere war es immerhin sehr wertvoll.",
    ],
  },
  pTradeWin: {
    group: "person",
    kind: "gossip",
    weight: 8,
    tone: "good",
    slots: ["name", "amount", "stock"],
    moods: ["shocked", "proud", "angry"],
    frames: [
      {
        headline: "{name} kassiert {amount} mit {stock}",
        text: "Der Volltreffer des Tages: {name} hat mit {stock} in einem einzigen Handel {amount} Gewinn gemacht. {reason}",
      },
      {
        headline: "Glücksgriff {stock}",
        text: "{name} verkauft {stock} und steckt {amount} Gewinn ein. {reason}",
      },
      {
        headline: "{amount} Plus in einem Handel",
        text: "Billig rein, teuer raus: {name} zeigt bei {stock}, wie es geht, und nimmt {amount} mit. {reason}",
      },
    ],
    reasons: [
      "Bitte so tun, als sei das Absicht gewesen. Wir spielen alle mit.",
      "Der Markt war kurz unaufmerksam, und jemand hat es ausgenutzt.",
      "Ich bin nicht neidisch. Ich zähle nur sehr laut fremdes Geld.",
      "Ein blindes Huhn mit Depot, aber ein erfolgreiches.",
      "Davon kann man sich etwas Schönes kaufen. Zum Beispiel die nächste Fehlentscheidung.",
      "Die Gegenseite dieses Handels möchte heute nicht interviewt werden.",
      "Genieß es. Der Markt holt sich so etwas erfahrungsgemäß mit Zinsen zurück.",
    ],
  },
  pHourLoser: {
    group: "person",
    kind: "gossip",
    weight: 12,
    tone: "bad",
    slots: ["name", "amount", "pct"],
    moods: ["laughing", "smug", "shocked"],
    frames: [
      {
        headline: "Größter Verlust der Stunde: {name}",
        text: "In nur einer Stunde hat {name} {amount} verloren, das sind {pct} des Vermögens. {reason}",
      },
      {
        headline: "{name}: {pct} weg in sechzig Minuten",
        text: "Die letzte Stunde war für {name} teuer: minus {amount}, minus {pct}. {reason}",
      },
      {
        headline: "Eine Stunde, {amount} ärmer",
        text: "Manche brauchen für so einen Verlust eine Woche. {name} schafft {amount} in einer Stunde, {pct} vom Vermögen. {reason}",
      },
    ],
    reasons: [
      "Hochgerechnet auf den Tag bleibt abends nur noch der Benutzername.",
      "Das Depot hat in dieser Stunde mehr gelitten als mein Praktikant, und der sortiert meine Belege.",
      "Sechzig Minuten, in denen ein Spaziergang die bessere Anlage gewesen wäre.",
      "Das Vermögen schmilzt schneller als ein Eis auf der Motorhaube.",
      "Wenn das so weitergeht, moderiere ich bald einen Nachruf auf dieses Depot.",
      "Die gute Nachricht: Die nächste Stunde kann kaum schlechter werden. Die schlechte: doch.",
      "Ich habe schon Sanduhren mit mehr Substanz gesehen.",
    ],
  },
  pHourWinner: {
    group: "person",
    kind: "gossip",
    weight: 8,
    tone: "good",
    slots: ["name", "amount", "pct"],
    moods: ["shocked", "proud", "angry"],
    frames: [
      {
        headline: "Größter Gewinn der Stunde: {name}",
        text: "In den letzten sechzig Minuten ist {name} um {amount} reicher geworden, plus {pct}. {reason}",
      },
      {
        headline: "{name}: plus {pct} in einer Stunde",
        text: "Eine Stunde, {amount} Gewinn: {name} hat gerade einen Lauf. {reason}",
      },
      {
        headline: "{amount} in sechzig Minuten",
        text: "Während ihr geschlafen habt, hat {name} {amount} verdient, das Vermögen wuchs um {pct}. {reason}",
      },
    ],
    reasons: [
      "Das ist mehr, als ich in einer Stunde verdiene, und ich rede dabei ununterbrochen.",
      "Bitte jetzt aufhören. Niemand hört an dieser Stelle auf.",
      "So ein Stundenlohn ist sonst nur Klempnern am Sonntag vorbehalten.",
      "Der Rest des Servers hat in derselben Zeit hauptsächlich geatmet.",
      "Irgendjemand hat dieses Geld verloren. Wir grüßen an dieser Stelle herzlich.",
      "Ich verlange ab sofort eine Erwähnungsgebühr.",
      "Hochmut kommt vor dem Kursrutsch, aber bis dahin: Respekt.",
    ],
  },
  pLandlord: {
    group: "person",
    kind: "gossip",
    weight: 8,
    tone: "neutral",
    slots: ["name", "amount", "count"],
    moods: ["smug", "angry", "laughing"],
    frames: [
      {
        headline: "{name} kassiert {amount} Miete",
        text: "Aus dem Immobilienteil: {name} hat heute {amount} Miete eingestrichen. Zahl der Überweisungen: {count}. {reason}",
      },
      {
        headline: "Mieteinnahmen des Tages: {name}",
        text: "{amount} Miete, Zahlungseingänge: {count}. {name} verdient Geld, ohne das Sofa zu verlassen. {reason}",
      },
      {
        headline: "Die Miete fließt zu {name}",
        text: "{name} hat vermietet und kassiert: {amount}, Zahl der Überweisungen: {count}. {reason}",
      },
    ],
    reasons: [
      "Der Mieter hat um einen neuen Duschkopf gebeten und eine Mieterhöhung bekommen.",
      "Geld verdienen im Schlaf: Bei den meisten bleibt das ein Traum, hier ist es ein Geschäftsmodell.",
      "Die Heizung funktioniert angeblich. Im Sommer.",
      "Im Mietvertrag steht, dass Jammern als Nebenkosten abgerechnet wird.",
      "Vermieten ist harte Arbeit: Man muss einmal im Monat aufs Konto schauen.",
      "Der Schimmel im Bad zahlt übrigens keine Miete, der wohnt dort aus Überzeugung.",
      "Die Kaution sieht der Mieter wieder, sobald ich meinen Schnurrbart abrasiere. Also nie.",
    ],
  },
  pAccessory: {
    group: "person",
    kind: "gossip",
    weight: 8,
    tone: "neutral",
    slots: ["name", "count", "amount", "item"],
    moods: ["laughing", "confused", "smug"],
    frames: [
      {
        headline: "{name} kauft „{item}“",
        text: "Mode-Alarm: {name} hat heute {amount} im Kleiderschrank gelassen, Stückzahl: {count}. Darunter „{item}“. {reason}",
      },
      {
        headline: "{amount} für den Kleiderschrank",
        text: "{name} war einkaufen, Stückzahl: {count}, zusammen {amount}. Das Prunkstück: „{item}“. {reason}",
      },
      {
        headline: "Shoppingrausch bei {name}",
        text: "Das Depot wackelt, aber der Auftritt sitzt: {name} gönnt sich „{item}“ und gibt insgesamt {amount} aus, Stückzahl: {count}. {reason}",
      },
    ],
    reasons: [
      "Die Pixelfigur trägt jetzt, was ein Kostümverleih nach einem Wasserschaden aussortiert. Ich sage das voller Bewunderung.",
      "Stil kann man nicht kaufen. Der Versuch war aber teuer.",
      "Die Rendite dieser Anschaffung liegt bei exakt null, der Unterhaltungswert bei hundert.",
      "Andere investieren in Aktien, hier wird in Auftritt investiert.",
      "Ich habe gelacht, und ich trage diesen Schnurrbart freiwillig.",
      "Der Spiegel im Kleiderschrank hat um Versetzung gebeten.",
      "Wer so etwas trägt, wird wenigstens nie verwechselt.",
      "Das Geld ist weg, aber die Figur ist jetzt unübersehbar.",
    ],
  },
  pOutfit: {
    group: "person",
    kind: "gossip",
    weight: 5,
    tone: "neutral",
    slots: ["name", "count"],
    moods: ["confused", "laughing", "smug"],
    frames: [
      {
        headline: "{name} trägt alles gleichzeitig",
        text: "Modekritik: Die Pixelfigur von {name} trägt gerade {count} Accessoires auf einmal. {reason}",
      },
      {
        headline: "Der Auftritt von {name}",
        text: "{count} Accessoires an einer einzigen Pixelfigur: {name} kennt das Wort „dezent“ nur vom Hörensagen. {reason}",
      },
      {
        headline: "Kleiderschrank explodiert: {name}",
        text: "{name} hat der Pixelfigur den gesamten Kleiderschrank angezogen, {count} Accessoires auf einmal. {reason}",
      },
    ],
    reasons: [
      "Unter all dem Zubehör wird noch nach der Figur gesucht.",
      "Weniger ist mehr, aber mehr ist offenbar noch mehr.",
      "So verkleidet man sich, wenn man dem Finanzamt entkommen will.",
      "Die Pixel haben einen Tarifvertrag gefordert.",
      "Das Haustier auf der Schulter schämt sich sichtbar.",
      "Ich trage nur einen Schnurrbart und bin trotzdem besser angezogen.",
      "Modeexperten sprechen von einem mutigen Statement. Sie meinen das nicht als Kompliment.",
    ],
  },
  pBattleWon: {
    group: "person",
    kind: "gossip",
    weight: 8,
    tone: "good",
    slots: ["name", "count"],
    moods: ["proud", "shocked", "smug"],
    frames: [
      {
        headline: "{name} gewinnt das Battle",
        text: "Und nun zum Sport: {name} hat ein News-Battle mit {count} Teilnehmern gewonnen. {reason}",
      },
      {
        headline: "Sieg für {name}",
        text: "{count} Leute sind angetreten, {name} hat gewonnen. {reason}",
      },
      {
        headline: "Battle-Sieg: {name}",
        text: "Im News-Battle mit {count} Teilnehmern hat {name} alle anderen hinter sich gelassen. {reason}",
      },
    ],
    reasons: [
      "Die Verlierer behaupten geschlossen, ihr Daumen sei eingeschlafen.",
      "Schnelle Finger, schneller Kopf. Schade, dass es an der Börse nicht hilft.",
      "Der Pokal ist aus Pixeln, der Stolz ist echt, die Gegner sind beleidigt.",
      "Ich hätte natürlich gewonnen, darf aber aus Gründen der Fairness nicht mitspielen. Und aus Gründen des Könnens.",
      "Endlich mal etwas gewonnen, werden manche sagen. Ich zum Beispiel.",
      "Die Konkurrenz fordert eine Dopingprobe für die Tastatur.",
      "Ruhm vergeht, aber der Screenshot bleibt.",
    ],
  },
  pBattleLast: {
    group: "person",
    kind: "gossip",
    weight: 8,
    tone: "bad",
    slots: ["name", "count"],
    moods: ["laughing", "smug", "crying"],
    frames: [
      {
        headline: "Letzter Platz für {name}",
        text: "Ebenfalls zum Sport: Im News-Battle mit {count} Teilnehmern hat {name} den letzten Platz geholt. {reason}",
      },
      {
        headline: "Schlusslicht {name}",
        text: "{count} Teilnehmer, und {name} kommt als allerletztes ins Ziel. {reason}",
      },
      {
        headline: "{name} verliert gegen alle",
        text: "Platz {count} von {count}: {name} hat im News-Battle jeden einzelnen Gegner vorbeigelassen. {reason}",
      },
    ],
    reasons: [
      "Dabei sein ist alles. Mehr war es auch nicht.",
      "Der vorletzte Platz hat sich ausdrücklich bedankt.",
      "Es wirkte, als würde jemand mit Ofenhandschuhen spielen.",
      "Die Zuschauer haben zwischendurch gefragt, ob die Verbindung abgebrochen ist. War sie nicht.",
      "Ich habe schon Ladebalken mit mehr Tempo gesehen.",
      "Immerhin ist niemand dahinter, der drängelt.",
      "Für den letzten Platz gibt es keinen Preis, aber diese Erwähnung. Bitte sehr.",
    ],
  },
  pReroll: {
    group: "person",
    kind: "gossip",
    weight: 6,
    tone: "neutral",
    slots: ["name", "count"],
    moods: ["smug", "laughing", "confused"],
    frames: [
      {
        headline: "{name} würfelt Missionen neu",
        text: "{name} hat heute {count}-mal die Missionen neu ausgewürfelt, weil die alten nach Arbeit aussahen. {reason}",
      },
      {
        headline: "Missionen? Lieber andere!",
        text: "{count}-mal hat {name} heute auf „Neue Missionen“ gedrückt. {reason}",
      },
      {
        headline: "{name} sucht die leichteste Mission",
        text: "Wählerisch: {name} tauscht die Missionen {count}-mal aus, bis endlich etwas Bequemes dabei ist. {reason}",
      },
    ],
    reasons: [
      "Die Missionen fühlen sich inzwischen persönlich abgelehnt.",
      "Wer so viel Energie ins Ausweichen steckt, hätte die Aufgabe längst erledigt.",
      "Irgendwo gibt es bestimmt die Mission „Tu nichts“. Die Suche geht weiter.",
      "So gehe ich auch mit Rechnungen um: neu mischen, bis eine kleinere kommt.",
      "Das ist kein Spielen mehr, das ist Speisekartenlesen ohne Bestellung.",
      "Die Mission „Drück nicht auf Neu würfeln“ wäre gescheitert.",
      "Fleiß ist auch keine Lösung, sagt man sich dort offenbar.",
    ],
  },
  pChatty: {
    group: "person",
    kind: "gossip",
    weight: 6,
    tone: "neutral",
    slots: ["name", "count"],
    moods: ["confused", "laughing", "smug"],
    frames: [
      {
        headline: "{name} schreibt {count} Nachrichten",
        text: "Aus der Abteilung Mitteilungsbedürfnis: {name} hat heute {count} Nachrichten im Freundes-Chat verschickt. {reason}",
      },
      {
        headline: "Dauerfeuer im Chat: {name}",
        text: "{count} Nachrichten an einem Tag, alle von {name}. Was drinsteht, wissen wir nicht, wir zählen nur. {reason}",
      },
      {
        headline: "{name} tippt und tippt",
        text: "{name} kommt heute auf {count} Nachrichten im Freundes-Chat. {reason}",
      },
    ],
    reasons: [
      "Die Freunde haben den Chat inzwischen stummgeschaltet und nicken nur noch.",
      "In derselben Zeit hätte man ein Depot analysieren können. Oder einen Roman schreiben.",
      "Der Inhalt bleibt privat, die Menge ist öffentliches Interesse.",
      "Die Tastatur hat einen Antrag auf Kur gestellt.",
      "Wer so viel schreibt, hat entweder viel zu sagen oder gar nichts. Ich tippe auf Zweiteres.",
      "Die Hälfte davon war vermutlich „hahaha“, die andere Hälfte „verkaufen??“.",
      "Bitte dazwischen gelegentlich atmen.",
    ],
  },
  pFriends: {
    group: "person",
    kind: "gossip",
    weight: 6,
    tone: "good",
    slots: ["name", "count"],
    moods: ["confused", "proud", "smug"],
    frames: [
      {
        headline: "Neue Freundschaft für {name}",
        text: "Aus dem Gesellschaftsteil: {name} hat heute {count}-mal eine Freundschaft geschlossen. {reason}",
      },
      {
        headline: "Beliebt wie nie: {name}",
        text: "Neue Freundschaften heute: {count}. {name} sammelt Freunde wie andere Leute Verluste. {reason}",
      },
      {
        headline: "Freundschaftsanfrage angenommen",
        text: "{name} meldet Zuwachs auf der Freundesliste, neue Einträge heute: {count}. {reason}",
      },
    ],
    reasons: [
      "Die Freundschaft hält erfahrungsgemäß bis zum ersten geteilten Aktientipp.",
      "Freunde sind Menschen, die einem beim Geldverlieren zusehen dürfen.",
      "Endlich jemand, der die Depot-Screenshots ertragen muss.",
      "Wir prüfen noch, ob dabei Geld geflossen ist.",
      "Ab jetzt wird gegenseitig angestupst, bis einer aufgibt.",
      "Auf der Freundesliste ist es jetzt wärmer. Im Depot bleibt es kalt.",
      "Ich habe keine Freunde, nur Zuschauer. Das ist günstiger.",
    ],
  },
  pPoke: {
    group: "person",
    kind: "gossip",
    weight: 5,
    tone: "neutral",
    slots: ["name", "count"],
    moods: ["confused", "laughing", "angry"],
    frames: [
      {
        headline: "{name} stupst {count}-mal",
        text: "{name} hat heute {count}-mal andere Leute angestupst. {reason}",
      },
      {
        headline: "Stups-Alarm: {name}",
        text: "{count}-mal wurde heute gestupst, und jedes Mal steckte {name} dahinter. {reason}",
      },
      {
        headline: "{name} kann es nicht lassen",
        text: "Der Zeigefinger des Tages gehört {name}: {count}-mal angestupst. {reason}",
      },
    ],
    reasons: [
      "Die Freundesliste erwägt eine einstweilige Verfügung.",
      "Das ist keine Kontaktpflege mehr, das ist ein Specht.",
      "Aufmerksamkeit kann man auch anders bekommen. Zum Beispiel durch Kursverluste, das klappt bei mir immer.",
      "Die Betroffenen haben zurückgestupst. Es eskaliert.",
      "Irgendwo vibriert gerade ein Handy vom Tisch.",
      "Ein Stups sagt mehr als tausend Worte. Diese Menge sagt: Bitte lies meine Nachricht.",
      "Ich wurde nicht angestupst. Nicht, dass es mich stört. Es stört mich.",
    ],
  },
  pAbsent: {
    group: "person",
    kind: "gossip",
    weight: 8,
    tone: "neutral",
    slots: ["name", "days"],
    moods: ["confused", "crying", "smug"],
    frames: [
      {
        headline: "Vermisst: {name}",
        text: "Suchmeldung in eigener Sache: {name} wurde seit {days} Tagen nicht mehr im Spiel gesehen. {reason}",
      },
      {
        headline: "{name} schläft seit {days} Tagen",
        text: "Seit {days} Tagen kein Login von {name}. Das Depot liegt unbeaufsichtigt herum. {reason}",
      },
      {
        headline: "Wo steckt {name}?",
        text: "{days} Tage Funkstille bei {name}. {reason} Sachdienliche Hinweise bitte in den Chat.",
      },
      {
        headline: "Dornröschenschlaf: {name}",
        text: "{name} hat sich vor {days} Tagen ausgeloggt und das Depot einfach stehen lassen. {reason}",
      },
    ],
    reasons: [
      "Das Depot hat inzwischen angefangen, mit sich selbst zu reden.",
      "Auf dem Konto liegt Staub. Wir haben nachgesehen.",
      "Vermutlich die klügste Anlagestrategie auf dem ganzen Server: nichts anfassen.",
      "Die Aktien haben eine Suchanzeige aufgegeben.",
      "Wer nicht handelt, verliert nichts. Diese Logik macht mir Angst, weil sie stimmt.",
      "Die Zimmerpflanze im Depot wurde seitdem nicht gegossen.",
      "Wir haben geklingelt. Es hat nur das Echo aufgemacht.",
      "Komm zurück, wir haben sonst niemanden, über den wir so schön lästern können.",
    ],
  },
  pBoss: {
    group: "person",
    kind: "gossip",
    weight: 8,
    tone: "neutral",
    slots: ["name", "victim", "company"],
    moods: ["shocked", "laughing", "smug"],
    frames: [
      {
        headline: "{name} feuert {victim}",
        text: "Personalie des Tages: {name} hat {victim} bei {company} vor die Tür gesetzt. {reason}",
      },
      {
        headline: "Rauswurf bei {company}",
        text: "Bei {company} wurde aufgeräumt: {victim} ist raus, unterschrieben hat {name}. {reason}",
      },
      {
        headline: "{victim} fliegt, {name} winkt",
        text: "Kündigung bei {company}: {name} trennt sich von {victim}, im gegenseitigen Einvernehmen einer einzigen Person. {reason}",
      },
    ],
    reasons: [
      "Der Karton mit den persönlichen Sachen stand schon gepackt bereit. Seit Wochen.",
      "Das Kündigungsgespräch dauerte kürzer als diese Meldung.",
      "Als Abschiedsgeschenk gab es einen Kugelschreiber. Er muss zurückgegeben werden.",
      "Der Chefsessel hat dabei nicht einmal gequietscht.",
      "In der Kaffeeküche wird bereits um den frei gewordenen Schreibtisch gewürfelt.",
      "Das Arbeitszeugnis lautet: „War anwesend.“",
      "Führung heißt, schwere Entscheidungen zu treffen. Diese fiel offenbar erstaunlich leicht.",
    ],
  },
  pPromoted: {
    group: "person",
    kind: "gossip",
    weight: 6,
    tone: "good",
    slots: ["name", "company"],
    moods: ["proud", "smug", "shocked"],
    frames: [
      {
        headline: "{name} steigt auf",
        text: "Karriere-Nachrichten: {name} wurde bei {company} befördert. {reason}",
      },
      {
        headline: "Beförderung bei {company}",
        text: "{company} hat {name} eine Stufe nach oben geschoben. {reason}",
      },
      {
        headline: "Neuer Titel für {name}",
        text: "{name} hat bei {company} jetzt einen längeren Titel auf der Visitenkarte. {reason}",
      },
    ],
    reasons: [
      "Mehr Verantwortung, mehr Meetings, dieselbe Kaffeemaschine.",
      "Die Kollegen gratulieren mit Lächeln und geballter Faust in der Tasche.",
      "Befördert wird, wer nicht schnell genug wegläuft.",
      "Der neue Titel passt kaum noch auf das Türschild.",
      "Ab jetzt darf man andere Leute zu Besprechungen einladen. Macht korrumpiert.",
      "Das Gehalt steigt, die Freizeit hat sich verabschiedet.",
      "Glückwunsch. Von oben sieht man die Fehler der anderen viel besser.",
    ],
  },
  pFounderPay: {
    group: "person",
    kind: "gossip",
    weight: 8,
    tone: "neutral",
    slots: ["name", "company", "amount", "pct"],
    moods: ["angry", "smug", "laughing"],
    frames: [
      {
        headline: "{name} genehmigt sich {amount}",
        text: "{name} hat sich heute bei {company} {amount} selbst ausgezahlt, bei einer Quote von {pct} vom Gewinn. {reason}",
      },
      {
        headline: "Chefgehalt bei {company}: {amount}",
        text: "Gehaltsverhandlung mit sich selbst gewonnen: {name} überweist sich aus {company} {amount}, Quote {pct}. {reason}",
      },
      {
        headline: "{pct} vom Gewinn für {name}",
        text: "Bei {company} gilt: erst die Chefetage, dann lange nichts. {name} nimmt sich {pct} vom Gewinn, heute {amount}. {reason}",
      },
    ],
    reasons: [
      "Die Gehaltsverhandlung fand vor dem Badezimmerspiegel statt und verlief harmonisch.",
      "Die Firma wurde gefragt und hat aus Schwäche nicht widersprochen.",
      "Leistung muss sich lohnen. Notfalls lohnt sie sich eben ohne Leistung.",
      "Der Aufsichtsrat besteht aus einer Person und einem Kaktus. Der Kaktus hat sich enthalten.",
      "Für Investitionen blieb ein freundlicher Gedanke übrig.",
      "Man gönnt sich ja sonst alles.",
      "Die Belegschaft bekam dafür ein Dankeschön per Rundmail.",
    ],
  },
  pProperty: {
    group: "person",
    kind: "gossip",
    weight: 6,
    tone: "good",
    slots: ["name", "what"],
    moods: ["smug", "shocked", "angry"],
    frames: [
      {
        headline: "{name}: {what}",
        text: "Aus dem Hochglanzteil: {name} meldet „{what}“. {reason}",
      },
      {
        headline: "Frisch eingekauft: {name}",
        text: "Man zeigt, was man hat: Bei {name} heißt es heute „{what}“. {reason}",
      },
      {
        headline: "{name} gibt Geld aus",
        text: "„{what}“, verkündet {name} stolz. {reason}",
      },
    ],
    reasons: [
      "Die Nachbarn sind informiert und angemessen neidisch.",
      "Besitz belastet. Zum Glück nur das Konto.",
      "Ob das Depot davon wusste, ist nicht überliefert.",
      "Jetzt fehlt nur noch jemand, der es bewundert. Wir haben keine Zeit.",
      "Geld allein macht nicht glücklich, aber man kann damit prima angeben.",
      "Der Kaufvertrag hatte mehr Seiten als die gesamte Anlagestrategie.",
      "Wir gratulieren und erinnern an die Nebenkosten.",
    ],
  },

  // ------------------------------------------------------------------ odd bits (no data needed)
  oddObituary: {
    group: "odd",
    kind: "ramble",
    weight: 4,
    tone: "neutral",
    slots: [],
    moods: ["crying", "smug", "confused"],
    frames: [
      {
        headline: "Wir trauern um ein Depot",
        text: "Die Redaktion muss einen Trauerfall melden. {reason} Wir bitten um eine Schweigeminute. Danke, das reicht.",
      },
      {
        headline: "Nachruf der Stunde",
        text: "Und nun die Rubrik, für die ich extra eine schwarze Krawatte habe. {reason} Von Beileidsbekundungen am Kurs bitten wir abzusehen.",
      },
      {
        headline: "In stillem Gedenken",
        text: "Bitte erheben Sie sich kurz vom Sofa. {reason} Es wird uns fehlen. Also mir nicht, aber irgendwem bestimmt.",
      },
    ],
    reasons: [
      "Das Musterdepot von Gisbert Knallfrosch ist nach langem, tapferem Seitwärtstrend friedlich auf null gegangen.",
      "Die Wurstwasser-Zukunfts-AG hat den Betrieb eingestellt. Sie hinterlässt vierzig Paletten Wurstwasser und keine Zukunft.",
      "Ein Sparbuch aus dem Jahr 1998 wurde heute für wertlos erklärt. Es ging, wie es lebte: bei 0,01 Prozent Zinsen.",
      "Der Kryptocoin „Mondrakete“ ist von uns gegangen. Die Rakete hob nie ab, der Gründer dafür sehr schnell.",
      "Der Hebel von Trader Hubert-Egon Zock war zu lang. Das Depot wurde nur drei Minuten alt.",
      "Der Aktienclub „Die sicheren Gewinner“ hat sich aufgelöst. Die Kasse reichte noch für ein halbes Hefeweizen.",
      "Der gute Vorsatz „Diesmal mit Stop-Loss“ hat uns verlassen. Er wurde nur eine Stunde alt.",
      "Die Pfennigaktie Schrottimmobilien Süd wurde vom Kurszettel genommen. Die Aktionäre erfuhren es aus dieser Sendung.",
      "Ein Bausparvertrag wurde nach dreißig Jahren zuteilungsreif und sofort von der Inflation abgeholt.",
      "Die Geduld von Kleinanlegerin Roswitha Pfennigfuchs ist heute um 9:31 Uhr gerissen. Sie hinterlässt eine Verkaufsorder.",
      "Das letzte Faxgerät des Börsenmaklers Knut Kurswechsel hat aufgegeben. Seine letzte Nachricht: ein Papierstau.",
      "Mein Vertrauen in Analysten ist heute sanft entschlafen. Es hinterlässt drei Kaufempfehlungen.",
    ],
  },
  oddWeather: {
    group: "odd",
    kind: "ramble",
    weight: 4,
    tone: "neutral",
    slots: [],
    moods: ["confused", "smug", "crying"],
    frames: [
      {
        headline: "Das Börsenwetter",
        text: "Und nun das Börsenwetter, präsentiert von niemandem. {reason} Zurück ins Studio. Ich bin das Studio.",
      },
      {
        headline: "Wetteraussichten fürs Depot",
        text: "Ein Blick auf die Großwetterlage am Markt: {reason} Schirm nicht vergessen.",
      },
      {
        headline: "Die Kurs-Vorhersage",
        text: "Unser Wetterfrosch hat gekündigt, also mache ich das: {reason} Alle Angaben ohne Gewähr und ohne Ahnung.",
      },
    ],
    reasons: [
      "Im Tagesverlauf vereinzelt Gewinnmitnahmen, in den Abendstunden flächendeckende Reue.",
      "Von Westen zieht ein Tief aus roten Kerzen herein. Empfindliche Depots bitte reinholen.",
      "Über den Kleinanlegern hängt dichter Nebel. Die Sicht beträgt weniger als einen Kurszettel.",
      "Es bleibt heiter bis pleite, örtlich Schauer aus Nachschusspflichten.",
      "Die gefühlte Rendite liegt deutlich unter der tatsächlichen, und die ist schon negativ.",
      "Es weht ein frischer Wind aus Richtung Finanzamt. Belege bitte festhalten.",
      "Sturmwarnung für Hebelprodukte: Es können ganze Ersparnisse umherfliegen.",
      "Am Wochenende sonnig. Die Börse hat dann geschlossen, das ist kein Zufall.",
      "Hochdruckgebiet über den Dividenden, Bodenfrost in den Sparbüchern.",
      "Achtung, Glatteis auf dem Parkett. Die ersten Analysten sind bereits ausgerutscht.",
    ],
  },
  oddAd: {
    group: "odd",
    kind: "ramble",
    weight: 4,
    tone: "neutral",
    slots: [],
    moods: ["angry", "confused", "smug"],
    frames: [
      {
        headline: "Werbung",
        text: "Diese Sendung wird Ihnen präsentiert von unserem Sponsor. Ich lese das nur vor, weil ich muss: {reason} Ende der Werbung.",
      },
      {
        headline: "Eine Nachricht unseres Sponsors",
        text: "Kurze Unterbrechung, die Miete für das Studio zahlt sich nicht von allein. {reason} So, weiter.",
      },
      {
        headline: "Dauerwerbesendung",
        text: "Die Regie hält ein Schild hoch, darauf steht „Geld“. Also: {reason} Vielen Dank an den Sponsor, wer immer das ist.",
      },
    ],
    reasons: [
      "Bestattungen Abgang und Söhne: Wir tragen auch Ihr Depot würdevoll zu Grabe. Für Stammkunden mit Mengenrabatt.",
      "Die Schuldnerberatung Blanko: Wir kennen Sie bereits aus dieser Sendung.",
      "Reißwolf 3000: der einzige Aktenvernichter, der vor der Betriebsprüfung von allein anspringt.",
      "Kredite von Onkel Zinsfuß: schnell, unbürokratisch und für immer.",
      "Hotel Zur Insolvenz: Bei uns checken Sie aus, bevor Sie zahlen. Wie Ihre Kunden.",
      "Dosenravioli Gourmet: das Abendessen für alle, die gestern gehebelt haben.",
      "Das Seminar „Reich in sieben Tagen“. Der Veranstalter ist es schon, dank Ihrer Anmeldung.",
      "Glaskugel Plus: jetzt mit Garantie. Die Garantie gilt für die Kugel, nicht für die Vorhersage.",
      "Die Versicherung Rundum-Sorglos: Wir zahlen nie, aber wir hören zu.",
      "Taschentücher Marke Baisse: extra saugstark, für Tage wie diesen.",
      "Der Tresor „Luftschloss“: garantiert einbruchsicher, weil nichts drin ist.",
    ],
  },
  oddHoroscope: {
    group: "odd",
    kind: "ramble",
    weight: 4,
    tone: "neutral",
    slots: [],
    moods: ["confused", "smug", "laughing"],
    frames: [
      {
        headline: "Das Depot-Horoskop",
        text: "Die Sterne lügen nicht, sie irren sich nur. Das Horoskop: {reason} Die Sterne übernehmen keine Haftung.",
      },
      {
        headline: "Ein Blick in die Sterne",
        text: "Unsere Astrologin ist im Urlaub, ich lese aus dem Kaffeesatz: {reason} Mehr stand nicht in der Tasse.",
      },
      {
        headline: "Horoskop für Anleger",
        text: "Was sagen die Sterne zum Depot? {reason} Bei Risiken und Nebenwirkungen fragen Sie nicht mich.",
      },
    ],
    reasons: [
      "Steinbock: Du kaufst heute auf dem Höchststand. Wie immer, aber heute mit Ansage.",
      "Zwillinge: Zwei Meinungen, ein Depot, null Gewinn.",
      "Löwe: Du brüllst den Bildschirm an. Der Kurs bleibt unbeeindruckt.",
      "Waage: Du wägst sorgfältig ab und entscheidest dich dann trotzdem falsch.",
      "Skorpion: Der Stachel sitzt heute im eigenen Depot.",
      "Fische: Du schwimmst mit dem Strom, direkt in den Abfluss.",
      "Jungfrau: Deine Buchhaltung ist makellos. Dein Kontostand weniger.",
      "Schütze: Du zielst auf den Mond und triffst die Nachschusspflicht.",
      "Widder: Mit dem Kopf durch die Wand. Dahinter liegt leider noch ein Verlust.",
      "Stier: Dein Tag. Kleiner Scherz, es ist ein Bärenmarkt.",
      "Wassermann: Eine unerwartete Geldquelle tut sich auf. Sie gehört jemand anderem.",
    ],
  },
  oddMail: {
    group: "odd",
    kind: "ramble",
    weight: 4,
    tone: "neutral",
    slots: [],
    moods: ["angry", "smug", "confused"],
    frames: [
      {
        headline: "Zuschauerpost",
        text: "Zeit für die Zuschauerpost. Ja, uns schreibt jemand. {reason} Vielen Dank, bitte schreiben Sie nie wieder.",
      },
      {
        headline: "Der Leserbrief der Stunde",
        text: "Aus dem Postsack, den ich sonst als Kissen benutze: {reason} Die Redaktion hat nicht geantwortet.",
      },
      {
        headline: "Sie fragen, ich antworte nicht",
        text: "Wieder hat uns ein Brief erreicht, trotz falscher Adresse. {reason} So viel dazu.",
      },
    ],
    reasons: [
      "Herr Bömmel aus Castrop fragt, ob er sein Erspartes in Aktien stecken soll. Fragen Sie jemanden, der sich auskennt. Also nicht mich.",
      "Frau Zwirbel schreibt, ich sei unseriös. Frau Zwirbel, das steht so in meinem Vertrag.",
      "Ein Zuschauer möchte wissen, wann die Kurse wieder steigen. Sobald Sie verkauft haben, wie immer.",
      "Familie Knösel bittet um einen sicheren Anlagetipp. Mein Tipp: ein Kissen. Darauf kann man wenigstens schlafen.",
      "Herr Dröge beschwert sich, mein Tipp von letzter Woche sei falsch gewesen. Das war kein Tipp, das war eine Charakterprüfung.",
      "Ein Kind fragt, was ein Bärenmarkt ist. Frag deinen Vater, warum er im Keller sitzt und leise rechnet.",
      "Frau Pottkamp möchte ihr Geld zurück. Ich auch, Frau Pottkamp. Ich auch.",
      "Ein Herr Griesgram vom Finanzamt bittet um Rückruf. Der Brief ist leider in den Reißwolf gefallen. Dreimal.",
      "Oma Hildegard schickt Kekse und eine Verkaufsempfehlung für alles. Die Kekse waren gut.",
      "Ein anonymer Zuschauer nennt mich einen Scharlatan mit Schnurrbart. Der Schnurrbart ist echt, mehr sage ich dazu nicht.",
    ],
  },
  oddStudy: {
    group: "odd",
    kind: "ramble",
    weight: 4,
    tone: "neutral",
    slots: [],
    moods: ["confused", "smug", "shocked"],
    frames: [
      {
        headline: "Neue Studie schockiert niemanden",
        text: "Das Institut für angewandte Ratlosigkeit hat geforscht. Ergebnis: {reason} Die Studie hat ein Vermögen gekostet.",
      },
      {
        headline: "Die Wissenschaft hat festgestellt",
        text: "Forscher der Universität Hinterdupfing melden: {reason} Weitere Forschung ist nötig, sagen die Forscher, die dafür bezahlt werden.",
      },
      {
        headline: "Zahl der Stunde",
        text: "Aus der Welt der Statistik, die ich selbst nicht verstehe: {reason} Ich habe das nicht überprüft und werde es auch nicht tun.",
      },
    ],
    reasons: [
      "Neun von zehn Anlegern halten sich für besser als der Durchschnitt. Der zehnte hat die Frage nicht verstanden und die beste Rendite.",
      "Wer seltener ins Depot schaut, lebt ruhiger. Wer nie hineinschaut, hat vermutlich keins mehr.",
      "Aktien fallen am liebsten direkt nach dem Kauf. Der Effekt ist messbar und persönlich gemeint.",
      "Ein Goldfisch schlägt bei der Aktienauswahl zwei von drei Experten. Der dritte Experte war ebenfalls ein Goldfisch.",
      "Geld macht nicht glücklich. Die Teilnehmer der Studie wollten es trotzdem nicht zurückgeben.",
      "Der durchschnittliche Anleger liest drei Analysen und hört dann auf seinen Schwager.",
      "Menschen mit Stop-Loss schlafen besser. Menschen ohne Stop-Loss schlafen gar nicht.",
      "Die häufigsten letzten Worte eines Depots lauten: „Das erholt sich wieder.“",
      "Im Schnitt wird ein Geheimtipp 400-mal weitergegeben, bevor er jemanden erreicht, der ihn glaubt.",
      "Sieben von zehn Vorsätzen an der Börse halten bis zur ersten roten Kerze.",
    ],
  },
} as const;

export const NEWS_TOPICS = { ...NEWS_TOPICS_BASE, ...NEWS_TOPICS_FRESH } as const;

export type NewsTopicKey = keyof typeof NEWS_TOPICS;
export type NewsTopicGroup = (typeof NEWS_TOPIC_GROUPS)[number];

/** More digressions for the old "ramble" script (ADR-152): absurd, harmless rumours and his private misery. */
export const NEWS_RAMBLE_EXTRA = [
  "Mein Steuerberater hat mich umarmt und geweint. Ich weiß nicht, wer von uns beiden mehr Angst hatte.",
  "Markus Söder soll angeblich eine Sammelkarte von sich selbst gezogen haben. Er lässt sie bewerten, erwartet wird eine 11.",
  "Elon Musk möchte angeblich das Finanzamt kaufen und umbenennen. Oberamtsrat Griesgram hat abgelehnt, per Fax.",
  "Günther Jauch soll bei einer Sammelkarte den Publikumsjoker gezogen haben. Das Publikum riet zu einem weiteren Booster.",
  "Heidi Klum hat angeblich mein Depot gesehen und gesagt, es habe heute leider kein Foto. Das Depot weint noch.",
  "Dieter Bohlen will angeblich Bilanzen vertonen. Die erste Single heißt „Soll und Haben und Du“.",
  "Im Fahrstuhl meines Hauses wohnt jetzt ein Unternehmensberater. Er berechnet pro Etage.",
  "Mein Kühlschrank hat ein Update bekommen und verweigert mir seitdem den Käse. Er nennt es Compliance.",
  "Die Bahn hat mir eine Entschuldigung geschickt. Sie kam drei Tage zu spät.",
  "Ich habe einen Beleg über 80 Meter Gartenschlauch gefunden. Ich habe keinen Garten. Ich habe Fragen an mich.",
  "Thomas Gottschalk soll angeblich Gummibärchen als Währung vorgeschlagen haben. Die Bundesbank prüft die Geschmacksrichtungen.",
  "Friedrich Merz soll angeblich einen Bierdeckel verloren haben, auf dem seine gesamte Steuererklärung stand.",
  "Robert Habeck soll angeblich ein Kinderbuch über eine traurige Aktie schreiben. Am Ende wird sie umarmt.",
  "Ich war gestern auf der Trauerfeier für einen Bausparvertrag. Es kam nur die Bank, und die kam zu spät.",
  "Meine Schwiegermutter handelt jetzt mit Optionen. Ich habe die Schlösser ausgetauscht.",
  "Christian Lindner soll angeblich ein Sparschwein adoptiert haben. Es heißt Schuldenbremse und darf nicht geöffnet werden.",
  "Donald Trump soll angeblich die größte Sammelkarte aller Zeiten besitzen. Niemand hat sie gesehen, aber sie sei riesig.",
  "Mein Navi hat mich gestern zum Finanzamt geleitet. Ich wollte zum Bäcker. Das Navi weiß etwas.",
  "Der Praktikant hat mein Depot versehentlich ausgedruckt. Es passte auf einen Kassenzettel.",
  "Ich habe meinem Sparschwein ins Gesicht gesehen. Es hat weggeschaut.",
] as const;
