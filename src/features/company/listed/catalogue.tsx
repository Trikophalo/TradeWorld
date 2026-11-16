"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoldButton } from "@/components/ui/hold-button";
import { Sheet } from "@/components/ui/sheet";
import { BALANCE } from "@/config/balance";
import type { ListedEffects, ListedItemKind } from "@/config/listed";
import type { ListedCompany } from "@/features/game/listed-types";
import { useServerClock } from "@/features/game/server-clock";
import { engine } from "@/features/game/store";
import { formatBps, formatMoney, formatMoneyShort } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { money, ServerCountdown, useItemText, useListedAction } from "./shared";
import {
  canBuyItem,
  canStopItem,
  effectChips,
  itemPhase,
  joinCatalogue,
  researchTree,
  type CatalogueEntry,
  type ItemPhase,
} from "./view";

/*
 * The growth catalogue of a listed company (ADR-167): research tree, products, regions, machines, acquisitions,
 * licences, benefits and team actions. One sheet shows an item in full and is the confirmation for buying it.
 */

export function useCatalogue(listed: ListedCompany): CatalogueEntry[] {
  return useMemo(() => joinCatalogue(BALANCE.listed.items, listed.items), [listed.items]);
}

/** Lasting effects as small chips: green where it helps, red where it costs. */
export function EffectChips({
  effects,
  levels,
  boost,
  className,
}: {
  effects: ListedEffects;
  levels?: number;
  /** Actions: points added to the satisfaction at once. */
  boost?: number;
  className?: string;
}) {
  const t = useTranslations("listed.effects");
  const th = useTranslations("hq.items");
  const chips = effectChips(effects, levels);
  if (chips.length === 0 && !boost) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {boost ? (
        <span className="rounded-xs bg-gain-soft px-1.5 py-0.5 nums text-2xs text-gain">
          {th("boost", { points: boost })}
        </span>
      ) : null}
      {chips.map((c) => (
        <span
          key={c.key}
          className={cn(
            "rounded-xs px-1.5 py-0.5 nums text-2xs",
            c.good ? "bg-gain-soft text-gain" : "bg-loss-soft text-loss",
          )}
        >
          {t(c.key)} {c.unit === "bps" ? formatBps(c.value) : `${c.value > 0 ? "+" : "−"}${Math.abs(c.value)}`}
        </span>
      ))}
    </span>
  );
}

const PHASE_TONE: Record<ItemPhase, "neutral" | "accent" | "gain" | "warn" | "info"> = {
  locked: "neutral",
  available: "accent",
  running: "info",
  active: "gain",
  maxed: "gain",
  paused: "warn",
  cooldown: "neutral",
};

function PhaseBadge({ entry, phase }: { entry: CatalogueEntry; phase: ItemPhase }) {
  const t = useTranslations("hq.items");
  const { state } = entry;
  if (phase === "running" && state.readyAt) {
    return (
      <Badge tone="info">
        {t("phase.running")} <ServerCountdown at={state.readyAt} />
      </Badge>
    );
  }
  if (phase === "cooldown" && state.cooldownUntil) {
    return (
      <Badge tone="neutral">
        {t("phase.cooldown")} <ServerCountdown at={state.cooldownUntil} />
      </Badge>
    );
  }
  return <Badge tone={PHASE_TONE[phase]}>{t(`phase.${phase}`)}</Badge>;
}

/** What the company can spend on an item: the free cash plus the board's budget for its purpose. */
function spendable(listed: ListedCompany, entry: CatalogueEntry): number {
  const budget = listed.budgets.find((b) => b.purpose === entry.item.purpose)?.amountCents ?? 0;
  return Math.max(0, listed.freeCashCents) + budget;
}

