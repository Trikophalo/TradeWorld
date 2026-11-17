"use client";

import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import type { MyCompany } from "@/features/game/types";
import { cn } from "@/lib/utils";
import { companyProgress } from "../progress";
import { GrowthPath } from "./growth-path";
import { ExpansionCard } from "./profit";

/** How many endless levels after the current one the path shows ahead. */
const AHEAD = 2;

/**
 * Wachstum & Ausbau in one container (ADR-191): one continuous path, the four growth stages of the product first, then
 * the endless expansion levels right after them. Below, the part that moves the next step: the open seats of the stage
 * or the next expansion. The two systems keep their own rules and rewards; this only shows them as one way up.
 */
export function GrowthAndExpansion({
  company,
  onFill,
  onTrain,
}: {
  company: MyCompany;
  onFill: (skills: string[]) => void;
  onTrain?: () => void;
}) {
  const t = useTranslations("hq.growthPath");
  const p = companyProgress(company);
  const steps = [
    ...company.stages.map((st, i) => ({
      key: `stage-${i + 1}`,
      label: t("stage", { n: i + 1 }),
      done: st.reached,
      current: !st.reached && i === p.stagesDone,
    })),
    ...Array.from({ length: company.expansionLevel + AHEAD }, (_, i) => ({
      key: `level-${i + 1}`,
      label: t("level", { n: i + 1 }),
      done: i < company.expansionLevel,
      current: p.stagesDone >= company.stages.length && i === company.expansionLevel,
    })),
  ];
  return (
    <Card padding="lg" className="space-y-4" data-testid="growth-expansion">
      <div className="flex items-start gap-3">
        <PixelIcon {...UI_ICONS.upgrade} scale={2} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg-1">{t("title")}</p>
          <p className="text-xs text-pretty text-fg-3">{t("text")}</p>
        </div>
        <span className="nums text-sm font-semibold text-fg-1" data-testid="growth-step">
          {t("step", { step: p.step })}
        </span>
      </div>
      <ol className="flex flex-wrap items-center gap-1.5" aria-label={t("pathLabel")} data-testid="growth-path-steps">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5" data-step={s.key} data-done={s.done}>
            {i > 0 && <span aria-hidden className={cn("h-0.5 w-3", s.done ? "bg-gain" : "bg-line-2")} />}
            <span
              aria-current={s.current ? "step" : undefined}
              className={cn(
                "rounded-pill border px-2 py-0.5 nums text-2xs",
                s.done
                  ? "border-gain/50 bg-gain-soft text-gain"
                  : s.current
                    ? "border-accent bg-accent-soft text-fg-1"
                    : "border-line-1 text-fg-3",
              )}
            >
              {s.label}
            </span>
          </li>
        ))}
        <li aria-hidden className="text-2xs text-fg-3">
          …
        </li>
      </ol>
      {!company.canExpand && p.stagesDone >= company.stages.length && (
        <p className="text-xs text-pretty text-fg-3">{t("needsForm")}</p>
      )}
      {/* The two parts sit flat inside this card instead of as cards of their own. */}
      <div className="grid items-start gap-4 *:min-w-0 lg:grid-cols-2 [&>*>*]:border-0 [&>*>*]:bg-transparent [&>*>*]:p-0 [&>*>*]:shadow-none">
        <div>
          <GrowthPath company={company} onFill={onFill} onTrain={onTrain} />
        </div>
        <div>
          <ExpansionCard company={company} />
        </div>
      </div>
    </Card>
  );
}
