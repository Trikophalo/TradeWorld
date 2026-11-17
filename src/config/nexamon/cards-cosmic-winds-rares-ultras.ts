import { CW_ART_RARES_1 } from "./art-cosmic-winds/rares-ultras-1";
import { CW_ART_RARES_2 } from "./art-cosmic-winds/rares-ultras-2";
import { CW_ART_ULTRAS_1 } from "./art-cosmic-winds/rares-ultras-3";
import { CW_ART_ULTRAS_2 } from "./art-cosmic-winds/rares-ultras-4";
import type { CosmicCardDraft, CosmicType } from "./cosmic-draft";
import type { NexamonArt } from "./types";

/*
 * "Nexamon: Cosmic Winds", rares cw-051 to cw-065 and ultra rares cw-066 to cw-080.
 * Final forms of lines started in the commons: cw-051 Galaxfuchs (from cw-002), cw-066 Kometaron (from cw-011),
 * cw-070 Asterokoloss (from cw-021). Event cards: cw-054, cw-057, cw-061, cw-067, cw-071, cw-074.
 */
type Row = [
  number: number,
  kind: "monster" | "event",
  name: string,
  type: CosmicType,
  hp: number,
  stage: 0 | 1 | 2,
  evolvesFrom: number | null,
  attack: string,
  damage: number,
  text: string,
  flavor: string,
  startPriceCents: number,
];

const key = (n: number) => `cw-${String(n).padStart(3, "0")}`;

