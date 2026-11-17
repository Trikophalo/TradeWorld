/*
 * Running gags of NEXA Nachrichten (ADR-179): stories that come back show after show as long as a player company
 * with a matching name exists. The server finds the company (`namePattern`, SQL ILIKE: % is any text), counts the
 * aired episodes per company (a new company with the name starts at 1 again) and picks a host line that did not
 * run last time; the made-up chat viewers react during and right after the segment.
 *
 * Gag "vulcan": the player company "Vulcan Energy" announces again and again that drilling starts soon, and never
 * starts. It is about the in-game company of a player only: every segment opens with "die Spielerfirma … von
 * {founder}", no real places, people, permits or finances (a real company with a similar name exists).
 *
 * Placeholders: {company} name of the player company, {founder} its founder, {days} days since its founding
 * ("Tag {days} ohne Bohrung"), {episode} aired gag segments of this company including this one, {when} one of
 * `whens`. Lines are ordered by absurdity: episode e may use the first escalateStart + e × escalatePerEpisode.
 */

type Mood = "neutral" | "shocked" | "crying" | "laughing" | "angry" | "smug" | "confused" | "proud";

export interface RunningGagLine {
  readonly text: string;
  readonly mood: Mood;
}

export interface RunningGagConfig {
  readonly enabled: boolean;
  /** SQL ILIKE pattern on the company name (active player companies only). */
  readonly namePattern: string;
  /** Chance per show that the gag runs while the company exists. */
  readonly chanceBps: number;
  /** Place in the running order (see newsShow.topics). */
  readonly ord: number;
  readonly escalateStart: number;
  readonly escalatePerEpisode: number;
  /** Lines of the made-up viewers per segment: annoyed ones and the die-hard fans. */
  readonly chat: {
    readonly annoyedPerSegment: number;
    readonly fansPerSegment: number;
    /** Seconds before the segment starts and after it ends in which they still write. */
    readonly leadSeconds: number;
    readonly tailSeconds: number;
    readonly fanNames: readonly string[];
    readonly annoyed: readonly string[];
    readonly fans: readonly string[];
  };
  /** Demo and /dev/ui: preview the gag with a made-up company when the demo has none with the name. */
  readonly demo: {
    readonly preview: boolean;
    readonly company: string;
    readonly founder: string;
    readonly ageDays: number;
  };
  readonly headlines: readonly string[];
  /** First sentence of every segment: makes clear it is the NEXA company of a player. */
  readonly intros: readonly string[];
  readonly whens: readonly string[];
  readonly lines: readonly RunningGagLine[];
  /** Appended when the company is going public or listed (phase "ipo" / "listed"). */
  readonly phaseLines: { readonly ipo: readonly string[]; readonly listed: readonly string[] };
}

