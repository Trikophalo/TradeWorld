/*
 * Accessories (ADR-154): funny things a player buys with game money and wears on the pixel figure. One per slot,
 * other players see them on the profile and on the friends plaza. Keys are stored in the database and must never
 * change; prices are paid once, there is no resale. The pixel art lives in src/components/pixel/accessories.ts.
 *
 * Purity rules (ADR-012): no imports, JSON-serialisable values only (this file is part of BALANCE).
 */

/** Drawing order on the figure, back to front: wings behind the body, the pet last. */
export const ACCESSORY_SLOTS = ["back", "body", "face", "head", "hand", "pet"] as const;
export type AccessorySlot = (typeof ACCESSORY_SLOTS)[number];

export const ACCESSORY_RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type AccessoryRarity = (typeof ACCESSORY_RARITIES)[number];

export interface AccessoryItem {
  readonly key: string;
  readonly name: string;
  /** One short, funny German line for the shop. */
  readonly description: string;
  readonly slot: AccessorySlot;
  readonly rarity: AccessoryRarity;
  readonly priceCents: number;
  /** Shown from level 1, buyable from this level. */
  readonly minLevel: number;
}

const item = (
  key: string,
  slot: AccessorySlot,
  rarity: AccessoryRarity,
  priceCents: number,
  minLevel: number,
  name: string,
  description: string,
): AccessoryItem => ({ key, name, description, slot, rarity, priceCents, minLevel });

/*
 * Prices next to the economy (docs/BALANCING.md): 10.000 € starting capital, a flat costs 25.000 €, the cheapest
 * car 9.000 €, a luxury villa 15 Mio. €. Common things cost a few hundred euros, rare ones a few thousand, epic ones
 * like a good car, legendary ones like a house and up: status items to show off.
 */
