"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { burstConfetti } from "@/components/ui/effects";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { CareerTier, MyJob, PromotionRequirementInfo } from "@/features/game/types";
import { formatBps, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, SPRING, STAGGER } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useCareerRefresh } from "../hooks";

type BranchKey = Parameters<ReturnType<typeof useTranslations<"skills.branches">>>[0];

const TIERS = BALANCE.careers.tiers;
const time = new Intl.DateTimeFormat("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" });

function useBranchName() {
  const tb = useTranslations("skills.branches");
  return (branch: string | null) => (branch ? tb(`${branch}.name` as BranchKey) : "");
}

/**
 * The career ladder (ADR-094): all ranks as rungs, the player on the current one. The next rank lists every
 * requirement with its progress and how to get there; once all are met, the boss can be asked.
 */
export function CareerLadder({ job }: { job: MyJob }) {
  const t = useTranslations("ladder");
  const tc = useTranslations("careerTiers");
  const reduced = useReducedMotion();
  const current = TIERS.findIndex((tier) => tier.id === job.tier);
  const promotion = job.promotion;

  return (
    <Card padding="lg" className="space-y-5" data-testid="career-ladder" data-tier={job.tier}>
      <div>
        <h2 className="label-pixel text-fg-2">{t("title")}</h2>
        <p className="mt-1 text-sm text-pretty text-fg-2">{promotion?.nextTier ? t("intro") : t("top")}</p>
      </div>

      <ol className="flex flex-col-reverse" aria-label={t("title")}>
        {TIERS.map((tier, i) => {
          const done = i < current;
          const here = i === current;
          const next = i === current + 1;
          return (
            <motion.li
              key={tier.id}
              initial={reduced ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...SPRING.smooth, delay: reduced ? 0 : i * STAGGER }}
              className="flex items-stretch gap-3"
              data-rung={tier.id}
              data-state={here ? "current" : done ? "done" : next ? "next" : "later"}
            >
              {/* Two rails and a rung: the rows stack without gaps, so the rails run through. */}
              <span aria-hidden className="relative w-10 shrink-0 border-x-4 border-line-2">
                <span
                  className={cn(
                    "absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2",
                    here ? "bg-accent" : done ? "bg-gain" : "bg-line-2",
                  )}
                />
                {here && (
                  <span className="absolute -top-1 left-1/2 -translate-x-1/2 text-accent">
                    <PixelIcon {...UI_ICONS.profile} scale={2} />
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "my-1 flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-3 py-2",
                  here ? "bg-accent-soft" : next ? "bg-surface-2" : "",
                )}
              >
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate text-sm font-medium",
                      here ? "text-accent" : done ? "text-fg-2" : "text-fg-1",
                    )}
                  >
                    {tc(tier.id)}
                  </span>
                  {(here || next) && <span className="label-pixel text-fg-3">{here ? t("you") : t("next")}</span>}
                </span>
                <span className="shrink-0 nums text-xs text-fg-3">
                  {formatMoney(tier.salaryCentsPerHour, { whole: true })}/h
                </span>
              </span>
            </motion.li>
          );
        })}
      </ol>

      {promotion?.nextTier && <NextRank job={job} next={promotion.nextTier} />}
    </Card>
  );
}

function NextRank({ job, next }: { job: MyJob; next: CareerTier }) {
  const t = useTranslations("ladder");
  const tc = useTranslations("careerTiers");
  const branchName = useBranchName();
  const errorText = useGameErrorText();
  const refresh = useCareerRefresh();
  const now = useClock();
  const [state, setState] = useState<ButtonState>("idle");
  const button = useRef<HTMLDivElement>(null);
  const promotion = job.promotion!;
  const main = branchName(promotion.mainBranch);
  const waiting = promotion.retryAt !== null && now !== null && Date.parse(promotion.retryAt) > now;
  const pending = promotion.pendingSince !== null;
  const canAsk = promotion.ready && !waiting && !pending;

  const ask = async () => {
    setState("loading");
    try {
      const result = await engine.requestPromotion(crypto.randomUUID());
      if (result.status === "promoted") {
        setState("success");
        void playSound("levelUp");
        haptic("success");
        if (button.current) burstConfetti(button.current);
        toast.success(
          t("promoted"),
          t("promotedText", { tier: tc(result.tier), amount: formatMoney(result.salaryCentsPerHour) }),
          { silent: true },
        );
      } else if (result.status === "pending") {
        setState("success");
        toast.success(t("pendingToast"), t("pendingText"));
      } else {
        setState("idle");
        haptic("error");
        toast.info(t("declined"), t("declinedText", { branch: main }));
      }
      await refresh();
      setState("idle");
    } catch (error) {
      setState("idle");
      toast.error(t("ask"), errorText(error));
    }
  };

  return (
    <section
      className="space-y-4 rounded-lg bg-surface-2 p-3 sm:p-4"
      data-testid="next-rank"
      data-ready={promotion.ready}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-fg-1">
          {t("next")}: {tc(next)}
        </p>
        {promotion.nextSalaryCentsPerHour !== null && (
          <p className="nums text-sm text-gain">
            {t("wageAfter", { amount: formatMoney(promotion.nextSalaryCentsPerHour, { whole: true }) })}
          </p>
        )}
      </div>

      <ul className="space-y-3">
        {promotion.requirements.map((req) => (
          <Requirement key={req.key} req={req} cap={job.paidHoursCap} />
        ))}
      </ul>

      {promotion.boss === "ai" && promotion.ready && promotion.chanceBps !== null && (
        <div data-testid="promotion-chance">
          <div className="mb-1.5 flex justify-between text-sm">
            <span className="text-fg-2">{t("chance", { percent: formatBps(promotion.chanceBps) })}</span>
          </div>
          <Progress
            value={promotion.chanceBps / 10_000}
            label={t("chance", { percent: formatBps(promotion.chanceBps) })}
          />
          <p className="mt-1.5 text-xs text-pretty text-fg-3">
            {t("chanceHint", { branch: main })}{" "}
            <Link href="/upgrades" className="text-accent focus-ring hover:underline">
              {t("rhetoric")}
            </Link>
          </p>
        </div>
      )}
      {promotion.boss === "player" && <p className="text-xs text-pretty text-fg-3">{t("playerBoss")}</p>}

      {waiting ? (
        <p className="text-sm text-warn" data-testid="promotion-retry">
          {t("retry", { time: time.format(new Date(promotion.retryAt!)) })}
        </p>
      ) : pending ? (
        <p className="text-sm text-info" data-testid="promotion-pending">
          {t("pending")}
        </p>
      ) : null}
      <div ref={button}>
        <Button block state={state} disabled={!canAsk} onClick={() => void ask()} data-testid="ask-promotion">
          {promotion.ready ? t("ask") : t("notReady")}
        </Button>
      </div>
    </section>
  );
}