/** One item in full: description, effect, price, running cost, requirements; buying and retiring happen here. */
function ItemSheet({
  entry,
  listed,
  onClose,
}: {
  entry: CatalogueEntry | null;
  listed: ListedCompany;
  onClose: () => void;
}) {
  const t = useTranslations("hq.items");
  const tk = useTranslations("listed.kinds");
  const text = useItemText();
  const now = useServerClock() ?? 0;
  const action = useListedAction();
  // Keep the last item while the sheet slides out.
  const [shown, setShown] = useState(entry);
  if (entry !== null && entry !== shown) setShown(entry);
  const e = entry ?? shown;
  if (!e) return null;
  const { item, state } = e;
  const phase = itemPhase(e, now);
  const name = text.name(item.key);
  const buyable = canBuyItem(e, now);
  const affordable = state.costCents <= spendable(listed, e);
  const budget = listed.budgets.find((b) => b.purpose === item.purpose)?.amountCents ?? 0;
  const nextLevel = state.level + 1;
  const isAction = item.kind === "action";

  const buy = async () => {
    const ok = await action.run("buy", () => engine.companyInvest(crypto.randomUUID(), item.key), {
      title: name,
      done: t(isAction ? "used" : item.hours > 0 ? "started" : "bought", { name }),
      detail: formatMoney(state.costCents, { whole: true }),
    });
    if (ok) onClose();
  };
  const stop = async () => {
    const ok = await action.run("stop", () => engine.companyInvestStop(crypto.randomUUID(), item.key), {
      title: name,
      done: t("stopped", { name }),
    });
    if (ok) onClose();
  };

  return (
    <Sheet
      open={entry !== null}
      onOpenChange={(open) => !open && onClose()}
      title={name}
      description={tk(item.kind)}
      footer={
        <div className="space-y-2">
          {buyable && (
            <Button
              block
              size="lg"
              state={action.state("buy")}
              disabled={!affordable || action.busy !== null}
              onClick={() => void buy()}
              data-testid="item-buy"
            >
              {t(
                isAction
                  ? "useFor"
                  : item.kind === "research"
                    ? "researchFor"
                    : state.level > 0
                      ? "levelFor"
                      : "buyFor",
                { amount: money(state.costCents), level: nextLevel },
              )}
            </Button>
          )}
          {canStopItem(e) && (
            <HoldButton tone="loss" onConfirm={() => void stop()} disabled={action.busy !== null} className="w-full">
              <span data-testid="item-stop">{t("stopHold")}</span>
            </HoldButton>
          )}
        </div>
      }
    >
      <div className="space-y-4" data-testid="item-sheet" data-item={item.key}>
        <div className="flex flex-wrap items-center gap-2">
          <PhaseBadge entry={e} phase={phase} />
          {state.maxLevel > 1 && <Badge>{t("level", { level: state.level, max: state.maxLevel })}</Badge>}
          {item.kind === "research" && item.tier && <Badge>{t("tier", { tier: item.tier })}</Badge>}
        </div>
        <p className="text-pretty text-fg-2">{text.description(item.key)}</p>
        <div>
          <p className="mb-1.5 label-pixel text-fg-3">{t(state.maxLevel > 1 ? "effectPerLevel" : "effect")}</p>
          <EffectChips effects={item.effects} boost={item.boost} />
        </div>
        <dl className="space-y-1.5 rounded-md bg-surface-2 px-3 py-3 text-sm">
          <Row label={t(state.level > 0 && !isAction ? "costNext" : "cost")} value={money(state.costCents)} />
          {item.costPerHeadCents ? (
            <Row
              label={t("costPerHead")}
              value={t("perHeadValue", { amount: formatMoney(item.costPerHeadCents), heads: listed.headcount })}
            />
          ) : null}
          <Row
            label={t("upkeep")}
            value={state.upkeepCents > 0 ? t("perHour", { amount: formatMoney(state.upkeepCents) }) : t("none")}
          />
          {item.upkeepPerHeadCents ? (
            <Row
              label={t("upkeepPerHead")}
              value={t("perHeadHour", { amount: formatMoney(item.upkeepPerHeadCents), heads: listed.headcount })}
            />
          ) : null}
          <Row label={t("duration")} value={item.hours > 0 ? t("hours", { hours: item.hours }) : t("instant")} />
          {item.cooldownHours ? <Row label={t("cooldown")} value={t("hours", { hours: item.cooldownHours })} /> : null}
          {phase === "running" && state.readyAt && (
            <Row label={t("readyIn")} value={<ServerCountdown at={state.readyAt} className="text-info" />} />
          )}
          {phase === "cooldown" && state.cooldownUntil && (
            <Row label={t("againIn")} value={<ServerCountdown at={state.cooldownUntil} />} />
          )}
        </dl>
        {state.missing.length > 0 && (
          <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-pretty text-warn" data-testid="item-missing">
            {t("missing", { names: state.missing.map((key) => text.name(key)).join(", ") })}
          </p>
        )}
        {phase === "paused" && (
          <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-pretty text-warn">{t("pausedHint")}</p>
        )}
        {buyable && !affordable && (
          <p className="rounded-md bg-loss-soft px-3 py-2 text-sm text-pretty text-loss" data-testid="item-short">
            {t("short", { free: money(spendable(listed, e)) })}
          </p>
        )}
        {buyable && budget > 0 && (
          <p className="text-xs text-pretty text-fg-3">{t("budgetHint", { amount: money(budget) })}</p>
        )}
        {canStopItem(e) && (
          <p className="text-xs text-pretty text-fg-3">{t(item.kind === "benefit" ? "stopBenefit" : "stopNote")}</p>
        )}
        {(item.kind === "research" || item.kind === "machine" || item.kind === "acquisition") && (
          <p className="text-xs text-pretty text-fg-3">{t("forever")}</p>
        )}
      </div>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-2">{label}</dt>
      <dd className="text-right nums font-medium text-fg-1">{value}</dd>
    </div>
  );
}

