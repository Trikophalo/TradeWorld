/*
 * The made-up friends of the offline demo answer in the chat now and then (ADR-164). The live game has real
 * friends; nothing here reaches the server.
 */
export const FRIEND_CHAT_DEMO = {
  /** Chance that a friend answers a line (a line with a question mark is always answered). */
  replyChanceBps: 7_000,
  /** The answer arrives after this many seconds. */
  replyDelaySecondsMin: 2,
  replyDelaySecondsMax: 6,
  /** "{name}" is the demo player's nickname. */
  lines: {
    reply: [
      "Haha, du bist so ein Börsenhai 🦈",
      "Ich hab gerade alles in Bananen-Aktien gesteckt. Frag nicht.",
      "Mein Depot ist so rot, es könnte Ketchup sein 🍅",
      "Klingt nach einem Plan. Einem schlechten, aber einem Plan.",
      "Moment, ich muss erst meinen Hut richten 🤠",
      "Bin gerade im Kleiderschrank. Wichtige Entscheidungen.",
      "Kauf niedrig, verkauf hoch. Ich mach's andersrum, ist spannender.",
      "Ich hab heute schon 3 Euro Gewinn gemacht. Champagner! 🍾",
      "Mr. Doodle Dangle hat schon wieder über meine Firma gelästert 😤",
      "Wenn ich groß bin, werd ich Mondrakete 🚀",
      "Schreib mir das nochmal, wenn der Kurs steigt.",
      "Ich stups dich gleich an, nur so zur Warnung 👉",
      "Mein Hamster hätte besser investiert. Und er hat keinen Daumen.",
      "Tja {name}, so ist das an der Börse.",
      "Ich bin nur wegen der Pixel-Hüte hier, ehrlich gesagt.",
      "Lass uns eine Firma gründen. Name: Pleite & Söhne.",
    ],
    question: [
      "Gute Frage. Ich weiß es auch nicht 🤷",
      "Ja. Nein. Vielleicht. Frag mich nach Börsenschluss.",
      "Da musst du Finn fragen, der weiß alles.",
      "Hmm, ich würfel mal… sagt: Kaufen! 🎲",
      "Keine Ahnung, aber ich bin dabei!",
    ],
    group: [
      "Endlich eine Gruppe! 🎉",
      "Wer hat mich hier reingeholt? Egal, ich bleibe.",
      "Ich bring die Snacks mit 🍕",
      "Börsenclub, Treffen um Mitternacht. Kommt verkleidet.",
    ],
  },
} as const;
