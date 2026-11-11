"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BALANCE } from "@/config/balance";
import { usePlayerLevel } from "@/features/game/store";
import { formatMoney } from "@/lib/format";
import { fadeUp, staggerContainer } from "@/lib/motion";

const STEPS = ["stepSector", "stepName", "stepLogo", "stepColor", "stepForm", "stepFunding", "stepSummary"] as const;
const TIER_LABELS = { small_business: "tierSmall", gmbh: "tierGmbh", ag: "tierAg" } as const;

/** What the Company tab shows before the founding unlock. */
export function CompanyLocked() {
  const t = useTranslations("company");
  const level = usePlayerLevel();
  const tiers = BALANCE.company.tiers.filter((tier) => tier.id in TIER_LABELS);
  const unlockLevel = tiers[0]?.minLevel ?? 10;
  const remaining = Math.max(0, unlockLevel - level);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
      <div className="space-y-5 lg:space-y-6">
        <Card padding="lg" className="flex flex-col items-center text-center lg:flex-row lg:gap-6 lg:text-left">
          <div className="grid size-24 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-3">
            <PixelIcon {...UI_ICONS.lock} scale={4} />
          </div>
          <div className="mt-4 w-full lg:mt-0">
            <h2 className="font-pixel text-base text-fg-1 uppercase">{t("lockedTitle")}</h2>
            <p className="mt-2 text-fg-2">{t("lockedText")}</p>
            <Progress value={level / unlockLevel} label={t("progress")} className="mt-4" />
            <p className="mt-2 nums text-sm text-fg-3">{t("levelsToGo", { count: remaining })}</p>
          </div>
        </Card>

        <Card padding="lg">
          <CardHeader>
            <CardTitle>{t("tiersTitle")}</CardTitle>
          </CardHeader>
          <motion.ul
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="grid gap-3 sm:grid-cols-3"
          >
            {tiers.map((tier) => (
              <motion.li key={tier.id} variants={fadeUp} className="rounded-md border border-line-1 bg-surface-2 p-4">
                <Badge tone={level >= tier.minLevel ? "gain" : "neutral"}>
                  {t("tierFrom", { level: tier.minLevel })}
                </Badge>
                <p className="mt-3 font-semibold text-fg-1">{t(TIER_LABELS[tier.id as keyof typeof TIER_LABELS])}</p>
                <p className="mt-1 nums text-sm text-fg-2">
                  {t("tierCost", { cost: formatMoney(tier.foundingCostCents, { whole: true }) })}
                </p>
                <p className="nums text-sm text-fg-3">{t("tierStaff", { count: tier.maxEmployees })}</p>
              </motion.li>
            ))}
          </motion.ul>
        </Card>
      </div>

      <Card padding="lg" className="self-start">
        <CardHeader>
          <CardTitle>{t("stepsTitle")}</CardTitle>
        </CardHeader>
        <ol className="space-y-1">
          {STEPS.map((step, index) => (
            <li key={step} className="flex items-center gap-3 py-1.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-xs bg-surface-3 font-pixel nums text-xs text-fg-2">
                {index + 1}
              </span>
              <span className="text-fg-2">{t(step)}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
