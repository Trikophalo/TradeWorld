"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { CompanyInterview, CompanyInterviewState, InterviewAnswer } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { interviewPercent } from "@/lib/sim/interviews";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { ServerCountdown } from "../listed/shared";

export const INTERVIEW_KEY = ["company", "interview"] as const;

/**
 * CEO interviews (ADR-173): the request of NEXA Nachrichten on the dashboard, with its expiry. The founder answers
 * the three questions in free text or with a quick answer, or says "kein Kommentar"; the result airs in the next show.
 * Hidden while there is no interview.
 */
export function InterviewCard() {
  const query = useQuery({
    queryKey: INTERVIEW_KEY,
    queryFn: () => engine.companyInterview(),
    refetchInterval: 60_000,
  });
  if (query.isPending) return <Skeleton className="h-28 w-full rounded-md" aria-hidden />;
  const iv = query.data?.interview;
  if (!iv) return null;
  return iv.status === "requested" ? (
    <InterviewRequest interview={iv} maxChars={query.data!.maxChars} />
  ) : (
    <InterviewResult interview={iv} />
  );
}

function InterviewRequest({ interview, maxChars }: { interview: CompanyInterview; maxChars: number }) {
  const t = useTranslations("companyInterview");
  const errorText = useGameErrorText();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<InterviewAnswer[]>(() => interview.questions.map(() => ({ text: "" })));
  const [state, setState] = useState<ButtonState>("idle");
  const [declining, setDeclining] = useState<ButtonState>("idle");

  const done = (next: CompanyInterviewState) => {
    client.setQueryData(INTERVIEW_KEY, next);
    haptic("success");
    void playSound("success");
  };
  const fail = (error: unknown) => {
    haptic("error");
    toast.error(t("failed"), errorText(error));
  };
  const submit = async () => {
    setState("loading");
    try {
      done(await engine.answerCompanyInterview(crypto.randomUUID(), interview.id, answers));
      toast.success(t("sent"), t("sentText"), { silent: true });
      setState("success");
    } catch (error) {
      fail(error);
      setState("idle");
    }
  };
  const decline = async () => {
    setDeclining("loading");
    try {
      done(await engine.declineCompanyInterview(crypto.randomUUID(), interview.id));
      setDeclining("success");
    } catch (error) {
      fail(error);
      setDeclining("idle");
    }
  };
  const set = (k: number, a: InterviewAnswer) => setAnswers((list) => list.map((x, i) => (i === k ? a : x)));
  const ready = answers.every((a) => a.quick !== undefined || (a.text ?? "").trim().length >= 2);

  return (
    <Card padding="lg" className="space-y-4 border-accent" data-testid="interview-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-pixel text-accent">{t("title")}</p>
          <p className="mt-1 text-sm text-pretty text-fg-2">{t("intro", { company: interview.company })}</p>
        </div>
        <Badge tone="warn">
          {t("expires")} <ServerCountdown at={interview.expiresAt} />
        </Badge>
      </div>
      {!open ? (
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => setOpen(true)} data-testid="interview-open">
            {t("accept")}
          </Button>
          <Button variant="secondary" state={declining} onClick={decline} data-testid="interview-decline">
            {t("decline")}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {interview.questions.map((q, k) => {
            const a = answers[k] ?? {};
            return (
              <fieldset key={k} className="space-y-2" data-testid="interview-question">
                <legend className="text-sm font-semibold text-pretty text-fg-1">
                  {t("question", { n: k + 1 })} {q.text}
                </legend>
                <div className="flex flex-wrap gap-1.5">
                  {q.quick.map((text, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={a.quick === i}
                      onClick={() => set(k, a.quick === i ? { text: "" } : { quick: i })}
                      className={cn(
                        "rounded-md border-2 px-2.5 py-1.5 text-left text-xs focus-ring transition-colors duration-fast",
                        a.quick === i
                          ? "border-accent bg-accent-soft text-fg-1"
                          : "border-line-1 bg-surface-2 text-fg-2 hover:bg-surface-3",
                      )}
                      data-testid="interview-quick"
                    >
                      {text}
                    </button>
                  ))}
                </div>
                <label className="block space-y-1">
                  <span className="sr-only">{t("ownAnswer")}</span>
                  <textarea
                    value={a.quick !== undefined ? "" : (a.text ?? "")}
                    maxLength={maxChars}
                    rows={2}
                    placeholder={t("ownAnswer")}
                    onChange={(e) => set(k, { text: e.target.value })}
                    className="w-full rounded-md border-2 border-line-2 bg-surface-1 px-3 py-2 text-sm text-fg-1 focus-ring"
                    data-testid="interview-text"
                  />
                  <span className="block text-right nums text-2xs text-fg-3">
                    {(a.text ?? "").length}/{maxChars}
                  </span>
                </label>
              </fieldset>
            );
          })}
          <Button block state={state} disabled={!ready} onClick={submit} data-testid="interview-submit">
            {t("submit")}
          </Button>
        </div>
      )}
    </Card>
  );
}

function InterviewResult({ interview }: { interview: CompanyInterview }) {
  const t = useTranslations("companyInterview");
  const tone = interview.awarenessBps > 0 ? "gain" : interview.awarenessBps < 0 ? "loss" : "neutral";
  return (
    <Card padding="lg" className="space-y-3" data-testid="interview-result">
      <div className="flex items-start justify-between gap-3">
        <p className="label-pixel text-fg-2">{t(`status.${interview.status}`)}</p>
        <Badge tone={tone}>{t("effect", { value: interviewPercent(interview.awarenessBps) })}</Badge>
      </div>
      <p className="text-xs text-pretty text-fg-3">{interview.airedAt ? t("aired") : t("airsNext")}</p>
      {interview.answers && (
        <ul className="space-y-2">
          {interview.answers.map((a, k) => (
            <li key={k} className="space-y-0.5 text-xs">
              <p className="text-fg-3">{interview.questions[k]?.text}</p>
              <p className="text-fg-1">»{a.text || "…"}«</p>
              <p className="text-fg-2 italic">{a.reaction}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
