"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
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
import type { CompanyMoveOption, CompanyMoves } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useCompanyRefresh } from "../hooks";

type Filter = "all" | CompanyMoveOption["kind"];
const FILTERS: readonly Filter[] = ["all", "cash", "awareness", "quality"];
const RISK_TONE = { safe: "gain", normal: "info", risky: "warn" } as const;

const OWN_MOVES = new Set(BALANCE.companyMoves.moves.filter((m) => m.product !== "*").map((m) => m.key));

/** The product's own moves first: they are what makes this company different. */
function sortMoves(moves: readonly CompanyMoveOption[]) {
  return [...moves].sort((a, b) => Number(OWN_MOVES.has(b.key)) - Number(OWN_MOVES.has(a.key)));
}

export const COMPANY_MOVES_KEY = ["company", "moves"] as const;

/**
 * Business moves (ADR-127): the founder picks moves that fit the product, pays from the company cash and gets
 * the result a few minutes later. The team's know-how in the move's area raises the chance.
 */
export function CompanyMovesCard({ preview }: { preview?: CompanyMoves } = {}) {
  const t = useTranslations("companyMoves");
  const live = useQuery({
    queryKey: COMPANY_MOVES_KEY,
    queryFn: () => engine.companyMoves(),
    refetchInterval: 20_000,
    enabled: !preview,
  });
  const query = preview ? { data: preview } : live;
  const [filter, setFilter] = useState<Filter>("all");

  return (
    <Card padding="lg" className="space-y-4" data-testid="company-moves" data-tour="company-moves">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-pixel text-fg-2">{t("title")}</p>
          <p className="mt-1 text-sm text-pretty text-fg-3">{t("intro")}</p>
        </div>
        {query.data && <SlotDots used={query.data.used} slots={query.data.slots} />}
      </div>

      {!query.data ? (
        <div className="space-y-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-md" />
          ))}
        </div>
      ) : (
        <>
          {query.data.running.length > 0 && <RunningList data={query.data} />}
          <Segmented
            value={filter}
            onValueChange={setFilter}
            options={FILTERS.map((f) => ({ value: f, label: f === "all" ? t("all") : t(`kinds.${f}`) }))}
            label={t("title")}
            block
          />
          <ul className="space-y-2.5">
            {sortMoves(query.data.moves)
              .filter((m) => filter === "all" || m.kind === filter)
              .map((move) => (
                <MoveRow key={move.key} move={move} data={query.data} />
              ))}
          </ul>
          {query.data.history.length > 0 && <HistoryList data={query.data} />}
        </>
      )}
    </Card>
  );
}

function SlotDots({ used, slots }: { used: number; slots: number }) {
  const t = useTranslations("companyMoves");
  return (
    <div className="shrink-0 text-right">
      <div className="flex justify-end gap-1" aria-hidden>
        {Array.from({ length: slots }, (_, i) => (
          <span key={i} className={cn("size-2.5 rounded-xs", i < used ? "bg-accent" : "bg-surface-3")} />
        ))}
      </div>
      <p className="mt-1 nums text-2xs text-fg-3">{t("slots", { used, slots })}</p>
    </div>
  );
}

type MovesT = ReturnType<typeof useTranslations<"companyMoves">>;

/** Move names live under `companyMoves.items.<key>`; the key comes from the server, so it is a plain string. */
function moveText(t: MovesT, key: string, field: "name" | "desc") {
  return t(`items.${key}.${field}` as Parameters<MovesT>[0]);
}

function reward(t: MovesT, move: CompanyMoveOption) {
  if (move.kind === "cash") return t("rewardCash", { amount: formatMoney(move.payoutCents, { whole: true }) });
  const points = Math.round(move.gain * 100);
  return move.kind === "awareness" ? t("rewardAwareness", { points }) : t("rewardQuality", { points });
}

