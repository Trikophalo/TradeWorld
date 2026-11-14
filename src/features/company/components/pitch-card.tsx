"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { CompanyPitch, CompanyPitches, PitchKind, PitchMoveKind } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useCompanyRefresh } from "../hooks";

const cfg = BALANCE.pitches;
export const PITCHES_KEY = ["company", "pitches"] as const;
const GOALS: readonly PitchMoveKind[] = ["cash", "awareness", "quality"];
const STATUS_TONE = { success: "gain", failure: "neutral", backfire: "loss" } as const;

export function useCompanyPitches(enabled = true) {
  return useQuery({
    queryKey: PITCHES_KEY,
    queryFn: () => engine.companyPitches(),
    // while a pitch waits for its judgment, ask more often
    refetchInterval: (q) =>
      (q.state.data as CompanyPitches | undefined)?.pitches.some((p) => p.status === "judging") ? 5_000 : 20_000,
    enabled,
  });
}

/** Ask Claude to judge right away (live only); without a key the Mini-KI judges after a short wait. */
function askJudge(pitchId: number, onDone: () => void) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;
  void supabase.functions
    .invoke<{ ok?: boolean }>("strategy-judge", { body: { pitch_id: pitchId } })
    .then(onDone)
    .catch(() => undefined);
}

/**
 * Own strategy (ADR-132): the founder writes how the company reacts to a crisis or chance, or invents an own
 * business move. Claude (or the Mini-KI) judges the fit and the risk; the roll decides after a few minutes.
 */
export function PitchCard({ kind }: { kind: PitchKind }) {
  const t = useTranslations("pitches");
  const query = useCompanyPitches();
  const client = useQueryClient();
  const refresh = useCompanyRefresh();
  const errorText = useGameErrorText();
  const [text, setText] = useState("");
  const [goal, setGoal] = useState<PitchMoveKind>("cash");
  const [state, setState] = useState<ButtonState>("idle");
  const data = query.data;
  if (!data) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (kind === "event" && !data.eventId) return null;

  const mine = data.pitches.filter((p) => p.kind === kind && (kind === "move" || p.eventId === data.eventId));
  const busy = mine.some((p) => p.status === "judging" || p.status === "running");
  const cost = kind === "event" ? data.eventCostCents : data.moveCostCents;
  const length = text.trim().length;

  const submit = async () => {
    setState("loading");
    try {
      const next = await engine.submitCompanyPitch(
        crypto.randomUUID(),
        kind,
        text.trim(),
        kind === "move" ? goal : null,
      );
      client.setQueryData(PITCHES_KEY, next);
      const fresh = next.pitches.find((p) => p.status === "judging");
      if (fresh) askJudge(fresh.id, () => void client.invalidateQueries({ queryKey: PITCHES_KEY }));
      haptic("success");
      toast.success(t("submitted"), t("submittedText"), { silent: true });
      setText("");
      setState("success");
      void refresh();
    } catch (error) {
      toast.error(kind === "event" ? t("eventTitle") : t("moveTitle"), errorText(error));
      setState("idle");
    }
  };

  return (
    <Card padding="lg" className="space-y-3" data-testid={`pitch-${kind}`}>
      <div>
        <p className="label-pixel text-fg-2">{kind === "event" ? t("eventTitle") : t("moveTitle")}</p>
        <p className="mt-1 text-xs text-pretty text-fg-3">{kind === "event" ? t("eventIntro") : t("moveIntro")}</p>
      </div>
      {!busy && (
        <div className="space-y-2">
          {kind === "move" && (
            <Segmented
              value={goal}
              onValueChange={setGoal}
              options={GOALS.map((g) => ({ value: g, label: t(`goals.${g}`) }))}
              label={t("goal")}
              block
            />
          )}
          <label className="block space-y-1">
            <span className="sr-only">{t("label")}</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, cfg.maxChars))}
              rows={3}
              maxLength={cfg.maxChars}
              placeholder={kind === "event" ? t("placeholderEvent") : t("placeholderMove")}
              aria-label={t("label")}
              className="w-full resize-none rounded-md border-2 border-line-2 bg-surface-1 px-3 py-2 text-sm text-fg-1 focus-ring placeholder:text-fg-3"
            />
          </label>
          <div className="flex items-center justify-between gap-2 text-2xs text-fg-3">
            <span className="nums">{t("chars", { count: length, max: cfg.maxChars })}</span>
            <span className="nums">{t("cost", { amount: formatMoney(cost, { whole: true }) })}</span>
          </div>
          <Button block state={state} disabled={length < cfg.minChars} onClick={() => void submit()}>
            {t("submit")}
          </Button>
        </div>
      )}
      {mine.length > 0 && (
        <ul className="space-y-2">
          {mine.slice(0, 3).map((p) => (
            <PitchRow key={p.id} pitch={p} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function PitchRow({ pitch }: { pitch: CompanyPitch }) {
  const t = useTranslations("pitches");
  const done = pitch.status === "success" || pitch.status === "failure" || pitch.status === "backfire";
  const outcome =
    pitch.status === "success"
      ? pitch.successText
      : pitch.status === "backfire"
        ? pitch.backfireText
        : pitch.failureText;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING.smooth}
      className={cn(
        "space-y-1.5 rounded-md border px-3 py-2.5",
        done ? "border-line-1" : "border-accent bg-accent-soft",
      )}
      data-pitch-status={pitch.status}
    >
      <p className="text-xs text-pretty text-fg-2 italic">{t("yourIdea", { text: pitch.text })}</p>
      {pitch.status === "judging" ? (
        <div className="space-y-1" aria-live="polite">
          <p className="text-sm font-semibold text-fg-1">{t("judging")}</p>
          <p className="text-2xs text-fg-3">{t("judgingHint")}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="info">{pitch.judge === "claude" ? t("byClaude") : t("byMini")}</Badge>
            {pitch.chanceBps !== null && (
              <Badge tone="accent">{t("chance", { percent: Math.round(pitch.chanceBps / 100) })}</Badge>
            )}
            {done && (
              <Badge tone={STATUS_TONE[pitch.status as keyof typeof STATUS_TONE]}>
                {t(`status.${pitch.status as keyof typeof STATUS_TONE}`)}
              </Badge>
            )}
          </div>
          {pitch.verdict && <p className="text-sm text-pretty text-fg-1">{pitch.verdict}</p>}
          {!done && pitch.backfire !== null && (
            <p className="text-2xs text-warn">{t("risk", { percent: pitch.backfire })}</p>
          )}
          {!done && pitch.endsAt && (
            <p className="text-2xs text-fg-3">
              {t("decidedIn")} <Countdown target={Date.parse(pitch.endsAt)} />
            </p>
          )}
          {done && outcome && (
            <p
              className={cn(
                "text-sm font-semibold text-pretty",
                pitch.status === "success" ? "text-gain" : pitch.status === "backfire" ? "text-loss" : "text-fg-2",
              )}
            >
              {outcome}
            </p>
          )}
        </>
      )}
    </motion.li>
  );
}
