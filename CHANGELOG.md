# Changelog

## M0 Fundament

Erste, navigierbare Fassung ohne Spiellogik.

- Projekt: Next.js 16, TypeScript strict, Tailwind 4, Supabase-Anbindung, Vitest, Playwright, Prettier, Husky.
- Design: Tokens für Farben, Schrift, Radien, Motion und Ebenen in dunklem und hellem Theme mit fünf
  Akzentfarben; Komponentenbibliothek mit Showcase unter `/dev/ui`; erstes Pixel-Art-Set.
- App: fünf Tabs (Start, Portfolio, Märkte, Firma, Profil) mit Seitenleiste am PC und Tab-Leiste am Handy,
  Suche, Aktien-Detail mit Order-Vorschau, Anmeldung und Registrierung, Einstellungen, PWA-Grundlage.
  Ohne Supabase-Zugangsdaten läuft alles im Demo-Modus mit Beispieldaten.
- Datenbank: vollständiges Schema (132 Tabellen) mit RLS, Ledger in doppelter Buchführung, Registrierungs-Trigger
  und Stammdaten (15 KI-Firmen, Anleihen, Index, Jobs, Erfolge). Lokal gegen Postgres 16 geprüft.
- Simulation: Balancing-Konfiguration, Typen und getestete Formeln; Tick und Quartal als Entwurf.
- Dokumentation: Game Design, Architektur, Datenmodell, Simulation, Balancing, Design-System, Roadmap, ADRs.

Noch offen: Deploy auf Vercel, Test der Anmeldung gegen ein echtes Supabase-Projekt.

## Nach M0: Einstieg für neue Spieler

- **Tutorial mit Finn, dem Börsenfuchs:** 13 kurze Schritte direkt nach dem ersten Start, nicht überspringbar,
  mit Sprechblase, Spotlight und echten Aktionen (Tresor leeren, Aktie öffnen, kaufen). Abschluss: 100 XP, Level 2.
- **Ruhigerer Anfang:** Neue Spieler sehen nur Vermögen, Tresor, nächstes Ziel und Aktien. Index, Missionen,
  Events, Nachrichten, Orderbuch, Anleihen und der Firmen-Tab erscheinen mit steigendem Level.
- **Spielregeln** in einfacher Sprache unter Profil → Spielregeln.
- **Unternehmen:** eigener Markt je Firmenstufe, Schonfrist vor der Insolvenz, doppelte XP in der Alpha.
- Der Demo-Spieler startet auf Level 1.

## M1 Markt

- **Live-Markt in der Datenbank:** Die 15 KI-Firmen, vier Staatsanleihen und der NEXA 30 bewegen sich alle
  5 Sekunden, auch wenn niemand online ist. Kursanker ist der faire Wert aus den Firmenzahlen, dazu Marktmacher,
  Value-Fonds, Momentum-Trader und Kleinanleger. Blue Chips schwanken am Tag um etwa 3 %, Pennystocks um 15 bis 20 %.
  Nachbörslich (22 bis 8 Uhr) ist der Spread dreimal so groß.
- **Handeln:** Sofort- und Limit-Orders, Kauf per Stückzahl oder Geldbetrag, 1 € Gebühr, 25 % Steuer mit
  Verlusttopf, große Orders bewegen den Kurs. Doppelklicks erzeugen keine doppelten Orders.
- **Staatsanleihen** ab Level 5 mit Zinsen je Quartal und Rückzahlung bei Fälligkeit; **Limit-Orders** ab Level 3.
- **Level schon in M1:** XP für Trades (doppelt in der Alpha) und für das Tutorial, Freischaltungen prüft der Server.
- **Quartalszahlen** der KI-Firmen alle sechs Stunden mit Nachrichten auf der Aktienseite.
- **Oberfläche:** Kerzen- oder Linienchart mit live wachsender Kerze, Orderbuch, Kennzahlen, Portfolio mit
  Gewinn/Verlust, offenen Orders und Historie, Level-up-Fenster mit Finn.
- **Spätere Features sind sichtbar, aber gesperrt** (Firma, Anleihen, Limit, Liste aller Stufen).
- **Neue Sounds:** zwölf weiche Effekte in einer Tonart.
- Offen: Einspielen ins Supabase-Projekt und Test mit echten Konten.

## Nach M1: Wettbewerb und Fortschritt

- **Bruchstücke von Aktien:** Kauf per exaktem Betrag (Standard) oder per Stückzahl mit Nachkommastellen,
  Mengen-Regler mit 25/50/75/100 % statt Tippen.
- **Geschlossener Geldkreislauf:** Die Spielwelt hat einmalig 10 Mrd. €, danach entsteht kein Geld mehr.
  Grundeinkommen und Startkapital kommen aus der Staatskasse, Steuern und Gebühren fließen zurück.
