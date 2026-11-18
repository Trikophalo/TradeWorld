"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { CHESTS, COIN, GOLD_BAR, KEY, UI_ICONS, VAULT_DOOR } from "@/components/pixel/art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import { GameError, type Vault, type VaultDeposit } from "@/features/game/types";
import { useUpgrades } from "@/features/upgrades/hooks";
import { formatBps, formatCountdown, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { vaultDepositCheck, vaultDepositInterestCents } from "@/lib/sim/vault";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useSetVaultDeposits, useVaultDeposits } from "../vault-hooks";
import { vaultBoosts, vaultDailyCents, vaultInterestBps, type VaultBoost, type VaultBoostKey } from "../vault-yield";

const pct = (bps: number) => formatBps(bps).replace("+", "");
const whole = (cents: number) => formatMoney(cents, { whole: true });
const toCents = (euros: string) => Math.round(Number(euros.replace(/\./g, "").replace(",", ".")) * 100);

const BOOST_ART: Record<VaultBoostKey, PixelArt> = {
  level: UI_ICONS.star,
  income: COIN,
  vault: VAULT_DOOR,
  vault_xl: CHESTS.gold.closed,
  vault_interest: GOLD_BAR,
  deposits: KEY,
};

/** The anchor of the Festgeld block inside the open vault. */
export const VAULT_DEPOSITS_ID = "vault-deposits";

/**
 * What the vault yields now, step by step (basic income, level bonus, treasury, size, interest, a day), and what would
 * raise it (ADR-201). Every upgrade step links to the upgrades page, Festgeld to its block below.
 */
export function VaultYield({ vault, level }: { vault: Vault; level: number }) {
  const t = useTranslations("vault.yield");
  const upgrades = useUpgrades();
  const cash = useGame((s) => s.portfolio?.cashCents ?? 0);
  const levels = upgrades.data?.levels ?? {};
  const interestBps = vaultInterestBps(levels);
  const input = {
    incomeCentsPerHour: vault.incomeCentsPerHour,
    rateCentsPerHour: vault.rateCentsPerHour,
    factorBps: vault.factorBps,
    capHours: vault.capHours,
    level,
    upgrades: levels,
    cashCents: cash,
  };
  const levelMaxed = level >= BALANCE.vault.levelBonusMaxLevel;

  return (
    <section aria-labelledby="vault-yield-title" className="space-y-3" data-testid="vault-yield">
      <p id="vault-yield-title" className="label-pixel text-fg-2">
        {t("title")}
      </p>
      <dl className="divide-y divide-line-1 rounded-md bg-surface-1 px-3 text-sm">
        <YieldRow
          label={t("income")}
          detail={t("incomeDetail")}
          value={t("perHour", { amount: whole(vault.incomeCentsPerHour) })}
        />
        <YieldRow
          label={t("level")}
          detail={
            levelMaxed
              ? t("levelMax", { level })
              : t("levelDetail", { level, percent: pct(BALANCE.vault.levelBonusBps) })
          }
          value={formatBps(vault.levelFactorBps - 10_000)}
          tone={vault.levelFactorBps > 10_000 ? "gain" : undefined}
          testId="vault-yield-level"
        />
        {vault.factorBps < 10_000 && (
          <YieldRow
            label={t("treasury")}
            detail={t("treasuryDetail")}
            value={formatBps(vault.factorBps - 10_000).replace("-", "−")}
            tone="warn"
          />
        )}
        <YieldRow
          label={t("rate")}
          value={t("perHour", { amount: whole(vault.rateCentsPerHour) })}
          strong
          testId="vault-yield-rate"
        />
        <YieldRow label={t("full", { hours: Math.round(vault.capHours) })} value={whole(vault.capCents)} />
        {interestBps > 0 && (
          <YieldRow label={t("interest", { percent: pct(interestBps) })} value={formatBps(interestBps)} />
        )}
        <YieldRow
          label={t("perDay")}
          detail={t("perDayHint")}
          value={whole(vaultDailyCents(input))}
          strong
          tone="gain"
          testId="vault-yield-day"
        />
      </dl>
      {upgrades.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
        </div>
      ) : (
        <VaultBoosts boosts={vaultBoosts(input)} />
      )}
    </section>
  );
}

