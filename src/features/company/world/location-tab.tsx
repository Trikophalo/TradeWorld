"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { COUNTRIES, WORLD_RULES, type CountryConfig } from "@/config/countries";
import { flagArt } from "@/components/pixel/hq";
import { useGameErrorText } from "@/features/game/errors";
import { useClockSkew, useServerClock } from "@/features/game/server-clock";
import { engine } from "@/features/game/store";
import type { WorldMine, WorldPlace, WorldState } from "@/features/game/world-types";
import { formatBps, formatMoney, formatPercentBps } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { hqTier, worldUnlockProgress } from "@/lib/sim/world";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useCompanyRefresh } from "../hooks";
import { FirmSection } from "../components/firm-layout";
import { CountrySheet, CountryTitle } from "./country-sheet";
import { countryOf, placesByCountry, useSetWorld, useWorld } from "./hooks";
import { HqEditor, HqPreview } from "./hq-editor";
import { WorldMap } from "./world-map";

const money = (cents: number) => formatMoney(cents, { whole: true });
const factorText = (f: number) => formatBps(Math.round((f - 1) * 10_000));
const tierKey = (tier: number) => WORLD_RULES.hqTiers[tier - 1]?.key ?? "office";

type Run = (key: string, action: () => Promise<WorldState>, success: { title: string; text?: string }) => Promise<void>;

/** One action at a time; the button of the running one shows loading, then success. */
function useWorldAction() {
  const setWorld = useSetWorld();
  const refresh = useCompanyRefresh();
  const errorText = useGameErrorText();
  const [busy, setBusy] = useState<{ key: string; state: ButtonState } | null>(null);
  const run: Run = async (key, action, success) => {
    setBusy({ key, state: "loading" });
    try {
      setWorld(await action());
      haptic("success");
      void playSound("success");
      toast.success(success.title, success.text, { silent: true });
      setBusy({ key, state: "success" });
      void refresh();
      setTimeout(() => setBusy((b) => (b?.key === key ? null : b)), 1200);
    } catch (error) {
      toast.error(success.title, errorText(error));
      setBusy(null);
    }
  };
  const stateOf = (key: string): ButtonState => (busy?.key === key ? busy.state : "idle");
  return { run, stateOf, busy: busy !== null };
}

/**
 * Tab "Standort" (ADR-208): locked with the progress toward 10 Mio. € company value, then the choice of the country,
 * then the own headquarters (tier, editor, upgrade), the terms of the hour, the lobby, the subsidiaries and the map
 * with every company of every player.
 */