- **Reichenliste:** alle Spieler und 120 KI-Tycoons live, eigener Platz mit Abstand zum nächsten, Schlagzeilen.
- **Missionen von Anfang an:** schnelle, tägliche, wöchentliche und Story-Missionen, täglicher Bonus mit Serie.
- **Endlose Level** mit Titeln und Prestige-Stufen; Finn erklärt neue Funktionen (Limit-Order, Anleihen).
- **Spielername** statt „Gast“, alle 60 Tage änderbar, Filter gegen Schimpfwörter und reservierte Namen.
- Konzept für Garagen-Startups und Firmen als Clans mit Chat (`docs/ECONOMY.md`), Umsetzung mit M4/M5.

## M4i und M4j: Aufstieg, Verbesserungen und Vertrauen

- **Verbesserungen:** Für Spielgeld wird der Tresor größer (8 bis 20 Stunden), das Grundeinkommen etwas höher
  (bis +30 %), Fachpunkte kommen schneller, es gibt bis zu 14 bezahlte Stunden am Tag und bessere
  Beförderungschancen. Jede Stufe zeigt „jetzt → danach“.
- **Karriereleiter:** Praktikum, Junior, Senior, Teamleitung, Vorstand. Für jede Stufe steht da, was fehlt:
  Level, Punkte im Hauptfach, ab Teamleitung Management, Stunden im Rang. KI-Chefs sagen mit einer Chance Ja, die mit
  jedem Punkt über der Anforderung steigt; Spieler-Chefs entscheiden selbst. Eine Beförderung bringt mindestens
  15 % oder den Lohn des neuen Rangs.
- **Skillpunkte erklärt:** Level, Arbeit, Tagesbelohnung, Missionen und Schulungen mit ihrem Fortschritt, dazu,
  wofür Skills gut sind.
- **Gewinnwege:** Die Firmenseite nennt den Engpass (Kunden oder Leute) und schätzt für jeden Hebel, was er pro
  Stunde bringt. Neu: Marketing-Kampagnen mit Glück im Ergebnis.
- **Deals unter Spielern:** Kredite, Lieferverträge (freie Kapazität gegen Gebühr) und Teilhaber, an einen
  Spieler oder offen auf der Deal-Börse. Wer Wort hält, gewinnt Vertrauen; wer zu spät zahlt oder bricht, verliert es,
  und alle sehen es auf der Visitenkarte.

## M4k und M5a: Krypto, Stufen, Ebenen, eindeutige Namen, Anwesenheit

- **Kryptowährungen ab Level 10** unter „Krypto“: 15 Coins von Stablecoins bis Memecoins, rund um die Uhr, jeder
  Kauf bewegt den Kurs über einen Topf aus Geld und Coins. Krypto-Wetter (Bullen-, Bären-, Seitwärtsmarkt),
  Ereignisse wie Hacks, Wale, Influencer und Rug Pulls, tote Memecoins werden ersetzt. Handelsmaske mit Gebühr,
  Kursrutsch-Vorschau und Grenze.
- **Eigener Coin ab Level 14** im Coin-Studio: Name, Kürzel und Pixel-Logo, Aufgaben fürs Team (Technik, Hype,
  Nutzen), Start mit eigenem Geld im Topf und Team-Anteil, Coins verbrennen, Rug-Pull-Warnung, Einstellen mit
  Auszahlung an alle Halter.
- **Verbesserungen mit Level-Stufen** und fünf neuen Verbesserungen (Mentor, Kunststudio, Effizienz, Makler,
  Hardware-Wallet).
- **Drei Ebenen beim Einrichten:** Teppich, Möbel, kleine Dinge auf Tischen und Theken.
- **Eindeutige Namen** für Firmen, Kunstwerke und Coins; wer seine Firma auflöst, gibt den Namen frei.
- **Deals nach Firmenwert:** große Deals erst mit einer wertvolleren Firma.
- **Anwesenheit:** 8 bezahlte Stunden am Tag, weniger Lohn nach 1, 2 und 3 Tagen Abwesenheit, nach 5 Tagen
  gekündigt (Benachrichtigung an Spieler und Chef).
- **Organigramm** der Firma mit Gründer, Rängen und KI-Kräften.

## Nach M5a: Ruhigeres Menü, Börse rund um die Uhr

- **Keine Nachbörse mehr:** Die Börse ist rund um die Uhr regulär offen, auch nachts ohne breiteren Spread.
- **Menü in Gruppen:** Investieren (mit Krypto), Arbeit, Unternehmen, Besitz, Du. Gesperrtes steht gesammelt unter
  „Bald frei“, das Profil auf dem Profilbild oben rechts.
- **Skills als Pfade** mit „Jetzt lernbar“, die Karte als zweite Ansicht.
- **Neue Symbole** für Deals (Vertrag mit Feder) und Grundstück (Haus mit Garten).
- **Grundstück:** drei Ebenen im Editor und detailreichere Möbel.

## Grafik-Update „handgemacht“ (ADR-108)

