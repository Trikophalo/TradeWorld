import { ME_ART_COMMONS_1 } from "./art-mystic-energy/commons-1";
import { ME_ART_COMMONS_2 } from "./art-mystic-energy/commons-2";
import { ME_ART_COMMONS_3 } from "./art-mystic-energy/commons-3";
import { ME_ART_COMMONS_4 } from "./art-mystic-energy/commons-4";
import { ME_ART_LEGENDARIES } from "./art-mystic-energy/legendaries";
import { ME_ART_PRISMAS } from "./art-mystic-energy/prismas";
import { ME_ART_RARES } from "./art-mystic-energy/rares";
import { ME_ART_ULTRAS } from "./art-mystic-energy/ultras";
import { nexamonKey, nexamonRarityOfNumber, type NexamonArt, type NexamonCard, type NexamonType } from "./types";

/*
 * "Nexamon: Mystic Energy", the entry set: mystical nature and raw energy. Forest spirits, glowing mushrooms,
 * crystal caves, moonlit ponds, will-o'-the-wisps and auroras. Cards 1-50 common, 51-60 rare, 61-70 ultra,
 * 71-75 prisma, 76-77 legendary (the guardians of the energy source).
 */

/** name, type, HP, stage, number of the card it evolves from, attack name, damage, attack text, flavour, price. */
type Row = [string, NexamonType, number, 0 | 1 | 2, number | null, string, number, string, string, number];

