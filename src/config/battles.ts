/*
 * News battles (ADR-160): players who watch the news join a lobby; from 3 to 10 of them play one mini-game and only
 * one wins a prize. The server picks the game, the prize and the seed; the action games are integer simulations on a
 * tile grid (src/lib/sim/battle, mirrored in SQL) driven only by the players' inputs, one character per tick.
 * The parameters of a game are copied into the battle when it starts (battles.params), so client and server always
 * simulate with the same numbers, even if this config changes during a battle.
 *
 * Purity rules (ADR-012): imports only from src/config, JSON-serialisable values only (this file is part of BALANCE).
 */
import { BATTLE_ACCESSORIES } from "./battle-accessories.ts";

export const BATTLE_KINDS = ["floor", "bulls", "coins", "sumo", "potato", "pump", "quiz", "estimate", "bell"] as const;
export type BattleKind = (typeof BATTLE_KINDS)[number];
/** Games driven by inputs per tick (simulated); the others are rounds the server judges. */
export const TICK_KINDS = ["floor", "bulls", "coins", "sumo", "potato", "pump"] as const;
export type TickKind = (typeof TICK_KINDS)[number];
export type RoundKind = Exclude<BattleKind, TickKind>;

/** Spawn tiles of the 11×9 arena, assigned to the players in an order drawn from the seed. */
const SPAWNS: readonly (readonly [number, number])[] = [
  [1, 1],
  [9, 7],
  [9, 1],
  [1, 7],
  [5, 1],
  [5, 7],
  [1, 4],
  [9, 4],
  [3, 4],
  [7, 4],
];

