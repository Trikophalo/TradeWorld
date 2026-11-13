import { afterEach, describe, expect, it } from "vitest";
import {
  currencySign,
  formatMoney,
  formatMoneyShort,
  formatPrice,
  localizeMoneyDeep,
  localizeMoneyText,
  setDisplayCurrency,
} from "./format";

const nbsp = (s: string) => s.replace(/ /g, " ");

describe("formatMoneyShort (ADR-072)", () => {
  it("shows whole euros below 10.000 €", () => {
    expect(nbsp(formatMoneyShort(987_654))).toBe("9.876 €");
  });

  it("shows thousands as k and only switches when the next thousand is full", () => {
    expect(formatMoneyShort(1_500_000)).toBe("15k €");
    expect(formatMoneyShort(1_599_999)).toBe("15k €");
    expect(formatMoneyShort(1_599_900 + 99)).toBe("15k €");
    expect(formatMoneyShort(1_600_000)).toBe("16k €");
    expect(formatMoneyShort(99_999_999)).toBe("999k €");
  });

  it("uses Mio. and Mrd. with one decimal, rounded down", () => {
    expect(formatMoneyShort(100_000_000)).toBe("1 Mio. €");
    expect(formatMoneyShort(129_999_999)).toBe("1,2 Mio. €");
    expect(formatMoneyShort(250_000_000_000)).toBe("2,5 Mrd. €");
  });

  it("keeps the sign", () => {
    expect(formatMoneyShort(-2_000_000)).toBe("−20k €");
  });
});

describe("display currency (ADR-113)", () => {
  afterEach(() => setDisplayCurrency("eur"));

  it("is the euro unless the player picks another sign", () => {
    expect(currencySign()).toBe("€");
    expect(nbsp(formatMoney(500_000, { whole: true }))).toBe("5.000 €");
  });

  it("shows the same amounts with the dollar sign or NX", () => {
    setDisplayCurrency("usd");
    expect(nbsp(formatMoney(1_284_250))).toBe("12.842,50 $");
    expect(nbsp(formatMoney(500_000, { whole: true, sign: true }))).toBe("+5.000 $");
    expect(formatMoneyShort(1_500_000)).toBe("15k $");
    expect(formatMoneyShort(129_999_999)).toBe("1,2 Mio. $");
    expect(nbsp(formatPrice(1_126_400))).toBe("112,64 $");
    setDisplayCurrency("nx");
    expect(nbsp(formatMoney(1_284_250))).toBe("12.842,50 NX");
    expect(formatMoneyShort(250_000_000_000)).toBe("2,5 Mrd. NX");
    expect(nbsp(formatPrice(6_120))).toBe("0,612 NX");
  });

  it("swaps the sign in texts from messages and from the server", () => {
    expect(localizeMoneyText("Kleinkredit bis 50.000 €")).toBe("Kleinkredit bis 50.000 €");
    setDisplayCurrency("nx");
    expect(localizeMoneyText("Kleinkredit bis 50.000 €")).toBe("Kleinkredit bis 50.000 NX");
    expect(localizeMoneyText("Umsatz 1,2 Mio. €, Gewinn 300 Tsd. €.")).toBe("Umsatz 1,2 Mio. NX, Gewinn 300 Tsd. NX.");
    expect(localizeMoneyText("Ohne Betrag")).toBe("Ohne Betrag");
  });

  it("walks whole answers without changing them in place", () => {
    const answer = {
      id: 7,
      title: "Erbschaft: +5.000 €",
      plain: { text: "nichts", n: [1, 2, 3] },
      list: [{ body: "Finderlohn: +250 €" }, { body: "kein Geld" }],
      at: null,
    };
    expect(localizeMoneyDeep(answer)).toBe(answer);
    setDisplayCurrency("usd");
    const shown = localizeMoneyDeep(answer);
    expect(shown.title).toBe("Erbschaft: +5.000 $");
    expect(shown.list[0]!.body).toBe("Finderlohn: +250 $");
    expect(shown.plain).toBe(answer.plain);
    expect(shown.list[1]).toBe(answer.list[1]);
    expect(answer.title).toBe("Erbschaft: +5.000 €");
  });
});