- **Neue Farbwelt:** Nachthimmel im dunklen, warmes Papier im hellen Thema, dahinter Punktraster und aufsteigende
  Pixel-Stäubchen.
- **Flächen und Tasten mit Gewicht:** kleine Ecken, dicke Ränder, harte Kanten; Buttons sinken beim Drücken ein und
  sprühen Funken.
- **Banner auf jeder Seite** mit Titel, einem Satz und schwebendem Pixel-Bild.
- **Titelbildschirm** bei Anmeldung und Registrierung: Sternenhimmel, Mond, Skyline mit Lichtern, Finn begrüßt.
- **Mehr Bewegung:** Inhalte kommen gestaffelt an, Icons hüpfen, Balken sind segmentiert, das Vermögen glänzt, die
  Münze am Guthaben hüpft bei jeder Änderung.

## Startseite, Währung zur Wahl, Freundescode

- **Kein Geld mehr aus der eigenen Aktie (ADR-170):** KI-Anleger zeichnen Kapitalerhöhungen nur noch bis zum fairen
  Wert, Ausgabeerlöse bleiben drei Tage in der Firma, nach einer Entnahme gibt es 24 Stunden keinen Kauf der eigenen
  Aktie, und Spieleraktien bewegen sich je Tag höchstens 30 %.

- **Lebendigere NFT-Sammler (ADR-170):** Sammler bieten alle paar Stunden neu, handeln den ganzen Tag unter sich und
  bieten in deinen Auktionen mit, nie über ihrer Bewertung.

- **Black Label und ASP-Paket (ADR-165):** Über der ASP 10 steht jetzt das Black Label: Nur 1 % der Mint-Karten
  bekommen es, der Slab ist das 10-Fache der Karte wert. Bewertete Karten kommen in einem versiegelten Paket zurück,
  das du selbst aufreißt; die Note wird langsam enthüllt. Im Booster-Fenster zeigt jede Karte beim Drüberfahren
  ihren Marktwert.

- **Collectibles (ADR-165):** Unter „Collectibles“ wählst du ein Booster, siehst alle Karten des Sets mit ihren
  Chancen und reißt die Folie nach dem Kauf selbst auf, mit eigenen Tönen für gute Züge. Dazu Sammelalbum,
  Kartenansicht mit Wertverlauf, Kartenmarkt und ASP-Schalter. Prismatic Peak kostet jetzt 10.000 €, seine Karten
  sind dafür das 1,5-Fache wert.

- **Kartenzustand zählt mehr:** Eine lose Poor-Karte ist 70 % ihres Marktwerts wert, Good 90 %, Near Mint und Mint
  100 %.
- **Grading günstiger:** ASP verlangt nur noch 30 % des Kartenwerts statt 50 %.
- **Nexamon-Sammelkarten (ADR-165):** Ab Level 10 ziehst du Booster aus drei Sets, lässt Karten bei ASP bewerten und
  handelst sie an einem Markt, an dem Knappheit und Nachfrage den Wert jeder Karte bestimmen.

- **Faire Missionen, neu würfeln (ADR-166):** Missionen verlangen nichts mehr, was du dir gerade nicht leisten kannst,
  und einmal am Tag tauschst du unter Missionen alle offenen gegen neue.

- **Firma, Fehlerbehebungen (ADR-168):** Geschäftszüge zeigen groß, wann sie wieder möglich sind, laufende Kampagnen
  ihre Restlaufzeit (auch als Zeile über den Abteilungen). Die Stundenabrechnung bleibt nicht mehr für alle stehen,
  wenn eine Firma hakt; „Wo es fehlt“ kennzeichnet Schätzwerte, und Serverfehler nennen ihren echten Grund.

- **Börsennotierte Firmen werden ernst (ADR-167):** Ab dem Börsengang gibt es Forschung, neue Produkte, Märkte,
  Maschinen und Zukäufe, dazu Mitarbeiterzufriedenheit mit Benefits (vom Obstkorb bis zur Viertagewoche), einen Ruf,
  der unter gierigen Gründern leidet, Dividenden, einen Geschäftsrat für Aktionäre mit über 20 % sowie Buchhaltung und
  Steuern mit Finanzamt und Steuerberater. Mira erinnert an alles.

- **Chats mit Freunden (ADR-164):** Unter Freunde → Chats schreibst du Freunden direkt (💬 an ihrer Figur auf dem
  Platz) oder gründest Gruppen mit bis zu 20 Leuten, mit Emojis, ungelesenen Nachrichten und Benachrichtigung.

- **Wo es fehlt (ADR-162):** Oben in der Firmenübersicht zeigt ein Netzdiagramm acht Punkte (Bekanntheit, Menge,
  Qualität, Image, Preis, Team, Kasse, Schwung), wo du gerade am meisten verlierst und was ein Fix pro Stunde bringt.
  „Mit Mira angehen“ fragt Mira, und sie antwortet mit Knöpfen, die es gleich erledigen.

