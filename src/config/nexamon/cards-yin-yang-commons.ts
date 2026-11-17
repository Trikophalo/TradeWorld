import { YY_ART_COMMONS_1 } from "./art-yin-yang/commons-1";
import { YY_ART_COMMONS_2 } from "./art-yin-yang/commons-2";
import { YY_ART_COMMONS_3 } from "./art-yin-yang/commons-3";
import { YY_ART_COMMONS_4 } from "./art-yin-yang/commons-4";
import { YY_ART_COMMONS_5 } from "./art-yin-yang/commons-5";
import type { NexamonArt } from "./types";
import type { YinYangCardDraft, YinYangType } from "./yinyang-draft";

/*
 * "Yin Yang", part "commons": cards yy-001 ... yy-054 (Common, 60 x 40 framed scenes). About half lone warriors in
 * vast Japanese landscapes, half spirit creatures. Start prices in cents.
 *
 * Cross-part evolution lines (stage 0 and 1 here, the final form is drawn by another part):
 *
 * - yy-001 Sakiri -> yy-002 Sakirai -> rare yy-055 (steel, warrior): a young wandering swordswoman. Black hair in a
 *   high ponytail tied with a vermilion cord, indigo travelling kimono with cream sash, straw sandals; Sakiri carries
 *   a wooden practice sword in a bamboo forest in rain, Sakirai a real katana in a black scabbard and a short
 *   vermilion scarf, on a windy ridge. Final: grown master, long vermilion scarf streaming, drawn steel blade gleaming,
 *   alone on a cliff above a sea of cloud under a pale moon.
 * - yy-010 Kitsuro -> yy-011 Kitsurai -> rare yy-060 (fire, monster): a fox spirit. Cream-white fur, vermilion
 *   markings around the eyes and on the ear tips, pale gold eyes; Kitsuro is a small kit with one tail and a floating
 *   fox-fire wisp, Kitsurai a slender fox with three tails tipped in flame among stone lanterns. Final: tall fox with
 *   nine flame-tipped tails fanned like a halo, ring of blue-white fox-fires, before a vermilion shrine gate at night.
 * - yy-020 Koibo -> yy-021 Koiryu -> ultra yy-085 (water, monster): a koi that becomes a dragon. Koibo is a white koi
 *   with vermilion patches and a gold-rimmed eye in dark indigo water; Koiryu is a longer koi with flowing fins, tiny
 *   whisker barbels and the first gold scales leaping up a waterfall. Final: a long serpentine dragon, white body with
 *   vermilion koi patches, gold mane and horns, fin-like flowing tail, bursting out of a curling woodblock wave.
 * - yy-030 Kasajin -> yy-031 Kasamaru -> ultra yy-090 (dark, warrior): a ronin in a straw hat. Wide conical straw hat
 *   hiding the eyes, tattered ink-grey cloak, one katana with a vermilion-wrapped hilt; Kasajin walks a lonely road
 *   at dusk, Kasamaru stands in wind-blown grass with a torn cloak and two swords. Final: the ronin on a cliff edge,
 *   enormous blood-red sun behind him, cloak tearing in the wind, crows and a distant gate, blade half drawn.
 * - yy-040 Tsurei -> yy-041 Tsureika -> prisma yy-101 (psychic, monster): a crane spirit. White crane with black
 *   neck and wing tips, a vermilion crown spot and a faint pale-gold glow; Tsurei is a fluffy chick in reeds,
 *   Tsureika a slender crane dancing on a misty marsh. Final: a giant crane with wings spread across a full moon,
 *   wing tips dissolving into ink-wash mist and floating gold feathers above a sea of clouds.
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
  [1, "warrior", "Sakiri", "steel", 60, 0, null, "Holzschwerthieb", 20, "", "Übt im Regen, bis das Bambusrohr vor ihr Respekt bekommt.", 2400],
  [2, "warrior", "Sakirai", "steel", 90, 1, 1, "Windklinge", 50, "", "Ihr erstes echtes Schwert hat sie nie gezogen. Der Wind weicht trotzdem aus.", 5600],
  [3, "monster", "Tanupon", "grass", 60, 0, null, "Bauchtrommel", 10, "Wirf eine Münze. Bei Kopf ist der Gegner verwirrt.", "Trommelt nachts auf dem Bauch. Die Frösche haben sich längst beschwert.", 1300],
  [4, "monster", "Tanurok", "grass", 100, 1, 3, "Blattverwandlung", 40, "", "Verwandelt Laub in Münzen. Am Morgen ist der Markt wieder voller Blätter.", 4100],
  [5, "monster", "Hotarin", "electric", 50, 0, null, "Glühfunke", 10, "", "Ein Glühwürmchen, das sich verlaufen hat. Es leuchtet trotzdem weiter.", 1100],
  [6, "monster", "Hotaruga", "electric", 80, 1, 5, "Sommerblitz", 40, "", "Tausend Lichter über dem Reisfeld. Eines davon denkt nach.", 3700],
  [7, "warrior", "Yumira", "grass", 60, 0, null, "Ahornpfeil", 20, "", "Trifft jedes fallende Blatt. Nur den Herbst selbst nicht.", 1900],
  [8, "warrior", "Yumirai", "grass", 80, 1, 7, "Doppelsehne", 40, "", "Zieht die Sehne so langsam, dass die Blätter warten.", 3900],
  [9, "warrior", "Yumishin", "grass", 120, 2, 8, "Pfeil der Stille", 80, "", "Ein Pfeil, ein Atemzug, kein Laut. Danach fällt nur noch Ahorn.", 8200],
  [10, "monster", "Kitsuro", "fire", 50, 0, null, "Fuchsfeuer", 20, "", "Ein Fuchsjunges mit einem Licht, das ihm folgt. Oder folgt es dem Licht?", 2700],
  [11, "monster", "Kitsurai", "fire", 90, 1, 10, "Dreischweifglut", 50, "", "Mit jedem Schweif ein Jahrhundert. Mit jedem Jahrhundert ein Trick mehr.", 6400],
  [12, "warrior", "Shoben", "psychic", 70, 0, null, "Stilles Gebet", 10, "Heile 20 Schaden bei diesem Nexamon.", "Zählt jede Stufe zum Tempel. Es sind immer eine mehr als gestern.", 1500],
  [13, "warrior", "Shobenzan", "psychic", 110, 1, 12, "Glockenschlag", 50, "", "Ein Schlag auf die Glocke, und der ganze Berg hört auf zu streiten.", 4400],
  [14, "warrior", "Amiro", "water", 60, 0, null, "Netzwurf", 20, "", "Fischt im Nebel. Was er fängt, erzählt er niemandem.", 1400],
  [15, "warrior", "Amirodo", "water", 100, 1, 14, "Seeruderschlag", 50, "", "Sein Boot kennt den See besser als jede Karte. Der See kennt ihn auch.", 3800],
  [16, "monster", "Menoni", "fire", 60, 0, null, "Maskenstoß", 20, "", "Eine Maske ohne Gesicht dahinter. Sie lacht trotzdem.", 1600],
  [17, "monster", "Menogura", "fire", 90, 1, 16, "Hörnerglut", 40, "", "Die Hörner wachsen, wenn jemand lügt. Am Markttag wird es eng.", 3600],
  [18, "monster", "Menogai", "fire", 130, 2, 17, "Dämonenlachen", 90, "", "Sein Lachen bringt Vulkane zum Erröten.", 7900],
  [19, "warrior", "Masagi", "rock", 80, 0, null, "Axt im Fels", 30, "", "Fällt nur Bäume, die schon schlafen. Den Rest grüßt er.", 2100],
  [20, "monster", "Koibo", "water", 50, 0, null, "Flossenschlag", 10, "", "Ein Koi mit großen Plänen und kleinem Teich.", 3100],
  [21, "monster", "Koiryu", "water", 80, 1, 20, "Wasserfallsprung", 50, "", "Springt den Wasserfall hinauf, Tag für Tag. Die Schuppen werden golden.", 7200],
  [22, "monster", "Ganyo", "psychic", 50, 0, null, "Mondstaub", 10, "Der Gegner schläft ein.", "Fliegt nur zu Laternen, die Geschichten erzählen.", 1200],
  [23, "monster", "Ganyora", "psychic", 80, 1, 22, "Flügelspiegel", 40, "", "Auf seinen Flügeln sieht man den Mond. Auch bei Neumond.", 3300],
  [24, "warrior", "Yarido", "steel", 70, 0, null, "Speerstich", 20, "", "Steht am Pass im Schnee. Wer vorbei will, muss zuerst grüßen.", 1700],
  [25, "warrior", "Yaridomaru", "steel", 110, 1, 24, "Schneesturmspeer", 60, "", "Der Schnee fällt um ihn herum, nie auf ihn.", 4600],
  [26, "monster", "Torako", "electric", 60, 0, null, "Krallenfunke", 20, "", "Ein Tigerjunges, dessen Streifen knistern, wenn es Hunger hat.", 1800],
  [27, "monster", "Toradai", "electric", 110, 1, 26, "Donnerbrüllen", 60, "", "Wenn er brüllt, rollt der Donner über drei Täler. Ab dem vierten flüstert er.", 5200],
  [28, "monster", "Hebina", "dark", 60, 0, null, "Giftbiss", 10, "Der Gegner ist vergiftet.", "Schläft unter dem Schrein. Die Opfergaben fehlen trotzdem nie.", 1300],
  [29, "monster", "Hebinara", "dark", 100, 1, 28, "Schattenschlinge", 50, "", "Windet sich um den Mond, bis er nur noch eine Sichel ist.", 4000],
  [30, "warrior", "Kasajin", "dark", 70, 0, null, "Ziehen und Schneiden", 30, "", "Ein Hut, ein Schwert, keine Heimat. Die Straße fragt nicht nach.", 2900],
  [31, "warrior", "Kasamaru", "dark", 100, 1, 30, "Zwei Klingen", 60, "", "Unter dem Hut ein Blick, den noch kein Gegner gesehen hat. Zumindest keiner, der davon erzählt.", 6900],
  [32, "warrior", "Inahiro", "grass", 70, 0, null, "Sichelschwung", 20, "", "Schützt die Reisterrassen im Morgenlicht. Bezahlt wird in Reis, gern auch in Zinsen.", 1500],
  [33, "warrior", "Inahirobo", "grass", 110, 1, 32, "Erntesturm", 50, "", "Jede Terrasse ein Jahr Arbeit. Jeder Schritt hinauf ein Versprechen.", 4300],
  [34, "warrior", "Tochin", "fire", 60, 0, null, "Laternenschwung", 20, "", "Der Nachtwächter mit der Papierlaterne. Er kennt jede Gasse beim Vornamen.", 1400],
  [35, "warrior", "Tochinbo", "fire", 100, 1, 34, "Flammenwache", 50, "", "Seine Laterne brennt seit hundert Nächten. Öl hat er nie nachgefüllt.", 3500],
  [36, "monster", "Kawazu", "water", 50, 0, null, "Seerosensprung", 10, "", "Ein Frosch, der Haikus quakt. Meistens mit einer Silbe zu viel.", 1100],
  [37, "monster", "Kawazuki", "water", 90, 1, 36, "Regenruf", 40, "", "Quakt er, kommt der Regen. Die Bauern zahlen ihm Provision.", 3400],
  [38, "warrior", "Kageri", "dark", 70, 0, null, "Schattensprung", 30, "", "Läuft über Dächer, ohne einen Ziegel zu wecken.", 3200],
  [39, "warrior", "Taikoro", "electric", 80, 0, null, "Donnertrommel", 30, "", "Trommelt auf der Brücke gegen das Gewitter. Bisher steht es unentschieden.", 2600],
  [40, "monster", "Tsurei", "psychic", 50, 0, null, "Federtanz", 10, "", "Ein Kranichküken im Schilf. Übt schon den Tanz, nur noch ohne Beine.", 3500],
  [41, "monster", "Tsureika", "psychic", 80, 1, 40, "Nebeltanz", 50, "", "Tanzt im Morgennebel, bis niemand mehr weiß, wo der Sumpf aufhört.", 7800],
  [42, "monster", "Yukisaru", "water", 60, 0, null, "Schneeballwurf", 10, "", "Badet in heißen Quellen und hält den Winter für einen Witz.", 1200],
  [43, "monster", "Yukisarumon", "water", 100, 1, 42, "Frostgriff", 50, "", "Der Älteste der Quelle. Wer badet, zahlt Eintritt in Mandarinen.", 3900],
  [44, "warrior", "Takiro", "water", 70, 0, null, "Wasserschnitt", 20, "", "Meditiert unter dem Wasserfall. Kaltes Wasser, klarer Kopf, nasser Hut.", 1600],
  [45, "warrior", "Takirosen", "water", 110, 1, 44, "Fallende Klinge", 60, "", "Hat den Wasserfall einmal geteilt. Er erzählt es nur, wenn man fragt.", 4700],
  [46, "monster", "Karasuke", "dark", 60, 0, null, "Schnabelhieb", 20, "", "Sammelt glänzende Münzen. Seine Rendite schlägt jeden Händler.", 1500],
  [47, "monster", "Karasuo", "dark", 100, 1, 46, "Federsturm", 50, "", "Ein Krähengeist mit langer Nase und noch längerem Gedächtnis.", 4200],
  [48, "warrior", "Kanetsu", "fire", 90, 0, null, "Schmiedehammer", 30, "", "Schmiedet Klingen, die nie zerbrechen. Seine eigene Geduld zerbricht oft.", 2300],
  [49, "monster", "Takenon", "grass", 50, 0, null, "Bambusstoß", 10, "", "Wächst über Nacht einen Meter. Am Morgen ist es selbst erstaunt.", 1000],
  [50, "monster", "Takenomaru", "grass", 90, 1, 49, "Halmwirbel", 40, "", "Wenn der Wind durch ihn fährt, singt der ganze Wald.", 3200],
  [51, "warrior", "Funado", "water", 80, 0, null, "Wellenruder", 30, "", "Rudert hinaus, wenn alle anderen heimrudern. Der Fang gehört ihm allein.", 2200],
  [52, "monster", "Hanari", "fairy", 50, 0, null, "Blütenregen", 10, "", "Ein Kirschblütengeist. Lebt nur eine Woche im Jahr, aber dafür richtig.", 1700],
  [53, "monster", "Hanarisu", "fairy", 90, 1, 52, "Sakurasturm", 50, "Heile 20 Schaden bei diesem Nexamon.", "Wo er tanzt, blühen die Bäume zweimal. Die Gärtner geben auf.", 4500],
  [54, "warrior", "Getsuro", "steel", 90, 0, null, "Mondschnitt", 40, "", "Wartet jede Nacht am roten Tor auf einen Gegner. Der Mond leistet Gesellschaft.", 9800],
];

export const YIN_YANG_COMMONS_CARDS: YinYangCardDraft[] = ROWS.map(
  ([number, kind, name, type, hp, stage, evolvesFrom, attack, damage, text, flavor, startPriceCents]) => ({
    key: key(number),
    number,
    rarity: "common",
    kind,
    name,
    type,
    hp,
    stage,
    evolvesFrom: evolvesFrom === null ? null : key(evolvesFrom),
    attack: { name: attack, damage, text },
    flavor,
    startPriceCents,
  }),
);

export const YIN_YANG_COMMONS_ART: Record<string, NexamonArt> = {
  ...YY_ART_COMMONS_1,
  ...YY_ART_COMMONS_2,
  ...YY_ART_COMMONS_3,
  ...YY_ART_COMMONS_4,
  ...YY_ART_COMMONS_5,
};
