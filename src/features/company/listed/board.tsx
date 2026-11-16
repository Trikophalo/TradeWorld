"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { BOARD_MOTION_KINDS, LISTED_PURPOSES, type BoardMotionKind, type ListedPurpose } from "@/config/listed";
import { useGameErrorText } from "@/features/game/errors";
import {
  LISTED_COMPANY_KEY,
  type BoardMotion,
  type BoardMotionInput,
  type CompanyBoard,
} from "@/features/game/listed-types";
import { engine } from "@/features/game/store";
import { parseEuroCents } from "@/features/market/order-schema";
import type { PriceLevel } from "@/lib/sim/startup";
import { formatBps, formatShares } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { RestrictionNotes } from "./controlling-panels";
import { BOARD_KEY, Line, money, Panel, ServerCountdown, Stat, useCompanyBoard } from "./shared";
import { motionError, motionFields, motionTally } from "./view";

const rules = BALANCE.listed.board;
const percent = (bps: number) => formatBps(bps).replace("+", "");
const when = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Runs a board write and puts the fresh board into the cache. */
function useBoardAction(companyId: string | null) {
  const client = useQueryClient();
  const errorText = useGameErrorText();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<CompanyBoard>, title: string, done: string) => {
    setBusy(key);
    try {
      client.setQueryData(BOARD_KEY(companyId), await action());
      toast.success(done, undefined, { silent: true });
      void playSound("success");
      haptic("success");
      void client.invalidateQueries({ queryKey: LISTED_COMPANY_KEY });
      return true;
    } catch (error) {
      toast.error(title, errorText(error));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const state = (key: string): ButtonState => (busy === key ? "loading" : "idle");
  return { run, state, busy };
}

/**
 * The Geschäftsrat of a listed company (ADR-167): who holds how much, what is earmarked, what binds the founder,
 * open motions with their tally, and the form to bring one. `companyId` null = the own company; any shareholder
 * may look and vote, those above 20 % may convene.
 */
export function BoardView({ companyId }: { companyId: string | null }) {
  const t = useTranslations("hq.board");
  const errorText = useGameErrorText();
  const board = useCompanyBoard(companyId);
  if (board.isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-2" aria-hidden>
        <Skeleton className="h-56 w-full rounded-lg" />
        <Skeleton className="h-56 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg lg:col-span-2" />
      </div>
    );
  }
  if (!board.data) {
    return (
      <EmptyState
        art={<PixelIcon {...UI_ICONS.lock} scale={4} />}
        title={t("noAccessTitle")}
        description={board.error ? errorText(board.error) : t("noAccessText")}
      />
    );
  }
  const b = board.data;
  return (
    <div className="space-y-4" data-testid="company-board" data-company={b.company.id}>
      <div className="grid items-start gap-4 *:min-w-0 lg:grid-cols-2 lg:gap-5">
        <div className="space-y-4">
          <Seats board={b} />
          <Motions board={b} companyId={companyId} />
        </div>
        <div className="space-y-4">
          <MoneyCard board={b} />
          <ProposeCard board={b} companyId={companyId} />
        </div>
      </div>
      <HistoryCard board={b} />
    </div>
  );
}