export function LocationTab({ preview }: { preview?: WorldState } = {}) {
  const t = useTranslations("world");
  const th = useTranslations("hq.tabs");
  const live = useWorld(!preview);
  const data = preview ?? live.data;
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const action = useWorldAction();
  const byCountry = useMemo(() => placesByCountry(data?.places ?? []), [data?.places]);

  if (!data) {
    return live.isError ? (
      <EmptyState art={<PixelIcon {...UI_ICONS.globe} scale={4} />} title={t("title")} description={t("empty")} />
    ) : (
      <div className="space-y-4" aria-hidden data-testid="location-skeleton">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    );
  }

  const me = data.me;
  const worth = data.company?.worthCents ?? 0;
  const unlocked = worth >= data.unlockWorthCents;
  const country = countryOf(selected);
  const leaderOf = (key: string) => {
    const c = data.countries.find((x) => x.key === key);
    const name = c?.leaderId ? (data.places.find((p) => p.companyId === c.leaderId)?.name ?? null) : null;
    return { name, feeBps: c?.feeBps ?? 0 };
  };

  return (
    <FirmSection
      id="location"
      icon={UI_ICONS.globe}
      title={th("location")}
      description={t("tabText")}
      testId="location-tab"
    >
      {!me && !unlocked && <LockedCard worth={worth} target={data.unlockWorthCents} />}
      {!me && unlocked && (
        <Card padding="lg" className="space-y-1.5 border-accent/40 bg-accent-soft" data-testid="world-choose">
          <p className="font-semibold text-fg-1">{t("choose.title")}</p>
          <p className="text-sm text-pretty text-fg-2">{t("choose.text")}</p>
          <p className="nums text-xs text-fg-2">
            {t("choose.cost", { amount: money(WORLD_RULES.hqTiers[0]!.costCents) })}
          </p>
        </Card>
      )}
      {me && data.company && (
        <div className="grid items-start gap-4 *:min-w-0 lg:grid-cols-2 lg:gap-5">
          <HqCard
            me={me}
            name={data.company.name}
            freeCash={data.company.freeCashCents}
            onEdit={() => setEditing(true)}
            action={action}
            preview={Boolean(preview)}
          />
          <EffectCard me={me} />
          <LobbyCard me={me} preview={Boolean(preview)} action={action} />
          <SubsidiariesCard me={me} freeCash={data.company.freeCashCents} onSelect={setSelected} />
        </div>
      )}

      <Card padding="md" className="space-y-2">
        {!me && !unlocked && <p className="text-sm text-pretty text-fg-3">{t("locked.preview")}</p>}
        <WorldMap places={data.places} selected={selected} focus={me?.country} onSelect={setSelected} />
        <Legend />
        <CountryList byCountry={byCountry} mine={me} onSelect={setSelected} />
      </Card>

      <CountrySheet
        country={country ?? null}
        places={country ? (byCountry.get(country.key) ?? []) : []}
        leaderName={country ? leaderOf(country.key).name : null}
        feeBps={country ? leaderOf(country.key).feeBps : 0}
        status={country && me ? <CountryStatus me={me} country={country.key} /> : undefined}
        actions={
          country ? (
            <CountryActions
              data={data}
              country={country}
              unlocked={unlocked}
              action={action}
              preview={Boolean(preview)}
              onDone={() => setSelected(null)}
            />
          ) : undefined
        }
        onClose={() => setSelected(null)}
      />
      {me && data.company && (
        <HqEditor
          open={editing}
          onClose={() => setEditing(false)}
          tier={me.hqTier}
          style={me.hqStyle}
          name={data.company.name}
          country={countryOf(me.country)}
          preview={Boolean(preview)}
        />
      )}
    </FirmSection>
  );
}

function LockedCard({ worth, target }: { worth: number; target: number }) {
  const t = useTranslations("world.locked");
  const progress = worldUnlockProgress(worth);
  return (
    <Card padding="lg" className="space-y-3" data-testid="world-locked">
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-md bg-surface-2">
          <PixelIcon {...UI_ICONS.lock} scale={3} />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-fg-1">{t("title")}</p>
          <p className="mt-0.5 text-sm text-pretty text-fg-2">{t("text", { amount: money(target) })}</p>
        </div>
      </div>
      <Progress value={progress} label={t("progress", { now: money(worth), target: money(target) })} />
      <p className="nums text-xs text-fg-3">{t("progress", { now: money(worth), target: money(target) })}</p>
    </Card>
  );
}

function HqCard({
  me,
  name,
  freeCash,
  onEdit,
  action,
  preview,
}: {
  me: WorldMine;
  name: string;
  freeCash: number;
  onEdit: () => void;
  action: ReturnType<typeof useWorldAction>;
  preview: boolean;
}) {
  const t = useTranslations("world.hq");
  const tt = useTranslations("world.tiers");
  const c = countryOf(me.country);
  const max = WORLD_RULES.hqTiers.length;
  const next = hqTier(me.hqTier + 1);
  const noCash = me.nextTierCostCents !== null && freeCash < me.nextTierCostCents;
  return (
    <Card padding="lg" className="space-y-3" id="world-hq" data-testid="world-hq" data-tier={me.hqTier}>
      <p className="label-pixel text-fg-2">{t("title")}</p>
      <div className="flex items-end gap-4">
        <div className="grid shrink-0 place-items-center rounded-lg bg-surface-2 p-2 ring-1 ring-line-1">
          <HqPreview tier={me.hqTier} style={me.hqStyle} name={name} country={c} scale={3} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate font-semibold text-fg-1">{tt(tierKey(me.hqTier))}</p>
          {c && (
            <p className="text-sm text-fg-2">
              <CountryTitle country={c} />
            </p>
          )}
          <p className="nums text-xs text-fg-3">{t("tier", { tier: me.hqTier, max })}</p>
          <Button size="sm" variant="secondary" onClick={onEdit} data-testid="hq-edit">
            {t("edit")}
          </Button>
        </div>
      </div>
      {next ? (
        <div className="space-y-2 rounded-md bg-surface-2 p-3">
          <p className="text-xs text-fg-3">{t("nextGives")}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="info">{t("seats", { count: next.seats })}</Badge>
            <Badge tone="gain">{t("demandBonus", { pct: next.demandBps / 100 })}</Badge>
            <Badge tone="accent">{t("prestige", { points: next.prestige })}</Badge>
          </div>
          <p className="nums text-xs text-fg-2">
            {noCash ? t("noCash") : t("upgradeCost", { amount: money(next.costCents) })}
          </p>
          <Button
            block
            state={action.stateOf("upgrade")}
            disabled={(noCash || preview || action.busy) && action.stateOf("upgrade") === "idle"}
            onClick={() =>
              void action.run("upgrade", () => engine.worldUpgradeHq(crypto.randomUUID()), {
                title: t("upgraded", { name: tt(next.key) }),
                text: t("upgradedText"),
              })
            }
            data-testid="hq-upgrade"
          >
            {t("upgrade", { name: tt(next.key) })}
          </Button>
        </div>
      ) : (
        <p className="rounded-md bg-gain-soft px-3 py-2 text-sm text-gain">{t("maxed")}</p>
      )}
    </Card>
  );
}