- **Zehn neue News-Battles (ADR-160):** Bärenjagd, Dividenden-Dash, Margin Call, Fahrstuhl zum Mond, Laserschranke
  und Bullen-Rodeo zum Steuern, dazu Tresorknacker, Ticker-Tippen, Mehr oder Weniger und Wer bietet mehr?.

- **Wohnen lohnt sich (ADR-161):** Wer ein Zuhause hat oder zur Miete wohnt, bekommt jede Stunde einen Wohnbonus in Geld
  und XP, mehr in größeren und schöner eingerichteten Zuhausen. Möbel kosten in größeren Zuhausen mehr, aufgestellt
  steigern sie den Wert deines Zuhauses. Die Miete legst du jetzt frei fest.

- **Das Büro lebt (ADR-156):** Auf deiner Job-Seite und auf der Seite deiner Firma stehen jetzt alle Kollegen als ihre
  angezogenen Spielfiguren am Schreibtisch, mit Namen. Wer gerade online ist, wippt, wer weg ist, schläft (zzz). Tipp
  auf eine Figur für das Profil. Unter dem Büro schreibst du „Sag was ins Büro …“: Deine Worte stehen zwei Minuten als
  Sprechblase über deiner Figur und landen im Firmenchat. Auch Organigramm und Teamliste zeigen die Figuren.

- **Kleiderschrank: zweite Kollektion (ADR-155):** 74 neue Teile, jetzt 125 insgesamt, in zwölf Sets: Piraten mit
  Augenklappe und Säbel, Raumfahrt mit Strahlenpistole und Mini-UFO, Ritterhelm und Rüstung, Zauberhut, Zauberbart und
  Eule, E-Gitarre, Goldpokal, Weihnachtspulli und Kürbiskopf, Büro & Börse mit Geldkoffer und Bärenmarkt-Bär, dazu
  Völlig Absurdes wie Klopapierkrone, Aluhut, Gartenzwergkostüm, Entchen-Schwimmring, Pümpel, Einkaufswagen voller
  Klopapier, Haustierstein und Discokugel. Neu ist die Seltenheit **Mythisch**: Phönixflügel, Königsmantel, Zepter,
  Diamantmonokel, Geldregenwolke und der Goldene Bulle für 150 bis 900 Mio. €. Alles ist deutlich teurer geworden
  (Gewöhnliches ab 450 €, Legendäres bis 75 Mio. €). Damit man den Überblick behält: Suche, Filter nach Bereich und
  Seltenheit, Sortieren nach Preis, „Nur bezahlbare“ und die Ansicht „Nach Sets“.

- **Vermieten und Wohnwert (ADR-158):** Dein Zuhause hat jetzt einen **Wohnwert** von 0 bis 100. Er steigt mit
  wertvollen Möbeln, Abwechslung, einem gut gefüllten (aber nicht vollgestellten) Raum, Teppichen, Kleinkram auf dem
  Tisch, einem einheitlichen Stil und einem edlen Boden; der Raum-Editor zeigt ihn live mit Tipps. Ab Level 8
  vermietest du Plätze in deinem Zuhause, pro Stunde oder pro Tag: KI-Mieter ziehen umso schneller ein, je schöner es
  ist und je fairer der Preis, und zahlen jede Periode im Voraus. Im neuen **Mietmarkt** mietest du dich selbst bei
  anderen Spielern ein und bekommst Wohlfühl-XP. Alle Mieter laufen als Pixelfiguren mit Namensschild durch den Raum,
  auch auf dem Profil. Neue Missionen, Meldungen bei Ein- und Auszug und einmal am Tag die Mieteinnahmen.

- **Studiopublikum bei den NEXA Nachrichten (ADR-157):** Unter dem Fernseher sitzt jetzt das Publikum auf dem
  Studiosofa: alle, die gerade zuschauen, als angezogene Pixelfigur, du selbst und deine Freunde vorn. Wer im
  Live-Chat schreibt, bekommt eine Sprechblase über dem Kopf, auch die schrägen Stammzuschauer mit ihren eigenen
  Outfits. Und geht es in einer Meldung um dich, zeigt Mr. Doodle Dangle dein Bild, im aktuellen Outfit und mit
  passender Unterschrift von „Gewinner der Stunde“ bis „Gesucht“.

- **News-Battles (ADR-160):** Unter den Nachrichten treten jetzt 3 bis 10 Zuschauer gegeneinander an, nur einer
  gewinnt dicke XP, Geld, ein NFT oder einen Skin, den es nirgends zu kaufen gibt. Neun Minispiele: Kurssturz,
  Bullenreiten, Geldregen, Sumo am Parkett, Giftaktie und Aktie pumpen mit WASD oder Joystick, dazu Börsenquiz,
  Schätz den Kurs und Die Glocke.