function Seats({ board }: { board: CompanyBoard }) {
  const t = useTranslations("hq.board");
  return (
    <Panel
      title={t("seatsTitle", { name: board.company.name })}
      testId="board-holders"
      aside={board.company.ticker ? <Badge>{board.company.ticker}</Badge> : undefined}
    >
      <div className="grid grid-cols-2 gap-2">
        <Stat label={t("myShare")} hint={formatShares(board.myE6)} testId="board-my-share">
          {percent(board.myShareBps)}
        </Stat>
        <Stat label={t("reputation")} tone={board.reputation < rules.aiVote.reputationBelow ? "loss" : undefined}>
          {Math.round(board.reputation)}
          <span className="text-sm font-normal text-fg-3"> / 100</span>
        </Stat>
      </div>
      <p
        className={cn(
          "rounded-md px-3 py-2 text-sm text-pretty",
          board.canConvene ? "bg-gain-soft text-gain" : "bg-surface-2 text-fg-2",
        )}
        data-testid="board-right"
        data-can-convene={board.canConvene}
      >
        {board.canConvene
          ? t("canConvene")
          : board.myShareBps > board.minShareBps
            ? t("conveneWait", { hours: rules.cooldownHours, max: rules.maxOpen })
            : board.canVote
              ? t("canVoteOnly", { min: percent(board.minShareBps) })
              : t("watchOnly", { min: percent(board.minShareBps) })}
      </p>
      <ul className="space-y-2">
        {board.holders.map((h) => (
          <li key={h.nickname} data-testid="board-holder" data-me={h.me}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-fg-1">
                {h.nickname}
                {h.isFounder && <span className="ml-1.5 label-pixel text-gold">{t("founder")}</span>}
                {h.me && <span className="ml-1.5 label-pixel text-accent">{t("you")}</span>}
              </span>
              <span className="shrink-0 nums text-fg-2">{percent(h.shareBps)}</span>
            </div>
            <ShareBar bps={h.shareBps} tone={h.shareBps > board.minShareBps ? "accent" : "muted"} />
          </li>
        ))}
        <li>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="text-fg-2">{t("float")}</span>
            <span className="nums text-fg-2">
              {percent(Math.round((board.floatE6 * 10_000) / Math.max(1, board.totalE6)))}
            </span>
          </div>
          <ShareBar bps={Math.round((board.floatE6 * 10_000) / Math.max(1, board.totalE6))} tone="muted" />
        </li>
      </ul>
      <p className="text-xs text-pretty text-fg-3">
        {t(board.aiVotes ? "floatVotes" : "floatAbstains", { below: rules.aiVote.reputationBelow })}
      </p>
    </Panel>
  );
}

function ShareBar({ bps, tone }: { bps: number; tone: "accent" | "muted" }) {
  return (
    <div className="relative h-2 overflow-hidden rounded-pill bg-surface-3" aria-hidden>
      <span
        className={cn("block h-full origin-left", tone === "accent" ? "bg-accent" : "bg-fg-3/60")}
        style={{ transform: `scaleX(${Math.min(1, bps / 10_000)})` }}
      />
      <span className="absolute inset-y-0 w-px bg-fg-1" style={{ left: `${rules.minShareBps / 100}%` }} />
    </div>
  );
}