export const BATTLE_RULES = {
  lobby: {
    /** Battles come after the tutorial, like the friends (src/config/disclosure.ts: newsBattle). */
    minLevel: 2,
    minPlayers: 3,
    maxPlayers: 10,
    /** Battles per full hour, all with a prize; then the next round after the next hourly show. */
    perHour: 3,
    /** Starts when this runs out (from the moment minPlayers are in), or at once with maxPlayers. */
    countdownSeconds: 30,
    /** A player not seen in the lobby for this long is taken out of it. */
    idleSeconds: 15,
    /** Intro card and 3-2-1 before tick 0. */
    introMs: 6_000,
    /** A finished battle stays readable (podium) for this long. */
    recentSeconds: 120,
  },
  /** The offline demo: made-up opponents join within a few seconds, a short countdown. */
  demo: { countdownSeconds: 6, botsMin: 3, botsMax: 5 },
  /** How often the server picks each game. The last game is never picked twice in a row. */
  weights: { floor: 12, bulls: 12, coins: 12, sumo: 12, potato: 12, pump: 10, quiz: 12, estimate: 8, bell: 10 },
  net: {
    tickMs: 50,
    /** A tick is final this long after it; missing inputs then count as "x" (none). */
    graceMs: 1_000,
    /** Inputs may arrive at most this many ticks ahead of the server clock (clock skew). */
    aheadTicks: 10,
    /** This many "x" in a row (4 s) and a player is out: disconnected. */
    disconnectTicks: 80,
    /** The client sends its inputs this often (and broadcasts them to the others twice as often). */
    sendEveryMs: 250,
    /** A claimed end of a game is checked at most this often per battle (the SQL simulation runs then). */
    checkEveryMs: 1_000,
  },
  arena: { w: 11, h: 9, stepTicks: 4, spawns: SPAWNS },
  games: {
    /** Kurssturz: the floor breaks away in waves, standing still cracks your tile; the last one standing wins. */
    floor: {
      maxTicks: 1_400,
      firstWave: 60,
      waveEvery: 50,
      waveEveryMin: 18,
      waveEveryStep: 2,
      crackStart: 3,
      crackMax: 9,
      crackGrowEvery: 2,
      warnTicks: 24,
      stompTicks: 50,
      /** With this few solid tiles left, one tile breaks per wave (no draws at the end). */
      endgameTiles: 8,
    },
    /** Bullenreiten: bulls charge across rows and columns after a warning; three hearts. */
    bulls: {
      maxTicks: 1_300,
      hearts: 3,
      firstSpawn: 40,
      spawnEvery: 50,
      spawnEveryMin: 14,
      spawnEveryStep: 2,
      countGrowEvery: 5,
      countMax: 4,
      warnTicks: 26,
      ticksPerTile: 2,
      stunTicks: 16,
      invulnTicks: 40,
    },
    /** Geldregen: catch coins and gold bars; falling bears stun you and cost coins. Most coins wins. */
    coins: {
      durationTicks: 900,
      firstDrop: 20,
      /** One drop every (dropEvery - floor(players / 3)) ticks, at least dropEveryMin. */
      dropEvery: 6,
      dropEveryMin: 3,
      fallTicks: 16,
      lifeTicks: 80,
      bearPct: 12,
      goldPct: 8,
      goldValue: 3,
      bearStunTicks: 30,
      bearLoss: 2,
      /** The last ticks rain more gold. */
      jackpotTicks: 200,
      jackpotGoldPct: 25,
    },
    /** Sumo am Parkett: walk into someone to shove them a tile (with the action two); the ring shrinks. */
    sumo: {
      maxTicks: 1_500,
      firstShrink: 300,
      shrinkEvery: 220,
      warnTicks: 40,
      /** A shoved player is stunned this long (shorter than a step: they can get away). */
      stunTicks: 0,
      /** The shover stands this long after a shove, so the other one can step aside first. */
      recoverTicks: 7,
      powerCooldown: 40,
      /** Tiles with |dx| + |dy| >= cornerCut are not part of the ring. */
      cornerCut: 8,
      /** Start inside the ring, not on its edge (one shove would end the game). */
      spawns: [
        [2, 2],
        [8, 6],
        [8, 2],
        [2, 6],
        [5, 1],
        [5, 7],
        [2, 4],
        [8, 4],
        [4, 3],
        [6, 5],
      ] as readonly (readonly [number, number])[],
    },
    /** Giftaktie: hot potato. Bump someone to pass it; whoever holds it at the bang is out. */
    potato: {
      maxTicks: 1_800,
      firstRound: 40,
      pauseTicks: 40,
      holderStepTicks: 3,
      passBackTicks: 20,
      receiverStunTicks: 8,
      /** Fuse = max(fuseMinSeconds, fuseBaseSeconds - players) + 0..fuseJitterSeconds-1 seconds. */
      fuseBaseSeconds: 13,
      fuseMinSeconds: 4,
      fuseJitterSeconds: 4,
      walls: [
        [2, 2],
        [8, 2],
        [2, 6],
        [8, 6],
        [5, 4],
      ] as readonly (readonly [number, number])[],
    },
    /** Aktie pumpen: tap while the light is green (gold counts triple); a tap in the crash costs a quarter. */
    pump: {
      durationTicks: 600,
      greenMin: 40,
      greenJitter: 60,
      yellowTicks: 12,
      redMin: 20,
      redJitter: 20,
      /** Every goldEvery-th green ends with a golden window. */
      goldEvery: 4,
      goldTicks: 20,
      goldValue: 3,
      bustFreezeTicks: 20,
      bustLossBps: 2_500,
    },
    /** Börsenquiz: two hearts; wrong or no answer costs one; fast right answers score more. */
    quiz: { rounds: 7, answerMs: 8_000, revealMs: 3_000, hearts: 2, basePoints: 500, speedPoints: 500 },
    /** Schätz den Kurs: closest guess gets the most points; the last round counts double. */
    estimate: {
      rounds: 4,
      answerMs: 12_000,
      revealMs: 4_000,
      bullseyeBps: 100,
      bullseyeBonus: 2,
      lastRoundFactor: 2,
      /** Rounds that ask for the current price of a stock of the game. */
      stockRounds: 1,
    },
    /** Die Glocke: press when the bell rings; a false start or the slowest loses a heart. */
    bell: {
      maxRounds: 9,
      readyMs: 1_000,
      waitMinMs: 1_500,
      waitMaxMs: 4_500,
      windowMs: 2_000,
      resultMs: 2_500,
      /** Hearts with up to `smallGroup` players, else one; with more, the two slowest lose one. */
      smallGroup: 5,
      heartsSmall: 2,
      heartsLarge: 1,
    },
  },
  prizes: {
    weights: { xp: 30, money: 30, skin: 20, nft: 20 },
    /** Base XP (grant_xp applies the XP factor and upgrades). */
    xpBase: 1_000,
    xpPerPlayer: 150,
    moneyBaseCents: 300_000,
    moneyPerPlayerCents: 75_000,
    /** Wins with a prize per player and day (Berlin); after that only the glory. */
    dailyPrizeCap: 3,
  },
  /** Exclusive accessories, only won here (ADR-160). */
  accessories: BATTLE_ACCESSORIES,
  /**
   * Mr. Doodle Dangle comments the battles. {name} player, {game} game, {prize} prize, {count} players.
   * chat: lines the server writes into the live chat of the show.
   */
  doodle: {
    lobby: [
      "Na, ihr Sofa-Börsianer? Wer traut sich in die Arena?",
      "Ich brauche drei Mutige. Oder drei Ahnungslose. Geht beides.",
      "Kommt rein, kommt rein! Hier gewinnt nur einer, die anderen weinen live.",
      "Meine Mutter würde sofort mitmachen. Und gewinnen.",
      "Ein Preis, ein Sieger, null Mitleid. Willkommen im Battle!",
    ],
    countdown: [
      "Gleich geht's los! Letzte Chance, noch feige wegzurennen.",
      "Die Arena wird gewischt. Gleich fließen Tränen.",
      "Ich habe Popcorn. Ihr habt keine Chance.",
    ],
    intro: {
      floor: "Der Kurs stürzt, der Boden auch! Bleibt in Bewegung, sonst geht's abwärts!",
      bulls: "Die Bullen sind los! Wer stehen bleibt, wird zum Teppich.",
      coins: "Es regnet Geld! Vorsicht vor den Bären, die beißen.",
      sumo: "Rempeln erlaubt, Weinen auch. Wer rausfliegt, fliegt raus!",
      potato: "Wer die Giftaktie hält, wenn es knallt, ist raus. Weitergeben!",
      pump: "Pumpt die Aktie! Aber wehe, ihr tippt im Crash.",
      quiz: "Quizzeit! Zwei Herzen, null Ahnung. Zeigt, was ihr wisst!",
      estimate: "Schätzt mal! Wer am nächsten dran ist, kriegt die Punkte.",
      bell: "Wenn die Glocke läutet, drückt ihr. Vorher drücken? Raus!",
    },
    win: [
      "{name} gewinnt! Ich habe es immer gewusst. Also seit gerade eben.",
      "Applaus für {name}! Die anderen dürfen jetzt heimlich weinen.",
      "{name} räumt ab! Das schreibe ich mir auf die Krawatte.",
      "Was für ein Battle! {name} ist der Champion des Tages.",
      "{name} siegt, die Börse bebt, mein Schnurrbart zittert!",
    ],
    out: [
      "Und weg ist {name}! Tschüss, war nett.",
      "{name} fliegt raus. Ich habe nichts gesehen. Doch, alles.",
      "Autsch, {name}! Das gibt einen blauen Fleck im Depot.",
    ],
    chat: {
      start: "🏟️ BATTLE! {count} Zuschauer kämpfen jetzt in „{game}“ um {prize}. Viel Glück, ihr Pfeifen!",
      win: "🏆 {name} gewinnt „{game}“ und kassiert {prize}! Glückwunsch, du Glückspilz.",
    },
  },
  /** Names of the games in the server's chat lines and notifications (the UI uses messages/de.json). */
  names: {
    floor: "Kurssturz",
    bulls: "Bullenreiten",
    coins: "Geldregen",
    sumo: "Sumo am Parkett",
    potato: "Giftaktie",
    pump: "Aktie pumpen",
    quiz: "Börsenquiz",
    estimate: "Schätz den Kurs",
    bell: "Die Glocke",
  },
  /** Made-up opponents of the demo. */
  demoBots: [
    { nickname: "Bärbel Bärenmarkt", avatarKey: "seller", accessories: ["cowboy_hat"] },
    { nickname: "Kalle Kursrakete", avatarKey: "punk", accessories: ["sunglasses", "superhero_cape"] },
    { nickname: "Dividenden-Dieter", avatarKey: "analyst", accessories: ["top_hat"] },
    { nickname: "Moni Moneymaker", avatarKey: "scientist", accessories: ["party_hat", "balloon"] },
    { nickname: "Börsen-Bernd", avatarKey: "rookie", accessories: ["beanie", "hamster"] },
    { nickname: "Lisa Leerverkauf", avatarKey: "finn_fan", accessories: ["bunny_ears"] },
    { nickname: "Hedge-Horst", avatarKey: "rookie", accessories: ["viking_helmet", "pug"] },
    { nickname: "Penny Stock", avatarKey: "seller", accessories: ["heart_glasses"] },
    { nickname: "Ralf Rendite", avatarKey: "analyst", accessories: ["chef_hat", "baguette"] },
  ],
  /**
   * Börsenquiz: the right answer `a` and three wrong ones. The server shuffles them; only it knows which one is right
   * until the round is over.
   */
  quiz: [
    { q: "Wie viel Startkapital bekommt man bei NEXA?", a: "10.000 €", wrong: ["1.000 €", "50.000 €", "100.000 €"] },
    { q: "Wer moderiert die NEXA Nachrichten?", a: "Mr. Doodle Dangle", wrong: ["Finn", "Mira", "Dr. Dax"] },
    {
      q: "Wann laufen die NEXA Nachrichten?",
      a: "Zu jeder vollen Stunde",
      wrong: ["Einmal am Tag", "Nur sonntags", "Alle 5 Minuten"],
    },
    {
      q: "Was ist ein Bullenmarkt?",
      a: "Steigende Kurse",
      wrong: ["Fallende Kurse", "Ein Viehmarkt", "Ein Markt ohne Händler"],
    },
    { q: "Was ist ein Bärenmarkt?", a: "Fallende Kurse", wrong: ["Steigende Kurse", "Ein Zoo", "Ein Honigmarkt"] },
    {
      q: "Was ist eine Dividende?",
      a: "Gewinnanteil für Aktionäre",
      wrong: ["Eine Gebühr", "Ein Kredit", "Eine Steuer"],
    },
    { q: "Was ist ein IPO?", a: "Ein Börsengang", wrong: ["Eine Insolvenz", "Ein Aktiensplit", "Eine Fusion"] },
    {
      q: "Was bedeutet Leerverkauf?",
      a: "Auf fallende Kurse wetten",
      wrong: ["Alles verkaufen", "Ohne Gebühr kaufen", "Eine leere Order"],
    },
    {
      q: "Was ist eine Anleihe?",
      a: "Ein Schuldpapier mit Zinsen",
      wrong: ["Ein Firmenanteil", "Eine Kryptowährung", "Ein Sparbuch"],
    },
    {
      q: "Was misst ein Aktienindex?",
      a: "Die Entwicklung vieler Aktien",
      wrong: ["Den Goldpreis", "Die Inflation", "Nur eine Aktie"],
    },
    {
      q: "Was ist eine Limit-Order?",
      a: "Kauf oder Verkauf zu einem Wunschpreis",
      wrong: ["Ein Kauf ohne Geld", "Eine Order mit Zeitlimit", "Ein Verbot zu handeln"],
    },
    {
      q: "Was ist ein Stop-Loss?",
      a: "Automatischer Verkauf bei Verlust",
      wrong: ["Ein Handelsverbot", "Eine Gewinnsteuer", "Ein Börsenfeiertag"],
    },
    {
      q: "Was ist Market Cap?",
      a: "Börsenwert einer Firma",
      wrong: ["Die Kappe des Händlers", "Der Tageshöchstkurs", "Die Anzahl der Mitarbeiter"],
    },
    {
      q: "Was passiert bei einem Aktiensplit?",
      a: "Mehr Aktien zum kleineren Preis",
      wrong: ["Die Firma teilt sich", "Die Aktie wird gelöscht", "Der Kurs verdoppelt sich"],
    },
    {
      q: "Was ist Volatilität?",
      a: "Wie stark ein Kurs schwankt",
      wrong: ["Wie alt eine Firma ist", "Ein Börsenfeiertag", "Die Höhe der Dividende"],
    },
    { q: "Welches Tier steht für steigende Kurse?", a: "Bulle", wrong: ["Bär", "Hase", "Schildkröte"] },
    {
      q: "Was ist ein NFT bei NEXA?",
      a: "Ein einzigartiges Pixel-Kunstwerk",
      wrong: ["Eine Aktie", "Eine Kreditkarte", "Ein Firmenlogo"],
    },
    { q: "Wie viele Spieler braucht ein News-Battle mindestens?", a: "3", wrong: ["1", "2", "5"] },
    { q: "Wie viele Spieler passen höchstens in ein News-Battle?", a: "10", wrong: ["4", "8", "20"] },
    {
      q: "Was bekommt der Sieger eines News-Battles?",
      a: "XP, Geld, einen Skin oder ein NFT",
      wrong: ["Nur ein Lob", "Eine echte Aktie", "Einen Kredit"],
    },
    {
      q: "Was ist ein Rug Pull?",
      a: "Die Macher hauen mit dem Geld ab",
      wrong: ["Ein Teppichverkauf", "Ein Kurssprung", "Eine Gratis-Aktie"],
    },
    {
      q: "Was ist Inflation?",
      a: "Steigende Preise, sinkende Kaufkraft",
      wrong: ["Sinkende Preise", "Ein Luftballon", "Eine Börsenregel"],
    },
    {
      q: "Was heißt „Buy the Dip“?",
      a: "Nach einem Kursrutsch kaufen",
      wrong: ["Chips kaufen", "Alles verkaufen", "Nur Anleihen kaufen"],
    },
    {
      q: "Was ist ein Portfolio?",
      a: "Alle eigenen Anlagen zusammen",
      wrong: ["Eine Aktentasche", "Ein Börsenticker", "Ein Kredit"],
    },
    { q: "Was ist ein Ticker?", a: "Das Kürzel einer Aktie", wrong: ["Eine Uhr", "Ein Händler", "Eine Gebühr"] },
    { q: "Wie heißt die Hauptstadt von Australien?", a: "Canberra", wrong: ["Sydney", "Melbourne", "Perth"] },
    { q: "Wie viele Beine hat eine Spinne?", a: "8", wrong: ["6", "10", "12"] },
    { q: "Welcher Planet ist der Sonne am nächsten?", a: "Merkur", wrong: ["Venus", "Mars", "Erde"] },
    { q: "Wie viele Minuten hat ein Tag?", a: "1.440", wrong: ["1.200", "2.400", "960"] },
    { q: "Welche Farbe entsteht aus Blau und Gelb?", a: "Grün", wrong: ["Lila", "Orange", "Braun"] },
    { q: "Was ist das größte Säugetier der Welt?", a: "Blauwal", wrong: ["Elefant", "Giraffe", "Pottwal"] },
    { q: "Wie viele Seiten hat ein Würfel?", a: "6", wrong: ["4", "8", "12"] },
    { q: "In welchem Land steht der Eiffelturm?", a: "Frankreich", wrong: ["Italien", "Belgien", "Spanien"] },
    { q: "Was ist H₂O?", a: "Wasser", wrong: ["Wasserstoff", "Sauerstoff", "Salz"] },
    { q: "Wie viele Spieler hat eine Fußballmannschaft auf dem Feld?", a: "11", wrong: ["9", "10", "12"] },
    {
      q: "Welches Tier legt Eier und ist ein Säugetier?",
      a: "Schnabeltier",
      wrong: ["Pinguin", "Delfin", "Fledermaus"],
    },
    { q: "Wie viele Kontinente gibt es?", a: "7", wrong: ["5", "6", "8"] },
    {
      q: "Wer hat die Glühbirne bekannt gemacht?",
      a: "Thomas Edison",
      wrong: ["Albert Einstein", "Isaac Newton", "Nikola Tesla"],
    },
    { q: "Was ist die Wurzel aus 144?", a: "12", wrong: ["14", "11", "16"] },
    {
      q: "Welche Sprache hat die meisten Muttersprachler?",
      a: "Chinesisch (Mandarin)",
      wrong: ["Englisch", "Spanisch", "Hindi"],
    },
    { q: "Wie heißt der längste Fluss Europas?", a: "Wolga", wrong: ["Donau", "Rhein", "Elbe"] },
    {
      q: "Was zeigt ein grüner Kurs bei NEXA?",
      a: "Der Kurs ist gestiegen",
      wrong: ["Der Kurs ist gefallen", "Die Börse ist zu", "Ein Fehler"],
    },
    {
      q: "Was kostet es, eine Order bei NEXA aufzugeben?",
      a: "Eine kleine Gebühr",
      wrong: ["Nichts, niemals", "Die Hälfte des Werts", "Ein Level"],
    },
    {
      q: "Was passiert, wenn eine Firma insolvent ist?",
      a: "Sie kann ihre Schulden nicht zahlen",
      wrong: ["Sie geht an die Börse", "Sie zahlt Dividende", "Sie wird verdoppelt"],
    },
    { q: "Wie viele Zähne hat ein erwachsener Mensch normalerweise?", a: "32", wrong: ["28", "30", "36"] },
    { q: "Welches Gas atmen Pflanzen ein?", a: "Kohlendioxid", wrong: ["Sauerstoff", "Stickstoff", "Helium"] },
  ],
  /** Schätz den Kurs: a question with a true value; `unit` is shown after the input. */
  estimate: [
    { q: "Wie hoch ist der Eiffelturm (mit Antenne) in Metern?", value: 330, unit: "m" },
    { q: "Wie viele Knochen hat ein erwachsener Mensch?", value: 206, unit: "Knochen" },
    { q: "Wie viele Tasten hat ein Klavier?", value: 88, unit: "Tasten" },
    { q: "Wie viele Länder gibt es in der EU?", value: 27, unit: "Länder" },
    { q: "Wie schnell fährt ein ICE höchstens (km/h)?", value: 300, unit: "km/h" },
    { q: "Wie viele Herzschläge hat ein Mensch in Ruhe pro Minute (etwa)?", value: 70, unit: "Schläge" },
    { q: "Wie tief ist der Marianengraben in Metern (etwa)?", value: 11_000, unit: "m" },
    { q: "Wie viele Einwohner hat Berlin (in Tausend, etwa)?", value: 3_850, unit: "Tsd." },
    { q: "Wie viel wiegt ein erwachsener Afrikanischer Elefant in kg (etwa)?", value: 6_000, unit: "kg" },
    { q: "Wie lang ist die Chinesische Mauer in km (etwa)?", value: 21_000, unit: "km" },
    { q: "Wie viele Stunden hat ein Jahr (kein Schaltjahr)?", value: 8_760, unit: "Stunden" },
    { q: "Wie hoch ist die Zugspitze in Metern?", value: 2_962, unit: "m" },
    { q: "Wie viele Felder hat ein Schachbrett?", value: 64, unit: "Felder" },
    { q: "Wie viele Kilometer ist der Mond von der Erde entfernt (in Tausend, etwa)?", value: 384, unit: "Tsd. km" },
    { q: "Wie viele Liter Blut hat ein erwachsener Mensch (etwa)?", value: 5, unit: "Liter" },
    { q: "Wie viele Kalorien hat eine Tafel Vollmilchschokolade (100 g, etwa)?", value: 535, unit: "kcal" },
    { q: "Wie viele Spiele hat eine Bundesliga-Saison pro Team?", value: 34, unit: "Spiele" },
    { q: "Wie viele Sekunden hat ein Tag?", value: 86_400, unit: "Sekunden" },
    { q: "Wie alt wurde Johann Wolfgang von Goethe?", value: 82, unit: "Jahre" },
    { q: "Wie viele Stockwerke hat der Burj Khalifa (etwa)?", value: 163, unit: "Stockwerke" },
    { q: "Wie viele Zähne hat ein Hai im Leben (etwa, in Tausend)?", value: 30, unit: "Tsd." },
    { q: "Wie heiß ist die Oberfläche der Sonne in °C (etwa)?", value: 5_500, unit: "°C" },
    { q: "Wie viele Kaffeebohnen braucht ein Espresso (etwa)?", value: 50, unit: "Bohnen" },
    { q: "Wie viele Wörter spricht ein Mensch am Tag (etwa, in Tausend)?", value: 16, unit: "Tsd." },
  ],
} as const;

export type BattleRules = typeof BATTLE_RULES;
export type FloorParams = BattleRules["games"]["floor"];
export type BullsParams = BattleRules["games"]["bulls"];
export type CoinsParams = BattleRules["games"]["coins"];
export type SumoParams = BattleRules["games"]["sumo"];
export type PotatoParams = BattleRules["games"]["potato"];
export type PumpParams = BattleRules["games"]["pump"];
export type QuizParams = BattleRules["games"]["quiz"];
export type EstimateParams = BattleRules["games"]["estimate"];
export type BellParams = BattleRules["games"]["bell"];

export function isTickKind(kind: string): kind is TickKind {
  return (TICK_KINDS as readonly string[]).includes(kind);
}