// prettier-ignore
const ROWS: readonly Row[] = [
  // Commons 1-50
  ["Glimmkitz", "fire", 50, 0, null, "Funkenhüpfer", 10, "", "Seine Hörnchen glimmen, wenn es sich freut. Also praktisch immer.", 420],
  ["Lohbock", "fire", 80, 1, 1, "Glutramme", 30, "", "Wo er trainiert, wächst jahrelang kein Gras. Dafür hervorragender Röstklee.", 260],
  ["Tümpli", "water", 50, 0, null, "Blubberstoß", 10, "", "Trägt immer einen Tautropfen auf dem Kopf. Verliert es ihn, weint es einen neuen.", 450],
  ["Quellmolch", "water", 80, 1, 3, "Quellkugel", 30, "", "Formt Wasserkugeln und jongliert sie stundenlang. Publikum ist erwünscht.", 240],
  ["Nüssli", "grass", 50, 0, null, "Nusswurf", 10, "", "Vergräbt seine Nüsse sehr sorgfältig und vergisst dann zuverlässig, wo.", 480],
  ["Blattschweif", "grass", 80, 1, 5, "Laubwirbel", 30, "", "Sein Schweif raschelt im Wind wie ein ganzer Wald im Herbst.", 250],
  ["Pilzli", "grass", 40, 0, null, "Sporenpuff", 10, "Wirf eine Münze. Bei Kopf schläft das gegnerische Nexamon ein.", "Leuchtet nachts ganz leise vor sich hin. Liebt Regen, Nebel und Kompost.", 180],
  ["Schimmerhut", "grass", 70, 1, 7, "Leuchtsporen", 20, "", "Wanderer folgen seinem Licht aus dem Wald. Meistens in die richtige Richtung.", 210],
  ["Flackri", "fire", 40, 0, null, "Irrfunke", 10, "", "Ein Irrlicht, das selbst ständig die Orientierung verliert.", 150],
  ["Irrwisch", "fire", 70, 1, 9, "Laternenspuk", 30, "", "Trägt eine Laterne, obwohl es selbst leuchtet. Sicher ist sicher.", 230],
  ["Funzel", "electric", 40, 0, null, "Blinkstoß", 10, "", "Blinkt, wenn es aufgeregt ist. Es ist eigentlich immer aufgeregt.", 130],
  ["Blinkäfer", "electric", 70, 1, 11, "Voltflügel", 30, "", "Sein Hinterteil hat mehr Lumen als so manche Schreibtischlampe.", 220],
  ["Kullerkies", "rock", 50, 0, null, "Kullerstoß", 10, "", "Hält sich für einen Berg. Niemand hat das Herz, ihm die Wahrheit zu sagen.", 160],
  ["Quarzling", "rock", 90, 1, 13, "Splitterhieb", 30, "", "Seine Kristalle wachsen einen Fingerbreit pro Jahr. Es hat keine Eile.", 270],
  ["Platschi", "water", 50, 0, null, "Platscher", 10, "", "Sein Seerosenhut hält Sonne, Regen und neugierige Libellen fern.", 140],
  ["Seerosar", "water", 80, 1, 15, "Teichwelle", 30, "", "Die Blüte auf seinem Kopf öffnet sich nur bei Mondschein.", 230],
  ["Tauli", "fairy", 40, 0, null, "Tauperle", 10, "Heile 10 Schaden bei diesem Nexamon.", "Wird jeden Morgen bei Sonnenaufgang neu geboren und ist trotzdem müde.", 200],
  ["Morgentau", "fairy", 70, 1, 17, "Glitzerregen", 20, "", "Wo es tanzt, glitzern die Wiesen noch bis zum Mittag.", 260],
  ["Runi", "psychic", 50, 0, null, "Starrblick", 10, "", "Ein Kiesel mit Auge. Es blinzelt nie. Aus Prinzip.", 190],
  ["Runor", "psychic", 80, 1, 19, "Runenpuls", 30, "", "Niemand kann seine Runen lesen. Es selbst vermutlich auch nicht.", 280],
  ["Schattli", "dark", 40, 0, null, "Knabberbiss", 10, "", "Schläft kopfüber und träumt davon, endlich einmal aufrecht zu fliegen.", 170],
  ["Dämmerflug", "dark", 70, 1, 21, "Sturzflug", 30, "", "Jagt in der Dämmerung. Seine Ohren hören sogar fallende Kurse.", 240],
  ["Uhuli", "dark", 50, 0, null, "Schnabelpick", 10, "", "Dreht den Kopf einmal rundherum und ist dann selbst ganz überrascht.", 330],
  ["Mondkauz", "dark", 80, 1, 23, "Mondschrei", 30, "", "Der Halbmond auf seiner Brust nimmt zu und ab, ganz wie der echte.", 290],
  ["Schürfi", "steel", 50, 0, null, "Kratzer", 10, "", "Gräbt nach Erz, findet meistens Regenwürmer und freut sich trotzdem.", 150],
  ["Schachtmull", "steel", 90, 1, 25, "Stahlklaue", 30, "", "Schichtbeginn ist bei ihm immer. Feierabend kennt es nur vom Hörensagen.", 250],
  ["Wyrmli", "dragon", 60, 0, null, "Minifauch", 20, "", "Sein Fauchen klingt wie ein Niesen. Es übt täglich, zur Freude aller.", 950],
  ["Auraschuppe", "dragon", 90, 1, 27, "Polarschweif", 40, "", "Seine Flügel schimmern wie das Nordlicht, unter dem es geschlüpft ist.", 700],
  ["Kohlchen", "fire", 50, 0, null, "Glutstupser", 10, "", "Ein Stück Kohle mit Gefühlen. Bitte nicht in den Grill legen.", 140],
  ["Glutbrocken", "fire", 90, 1, 29, "Magmafaust", 40, "", "In seinem Bauch brodelt es. Ob Lava oder Hunger, weiß man nie genau.", 240],
  ["Blubbel", "water", 40, 0, null, "Nesselchen", 10, "", "Treibt mit der Strömung. Ein Plan würde es nur unnötig stressen.", 160],
  ["Quallux", "water", 70, 1, 31, "Lichttentakel", 30, "", "Seine Laternen locken kleine Fische an. Und neugierige Taucher.", 300],
  ["Samfluff", "grass", 40, 0, null, "Pusteflug", 10, "", "Ein Windstoß genügt und es ist drei Wiesen weiter. Es nennt das Urlaub.", 120],
  ["Pustewind", "grass", 70, 1, 33, "Samensturm", 20, "Wirf eine Münze. Bei Kopf ist das gegnerische Nexamon verwirrt.", "Wer es anpustet, darf sich etwas wünschen. Es wünscht sich Windstille.", 210],
  ["Wurzli", "grass", 50, 0, null, "Wurzelpiks", 10, "", "Steht am liebsten still und tut so, als wäre es ein ganz normaler Baumstumpf.", 130],
  ["Knorrholz", "grass", 90, 1, 35, "Asthieb", 30, "", "Auf seinem Kopf blüht jedes Frühjahr genau eine Blume. Es ist sehr stolz.", 220],
  ["Wölkli", "electric", 50, 0, null, "Knisterwolle", 10, "", "Wer es streichelt, bekommt eine gewischt. Es meint das nicht böse.", 520],
  ["Donnerwoll", "electric", 80, 1, 37, "Donnerkopf", 30, "", "Zieht ein Gewitter auf, steht seine Wolle senkrecht in den Himmel.", 280],
  ["Träumli", "psychic", 40, 0, null, "Gähner", 0, "Das gegnerische Nexamon schläft ein.", "Schläft 23 Stunden am Tag. In der übrigen Stunde macht es ein Nickerchen.", 380],
  ["Schlummerfalter", "psychic", 70, 1, 39, "Traumstaub", 20, "", "Sein Flügelstaub schenkt süße Träume. Oder sehr seltsame.", 310],
  ["Glöckli", "fairy", 40, 0, null, "Bimmelstoß", 10, "", "Läutet, wenn es glücklich ist. Seine Nachbarn tragen Ohrstöpsel.", 170],
  ["Blütenklang", "fairy", 70, 1, 41, "Glockenspiel", 30, "", "Spielt Melodien, bei denen sogar Disteln aufblühen.", 250],
  ["Höhlux", "rock", 50, 0, null, "Schleimspur", 10, "", "Braucht für einen Meter eine Stunde. Dafür ist sein Haus ein Edelstein.", 180],
  ["Geodenschneck", "rock", 90, 1, 43, "Geodenwall", 20, "Verhindere im nächsten Zug 20 Schaden an diesem Nexamon.", "Von außen grau, innen ein Schatz. Es zeigt ihn nur guten Freunden.", 340],
  ["Münzli", "steel", 60, 0, null, "Talerwurf", 20, "Wirf eine Münze. Bei Kopf fügt der Angriff 10 Schaden mehr zu.", "Poliert seinen Panzer jeden Morgen. Kopf oder Zahl? Immer Kopf.", 620],
  ["Bullfink", "fire", 50, 0, null, "Hornpick", 20, "", "Singt nur, wenn die Kurse steigen. Dann aber den ganzen Tag.", 580],
  ["Brummbär", "dark", 70, 0, null, "Tatzenhieb", 20, "", "Verschläft jede Rallye und brummt, wenn man ihn weckt. Fallende Kurse sind sein Schlaflied.", 560],
  ["Harzknubbel", "grass", 50, 0, null, "Schuppenwurf", 10, "", "Fällt im Herbst vom Baum und klettert im Frühling beleidigt wieder hinauf.", 110],
  ["Sternschnupp", "fairy", 50, 0, null, "Sternenstaub", 10, "", "Fiel vom Himmel und fand es hier unten so nett, dass es geblieben ist.", 880],
  ["Libellux", "dragon", 60, 0, null, "Schwirrbiss", 20, "", "Halb Libelle, halb Drache, ganz schön schnell. Steht in der Luft wie ein Fragezeichen.", 640],
  // Rares 51-60
  ["Leuchtmorchel", "grass", 120, 2, 8, "Sporennebel", 50, "Das gegnerische Nexamon ist jetzt vergiftet.", "Unter ihrem Hut ist es immer hell. Wanderer nennen sie die Laterne des Waldes.", 1_400],
  ["Lichterloh", "fire", 110, 2, 10, "Seelenfeuer", 60, "", "Führt Verirrte durch das Moor. Ob hinein oder hinaus, verrät es nicht.", 1_900],
  ["Voltaris", "electric", 110, 2, 12, "Blitzschwarm", 60, "", "Ein Flügelschlag lädt die Luft auf. Zwei, und es regnet Funken.", 1_700],
  ["Aurofee", "fairy", 100, 2, 18, "Morgenröte", 50, "Heile 20 Schaden bei einem deiner Nexamon.", "Malt jeden Morgen das erste Licht an den Himmel. Montags mit etwas weniger Elan.", 2_600],
  ["Nachtschwinge", "dark", 120, 2, 22, "Finsterschwinge", 70, "", "Wenn sie die Flügel ausbreitet, wird es selbst dem Mond ein wenig mulmig.", 2_200],
  ["Bohrbaron", "steel", 130, 2, 26, "Bohrstoß", 70, "", "Er bohrt nicht nach Gold. Er bohrt, weil er es kann. Das Gold nimmt er trotzdem.", 1_200],
  ["Urknorr", "grass", 140, 2, 36, "Wurzelbeben", 70, "", "Älter als der Wald, den er hütet. Zählt seine Jahresringe ungern laut.", 3_200],
  ["Teichkönig", "water", 130, 2, 16, "Königssprung", 60, "", "Regiert den Teich mit milder Hand und sehr langer Zunge.", 900],
  ["Nachtorakel", "dark", 120, 2, 24, "Sternendeutung", 50, "Sieh dir die obersten 3 Karten deines Decks an.", "Liest die Zukunft in den Sternen. Kursziele nennt es grundsätzlich keine.", 4_200],
  ["Aurolux", "electric", 90, 0, null, "Polarlicht", 50, "", "Wo sein Schweif den Himmel streift, beginnt das Nordlicht zu tanzen.", 7_400],
  // Ultra Rares 61-70
  ["Brandhorn", "fire", 160, 2, 2, "Infernoramme", 120, "Dieses Nexamon fügt sich selbst 20 Schaden zu.", "Seine Hörner glühen heißer als jede Schmiede. Wer ihm im Weg steht, stand im Weg.", 198_000],
  ["Flutlurch", "water", 160, 2, 4, "Springflut", 110, "", "Wo er auftaucht, steigt der Pegel. Deiche hält er für eine Einladung.", 128_000],
  ["Wipfelkron", "grass", 150, 2, 6, "Kronensturm", 100, "Heile 20 Schaden bei diesem Nexamon.", "Springt von Krone zu Krone und trägt den Frühling in den Wald.", 112_000],
  ["Kristallkoloss", "rock", 180, 2, 14, "Prismenschlag", 110, "", "Tausend Jahre Druck haben ihn geformt. Seitdem bringt ihn nichts mehr aus der Ruhe.", 64_000],
  ["Orakelith", "psychic", 150, 2, 20, "Allsehendes Auge", 90, "Dein Gegner zeigt dir seine Handkarten.", "Sieht alles, weiß alles und sagt es niemandem. Analysten hassen diesen Trick.", 86_000],
  ["Sturmvlies", "electric", 150, 2, 38, "Donnerkeil", 120, "", "Reitet auf Gewitterfronten. Seine Hörner sind die ersten Blitzableiter der Welt.", 74_000],
  ["Vulkanor", "fire", 170, 2, 30, "Eruption", 130, "Lege 1 Energie von diesem Nexamon ab.", "Auf seinem Rücken brodelt ein Vulkan. Er selbst bleibt dabei erstaunlich gelassen.", 42_000],
  ["Klangflora", "fairy", 140, 2, 42, "Blütensinfonie", 90, "", "Wenn sie tanzt, läuten alle Blumen der Wiese mit. Der Applaus kommt von den Bienen.", 28_000],
  ["Runenritter", "steel", 160, 0, null, "Runenklinge", 110, "", "Eine leere Rüstung, erfüllt von alter Energie. Wem sie einst diente, weiß nur das Schwert.", 152_000],
  ["Neumondwolf", "dark", 160, 0, null, "Mondfinsternis", 130, "", "Heult nur in mondlosen Nächten. Dann verstummt selbst der Wald.", 236_000],
  // Prisma Illustration Rares 71-75
  ["Aurorawyrm", "dragon", 220, 2, 28, "Polarlichtodem", 180, "", "Zieht er über den Himmel, leuchtet die Nacht in allen Farben.", 2_350_000],
  ["Mondqualle", "water", 200, 2, 32, "Gezeitentanz", 150, "Heile 30 Schaden bei diesem Nexamon.", "Steigt bei Vollmond aus der Tiefe und trägt ein Stück Mondlicht im Schirm.", 980_000],
  ["Traumschwinge", "psychic", 200, 2, 40, "Mondtraum", 160, "Das gegnerische Nexamon schläft ein.", "Wer ihren Flügelschlag hört, träumt in dieser Nacht vom Fliegen.", 1_450_000],
  ["Hainhüter", "grass", 230, 0, null, "Urwaldsegen", 150, "", "Niemand hat sein Gesicht je gesehen. Der Wald wächst, wo seine Laterne leuchtet.", 720_000],
  ["Lohenix", "fire", 210, 0, null, "Sonnenschwinge", 190, "", "Aus jeder Asche steigt er neu empor. Rückschläge nennt er Anlauf.", 1_850_000],
  // Legendary Illustration Rares 76-77
  ["Solvenar", "fairy", 280, 0, null, "Erstes Licht", 250, "", "Hüter der Morgenquelle. In seinem Geweih geht jeden Tag die Sonne auf.", 17_500_000],
  ["Nyxomar", "water", 290, 0, null, "Sternenflut", 260, "", "Hüterin der Tiefenquelle. Sie trägt die Nacht über das Meer und den Mond auf dem Rücken.", 14_800_000],
];

/** Catalogue of the set (77 cards). */
export const MYSTIC_ENERGY_CARDS: readonly NexamonCard[] = ROWS.map(
  ([name, type, hp, stage, from, attack, damage, text, flavor, startPriceCents], i) => ({
    key: nexamonKey("mystic_energy", i + 1),
    set: "mystic_energy",
    number: i + 1,
    rarity: nexamonRarityOfNumber(i + 1),
    name,
    type,
    hp,
    stage,
    evolvesFrom: from === null ? null : nexamonKey("mystic_energy", from),
    attack: { name: attack, damage, text },
    flavor,
    startPriceCents,
  }),
);

/** Artwork per card key. A card without an entry is drawn with the renderer's placeholder. */
export const MYSTIC_ENERGY_ART: Readonly<Record<string, NexamonArt>> = {
  ...ME_ART_COMMONS_1,
  ...ME_ART_COMMONS_2,
  ...ME_ART_COMMONS_3,
  ...ME_ART_COMMONS_4,
  ...ME_ART_RARES,
  ...ME_ART_ULTRAS,
  ...ME_ART_PRISMAS,
  ...ME_ART_LEGENDARIES,
};