function YieldRow({
  label,
  detail,
  value,
  strong,
  tone,
  testId,
}: {
  label: string;
  detail?: string;
  value: string;
  strong?: boolean;
  tone?: "gain" | "warn";
  testId?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2" data-testid={testId}>
      <dt className="min-w-0">
        <span className={cn("block text-fg-1", strong && "font-semibold")}>{label}</span>
        {detail && <span className="block text-xs text-pretty text-fg-3">{detail}</span>}
      </dt>
      <dd
        className={cn(
          "shrink-0 nums",
          strong ? "font-semibold" : "font-medium",
          tone === "gain" ? "text-gain" : tone === "warn" ? "text-warn" : "text-fg-1",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function VaultBoosts({ boosts }: { boosts: VaultBoost[] }) {
  const t = useTranslations("vault.boost");
  const upgradesOpen = boosts.every((b) => b.key === "level" || b.key === "deposits");
  return (
    <div className="space-y-2" data-testid="vault-boosts">
      <p className="label-pixel text-fg-2">{t("title")}</p>
      {upgradesOpen && (
        <p className="rounded-md bg-gain-soft px-3 py-2 text-xs text-pretty text-gain">
          <span className="font-semibold">{t("maxed")}</span> · {t("maxedText")}
        </p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {boosts.map((boost) => (
          <li key={boost.key}>
            <BoostRow boost={boost} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BoostRow({ boost }: { boost: VaultBoost }) {
  const t = useTranslations("vault.boost");
  const deposits = useVaultDeposits(boost.key === "deposits" && boost.ready);
  const label =
    boost.key === "level"
      ? t("level")
      : boost.key === "income"
        ? t("income")
        : boost.key === "vault"
          ? t("vault")
          : boost.key === "vault_xl"
            ? t("vaultXl")
            : boost.key === "vault_interest"
              ? t("interest")
              : t("deposits");
  const free = deposits.data ? Math.max(0, deposits.data.capCents - deposits.data.openCents) : null;
  const effect =
    boost.key === "deposits"
      ? boost.ready
        ? free === null
          ? null
          : t("depositsText", { amount: whole(free) })
        : t("depositsLocked", { level: boost.fromLevel ?? 0 })
      : boost.gainCentsPerHour !== undefined
        ? `${boost.key === "level" ? `${t("levelText", { percent: pct(boost.gainBps ?? 0) })} · ` : ""}${t("perHourMore", { amount: whole(boost.gainCentsPerHour) })}`
        : boost.gainHours !== undefined
          ? t("hoursMore", { hours: boost.gainHours })
          : t("percentMore", { percent: pct(boost.gainBps ?? 0) });
  const aside =
    boost.key === "level" || boost.key === "deposits"
      ? null
      : boost.fromLevel !== null
        ? t("fromLevel", { level: boost.fromLevel })
        : whole(boost.costCents ?? 0);
  const body = (
    <>
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-md bg-surface-2",
          !boost.ready && boost.key !== "level" && "opacity-60",
        )}
      >
        <PixelIcon {...BOOST_ART[boost.key]} scale={1} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg-1">{label}</span>
        {effect === null ? (
          <Skeleton className="mt-1 h-3 w-24" />
        ) : (
          <span className="block truncate nums text-xs text-gain">{effect}</span>
        )}
      </span>
      {aside && (
        <span className={cn("shrink-0 nums text-xs", boost.ready ? "font-semibold text-fg-1" : "text-fg-3")}>
          {aside}
        </span>
      )}
    </>
  );
  const shell = "flex items-center gap-3 rounded-md border border-line-1 bg-surface-1 p-2";
  if (boost.key === "level") {
    return (
      <div className={shell} data-boost={boost.key}>
        {body}
      </div>
    );
  }
  if (boost.key === "deposits") {
    return (
      <button
        type="button"
        disabled={!boost.ready}
        onClick={() => {
          haptic("tap");
          document.getElementById(VAULT_DEPOSITS_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        data-boost={boost.key}
        className={cn(
          shell,
          "w-full text-left focus-ring transition duration-fast enabled:hover:border-accent enabled:active:scale-[0.98] disabled:cursor-not-allowed",
        )}
      >
        {body}
      </button>
    );
  }
  return (
    <Link
      href="/upgrades"
      data-boost={boost.key}
      className={cn(shell, "focus-ring transition duration-fast hover:border-accent active:scale-[0.98]")}
    >
      {body}
    </Link>
  );
}

/**
 * Festgeld in the vault (ADR-201): lock cash for 1, 3 or 7 days for interest from the treasury. The money stays the
 * player's (it counts for net worth); breaking early gives it back without interest.
 */
export function VaultDeposits() {
  const t = useTranslations("vault.deposits");
  const errorText = useGameErrorText();
  const deposits = useVaultDeposits();
  const setDeposits = useSetVaultDeposits();
  const refreshPortfolio = useGame((s) => s.refreshPortfolio);
  const cash = useGame((s) => s.portfolio?.cashCents ?? 0);
  const [euros, setEuros] = useState("");
  const [days, setDays] = useState<string>(String(BALANCE.vault.deposits.terms.at(-1)?.days ?? 7));
  const [state, setState] = useState<ButtonState>("idle");

  if (deposits.isPending) {
    return (
      <div id={VAULT_DEPOSITS_ID} className="scroll-mt-24 space-y-3" data-testid="vault-deposits">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full rounded-md" />
        <Skeleton className="h-12 w-full rounded-md" />
      </div>
    );
  }
  if (!deposits.data) {
    return (
      <div id={VAULT_DEPOSITS_ID} data-testid="vault-deposits">
        <p className="text-sm text-loss">{errorText(deposits.error)}</p>
      </div>
    );
  }
  const d = deposits.data;
  const free = Math.max(0, d.capCents - d.openCents);
  const amount = euros.trim() === "" ? 0 : toCents(euros);
  const term = d.terms.find((x) => String(x.days) === days) ?? d.terms[0];
  const check = vaultDepositCheck({
    level: d.level,
    amountCents: Number.isFinite(amount) ? amount : 0,
    days: term?.days ?? 0,
    cashCents: cash,
    openCents: d.openCents,
    openCount: d.deposits.length,
  });
  const interest = term
    ? Number(vaultDepositInterestCents(BigInt(Math.max(0, amount || 0)), term.rateBps, d.factorBps))
    : 0;
  const errorKey =
    amount <= 0
      ? null
      : check === "too_small"
        ? "deposit_too_small"
        : check === "cap" || check === "max_open"
          ? "deposit_limit"
          : check === "cash"
            ? "insufficient_funds"
            : null;

  const submit = async () => {
    if (!term || check !== "ok") return;
    setState("loading");
    try {
      const next = await engine.openVaultDeposit(crypto.randomUUID(), amount, term.days);
      setDeposits(next);
      void playSound("coin");
      haptic("success");
      setState("success");
      setEuros("");
      toast.success(t("opened"), t("openedText", { amount: formatMoney(amount), days: term.days }), { silent: true });
      window.setTimeout(() => setState("idle"), 1200);
      await refreshPortfolio();
    } catch (error) {
      setState("idle");
      toast.error(t("openFailed"), errorText(error));
    }
  };

  return (
    <section
      id={VAULT_DEPOSITS_ID}
      aria-labelledby="vault-deposits-title"
      className="scroll-mt-24 space-y-3"
      data-testid="vault-deposits"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p id="vault-deposits-title" className="label-pixel text-fg-2">
          {t("title")}
        </p>
        <p className="nums text-xs text-fg-3" data-testid="vault-deposits-room">
          {t("room", { free: whole(free), cap: whole(d.capCents) })}
        </p>
      </div>
      <p className="text-xs text-pretty text-fg-3">{t("intro")}</p>
      {d.factorBps < 10_000 && <p className="text-xs text-warn">{t("treasuryLow")}</p>}

      <div className="space-y-3 rounded-md bg-surface-1 p-3">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field
              label={t("amount")}
              inputMode="decimal"
              autoComplete="off"
              value={euros}
              onChange={(e) => setEuros(e.target.value)}
              hint={t("amountHint", { min: whole(d.minCents), max: whole(Math.min(free, cash)) })}
              error={errorKey ? errorText(new GameError(errorKey)) : undefined}
              data-testid="vault-deposit-amount"
            />
          </div>
          <Button
            variant="secondary"
            className="mb-7 shrink-0"
            onClick={() => setEuros(String(Math.floor(Math.max(0, Math.min(free, cash)) / 100)))}
            disabled={Math.min(free, cash) < d.minCents}
          >
            {t("max")}
          </Button>
        </div>
        <div className="space-y-1.5">
          <p className="label-pixel text-fg-2">{t("term")}</p>
          <Segmented
            value={String(term?.days ?? days)}
            onValueChange={(next) => {
              haptic("tap");
              setDays(next);
            }}
            options={d.terms.map((x) => ({
              value: String(x.days),
              label: t("termOption", { days: x.days, percent: pct(x.rateBps) }),
            }))}
            label={t("term")}
            size="sm"
            block
          />
        </div>
        {term && amount > 0 && check === "ok" && (
          <p className="nums text-sm text-fg-2" data-testid="vault-deposit-preview">
            {t("preview", { days: term.days, total: formatMoney(amount + interest), interest: formatMoney(interest) })}
          </p>
        )}
        <Button
          block
          state={state}
          disabled={check !== "ok"}
          onClick={() => void submit()}
          data-testid="vault-deposit-submit"
        >
          {d.deposits.length >= d.maxOpen ? t("full", { max: d.maxOpen }) : t("submit")}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="label-pixel text-fg-2">{t("open")}</p>
          {d.earnedCents > 0 && (
            <p className="nums text-xs text-gain">{t("earned", { amount: formatMoney(d.earnedCents) })}</p>
          )}
        </div>
        {d.deposits.length === 0 ? (
          <EmptyState
            art={<PixelIcon {...KEY} scale={3} />}
            title={t("emptyTitle")}
            description={t("emptyText")}
            className="py-6"
          />
        ) : (
          <ul className="space-y-2" data-testid="vault-deposit-list">
            {d.deposits.map((deposit, i) => (
              <DepositRow key={deposit.id} deposit={deposit} index={i} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function DepositRow({ deposit, index }: { deposit: VaultDeposit; index: number }) {
  const t = useTranslations("vault.deposits");
  const errorText = useGameErrorText();
  const reduced = useReducedMotion();
  const now = useClock();
  const setDeposits = useSetVaultDeposits();
  const refreshPortfolio = useGame((s) => s.refreshPortfolio);
  const [state, setState] = useState<ButtonState>("idle");
  const [busy, setBusy] = useState(false);
  const skew = useGame((s) => s.clockSkewMs);
  const secondsLeft = now === null ? null : (Date.parse(deposit.maturesAt) - (now - skew)) / 1000;
  const matured = deposit.matured || (secondsLeft !== null && secondsLeft <= 0);

  const close = async () => {
    if (busy) return;
    setBusy(true);
    if (matured) setState("loading");
    try {
      const next = await engine.closeVaultDeposit(crypto.randomUUID(), deposit.id);
      setDeposits(next);
      if (next.closed.matured) {
        void playSound("coin");
        haptic("success");
        setState("success");
        toast.success(
          t("collected"),
          t("collectedText", {
            amount: formatMoney(next.closed.amountCents),
            interest: formatMoney(next.closed.interestCents),
          }),
          { silent: true },
        );
      } else {
        toast.success(t("broken"), t("brokenText", { amount: formatMoney(next.closed.amountCents) }), { silent: true });
      }
      await refreshPortfolio();
    } catch (error) {
      setState("idle");
      toast.error(t("closeFailed"), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.li
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING.snappy, delay: index * 0.05 }}
      className={cn("space-y-2 rounded-md border bg-surface-1 p-3", matured ? "border-gold/60" : "border-line-1")}
      data-testid="vault-deposit"
      data-matured={matured}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="nums font-semibold text-fg-1">{formatMoney(deposit.amountCents)}</span>
        <span className="nums text-sm text-gain">{t("interest", { amount: formatMoney(deposit.interestCents) })}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3 text-xs text-fg-3">
        <span>{t("row", { days: deposit.termDays, percent: pct(deposit.rateBps) })}</span>
        <span className={cn("nums", matured && "font-semibold text-gold")}>
          {matured
            ? t("matured")
            : secondsLeft === null
              ? "--:--"
              : t("maturesIn", { time: formatCountdown(secondsLeft) })}
        </span>
      </div>
      {matured ? (
        <Button block state={state} disabled={busy} onClick={() => void close()} data-testid="vault-deposit-collect">
          {t("collect")}
        </Button>
      ) : (
        <div className="space-y-1">
          <HoldButton tone="loss" disabled={busy} onConfirm={() => void close()} className="w-full">
            <span data-testid="vault-deposit-break">{t("break")}</span>
          </HoldButton>
          <p className="text-center text-2xs text-fg-3">{t("breakHint")}</p>
        </div>
      )}
    </motion.li>
  );
}