- **Kleiderschrank und Freunde-Platz (ADR-155):** Deine Spielfigur steht jetzt in voller Größe da und lässt sich
  anziehen: 51 verrückte Accessoires vom Cowboyhut über Bananenkostüm, Haikostüm und Laseraugen bis zu Papagei,
  Jetpack und goldener Klobürste. Unter Profil → Kleiderschrank probierst du alles an und kaufst mit Spielgeld, von
  150 € bis 5 Mio. €. Im Freunde-Tab stehen alle deine Freunde als Figuren auf einem Platz, wer online ist, hat ein
  grünes Schild über dem Kopf. Tipp auf eine Figur für das Profil, oder stups sie mit 👉 an: Sie bekommt eine
  Benachrichtigung.

- **Börsengang in 10 Minuten (ADR-146):** Die Zeichnung dauert höchstens 10 Minuten statt 12 Stunden. Sind alle
  Aktien gezeichnet, ist die Firma sofort an der Börse; sonst nach Ablauf mit dem, was gezeichnet wurde. Ein Balken
  zeigt, wie viel schon gezeichnet ist, ein Countdown die Restzeit. KI-Investoren zeichnen über die Zeit mit. Zeichnen
  geht mit einem Tipp: 100 €, 1.000 €, 10.000 € oder gleich den ganzen Rest.
- **Spielerfirmen am Aktienmarkt (ADR-145):** Börsennotierte Firmen von Spielern stehen in derselben Liste wie die
  KI-Aktien, mit dem Schild „Spieler“. Neue Sortierung „Beliebt“ (Standard): Aktien, die oft angesehen werden und in
  die viele investieren, stehen weiter oben. Mit „Spieler“ siehst du nur Spielerfirmen; „A–Z“ und „Bewegung“ gibt es
  weiter.

- **Ruhige Startseite (ADR-109):** Finn begrüßt, groß das Vermögen, genau eine nächste Aufgabe, der Tresor und drei
  Kacheln. Feed, Liga, Index und Termine stehen auf ihren eigenen Seiten.
- **Währung zur Wahl (ADR-113):** Das Spiel zeigt Euro. Unter Profil → Einstellungen kannst du stattdessen Dollar
  oder NX wählen. Es ändert sich nur das Zeichen, alle Beträge bleiben gleich. Der Stablecoin heißt jetzt
  „Eins-Stabil“.
- **Freundescode (ADR-111):** Im Profil steht dein Code (z. B. `NEXA-K7Q2`) zum Kopieren und Teilen. Wer den Code
  eines Freundes dort einträgt, bekommt einmalig 5.000 €; der Freund erfährt es per Benachrichtigung.
- **Registrierung ohne Einladungscode (ADR-114):** E-Mail, Passwort, Spielername und die 18+-Bestätigung reichen.
- **Skills der Reihe nach (ADR-115):** Jeder Skill hat eine Voraussetzung, zum Beispiel Programmierung erst nach den
  IT-Grundlagen. Die Karte ist immer zu sehen und neu gezeichnet: ruhige Kacheln ohne Farbstreifen, Linien zeigen
  den Weg, Namen sind ausgeschrieben.
- **Nur noch Sofort-Orders (ADR-117):** Limit-Orders und das Tutorial dazu sind entfernt.
- **Bedienung:** Das Mausrad zoomt die Skill-Karte, ohne die Seite zu scrollen; der Betrags-Regler zieht das
  Order-Fenster nicht mehr weg.
- **Stabilität:** Der Minuten-Job hängt nicht mehr an der Rangliste, Datenbank-Updates laufen in kleinen Schritten.
- **Börsen-News (ADR-119):** Auf der Märkte-Seite kündigen Meldungen an, welche Aktie bald steigen oder fallen
  dürfte. Etwa drei von vier treffen ein.
- **Schnellere Beförderung (ADR-118):** Eine bezahlte Stunde zählt als ganzer Tag im Rang.
- **Spieler bewegen den Markt (ADR-120):** Käufe und Verkäufe wirken etwa fünfmal so stark auf den Kurs.
- **Kündigen in einer Stunde** statt einem Tag; sofort gegen einen Tageslohn bleibt möglich.
- **Portfolio nach Branche sortierbar**, Visitenkarte ohne gestauchten Text.
- **Investments auf Profilen (ADR-121):** Freunde sehen, worin du investiert bist und wie viel.
- **Flüssiger mit mehreren Spielern (ADR-123):** Marktübersicht einmal pro Takt, Minuten-Aufgabe in kurzen Teilen,
  weniger Abfragen pro Spieler.
