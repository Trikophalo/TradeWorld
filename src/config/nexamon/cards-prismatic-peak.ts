import { PP_ART_COMMONS_1 } from "./art-prismatic-peak/commons-1";
import { PP_ART_COMMONS_2 } from "./art-prismatic-peak/commons-2";
import { PP_ART_COMMONS_3 } from "./art-prismatic-peak/commons-3";
import { PP_ART_COMMONS_4 } from "./art-prismatic-peak/commons-4";
import { PP_ART_COMMONS_5 } from "./art-prismatic-peak/commons-5";
import { PP_ART_LEGENDARIES } from "./art-prismatic-peak/legendaries";
import { PP_ART_PRISMAS_1 } from "./art-prismatic-peak/prismas-1";
import { PP_ART_PRISMAS_2 } from "./art-prismatic-peak/prismas-2";
import { PP_ART_RARES } from "./art-prismatic-peak/rares";
import { PP_ART_ULTRAS } from "./art-prismatic-peak/ultras";
import type { NexamonArt, NexamonCard, NexamonRarity, NexamonType } from "./types";

/*
 * "Nexamon: Prismatic Peak": the luxury set high above the clouds. Crystal and light creatures: prism dragons,
 * glacier spirits, gem golems, cloud whales, aurora foxes and the temple guardians at the summit.
 * Start prices are in cents (set factor 25).
 */
type Row = [
  number: number,
  name: string,
  type: NexamonType,
  hp: number,
  stage: 0 | 1 | 2,
  evolvesFrom: number | null,
  attack: string,
  damage: number,
  text: string,
  flavor: string,
  startPriceCents: number,
];

const key = (n: number) => `pp-${String(n).padStart(3, "0")}`;
const rarity = (n: number): NexamonRarity =>
  n <= 50 ? "common" : n <= 60 ? "rare" : n <= 70 ? "ultra" : n <= 75 ? "prisma" : "legendary";