export const ACCESSORIES: readonly AccessoryItem[] = [
  // ---------------------------------------------------------------- head
  item(
    "party_hat",
    "head",
    "common",
    25_000,
    1,
    "Partyhütchen",
    "Jeder Tag ist ein Feiertag, wenn das Depot grün ist.",
  ),
  item("paper_crown", "head", "common", 45_000, 1, "Pappkrone", "Vom Burgerladen. Fühlt sich trotzdem königlich an."),
  item("beanie", "head", "common", 60_000, 1, "Bommelmütze", "Hält warm, wenn der Markt eiskalt ist."),
  item("traffic_cone", "head", "common", 80_000, 1, "Leitkegel", "Vom Heimweg mitgenommen. Niemand fragt nach."),
  item(
    "propeller_cap",
    "head",
    "rare",
    250_000,
    2,
    "Propellermütze",
    "Dreht sich bei jedem Kursanstieg ein bisschen schneller.",
  ),
  item("chef_hat", "head", "rare", 300_000, 2, "Kochmütze", "Für alle, die ihr Depot nach Gefühl würzen."),
  item(
    "bunny_ears",
    "head",
    "rare",
    400_000,
    3,
    "Hasenohren",
    "Hört Gerüchte schon, bevor sie in den Nachrichten sind.",
  ),
  item("cowboy_hat", "head", "rare", 650_000, 3, "Cowboyhut", "Yeehaw! Der Wilde Westen heißt jetzt Börse."),
  item("pirate_hat", "head", "epic", 3_500_000, 5, "Piratenhut", "Arrr! Für Leute, die Dividenden lieber entern."),
  item("viking_helmet", "head", "epic", 6_000_000, 6, "Wikingerhelm", "Plündert keine Dörfer, nur Short-Positionen."),
  item("top_hat", "head", "epic", 15_000_000, 10, "Zylinder", "Ab hier redet man nur noch über Rendite und Pferde."),
  item(
    "halo",
    "head",
    "legendary",
    75_000_000,
    15,
    "Heiligenschein",
    "Garantiert nie Insiderhandel betrieben. Ehrlich.",
  ),
  item("crown", "head", "legendary", 500_000_000, 25, "Goldkrone", "Massives Pixelgold mit echten Fake-Diamanten."),
  // ---------------------------------------------------------------- face
  item(
    "clown_nose",
    "face",
    "common",
    25_000,
    1,
    "Clownsnase",
    "Macht jeden Verlust ein bisschen lustiger. Hupt nicht.",
  ),
  item("sunglasses", "face", "common", 35_000, 1, "Sonnenbrille", "Die Zukunft ist so hell, man braucht eine."),
  item(
    "fake_moustache",
    "face",
    "common",
    40_000,
    1,
    "Falscher Schnurrbart",
    "Perfekte Tarnung. Niemand erkennt dich. Wirklich niemand.",
  ),
  item(
    "heart_glasses",
    "face",
    "rare",
    180_000,
    2,
    "Herzchenbrille",
    "Verliebt in jede Aktie, die man gerade gekauft hat.",
  ),
  item("glasses_3d", "face", "rare", 220_000, 3, "3D-Brille", "Endlich sieht man den Kurs auch in die Tiefe fallen."),
  item("monocle", "face", "epic", 4_500_000, 7, "Monokel", "Ein Auge auf den Markt, das andere auf den Butler."),
  item("vr_goggles", "face", "epic", 12_000_000, 8, "VR-Brille", "Lebt halb im Metaversum, halb im Minus."),
  item(
    "deal_shades",
    "face",
    "epic",
    8_000_000,
    6,
    "Pixel-Sonnenbrille",
    "Fällt aus dem Nichts ins Gesicht. Deal with it.",
  ),
  item(
    "laser_eyes",
    "face",
    "legendary",
    250_000_000,
    20,
    "Laseraugen",
    "Nur echt mit mindestens einem Coin, der zum Mond fliegt.",
  ),
  // ---------------------------------------------------------------- body
  item("bathrobe", "body", "common", 50_000, 1, "Bademantel", "Homeoffice-Uniform. Trading geht auch im Liegen."),
  item(
    "tracksuit",
    "body",
    "common",
    70_000,
    1,
    "Trainingsanzug",
    "Raschelt bei jeder Bewegung. Sehr sportlich, nie gejoggt.",
  ),
  item("hawaiian_shirt", "body", "common", 90_000, 2, "Hawaiihemd", "Urlaubsmodus an, Depot läuft trotzdem."),
  item(
    "banana_costume",
    "body",
    "rare",
    500_000,
    2,
    "Bananenkostüm",
    "Krumm, gelb und immer ein Hingucker. Nicht ausrutschen.",
  ),
  item(
    "hotdog_costume",
    "body",
    "rare",
    750_000,
    3,
    "Hotdog-Kostüm",
    "Mit extra Senf. Riecht zum Glück nur nach Stoff.",
  ),
  item("tuxedo", "body", "rare", 1_200_000, 4, "Smoking", "Für Börsengänge, Galas und das Abendessen zu Hause."),
  item(
    "shark_costume",
    "body",
    "epic",
    4_000_000,
    5,
    "Haikostüm",
    "Für echte Finanzhaie. Beißt nur bei Leerverkäufen.",
  ),
  item("dino_onesie", "body", "epic", 5_500_000, 6, "Dino-Onesie", "Rawr! Uralte Anlagestrategie, extrem kuschelig."),
  item("astronaut_suit", "body", "epic", 20_000_000, 12, "Raumanzug", "Wer zum Mond will, muss sich passend anziehen."),
  item(
    "gold_suit",
    "body",
    "legendary",
    300_000_000,
    20,
    "Goldanzug",
    "Glänzt so sehr, dass die Konkurrenz eine Sonnenbrille braucht.",
  ),
  // ---------------------------------------------------------------- hand
  item(
    "balloon",
    "hand",
    "common",
    15_000,
    1,
    "Luftballon",
    "Steigt wie deine Lieblingsaktie. Platzt hoffentlich nicht.",
  ),
  item("baguette", "hand", "common", 20_000, 1, "Baguette", "Knusprig, französisch, als Zeigestab bestens geeignet."),
  item("rubber_chicken", "hand", "common", 30_000, 1, "Gummihuhn", "Quietscht bei jedem Verlust. Also oft."),
  item("ice_cream", "hand", "common", 25_000, 1, "Eistüte", "Drei Kugeln: Gewinn, Verlust und Pistazie."),
  item(
    "foam_finger",
    "hand",
    "rare",
    150_000,
    2,
    "Schaumstoffhand",
    "Nummer eins! Zumindest in der eigenen Wochenliga.",
  ),
  item("megaphone", "hand", "rare", 350_000, 3, "Megafon", "KAUFEN! VERKAUFEN! Hauptsache laut."),
  item("money_bag", "hand", "rare", 999_900, 4, "Geldsack", "Mit Dollarzeichen drauf, damit es auch jeder versteht."),
  item(
    "laser_sword",
    "hand",
    "epic",
    7_000_000,
    8,
    "Laserschwert",
    "Schneidet Gebühren und Spreads in der Mitte durch.",
  ),
  item(
    "golden_toilet_brush",
    "hand",
    "legendary",
    150_000_000,
    18,
    "Goldene Klobürste",
    "Wahrer Reichtum zeigt sich im Badezimmer.",
  ),
  // ---------------------------------------------------------------- pet
  item(
    "rubber_duck",
    "pet",
    "common",
    40_000,
    1,
    "Quietscheente",
    "Hört zu, wenn du deine Trades erklärst. Urteilt nie.",
  ),
  item("hamster", "pet", "rare", 120_000, 2, "Hamster", "Hamstert alles, besonders Dividenden."),
  item("parrot", "pet", "rare", 800_000, 4, "Papagei", "Plappert jeden Börsentipp nach. Auch die schlechten."),
  item("pug", "pet", "epic", 3_000_000, 5, "Mops", "Schnauft beim Laden der Kurse. Bester Freund an der Börse."),
  item(
    "mini_dragon",
    "pet",
    "legendary",
    400_000_000,
    22,
    "Minidrache",
    "Bewacht deinen Goldschatz und röstet Marshmallows.",
  ),
  // ---------------------------------------------------------------- back
  item(
    "superhero_cape",
    "back",
    "rare",
    450_000,
    2,
    "Superheldenumhang",
    "Rettet Depots, aber leider nur die eigenen.",
  ),
  item(
    "butterfly_wings",
    "back",
    "rare",
    900_000,
    3,
    "Schmetterlingsflügel",
    "Ein Flügelschlag hier, ein Kurssturz in Tokio.",
  ),
  item("bat_wings", "back", "epic", 7_500_000, 7, "Fledermausflügel", "Für Nachteulen, die nachbörslich handeln."),
  item("angel_wings", "back", "epic", 25_000_000, 12, "Engelsflügel", "Himmlische Renditen, garantiert ohne Garantie."),
  item("jetpack", "back", "legendary", 100_000_000, 15, "Jetpack", "To the moon! Tank voll, Sicherheitsgurt optional."),
];

export const ACCESSORY_RULES = {
  slots: ACCESSORY_SLOTS,
  /** A purchase of these rarities is news for the friends (feed). */
  feedRarities: ["legendary"],
  items: ACCESSORIES,
} as const;

export function accessoryByKey(key: string): AccessoryItem | undefined {
  return ACCESSORIES.find((a) => a.key === key);
}