- **Vermögensverlauf (ADR-124)** im Portfolio, 24 Stunden oder 7 Tage.
- **Firmen ansehen (ADR-125):** jede Firma mit Team und Kennzahlen, auch die von Freunden.
- **Mehr Börsen-News:** 30 Ereignisse, gute wie schlechte.
- **Benachrichtigungen:** Der Zähler verschwindet beim Öffnen sofort, Meldungen oben schließen sich per Tipp.
- Laufende Limit-Missionen sind beendet.
- **Geschäftszüge (ADR-127):** Firmen verdienen jetzt aktiv. 96 Züge, die zum Produkt passen (Klinik-Express,
  Penetrationstest, Solarpark …), sicher bis riskant, mit Ergebnis nach 15 bis 60 Minuten. Know-how des
  Teams hebt die Chance. Auftragsarbeit läuft automatisch, der Schalter ist weg.
- **Firmen in jedem Bereich (ADR-128):** sechs neue Produkte, die mit Recht, Finanzen oder Führung beginnen
  (Online-Rechtsberatung, Banking-App, Franchise-Kette, Stromhandel, Zulassungsberatung, Umzugsservice), jedes mit
  eigenen Geschäftszügen.
- **Firmenaufgaben (ADR-129):** 92 kleine Aufgaben, die zum Produkt passen, jede ein Minispiel (Tippen, Zählen,
  Sortieren, Reihenfolge, Merken, Rechnen). Gut gemacht bringt Geld, verpatzt oder liegen gelassen kostet es, und es
  steht in den Firmen-News. Vorgesetzte sind für ihr Team verantwortlich und delegieren; die KI hilft, aber langsam.
- **News-Tab:** Börsen-Tipps, Firmen-Meldungen aller Spielerfirmen, Marktmeldungen und Kurioses.
- **Missionen (ADR-130):** Limit-Missionen sind endgültig weg, 67 neue Missionen kommen dazu, auch für Firmenaufgaben
  und Geschäftszüge.
- **Zehn neue KI-Firmen** an der Börse, von Glanz & Gloria (Luxus) bis Sonnenkern Fusion. Jede KI-Firma hat im Profil
  eigene Neuigkeiten.
- **Fehler behoben:** Das Firmenlogo ließ sich live nicht speichern.
- **Löhne mit Stimmung (ADR-131):** Krisen, Skandale und stark fallende Aktienkurse senken die Löhne der Mitarbeiter.
- **Eigene Strategien mit KI (ADR-132):** Bei Krisen, Chancen und als eigener Geschäftszug schreibst du selbst, was
  deine Firma tut. Claude beurteilt die Idee (ohne Schlüssel die Mini-KI), der Zufall entscheidet. Schönfärberei kann
  nach hinten losgehen.
- **Protestkampagnen (ADR-133):** Boykott, Shitstorm, Petition oder Protestmarsch gegen andere Firmen. Viele müssen
  mitmachen, die KI hilft, wirken tut es nur selten. Der letzte Quartalsabschluss steht im Dashboard jetzt ganz oben.
- **Mehr Verbesserungen (ADR-134):** 22 neue Verbesserungen und zwei weitere Tresorstufen, in fünf Abschnitten.
  Mehr Geld (Tresorzinsen, Lohnbonus, Stammgast, Auftragsprofi, Dealmaker), mehr XP (Börsenprofi, Frühaufsteher,
  Missionsjäger, Teamplayer, Bilanzprofi, Ehrgeiz), ein größerer Tresor (Panzertresor) und vieles für die eigene
  Firma (KI-Turbo, Glückshand, Werbeagentur, Krisenmanager …). Sie schalten sich zwischen Level 1 und 30 frei.

- **Mehr Leben auf dem NFT-Markt:** KI-Sammler handeln viel öfter untereinander, und auf dein NFT können bis zu drei verschiedene Sammler gleichzeitig bieten.
- **Ein Battle pro Stunde:** Nach jeder Sendung gibt es genau ein News-Battle mit Preis; das nächste kommt nach der nächsten Sendung.
- **Nach den Nachrichten zum Battle:** Ist die stündliche Sendung vorbei, führt ein Knopf unter dem Fernseher direkt in die Battle-Lobby.
- **NFT sofort verkaufen:** Hat deine Auktion ein Gebot, kannst du sie sofort beenden und an das höchste Gebot verkaufen.
- **NFT-Preis jeden Tag neu:** Das erste NFT am Tag kostet wieder 15.000 €, erst weitere am selben Tag werden teurer.
- **Namen im Studio:** Unter jeder Figur im Studiopublikum der Nachrichten steht jetzt ihr Name; im Studio sitzen nur
  echte Spieler, die erfundenen Zuschauer schreiben nur noch im Chat.
- **Schwerere Missionen, neue Missionen (ADR-159):** Tages- und Wochenmissionen werden mit dem Level anspruchsvoller
  (Level 10 etwa ×1,4, Level 30 etwa ×2,2). 19 neue Missionen rund um Kleiderschrank, Anstupsen, den Live-Chat der
  Nachrichten und den Büro-Chat, darunter „Ein legendäres Accessoire“.