export const NEWS_RUNNING_GAGS = {
  vulcan: {
    enabled: true,
    namePattern: "vulcan energy%",
    chanceBps: 7_000,
    ord: 75,
    escalateStart: 12,
    escalatePerEpisode: 2,
    chat: {
      annoyedPerSegment: 4,
      fansPerSegment: 2,
      leadSeconds: 2,
      tailSeconds: 20,
      fanNames: ["BohrkopfBernd", "Vulcan_Vroni", "HODL_Heinz"],
      annoyed: [
        "Bohrt endlich!!!",
        "Ich warte seit {days} Tagen. SEIT {days} TAGEN.",
        "Nächste Woche. Klar. Wie letzte Woche. 🙄",
        "{founder}, nimm einfach eine Schaufel. Bitte.",
        "Ich habe mir extra einen Helm gekauft. Er verstaubt.",
        "Wer glaubt eigentlich noch an diese Bohrung? 🤡",
        "Folge {episode}. Ich kann nicht mehr.",
        "Mein Opa hat auf die Bohrung gewartet. Mein Enkel wird es auch.",
        "BOHRT. EINFACH. LOS.",
        "Ich habe eine Wette laufen, dass ich vorher in Rente gehe.",
        "Der Bohrkopf ist ein Gerücht. Gebt es zu.",
        "Kann mal jemand {founder} einen Bohrer schenken?",
        "Ich schalte nur noch ein, um mich über {company} aufzuregen.",
        "Bald, bald, bald. Ich höre das Wort im Schlaf.",
        "Wenn die bohren, fresse ich meinen Bauhelm.",
        "Tag {days}. Kein Loch. Nicht mal ein kleines. 😤",
        "Mein Hamster gräbt schneller als {company}.",
        "Gutachten Nummer 400 wird bestimmt das letzte. 🙄",
        "Ich hab mir einen Wecker für den Bohrstart gestellt. Die Batterie ist leer.",
        "{company} ist das einzige Unternehmen, das Ankündigungen fördert statt Wärme.",
        "Hört auf zu reden, fangt an zu bohren!!",
        "Jede Stunde dieselbe Meldung. Ich will mein Leben zurück.",
        "Das Loch existiert nur in der Pressemappe.",
        "Ich habe den Bohrplatz gemalt. Aus der Erinnerung an Versprechen.",
        "Nicht schon wieder {company} 😩",
        "{founder}, ich will ein Loch sehen. EIN LOCH.",
        "Ich warte lieber auf den Bus. Der kommt wenigstens irgendwann.",
        "Ich glaube, der Bohrer ist eine Pappattrappe.",
      ],
      fans: [
        "Die Bohrungen kommen, ihr werdet sehen! 💪",
        "HODL {company} 🚀",
        "Gute Dinge brauchen Zeit. Sehr gute Dinge brauchen sehr viel Zeit.",
        "Ihr lacht jetzt. Nach der Bohrung lacht keiner mehr.",
        "{founder} hat einen Plan. Ich kenne ihn nicht, aber er ist gut.",
        "Wer jetzt verkauft, hat die Vision nicht verstanden.",
        "Tag {days}? Das ist doch erst der Anfang!",
        "Ich habe mein ganzes Spielgeld drin. Und ich bereue nichts. 🔥",
        "Der Bohrkopf ist nur gründlich. Das nennt man Qualität.",
        "Hater gonna hate, Bohrer gonna bohr.",
        "Ich hab schon ein Tattoo mit dem Bohrturm. Kein Zurück.",
        "Nächste Woche ist es so weit. Diesmal wirklich. 🙏",
        "Ihr seid nur neidisch, weil ihr nicht früh dabei wart.",
        "Diamond Hands. Diamond Bohrkopf. 💎",
        "Jedes Gutachten bringt uns näher ans Loch!",
        "Ich vertraue {founder} mehr als meiner eigenen Mutter.",
        "Wenn es losgeht, will ich eure Gesichter sehen 😎",
      ],
    },
    demo: { preview: true, company: "Vulcan Energy", founder: "Bohr_Boris", ageDays: 42 },
    headlines: [
      "Tag {days} ohne Bohrung",
      "{company}: Bohrstart wieder verschoben",
      "Eilmeldung: {company} bohrt {when}",
      "Neues aus dem Bohrloch, das es nicht gibt",
      "{company}, Folge {episode}: Die Ankündigung",
      "Bohrung? Bald. Angeblich.",
      "Es bohrt sich was zusammen bei {company}",
      "Breaking: Bohrer weiterhin trocken",
    ],
    intros: [
      "Und nun unsere Dauerserie: Die Spielerfirma {company} von {founder} meldet sich wieder.",
      "Tag {days} ohne Bohrung bei der Spielerfirma {company} von {founder}.",
      "Folge {episode} von „Wann bohrt {company}?“, der NEXA-Firma von {founder}.",
      "Zur Spielerfirma {company}, gegründet von {founder} hier bei NEXA, Stand: Tag {days}.",
      "Eine Pressemitteilung der Spielerfirma {company} von {founder}, die {episode}. ihrer Art.",
      "Die NEXA-Spielerfirma {company} von {founder} hat wieder etwas angekündigt.",
    ],
    whens: [
      "bald",
      "nächste Woche",
      "nach dem nächsten Gutachten",
      "sobald der Bohrkopf aus dem Urlaub zurück ist",
      "gleich nach der Mittagspause",
      "wenn das Wetter mitspielt",
      "spätestens übermorgen, ungefähr",
      "sobald der Bohrer seine Probezeit bestanden hat",
      "nach dem Gutachten zum Gutachten",
      "wenn die Sterne günstig stehen",
      "demnächst, im weitesten Sinne",
      "direkt nach der nächsten Ankündigung",
    ],
    lines: [
      { text: "Die Bohrungen beginnen {when}. Ich wiederhole: {when}.", mood: "confused" },
      {
        text: "Man habe den Bohrstart fest im Blick. Er sei {when}. Ich verdrehe die Augen, Sie sehen es ja.",
        mood: "confused",
      },
      {
        text: "Der Bohrer ist angeblich startklar, die Bohrungen beginnen {when}. Ich lege den Zettel zu den anderen.",
        mood: "crying",
      },
      {
        text: "Laut Firma beginnt die Bohrung {when}. Das stand genau so auch gestern hier. Und vorgestern.",
        mood: "crying",
      },
      {
        text: "Sensationell! Unglaublich! Die Bohrungen beginnen {when}! ...Entschuldigung, ich habe mich kurz gefreut wie beim ersten Mal.",
        mood: "shocked",
      },
      {
        text: "Seufz. Die Bohrungen kommen {when}. Ich habe dafür inzwischen eine eigene Taste auf dem Teleprompter.",
        mood: "crying",
      },
      { text: "Neu ist: nichts. Die Bohrung kommt {when}, sagt {founder}. Mit sehr ernstem Gesicht.", mood: "smug" },
      {
        text: "Die Firma bittet um Geduld, die Bohrungen beginnen {when}. Meine Geduld ist seit Tag drei verbraucht.",
        mood: "angry",
      },
      { text: "Es gibt einen Zeitplan! Darin steht: {when}. Mehr steht da nicht.", mood: "laughing" },
      { text: "Der Bohrplatz sei bereit, nur der Bohrer noch nicht. Start also {when}.", mood: "confused" },
      { text: "Man habe ein Gutachten bestellt, das klären soll, wann man bohrt. Antwort: {when}.", mood: "smug" },
      { text: "Heute neu im Angebot: ein Bohrstart {when}. Gestern im Angebot: derselbe.", mood: "laughing" },
      {
        text: "Der Bohrkopf ist laut Firma im Urlaub. Er schickt Postkarten. Bohren will er {when}.",
        mood: "laughing",
      },
      {
        text: "Die Firma hat ein Loch angekündigt. Kein Loch gebohrt, nur angekündigt. Ab {when} soll es wirklich eines werden.",
        mood: "confused",
      },
      {
        text: "Für die Bohrung wurde jetzt ein Bändchen zum Durchschneiden gekauft. Bohren dann {when}.",
        mood: "smug",
      },
      { text: "Mir liegt eine Einladung zum Bohrstart vor. Datum: {when}. Dresscode: Geduld.", mood: "neutral" },
      {
        text: "Die Firma verspricht, dass {when} gebohrt wird. Ich verspreche, dass ich nächste Stunde wieder darüber rede.",
        mood: "smug",
      },
      { text: "Der Bohrer hat jetzt einen Namen bekommen: Bald. Er startet {when}.", mood: "laughing" },
      {
        text: "Laut {founder} ist der Bohrturm aufgebaut. Er steht nur noch verkehrt herum. Umgedreht wird {when}.",
        mood: "shocked",
      },
      {
        text: "Es wurde ein Countdown gestartet. Er zählt rückwärts, dann vorwärts, dann wieder rückwärts. Start: {when}.",
        mood: "confused",
      },
      { text: "Der Bohrkopf hat sich krankgemeldet. Wegen Bohrangst. Man rechnet mit ihm {when}.", mood: "crying" },
      {
        text: "Die Firma hat einen Bohrbeauftragten eingestellt, der einen Bohrbeauftragtenbeauftragten sucht. Bohrung {when}.",
        mood: "laughing",
      },
      {
        text: "Heute wurde feierlich der Spaten für den Bohrer des Bohrers enthüllt. Gebohrt wird {when}.",
        mood: "shocked",
      },
      {
        text: "Der Bohrer wurde gesichtet! Auf einem Foto. Aus dem Katalog. Live erleben wir ihn {when}.",
        mood: "shocked",
      },
      {
        text: "Die Firma bohrt jetzt testweise in einem Kuchen. Erfolgreich. Der Boden ist {when} dran.",
        mood: "laughing",
      },
      {
        text: "Das Gutachten zum Gutachten hat ein drittes Gutachten empfohlen. Dieses empfiehlt: {when}.",
        mood: "crying",
      },
      {
        text: "Man hat das Loch bereits gemalt, damit der Bohrer weiß, wo er hin muss. Er kommt {when}.",
        mood: "smug",
      },
      { text: "Der Bohrkopf meldet sich aus dem Urlaub: Er hat sich verlängert. Neuer Plan: {when}.", mood: "crying" },
      {
        text: "Die Firma hat jetzt einen Bohr-Podcast. Folge 1 heißt „Bald“. Gebohrt wird in Folge 2, also {when}.",
        mood: "laughing",
      },
      {
        text: "Achtung, große Neuigkeit: Der Bohrer hat gezuckt. Das gilt intern schon als Bohrbeginn. Offiziell: {when}.",
        mood: "shocked",
      },
      {
        text: "Der Bohrer wurde ins Museum gebracht. Als Leihgabe, bis zur Bohrung. Die ist {when}.",
        mood: "confused",
      },
      {
        text: "Der Bohrstart wurde an eine Arbeitsgruppe delegiert, die gerade ihren Namen diskutiert. Ergebnis erwartet {when}.",
        mood: "angry",
      },
      { text: "Laut {founder} wird schon gebohrt, nur sehr, sehr langsam. Man sieht es {when}.", mood: "smug" },
      {
        text: "Die Firma bohrt jetzt rückwärts: erst die Feier, dann das Loch. Das Loch kommt {when}.",
        mood: "laughing",
      },
      {
        text: "Ein Wahrsager wurde beauftragt, den Bohrstart vorherzusagen. Er sah: {when}. Und einen großen Ankündigungsberg.",
        mood: "confused",
      },
      {
        text: "Der Bohrkopf hat ein Buch geschrieben: „Warum ich noch nicht bohre“. Teil zwei erscheint {when}.",
        mood: "laughing",
      },
      {
        text: "Gestern wurde der Bohrer poliert, heute bewundert, morgen vielleicht benutzt. Offiziell: {when}.",
        mood: "smug",
      },
      {
        text: "Der Bohrturm hat inzwischen einen eigenen Fanclub und eine Patenschaft für eine Taube. Gebohrt wird {when}.",
        mood: "shocked",
      },
      { text: "Man hat beschlossen, erst zu bohren, wenn der Bohrer volljährig ist. Das ist {when}.", mood: "angry" },
      {
        text: "Mir wurde zugeflüstert: Die Bohrung beginnt wirklich {when}. Der Flüsterer war der Bohrer selbst. Ich glaube ihm nicht.",
        mood: "smug",
      },
    ],
    phaseLines: {
      ipo: [
        "Immerhin geht {company} gerade an die Börse. Die Aktie bohrt hoffentlich schneller.",
        "Der Börsengang von {company} läuft. Erst Aktien, dann Löcher, so der Plan.",
      ],
      listed: [
        "Die Aktie von {company} ist übrigens gelistet. Bohren kann sie trotzdem nicht.",
        "Die Aktionäre von {company} haben jetzt eine Bohr-Sparte im Forum. Mehr Bewegung gibt es nicht.",
      ],
    },
  },
} as const satisfies Record<string, RunningGagConfig>;

export type RunningGagKey = keyof typeof NEWS_RUNNING_GAGS;
