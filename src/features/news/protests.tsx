"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { Protest, ProtestKind } from "@/features/game/types";
import { formatBps, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

const cfg = BALANCE.protests;
export const PROTESTS_KEY = ["protests"] as const;
const STATUS_TONE = { open: "accent", hit: "loss", fizzled: "neutral", expired: "neutral" } as const;

export function useProtests() {
  return useQuery({ queryKey: PROTESTS_KEY, queryFn: () => engine.protests(), refetchInterval: 30_000 });
}

/** Protest campaigns (ADR-133): running ones to join, and how the last ones ended. */
export function ProtestsCard() {
  const t = useTranslations("protests");
  const query = useProtests();
  if (!query.data) return <Skeleton className="h-32 w-full rounded-lg" />;
  const list = query.data.protests;
  return (
    <Card padding="lg" className="space-y-3" data-testid="protests">
      <div>
        <p className="label-pixel text-fg-2">{t("title")}</p>
        <p className="mt-1 text-xs text-pretty text-fg-3">{t("intro")}</p>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-fg-3">
          {t("empty")} {t("emptyText")}
        </p>
      ) : (
        <ul className="space-y-2">
          {list.slice(0, 6).map((p) => (
            <ProtestRow key={p.id} protest={p} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProtestRow({ protest }: { protest: Protest }) {
  const t = useTranslations("protests");
  const client = useQueryClient();
  const errorText = useGameErrorText();
  const [state, setState] = useState<ButtonState>("idle");
  const total = protest.players + protest.aiSupporters;
  const open = protest.status === "open";

  const join = async () => {
    setState("loading");
    try {
      client.setQueryData(PROTESTS_KEY, await engine.joinProtest(crypto.randomUUID(), protest.id));
      haptic("success");
      toast.success(t("joinedToast"), t(`kinds.${protest.kind}`), { silent: true });
      setState("success");
    } catch (error) {
      toast.error(t("join"), errorText(error));
      setState("idle");
    }
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING.smooth}
      className={cn("space-y-2 rounded-md border px-3 py-2.5", protest.againstMe ? "border-loss" : "border-line-1")}
      data-protest={protest.status}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_TONE[protest.status]}>{t(`status.${protest.status}`)}</Badge>
        {protest.againstMe && <Badge tone="loss">{t("againstYou")}</Badge>}
        {open && (
          <span className="ml-auto text-2xs text-fg-3">
            {t("endsIn")} <Countdown target={Date.parse(protest.endsAt)} />
          </span>
        )}
      </div>
      <p className="text-sm font-semibold text-pretty text-fg-1">
        {t(`kinds.${protest.kind}`)} {t("against", { company: protest.company })}
      </p>
      <div className="h-1.5 overflow-hidden rounded-pill bg-surface-3" aria-hidden>
        <div
          className="h-full origin-left rounded-pill bg-accent transition-transform duration-slow ease-standard"
          style={{ transform: `scaleX(${Math.min(1, total / protest.goal)})` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-fg-3">
        <span className="nums">
          {t("supporters", { count: total, goal: protest.goal })} ·{" "}
          {t("players", { players: protest.players, ai: protest.aiSupporters })}
        </span>
        {protest.status === "hit" && protest.effectBps !== null && (
          <span className="nums text-loss">{t("hit", { bps: formatBps(protest.effectBps).replace("+", "") })}</span>
        )}
      </div>
      {open && !protest.againstMe && (
        <Button
          size="sm"
          variant={protest.joined ? "secondary" : "primary"}
          state={state}
          disabled={protest.joined}
          onClick={() => void join()}
        >
          {protest.joined ? t("joined") : t("join")}
        </Button>
      )}
    </motion.li>
  );
}

/** Start a campaign against a company (from its profile). */
export function StartProtestButton({ companyId, companyName }: { companyId: string; companyName: string }) {
  const t = useTranslations("protests");
  const client = useQueryClient();
  const errorText = useGameErrorText();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ProtestKind | null>(null);

  const start = async (kind: ProtestKind) => {
    setBusy(kind);
    try {
      client.setQueryData(PROTESTS_KEY, await engine.startProtest(crypto.randomUUID(), companyId, kind));
      haptic("success");
      toast.success(t("started"), t("startedText"), { silent: true });
      setOpen(false);
    } catch (error) {
      toast.error(t("start"), errorText(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="start-protest">
        {t("start")}
      </Button>
      {open && (
        <Sheet
          open
          onOpenChange={(o) => !o && setOpen(false)}
          title={t("startTitle", { company: companyName })}
          description={t("startIntro", {
            amount: formatMoney(cfg.startCostCents, { whole: true }),
            goal: cfg.goal,
          })}
        >
          <div className="grid gap-2 px-5 pb-5 sm:grid-cols-2">
            {cfg.kinds.map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={busy !== null}
                onClick={() => void start(kind)}
                className="rounded-md border border-line-1 px-3 py-3 text-left focus-ring transition-colors duration-fast hover:bg-surface-2 disabled:opacity-60"
              >
                <span className="block text-sm font-semibold text-fg-1">{t(`kinds.${kind}`)}</span>
                <span className="block text-xs text-pretty text-fg-3">{t(`kindHints.${kind}`)}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
