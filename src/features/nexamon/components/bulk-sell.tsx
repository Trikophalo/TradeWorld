"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { NEXAMON_SETS, type NexamonRarity, type NexamonSetKey } from "@/config/nexamon";
import { BALANCE } from "@/config/balance";
import { NEXAMON_CONDITIONS, type NexamonCondition } from "@/config/nexamon-rules";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import type { NexamonCollection } from "@/features/game/nexamon-types";
import { engine } from "@/features/game/store";
import { parseEuroCents } from "@/features/market/order-schema";
import { formatMoney } from "@/lib/format";
import { nexamonCardBonusDef } from "@/lib/sim/nexamon-bonuses";
import { nexamonBulkPayout, nexamonBulkRarities } from "@/lib/sim/nexamon";
import { playSound } from "@/lib/sound";
import { useNexamonAction } from "../hooks";
import { bulkGroups, bulkPick, bulkSelectBelow, DEFAULT_BULK_FILTER, formatChance, type BulkFilter } from "../view";
import { RarityBadge } from "./badges";
import { CardThumb } from "./card-face";
import { FactRow, SelectField } from "./parts";

const BULK_RARITIES = [...new Set(NEXAMON_SETS.flatMap((s) => nexamonBulkRarities(s)))] as NexamonRarity[];
const hasBonus = (card: Parameters<typeof nexamonCardBonusDef>[0]) => nexamonCardBonusDef(card) !== null;

/**
 * The collection's bulk mode (ADR-174): every raw copy below ultra, filtered by the player, picked card by card
 * with a quantity, and two ways out: sold to the game at once for the value minus the bulk fee, or listed on the
 * market at the value (or a share of it) with the multi-listing.
 */
