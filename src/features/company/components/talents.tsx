"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { avatarArt } from "@/components/pixel/avatars";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { TALENT_BENEFITS } from "@/config/talents";
import { useGameErrorText } from "@/features/game/errors";
import { useClockSkew } from "@/features/game/server-clock";
import { engine } from "@/features/game/store";
import type {
  CompanyTalentsState,
  OwnTalent,
  Talent,
  TalentEffectKind,
  TalentFacts,
  TalentMarketState,
} from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import {
  talentCoCeoEligible,
  talentMood,
  talentOfferChecks,
  talentOfferCost,
  type OfferCheckKey,
} from "@/lib/sim/talents";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useCompanyRefresh } from "../hooks";

export const COMPANY_TALENTS_KEY = ["company", "talents"] as const;
export const TALENT_MARKET_KEY = ["company", "talentMarket"] as const;
/** The org chart lists the talents (ADR-199); every hire, dismissal and co-CEO change refreshes it. */
const ORG_KEY = ["company", "org"] as const;

const cfg = BALANCE.talents;

type T = ReturnType<typeof useTranslations<"talents">>;
type Key = Parameters<T>[0];
const k = (key: string) => key as Key;

/** Pixel icon per Stelle (ADR-199). */
const ROLE_ICONS: Record<string, keyof typeof UI_ICONS> = {
  sales: "deal",
  marketing: "news",
  customer_service: "heart",
  strategy: "flame",
  production: "upgrade",
  logistics: "briefcase",
  it: "robot",
  company_doctor: "gift",
  purchasing: "portfolio",
  controlling: "markets",
  accounting: "crypto",
  science: "search",
  quality: "star",
  legal: "lock",
  hr: "profile",
};
const roleIcon = (role: string) => UI_ICONS[ROLE_ICONS[role] ?? "briefcase"];

export const talentName = (t: Pick<Talent, "firstName" | "lastName">) => `${t.firstName} ${t.lastName}`;
const pct = (bps: number, digits = 1) => (bps / 100).toLocaleString("de-DE", { maximumFractionDigits: digits });

/** "Nachfrage +3 %" for a talent effect in its units. */
export function talentEffectText(t: T, effect: TalentEffectKind, bps: number): string {
  return t(k(`effects.${effect}`), { pct: pct(bps, 2) });
}

function Stars({ tier }: { tier: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cn("size-1.5 rounded-xs", i <= tier ? "bg-gold" : "bg-surface-3")} />
      ))}
    </span>
  );
}

function Portrait({ talent, scale = 2 }: { talent: Pick<Talent, "avatar">; scale?: number }) {
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-md bg-surface-2 p-1">
      <PixelIcon {...avatarArt(talent.avatar)} scale={scale} />
    </span>
  );
}

const roleEffect = (role: string) => cfg.roles.find((r) => r.key === role)?.effect ?? "demand";

/**
 * Stellen & Talente (ADR-199): the 15 seats of the own company with their talents, a talent market with filters,
 * a detail sheet and an offer sheet with live checks. Mit-Geschäftsführung on the sheet of an own talent.
 */
export function TalentsCard({
  preview,
  previewMarket,
}: { preview?: CompanyTalentsState; previewMarket?: TalentMarketState } = {}) {
  const t = useTranslations("talents");
  const [view, setView] = useState<"seats" | "market">("seats");
  const [role, setRole] = useState<string | null>(null);
  const live = useQuery({
    queryKey: COMPANY_TALENTS_KEY,
    queryFn: () => engine.companyTalents(),
    refetchInterval: 30_000,
    enabled: !preview,
  });
  const data = preview ?? live.data;

  return (
    <Card padding="lg" className="space-y-4" id="talents" data-testid="company-talents" data-tour="talents">
      <div>
        <p className="label-pixel text-fg-2">{t("title")}</p>
        <p className="mt-1 text-sm text-pretty text-fg-3">{t("intro")}</p>
      </div>
      <Segmented
        value={view}
        onValueChange={setView}
        label={t("title")}
        block
        options={[
          { value: "seats", label: t("views.seats") },
          { value: "market", label: t("views.market") },
        ]}
      />
      {!data ? (
        live.isError ? (
          <EmptyState art={<PixelIcon {...UI_ICONS.lock} scale={4} />} title={t("title")} description={t("empty")} />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-md" />
            ))}
          </div>
        )
      ) : view === "seats" ? (
        <SeatsView
          data={data}
          preview={Boolean(preview)}
          onFind={(r) => {
            setRole(r);
            setView("market");
          }}
        />
      ) : (
        <MarketView data={data} role={role} setRole={setRole} preview={previewMarket} />
      )}
    </Card>
  );
}