function MoneyCard({ board }: { board: CompanyBoard }) {
  const t = useTranslations("hq.board");
  const tp = useTranslations("listed.purposes");
  const reserved = board.budgets.reduce((s, x) => s + x.amountCents, 0);
  return (
    <Panel title={t("moneyTitle")} testId="board-money">
      <dl className="space-y-1.5">
        <Line label={t("cash")} value={money(board.cashCents)} />
        <Line label={t("reserved")} value={money(reserved)} tone={reserved > 0 ? "warn" : "muted"} />
        <Line label={t("free")} value={money(board.freeCashCents)} strong />
        <Line label={t("founderPayout")} value={percent(board.founderPayoutBps)} />
      </dl>
      <div>
        <p className="mb-1.5 label-pixel text-fg-3">{t("budgets")}</p>
        {board.budgets.length === 0 ? (
          <p className="text-sm text-pretty text-fg-3" data-testid="board-budgets-none">
            {t("budgetsNone")}
          </p>
        ) : (
          <ul className="space-y-1" data-testid="board-budgets">
            {board.budgets.map((x) => (
              <li
                key={x.purpose}
                className="flex items-baseline justify-between gap-3 text-sm"
                data-purpose={x.purpose}
              >
                <span className="text-fg-2">{tp(x.purpose)}</span>
                <span className="nums font-medium text-fg-1">{money(x.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1.5 label-pixel text-fg-3">{t("restrictions")}</p>
        <RestrictionNotes restrictions={board.restrictions} />
        <RestrictionsEmpty board={board} />
      </div>
    </Panel>
  );
}

function RestrictionsEmpty({ board }: { board: CompanyBoard }) {
  const t = useTranslations("hq.board");
  const r = board.restrictions;
  if (r.payoutCapUntil || r.withdrawBlockUntil || r.priceLockUntil) return null;
  return <p className="text-sm text-pretty text-fg-3">{t("restrictionsNone")}</p>;
}

function Motions({ board, companyId }: { board: CompanyBoard; companyId: string | null }) {
  const t = useTranslations("hq.board");
  return (
    <Panel
      title={t("motionsTitle")}
      testId="board-motions"
      aside={
        <span className="nums text-xs text-fg-3">
          {t("motionsCount", { count: board.motions.length, max: rules.maxOpen })}
        </span>
      }
    >
      {board.motions.length === 0 ? (
        <p className="text-sm text-pretty text-fg-3" data-testid="board-motions-none">
          {t("motionsNone")}
        </p>
      ) : (
        <ul className="space-y-3">
          {board.motions.map((m) => (
            <MotionRow key={m.id} motion={m} board={board} companyId={companyId} />
          ))}
        </ul>
      )}
      <p className="text-xs text-pretty text-fg-3">
        {t("rules", { hours: rules.voteHours, quorum: percent(rules.quorumBps) })}
      </p>
    </Panel>
  );
}

function MotionRow({
  motion,
  board,
  companyId,
}: {
  motion: BoardMotion;
  board: CompanyBoard;
  companyId: string | null;
}) {
  const t = useTranslations("hq.board");
  const tk = useTranslations("listed.motions");
  const ts = useTranslations("listed.motionStatus");
  const action = useBoardAction(companyId);
  const tally = motionTally(motion, rules.quorumBps);
  const open = motion.status === "open";
  const vote = (yes: boolean) =>
    action.run(
      yes ? "yes" : "no",
      () => engine.voteBoardMotion(crypto.randomUUID(), motion.id, yes),
      motion.label,
      t(yes ? "votedYes" : "votedNo"),
    );
  return (
    <li
      className="space-y-2.5 rounded-md border border-line-1 bg-surface-2 px-3 py-3"
      data-testid="board-motion"
      data-status={motion.status}
      data-kind={motion.kind}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="label-pixel text-fg-3">{tk(motion.kind)}</p>
          <p className="text-sm font-semibold text-pretty text-fg-1">{motion.label}</p>
          <p className="text-xs text-fg-3">
            {motion.proposer ? t("by", { name: motion.proposer }) : t("byUnknown")}
            {motion.mine ? ` · ${t("mine")}` : ""}
          </p>
        </div>
        {open ? (
          <span className="shrink-0 text-right text-xs text-fg-3">
            {t("closesIn")}
            <ServerCountdown at={motion.closesAt} className="block text-sm font-semibold text-accent" />
          </span>
        ) : (
          <Badge tone={motion.status === "passed" ? "gain" : motion.status === "rejected" ? "loss" : "neutral"}>
            {ts(motion.status)}
          </Badge>
        )}
      </div>
      <div>
        <div
          className="relative flex h-3 overflow-hidden rounded-pill bg-surface-3"
          role="img"
          aria-label={t("tallyLabel", {
            yes: percent(tally.yesBps),
            no: percent(tally.noBps),
            quorum: percent(rules.quorumBps),
          })}
          data-testid="board-tally"
        >
          <span className="h-full bg-gain" style={{ width: `${tally.yesBps / 100}%` }} />
          <span className="h-full bg-loss" style={{ width: `${tally.noBps / 100}%` }} />
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 bg-fg-1"
            style={{ left: `${rules.quorumBps / 100}%` }}
          />
        </div>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 nums text-xs">
          <span className="text-gain">{t("yes", { percent: percent(tally.yesBps) })}</span>
          <span className={tally.quorumMet ? "text-fg-2" : "text-warn"} data-testid="board-quorum">
            {t(tally.quorumMet ? "quorumMet" : "quorumOpen", {
              cast: percent(tally.castBps),
              quorum: percent(rules.quorumBps),
            })}
          </span>
          <span className="text-loss">{t("no", { percent: percent(tally.noBps) })}</span>
        </div>
        {motion.aiE6 > 0 && <p className="mt-1 text-xs text-fg-3">{t("aiVoted")}</p>}
      </div>
      {motion.votes.length > 0 && (
        <p className="text-xs text-pretty text-fg-3">
          {motion.votes.map((v) => `${v.nickname} ${v.yes ? "✓" : "✗"}`).join(" · ")}
        </p>
      )}
      {open && board.canVote && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant={motion.myVote === "yes" ? "primary" : "secondary"}
            state={action.state("yes")}
            disabled={action.busy !== null}
            aria-pressed={motion.myVote === "yes"}
            onClick={() => void vote(true)}
            data-testid="vote-yes"
          >
            {t("voteYes")}
          </Button>
          <Button
            size="sm"
            variant={motion.myVote === "no" ? "danger" : "secondary"}
            state={action.state("no")}
            disabled={action.busy !== null}
            aria-pressed={motion.myVote === "no"}
            onClick={() => void vote(false)}
            data-testid="vote-no"
          >
            {t("voteNo")}
          </Button>
        </div>
      )}
      {open && motion.myVote && (
        <p className="text-xs text-fg-3" data-testid="my-vote">
          {t(motion.myVote === "yes" ? "myVoteYes" : "myVoteNo")}
        </p>
      )}
      {open && !board.canVote && <p className="text-xs text-fg-3">{t("noVote")}</p>}
    </li>
  );
}

const PRICE_LEVELS: readonly PriceLevel[] = ["budget", "normal", "premium"];

/** The typed form for a motion: kind first, then only the inputs that kind needs. */
function ProposeCard({ board, companyId }: { board: CompanyBoard; companyId: string | null }) {
  const t = useTranslations("hq.board");
  const tk = useTranslations("listed.motions");
  const tp = useTranslations("listed.purposes");
  const tf = useTranslations("firm");
  const action = useBoardAction(companyId);
  const [kind, setKind] = useState<BoardMotionKind>("earmark");
  const [purpose, setPurpose] = useState<ListedPurpose>("research");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState(3);
  const [bps, setBps] = useState(2_000);
  const [priceLevel, setPriceLevel] = useState<PriceLevel>("normal");
  const fields = motionFields(kind);
  const cents = parseEuroCents(amount) ?? 0;

  const motion: BoardMotionInput =
    kind === "earmark"
      ? { kind, purpose, amountCents: cents }
      : kind === "release"
        ? { kind, purpose }
        : kind === "dividend" || kind === "debt"
          ? { kind, amountCents: cents }
          : kind === "payout_cap"
            ? { kind, bps, days }
            : kind === "withdraw_ban"
              ? { kind, days }
              : { kind: "price_level", priceLevel, days };
  const error = motionError(motion, board, {
    maxDays: rules.maxDays,
    earmarkMaxShareOfCashBps: rules.earmarkMaxShareOfCashBps,
    payoutCapStepBps: rules.payoutCapStepBps,
    minDividendCents: BALANCE.listed.dividends.minTotalCents,
  });
  const untouched = fields.amount && amount.trim() === "";
  const errorValues = {
    max: money(Math.floor((Math.max(0, board.cashCents) * rules.earmarkMaxShareOfCashBps) / 10_000)),
    min: money(BALANCE.listed.dividends.minTotalCents),
    free: money(board.freeCashCents),
    days: rules.maxDays,
  };

  const submit = async () => {
    if (error) return;
    const ok = await action.run(
      "propose",
      () => engine.proposeBoardMotion(crypto.randomUUID(), companyId, motion),
      t("proposeTitle"),
      t("proposed"),
    );
    if (ok) setAmount("");
  };

  if (!board.canConvene) {
    return (
      <Panel title={t("proposeTitle")} testId="board-propose-locked">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2 text-fg-3">
            <PixelIcon {...UI_ICONS.lock} scale={2} />
          </span>
          <p className="text-sm text-pretty text-fg-2">
            {board.myShareBps > board.minShareBps
              ? t("conveneWait", { hours: rules.cooldownHours, max: rules.maxOpen })
              : t("proposeLocked", { min: percent(board.minShareBps), mine: percent(board.myShareBps) })}
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={t("proposeTitle")} testId="board-propose">
      <div>
        <p className="mb-1.5 label-pixel text-fg-2">{t("kind")}</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("kind")}>
          {BOARD_MOTION_KINDS.map((k) => (
            <Chip key={k} active={k === kind} onClick={() => setKind(k)} testId={`motion-kind-${k}`}>
              {tk(k)}
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-sm text-pretty text-fg-3">{t(`kindText.${kind}`)}</p>
      </div>
      {fields.purpose && (
        <div>
          <p className="mb-1.5 label-pixel text-fg-2">{t("purpose")}</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("purpose")}>
            {LISTED_PURPOSES.map((p) => (
              <Chip key={p} active={p === purpose} onClick={() => setPurpose(p)} testId={`motion-purpose-${p}`}>
                {tp(p)}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {fields.amount && (
        <Field
          label={t("amount")}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          error={
            !untouched && error && error !== "days" && error !== "bps" ? t(`errors.${error}`, errorValues) : undefined
          }
          hint={
            kind === "earmark"
              ? t("amountHintEarmark", { max: errorValues.max })
              : kind === "dividend"
                ? t("amountHintDividend", { free: errorValues.free })
                : t("amountHintDebt")
          }
          data-testid="motion-amount"
        />
      )}
      {fields.bps && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="label-pixel text-fg-2">{t("cap")}</span>
            <span className="nums font-semibold text-fg-1">{percent(bps)}</span>
          </div>
          <Slider
            value={bps / 10_000}
            onValueChange={(v) => setBps(Math.round((v * 10_000) / rules.payoutCapStepBps) * rules.payoutCapStepBps)}
            label={t("cap")}
            marks={[0.25, 0.5, 0.75]}
            valueText={percent(bps)}
          />
        </div>
      )}
      {fields.priceLevel && (
        <Segmented
          value={priceLevel}
          onValueChange={setPriceLevel}
          label={t("priceLevel")}
          options={PRICE_LEVELS.map((value) => ({ value, label: tf(`strategy.levels.${value}`) }))}
          block
        />
      )}
      {fields.days && (
        <div>
          <p className="mb-1.5 label-pixel text-fg-2">{t("days")}</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("days")}>
            {Array.from({ length: rules.maxDays }, (_, i) => i + 1).map((d) => (
              <Chip key={d} active={d === days} onClick={() => setDays(d)} testId={`motion-days-${d}`}>
                {t("daysValue", { count: d })}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {kind === "release" && error === "noBudget" && (
        <p className="text-sm text-warn" role="alert">
          {t("errors.noBudget", errorValues)}
        </p>
      )}
      <Button
        block
        state={action.state("propose")}
        disabled={error !== null}
        onClick={() => void submit()}
        data-testid="motion-submit"
      >
        {t("propose")}
      </Button>
      <p className="text-xs text-pretty text-fg-3">
        {t("proposeHint", { hours: rules.voteHours, cooldown: rules.cooldownHours })}
      </p>
    </Panel>
  );
}

function Chip({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => {
        haptic("tap");
        onClick();
      }}
      data-testid={testId}
      className={cn(
        "rounded-pill border px-3 py-1.5 text-xs focus-ring transition duration-fast active:scale-95",
        active
          ? "border-accent bg-accent text-on-accent"
          : "border-line-2 bg-surface-1 text-fg-2 hover:border-accent hover:text-fg-1",
      )}
    >
      {children}
    </button>
  );
}

function HistoryCard({ board }: { board: CompanyBoard }) {
  const t = useTranslations("hq.board");
  const tk = useTranslations("listed.motions");
  const ts = useTranslations("listed.motionStatus");
  return (
    <Panel title={t("historyTitle")} testId="board-history">
      {board.history.length === 0 ? (
        <p className="text-sm text-pretty text-fg-3">{t("historyNone")}</p>
      ) : (
        <ul className="divide-y divide-line-1">
          {board.history.map((m) => {
            const tally = motionTally(m, rules.quorumBps);
            return (
              <li
                key={m.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5 first:pt-0 last:pb-0"
                data-testid="board-history-row"
                data-status={m.status}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-pretty text-fg-1">{m.label}</span>
                  <span className="block nums text-xs text-fg-3">
                    {tk(m.kind)} · {when.format(new Date(m.closedAt ?? m.closesAt))} ·{" "}
                    {t("historyTally", { yes: percent(tally.yesBps), no: percent(tally.noBps) })}
                  </span>
                </span>
                <Badge tone={m.status === "passed" ? "gain" : m.status === "rejected" ? "loss" : "neutral"}>
                  {ts(m.status)}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
