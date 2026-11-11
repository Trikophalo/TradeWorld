"use client";

import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BALANCE } from "@/config/balance";
import type { MyCompany } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { useProductText } from "../product-name";

type Seat = MyCompany["stages"][number]["skills"][number];

/**
 * Growth path of the product (ADR-062, ADR-071): every stage needs specialists. A seat is filled by a team member
 * with the skill, by an AI worker hired for it, or still open, with a button to fill it.
 */
export function GrowthPath({
  company,
  onFill,
  onTrain,
}: {
  company: MyCompany;
  /** Open the hiring form for these skills. */
  onFill: (skills: string[]) => void;
  /** Present only once trainings are unlocked. */
  onTrain?: () => void;
}) {
  const t = useTranslations("firm");
  const tn = useTranslations("skills.nodes");
  const product = useProductText();
  const name = (key: string) => tn(`${key}.name` as Parameters<typeof tn>[0]);
  const next = company.stages.find((st) => !st.reached);
  const missing = next?.skills.filter((s) => !s.coveredBy && !s.coveredByAi).map((s) => s.key) ?? [];
  const caps = BALANCE.startups.stages.awarenessCaps;
  const reach = Math.round((caps[company.stage] ?? 1) * 100);

  return (
    <Card padding="lg" className="space-y-5" data-testid="growth" data-tour="growth">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-pixel text-fg-2">{t("growthTitle")}</p>
          <p className="mt-1 text-lg font-semibold text-fg-1">{product.name(company.productKey)}</p>
        </div>
        <div className="rounded-md bg-surface-2 px-3 py-1.5 text-right">
          <p className="nums text-sm font-semibold text-fg-1">
            {t("stageOf", { stage: company.stage, total: company.stages.length })}
          </p>
          <p className="text-xs text-fg-3">{t("stageReach", { percent: reach })}</p>
        </div>
      </div>

      <ol className="relative space-y-1">
        {company.stages.map((st, i) => {
          const current = st === next;
          const last = i === company.stages.length - 1;
          return (
            <li key={st.stage} className="relative flex gap-4 pb-4">
              {!last && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-8 bottom-0 left-[15px] w-0.5 rounded-pill",
                    st.reached ? "bg-gain" : "bg-line-2",
                  )}
                />
              )}
              <span
                aria-hidden
                className={cn(
                  "relative z-1 grid size-8 shrink-0 place-items-center rounded-pill font-pixel text-xs",
                  st.reached
                    ? "bg-gain text-on-accent"
                    : current
                      ? "bg-accent-soft text-accent ring-2 ring-accent"
                      : "bg-surface-2 text-fg-3 ring-1 ring-line-2",
                )}
              >
                {st.reached ? "✓" : st.stage}
                {current && (
                  <span className="absolute inset-0 rounded-pill ring-2 ring-accent motion-safe:animate-ping motion-safe:opacity-40" />
                )}
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={cn("label-pixel", st.reached ? "text-gain" : current ? "text-fg-1" : "text-fg-3")}>
                    {t("stageN", { stage: st.stage })}
                  </p>
                  {st.reached && <span className="text-xs text-gain">{t("stageReached")}</span>}
                </div>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {st.skills.map((s) => (
                    <li key={s.key}>
                      <SeatChip seat={s} name={name(s.key)} onFill={() => onFill([s.key])} />
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>

      {next ? (
        <div className="space-y-3 rounded-md border border-accent/40 bg-accent-soft px-4 py-3">
          <p className="text-sm text-pretty text-fg-1">
            {missing.length > 0 ? t("nextStep", { skills: missing.map(name).join(", ") }) : t("nextStepSoon")}
          </p>
          {missing.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onFill(missing)}>
                {t("hireFor")}
              </Button>
              {onTrain && (
                <Button size="sm" variant="secondary" onClick={onTrain}>
                  {t("trainFor")}
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-md bg-gain-soft px-4 py-3 text-sm text-gain">{t("allStages")}</p>
      )}
    </Card>
  );
}

function SeatChip({ seat, name, onFill }: { seat: Seat; name: string; onFill: () => void }) {
  const t = useTranslations("firm");
  if (seat.coveredBy) {
    return (
      <span className="inline-flex items-center gap-2 rounded-md border border-gain/40 bg-gain-soft px-2.5 py-1.5 text-sm">
        <span className="size-2 rounded-pill bg-gain" aria-hidden />
        <span className="text-fg-1">{name}</span>
        <span className="text-xs text-gain">{seat.coveredBy}</span>
      </span>
    );
  }
  if (seat.coveredByAi) {
    return (
      <span
        className="inline-flex items-center gap-2 rounded-md border border-info/40 bg-info-soft px-2.5 py-1.5 text-sm"
        data-testid="seat-ai"
      >
        <PixelIcon {...UI_ICONS.robot} scale={1} className="text-info" />
        <span className="text-fg-1">{name}</span>
        <span className="text-xs text-info">{t("coveredByAi")}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        haptic("tap");
        onFill();
      }}
      className="inline-flex items-center gap-2 rounded-md border border-dashed border-line-2 px-2.5 py-1.5 text-sm text-fg-2 focus-ring transition duration-fast hover:-translate-y-0.5 hover:border-accent hover:text-fg-1 active:translate-y-0 active:scale-95"
    >
      <span className="text-accent">+</span>
      <span>{name}</span>
      <span className="text-xs text-fg-3">{t("missing")}</span>
    </button>
  );
}