function SeatsView({
  data,
  preview,
  onFind,
}: {
  data: CompanyTalentsState;
  preview: boolean;
  onFind: (role: string) => void;
}) {
  const t = useTranslations("talents");
  const [open, setOpen] = useState<OwnTalent | null>(null);
  const filled = data.seats.filter((s) => s.talent).length;
  const kinds = (Object.keys(data.effectBps) as TalentEffectKind[]).filter((x) => data.effectBps[x] > 0);
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-surface-2 px-3 py-2.5" data-testid="talents-total">
        <p className="nums text-xs font-medium text-fg-2">{t("seat.filled", { filled, total: data.seats.length })}</p>
        <p className="mt-1 text-2xs text-fg-3">{t("total")}</p>
        {kinds.length === 0 ? (
          <p className="mt-0.5 text-sm text-pretty text-fg-2">{t("totalNone")}</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {kinds.map((x) => (
              <li key={x}>
                <Badge tone="gain">
                  <span className="nums">
                    {talentEffectText(t, x, data.effectBps[x])} · {t("capLabel")}{" "}
                    {talentEffectText(t, x, data.capBps[x])}
                  </span>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.incoming.length > 0 && <Incoming data={data} />}

      <ul className="grid gap-2.5 *:min-w-0 sm:grid-cols-2 lg:grid-cols-3" data-testid="talent-seats">
        {data.seats.map((s) => (
          <li key={s.role}>
            {s.talent ? (
              <FilledSeat talent={s.talent} onOpen={() => setOpen(s.talent)} />
            ) : (
              <div
                className="flex h-full flex-col rounded-md border-2 border-dashed border-line-2 bg-surface-1 p-3"
                data-testid={`talent-seat-${s.role}`}
                data-filled="false"
              >
                <div className="flex items-center gap-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2 opacity-60">
                    <PixelIcon {...roleIcon(s.role)} scale={2} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-fg-1">{t(k(`roles.${s.role}`))}</p>
                    <p className="text-2xs text-warn">{t("seat.vacant")}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-pretty text-fg-3">{t(k(`roleText.${s.role}`))}</p>
                <div className="mt-auto pt-2.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={preview}
                    onClick={() => onFind(s.role)}
                    data-testid={`talent-find-${s.role}`}
                  >
                    {t("seat.find")}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <TalentLog data={data} />
      {open && <TalentSheet talent={open} facts={data.facts} own onClose={() => setOpen(null)} />}
    </div>
  );
}

function FilledSeat({ talent, onOpen }: { talent: OwnTalent; onOpen: () => void }) {
  const t = useTranslations("talents");
  const mood = talentMood(talent.satisfactionBps);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-full w-full flex-col rounded-md border bg-surface-1 p-3 text-left transition duration-fast",
        "focus-ring hover:bg-surface-2 active:scale-[0.99]",
        mood === "warning" ? "border-warn" : "border-line-1",
      )}
      data-testid={`talent-seat-${talent.role}`}
      data-filled="true"
    >
      <div className="flex items-start gap-2.5">
        <Portrait talent={talent} />
        <div className="min-w-0 flex-1">
          <p className="text-2xs text-fg-3">{t(k(`roles.${talent.role}`))}</p>
          <p className="truncate text-sm font-semibold text-fg-1">{talentName(talent)}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Stars tier={talent.tier} />
            <span className="text-2xs text-fg-3">{t(k(`tiers.${talent.tier}`))}</span>
            {talent.isCoCeo && <Badge tone="accent">{t("seat.coceo")}</Badge>}
          </div>
        </div>
      </div>
      <p className="mt-2 nums text-xs font-medium text-gain">
        {talentEffectText(t, roleEffect(talent.role), talent.effectBps)}
      </p>
      <div className="mt-2">
        <Progress
          value={talent.satisfactionBps / 10_000}
          label={t("seat.satisfaction")}
          tone={mood === "warning" ? "warn" : mood === "happy" ? "gain" : "accent"}
          size="sm"
        />
      </div>
      {mood === "warning" && <p className="mt-1.5 text-2xs font-medium text-warn">{t("seat.warning")}</p>}
      <p className="mt-auto pt-1.5 nums text-2xs text-fg-3">
        {t("seat.cost", { amount: formatMoney(talent.costCents, { whole: true }) })}
      </p>
    </button>
  );
}

function Incoming({ data }: { data: CompanyTalentsState }) {
  const t = useTranslations("talents");
  const skew = useClockSkew();
  const [counter, setCounter] = useState<CompanyTalentsState["incoming"][number] | null>(null);
  const byKey = new Map(data.seats.flatMap((s) => (s.talent ? [[s.talent.key, s.talent] as const] : [])));
  const talent = counter ? byKey.get(counter.talentKey) : undefined;
  return (
    <div className="space-y-2 rounded-md border border-warn bg-warn-soft p-3" data-testid="talent-incoming">
      <p className="label-pixel text-warn">{t("incoming.title")}</p>
      <ul className="space-y-2">
        {data.incoming.map((o) => {
          const who = byKey.get(o.talentKey);
          return (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-1">
              <span className="min-w-0 text-pretty">
                {t("incoming.text", {
                  from: o.fromName,
                  name: who ? talentName(who) : o.talentKey,
                  amount: formatMoney(o.costCents, { whole: true }),
                })}{" "}
                <Countdown target={Date.parse(o.expiresAt) + skew} className="font-semibold" />
              </span>
              <Button size="sm" onClick={() => setCounter(o)} data-testid="talent-counter">
                {t("incoming.counter")}
              </Button>
            </li>
          );
        })}
      </ul>
      {counter && talent && (
        <OfferSheet
          talent={talent}
          facts={data.facts}
          mode={{ kind: "counter", offerId: counter.id, minCost: counter.costCents }}
          onClose={() => setCounter(null)}
        />
      )}
    </div>
  );
}

function TalentLog({ data }: { data: CompanyTalentsState }) {
  const t = useTranslations("talents");
  const client = useQueryClient();
  const errorText = useGameErrorText();
  const [busy, setBusy] = useState<number | null>(null);
  const undo = async (id: number) => {
    setBusy(id);
    try {
      client.setQueryData(COMPANY_TALENTS_KEY, await engine.undoTalentDecision(crypto.randomUUID(), id));
      toast.success(t("log.undone"));
    } catch (error) {
      toast.error(t("log.title"), errorText(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div data-testid="talent-log">
      <p className="label-pixel text-fg-2">{t("log.title")}</p>
      {data.events.length === 0 ? (
        <p className="mt-1 text-xs text-fg-3">{t("log.none")}</p>
      ) : (
        <ul className="mt-1.5 divide-y divide-line-1 text-xs">
          {data.events.slice(0, 8).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 text-pretty text-fg-2">
                {t.has(k(`log.kinds.${e.kind}`))
                  ? t(k(`log.kinds.${e.kind}`), {
                      name: String(e.payload.name ?? ""),
                      text: String(e.payload.text ?? ""),
                    })
                  : e.kind}
                {e.costCents > 0 && (
                  <span className="nums text-fg-3"> · {formatMoney(e.costCents, { whole: true })}</span>
                )}
              </span>
              {e.reversible && (
                <Button
                  size="sm"
                  variant="ghost"
                  state={busy === e.id ? "loading" : "idle"}
                  onClick={() => void undo(e.id)}
                >
                  {t("log.undo")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Show = "all" | "free" | "employed";
type Sort = "quality" | "price";

function MarketView({
  data,
  role,
  setRole,
  preview,
}: {
  data: CompanyTalentsState;
  role: string | null;
  setRole: (role: string | null) => void;
  preview?: TalentMarketState;
}) {
  const t = useTranslations("talents");
  const [tier, setTier] = useState<number | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<Sort>("quality");
  const [open, setOpen] = useState<Talent | null>(null);
  const live = useQuery({
    queryKey: [...TALENT_MARKET_KEY, role],
    queryFn: () => engine.talentMarket(role),
    refetchInterval: 60_000,
    enabled: !preview,
  });
  const market = preview ?? live.data;
  const list = useMemo(() => {
    const rows = (market?.talents ?? []).filter(
      (x) =>
        (role === null || x.role === role) &&
        (tier === null || x.tier === tier) &&
        (show === "all" ||
          (show === "free" ? x.status === "available" : x.status === "employed" || x.status === "mine")),
    );
    return rows.sort((a, b) =>
      sort === "quality" ? b.tier - a.tier || b.effectBps - a.effectBps : a.wageDemandCents - b.wageDemandCents,
    );
  }, [market, role, tier, show, sort]);

  const chip = (active: boolean) =>
    cn(
      "rounded-sm px-2 py-1 text-2xs font-medium focus-ring transition duration-fast",
      active ? "bg-accent-strong text-on-accent" : "bg-surface-2 text-fg-2 hover:bg-surface-3",
    );

  return (
    <div className="space-y-3" data-testid="talent-market">
      <div>
        <p className="text-2xs text-fg-3">{t("market.role")}</p>
        <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={t("market.role")}>
          <button
            type="button"
            className={chip(role === null)}
            aria-pressed={role === null}
            onClick={() => setRole(null)}
          >
            {t("market.all")}
          </button>
          {cfg.roles.map((r) => (
            <button
              key={r.key}
              type="button"
              className={chip(role === r.key)}
              aria-pressed={role === r.key}
              onClick={() => setRole(r.key)}
              data-testid={`talent-role-${r.key}`}
            >
              {t(k(`roles.${r.key}`))}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-2xs text-fg-3">{t("market.tier")}</p>
        <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={t("market.tier")}>
          <button
            type="button"
            className={chip(tier === null)}
            aria-pressed={tier === null}
            onClick={() => setTier(null)}
          >
            {t("market.all")}
          </button>
          {[0, 1, 2, 3, 4].map((x) => (
            <button
              key={x}
              type="button"
              className={chip(tier === x)}
              aria-pressed={tier === x}
              onClick={() => setTier(x)}
            >
              {t(k(`tiers.${x}`))}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Segmented
          size="sm"
          block
          value={show}
          onValueChange={setShow}
          label={t("market.show")}
          options={[
            { value: "all", label: t("market.showAll") },
            { value: "free", label: t("market.showFree") },
            { value: "employed", label: t("market.showEmployed") },
          ]}
        />
        <Segmented
          size="sm"
          block
          value={sort}
          onValueChange={setSort}
          label={t("market.sort")}
          options={[
            { value: "quality", label: t("market.sortQuality") },
            { value: "price", label: t("market.sortPrice") },
          ]}
        />
      </div>
      <p className="text-2xs text-pretty text-fg-3">{t("market.refresh")}</p>
      {!market ? (
        <div className="grid gap-2 sm:grid-cols-2" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-md" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          art={<PixelIcon {...UI_ICONS.search} scale={4} />}
          title={t("market.none")}
          description={t("market.refresh")}
        />
      ) : (
        <>
          <p className="nums text-2xs text-fg-3">{t("market.count", { count: list.length })}</p>
          <ul className="grid gap-2 *:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
            {list.slice(0, 60).map((x) => (
              <li key={x.key}>
                <button
                  type="button"
                  onClick={() => setOpen(x)}
                  className="flex w-full items-start gap-2.5 rounded-md border border-line-1 bg-surface-1 p-2.5 text-left focus-ring transition duration-fast hover:bg-surface-2 active:scale-[0.99]"
                  data-testid={`talent-card-${x.key}`}
                  data-status={x.status}
                >
                  <Portrait talent={x} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg-1">{talentName(x)}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-2xs text-fg-3">
                      <Stars tier={x.tier} />
                      {t(k(`tiers.${x.tier}`))} · {t(k(`roles.${x.role}`))}
                    </span>
                    <span className="mt-0.5 block truncate text-2xs text-fg-3">
                      {x.traits.map((tr) => t(k(`traits.${tr}`))).join(" · ")}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center justify-between gap-1.5">
                      <span className="nums text-xs font-medium text-fg-1">
                        {t("market.wage", { amount: formatMoney(x.wageDemandCents, { whole: true }) })}
                      </span>
                      <StatusBadge talent={x} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {open && <TalentSheet talent={open} facts={market?.facts ?? data.facts} onClose={() => setOpen(null)} />}
    </div>
  );
}

function StatusBadge({ talent }: { talent: Talent }) {
  const t = useTranslations("talents");
  const tone =
    talent.status === "available"
      ? "gain"
      : talent.status === "mine"
        ? "accent"
        : talent.status === "employed"
          ? "info"
          : "neutral";
  return (
    <Badge tone={tone} className="max-w-full truncate">
      {t(k(`status.${talent.status}`), { name: talent.employer?.name ?? "" })}
    </Badge>
  );
}

function TalentSheet({
  talent,
  facts,
  own,
  onClose,
}: {
  talent: Talent | OwnTalent;
  facts: TalentFacts | null;
  own?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("talents");
  const client = useQueryClient();
  const refresh = useCompanyRefresh();
  const errorText = useGameErrorText();
  const [offer, setOffer] = useState<null | "hire" | "poach" | "coceo">(null);
  const [state, setState] = useState<ButtonState>("idle");
  const mine = own ? (talent as OwnTalent) : null;
  const canOffer = !own && facts !== null && (talent.status === "available" || talent.status === "employed");

  const dismiss = async () => {
    setState("loading");
    try {
      client.setQueryData(COMPANY_TALENTS_KEY, await engine.dismissTalent(crypto.randomUUID(), talent.key));
      toast.success(t("detail.dismissed", { name: talentName(talent) }));
      void client.invalidateQueries({ queryKey: TALENT_MARKET_KEY });
      void client.invalidateQueries({ queryKey: ORG_KEY });
      void refresh();
      onClose();
    } catch (error) {
      toast.error(talentName(talent), errorText(error));
      setState("idle");
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={talentName(talent)}
      description={`${t(k(`tiers.${talent.tier}`))} · ${t(k(`roles.${talent.role}`))}`}
    >
      <div className="space-y-4 text-sm" data-testid="talent-sheet">
        <div className="flex items-center gap-3">
          <Portrait talent={talent} scale={3} />
          <div className="min-w-0">
            <Stars tier={talent.tier} />
            <p className="mt-1 nums text-xs font-medium text-gain">
              {t("detail.effect")}: {talentEffectText(t, roleEffect(talent.role), talent.effectBps)}
            </p>
            <div className="mt-1">
              <StatusBadge talent={talent} />
            </div>
          </div>
        </div>

        <section>
          <p className="label-pixel text-fg-2">{t("detail.personality")}</p>
          <ul className="mt-1.5 space-y-1.5">
            {talent.traits.map((tr) => (
              <li key={tr} className="rounded-sm bg-surface-2 px-2.5 py-1.5">
                <p className="text-xs font-semibold text-fg-1">{t(k(`traits.${tr}`))}</p>
                <p className="text-2xs text-pretty text-fg-3">{t(k(`traitText.${tr}`))}</p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <p className="label-pixel text-fg-2">{t("detail.demands")}</p>
          <ul className="mt-1.5 space-y-1 text-xs text-fg-2">
            <li className="nums">
              {t("detail.wage", { amount: formatMoney(talent.wageDemandCents, { whole: true }) })}
            </li>
            <li>
              {talent.benefitDemands.length > 0
                ? t("detail.benefits", { list: talent.benefitDemands.map((b) => t(k(`benefits.${b}`))).join(", ") })
                : t("detail.noBenefits")}
            </li>
            {talent.minReputation > 0 && (
              <li className="nums">{t("detail.reputation", { value: talent.minReputation })}</li>
            )}
            {talent.minAwarenessBps > 0 && (
              <li className="nums">{t("detail.awareness", { value: pct(talent.minAwarenessBps) })}</li>
            )}
            {talent.minForm > 0 && <li>{t("detail.form", { form: t(k(`forms.${talent.minForm}`)) })}</li>}
          </ul>
        </section>

        {talent.employer && !own && (
          <section className="rounded-sm bg-surface-2 px-2.5 py-2 text-xs">
            <p className="text-fg-3">{t("detail.employer")}</p>
            <p className="font-semibold text-fg-1">{talent.employer.name}</p>
            {talent.poachMinCostCents !== null && (
              <p className="mt-0.5 nums text-fg-2">
                {t("detail.poachMin", { amount: formatMoney(talent.poachMinCostCents, { whole: true }) })}
              </p>
            )}
          </section>
        )}

        {mine && (
          <section className="space-y-2 rounded-sm bg-surface-2 px-2.5 py-2 text-xs">
            <p className="nums text-fg-2">
              {t("detail.contract", {
                wage: formatMoney(mine.wageCents, { whole: true }),
                cost: formatMoney(mine.costCents, { whole: true }),
              })}
            </p>
            <Progress value={mine.satisfactionBps / 10_000} label={t("seat.satisfaction")} size="sm" />
            <p className="text-2xs text-pretty text-fg-3">{t("seat.leads")}</p>
          </section>
        )}

        {mine?.isCoCeo && <CoCeoPanel talent={mine} />}

        <div className="flex flex-wrap gap-2">
          {canOffer && (
            <Button
              onClick={() => setOffer(talent.status === "employed" ? "poach" : "hire")}
              disabled={talent.offerPending}
              data-testid="talent-make-offer"
            >
              {talent.status === "employed" ? t("detail.poach") : t("detail.offer")}
            </Button>
          )}
          {mine && !mine.isCoCeo && (
            <Button
              variant="secondary"
              disabled={!talentCoCeoEligible(mine)}
              onClick={() => setOffer("coceo")}
              data-testid="talent-appoint"
            >
              {t("detail.appoint")}
            </Button>
          )}
          {mine && (
            <Button variant="danger" state={state} onClick={() => void dismiss()} data-testid="talent-dismiss">
              {t("detail.dismiss")}
            </Button>
          )}
        </div>
        {mine && !mine.isCoCeo && !talentCoCeoEligible(mine) && (
          <p className="text-2xs text-fg-3">{t("detail.notEligible")}</p>
        )}
      </div>
      {offer && facts && (
        <OfferSheet
          talent={talent}
          facts={facts}
          mode={
            offer === "coceo"
              ? { kind: "coceo" }
              : offer === "poach"
                ? { kind: "poach", minCost: talent.poachMinCostCents ?? 0 }
                : { kind: "hire" }
          }
          onClose={() => {
            setOffer(null);
            onClose();
          }}
        />
      )}
    </Sheet>
  );
}

type OfferMode =
  | { kind: "hire" }
  | { kind: "poach"; minCost: number }
  | { kind: "counter"; offerId: string; minCost: number }
  | { kind: "coceo" };

function OfferSheet({
  talent,
  facts,
  mode,
  onClose,
}: {
  talent: Talent | OwnTalent;
  facts: TalentFacts;
  mode: OfferMode;
  onClose: () => void;
}) {
  const t = useTranslations("talents");
  const client = useQueryClient();
  const refresh = useCompanyRefresh();
  const errorText = useGameErrorText();
  const own = "wageCents" in talent ? talent : null;
  const coceoMin = Math.ceil((talent.wageDemandCents * (10_000 + cfg.coCeo.wageBonusBps)) / 10_000 / 100) * 100;
  const startWage =
    mode.kind === "coceo"
      ? Math.max(coceoMin, own?.wageCents ?? 0)
      : Math.max(talent.wageDemandCents, own?.wageCents ?? 0);
  const [wageEuro, setWageEuro] = useState(String(Math.round(startWage / 100)));
  const [benefits, setBenefits] = useState<string[]>(
    mode.kind === "coceo"
      ? [...new Set([...(own?.benefits ?? []), "say"])]
      : [...new Set([...talent.benefitDemands, ...(own?.benefits ?? [])])],
  );
  const [autonomy, setAutonomy] = useState<"advise" | "decide">("advise");
  const [budgetEuro, setBudgetEuro] = useState("1000");
  const [state, setState] = useState<ButtonState>("idle");
  const wageCents = Math.max(0, Math.round(Number(wageEuro) || 0)) * 100;
  const cost = talentOfferCost(wageCents, benefits);

  const checks: { key: OfferCheckKey | "poach" | "counter"; ok: boolean }[] = useMemo(() => {
    // the seat and the reserve of the current employer do not count against an own talent
    const base = talentOfferChecks(
      {
        ...talent,
        wageCents: mode.kind === "coceo" ? coceoMin : talent.wageDemandCents,
        benefits: talent.benefitDemands,
      },
      { wageCents, benefits },
      facts,
    );
    const list: { key: OfferCheckKey | "poach" | "counter"; ok: boolean }[] =
      mode.kind === "counter" || mode.kind === "coceo"
        ? base.filter((c) => c.key === "wage" || c.key === "benefits" || (mode.kind === "coceo" && c.key === "cash"))
        : base;
    if (mode.kind === "poach") list.push({ key: "poach", ok: cost >= mode.minCost });
    if (mode.kind === "counter") list.push({ key: "counter", ok: cost >= mode.minCost });
    return list;
  }, [talent, wageCents, benefits, facts, mode, cost, coceoMin]);
  const allOk = checks.every((c) => c.ok) && wageCents > 0;

  const toggle = (b: string, on: boolean) =>
    setBenefits((cur) => (on ? [...new Set([...cur, b])] : cur.filter((x) => x !== b)));

  const send = async () => {
    setState("loading");
    const id = crypto.randomUUID();
    try {
      let next: CompanyTalentsState;
      if (mode.kind === "counter") next = await engine.counterTalentOffer(id, mode.offerId, wageCents, benefits);
      else if (mode.kind === "coceo")
        next = await engine.appointCoCeo(
          id,
          talent.key,
          wageCents,
          autonomy,
          Math.max(0, Math.round(Number(budgetEuro) || 0)) * 100,
        );
      else next = await engine.offerTalent(id, talent.key, wageCents, benefits);
      client.setQueryData(COMPANY_TALENTS_KEY, next);
      void client.invalidateQueries({ queryKey: TALENT_MARKET_KEY });
      void client.invalidateQueries({ queryKey: ORG_KEY });
      haptic("success");
      void playSound("success");
      const name = talentName(talent);
      if (mode.kind === "counter") toast.success(t("offer.countered", { name }));
      else if (mode.kind === "coceo") toast.success(t("offer.appointed", { name }));
      else if (next.result === "pending")
        toast.success(t("offer.pending"), t("offer.pendingText", { name, minutes: cfg.poach.counterMinutes }));
      else toast.success(t("offer.hired", { name }), t("offer.hiredText", { role: t(k(`roles.${talent.role}`)) }));
      setState("success");
      void refresh();
      onClose();
    } catch (error) {
      toast.error(talentName(talent), errorText(error));
      setState("idle");
    }
  };

  const title =
    mode.kind === "counter"
      ? t("offer.titleCounter", { name: talentName(talent) })
      : mode.kind === "coceo"
        ? t("offer.titleCoceo", { name: talentName(talent) })
        : mode.kind === "poach"
          ? t("offer.titlePoach", { name: talentName(talent) })
          : t("offer.titleHire", { name: talentName(talent) });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={title}>
      <div className="space-y-4 text-sm" data-testid="talent-offer-sheet">
        {mode.kind === "coceo" && (
          <p className="text-xs text-pretty text-fg-3">
            {t("offer.coceoNeeds", { pct: pct(cfg.coCeo.wageBonusBps, 0) })}
          </p>
        )}
        <Field
          label={t("offer.wage")}
          inputMode="numeric"
          type="number"
          min={1}
          step={1}
          value={wageEuro}
          onChange={(e) => setWageEuro(e.target.value)}
          data-testid="talent-offer-wage"
        />
        <div>
          <p className="label-pixel text-fg-2">{t("offer.benefits")}</p>
          <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {TALENT_BENEFITS.map((b) => {
              const wanted = talent.benefitDemands.includes(b);
              const bps = cfg.benefitCostBps[b];
              return (
                <li key={b} className="flex items-center justify-between gap-2 rounded-sm bg-surface-2 px-2.5 py-1.5">
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-fg-1">
                      {t(k(`benefits.${b}`))}
                      {wanted && <span className="text-warn"> · {t("offer.wanted")}</span>}
                    </span>
                    <span className="nums text-2xs text-fg-3">
                      {bps > 0 ? t("offer.benefitCost", { pct: pct(bps, 0) }) : t("offer.free")}
                    </span>
                  </span>
                  <Switch
                    checked={benefits.includes(b)}
                    onCheckedChange={(on) => toggle(b, on)}
                    label={t(k(`benefits.${b}`))}
                    disabled={mode.kind === "coceo" && b === "say"}
                  />
                </li>
              );
            })}
          </ul>
        </div>
        {mode.kind === "coceo" && (
          <div className="space-y-3">
            <Segmented
              value={autonomy}
              onValueChange={setAutonomy}
              label={t("offer.autonomy")}
              block
              options={[
                { value: "advise", label: t("offer.advise") },
                { value: "decide", label: t("offer.decide") },
              ]}
            />
            <Field
              label={t("offer.budget")}
              hint={t("offer.budgetHint")}
              inputMode="numeric"
              type="number"
              min={0}
              max={cfg.coCeo.maxBudgetCents / 100}
              value={budgetEuro}
              onChange={(e) => setBudgetEuro(e.target.value)}
            />
          </div>
        )}
        <div>
          <p className="label-pixel text-fg-2">{t("offer.checks")}</p>
          <ul className="mt-1.5 space-y-1" data-testid="talent-offer-checks">
            {checks.map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-2 text-xs" data-ok={c.ok}>
                <span className="text-fg-2">{t(k(`offer.check.${c.key}`), { hours: cfg.cashCoverHours })}</span>
                <Badge tone={c.ok ? "gain" : "loss"}>{c.ok ? t("offer.met") : t("offer.unmet")}</Badge>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-sm bg-surface-2 px-2.5 py-2">
          <span className="text-xs text-fg-3">{t("offer.total")}</span>
          <span className="nums font-semibold text-fg-1">{formatMoney(cost, { whole: true })}</span>
        </div>
        <Button
          block
          state={state}
          disabled={!allOk && state === "idle"}
          onClick={() => void send()}
          data-testid="talent-offer-send"
        >
          {t("offer.send")}
        </Button>
      </div>
    </Sheet>
  );
}

function CoCeoPanel({ talent }: { talent: OwnTalent }) {
  const t = useTranslations("talents");
  const client = useQueryClient();
  const errorText = useGameErrorText();
  const [autonomy, setAutonomy] = useState(talent.coCeoAutonomy);
  const [budgetEuro, setBudgetEuro] = useState(String(Math.round(talent.coCeoBudgetCents / 100)));
  const [state, setState] = useState<ButtonState>("idle");
  const save = async (remove: boolean) => {
    setState("loading");
    try {
      client.setQueryData(
        COMPANY_TALENTS_KEY,
        await engine.setCoCeo(
          crypto.randomUUID(),
          talent.key,
          autonomy,
          Math.max(0, Math.round(Number(budgetEuro) || 0)) * 100,
          remove,
        ),
      );
      void client.invalidateQueries({ queryKey: ORG_KEY });
      toast.success(remove ? t("coceo.removed") : t("coceo.saved"));
      setState("success");
    } catch (error) {
      toast.error(t("coceo.title"), errorText(error));
      setState("idle");
    }
  };
  return (
    <section className="space-y-2.5 rounded-sm border border-accent px-2.5 py-2.5" data-testid="talent-coceo">
      <p className="label-pixel text-accent">{t("coceo.title")}</p>
      <p className="text-2xs text-pretty text-fg-3">{t("coceo.text")}</p>
      <p className="nums text-xs text-fg-2">
        {t("coceo.spent", {
          spent: formatMoney(talent.coCeoSpentCents, { whole: true }),
          budget: formatMoney(talent.coCeoBudgetCents, { whole: true }),
        })}
      </p>
      <Segmented
        value={autonomy}
        onValueChange={setAutonomy}
        label={t("offer.autonomy")}
        block
        size="sm"
        options={[
          { value: "advise", label: t("offer.advise") },
          { value: "decide", label: t("offer.decide") },
        ]}
      />
      <Field
        label={t("offer.budget")}
        inputMode="numeric"
        type="number"
        min={0}
        max={cfg.coCeo.maxBudgetCents / 100}
        value={budgetEuro}
        onChange={(e) => setBudgetEuro(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" state={state} onClick={() => void save(false)}>
          {t("coceo.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void save(true)}>
          {t("coceo.remove")}
        </Button>
      </div>
    </section>
  );
}