// prettier-ignore
const ROWS: readonly Row[] = [
  // rare
  [51, "monster", "Galaxfuchs", "psychic", 120, 2, 2, "Sternstaubwirbel", 70, "Wirf eine Münze. Bei Kopf ist der Gegner verwirrt.", "Sein Schweif trägt eine eigene kleine Galaxie. Manche Sterne darin sind erst ein paar Tage alt.", 98_000],
  [52, "monster", "Lunafalter", "fairy", 80, 0, null, "Mondstaub", 30, "Der Gegner kann im nächsten Zug nicht ausweichen.", "Fliegt nur bei Vollmond. Bei Neumond sitzt er beleidigt auf der Rückseite des Mondes.", 24_500],
  [53, "monster", "Blinkrabbel", "electric", 80, 0, null, "Taktblitz", 40, "Wirf zwei Münzen. 20 Schaden mehr für jeden Kopf.", "Blinkt 716-mal pro Sekunde. Astronomen stellen ihre Uhren danach.", 21_000],
  [54, "event", "Meteorschauer", "cosmic", 0, 0, null, "Sternschnuppenregen", 0, "Jeder Nexamon des Gegners erhält 10 Schaden.", "Wünsch dir was. Aber schnell: Es sind ungefähr dreihundert.", 18_500],
  [55, "monster", "Astralia", "grass", 90, 0, null, "Sternenpollen", 30, "Heile 20 KP bei einem deiner Nexamon.", "Blüht nur im Licht fremder Sonnen. Gegossen wird sie mit Kometenwasser.", 17_250],
  [56, "monster", "Nullkralle", "dark", 90, 0, null, "Ereignishorizont", 50, "Der Gegner kann sich im nächsten Zug nicht zurückziehen.", "Was in seinen Napf fällt, kommt nie wieder heraus. Futter, Licht, Taschengeld.", 38_000],
  [57, "event", "Kometenschweif", "cosmic", 0, 0, null, "Eisschweif", 0, "Alle Wasser-Nexamon erhalten 20 KP zurück.", "Zieht einmal pro Menschenleben vorbei und tut jedes Mal so, als wäre nichts gewesen.", 19_750],
  [58, "monster", "Sonnwehe", "fire", 80, 0, null, "Sonnenwind", 40, "Der Gegner muss seinen aktiven Nexamon auf die Bank schicken.", "Weht von der Sonne bis an den Rand des Systems. Bringt gutes Wetter und Sonnenbrand.", 22_500],
  [59, "monster", "Planetino", "rock", 100, 0, null, "Umlaufbahn", 30, "Dieser Nexamon erhält im nächsten Zug 20 Schaden weniger.", "Ein Planet im Taschenformat. Sein Mond folgt ihm überallhin, wie ein treuer Kleinanleger.", 26_000],
  [60, "monster", "Kraterzange", "steel", 100, 0, null, "Kraterkneifer", 50, "", "Trägt einen ausrangierten Mond als Panzer. Die Krater stammen aus wilden Jugendjahren.", 16_750],
  [61, "event", "Sonneneruption", "cosmic", 0, 0, null, "Protuberanz", 0, "Alle Feuer-Nexamon richten in diesem Zug 30 Schaden mehr an.", "Die Sonne hat schlechte Laune. Funkverkehr und Kurse fallen gleichermaßen aus.", 31_000],
  [62, "monster", "Orbiteule", "steel", 90, 0, null, "Signalruf", 30, "Sieh dir die obersten drei Karten deines Decks an.", "Kreist seit Jahrzehnten um die Welt und weiß über alle Bescheid. Sagt aber nur „Huhu“.", 20_500],
  [63, "monster", "Frostkomet", "water", 90, 0, null, "Eisschweifhieb", 50, "", "Rodelt auf seinem eigenen Schweif durchs All. Hinterher muss er sich immer erst wieder zusammenfrieren.", 18_000],
  [64, "monster", "Nebelkrake", "psychic", 100, 0, null, "Nebelgriff", 40, "Der Gegner ist gelähmt.", "Besteht zu 99 Prozent aus Gas. Das restliche Prozent ist Neugier.", 29_500],
  [65, "monster", "Novadrache", "dragon", 110, 0, null, "Sternfunke", 60, "Lege eine Energie dieses Nexamon ab.", "Schlüpft aus einem Stern, der gerade erst gezündet hat. Zahnt mit Sonnenflecken.", 145_000],
  // ultra
  [66, "monster", "Kometaron", "water", 160, 2, 11, "Kometensturz", 120, "Wirf eine Münze. Bei Zahl erhält dieser Nexamon 30 Schaden.", "Zieht einen Schweif aus Federn und Funken hinter sich her, der drei Nächte lang leuchtet.", 1_450_000],
  [67, "event", "Ringriese", "cosmic", 0, 0, null, "Gezeitenringe", 0, "Jeder Spieler mischt seine Hand ins Deck und zieht 5 Karten.", "So groß, dass er eigene Wetterberichte hat. Der rote Fleck ist ein Sturm, kein Fleck.", 540_000],
  [68, "monster", "Pulsarion", "electric", 140, 0, null, "Pulsarklinge", 100, "Wirf eine Münze. Bei Kopf ist der Gegner gelähmt.", "Seine Sensen schlagen im Takt eines toten Sterns. Präziser als jede Atomuhr.", 820_000],
  [69, "monster", "Vortexa", "dark", 160, 0, null, "Schwarzer Schlund", 130, "Lege die oberste Karte vom Deck des Gegners ab.", "Frisst Licht, Planeten und Renditen. Was sie schluckt, steht in keiner Bilanz mehr.", 2_400_000],
  [70, "monster", "Asterokoloss", "rock", 190, 2, 21, "Einschlag", 150, "Dieser Nexamon erhält 30 Schaden.", "Ein ganzer Asteroidengürtel, der beschlossen hat zu laufen. Sein Mond kreist mit.", 1_900_000],
  [71, "event", "Rosennebel", "cosmic", 0, 0, null, "Sternenwiege", 0, "Suche in deinem Deck nach einem Basis-Nexamon und lege ihn auf deine Bank.", "Hier werden Sterne geboren. Die Wehen dauern ungefähr eine Million Jahre.", 610_000],
  [72, "monster", "Koronalöwe", "fire", 160, 0, null, "Koronabrüller", 130, "Lege zwei Energien dieses Nexamon ab.", "Seine Mähne ist eine Million Grad heiß. Kämmen ist keine Option.", 1_150_000],
  [73, "monster", "Nachtmira", "fairy", 140, 0, null, "Mondsichelstaub", 90, "Der Gegner schläft ein.", "Öffnet sie die Flügel, wird es auf der Nachtseite der Welt eine Spur heller.", 690_000],
  [74, "event", "Stationsruine", "cosmic", 0, 0, null, "Notsignal", 0, "Ziehe 3 Karten. Alle Stahl-Nexamon erhalten 30 KP zurück.", "Die letzte Crew hinterließ einen Zettel: „Bin gleich zurück.“ Das war vor 300 Jahren.", 445_000],
  [75, "monster", "Galaqualle", "water", 130, 0, null, "Spiralnessel", 80, "Der Gegner ist vergiftet.", "In ihrem Schirm dreht sich eine ganze Galaxie. Bitte nicht anstupsen.", 760_000],
  [76, "monster", "Orbitar", "steel", 170, 0, null, "Orbitlanze", 120, "Dieser Nexamon erhält im nächsten Zug 30 Schaden weniger.", "Ein Ritter, der nie landet. Seine Ringe sind Umlaufbahnen, die er selbst zieht.", 980_000],
  [77, "monster", "Kristallon", "psychic", 150, 0, null, "Prismenpuls", 100, "", "Ein kleiner Planet aus Amethyst, der lächelt. Geologen nennen ihn unwissenschaftlich niedlich.", 520_000],
  [78, "monster", "Aeolux", "cosmic", 150, 0, null, "Sonnenwindböe", 110, "Der Gegner muss seinen aktiven Nexamon auf die Bank schicken.", "Reitet auf dem Sonnenwind bis an den Rand des Systems und winkt den Raumsonden zu.", 1_300_000],
  [79, "monster", "Novagon", "dragon", 200, 0, null, "Supernova", 180, "Lege alle Energien dieses Nexamon ab.", "Als sein Stern explodierte, flog es einfach mit. Seitdem leuchtet es heller als seine Heimat.", 5_200_000],
  [80, "monster", "Quasarhirsch", "cosmic", 180, 0, null, "Quasarstrahl", 150, "", "Seine Geweihspitzen leuchten heller als tausend Galaxien. Jäger geben einfach auf.", 3_600_000],
];

export const COSMIC_WINDS_RARES_ULTRAS_CARDS: CosmicCardDraft[] = ROWS.map(
  ([number, kind, name, type, hp, stage, from, attack, damage, text, flavor, startPriceCents]) => ({
    key: key(number),
    number,
    rarity: number <= 65 ? "rare" : "ultra",
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

export const COSMIC_WINDS_RARES_ULTRAS_ART: Record<string, NexamonArt> = {
  ...CW_ART_RARES_1,
  ...CW_ART_RARES_2,
  ...CW_ART_ULTRAS_1,
  ...CW_ART_ULTRAS_2,
};