- **Missionen sind immer machbar (ADR-154):** Du bekommst keine Mission mehr, die du nicht schaffen kannst, etwa
  „Stelle eine KI-Kraft ein“ bei voller Firma oder „Deine erste KI-Kraft“, wenn du schon eine hast. Eine solche
  Mission ohne Fortschritt macht Platz für eine neue. Neu: einmalig **„Kauf dir ein Grundstück“ für 5.000 XP**.
- **Freunde online:** Ein grüner Punkt zeigt, welcher Freund gerade spielt; online stehen sie oben in der Liste, und
  neben „Freunde“ in der Leiste steht, wie viele gerade da sind.
- **Mehr Farben:** Logo, Banner und Coin-Logo dürfen jetzt wie NFTs bis zu 16 Farben haben; dazu 48 Farbfelder und
  eine frei wählbare eigene Farbe.
- **Kampagnen** verschwinden eine Stunde nach ihrem Ende aus den News.
- **Firmen-Minispiele:** Beim Ziehen schließt sich das Fenster nicht mehr.
- **Aktien haben einen Bestand (ADR-153):** Von einer Aktie kann niemand mehr kaufen, als es gibt. Sind alle Aktien
  einer Firma bei Spielern, ist Schluss, bis jemand verkauft oder der Gründer mit einer Kapitalerhöhung neue Aktien
  ausgibt. Eine größere Order bekommt genau das, was noch frei ist.
- **NEXA Nachrichten 2 (ADR-152):** Mr. Doodle Dangle hat jetzt Gesichter: Er erschrickt, heult, lacht sich kaputt,
  wird wütend oder grinst selbstgefällig, alles mit Geräuschen. Die Sendung beginnt mit einem eigenen Vorspann nur
  über ihn. Es geht viel mehr um euch: persönliche Meldungen über Spieler (Level, neuer Job, Rauswurf, geplatzter
  Börsengang, Rug Pull, tagelang verschollen, Erster oder Letzter der Reichenliste), gute Nachrichten mit vergiftetem
  Lob, schlechte gnadenlos, dafür mit Schmerzensgeld. Der teuerste NFT-Verkauf kommt in die Sendung. Zwischendurch
  schweift er komplett ab, etwa mit dem Gerücht, ein Promi habe in eine Aktie investiert, die dann wirklich steigt.
  Im Live-Chat schreiben erfundene Zuschauer mit, die ihn hassen oder vergöttern. Der Chat bleibt gleich groß und
  scrollt von selbst mit.
- **Mission „Wirf einen Blick auf die Reichenliste“:** zählt jetzt zuverlässig, auch wenn die Seite direkt geladen wird.
- **Firmenchat:** Schreibt jemand in den Chat deiner Firma, bekommst du eine Benachrichtigung (eine, bis du sie
  gelesen hast; abschaltbar in den Einstellungen). Der Chat hat einen Zurück-Knopf zur Firmenseite, und die
  Escape-Taste führt ebenfalls zurück.
- **KI-Sammler mit Dachschaden:** Bei NFT-Angeboten schreiben die KI-Sammler jetzt viel mehr und deutlich dümmere
  Texte, vom Käsebrot als Zugabe bis zum ohnmächtigen Steuerberater.

- **Börsengang: voll oder Geld zurück (ADR-151):** Das Geld der Zeichner wird jetzt verwahrt und kommt erst in die
  Firmenkasse, wenn die Firma an der Börse ist. Vorher kann der Gründer nichts davon auszahlen. Werden bis zum Ende
  nicht alle Aktien gezeichnet, platzt der Börsengang: Alle bekommen ihr Geld vollständig zurück, die Firma bleibt
  privat und kann es noch einmal versuchen. KI-Investoren zeichnen je nach Qualität 60 bis 100 %, den Rest müssen
  Mitspieler übernehmen. Wer gezeichnet hat, bekommt eine Benachrichtigung über den Ausgang.

- **NEXA Nachrichten mit Mr. Doodle Dangle (ADR-150):** Jede volle Stunde gibt es Live-Nachrichten im News-Tab: ein
  Fernseher mit Sprecher im Pixel-Art-Studio, daneben ein Live-Chat mit Emojis. Mr. Doodle Dangle nimmt den Verlierer
  des Tages auseinander, packt Skandale bei euren Firmen aus und meldet Kursstürze, und alles, was er sagt, passiert
  wirklich: Kurse, Bekanntheit und Aufgabenwerte ändern sich sofort. Die Sendung läuft nur, wenn jemand zuschaut,
  und keine Meldung wiederholt sich. Am Ende gibt es seinen Geheimtipp für die nächste Stunde.

- **Börsengang: eine Stunde, mehr KI-Investoren (ADR-149):** Die Zeichnung läuft jetzt bis zu einer Stunde. Deutlich
  mehr KI-Investoren steigen ein, und zwar gleich am Anfang. Sind alle Aktien gezeichnet, bist du sofort an der Börse.

