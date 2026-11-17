/*
 * News-Aktionen (ADR-193): now and then the hourly live show announces one promotion for everybody. It starts with
 * the show and runs `durationMinutes`. At most one runs at a time, and the same kind never comes twice in a row.
 * - pack_sale: every pack of one released Nexamon set costs `packSale.discountBps` less (single, multi-buy, sealed).
 * - free_nft: every player mints one NFT without the creation fee.
 * - tax_return: every founder of an active company files once and gets `taxReturn.shareBps` of the sales revenue
 *   of their active companies in the last `windowHours` closed hours, at most `capCents`.
 * Only play money; the timer shows when an in-game event ends and is never attached to a purchase prompt.
 * Placeholders in the lines: {set} set name, {pct} discount or share in percent, {minutes}, {cap}.
 */
export const NEWS_PROMO_KINDS = ["pack_sale", "free_nft", "tax_return"] as const;
export type NewsPromoKind = (typeof NEWS_PROMO_KINDS)[number];

export const NEWS_PROMO_RULES = {
  /** Chance per show that it brings a promotion (3 400 = about one show in three). */
  chanceBps: 3400,
  durationMinutes: 15,
  kinds: NEWS_PROMO_KINDS,
  packSale: { discountBps: 2000 },
  taxReturn: { shareBps: 1000, windowHours: 24, capCents: 5_000_000 },
  /** Players active within this many days get the notification. */
  notifyActiveDays: 7,
  /** What Mr. Doodle Dangle says; one line per kind is drawn. */
  lines: {
    pack_sale: [
      {
        headline: "Booster-Rabatt: {set} {pct} % günstiger",
        text: "Achtung, Sammler! Alle Booster von {set} kosten ab jetzt {minutes} Minuten lang {pct} % weniger. Ich habe meine Karten ja alle in der Waschmaschine verloren, aber ihr macht das bestimmt besser.",
      },
      {
        headline: "{set}: Packs {pct} % reduziert",
        text: "Der Kartenhändler hat sich verrechnet, und ich verrate es euch live: {set}-Packs gibt es für {minutes} Minuten {pct} % billiger. Ich selbst sammle nur Krümel auf meinem Pult.",
      },
    ],
    free_nft: [
      {
        headline: "Gratis-NFT für alle",
        text: "Die Prägemaschine hat heute gute Laune: {minutes} Minuten lang darf jeder ein NFT ohne Prägegebühr erschaffen. Einmal pro Person. Ich male ein Selbstporträt, ein Meisterwerk aus drei Pixeln.",
      },
      {
        headline: "Die Prägegebühr macht Pause",
        text: "Eilmeldung aus dem Atelier: Für {minutes} Minuten kostet euer nächstes NFT keine Gebühr. Einmal pro Kopf, sonst wird der Pinsel sauer.",
      },
    ],
    tax_return: [
      {
        headline: "Steuererklärung mit Rückzahlung",
        text: "Das NEXA-Finanzamt ist großzügig, ich habe es selbst nicht geglaubt: Wer eine Firma hat, gibt in den nächsten {minutes} Minuten eine Steuererklärung ab und bekommt {pct} % vom Umsatz zurück, höchstens {cap}.",
      },
      {
        headline: "Finanzamt zahlt zurück",
        text: "Firmenchefs, aufgepasst: {minutes} Minuten lang zahlt das Finanzamt {pct} % eures Tagesumsatzes zurück, bis {cap}. Formular ausfüllen, unterschreiben, fertig. Ich habe meins mit Ketchup unterschrieben.",
      },
    ],
  },
} as const;