export function BulkSell({ collection }: { collection: NexamonCollection }) {
  const t = useTranslations("nexamon");
  const tc = useTranslations("nexamonCards");
  const [filter, setFilter] = useState<BulkFilter>(DEFAULT_BULK_FILTER);
  const patch = (p: Partial<BulkFilter>) => setFilter((f) => ({ ...f, ...p }));
  const [maxText, setMaxText] = useState("");
  const groups = useMemo(() => bulkGroups(collection.copies, filter, hasBonus), [collection.copies, filter]);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const picked = bulkPick(groups, selection);
  const payout = nexamonBulkPayout(picked.map((c) => c.valueCents));
  const [share, setShare] = useState("100");
  const sell = useNexamonAction();
  const list = useNexamonAction();

  const selectAll = () => setSelection(Object.fromEntries(groups.map((g) => [g.card.key, g.copies.length])));
  const selectNone = () => setSelection({});
  const [belowText, setBelowText] = useState("");
  const belowCents = parseEuroCents(belowText);
  const belowOk = belowText.trim() !== "" && belowCents !== null && belowCents > 0;
  const [autoPicked, setAutoPicked] = useState<{ count: number; valueCents: number } | null>(null);
  const selectBelow = () => {
    if (!belowOk) return;
    const next = bulkSelectBelow(groups, belowCents);
    const copies = bulkPick(groups, next);
    setSelection(next);
    setAutoPicked({ count: copies.length, valueCents: copies.reduce((sum, c) => sum + c.valueCents, 0) });
  };

  const sellToGame = () =>
    void sell.run(
      async (requestId) => {
        // more than one call's worth: sell in chunks, each with its own stable request id (retries stay idempotent)
        const max = BALANCE.nexamon.quickSell.maxPerCall;
        const ids = picked.map((c) => c.id);
        let count = 0;
        let totalCents = 0;
        for (let i = 0; i * max < ids.length; i++) {
          const id = i === 0 ? requestId : requestId.slice(0, -4) + i.toString(16).padStart(4, "0");
          const r = await engine.bulkSellNexamon(id, ids.slice(i * max, (i + 1) * max));
          count += r.count;
          totalCents += r.totalCents;
        }
        return { count, totalCents };
      },
      {
        errorTitle: t("bulk.sellFailed"),
        onDone: (r) => {
          void playSound("coin");
          toast.success(t("bulk.sold", { count: r.count }), formatMoney(r.totalCents), { silent: true });
          setSelection({});
        },
      },
    );

  const sharePct = Number.parseInt(share, 10);
  const shareOk = Number.isFinite(sharePct) && sharePct >= 10 && sharePct <= 1_000;
  const listOnMarket = () =>
    void list.run(
      async (requestId) => {
        // one multi-listing per card and condition, at the copy's value x share
        const batches = new Map<string, typeof picked>();
        for (const c of picked) {
          const k = `${c.cardKey}|${c.condition}`;
          batches.set(k, [...(batches.get(k) ?? []), c]);
        }
        let n = 0;
        let i = 0;
        for (const copies of batches.values()) {
          const first = copies[0]!;
          const price = Math.max(BALANCE.nexamon.market.minPriceCents, Math.round((first.valueCents * sharePct) / 100));
          await engine.listNexamonCards(
            i++ === 0 ? requestId : crypto.randomUUID(),
            first.cardKey,
            first.condition,
            null,
            copies.length,
            price,
          );
          n += copies.length;
        }
        return n;
      },
      {
        errorTitle: t("bulk.listFailed"),
        onDone: (n) => {
          toast.success(t("bulk.listed", { count: n }));
          setSelection({});
        },
      },
    );

  return (
    <div className="space-y-4" data-testid="bulk-sell">
      <p className="text-sm text-pretty text-fg-2">
        {t("bulk.intro", { fee: formatChance(10_000 - BALANCE.nexamon.quickSell.bps) })}
      </p>
      <div className="space-y-3 rounded-lg bg-surface-2 p-3">
        <div className="grid grid-cols-2 items-end gap-2 lg:grid-cols-4">
          <SelectField<NexamonSetKey | "all">
            label={t("filter.set")}
            value={filter.set}
            onChange={(v) => patch({ set: v })}
            testId="bulk-set"
            options={[
              { value: "all", label: t("filter.allSets") },
              ...NEXAMON_SETS.map((key) => ({ value: key, label: tc(`sets.${key}`) })),
            ]}
          />
          <SelectField<NexamonRarity | "all">
            label={t("filter.rarity")}
            value={filter.rarity}
            onChange={(v) => patch({ rarity: v })}
            testId="bulk-rarity"
            options={[
              { value: "all", label: t("filter.allRarities") },
              ...BULK_RARITIES.map((key) => ({ value: key, label: tc(`rarityShort.${key}`) })),
            ]}
          />
          <SelectField<NexamonCondition | "all">
            label={t("bulk.condition")}
            value={filter.condition}
            onChange={(v) => patch({ condition: v })}
            testId="bulk-condition"
            options={[
              { value: "all", label: t("bulk.anyCondition") },
              ...NEXAMON_CONDITIONS.map((key) => ({ value: key, label: tc(`condition.${key}`) })),
            ]}
          />
          <Field
            label={t("bulk.maxValue")}
            inputMode="decimal"
            autoComplete="off"
            value={maxText}
            placeholder={t("bulk.maxValueAny")}
            onChange={(event) => {
              setMaxText(event.target.value);
              const cents = parseEuroCents(event.target.value);
              patch({ maxValueCents: event.target.value.trim() === "" || cents === null ? null : cents });
            }}
            data-testid="bulk-max"
          />
        </div>
        {(
          [
            ["keepOne", t("bulk.keepOne")],
            ["skipBonus", t("bulk.skipBonus")],
            ["duplicatesOnly", t("bulk.duplicatesOnly")],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 text-sm text-fg-1"
            data-testid={`bulk-${key}`}
          >
            {label}
            <Switch checked={filter[key]} onCheckedChange={(on) => patch({ [key]: on })} label={label} />
          </label>
        ))}
        <div className="space-y-2 border-t-2 border-line-1 pt-3" data-testid="bulk-auto">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <Field
              label={t("bulk.belowLabel")}
              inputMode="decimal"
              autoComplete="off"
              value={belowText}
              placeholder={t("bulk.belowPlaceholder")}
              onChange={(event) => {
                setBelowText(event.target.value);
                setAutoPicked(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") selectBelow();
              }}
              data-testid="bulk-below"
            />
            <Button
              variant="secondary"
              disabled={!belowOk || groups.length === 0}
              onClick={selectBelow}
              className="h-12"
              data-testid="bulk-below-select"
            >
              {t("bulk.belowSelect")}
            </Button>
          </div>
          <p className="text-xs text-pretty text-fg-3" aria-live="polite" data-testid="bulk-below-result">
            {autoPicked
              ? t("bulk.belowResult", { count: autoPicked.count, value: formatMoney(autoPicked.valueCents) })
              : t(filter.keepOne ? "bulk.belowHintKeep" : "bulk.belowHint")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        {groups.length === 0 ? (
          <EmptyState
            art={<PixelIcon {...UI_ICONS.search} scale={4} />}
            title={t("bulk.emptyTitle")}
            description={t("bulk.emptyText")}
          />
        ) : (
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={selectAll} data-testid="bulk-all">
                {t("bulk.selectAll")}
              </Button>
              <Button size="sm" variant="ghost" onClick={selectNone} data-testid="bulk-none">
                {t("bulk.selectNone")}
              </Button>
            </div>
            <ul className="grid gap-2 2xl:grid-cols-2" data-testid="bulk-list">
              {groups.map((g) => {
                const n = Math.min(selection[g.card.key] ?? 0, g.copies.length);
                return (
                  <li
                    key={g.card.key}
                    className="flex min-w-0 items-center gap-3 rounded-lg border-2 border-line-1 bg-surface-1 p-2"
                    data-testid="bulk-row"
                    data-card={g.card.key}
                  >
                    <CardThumb card={g.card} scale={1} dimmed={n === 0} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-fg-1">{g.card.name}</p>
                      <RarityBadge rarity={g.card.rarity} short />
                      <p className="mt-1 nums text-xs text-fg-3">
                        {t("bulk.rowValue", { value: formatMoney(g.copies[0]!.valueCents) })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={n <= 0}
                        aria-label={t("quantity.less")}
                        onClick={() => setSelection((s) => ({ ...s, [g.card.key]: n - 1 }))}
                      >
                        −
                      </Button>
                      <span
                        className="min-w-12 text-center nums text-sm font-semibold text-fg-1"
                        data-testid="bulk-qty"
                      >
                        {t("quantity.of", { n, max: g.copies.length })}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={n >= g.copies.length}
                        aria-label={t("quantity.more")}
                        onClick={() => setSelection((s) => ({ ...s, [g.card.key]: n + 1 }))}
                      >
                        +
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div
          className="order-first min-w-0 space-y-3 rounded-lg border-2 border-line-2 bg-surface-1 p-3 shadow-2 lg:sticky lg:top-4 lg:order-none"
          data-testid="bulk-total"
        >
          <dl className="divide-y divide-line-1 rounded-md bg-surface-2 px-3">
            <FactRow label={t("bulk.count")}>{picked.length}</FactRow>
            <FactRow label={t("bulk.value")}>{formatMoney(payout.valueCents)}</FactRow>
            <FactRow label={t("bulk.fee", { rate: formatChance(10_000 - BALANCE.nexamon.quickSell.bps) })}>
              −{formatMoney(payout.feeCents)}
            </FactRow>
            <FactRow label={t("bulk.payout")} strong>
              <span data-testid="bulk-payout">{formatMoney(payout.payoutCents)}</span>
            </FactRow>
          </dl>
          <div className="space-y-3">
            <Button
              block
              size="sm"
              className="h-auto min-h-9 max-w-full px-2 py-1 text-center text-xs leading-tight whitespace-normal"
              state={sell.state}
              disabled={picked.length === 0}
              onClick={sellToGame}
              data-testid="bulk-sell-game"
            >
              {t("bulk.sellGame", { price: formatMoney(payout.payoutCents) })}
            </Button>
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-end gap-2">
              <Field
                label={t("bulk.share")}
                inputMode="numeric"
                value={share}
                onChange={(event) => setShare(event.target.value)}
                data-testid="bulk-share"
              />
              <Button
                block
                size="sm"
                className="h-auto min-h-9 max-w-full px-2 py-1 text-center text-xs leading-tight whitespace-normal"
                variant="secondary"
                state={list.state}
                disabled={picked.length === 0 || !shareOk || picked.length > BALANCE.nexamon.market.maxListings}
                onClick={listOnMarket}
                data-testid="bulk-list-market"
              >
                {t("bulk.listMarket")}
              </Button>
            </div>
          </div>
          {picked.length > BALANCE.nexamon.market.maxListings && (
            <p className="text-xs text-pretty text-fg-3">
              {t("bulk.listLimit", { max: BALANCE.nexamon.market.maxListings })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
