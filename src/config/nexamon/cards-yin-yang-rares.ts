import { YY_ART_RARES_1 } from "./art-yin-yang/rares-1";
import { YY_ART_RARES_2 } from "./art-yin-yang/rares-2";
import { YY_ART_RARES_3 } from "./art-yin-yang/rares-3";
import type { NexamonArt } from "./types";
import type { YinYangCardDraft, YinYangType } from "./yinyang-draft";

/*
 * "Nexamon: Yin Yang", rare cards 55-84: lone warriors in wide landscapes and spirit creatures, drawn as woodblock
 * and ink-wash scenes. Two finals of lines that start among the commons: 55 (from yy-002) and 60 (from yy-011).
 * Start prices in cents.
 */
type Row = [
  number: number,
  kind: "monster" | "warrior",
  name: string,
  type: YinYangType,
  hp: number,
  stage: 0 | 1 | 2,
  evolvesFrom: number | null,
  attack: string,
  damage: number,
  text: string,
  flavor: string,
  startPriceCents: number,
];

const key = (n: number) => `yy-${String(n).padStart(3, "0")}`;

// prettier-ignore
const ROWS: readonly Row[] = [
  [55, "warrior", "Sakizan", "steel", 150, 2, 2, "Mondsichelschnitt", 110, "", "Sie zog ihr Schwert ein einziges Mal. Der Mond hat seitdem einen feinen Riss.", 74000],
  [56, "warrior", "Mayumo", "grass", 80, 0, null, "Schneepfeil", 30, "", "Ihre Spuren im Schnee führen nur hin. Zurück geht sie über die eigenen.", 9500],
  [57, "warrior", "Mayumaru", "grass", 120, 1, 56, "Abendrotsalve", 70, "Wirf eine Münze. Bei Kopf +30 Schaden.", "Schießt auf die Wolken, bis eine zurückweicht. Die Vögel warten lieber ab.", 21000],
  [58, "monster", "Kakuno", "fairy", 80, 0, null, "Schwingenschlag", 30, "", "Fliegt jeden Abend durch die Sonne. Die Sonne hat sich daran gewöhnt.", 8800],
  [59, "monster", "Kakugami", "fairy", 120, 1, 58, "Wolkenmeerflug", 70, "Heile 20 Schaden bei diesem Nexamon.", "Über dem Wolkenmeer zählt es die Gipfel. Es kommt jedes Mal auf einen mehr.", 26500],
  [60, "monster", "Kitsuren", "fire", 140, 2, 11, "Siebenschweifglut", 100, "Der Gegner ist jetzt verwirrt.", "Sieben Schweife, sieben Lichter. Wer ihnen folgt, steht am Morgen vor demselben Tor.", 68000],
  [61, "monster", "Benikoi", "water", 70, 0, null, "Wellenschlag", 20, "", "Zieht im Teich ruhige Kreise. Nur die Seerosen wissen, wie viele.", 7600],
  [62, "monster", "Benitaki", "dragon", 120, 1, 61, "Wasserfallsprung", 80, "", "Tausend Sprünge gegen den Fall. Beim tausendundersten wuchsen ihm Barteln.", 33000],
  [63, "warrior", "Namiuchi", "water", 90, 0, null, "Brandungsruder", 40, "", "Fischt dort, wo die Welle am höchsten ist. Dort sind die Preise am besten.", 12500],
  [64, "warrior", "Kumoza", "psychic", 90, 0, null, "Morgenmeditation", 30, "Heile 30 Schaden bei diesem Nexamon.", "Sitzt über den Wolken und atmet. Die Sonne geht pünktlich auf, damit er nicht warten muss.", 14800],
  [65, "monster", "Onimenko", "dark", 100, 0, null, "Geisterfeuer", 50, "", "Eine Maske, die niemand trägt, und trotzdem lacht sie über die Tempelglocke.", 18500],
  [66, "monster", "Ponzaru", "grass", 90, 0, null, "Mondtrommel", 30, "Wirf eine Münze. Bei Kopf ist der Gegner verwirrt.", "Ein Blatt auf dem Kopf, und schon hält es sich für einen Mönch. Der Bambus nickt höflich.", 8200],
  [67, "monster", "Hotarumo", "electric", 90, 0, null, "Glühstaub", 40, "", "Wo es über den Teich streicht, wachen die Glühwürmchen auf und fragen nach dem Weg.", 11800],
  [68, "monster", "Raitora", "electric", 110, 0, null, "Donnersprung", 60, "", "Brüllt erst, wenn der Blitz schon eingeschlagen hat. Es will das letzte Wort.", 24500],
  [69, "monster", "Mizuhebi", "water", 100, 0, null, "Nebelwindung", 50, "", "Taucht auf, wenn der See zu still wird. Fischer rudern dann sehr leise nach Hause.", 16200],
  [70, "monster", "Kamejima", "rock", 130, 0, null, "Inselstoß", 40, "Verhindere beim nächsten Angriff 20 Schaden.", "Auf seinem Panzer stehen ein Schrein und eine Kiefer. Miete zahlt keiner.", 19800],
  [71, "warrior", "Hayate", "dark", 80, 0, null, "Stiller Zug", 30, "", "Wartet am roten Tor, bis der Mond sich im See verbeugt.", 10400],
  [72, "warrior", "Hayashura", "dark", 120, 1, 71, "Ahornsturm", 80, "", "Wo sie tanzt, fällt der Herbst eine Woche früher.", 38000],
  [73, "warrior", "Yukimichi", "water", 90, 0, null, "Brückenschritt", 40, "", "Überquert die Brücke jede Nacht. Am anderen Ufer wartet nur der Schnee.", 13600],
  [74, "monster", "Chochiri", "fire", 80, 0, null, "Laternenzunge", 40, "", "Hängt beim Fest zwischen den anderen Laternen und zwinkert, wenn keiner hinsieht.", 7900],
  [75, "warrior", "Susukiya", "steel", 100, 0, null, "Silbergrasspeer", 50, "", "Das Gras beugt sich vor ihr. Sie hält es für Wind und lässt es dabei.", 15400],
  [76, "monster", "Kumoryuu", "dragon", 120, 0, null, "Perlenwirbel", 70, "", "Hütet eine Perle zwischen den Wolken. Ihr Kurs steigt mit jedem Vollmond.", 42000],
  [77, "monster", "Gamaroku", "water", 110, 0, null, "Regenquaken", 40, "", "Quakt den Regen herbei und beschwert sich dann über nasse Füße.", 8600],
  [78, "warrior", "Kagenuki", "dark", 90, 0, null, "Schattenklinge", 60, "", "Läuft über die Tempeldächer, ohne einen Ziegel zu wecken.", 27500],
  [79, "monster", "Shishiseki", "rock", 130, 0, null, "Steinbrüller", 50, "", "Bewacht die Tempelstufen seit dreihundert Jahren. Das Moos zählt mit.", 12100],
  [80, "monster", "Kaedeshi", "grass", 100, 0, null, "Herbstgeweih", 50, "Heile 20 Schaden bei diesem Nexamon.", "Wo es grast, färbt sich der Ahorn über Nacht.", 17300],
  [81, "warrior", "Kagurane", "fairy", 90, 0, null, "Glockentanz", 40, "Heile 20 Schaden bei diesem Nexamon.", "Tanzt für den Schrein, bis die Blüten im Takt fallen.", 22800],
  [82, "monster", "Fukuron", "psychic", 90, 0, null, "Mondblick", 40, "", "Sieht in der Winternacht alles. Erzählt aber nur die Hälfte.", 9900],
  [83, "warrior", "Tetsugen", "steel", 140, 0, null, "Eisenwille", 80, "", "Ein Feldherr ohne Heer. Die Banner wehen trotzdem für ihn.", 52000],
  [84, "monster", "Kujirai", "water", 140, 0, null, "Mondsprung", 70, "", "Springt einmal im Jahr aus dem Meer, um dem Mond die Hand zu geben.", 31000],
];

export const YIN_YANG_RARES_CARDS: YinYangCardDraft[] = ROWS.map(
  ([number, kind, name, type, hp, stage, from, attack, damage, text, flavor, startPriceCents]) => ({
    key: key(number),
    number,
    rarity: "rare",
    kind,
    name,
    type,
    hp,
    stage,
    evolvesFrom: from === null ? null : key(from),
    attack: { name: attack, damage, text },
    flavor,
    startPriceCents,
  }),
);

/** Artwork per card key (60 x 40 framed scenes). */
export const YIN_YANG_RARES_ART: Record<string, NexamonArt> = {
  ...YY_ART_RARES_1,
  ...YY_ART_RARES_2,
  ...YY_ART_RARES_3,
};
