import { getTranslations } from "next-intl/server";
import { BEAR, BULL, COIN, SECTOR_ICONS, UI_ICONS } from "@/components/pixel/art";
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

  // ---- Company rules
  const { company, sectors, centralBank, time } = BALANCE;
  const keepAtDoublePrice = (exponent: number) => Math.round(100 / 2 ** exponent);
  const localTech = sectors.tech.baseDemandCentsPerQuarter * company.segments.local.demandShare;
  const regionalTech = sectors.tech.baseDemandCentsPerQuarter * company.segments.regional.demandShare;
  const smallBusiness = company.tiers.find((tier) => tier.id === "small_business");
  const gmbh = company.tiers.find((tier) => tier.id === "gmbh");
  const profit = 200_000;
  const overdraftBps = centralBank.startRateBps + company.insolvency.overdraftSpreadBps;
  const bullets = (lines: string[]) => (
    <ul className="space-y-1.5">
      {lines.map((line) => (
        <li key={line} className="flex gap-2.5 text-pretty">
          <span aria-hidden className="mt-2 size-1.5 shrink-0 bg-accent" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );

  const companyRules: AccordionItem[] = [
    {
      id: "company-earn",
      title: t("companyEarn.title"),
      summary: t("companyEarn.summary"),
      icon: <PixelIcon {...SECTOR_ICONS.retail} scale={2} />,
      content: (
        <RuleBody
          labels={labels}
          text={t("companyEarn.text")}
          example={t("companyEarn.example", { market: whole(localTech), revenue: whole(localTech / 4) })}
          where={t("companyEarn.where")}
        >
          {bullets([
            t("companyEarn.price", {
              retailKeep: keepAtDoublePrice(sectors.retail.priceExponent),
              pharmaKeep: keepAtDoublePrice(sectors.pharma.priceExponent),
            }),
            t("companyEarn.quality"),
            t("companyEarn.awareness", { decay: Math.round(company.marketing.awarenessDecayPerQuarter * 100) }),
            t("companyEarn.capacity"),
          ])}
        </RuleBody>
      ),
    },
    {
      id: "company-fail",
      title: t("companyFail.title"),
      summary: t("companyFail.summary"),
      icon: <PixelIcon {...BEAR} scale={2} />,
      content: (
        <RuleBody
          labels={labels}
          text={t("companyFail.text")}
          example={t("companyFail.example", {
            fixed: whole(smallBusiness?.fixedCostCentsPerQuarter ?? 0),
            founding: whole(smallBusiness?.foundingCostCents ?? 0),
          })}
          where={t("companyFail.where")}
        >
          {bullets([t("companyFail.idle"), t("companyFail.greedy"), t("companyFail.cheap"), t("companyFail.fast")])}
        </RuleBody>
      ),
    },
    {
      id: "markets",
      title: t("markets.title"),
      summary: t("markets.summary"),
      icon: <PixelIcon {...SECTOR_ICONS.logistics} scale={2} />,
      content: (
        <RuleBody
          labels={labels}
          text={t("markets.text")}
          example={t("markets.example", { regional: whole(regionalTech), local: whole(localTech) })}
          where={t("markets.where")}
        />
      ),
    },
    {
      id: "tiers",
      title: t("tiers.title"),
      summary: t("tiers.summary"),
      icon: <PixelIcon {...UI_ICONS.company} scale={2} className="text-fg-2" />,
      content: (
        <RuleBody
          labels={labels}
          text={t("tiers.text", { conversion: percent(company.conversionFeeBps) })}
          example={t("tiers.example", {
            gmbhConversion: whole(share(gmbh?.foundingCostCents ?? 0, company.conversionFeeBps)),
          })}
          where={t("tiers.where")}
        >
          <div className="-mx-1 no-scrollbar overflow-x-auto px-1">
            <table className="w-full min-w-[420px] text-left nums text-sm">
              <thead>
                <tr className="label-pixel text-fg-3">
                  <th className="py-2 pr-3 font-normal">{t("tiers.colTier")}</th>
                  <th className="py-2 pr-3 font-normal">{t("tiers.colLevel")}</th>
                  <th className="py-2 pr-3 text-right font-normal">{t("tiers.colFounding")}</th>
                  <th className="py-2 pr-3 text-right font-normal">{t("tiers.colFixed")}</th>
                  <th className="py-2 text-right font-normal">{t("tiers.colStaff")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-1 text-fg-1">
                {company.tiers.map((tier) => (
                  <tr key={tier.id}>
                    <td className="py-2 pr-3 font-medium">{t(`tiers.${tier.id}`)}</td>
                    <td className="py-2 pr-3">{tier.minLevel}</td>
                    <td className="py-2 pr-3 text-right">
                      {tier.id === "listed" ? t("tiers.afterIpo") : whole(tier.foundingCostCents)}
                    </td>
                    <td className="py-2 pr-3 text-right">{whole(tier.fixedCostCentsPerQuarter)}</td>
                    <td className="py-2 text-right">{formatInteger(tier.maxEmployees)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </RuleBody>
      ),
    },
    {
      id: "corporate-tax",
      title: t("corporateTax.title"),
      summary: t("corporateTax.summary", { rate: percent(company.corporateTaxBps) }),
      icon: <PixelIcon {...COIN} scale={2} />,
      content: (
        <RuleBody
          labels={labels}
          text={t("corporateTax.text", { rate: percent(company.corporateTaxBps) })}
          example={t("corporateTax.example", {
            profit: whole(profit),
            tax: whole(share(profit, company.corporateTaxBps)),
            net: whole(profit - share(profit, company.corporateTaxBps)),
          })}
          where={t("corporateTax.where")}
        />
      ),
    },
    {
      id: "insolvency",
      title: t("insolvency.title"),
      summary: t("insolvency.summary", { quarters: company.insolvency.graceQuarters }),
      icon: <PixelIcon {...UI_ICONS.bell} scale={2} className="text-warn" />,
      content: (
        <RuleBody
          labels={labels}
          text={t("insolvency.text", {
            quarters: company.insolvency.graceQuarters,
            hours: company.insolvency.graceQuarters * time.quarterHours,
            lockout: company.insolvency.foundingLockoutGameDays,
          })}
          example={t("insolvency.example", {
            rate: percent(overdraftBps),
            perQuarter: formatMoney(share(100_000, overdraftBps) / time.quartersPerGameYear),
          })}
          where={t("insolvency.where")}
        />
      ),
    },
  ];

  const groups = [
    { id: "trading", title: t("groupTrading"), items: tradingRules },
    { id: "progress", title: t("groupProgress"), items: progressRules },
  ];

  const column = (list: typeof groups) =>
    list.map((group) => (
      <Card key={group.id} padding="lg">
        <CardHeader className="mb-1">
          <CardTitle>{group.title}</CardTitle>
        </CardHeader>
        <Accordion items={group.items} />
      </Card>
    ));

  return (
    <div className="grid items-start gap-5 *:min-w-0 lg:grid-cols-2 lg:gap-6">
      <div className="space-y-5 lg:space-y-6">{column(groups)}</div>
      <div className="space-y-5 lg:space-y-6">
        {column([{ id: "company", title: t("groupCompany"), items: companyRules }])}
      </div>
    </div>
  );
}
