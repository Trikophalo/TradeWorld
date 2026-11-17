import { CW_ART_COMMONS_1 } from "./art-cosmic-winds/commons-1";
import { CW_ART_COMMONS_2 } from "./art-cosmic-winds/commons-2";
import { CW_ART_COMMONS_3 } from "./art-cosmic-winds/commons-3";
import { CW_ART_COMMONS_4 } from "./art-cosmic-winds/commons-4";
import { CW_ART_COMMONS_5 } from "./art-cosmic-winds/commons-5";
import type { CosmicCardDraft, CosmicType } from "./cosmic-draft";
import type { NexamonArt } from "./types";

/*
 * "Nexamon: Cosmic Winds", commons cw-001 to cw-050.
 *
 * Fixed evolution lines whose final forms live in other parts (visual description for those parts):
 * - cw-001 Funkelfuchs -> cw-002 Nebelfunk -> rare cw-051: a fox of violet-magenta nebula fur, big pointed ears,
 *   a fluffy tail that fades into stardust with tiny white stars inside it, gold eyes, a small gold star on the brow.
 * - cw-010 Kometschwinge -> cw-011 Kometfalke -> ultra cw-066: a slim ice-blue bird with a white-hot head and
 *   swept-back wings, trailing a long cyan-to-violet comet tail of feathers and sparks behind it.
 * - cw-020 Astrogolem -> cw-021 Meteorgolem -> ultra cw-070: a grey-brown cratered asteroid body with stubby rock
 *   arms, glowing orange magma cracks and one round orange eye; bigger stages grow more boulders and a small moon.
 * - cw-030 Sternwal -> cw-031 Galaxwal -> prisma cw-081: a deep-blue whale with a pale belly, its back speckled
 *   with constellations (white star dots joined by faint lines), a gold star-spout from its blowhole;
 *   cw-031 adds a small violet spiral galaxy on its flank.
 * - cw-040 Polarschlange -> cw-041 Aurorawinde -> prisma cw-083: a long S-curved serpent of aurora green
 *   fading to teal and violet, a translucent ribbon fin along its back, white-green glowing eyes.
 */

type Row = [
  number: number,
  name: string,
  type: CosmicType,
  kind: "monster" | "event",
  hp: number,
  stage: 0 | 1 | 2,
  evolvesFrom: string | null,
  attack: string,
  damage: number,
  text: string,
  flavor: string,
  startPriceCents: number,
];