/** Items of the given kinds as a list of pressable rows. */
export function ItemList({
  listed,
  kinds,
  columns = true,
}: {
  listed: ListedCompany;
  kinds: readonly ListedItemKind[];
  columns?: boolean;
}) {
  const t = useTranslations("hq.items");
  const text = useItemText();
  const now = useServerClock() ?? 0;
  const entries = useCatalogue(listed).filter((e) => kinds.includes(e.item.kind));
  const [open, setOpen] = useState<string | null>(null);
  const current = entries.find((e) => e.item.key === open) ?? null;
  return (
    <>
      <ul className={cn("grid gap-2", columns && "sm:grid-cols-2")} data-testid={`items-${kinds.join("-")}`}>
        {entries.map((e) => {
          const phase = itemPhase(e, now);
          const owned = phase === "active" || phase === "maxed" || phase === "paused";
          return (
            <li key={e.item.key}>
              <button
                type="button"
                onClick={() => {
                  haptic("tap");
                  setOpen(e.item.key);
                }}
                data-testid={`item-${e.item.key}`}
                data-phase={phase}
                className={cn(
                  "flex h-full w-full flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left focus-ring transition duration-fast hover:-translate-y-0.5 hover:bg-surface-2 active:translate-y-0 active:scale-[0.98]",
                  owned ? "border-gain/40 bg-gain-soft/40" : "border-line-1 bg-surface-1",
                  phase === "locked" && "opacity-70",
                )}
              >
                <span className="flex w-full items-start justify-between gap-2">
                  <span className="min-w-0 text-sm font-medium text-fg-1">{text.name(e.item.key)}</span>
                  <PhaseBadge entry={e} phase={phase} />
                </span>
                <EffectChips effects={e.item.effects} boost={e.item.boost} />
                <span className="mt-auto flex w-full flex-wrap items-baseline justify-between gap-x-3 nums text-xs text-fg-3">
                  <span>
                    {owned && e.state.level >= e.state.maxLevel
                      ? t("owned")
                      : t(e.state.level > 0 ? "nextShort" : "costShort", { amount: money(e.state.costCents) })}
                  </span>
                  {e.item.upkeepPerHeadCents ? (
                    <span>{t("perHeadShort", { amount: formatMoney(e.item.upkeepPerHeadCents) })}</span>
                  ) : e.state.upkeepCents > 0 ? (
                    <span>{t("perHour", { amount: formatMoney(e.state.upkeepCents) })}</span>
                  ) : null}
                  {e.state.maxLevel > 1 && <span>{t("level", { level: e.state.level, max: e.state.maxLevel })}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <ItemSheet entry={current} listed={listed} onClose={() => setOpen(null)} />
    </>
  );
}

const NODE: Record<ItemPhase, string> = {
  locked: "border-line-1 bg-surface-2 text-fg-3",
  available: "border-accent bg-accent-soft text-fg-1",
  running: "border-info bg-info-soft text-fg-1",
  active: "border-gain bg-gain-soft text-fg-1",
  maxed: "border-gain bg-gain-soft text-fg-1",
  paused: "border-warn bg-warn-soft text-fg-1",
  cooldown: "border-line-1 bg-surface-2 text-fg-3",
};

/**
 * The research tree: seven branches as rows, four steps from left to right, joined by a line that turns green as
 * far as the branch is researched. The last step also needs step 2 of a neighbouring branch (shown in the sheet).
 */
export function ResearchTree({ listed }: { listed: ListedCompany }) {
  const t = useTranslations("hq.items");
  const tb = useTranslations("listed.branches");
  const text = useItemText();
  const now = useServerClock() ?? 0;
  const entries = useCatalogue(listed);
  const tree = useMemo(() => researchTree(entries), [entries]);
  const [open, setOpen] = useState<string | null>(null);
  const current = entries.find((e) => e.item.key === open) ?? null;
  return (
    <>
      <ol className="grid gap-3 xl:grid-cols-2" data-testid="research-tree">
        {tree.map((row) => (
          <li key={row.branch} className="rounded-md border border-line-1 bg-surface-1 px-3 py-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-fg-1">{tb(row.branch)}</p>
              <p className="nums text-xs text-fg-3">{t("branchDone", { done: row.done, total: row.steps.length })}</p>
            </div>
            <div className="relative grid grid-cols-4 gap-2">
              {/* The trunk behind the nodes */}
              <span aria-hidden className="absolute inset-x-4 top-5 h-0.5 bg-line-2" />
              <span
                aria-hidden
                className="absolute inset-x-4 top-5 h-0.5 origin-left bg-gain"
                style={{ transform: `scaleX(${Math.max(0, row.done - 1) / Math.max(1, row.steps.length - 1)})` }}
              />
              {row.steps.map((e) => {
                const phase = itemPhase(e, now);
                const cross = (e.item.requires ?? []).filter((k) => !k.startsWith(`r_${row.branch}_`));
                return (
                  <button
                    key={e.item.key}
                    type="button"
                    onClick={() => {
                      haptic("tap");
                      setOpen(e.item.key);
                    }}
                    aria-label={`${text.name(e.item.key)}: ${t(`phase.${phase}`)}`}
                    data-testid={`item-${e.item.key}`}
                    data-phase={phase}
                    className="group relative flex min-w-0 flex-col items-center gap-1 rounded-sm focus-ring transition duration-fast active:scale-[0.96]"
                  >
                    <span
                      className={cn(
                        "relative grid size-10 place-items-center rounded-md border-2 font-pixel text-sm transition-transform duration-fast group-hover:-translate-y-0.5",
                        NODE[phase],
                      )}
                    >
                      {phase === "active" || phase === "maxed" ? "✓" : e.item.tier}
                      {phase === "running" && (
                        <span
                          aria-hidden
                          className="absolute -top-1 -right-1 size-2.5 rounded-pill bg-info motion-safe:animate-pulse"
                        />
                      )}
                      {cross.length > 0 && phase === "locked" && (
                        <span aria-hidden className="absolute -right-1 -bottom-1 text-2xs text-warn">
                          ⚑
                        </span>
                      )}
                    </span>
                    <span className="line-clamp-2 w-full text-center text-2xs leading-tight text-fg-2">
                      {text.name(e.item.key)}
                    </span>
                    <span className="nums text-2xs text-fg-3">
                      {phase === "running" && e.state.readyAt ? (
                        <ServerCountdown at={e.state.readyAt} className="text-info" />
                      ) : phase === "active" || phase === "maxed" ? (
                        t("done")
                      ) : (
                        formatMoneyShort(e.state.costCents)
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
      <ItemSheet entry={current} listed={listed} onClose={() => setOpen(null)} />
    </>
  );
}