function EffectCard({ me }: { me: WorldMine }) {
  const t = useTranslations("world.effect");
  const e = me.effect;
  const rows: { key: string; label: string; value: string; good: boolean | null }[] = [
    { key: "demand", label: t("demand"), value: factorText(e.demandFactor), good: e.demandFactor >= 1 },
    { key: "cogs", label: t("cogs"), value: factorText(e.cogsFactor), good: e.cogsFactor <= 1 },
    { key: "fixed", label: t("fixed"), value: factorText(e.fixedFactor), good: e.fixedFactor <= 1 },
    ...(e.taxRateBps !== null
      ? [{ key: "tax", label: t("tax"), value: formatPercentBps(e.taxRateBps), good: null }]
      : []),
    ...(e.subsidiaryShare > 0
      ? [
          {
            key: "share",
            label: t("share"),
            value: formatPercentBps(Math.round(e.subsidiaryShare * 10_000)),
            good: null,
          },
        ]
      : []),
  ];
  return (
    <Card padding="lg" className="space-y-3" id="world-effect" data-testid="world-effect">
      <div>
        <p className="label-pixel text-fg-2">{t("title")}</p>
        <p className="mt-1 text-sm text-pretty text-fg-3">{t("text")}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        {rows.map((r) => (
          <div key={r.key} className="rounded-sm bg-surface-2 px-2.5 py-2">
            <dt className="text-2xs text-fg-3">{r.label}</dt>
            <dd
              className={cn(
                "nums text-sm font-semibold",
                r.good === null ? "text-fg-1" : r.good ? "text-gain" : "text-loss",
              )}
              data-testid={`world-effect-${r.key}`}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function LobbyCard({
  me,
  preview,
  action,
}: {
  me: WorldMine;
  preview: boolean;
  action: ReturnType<typeof useWorldAction>;
}) {
  const t = useTranslations("world.lobby");
  const skew = useClockSkew();
  const now = useServerClock();
  const c = countryOf(me.country);
  const max = WORLD_RULES.lobby.maxFeeBps;
  const [fee, setFee] = useState(me.feeBps);
  const ready = me.feeReadyAt ? Date.parse(me.feeReadyAt) : 0;
  const cooling = now !== null && ready > now;
  return (
    <Card padding="lg" className="space-y-3" id="world-lobby" data-testid="world-lobby">
      <div className="flex items-center justify-between gap-2">
        <p className="label-pixel text-fg-2">{t("title")}</p>
        {me.leader && <Badge tone="gain">{t("leader")}</Badge>}
      </div>
      {me.leader ? (
        <>
          <p className="text-sm text-pretty text-fg-2">{t("leaderText", { country: c?.name ?? me.country })}</p>
          <Slider
            value={max > 0 ? fee / max : 0}
            onValueChange={(v) => setFee(Math.round((v * max) / 25) * 25)}
            label={t("fee")}
            marks={[0, 0.5, 1]}
            valueText={t("feeValue", { pct: (fee / 100).toLocaleString("de-DE") })}
            disabled={preview || cooling}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="nums text-xs text-fg-2">{t("feeValue", { pct: (fee / 100).toLocaleString("de-DE") })}</p>
            <Button
              size="sm"
              state={action.stateOf("fee")}
              disabled={(preview || cooling || fee === me.feeBps || action.busy) && action.stateOf("fee") === "idle"}
              onClick={() =>
                void action.run("fee", () => engine.worldSetLocationFee(crypto.randomUUID(), fee), {
                  title: t("feeSaved", { pct: (fee / 100).toLocaleString("de-DE") }),
                  text: t("feeSavedText", { country: c?.name ?? me.country }),
                })
              }
              data-testid="world-fee-save"
            >
              {t("feeSave")}
            </Button>
          </div>
          {cooling && (
            <p className="text-xs text-fg-3" role="timer">
              {t("feeCooldown")} <Countdown target={ready + skew} className="font-semibold" />
            </p>
          )}
          <p className="nums text-xs text-fg-3">{t("received", { amount: money(me.feesReceivedCents) })}</p>
        </>
      ) : me.payingFee ? (
        <div className="space-y-1 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn" data-testid="world-paying-fee">
          <p className="text-pretty">
            {t("paying", {
              leader: me.payingFee.leaderName ?? "?",
              country: c?.name ?? me.country,
              pct: (me.payingFee.feeBps / 100).toLocaleString("de-DE"),
            })}
          </p>
          <p className="text-xs text-pretty">{t("payingHint")}</p>
          <p className="nums text-xs">{t("paid", { amount: money(me.feesPaidCents) })}</p>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-sm text-fg-2">{t("free")}</p>
          <p className="text-xs text-pretty text-fg-3">{t("notLeader", { country: c?.name ?? me.country })}</p>
        </div>
      )}
    </Card>
  );
}

function SubsidiariesCard({
  me,
  freeCash,
  onSelect,
}: {
  me: WorldMine;
  freeCash: number;
  onSelect: (country: string) => void;
}) {
  const t = useTranslations("world.subsidiaries");
  const max = WORLD_RULES.subsidiaries.max;
  return (
    <Card padding="lg" className="space-y-3" id="world-subsidiaries" data-testid="world-subsidiaries">
      <div className="flex items-center justify-between gap-2">
        <p className="label-pixel text-fg-2">{t("title")}</p>
        <span className="nums text-xs text-fg-3">{t("count", { count: me.subsidiaries.length, max })}</span>
      </div>
      <p className="text-sm text-pretty text-fg-3">{me.subsidiaryUnlocked ? t("text") : t("locked")}</p>
      {me.subsidiaries.length === 0 ? (
        me.subsidiaryUnlocked && <p className="text-xs text-fg-3">{t("empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {me.subsidiaries.map((s) => {
            const c = countryOf(s.country);
            return (
              <li key={s.country}>
                <button
                  type="button"
                  onClick={() => onSelect(s.country)}
                  className="flex w-full items-center gap-3 rounded-md bg-surface-2 px-3 py-2 text-left focus-ring transition duration-fast hover:bg-surface-3 active:scale-[0.99]"
                  data-testid={`world-sub-${s.country}`}
                >
                  <span className="min-w-0 flex-1 text-sm font-medium text-fg-1">
                    {c ? <CountryTitle country={c} /> : s.country}
                  </span>
                  <span className="text-right">
                    <span className="block nums text-2xs text-fg-2">
                      {t("ramp", { pct: Math.round(s.ramp * 100) })}
                    </span>
                    <span className="block nums text-2xs text-fg-3">
                      {t("hourly", { amount: money(s.hourlyCostCents) })}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {me.subsidiaryUnlocked && me.nextSubsidiaryCostCents === null && <p className="text-xs text-fg-3">{t("full")}</p>}
      {me.subsidiaryUnlocked && me.nextSubsidiaryCostCents !== null && (
        <p className={cn("nums text-xs", freeCash < me.nextSubsidiaryCostCents ? "text-loss" : "text-fg-2")}>
          {t("openCost", { amount: money(me.nextSubsidiaryCostCents) })}
        </p>
      )}
    </Card>
  );
}

function CountryStatus({ me, country }: { me: WorldMine; country: string }) {
  const t = useTranslations("world.country");
  if (me.country === country) return <Badge tone="accent">{t("here")}</Badge>;
  if (me.subsidiaries.some((s) => s.country === country)) return <Badge tone="info">{t("sub")}</Badge>;
  return null;
}

/** What the own company can do in a country: build here, move here, open a subsidiary, run an image campaign. */
function CountryActions({
  data,
  country,
  unlocked,
  action,
  preview,
  onDone,
}: {
  data: WorldState;
  country: CountryConfig;
  unlocked: boolean;
  action: ReturnType<typeof useWorldAction>;
  preview: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("world");
  const skew = useClockSkew();
  const now = useServerClock();
  const me = data.me;
  const cash = data.company?.freeCashCents ?? 0;
  const disabled = (key: string, blocked: boolean) =>
    (blocked || preview || action.busy) && action.stateOf(key) === "idle";
  const go = async (key: string, run: () => Promise<WorldState>, success: { title: string; text?: string }) => {
    await action.run(key, run, success);
    onDone();
  };
  const blocks: ReactNode[] = [];

  if (!data.company) return null;
  if (!me) {
    if (!unlocked)
      return <p className="rounded-sm bg-surface-2 px-3 py-2 text-xs text-fg-3">{t("country.lockedHint")}</p>;
    const cost = WORLD_RULES.hqTiers[0]!.costCents;
    return (
      <div className="space-y-1.5">
        <p className="nums text-xs text-fg-2">{t("country.placeCost", { amount: money(cost) })}</p>
        <Button
          block
          state={action.stateOf("place")}
          disabled={disabled("place", cash < cost)}
          onClick={() =>
            void go("place", () => engine.worldPlaceHq(crypto.randomUUID(), country.key), {
              title: t("hq.placed", { country: country.name }),
              text: t("hq.placedText"),
            })
          }
          data-testid="world-place"
        >
          {t("country.place")}
        </Button>
        {cash < cost && <p className="text-xs text-loss">{t("hq.noCash")}</p>}
      </div>
    );
  }

  const isHq = me.country === country.key;
  const isSub = me.subsidiaries.some((s) => s.country === country.key);
  if (isHq || isSub) {
    const img = me.image[country.key];
    const ready = img?.readyAt ? Date.parse(img.readyAt) : 0;
    const cooling = now !== null && ready > now;
    const cost = me.imageCampaignCostCents;
    blocks.push(
      <div key="image" className="space-y-1.5 rounded-md bg-surface-2 p-3" data-testid="world-image">
        <p className="text-sm font-semibold text-fg-1">{t("image.title")}</p>
        <p className="text-xs text-pretty text-fg-3">{t("image.text")}</p>
        {img && img.bonusBps > 0 && (
          <p className="nums text-xs text-gain">
            {t("image.bonus", { pct: (img.bonusBps / 100).toLocaleString("de-DE") })}
          </p>
        )}
        {cooling ? (
          <p className="text-xs text-fg-3" role="timer">
            {t("image.ready")} <Countdown target={ready + skew} className="font-semibold" />
          </p>
        ) : (
          <p className="nums text-xs text-fg-2">{t("image.cost", { amount: money(cost) })}</p>
        )}
        <Button
          size="sm"
          state={action.stateOf("image")}
          disabled={disabled("image", cooling || cash < cost)}
          onClick={() =>
            void action.run("image", () => engine.worldImageCampaign(crypto.randomUUID(), country.key), {
              title: t("image.done", { country: country.name }),
              text: t("image.doneText", { pct: WORLD_RULES.imageCampaign.gainBps / 100 }),
            })
          }
          data-testid="world-image-start"
        >
          {t("image.button")}
        </Button>
      </div>,
    );
  }
  if (isSub) {
    blocks.push(
      <div key="close" className="space-y-1">
        <Button
          size="sm"
          variant="danger"
          state={action.stateOf("close")}
          disabled={disabled("close", false)}
          onClick={() =>
            void go("close", () => engine.worldCloseSubsidiary(crypto.randomUUID(), country.key), {
              title: t("subsidiaries.closed", { country: country.name }),
            })
          }
          data-testid="world-sub-close"
        >
          {t("subsidiaries.close")}
        </Button>
        <p className="text-2xs text-fg-3">{t("subsidiaries.closeHint")}</p>
      </div>,
    );
  }
  if (!isHq && !isSub) {
    const ready = Date.parse(me.relocateReadyAt);
    const cooling = now !== null && ready > now;
    blocks.push(
      <div key="move" className="space-y-1.5 rounded-md bg-surface-2 p-3">
        {cooling ? (
          <p className="text-xs text-fg-3" role="timer">
            {t("relocate.cooldown")} <Countdown target={ready + skew} className="font-semibold" />
          </p>
        ) : (
          <p className="nums text-xs text-fg-2">{t("relocate.cost", { amount: money(me.relocationCostCents) })}</p>
        )}
        <Button
          size="sm"
          variant="secondary"
          state={action.stateOf("move")}
          disabled={disabled("move", cooling || cash < me.relocationCostCents)}
          onClick={() =>
            void go("move", () => engine.worldRelocateHq(crypto.randomUUID(), country.key), {
              title: t("relocate.done", { country: country.name }),
              text: t("relocate.doneText"),
            })
          }
          data-testid="world-relocate"
        >
          {t("relocate.button")}
        </Button>
      </div>,
    );
    const subCost = me.nextSubsidiaryCostCents;
    blocks.push(
      <div key="sub" className="space-y-1.5 rounded-md bg-surface-2 p-3">
        <p className="text-sm font-semibold text-fg-1">{t("subsidiaries.title")}</p>
        <p className="text-xs text-pretty text-fg-3">
          {!me.subsidiaryUnlocked
            ? t("subsidiaries.locked")
            : subCost === null
              ? t("subsidiaries.full")
              : t("subsidiaries.openCost", { amount: money(subCost) })}
        </p>
        <Button
          size="sm"
          state={action.stateOf("sub")}
          disabled={disabled("sub", !me.subsidiaryUnlocked || subCost === null || cash < (subCost ?? 0))}
          onClick={() =>
            void go("sub", () => engine.worldOpenSubsidiary(crypto.randomUUID(), country.key), {
              title: t("subsidiaries.opened", { country: country.name }),
              text: t("subsidiaries.openedText"),
            })
          }
          data-testid="world-sub-open"
        >
          {t("subsidiaries.open")}
        </Button>
      </div>,
    );
  }
  return <div className="space-y-2">{blocks}</div>;
}

/** Every country as a chip under the map: the same choice without panning, for small screens and keyboards. */
function CountryList({
  byCountry,
  mine,
  onSelect,
}: {
  byCountry: Map<string, WorldPlace[]>;
  mine: WorldMine | null;
  onSelect: (country: string) => void;
}) {
  const t = useTranslations("world.map");
  const list = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name, "de"));
  return (
    <div className="space-y-1.5">
      <p className="label-pixel text-fg-2">{t("countries")}</p>
      <ul className="flex flex-wrap gap-1.5" data-testid="world-country-list">
        {list.map((c) => {
          const count = byCountry.get(c.key)?.length ?? 0;
          const own = mine?.country === c.key || (mine?.subsidiaries.some((s) => s.country === c.key) ?? false);
          return (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => {
                  haptic("tap");
                  onSelect(c.key);
                }}
                data-testid={`world-chip-${c.key}`}
                className={cn(
                  "flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs ring-1 focus-ring transition duration-fast active:scale-95",
                  own ? "bg-accent-soft text-accent ring-accent" : "bg-surface-2 text-fg-2 ring-line-1 hover:text-fg-1",
                )}
              >
                <PixelIcon {...flagArt(c.flag, c.flagVertical)} scale={2} />
                {c.name}
                {count > 0 && <span className="nums text-2xs text-fg-3">{count}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Legend() {
  const t = useTranslations("world.map");
  const items: { label: string; className: string }[] = [
    { label: t("legendMine"), className: "ring-accent" },
    { label: t("legendHq"), className: "ring-line-2" },
  ];
  return (
    <ul className="flex flex-wrap gap-3 text-2xs text-fg-3">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={cn("inline-block size-3 rounded-xs bg-surface-1 ring-2", i.className)} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