function Requirement({ req, cap }: { req: PromotionRequirementInfo; cap: number }) {
  const t = useTranslations("ladder");
  const branchName = useBranchName();
  const label =
    req.key === "level"
      ? t("req.level", { need: req.need })
      : req.key === "hours"
        ? t("req.hours", { need: req.need })
        : req.key === "management"
          ? t("req.management", { need: req.need })
          : t("req.branch", { branch: branchName(req.branch), need: req.need });
  const how =
    req.key === "level"
      ? t("how.level")
      : req.key === "hours"
        ? t("how.hours", { cap })
        : req.key === "management"
          ? t("how.management")
          : t("how.branch", { branch: branchName(req.branch) });
  const ratio = req.need > 0 ? Math.min(1, req.have / req.need) : 1;

  return (
    <li className="flex gap-3" data-requirement={req.key} data-met={req.met}>
      <motion.span
        aria-hidden
        initial={false}
        animate={{ scale: req.met ? [1.3, 1] : 1 }}
        transition={{ duration: DURATION.base }}
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-xs border-2 text-xs font-bold",
          req.met ? "border-gain bg-gain text-on-semantic" : "border-line-2 text-fg-3",
        )}
      >
        {req.met ? "✓" : ""}
      </motion.span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className={req.met ? "text-fg-2" : "font-medium text-fg-1"}>{label}</span>
          <span className="shrink-0 nums text-xs text-fg-3">{t("have", { have: req.have, need: req.need })}</span>
        </div>
        {!req.met && (
          <>
            <Progress value={ratio} label={label} size="sm" tone="warn" className="mt-1.5" />
            <p className="mt-1 text-xs text-pretty text-fg-3">
              {how}
              {(req.key === "branch" || req.key === "management") && (
                <>
                  {" "}
                  <Link href="/career/skills" className="text-accent focus-ring hover:underline">
                    {t("toSkills")}
                  </Link>
                </>
              )}
            </p>
          </>
        )}
      </div>
    </li>
  );
}

/** "So steigt dein Gehalt": the ways to earn more in a job, in one card. */
export function PayRoutes({ job }: { job: MyJob }) {
  const t = useTranslations("payRoutes");
  const routes: { key: "promotion" | "raise" | "bonus" | "tasks"; art: PixelArt }[] = [
    { key: "promotion", art: UI_ICONS.star },
    { key: "raise", art: UI_ICONS.upgrade },
    ...(job.company.isAi ? [] : [{ key: "bonus" as const, art: UI_ICONS.gift }]),
    { key: "tasks", art: UI_ICONS.briefcase },
  ];
  return (
    <Card padding="lg" className="space-y-3" data-testid="pay-routes">
      <h2 className="label-pixel text-fg-2">{t("title")}</h2>
      <ul className="space-y-3">
        {routes.map((r) => (
          <li key={r.key} className="flex gap-3">
            <span className="mt-0.5 shrink-0 text-accent" aria-hidden>
              <PixelIcon {...r.art} scale={2} />
            </span>
            <div>
              <p className="text-sm font-medium text-fg-1">{t(`${r.key}.title`)}</p>
              <p className="text-sm text-pretty text-fg-2">{t(`${r.key}.text`)}</p>
            </div>
          </li>
        ))}
        <li className="flex gap-3">
          <span className="mt-0.5 shrink-0 text-accent" aria-hidden>
            <PixelIcon {...UI_ICONS.upgrade} scale={2} />
          </span>
          <div>
            <p className="text-sm font-medium text-fg-1">{t("overtime.title")}</p>
            <p className="text-sm text-pretty text-fg-2">
              {t("overtime.text")}{" "}
              <Link href="/upgrades" className="text-accent focus-ring hover:underline">
                {t("overtime.link")}
              </Link>
            </p>
          </div>
        </li>
      </ul>
    </Card>
  );
}
