import { SA_ART_COMMONS_A } from "./art-super-apex/commons-a";
import { SA_ART_COMMONS_B } from "./art-super-apex/commons-b";
import { SA_ART_COMMONS_C } from "./art-super-apex/commons-c";
import { SA_ART_RARES } from "./art-super-apex/rares";
import { SA_ART_ULTRAS } from "./art-super-apex/ultras";
import { SA_ART_PRISMAS } from "./art-super-apex/prismas";
import { SA_ART_LEGENDARIES } from "./art-super-apex/legendaries";
import type { NexamonArt, NexamonCard, NexamonRarity, NexamonType } from "./types";

/*
 * Nexamon: Super Apex. Power and predators: volcano beasts, storm raptors, steel brutes, leviathans and arena
 * champions, ruled by the magma titan Vulkazar and the storm sovereign Tempestra. Prices are euros x 100.
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

const key = (n: number) => `sa-${String(n).padStart(3, "0")}`;
const rarityOf = (n: number): NexamonRarity =>
  n <= 50 ? "common" : n <= 60 ? "rare" : n <= 70 ? "ultra" : n <= 75 ? "prisma" : "legendary";

// prettier-ignore
const ROWS: readonly Row[] = [
  [1, "Glutz", "fire", 60, 0, null, "Funkenspucker", 10, "", "Schläft am liebsten auf Herdplatten. Die Stromrechnung zahlt jemand anderes.", 600],
  [2, "Magmolch", "fire", 90, 1, 1, "Lavaschweif", 40, "", "Seine Risse glühen heller, je schlechter seine Laune ist. Sie ist meistens schlecht.", 1400],
  [3, "Glimmtatz", "fire", 60, 0, null, "Heiße Pfote", 20, "", "Hinterlässt verkohlte Tatzenabdrücke auf jedem Teppich. Bereut nichts.", 2800],
  [4, "Flammtiger", "fire", 90, 1, 3, "Brandsprung", 50, "", "Jagt in der Abenddämmerung, wenn seine Mähne mit dem Himmel verschmilzt.", 4200],
  [5, "Zwirbel", "electric", 50, 0, null, "Knisterpiep", 10, "", "Sein Federkamm steht bei Gewitter senkrecht. Bei Sonnenschein auch.", 500],
  [6, "Böenfalk", "electric", 80, 1, 5, "Sturzflug", 40, "Wirf eine Münze. Bei Kopf +20 Schaden.", "Reitet Fallwinde, die andere Vögel vom Himmel fegen.", 1600],
  [7, "Nietling", "steel", 70, 0, null, "Kopfnuss", 20, "", "Jede Niete hat es sich selbst verdient. Glaubt es zumindest.", 800],
  [8, "Panzork", "steel", 100, 1, 7, "Rammbock", 50, "", "Bremst nicht für Wände. Wände bremsen neuerdings für ihn.", 2200],
  [9, "Abyssel", "water", 60, 0, null, "Blubberbiss", 10, "", "Wirkt harmlos. In 200 Metern Tiefe wirkt alles harmlos, bis es zuschnappt.", 900],
  [10, "Schlundra", "water", 90, 1, 9, "Strudelschlag", 40, "", "Fischer erzählen von einem Schatten, der ihre Netze samt Boje verschluckt.", 2000],
  [11, "Stichel", "rock", 50, 0, null, "Piekser", 10, "", "Probiert seinen Stachel an allem aus. Auch an Kakteen. Unentschieden.", 500],
  [12, "Skorpax", "rock", 80, 1, 11, "Giftzange", 30, "Das gegnerische Nexamon ist jetzt vergiftet.", "Wartet reglos unter dem Sand, bis der Wüstenboden zu zittern beginnt.", 1200],
  [13, "Funkitz", "electric", 50, 0, null, "Kratzfunke", 10, "", "Streicheln auf eigene Gefahr: 3000 Volt und sehr kitzlig.", 1100],
  [14, "Blitzluchs", "electric", 80, 1, 13, "Voltkralle", 40, "", "Man hört erst den Donner, dann nichts mehr. Er war schon da.", 3200],
  [15, "Fäustel", "rock", 60, 0, null, "Jab", 20, "", "Die Handschuhe sind drei Nummern zu groß. Der Ehrgeiz auch.", 700],
  [16, "Hakenschlag", "rock", 90, 1, 15, "Leberhaken", 50, "", "Trainiert an Felswänden. Die Felswände verlieren regelmäßig.", 1800],
  [17, "Flossel", "water", 50, 0, null, "Knabbern", 10, "", "Übt das Zähnefletschen vor Muscheln. Die Muscheln sind unbeeindruckt.", 600],
  [18, "Haifang", "water", 90, 1, 17, "Blutspur", 50, "", "Riecht einen Tropfen Angst auf drei Seemeilen.", 2400],
  [19, "Knurrling", "dark", 50, 0, null, "Wadenbiss", 10, "", "Knurrt den Mond an. Der Mond hat bisher nicht geantwortet.", 800],
  [20, "Nachtfang", "dark", 80, 1, 19, "Schattenbiss", 40, "", "Seine Augen sind das Letzte, was man im Unterholz sieht.", 2600],
  [21, "Schuppling", "dragon", 60, 0, null, "Glutrülpser", 20, "", "Hustet Rauchringe und ist danach sehr stolz auf sich.", 3000],
  [22, "Drakwyrm", "dragon", 90, 1, 21, "Schwingenhieb", 50, "", "Kreist über Vulkanschloten und wärmt sich die Flügel im Aufwind.", 4500],
  [23, "Schnappel", "grass", 50, 0, null, "Zuschnappen", 10, "", "Wird als Zimmerpflanze verkauft. Die Fliegen im Haus verschwinden. Die Socken auch.", 500],
  [24, "Würgranke", "grass", 80, 1, 23, "Dornenpeitsche", 30, "", "Wächst einen Meter pro Tag, wenn sie Hunger hat. Sie hat immer Hunger.", 1300],
  [25, "Rammkalb", "rock", 60, 0, null, "Anlauf", 20, "", "Rennt gegen alles, was rot ist. Und gegen alles, was nicht rot ist.", 2600],
  [26, "Bullrun", "rock", 100, 1, 25, "Kursrakete", 60, "", "Wenn er losstürmt, kennen die Kurse nur noch eine Richtung: nach oben.", 4800],
  [27, "Baissel", "dark", 60, 0, null, "Tatzenhieb", 20, "", "Sieht kuschelig aus. Dein Depot sieht das nach seinem Besuch anders.", 2200],
  [28, "Brummbaisse", "dark", 100, 1, 27, "Abwärtsschlag", 50, "", "Sein Brüllen lässt Kurse fallen und Anleger nach Hause gehen.", 3800],
  [29, "Zischel", "grass", 50, 0, null, "Giftzahn", 10, "", "Zischt bei jeder Gelegenheit. Meint es selten böse. Manchmal aber schon.", 500],
  [30, "Kobrax", "grass", 80, 1, 29, "Nackenschild", 30, "Im nächsten Zug erleidet es 20 Schaden weniger.", "Spreizt den Schild und starrt. Wer zuerst blinzelt, verliert.", 1100],
  [31, "Zwickel", "steel", 50, 0, null, "Kneifer", 10, "", "Winkt freundlich mit der großen Schere. Es ist keine Begrüßung.", 500],
  [32, "Kraborg", "steel", 90, 1, 31, "Stahlschere", 40, "", "Knackt Schiffsrümpfe wie andere Leute Nüsse.", 1500],
  [33, "Geierling", "dark", 50, 0, null, "Aufpicken", 10, "", "Wartet geduldig. Sehr geduldig. Unangenehm geduldig.", 500],
  [34, "Aaskralle", "dark", 80, 1, 33, "Kreisender Schatten", 40, "", "Kreist über fallenden Kursen und kauft, wenn alle anderen rennen.", 1700],
  [35, "Webbel", "dark", 40, 0, null, "Klebfaden", 10, "", "Spinnt Netze in Türrahmen und wartet auf Besuch. Irgendeinen Besuch.", 500],
  [36, "Arachnox", "dark", 80, 1, 35, "Lähmbiss", 30, "Das gegnerische Nexamon ist jetzt gelähmt.", "Acht Beine, acht Augen, null Geduld.", 1400],
  [37, "Krokel", "water", 60, 0, null, "Schnapper", 20, "", "Tarnt sich als Treibholz. Treibholz mit sehr vielen Zähnen.", 700],
  [38, "Sumpfmaul", "water", 100, 1, 37, "Todesrolle", 50, "", "Liegt tagelang still im Schlamm. Dann drei Sekunden lang nicht.", 2100],
  [39, "Sichelino", "grass", 50, 0, null, "Schnippschnapp", 10, "", "Übt Schwerthiebe an Grashalmen. Der Rasen war noch nie so kurz.", 600],
  [40, "Mantigor", "grass", 80, 1, 39, "Sichelhieb", 40, "", "Steht stundenlang wie eine Statue. Der Hieb selbst dauert einen Wimpernschlag.", 1900],
  [41, "Flatsch", "dark", 40, 0, null, "Ultraschall", 10, "", "Hängt kopfüber und findet, dass alle anderen falsch herum stehen.", 500],
  [42, "Vampyrus", "dark", 70, 1, 41, "Aderlass", 30, "Heile 10 Schaden bei diesem Nexamon.", "Saugt am liebsten an überbewerteten Aktien.", 1200],
  [43, "Zitterling", "electric", 40, 0, null, "Stromstoß", 10, "", "Lädt sich im Schlaf auf. Wer es weckt, wird selbst hellwach.", 500],
  [44, "Voltaal", "electric", 80, 1, 43, "Kurzschluss", 40, "", "Grinst immer. Niemand weiß warum, und alle haben Angst nachzufragen.", 1300],
  [45, "Brocki", "rock", 70, 0, null, "Steinwurf", 20, "", "Ist vom Berg gerollt und hat beschlossen, dass das Absicht war.", 600],
  [46, "Geröllo", "rock", 100, 1, 45, "Felsfaust", 50, "", "In seiner Brust glüht ein Stück vom Herzen des Vulkans.", 1800],
  [47, "Starrling", "psychic", 50, 0, null, "Starrblick", 10, "Das gegnerische Nexamon ist jetzt verwirrt.", "Wer ihm zu lange in die Augen schaut, vergisst seine PIN.", 900],
  [48, "Mentuhu", "psychic", 80, 1, 47, "Gedankenkralle", 40, "", "Liest Gedanken im Vorbeiflug. Meistens ist es enttäuscht.", 2300],
  [49, "Summsel", "fairy", 40, 0, null, "Stachelkuss", 10, "", "Bestäubt Blumen und sticht Finger. Beides mit großer Hingabe.", 700],
  [50, "Dornfee", "fairy", 70, 1, 49, "Lanzenstich", 30, "", "Verteidigt ihren Blütenhof mit einer Lanze aus Morgentau und schlechter Laune.", 2000],
  [51, "Vulkrag", "fire", 140, 2, 2, "Schlotausbruch", 90, "Lege 1 Energie von diesem Nexamon ab.", "Trägt drei Vulkane auf dem Rücken. Einer davon bricht immer gerade aus.", 22000],
  [52, "Dornkaiser", "rock", 130, 2, 12, "Kaiserstich", 80, "Das gegnerische Nexamon ist jetzt vergiftet.", "Herrscht über die Dünen. Seine Krone ist echt, sein Gift auch.", 9500],
  [53, "Megalodorn", "water", 140, 2, 18, "Urzeitbiss", 100, "", "Ein Relikt aus der Tiefe. Hat die Dinosaurier überlebt und findet dich niedlich.", 34000],
  [54, "Dschungor", "grass", 130, 2, 24, "Dreifachbiss", 30, "Wirf 3 Münzen. Je Kopf 30 Schaden.", "Drei Köpfe, ein Magen. Die Köpfe streiten trotzdem ums Essen.", 6000],
  [55, "Krachbär", "dark", 140, 2, 28, "Börsencrash", 100, "", "Wo er hintritt, wächst kein Kurs mehr. Analysten nennen ihn nur »den Montag«.", 39000],
  [56, "Hypnatter", "grass", 120, 2, 30, "Hypnoseblick", 60, "Das gegnerische Nexamon schläft jetzt.", "Ihr Schild zeigt ein Auge, das niemals blinzelt.", 7500],
  [57, "Panzerschere", "steel", 130, 2, 32, "Schraubstock", 70, "", "Ihre große Schere hat schon Ankerketten durchtrennt. Aus Langeweile.", 4800],
  [58, "Klingenprinz", "grass", 120, 2, 40, "Kreuzschnitt", 80, "", "Zwei Klingen, ein Hieb. Das Blatt fällt erst, wenn er längst weiter ist.", 13000],
  [59, "Megavoltaal", "electric", 130, 2, 44, "Hochspannung", 90, "Wirf eine Münze. Bei Zahl 20 Schaden an sich selbst.", "Ein einziger Schlag versorgt eine Hafenstadt mit Strom. Kurz.", 11000],
  [60, "Obsidion", "rock", 150, 2, 46, "Splitterfaust", 90, "", "Schwarzes Glas, geboren im Feuer. Wer es schlägt, schneidet sich.", 18000],
  [61, "Orkanyx", "electric", 150, 2, 6, "Gewitterschwinge", 120, "Lege 1 Energie von diesem Nexamon ab.", "Wo sein Schatten fällt, schlägt eine Sekunde später der Blitz ein.", 560000],
  [62, "Donnerpard", "electric", 150, 2, 14, "Gigavoltsprung", 130, "", "Schneller als der eigene Donner. Die Savanne riecht noch Stunden nach Ozon.", 740000],
  [63, "Arenator", "rock", 170, 2, 16, "K.-o.-Meteor", 140, "", "Ungeschlagen in 99 Kämpfen. Der hundertste Gegner hat abgesagt.", 390000],
  [64, "Finsterwolf", "dark", 150, 2, 20, "Mondfinsternis", 120, "", "Wenn er heult, verstummt der Wald. Wenn er schweigt, solltest du rennen.", 980000],
  [65, "Haussier", "rock", 170, 2, 26, "Allzeithoch", 150, "", "Er senkt die Hörner, und die Kurse steigen. Die Börse läutet ihre Glocke nur für ihn.", 1220000],
  [66, "Aasfürst", "dark", 140, 2, 34, "Letzte Mahlzeit", 110, "", "Thront über dem Schlachtfeld der Märkte. Am Ende gehört alles ihm.", 88000],
  [67, "Netzfürstin", "dark", 140, 2, 36, "Seidenkerker", 100, "Das gegnerische Nexamon kann sich nicht zurückziehen.", "Ihr Netz spannt sich über die ganze Höhle. Jeder Faden meldet ihr deinen Herzschlag.", 125000],
  [68, "Kaimperator", "water", 180, 2, 38, "Imperiumsbiss", 140, "", "Seit hundert Jahren Kaiser des Sumpfes. Die Krone hat er einem König abgenommen.", 290000],
  [69, "Nachtgraf", "dark", 130, 2, 42, "Blutmond", 100, "Heile 30 Schaden bei diesem Nexamon.", "Lädt um Mitternacht zum Ball. Die Gästeliste ist lang, die Rückkehrerliste leer.", 220000],
  [70, "Hypnarch", "psychic", 140, 2, 48, "Traumzepter", 110, "Das gegnerische Nexamon schläft jetzt.", "Ein Blick, und du verkaufst alles. Zwei Blicke, und du weißt nicht mehr, was Geld ist.", 165000],
  [71, "Solartiger", "fire", 180, 2, 4, "Sonnenbrand", 160, "Lege 2 Energien von diesem Nexamon ab.", "Mittags wirft er keinen Schatten: Er ist die Sonne, die über die Steppe jagt.", 9800000],
  [72, "Stahlkoloss", "steel", 200, 2, 8, "Hochofenramme", 150, "", "Geschmiedet, nicht geboren. Unter jedem Schritt biegen sich die Schienen.", 4100000],
  [73, "Leviagor", "water", 190, 2, 10, "Sintflut", 160, "", "Alte Seekarten zeigen an dieser Stelle nur ein Wort: Umkehren.", 6400000],
  [74, "Infernodrak", "dragon", 200, 2, 22, "Weltenbrand", 180, "Lege 2 Energien von diesem Nexamon ab.", "Sein Atem schmilzt Berge. Sein Hort besteht nur aus Aktien, die nie gefallen sind.", 12200000],
  [75, "Stachelkönigin", "fairy", 160, 2, 50, "Hofstaat", 120, "Heile 30 Schaden bei jedem deiner Nexamon.", "Tausend Flügel schlagen für sie. Ihr Honig ist golden, ihr Urteil endgültig.", 2750000],
  [76, "Vulkazar", "fire", 250, 0, null, "Kernschmelze", 220, "Lege alle Energien von diesem Nexamon ab.", "Der Magmatitan. Wenn er erwacht, zeichnet er die Landkarten neu.", 78000000],
  [77, "Tempestra", "electric", 240, 0, null, "Jüngster Donner", 200, "Füge jedem Nexamon auf der gegnerischen Bank 30 Schaden zu.", "Die Sturmherrscherin. Ihr Flügelschlag ist das Gewitter, vor dem selbst Vulkazar sich duckt.", 89000000],
];

/** Catalogue of the set (77 cards). */
export const SUPER_APEX_CARDS: readonly NexamonCard[] = ROWS.map(
  ([number, name, type, hp, stage, evolvesFrom, attack, damage, text, flavor, startPriceCents]) => ({
    key: key(number),
    set: "super_apex",
    number,
    rarity: rarityOf(number),
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

/** Artwork per card key. */
export const SUPER_APEX_ART: Readonly<Record<string, NexamonArt>> = {
  ...SA_ART_COMMONS_A,
  ...SA_ART_COMMONS_B,
  ...SA_ART_COMMONS_C,
  ...SA_ART_RARES,
  ...SA_ART_ULTRAS,
  ...SA_ART_PRISMAS,
  ...SA_ART_LEGENDARIES,
};