function MoveRow({ move, data }: { move: CompanyMoveOption; data: CompanyMoves }) {
  const t = useTranslations("companyMoves");
  const tb = useTranslations("skills.branches");
  const now = useClock();
  const client = useQueryClient();
  const refresh = useCompanyRefresh();
  const errorText = useGameErrorText();
  const [state, setState] = useState<ButtonState>("idle");

  const restingUntil = move.availableAt ? Date.parse(move.availableAt) : null;
  const resting = restingUntil !== null && now !== null && restingUntil > now;
  const busy = data.running.some((r) => r.key === move.key);
  const noSlot = data.used >= data.slots;
  const noCash = data.cashCents < move.costCents;
  const blocked = busy || resting || noSlot || noCash;
  const name = moveText(t, move.key, "name");

  const start = async () => {
    setState("loading");
    try {
      const next = await engine.startCompanyMove(crypto.randomUUID(), move.key);
      client.setQueryData(COMPANY_MOVES_KEY, next);
      haptic("success");
      void playSound("success");
      toast.success(t("started"), t("startedText", { name, minutes: move.minutes }), { silent: true });
      setState("success");
      void refresh();
    } catch (error) {
      toast.error(name, errorText(error));
      setState("idle");
    }
  };

  return (
    <li
      className={cn(
        "rounded-md border border-line-1 bg-surface-1 p-3 transition-opacity duration-fast",
        blocked && state === "idle" && "opacity-80",
      )}
      data-testid={`move-${move.key}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={RISK_TONE[move.risk]}>{t(`risk.${move.risk}`)}</Badge>
        <Badge>{tb(`${move.branch}.name` as Parameters<typeof tb>[0])}</Badge>
        <span className="ml-auto nums text-2xs text-fg-3">{t("duration", { minutes: move.minutes })}</span>
      </div>
      <p className="mt-2 text-sm font-semibold text-fg-1">{name}</p>
      <p className="mt-0.5 text-xs text-pretty text-fg-3">{moveText(t, move.key, "desc")}</p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-sm bg-surface-2 px-2 py-1.5">
          <dt className="text-2xs text-fg-3">{t("cost")}</dt>
          <dd className="nums font-semibold text-fg-1">{formatMoney(move.costCents, { whole: true })}</dd>
        </div>
        <div className="rounded-sm bg-surface-2 px-2 py-1.5">
          <dt className="text-2xs text-fg-3">{t("chance", { percent: Math.round(move.chanceBps / 100) })}</dt>
          <dd className="nums font-semibold text-gain">{reward(t, move)}</dd>
        </div>
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-3">
        <span className="nums">{t("refund", { amount: formatMoney(move.refundCents, { whole: true }) })}</span>
        {move.skillBonusBps > 0 && (
          <span className="nums text-accent">{t("skillBonus", { percent: Math.round(move.skillBonusBps / 100) })}</span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-w-0 text-2xs text-pretty text-fg-3">
          {busy ? (
            t("running")
          ) : resting && restingUntil !== null ? (
            <>
              {t("restingShort")} <Countdown target={restingUntil} />
            </>
          ) : noSlot ? (
            t("noSlot")
          ) : noCash ? (
            t("noCash")
          ) : null}
        </p>
        <Button
          size="sm"
          variant={move.risk === "risky" ? "secondary" : "primary"}
          state={state}
          disabled={blocked && state === "idle"}
          onClick={() => void start()}
        >
          {t("start")}
        </Button>
      </div>
    </li>
  );
}

function RunningList({ data }: { data: CompanyMoves }) {
  const t = useTranslations("companyMoves");
  const client = useQueryClient();
  return (
    <ul className="space-y-2" data-testid="moves-running">
      <AnimatePresence initial={false}>
        {data.running.map((run) => {
          const ends = Date.parse(run.endsAt);
          const total = Math.max(1, ends - Date.parse(run.startedAt));
          return (
            <motion.li
              key={run.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={SPRING.smooth}
              className="rounded-md bg-accent-soft px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-semibold text-fg-1">{moveText(t, run.key, "name")}</span>
                <span className="shrink-0 nums text-accent">
                  <Countdown target={ends} />
                </span>
              </div>
              <Progress
                ends={ends}
                total={total}
                onDone={() => client.invalidateQueries({ queryKey: COMPANY_MOVES_KEY })}
              />
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

function Progress({ ends, total, onDone }: { ends: number; total: number; onDone: () => void }) {
  const now = useClock();
  const left = now === null ? total : Math.max(0, ends - now);
  const done = now !== null && left === 0;
  useEffect(() => {
    if (!done) return;
    // The minute job resolves the move; ask again a little later.
    const id = setTimeout(onDone, 5_000);
    return () => clearTimeout(id);
  }, [done, onDone]);
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-surface-1" aria-hidden>
      <div
        className="h-full origin-left rounded-pill bg-accent transition-transform duration-slow ease-standard"
        style={{ transform: `scaleX(${1 - left / total})` }}
      />
    </div>
  );
}

function HistoryList({ data }: { data: CompanyMoves }) {
  const t = useTranslations("companyMoves");
  return (
    <div className="space-y-2 border-t border-line-1 pt-4" data-testid="moves-history">
      <p className="label-pixel text-fg-3">{t("history")}</p>
      <ul className="space-y-1.5">
        {data.history.slice(0, 6).map((h) => {
          const kind = data.moves.find((m) => m.key === h.key)?.kind ?? "cash";
          const won = h.status === "success";
          const line = !won
            ? t("resultRefund", { amount: formatMoney(h.payoutCents, { whole: true }) })
            : kind === "cash"
              ? t("resultCash", { amount: formatMoney(h.payoutCents, { whole: true }) })
              : t("resultGain", { points: Math.round(h.gain * 100), what: t(`kinds.${kind}`) });
          return (
            <li key={h.id} className="flex items-center gap-2 text-xs">
              <Badge tone={won ? "gain" : "loss"}>{won ? t("success") : t("failure")}</Badge>
              <span className="min-w-0 flex-1 truncate text-fg-2">{moveText(t, h.key, "name")}</span>
              <span className={cn("shrink-0 nums", won ? "text-gain" : "text-fg-3")}>{line}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
