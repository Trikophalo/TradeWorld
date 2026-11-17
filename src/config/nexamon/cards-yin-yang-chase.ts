import { YY_ART_CHASE_LEGENDARIES } from "./art-yin-yang/chase-legendaries";
import { YY_ART_CHASE_PRISMAS_1 } from "./art-yin-yang/chase-prismas-1";
import { YY_ART_CHASE_PRISMAS_2 } from "./art-yin-yang/chase-prismas-2";
import { YY_ART_CHASE_ULTRAS_1 } from "./art-yin-yang/chase-ultras-1";
import { YY_ART_CHASE_ULTRAS_2 } from "./art-yin-yang/chase-ultras-2";
import type { NexamonArt } from "./types";
import type { YinYangCardDraft, YinYangRarity, YinYangType } from "./yinyang-draft";

/*
 * "Nexamon: Yin Yang", chase part (cards 85-110): ultra rares breaking out of the frame, the eight prisma
 * illustrations (vast landscapes with a lone warrior or a great spirit) and the legendary pair Yin and Yang.
 * Final forms of three lines from the commons part: yy-085 (koi line, from yy-021), yy-090 (ronin line,
 * from yy-031) and yy-101 (crane spirit line, from yy-041).
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
const rarity = (n: number): YinYangRarity => (n <= 100 ? "ultra" : n <= 108 ? "prisma" : "legendary");

// prettier-ignore
const ROWS: readonly Row[] = [
  // ultra rare
  [85, "monster", "Ryukoga", "dragon", 180, 2, 21, "Drachenkaskade", 150, "Wirf eine Münze. Bei Kopf trifft der Angriff auch die Bank des Gegners.", "Hundert Jahre schwamm er gegen den Strom. Am Wasserfall wurden ihm Hörner geschenkt.", 1_850_000],
  [86, "monster", "Kyubira", "fire", 130, 0, null, "Fuchsfeuerreigen", 110, "", "Tanzt nachts auf Schreindächern. Wer seinen Lichtern folgt, findet heim oder nie wieder.", 420_000],
  [87, "monster", "Onigara", "dark", 150, 0, null, "Maskenzorn", 130, "Der Gegner kann im nächsten Zug nicht angreifen.", "Eine Maske ohne Gesicht dahinter. Im Gewitter lacht sie lauter als der Donner.", 365_000],
  [88, "monster", "Bamburo", "grass", 140, 0, null, "Bambussprung", 120, "", "Springt so leise durch den Hain, dass nur die Halme sich verneigen.", 248_000],
  [89, "monster", "Raitenko", "electric", 140, 0, null, "Donnerheulen", 120, "Wirf eine Münze. Bei Kopf ist der Gegner gelähmt.", "Sein Heulen ruft den Blitz. Bergbauern zählen die Sekunden bis zum Echo.", 296_000],
  [90, "warrior", "Mugenro", "steel", 170, 2, 31, "Klinge ohne Ende", 160, "", "Er zog das Schwert nur einmal im Leben. Die Ahornblätter fallen seitdem in zwei Hälften.", 2_150_000],
  [91, "monster", "Jagamori", "psychic", 150, 0, null, "Nebelumschlingung", 110, "Der Gegner ist verwirrt.", "Hütet den Inselschrein seit tausend Wintern. Opfergaben nimmt es nur bei Vollmond an.", 512_000],
  [92, "monster", "Kamegaku", "rock", 190, 0, null, "Inselbeben", 100, "", "Auf seinem Panzer wachsen Kiefern und ein Tempel. Die Mönche merken nur, dass er reist.", 188_000],
  [93, "monster", "Yamaga", "fairy", 130, 0, null, "Laternenstaub", 100, "Heile 30 Schaden bei deinem Nexamon.", "Sammelt das Licht vergessener Laternen und trägt es auf den Flügeln zum Mond.", 214_000],
  [94, "warrior", "Yumika", "fire", 120, 0, null, "Glutpfeil", 130, "", "Ihr letzter Pfeil fliegt noch. Man sagt, er sucht ein Ziel, das es wert ist.", 640_000],
  [95, "warrior", "Karasuba", "dark", 140, 0, null, "Rabenschwinge", 120, "", "Halb Krieger, halb Krähe. Kassiert Wegzoll in Federn und alten Geheimnissen.", 275_000],
  [96, "warrior", "Sekkai", "psychic", 150, 0, null, "Stille im Sturm", 100, "Verhindere im nächsten Zug allen Schaden an diesem Nexamon.", "Ging in den Schneesturm, um zu schweigen. Der Sturm schwieg zuerst.", 330_000],
  [97, "monster", "Takobori", "water", 170, 0, null, "Achtfache Umarmung", 120, "", "Der Fischer warf das Netz und holte acht Arme ein. Seitdem fischt er an Land.", 172_000],
  [98, "monster", "Shuenka", "fire", 150, 0, null, "Sonnenschweif", 140, "", "Steigt jeden Morgen vor der Sonne auf, damit sie den Weg findet.", 890_000],
  [99, "warrior", "Hanakiri", "fairy", 130, 0, null, "Blütenschnitt", 140, "", "Zwei Klingen, ein Atemzug. Wenn die Blüten fallen, ist der Kampf längst vorbei.", 1_120_000],
  [100, "monster", "Yoroiden", "steel", 160, 0, null, "Geisterrüstung", 130, "", "Eine leere Rüstung, die noch Wache hält. Ihr Herr ist lange fort, ihr Eid nicht.", 455_000],
  // prisma illustration rare
  [101, "monster", "Hakuzuru", "fairy", 190, 2, 41, "Mondflug", 160, "Heile 50 Schaden bei jedem deiner Nexamon.", "Wenn der Kranichgeist über den See zieht, bleibt das Mondlicht kurz auf dem Wasser stehen.", 14_800_000],
  [102, "warrior", "Blutmondduell", "dark", 180, 0, null, "Gekreuzte Klingen", 180, "Dieses Nexamon erhält 30 Schaden.", "Zwei Schwerter, eine Brücke, ein roter Mond. Nur einer geht ans andere Ufer.", 18_600_000],
  [103, "warrior", "Takiyomi", "water", 170, 0, null, "Wasserfallgebet", 150, "", "Er betet unter dem Fall, bis das Rauschen leiser ist als seine Gedanken.", 9_200_000],
  [104, "warrior", "Wogenbrecher", "water", 180, 0, null, "Wellenbrecher", 170, "", "Die Welle ist hundertmal größer als er. Er hat trotzdem nicht vor zu weichen.", 21_400_000],
  [105, "warrior", "Gipfeltempel", "rock", 170, 0, null, "Morgenglocke", 140, "Ziehe eine Karte.", "Tausend Stufen bis zur Glocke. Wer sie bei Sonnenaufgang schlägt, hört sie im Tal zuletzt.", 6_300_000],
  [106, "monster", "Mondseedrache", "dragon", 200, 0, null, "Mondsee-Flut", 190, "", "Er steigt nur aus dem See, wenn der Mond voll ist. Der Fischer wartet seit vierzig Jahren.", 24_200_000],
  [107, "warrior", "Ahornsturm", "fire", 170, 0, null, "Ahornwirbel", 160, "", "Der Herbst kam über Nacht. Der Wanderer ging ihm einfach entgegen.", 11_700_000],
  [108, "monster", "Bambusgeist", "grass", 190, 0, null, "Geisterhain", 160, "Der Gegner kann sich im nächsten Zug nicht zurückziehen.", "Im Bambushain kniet man vor dem Fuchs. Wer steht, sieht ihn nicht.", 7_800_000],
  // legendary illustration rare
  [109, "warrior", "Yin", "dark", 240, 0, null, "Schwarzer Mond", 220, "Lege Yang daneben, und kein Angriff des Gegners trifft im nächsten Zug.", "Im Dunkel trägt er ein einziges Licht. Er weiß, wem es gehört.", 168_000_000],
  [110, "warrior", "Yang", "fairy", 240, 0, null, "Weißer Mond", 220, "Lege Yin daneben, und heile allen Schaden bei deinen Nexamon.", "Im Licht trägt sie einen einzigen Schatten. Sie weiß, wem er gehört.", 164_000_000],
];

export const YIN_YANG_CHASE_CARDS: YinYangCardDraft[] = ROWS.map(
  ([number, kind, name, type, hp, stage, from, attack, damage, text, flavor, startPriceCents]) => ({
    key: key(number),
    number,
    rarity: rarity(number),
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

export const YIN_YANG_CHASE_ART: Record<string, NexamonArt> = {
  ...YY_ART_CHASE_ULTRAS_1,
  ...YY_ART_CHASE_ULTRAS_2,
  ...YY_ART_CHASE_PRISMAS_1,
  ...YY_ART_CHASE_PRISMAS_2,
  ...YY_ART_CHASE_LEGENDARIES,
};