// prettier-ignore
const ROWS: readonly Row[] = [
  // common
  [1, "Glimmling", "rock", 50, 0, null, "Kieselstups", 10, "", "Wächst in Höhlen, in denen es nie ganz dunkel wird. Kitzelt man es, glitzert es.", 3000],
  [2, "Glimmrock", "rock", 90, 1, 1, "Quarzfaust", 40, "", "Seine Kristalle wachsen mit jedem Jahr einen Fingerbreit. Geduld ist seine größte Stärke.", 5500],
  [3, "Prismi", "dragon", 60, 0, null, "Farbfunke", 20, "", "Hält es seine Flügel in die Sonne, tanzen Regenbögen über den Schnee.", 9500],
  [4, "Prismaro", "dragon", 90, 1, 3, "Spektralschlag", 50, "", "Übt jeden Morgen, das Licht zu brechen. Die Bergdörfer stellen die Uhr nach seinem Farbenspiel.", 14000],
  [5, "Frostel", "water", 50, 0, null, "Eishauch", 10, "Wirf eine Münze. Bei Kopf ist der Gegner eingefroren.", "Ein Gletschertropfen, der beschlossen hat, nicht zu schmelzen.", 3000],
  [6, "Gletschi", "water", 80, 1, 5, "Firnwirbel", 40, "", "Wo es schwebt, knirscht das Eis vor Freude. Wanderer folgen seinem kühlen Leuchten.", 6000],
  [7, "Aurofix", "fairy", 50, 0, null, "Schweifschimmer", 20, "", "Seine Schwanzspitze leuchtet, sobald am Himmel das Polarlicht erwacht.", 11000],
  [8, "Aurovulp", "fairy", 80, 1, 7, "Lichtsprung", 50, "", "Läuft über frischen Schnee, ohne eine Spur zu hinterlassen. Nur ein grüner Schein bleibt zurück.", 16000],
  [9, "Karatli", "steel", 50, 0, null, "Schliff", 10, "", "Trägt seinen Diamanten überallhin. Abgeben? Niemals, der steigt doch noch im Wert.", 3500],
  [10, "Karatank", "steel", 90, 1, 9, "Brillantramme", 50, "", "Sein Panzer hat 58 Facetten. Es hat sie alle selbst nachgezählt, zweimal.", 6500],
  [11, "Wolkini", "water", 60, 0, null, "Nieselfontäne", 20, "", "Lernt das Schwimmen im Wolkenmeer. Aus seinem Blasloch steigen kleine Schäfchenwolken.", 8500],
  [12, "Nimbowal", "water", 100, 1, 11, "Wolkenbruch", 50, "", "Zieht bei Sonnenaufgang über die Gipfel. Sein Schatten bringt den Tälern sanften Regen.", 13000],
  [13, "Sonnling", "fire", 50, 0, null, "Wärmestrahl", 20, "", "Ein Funke Morgensonne, der vom Himmel gepurzelt ist. Schmilzt Schnee im Umkreis von drei Schritten.", 4000],
  [14, "Solario", "fire", 80, 1, 13, "Lichtkugeln", 40, "Wirf 2 Münzen. Der Angriff fügt 40 Schaden pro Kopf zu.", "Jongliert mit zwei kleinen Sonnen. Fällt eine herunter, ist eben kurz Sommer.", 7000],
  [15, "Sternchi", "psychic", 40, 0, null, "Blinzelglanz", 10, "Der Gegner ist jetzt verwirrt.", "Fiel in einer klaren Nacht vom Himmel und fand es hier unten viel gemütlicher.", 7500],
  [16, "Astrella", "psychic", 80, 1, 15, "Sternenstab", 40, "", "Malt mit ihrem Stab neue Sternbilder. Manche davon sehen aus wie steigende Kurse.", 12000],
  [17, "Tempelito", "rock", 60, 0, null, "Steinstoß", 20, "", "Ein Bauklotz des Gipfeltempels, der eines Tages einfach losmarschiert ist.", 3000],
  [18, "Wächtor", "rock", 100, 1, 17, "Runenhieb", 50, "", "Bewacht die Tempeltreppe seit tausend Wintern. Lässt nur durch, wer höflich grüßt.", 6000],
  [19, "Funkfink", "electric", 40, 0, null, "Zwitscherblitz", 10, "", "Sein Gesang knistert. Wer zu nah am Nest steht, bekommt eine Frisur wie sein Kamm.", 2500],
  [20, "Donnerkamm", "electric", 70, 1, 19, "Kammschlag", 40, "", "Steigt vor jedem Gewitter auf und sagt mit dem Kamm das Wetter voraus. Trefferquote: beachtlich.", 5000],
  [21, "Edelwinz", "grass", 40, 0, null, "Blütenschubs", 10, "", "Wurzelt nur über 2.000 Metern. Darunter wird ihm schwindelig.", 2500],
  [22, "Edelblüt", "grass", 70, 1, 21, "Sternblüte", 30, "Heile 10 Schaden bei diesem Nexamon.", "Tanzt im Bergwind, bis die ganze Wiese mitwippt.", 4500],
  [23, "Nachtkauz", "dark", 50, 0, null, "Schattenblick", 20, "", "Sitzt nachts auf verschneiten Ästen und zählt Sterne. Verzählt es sich, fängt es von vorn an.", 4500],
  [24, "Mondeul", "dark", 80, 1, 23, "Mondschwinge", 50, "", "Die Sichel auf seiner Brust nimmt mit dem Mond zu und ab.", 8000],
  [25, "Flöckli", "fairy", 40, 0, null, "Schneenase", 10, "", "So leicht, dass es im Pulverschnee nicht einsinkt. Liebt Möhren und Minusgrade.", 5500],
  [26, "Schneehopp", "fairy", 70, 1, 25, "Pulversprung", 40, "", "Springt von Wechte zu Wechte. Wo es landet, glitzert der Schnee noch stundenlang.", 7500],
  [27, "Zickel", "steel", 50, 0, null, "Hörnchenstoß", 20, "", "Klettert Wände hoch, an denen selbst Fliegen umkehren würden.", 2500],
  [28, "Stahlbock", "steel", 90, 1, 27, "Stahlhornstoß", 50, "", "Wetzt seine Hörner am Fels, bis sie spiegeln. Eitel? Nur ein bisschen.", 5000],
  [29, "Rubinchen", "fire", 50, 0, null, "Glutzunge", 20, "", "Die Rubine auf seinem Rücken sind warm wie Ofenkacheln. Beliebt in kalten Höhlennächten.", 4000],
  [30, "Rubisaur", "fire", 90, 1, 29, "Rubinkamm", 50, "", "Sein Rückenkamm speichert die Hitze des Berginneren. Bei Wut glüht er kirschrot.", 7000],
  [31, "Zapfi", "grass", 50, 0, null, "Zapfenwurf", 20, "", "Trägt das ganze Jahr eine Schneemütze. Im Sommer muss es sie heimlich nachfüllen.", 2500],
  [32, "Tannrich", "grass", 100, 1, 31, "Nadelregen", 50, "", "Schmückt sich mit Eiskristallen und hält sich für den schönsten Baum am Hang. Zu Recht.", 5500],
  [33, "Funkelmott", "electric", 40, 0, null, "Lichtstaub", 10, "Der Gegner ist jetzt paralysiert, wenn du bei einem Münzwurf Kopf hast.", "Fliegt nicht zum Licht, sondern bringt es einfach selbst mit.", 3000],
  [34, "Lumifalter", "electric", 70, 1, 33, "Leuchtschwinge", 40, "", "Ein Flügelschlag erhellt die ganze Almhütte. Stromrechnung: null.", 6000],
  [35, "Orbi", "psychic", 50, 0, null, "Ahnung", 10, "Sieh dir die oberste Karte deines Decks an.", "Sieht die Zukunft, aber nur die nächsten sieben Sekunden. Reicht für die meisten Kurven.", 3500],
  [36, "Orakulon", "psychic", 90, 1, 35, "Weissagung", 50, "", "Seine Prognosen treffen immer ein. Nur wann, das verrät es grundsätzlich nicht.", 6500],
  [37, "Amefledi", "dark", 40, 0, null, "Echobiss", 20, "", "Schläft kopfüber zwischen Amethysten und träumt in Lila.", 3000],
  [38, "Amethystrix", "dark", 80, 1, 37, "Kristallschwinge", 50, "", "Seine Flügel klirren beim Fliegen wie ein Kronleuchter im Sturm.", 6000],
  [39, "Rutschi", "water", 50, 0, null, "Bauchrutscher", 20, "", "Hat den zugefrorenen Bergsee zur Rodelbahn erklärt. Bremsen übt es noch.", 4500],
  [40, "Eisotto", "water", 90, 1, 39, "Eisspeer", 50, "", "Schnitzt seinen Speer jeden Winter neu. Im Frühling bleibt ihm nur der Stiel.", 7000],
  [41, "Schneewurm", "dragon", 60, 0, null, "Flockenbiss", 20, "", "Rollt sich im Schnee zusammen und wird für eine harmlose Wehe gehalten. Meistens stimmt das auch.", 9000],
  [42, "Firnwyrm", "dragon", 90, 1, 41, "Frostschweif", 50, "", "Gleitet lautlos durch Schneestürme. Sein Atem lässt Wasserfälle erstarren.", 15000],
  [43, "Geodi", "rock", 60, 0, null, "Schleimspur", 10, "Der Gegner kann sich im nächsten Zug nicht zurückziehen.", "Außen grauer Stein, innen ein Schatz. Es lässt sich Zeit damit, das zu zeigen.", 3500],
  [44, "Geodon", "rock", 110, 1, 43, "Drusenpanzer", 40, "Dieses Nexamon erleidet im nächsten Zug 20 Schaden weniger.", "Trägt sein Vermögen auf dem Rücken. Langsam, aber krisenfest.", 6500],
  [45, "Yetini", "water", 60, 0, null, "Schneeball", 20, "", "Wirft mit Schneebällen nach allem, was sich bewegt. Meint es aber freundlich.", 5000],
  [46, "Yetigant", "water", 110, 1, 45, "Lawinenfaust", 60, "", "Seine Fußspuren werden für Märchen gehalten. Ihm ist das ganz recht.", 8500],
  [47, "Murmelgold", "steel", 50, 0, null, "Nuggetwurf", 20, "", "Gräbt nicht nach Wurzeln, sondern nach Gold. Hält seinen Fund sehr, sehr fest.", 10000],
  [48, "Murmelbaron", "steel", 100, 1, 47, "Goldregen", 50, "", "Kauft, wenn es schneit, und hält, bis es taut. Sein Bau hat inzwischen einen Tresor.", 21500],
  [49, "Lampio", "fire", 60, 0, null, "Laternenglut", 30, "", "Die Flamme im Tempellicht hat irgendwann zu lächeln begonnen. Seitdem weist sie Wanderern den Weg.", 12500],
  [50, "Opalux", "fairy", 70, 0, null, "Schillerflosse", 30, "", "Schwimmt bei Sonnenaufgang durchs Wolkenmeer. Jede Schuppe zeigt eine andere Farbe.", 24000],
  // rare
  [51, "Kristallope", "fairy", 110, 2, 26, "Geweihglanz", 70, "", "Sein Eisgeweih wächst nur in Vollmondnächten. Wer es sieht, hat sieben Winter Glück.", 65000],
  [52, "Glazioth", "water", 130, 2, 6, "Gletscherkralle", 80, "", "Ein Gletscher mit eigenem Willen. Bewegt sich langsam, aber nichts hält ihn auf.", 54000],
  [53, "Diamantor", "steel", 140, 2, 10, "Diamantzange", 90, "", "Härter als alles, was der Berg je hervorgebracht hat. Kratzer kennt er nur vom Hörensagen.", 82000],
  [54, "Gewittaar", "electric", 120, 2, 20, "Donnersturz", 80, "", "Reitet auf Gewitterfronten. Wo sein Schatten fällt, zählt man besser nicht bis drei.", 48000],
  [55, "Edelkron", "grass", 120, 2, 22, "Blütenzepter", 60, "Heile 20 Schaden bei diesem Nexamon.", "Die Königin der Hochalmen. Wo sie geht, blüht es selbst im Geröll.", 31000],
  [56, "Chrombock", "steel", 130, 2, 28, "Chromsturm", 80, "", "Steht bei jedem Sonnenaufgang am höchsten Grat. Sein Gehörn blendet bis ins Tal.", 42000],
  [57, "Prismafalter", "electric", 110, 2, 34, "Regenbogenstaub", 70, "", "Seine Flügel zerlegen Mondlicht in sieben Farben. Sammler zahlen dafür jeden Preis.", 115000],
  [58, "Yetikhan", "water", 150, 2, 46, "Eiskeule", 100, "", "Herrscher der Eishöhlen. Seine Krone ist nie geschmolzen, sein Geduldsfaden schon öfter.", 70000],
  [59, "Saphirschwan", "water", 100, 0, null, "Saphirschwinge", 60, "", "Gleitet über den Bergsee, ohne das Spiegelbild der Gipfel zu stören.", 145000],
  [60, "Mondlux", "dark", 100, 0, null, "Mondpirsch", 70, "", "Zeigt sich nur bei Vollmond auf dem Gipfelgrat. Seine Augen leuchten wie zwei Goldmünzen.", 190000],
  // ultra
  [61, "Polarlux", "fairy", 170, 0, null, "Polarlichtgalopp", 120, "", "Wenn er über den Himmel springt, hängt sein Geweih das Polarlicht auf.", 3800000],
  [62, "Aurorux", "fairy", 180, 2, 8, "Aurorafächer", 130, "", "Seine drei Schweife malen das Nordlicht in die Nacht. Er heult, und der Himmel antwortet.", 4600000],
  [63, "Heliaros", "fire", 190, 2, 14, "Sonnenkrönung", 140, "Lege 1 Energie von diesem Nexamon ab.", "Hebt jeden Morgen die Sonne über den Gipfel. Sagt er zumindest.", 2100000],
  [64, "Gipfelwacht", "rock", 220, 2, 18, "Tempelfaust", 150, "", "Der letzte Wächter vor dem Gipfel. Wer an ihm vorbei will, braucht gute Gründe oder gute Schuhe.", 950000],
  [65, "Eklipseul", "dark", 180, 2, 24, "Finsternisschwinge", 130, "", "Breitet es die Flügel aus, wird es Nacht. Zieht es sie ein, hat keiner etwas gesehen.", 1450000],
  [66, "Granatox", "fire", 200, 2, 30, "Granatglut", 140, "", "In seinem Kamm brodelt das Feuer des Berges. Sein Brüllen lässt Stalaktiten regnen.", 780000],
  [67, "Lawinor", "dragon", 210, 2, 42, "Lawinensturz", 160, "Wirf eine Münze. Bei Zahl greift dieses Nexamon im nächsten Zug nicht an.", "Schläft unter der Schneedecke. Wer zu laut jodelt, weckt ihn auf.", 2900000],
  [68, "Kometross", "psychic", 170, 0, null, "Kometenritt", 120, "", "Galoppiert einmal im Jahr über den Nachthimmel. Wünsche nimmt es im Vorbeiflug entgegen.", 5800000],
  [69, "Platinar", "steel", 200, 0, null, "Kristallklinge", 140, "", "Ein Ritter aus Platin, geschmiedet für einen König, den längst jeder vergessen hat.", 1200000],
  [70, "Smaragdra", "grass", 190, 0, null, "Dreifachbiss", 50, "Wirf 3 Münzen. Der Angriff fügt 50 Schaden pro Kopf zu.", "Drei Köpfe, drei Meinungen. Einig sind sie sich nur beim Mittagessen.", 560000],
  // prisma
  [71, "Prismagon", "dragon", 250, 2, 4, "Prismenodem", 180, "", "Bricht das Sonnenlicht über dem Gipfel in tausend Farben. Die Täler nennen es Morgen.", 56000000],
  [72, "Cumulowal", "water", 260, 2, 12, "Wolkenmeerwoge", 170, "", "Taucht bei Sonnenaufgang aus dem Wolkenmeer. Ganze Wetterfronten folgen seinem Lied.", 29000000],
  [73, "Novastra", "psychic", 230, 2, 16, "Supernova", 200, "Lege alle Energien von diesem Nexamon ab.", "Wo sie tanzt, wird ein neuer Stern geboren. Astronomen kommen mit dem Zählen nicht hinterher.", 41000000],
  [74, "Äonentuga", "water", 280, 0, null, "Zeitenwoge", 160, "Heile 30 Schaden bei diesem Nexamon.", "Trägt seit Äonen einen Tempel durch das Wolkenmeer. Niemand weiß, wer ihn gebaut hat.", 18500000],
  [75, "Brillantitan", "rock", 270, 2, 2, "Karatbeben", 190, "", "Das Herz des Berges, aus Fels und Rosenquarz. Mit jedem Schritt wachsen neue Kristalle.", 14000000],
  // legendary
  [76, "Spektradon", "dragon", 320, 0, null, "Gipfelspektrum", 250, "Lege 2 Energien von diesem Nexamon ab.", "Der Himmelsdrache des Prismengipfels. Er hütet das Prisma, aus dem alles Licht der Welt fällt.", 435000000],
  [77, "Aurelyx", "fire", 300, 0, null, "Goldene Morgenröte", 230, "Heile 50 Schaden bei diesem Nexamon.", "Steigt mit dem ersten Sonnenstrahl über den Gipfel. Sein Gefieder ist reines Morgenlicht.", 360000000],
];

/** Catalogue of the set (77 cards). */
export const PRISMATIC_PEAK_CARDS: readonly NexamonCard[] = ROWS.map(
  ([number, name, type, hp, stage, from, attack, damage, text, flavor, startPriceCents]) => ({
    key: key(number),
    set: "prismatic_peak",
    number,
    rarity: rarity(number),
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

/** Artwork per card key. */
export const PRISMATIC_PEAK_ART: Readonly<Record<string, NexamonArt>> = {
  ...PP_ART_COMMONS_1,
  ...PP_ART_COMMONS_2,
  ...PP_ART_COMMONS_3,
  ...PP_ART_COMMONS_4,
  ...PP_ART_COMMONS_5,
  ...PP_ART_RARES,
  ...PP_ART_ULTRAS,
  ...PP_ART_PRISMAS_1,
  ...PP_ART_PRISMAS_2,
  ...PP_ART_LEGENDARIES,
};