// prettier-ignore
const ROWS: readonly Row[] = [
  [1, "Funkelfuchs", "psychic", "monster", 50, 0, null, "Sternenstupser", 10, "", "Schläft am liebsten in kleinen Nebeln. Wo es gähnt, entsteht ein neuer Stern.", 9750],
  [2, "Nebelfunk", "psychic", "monster", 80, 1, "cw-001", "Nebelsprung", 40, "Wirf eine Münze. Bei Kopf ist der Gegner verwirrt.", "Sein Schweif zieht Sternenstaub hinter sich her wie eine lange, glitzernde Schleppe.", 16500],
  [3, "Mondmotti", "fairy", "monster", 40, 0, null, "Silberstaub", 10, "", "Fliegt nur bei Vollmond. In den anderen Nächten wartet es geduldig hinter Kratern.", 3000],
  [4, "Lunamotte", "fairy", "monster", 70, 1, "cw-003", "Mondschleier", 30, "Der nächste Angriff auf dieses Nexamon macht 20 Schaden weniger.", "Ihre Flügel zeigen alle Mondphasen auf einmal. Astronomen sind leicht beleidigt.", 5250],
  [5, "Selenafalter", "fairy", "monster", 110, 2, "cw-004", "Vollmondglanz", 70, "Heile 20 Schaden bei diesem Nexamon.", "Wenn es die Flügel öffnet, wird die Nacht für einen Herzschlag silbern.", 14250],
  [6, "Sternschnuppe", "cosmic", "event", 0, 0, null, "Wunschfunke", 0, "Ziehe 2 Karten. Wer sich etwas wünscht, darf eine davon zurücklegen.", "Schnell etwas wünschen! Steigende Kurse zählen auch.", 4500],
  [7, "Pulsirr", "electric", "monster", 40, 0, null, "Taktblitz", 10, "", "Blinkt genau 716-mal pro Sekunde. Man kann seine Uhr danach stellen.", 3750],
  [8, "Pulsorn", "electric", "monster", 80, 1, "cw-007", "Pulsarstrahl", 50, "Wirf eine Münze. Bei Zahl macht der Angriff keinen Schaden.", "Sein Horn sendet Signale ins All. Bisher hat nur ein Kühlschrank geantwortet.", 7500],
  [9, "Sternenstaub", "cosmic", "event", 0, 0, null, "Glitzerwolke", 0, "Alle eigenen Fee-Nexamon erhalten 20 KP zurück.", "Kitzelt in der Nase und glänzt noch Wochen später auf dem Teppich.", 2250],
  [10, "Kometschwinge", "water", "monster", 50, 0, null, "Eisschweif", 20, "", "Kommt alle 76 Tage zurück ins Nest. Pünktlicher als jede Dividende.", 11250],
  [11, "Kometfalke", "water", "monster", 90, 1, "cw-010", "Schweifsturz", 50, "", "Stürzt mit Funkenschweif durch die Ringe der Gasriesen. Bremsen hat es nie gelernt.", 18750],
  [12, "Keimstern", "grass", "monster", 40, 0, null, "Sporenschuss", 10, "", "Ein Samenkorn, das mit einem Meteoriten anreiste. Gießen mit Mondwasser empfohlen.", 2700],
  [13, "Sporastra", "grass", "monster", 70, 1, "cw-012", "Leuchtsporen", 30, "Der Gegner ist jetzt vergiftet.", "Ihre Blüten leuchten in Farben, für die es auf der Erde noch keinen Namen gibt.", 4800],
  [14, "Florastra", "grass", "monster", 120, 2, "cw-013", "Galaxienblüte", 80, "", "Eine Blüte so groß wie ein Mond. Bienen von drei Planeten streiten um sie.", 12750],
  [15, "Kleiner Komet", "cosmic", "event", 0, 0, null, "Eisiger Vorbeiflug", 0, "Alle Wasser-Nexamon im Spiel erhalten 20 KP zurück.", "Zu klein für die Nachrichten, groß genug für eine Gänsehaut.", 3750],
  [16, "Solwicht", "fire", "monster", 50, 0, null, "Sonnenfunke", 20, "", "Reitet auf dem Sonnenwind von Planet zu Planet. Gepäck: keins.", 3300],
  [17, "Solarion", "fire", "monster", 90, 1, "cw-016", "Sonnenwind", 50, "Wirf eine Münze. Bei Kopf ist der Gegner verbrannt.", "Wo es vorbeiweht, flackern auf allen Planeten die Polarlichter.", 6750],
  [18, "Sichelmond", "cosmic", "event", 0, 0, null, "Mondphase", 0, "Bis zu deinem nächsten Zug erhalten alle Dunkel-Nexamon 10 KP zurück.", "Halb da, halb weg. Wie die Rendite mancher Anlagen.", 2400],
  [19, "Krateri", "rock", "monster", 50, 0, null, "Staubwurf", 10, "", "Hüpft von Krater zu Krater. Die Mondoberfläche hat es fast komplett durchnummeriert.", 2250],
  [20, "Astrogolem", "rock", "monster", 70, 0, null, "Brockenhieb", 20, "", "Ein Asteroid, der eines Tages die Augen öffnete. Er findet die Schwerkraft überbewertet.", 10500],
  [21, "Meteorgolem", "rock", "monster", 110, 1, "cw-020", "Glutbrocken", 60, "", "In seinen Rissen glüht Magma. Wer ihn umarmt, braucht feuerfeste Handschuhe.", 17250],
  [22, "Schlundi", "dark", "monster", 50, 0, null, "Sog", 10, "Ziehe dem Gegner eine Energie ab.", "Ein winziges Schwarzes Loch mit großem Appetit. Socken verschwinden in seiner Nähe.", 4200],
  [23, "Schlundor", "dark", "monster", 100, 1, "cw-022", "Ereignishorizont", 60, "", "Nicht einmal Licht entkommt ihm. Mahnungen leider schon.", 9000],
  [24, "Raumboje", "cosmic", "event", 0, 0, null, "Leuchtsignal", 0, "Schau dir die obersten 3 Karten deines Decks an und lege sie in beliebiger Reihenfolge zurück.", "Blinkt seit 300 Jahren den Weg zum nächsten Rastplatz. Niemand hat je angehalten.", 3000],
  [25, "Planetti", "psychic", "monster", 50, 0, null, "Umlaufbahn", 10, "", "Ein Kristallplanet mit Gesicht. Dreht sich einmal am Tag, damit niemand neidisch wird.", 3600],
  [26, "Planetor", "psychic", "monster", 80, 1, "cw-025", "Gezeitenkraft", 40, "", "Hat sich einen kleinen Mond angeschafft. Der umkreist es und erzählt schlechte Witze.", 6000],
  [27, "Ringplanetor", "psychic", "monster", 130, 2, "cw-026", "Ringklinge", 80, "Wirf eine Münze. Bei Kopf macht der Angriff 20 Schaden mehr.", "Seine Ringe sind aus gefrorenem Licht. Sammler bieten Unsummen, es verkauft nicht.", 15000],
  [28, "Funkenregen", "cosmic", "event", 0, 0, null, "Glimmerschauer", 0, "Jedes Nexamon des Gegners erhält 10 Schaden.", "Ein Nieselregen aus winzigen Meteoren. Schirm hilft nicht, Staunen schon.", 5250],
  [29, "Orbitkäfer", "steel", "monster", 60, 0, null, "Antennenstich", 20, "", "Hält sich für einen Satelliten und funkt jeden Morgen den Wetterbericht.", 2850],
  [30, "Sternwal", "water", "monster", 70, 0, null, "Sternfontäne", 20, "", "Singt Lieder, die erst in hundert Jahren auf dem nächsten Planeten ankommen.", 12000],
  [31, "Galaxwal", "water", "monster", 120, 1, "cw-030", "Sternbildflut", 60, "", "Auf seinem Rücken leuchten Sternbilder. Seefahrer im All navigieren nach ihm.", 20250],
  [32, "Quasling", "electric", "monster", 40, 0, null, "Strahlenkitzel", 10, "", "So klein und doch so hell. Seine Mutter trägt eine Sonnenbrille.", 3150],
  [33, "Quasaron", "electric", "monster", 90, 1, "cw-032", "Quasarstrahl", 60, "Dieses Nexamon erhält 10 Schaden.", "Leuchtet heller als tausend Galaxien. Nachts schläft deshalb niemand in der Nachbarschaft.", 8250],
  [34, "Sonnenfleck", "cosmic", "event", 0, 0, null, "Fleckenglut", 0, "Alle Feuer-Nexamon machen bis zu deinem nächsten Zug 10 Schaden mehr.", "Ein kühler Fleck auf der Sonne. Kühl heißt hier: 3.500 Grad.", 2700],
  [35, "Glutzwerg", "fire", "monster", 50, 0, null, "Glutstoß", 20, "", "Ein Stern, der nie richtig gewachsen ist. Dafür brennt er doppelt so lange.", 2550],
  [36, "Glutriese", "fire", "monster", 100, 1, "cw-035", "Rote Riesenglut", 60, "", "Ist mit den Jahren gewaltig aufgebläht. Der Bauch ist reine Sonnenmasse, sagt er.", 7050],
  [37, "Kiesel im All", "cosmic", "event", 0, 0, null, "Treffer!", 0, "Wirf eine Münze. Bei Kopf erhält das aktive Nexamon des Gegners 30 Schaden.", "Klein, hart und mit 30 Kilometern pro Sekunde unterwegs. Bitte ausweichen.", 3450],
  [38, "Nebuli", "dragon", "monster", 50, 0, null, "Nebelhauch", 20, "", "Schlüpfte in einem Sternennebel. Seine Schuppen haben noch den rosa Schimmer.", 6300],
  [39, "Nebulon", "dragon", "monster", 100, 1, "cw-038", "Nebelfeuer", 60, "", "Atmet glühende Gaswolken aus, in denen später neue Sterne entstehen.", 13500],
  [40, "Polarschlange", "dragon", "monster", 60, 0, null, "Lichtband", 20, "", "Schlängelt sich durch den Himmel über den Polen. Wer sie sieht, darf sich ein Grün aussuchen.", 13950],
  [41, "Aurorawinde", "dragon", "monster", 100, 1, "cw-040", "Polarwirbel", 60, "", "Ihr Körper ist aus Licht gewebt. Sie windet sich durch ganze Sonnensysteme.", 22500],
  [42, "Raumstaubwolke", "cosmic", "event", 0, 0, null, "Sichtnebel", 0, "Der nächste Angriff des Gegners trifft nur bei Kopf.", "Ein Hauch aus Staub, der ganze Sterne verschwinden lässt. Bitte nicht niesen.", 2550],
  [43, "Mondhasi", "fairy", "monster", 50, 0, null, "Kraterhops", 10, "", "Springt auf dem Mond sechsmal so hoch. Auf der Erde ist es deshalb oft enttäuscht.", 4050],
  [44, "Kraterhase", "fairy", "monster", 90, 1, "cw-043", "Mondsprung", 50, "", "Seine Sprünge hinterlassen Krater. Die Wissenschaft hat lange etwas anderes vermutet.", 7800],
  [45, "Xenoblüm", "grass", "monster", 60, 0, null, "Rankengriff", 20, "Der Gegner kann im nächsten Zug nicht zurückziehen.", "Wächst auf Kometen und frisst Licht. Mit drei Augen sieht es jede Sonne zuerst.", 3900],
  [46, "Magnetling", "steel", "monster", 50, 0, null, "Anziehung", 10, "", "Zieht alles an, was aus Metall ist. Besonders gern Münzen. Ein geborener Sparer.", 2400],
  [47, "Magnetaur", "steel", "monster", 100, 1, "cw-046", "Feldstoß", 50, "", "Sein Magnetfeld lenkt Sonnenwinde um. Kompasse in der Nähe drehen sich vor Ehrfurcht.", 6450],
  [48, "Mondgestein", "cosmic", "event", 0, 0, null, "Fundstück", 0, "Lege eine Gestein-Karte aus deinem Ablagestapel auf die Hand.", "Ein Stück Mond, ganz ehrlich. Das Echtheitszertifikat ist allerdings handgeschrieben.", 3150],
  [49, "Zwinkerstern", "psychic", "monster", 40, 0, null, "Augenzwinkern", 10, "Der Gegner ist jetzt verwirrt.", "Zwinkert allen zu, die zu lange in den Himmel schauen. Manche halten es für einen Flirt.", 5700],
  [50, "Sternbild", "cosmic", "event", 0, 0, null, "Himmelskarte", 0, "Suche in deinem Deck nach einem Basis-Nexamon und nimm es auf die Hand.", "Verbinde die Punkte und du siehst, was du willst. Charttechnik funktioniert genauso.", 4650],
];

export const COSMIC_WINDS_COMMONS_CARDS: CosmicCardDraft[] = ROWS.map(
  ([number, name, type, kind, hp, stage, evolvesFrom, attack, damage, text, flavor, startPriceCents]) => ({
    key: `cw-${String(number).padStart(3, "0")}`,
    number,
    rarity: "common",
    kind,
    name,
    type,
    hp,
    stage,
    evolvesFrom,
    attack: { name: attack, damage, text },
    flavor,
    startPriceCents,
  }),
);

export const COSMIC_WINDS_COMMONS_ART: Record<string, NexamonArt> = {
  ...CW_ART_COMMONS_1,
  ...CW_ART_COMMONS_2,
  ...CW_ART_COMMONS_3,
  ...CW_ART_COMMONS_4,
  ...CW_ART_COMMONS_5,
};
