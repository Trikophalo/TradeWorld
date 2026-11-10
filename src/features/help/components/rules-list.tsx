import { getTranslations } from "next-intl/server";
import { BULL, COIN, SECTOR_ICONS, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Accordion, type AccordionItem } from "@/components/ui/accordion";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { BALANCE } from "@/config/balance";
import { formatInteger, formatMoney } from "@/lib/format";
import { RuleBody } from "./rule-body";

const percent = (bps: number) => `${formatInteger(bps / 100)} %`;
const share = (cents: number, bps: number) => Math.round((cents * bps) / 10_000);
const whole = (cents: number) => formatMoney(cents, { whole: true });

/**
 * Every rule a player has to know, in plain words with one worked example.
 * All numbers are computed from BALANCE, so the texts can never drift from
 * the values the game actually uses (docs/DECISIONS.md, ADR-029).
 */
export async function RulesList() {
  const t = await getTranslations("rules");
  const labels = { example: t("example"), where: t("where") };
  const { trading, economy, progression } = BALANCE;

  // Worked examples
  const fee = formatMoney(trading.orderFeeCents);
  const gain = 100_000;
  const loss = 40_000;
  const gainsRate = trading.capitalGainsTaxBps;
  const incomeRate = trading.incomeTaxOnCouponsAndDividendsBps;
  const dividend = 40_000;
  const vaultCap = economy.basicIncomeCentsPerHour * economy.vaultCapHours;
  const tradeXp = progression.xpSources.trade.xp;

  const tradingRules: AccordionItem[] = [
    {
      id: "order-fee",
      title: t("orderFee.title"),
      summary: t("orderFee.summary", { fee }),
      icon: <PixelIcon {...UI_ICONS.markets} scale={2} className="text-fg-2" />,
      content: (
        <RuleBody
          labels={labels}
          text={t("orderFee.text", { fee })}
          example={t("orderFee.example", {
            fee,
            value: whole(50_000),
            total: formatMoney(50_000 + trading.orderFeeCents),
          })}
          where={t("orderFee.where")}
        />
      ),
    },
    {
      id: "tax-gains",
      title: t("taxGains.title"),
      summary: t("taxGains.summary", { rate: percent(gainsRate) }),
      icon: <PixelIcon {...BULL} scale={2} />,
      content: (
        <RuleBody
          labels={labels}
          text={t("taxGains.text", { rate: percent(gainsRate) })}
          example={t("taxGains.example", {
            gain: whole(gain),
            tax: whole(share(gain, gainsRate)),
            net: whole(gain - share(gain, gainsRate)),
            loss: whole(loss),
            taxable: whole(gain - loss),
            taxAfterLoss: whole(share(gain - loss, gainsRate)),
          })}
          where={t("taxGains.where")}
        />
      ),
    },
    {
      id: "tax-income",
      title: t("taxIncome.title"),
      summary: t("taxIncome.summary", { rate: percent(incomeRate) }),
      icon: <PixelIcon {...COIN} scale={2} />,
      content: (
        <RuleBody
          labels={labels}
          text={t("taxIncome.text", { rate: percent(incomeRate) })}
          example={t("taxIncome.example", {
            gross: whole(dividend),
            tax: whole(share(dividend, incomeRate)),
            net: whole(dividend - share(dividend, incomeRate)),
          })}
          where={t("taxIncome.where")}
        />
      ),
    },
  ];

  const progressRules: AccordionItem[] = [
    {
      id: "vault",
      title: t("vault.title"),
      summary: t("vault.summary", { rate: whole(economy.basicIncomeCentsPerHour), hours: economy.vaultCapHours }),
      icon: <PixelIcon {...COIN} scale={2} />,
      content: (
        <RuleBody
          labels={labels}
          text={t("vault.text", { rate: whole(economy.basicIncomeCentsPerHour), hours: economy.vaultCapHours })}
          example={t("vault.example", { cap: whole(vaultCap) })}
          where={t("vault.where")}
        />
      ),
    },
    ...(progression.xpMultiplier !== 1
      ? [
          {
            id: "xp-bonus",
            title: t("xpBonus.title", { factor: progression.xpMultiplier }),
            summary: t("xpBonus.summary", { factor: progression.xpMultiplier }),
            icon: <PixelIcon {...SECTOR_ICONS.energy} scale={2} />,
            content: (
              <RuleBody
                labels={labels}
                text={t("xpBonus.text", {
                  factor: progression.xpMultiplier,
                  trades: progression.xpSources.trade.maxTradesPerDay,
                })}
                example={t("xpBonus.example", { base: tradeXp, boosted: tradeXp * progression.xpMultiplier })}
                where={t("xpBonus.where")}
              />
            ),
          },
        ]
      : []),
  ];

  const groups = [
    { id: "trading", title: t("groupTrading"), items: tradingRules },
    { id: "progress", title: t("groupProgress"), items: progressRules },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
      {groups.map((group) => (
        <Card key={group.id} padding="lg" className="self-start">
          <CardHeader className="mb-1">
            <CardTitle>{group.title}</CardTitle>
          </CardHeader>
          <Accordion items={group.items} />
        </Card>
      ))}
    </div>
  );
}
