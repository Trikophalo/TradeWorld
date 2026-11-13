"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { COIN, CONTRACT, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import { useMyCompany } from "@/features/company/hooks";
import { useGame } from "@/features/game/store";
import type { DealKind } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { SPRING, STAGGER } from "@/lib/motion";
import { dealSizeLimitCents, maxLoanPrincipalCents } from "@/lib/sim/deals";
import { useDeals } from "../hooks";

const ART: Record<DealKind, PixelArt> = { loan: COIN, supply: CONTRACT, stake: UI_ICONS.company };
const KINDS: readonly DealKind[] = ["loan", "supply", "stake"];

/**
 * How deals work (ADR-102): the three kinds with an example and when they pay off, the four steps of a deal, and how
 * big the player's deals may be right now (loans by level, company deals by company value, ADR-100).
 */
export function DealsGuide({ open }: { open: boolean }) {
  const t = useTranslations("dealsGuide");
  const reduced = useReducedMotion();
  const level = useGame((s) => s.portfolio?.level ?? 1);
  const company = useMyCompany().data?.company ?? null;
  // The server's limits when it sends them (M4k), otherwise the same formulas here.
  const limits = useDeals().data?.limits ?? null;
  const loanMax = limits?.loanMaxCents ?? maxLoanPrincipalCents(level);
  const companyMax = company ? (limits?.companyDealMaxCents ?? dealSizeLimitCents(company.valueCents)) : null;
  const steps = t.raw("steps") as string[];

  return (
    <Card padding="lg" className="space-y-4" data-testid="deals-guide">
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 focus-ring">
          <span className="label-pixel text-fg-2">{t("title")}</span>
          <span aria-hidden className="text-fg-3 transition-transform duration-fast group-open:rotate-90">
            ▸
          </span>
        </summary>
        <div className="mt-4 space-y-5">
          <ul className="grid gap-3 lg:grid-cols-3">
            {KINDS.map((kind, i) => (
              <motion.li
                key={kind}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING.smooth, delay: reduced ? 0 : i * STAGGER * 2 }}
                className="rounded-md border border-line-1 bg-surface-2 p-3"
                data-kind={kind}
              >
                <div className="flex items-center gap-2">
                  <span className="text-accent" aria-hidden>
                    <PixelIcon {...ART[kind]} scale={Math.max(1, Math.floor(24 / ART[kind].grid[0]!.length))} />
                  </span>
                  <p className="font-semibold text-fg-1">{t(`kinds.${kind}.name`)}</p>
                </div>
                <p className="mt-1.5 text-sm text-pretty text-fg-2">{t(`kinds.${kind}.what`)}</p>
                <p className="mt-2 text-xs text-pretty text-fg-3">
                  <span className="font-medium text-fg-2">{t("example")}: </span>
                  {t(`kinds.${kind}.example`)}
                </p>
                <p className="mt-1 text-xs text-pretty text-gain">{t(`kinds.${kind}.when`)}</p>
              </motion.li>
            ))}
          </ul>

          <ol className="grid gap-2 sm:grid-cols-4">
            {steps.map((step, i) => (
              <li key={step} className="flex gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm text-fg-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-xs bg-accent-soft font-pixel text-xs text-accent">
                  {i + 1}
                </span>
                <span className="text-pretty">{step}</span>
              </li>
            ))}
          </ol>

          <div className="grid gap-2 text-sm sm:grid-cols-2" data-testid="deal-limits">
            <p className="rounded-md border border-line-1 px-3 py-2 text-fg-2">
              {t("loanLimit", { amount: formatMoney(loanMax, { whole: true }), level })}
            </p>
            <p className="rounded-md border border-line-1 px-3 py-2 text-fg-2">
              {company && companyMax !== null
                ? t("companyLimit", {
                    value: formatMoney(company.valueCents, { whole: true }),
                    amount: formatMoney(companyMax, { whole: true }),
                  })
                : t("noCompany")}
            </p>
          </div>
        </div>
      </details>
    </Card>
  );
}