- **Gelöste Aufgaben lohnen sich langfristig (ADR-148):** Jede erledigte Firmen-Aufgabe gibt deiner Firma „Schwung“ –
  mehr Nachfrage und damit mehr Umsatz, Stunde um Stunde. Der Schwung lässt nach, wenn ihr Aufgaben liegen lasst, und
  wächst, je besser ihr spielt. So wird aus gutem Spiel immer mehr Gewinn.

- **Firma auflösen besser sichtbar (ADR-147):** Der Knopf zum Auflösen der Firma steht jetzt in einer eigenen,
  deutlich sichtbaren Gefahrenzone im Chefbüro statt versteckt in einem Aufklapp-Menü.

- **Große Benachrichtigung bei Aufgaben (ADR-143):** Wenn dir in deiner Firma eine Aufgabe zugewiesen wird, erscheint
  jetzt ein großes Pop-up, damit du es nicht mehr übersiehst.

- **Mehr XP für Missionen (ADR-142):** Je höher dein Level, desto mehr XP bringen Missionen (Level 10 etwa das
  2,3-Fache, Level 30 das 5-Fache). Neuer Meilenstein für alle: Arbeite einmal bei der Firma eines echten Spielers und
  bekomme 2500 XP.
- **Minispiele zum Anfassen (ADR-144):** Vier neue Firmenaufgaben-Spiele wie bei einem Captcha: Teile in ihre Lücke
  schieben, Räder drehen, bis der Pfeil auf die Markierung zeigt, Karten in die richtige Box ziehen und den kürzesten
  Weg um Hindernisse ziehen. Dazu 25 neue Aufgaben, mindestens eine für jedes Produkt. Beim Sortieren ziehst du die
  Karte jetzt auf den Stapel, beim Rechnen helfen Knöpfe von −100 bis +100. Alles bleibt durch Hinsehen und Nachdenken
  lösbar, Tippen geht weiterhin.

- **Lebendiger NFT-Markt (ADR-141):** Die KI-Sammler handeln jetzt auch untereinander und bieten danach wieder an, so
  bewegen sich die Preise ständig. Beliebte NFTs mit vielen Likes, Angeboten und Verkäufen sind gefragter, und die
  Sammler zahlen dafür mehr. Mira heißt jetzt „Assistentin“ statt „KI“.

- **Firmen-Minispiele mit Logik (ADR-140):** Jede Sortier-Aufgabe nennt jetzt ihre Regel, nichts muss mehr geraten
  werden. Beim Ordnen sind die Werte realistisch (Schichten zwischen 6 und 22 Uhr statt „73 Uhr“).

- **Mira kann jetzt richtig was (ADR-139):** Schreib ihr frei, was die Firma tun soll („Wir machen eine Rabattaktion
  für Stammkunden“). Sie schätzt die Chance, warnt bei Schönfärberei und setzt es um. Davon geht **ein Auftrag pro
  Stunde**. „Verteil alle Aufgaben“ verteilt alles auf einmal, „Wie läuft die Firma?“ zeigt die Zahlen. Mira meldet
  von selbst, wie Aufgaben und Aufträge ausgegangen sind, und warnt, bevor eine Aufgabe verfällt.

- **Mira, deine Firmen-Assistentin (ADR-138):** Die Firma läuft jetzt über einen Chat. Mira meldet neue Aufgaben,
  Krisen und freie Geschäftszüge, sagt, wer gerade Zeit hat, und warnt, wenn die KI zu langsam ist. Schreib ihr einfach
  „Gib das Packen an Anna“ oder „Das mache ich selbst“; bei freiem Text denkt Claude mit und schlägt Schritte vor.
  Eigene Strategien für Krisen und eigene Geschäftszüge schreibst du direkt in den Chat. Die Übersicht der Firma ist
  in sieben Bereiche zum Aufklappen sortiert.

- **Handy (ADR-136):** Finn merkt sich seine Touren jetzt auf dem Server, ein privates Fenster oder ein zweites Gerät
  startet sie nicht mehr neu. Die NFT-Details öffnen am Handy als Sheet von unten, der Angebots-Chat ist erreichbar.

- **NFTs statt Artworks (ADR-135):** Wer ein NFT prägt, bekommt bei jedem Weiterverkauf 10 %, auch wenn es ihm nicht
  mehr gehört. Festpreis zum Sofortkaufen, ein Chat mit Preisangeboten unter jedem NFT, KI-Sammler kaufen nur zu
  fairen Preisen, machen Lowball-Angebote und verkaufen weiter. Neue Rangliste „Top-Macher“, Sortierungen „Neu geprägt“
  und „Heiß begehrt“, neun neue Missionen. Jedes weitere NFT kostet nur noch das 1,5-Fache.
- **Patchnotes (ADR-137):** Die Zeitung oben in der Leiste zeigt alle Änderungen, das Neueste zuerst und nach
  Versionen geordnet. Ein blauer Punkt verrät, dass seit deinem letzten Blick etwas dazugekommen ist.
