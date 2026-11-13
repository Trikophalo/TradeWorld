"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { burstConfetti } from "@/components/ui/effects";
import { Delta } from "@/components/ui/delta";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { PixelEditor } from "@/features/company/components/pixel-editor";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame, usePlayerLevel } from "@/features/game/store";
import type { CoinActionKey, GameErrorKey, MyCoin } from "@/features/game/types";
import { parseEuroCents, parseQuantityE6 } from "@/features/market/order-schema";
import { LockedFeature } from "@/features/progression/components/locked-feature";
import { formatBps, formatMoney, formatPrice, formatShares } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING, STAGGER } from "@/lib/motion";
import { launchPool } from "@/lib/sim/crypto";
import { hasForbiddenSymbol, isValidLogo, type CompanyLogoData } from "@/lib/sim/logo";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useCoin, useCryptoRefresh, useMyCoin } from "../hooks";
import { CoinLogo } from "./coin-logo";
import { StatBars } from "./coin-detail";
import { CoinTradeSheet } from "./trade-sheet";

const cfg = BALANCE.crypto;
const create = cfg.create;
const SIZE = BALANCE.startups.logo.size;
const STEPS = ["create", "develop", "launch", "run"] as const;
type Step = (typeof STEPS)[number];
const plainPct = (bps: number) => formatBps(bps).replace(/^\+/, "");

function stepOf(coin: MyCoin | null): Step {
  if (!coin) return "create";
  if (coin.status === "draft") return coin.stats.tech >= create.launchMinTech ? "launch" : "develop";
  return "run";
}

/** Players develop one coin at a time (ADR-101): found, develop, launch, run, or close it. */
export function CoinStudio() {
  const t = useTranslations("crypto.studio");
  const level = usePlayerLevel();
  const unlocked = level >= cfg.createMinLevel;
  const mine = useMyCoin(unlocked);

  if (!unlocked) {
    return (
      <div className="space-y-5">
        <LockedFeature
          level={cfg.createMinLevel}
          title={t("lockedTitle")}
          description={t("lockedText", { level: cfg.createMinLevel })}
          art={<PixelIcon {...UI_ICONS.crypto} scale={3} />}
        />
        <Concept />
      </div>
    );
  }
  if (mine.isPending) return <Skeleton className="h-96 w-full rounded-lg" />;
  const coin = mine.data ?? null;
  const step = stepOf(coin);

  return (
    <div className="space-y-5" data-testid="coin-studio" data-step={step}>
      <Stepper step={step} />
      {!coin ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
          <CreateCoinForm />
          <Concept />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
          <div className="min-w-0 space-y-5">
            <CoinHeader coin={coin} />
            {coin.status === "draft" && <LaunchPanel coin={coin} />}
            {coin.status === "listed" && <TeamPanel coin={coin} />}
            {coin.status === "dead" && (
              <Card padding="lg" className="text-sm text-pretty text-loss">
                {t("deadText")}
              </Card>
            )}
            <ActionsPanel coin={coin} />
          </div>
          <aside className="space-y-5">
            <Card padding="lg" className="space-y-3">
              <h2 className="label-pixel text-fg-2">{t("statsTitle")}</h2>
              <StatBars stats={coin.stats} />
            </Card>
            {coin.status === "listed" && <BurnPanel coin={coin} />}
            <DiscontinuePanel coin={coin} />
          </aside>
        </div>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const t = useTranslations("crypto.studio.steps");
  const reduced = useReducedMotion();
  const index = STEPS.indexOf(step);
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label={t(step)}>
      {STEPS.map((s, i) => (
        <li key={s} className="min-w-0" aria-current={i === index ? "step" : undefined}>
          <div className="relative h-1.5 overflow-hidden rounded-pill bg-surface-3">
            <motion.span
              className="absolute inset-0 origin-left rounded-pill bg-accent"
              initial={false}
              animate={{ scaleX: i <= index ? 1 : 0 }}
              transition={reduced ? { duration: 0 } : { ...SPRING.smooth, delay: i * STAGGER }}
            />
          </div>
          <p
            className={cn(
              "mt-1.5 truncate label-pixel",
              i === index ? "text-accent" : i < index ? "text-fg-2" : "text-fg-3",
            )}
          >
            {i + 1}. {t(s)}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Concept() {
  const t = useTranslations("crypto.studio");
  const steps = t.raw("concept.steps") as string[];
  return (
    <Card padding="lg" className="space-y-3">
      <h2 className="label-pixel text-fg-2">{t("concept.title")}</h2>
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm text-pretty text-fg-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-xs bg-accent-soft font-pixel text-xs text-accent">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <p className="text-xs text-pretty text-fg-3">{t("oneAtATime")}</p>
    </Card>
  );
}

// ------------------------------------------------------------------ 1. create

const emptyLogo = (): CompanyLogoData => ({
  palette: ["#f2c14e", "#7a4a00"],
  grid: Array.from({ length: SIZE }, () => ".".repeat(SIZE)),
});

function CreateCoinForm() {
  const t = useTranslations("crypto.studio");
  const te = useTranslations("errors");
  const errorText = useGameErrorText();
  const refresh = useCryptoRefresh();
  const cash = useGame((s) => s.portfolio?.cashCents ?? 0);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [logo, setLogo] = useState<CompanyLogoData>(emptyLogo);
  const [check, setCheck] = useState<{ key: string; allowed: boolean; reason: GameErrorKey | null } | null>(null);
  const [state, setState] = useState<ButtonState>("idle");
  const key = `${name.trim()}|${ticker}`;

  useEffect(() => {
    if (name.trim().length < create.nameMinLength || ticker.length < create.tickerMinLength) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void engine
        .checkCoinName(name.trim(), ticker)
        .then((r) => live && setCheck({ key, ...r }))
        .catch(() => {});
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [name, ticker, key]);

  const result = check?.key === key ? check : null;
  const forbidden = hasForbiddenSymbol(logo);
  const logoOk = isValidLogo(logo) && !forbidden;
  const affordable = cash >= create.costCents;
  const ready = Boolean(result?.allowed) && logoOk && affordable;

  const submit = async (target: HTMLElement) => {
    setState("loading");
    try {
      await engine.createCoin(crypto.randomUUID(), name.trim(), ticker, logo);
      setState("success");
      burstConfetti(target);
      haptic("success");
      void playSound("levelUp");
      toast.success(t("created"), t("createdText"), { silent: true });
      await refresh();
    } catch (error) {
      setState("idle");
      toast.error(t("createTitle"), errorText(error));
    }
  };

  return (
    <Card padding="lg" className="space-y-5" data-testid="coin-create">
      <h2 className="font-pixel text-base text-fg-1 uppercase">{t("createTitle")}</h2>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
        <Field
          label={t("name")}
          value={name}
          maxLength={create.nameMaxLength}
          onChange={(e) => setName(e.target.value)}
          hint={t("nameHint", { min: create.nameMinLength, max: create.nameMaxLength })}
          autoComplete="off"
          data-testid="coin-name"
        />
        <Field
          label={t("ticker")}
          value={ticker}
          maxLength={create.tickerMaxLength}
          onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
          hint={t("tickerHint", { min: create.tickerMinLength, max: create.tickerMaxLength })}
          autoComplete="off"
          className="font-pixel uppercase"
          data-testid="coin-ticker"
        />
      </div>
      {result && (
        <p
          className={cn("text-sm", result.allowed ? "text-gain" : "text-loss")}
          role={result.allowed ? "status" : "alert"}
          data-testid="coin-name-check"
        >
          {result.allowed ? t("free") : te((result.reason ?? "unknown") as "name_taken")}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-fg-1">{t("logo")}</h3>
        <p className="text-xs text-fg-3">{t("logoHint")}</p>
        <PixelEditor
          width={SIZE}
          height={SIZE}
          maxColors={BALANCE.startups.logo.maxColors}
          value={logo}
          onChange={setLogo}
          mirror
          startMirrored
          testId="coin-logo-board"
          aside={
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <PreviewCoin logo={logo} name={name || "?"} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg-1">{name || t("name")}</p>
                  <p className="label-pixel text-fg-3">{ticker || "???"}</p>
                </div>
              </div>
              {forbidden ? (
                <p className="rounded-md bg-loss-soft px-3 py-2 text-sm text-loss" role="alert">
                  {t("logoForbidden")}
                </p>
              ) : (
                !logoOk && <p className="text-xs text-fg-3">{t("logoEmpty")}</p>
              )}
            </div>
          }
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-1 pt-4">
        <p className={cn("nums text-sm", affordable ? "text-fg-2" : "text-loss")}>
          {t("cost", { amount: formatMoney(create.costCents, { whole: true }) })}
        </p>
        <Button
          size="lg"
          state={state}
          disabled={!ready}
          onClick={(e) => void submit(e.currentTarget)}
          data-testid="coin-create-submit"
        >
          {t("create")}
        </Button>
      </div>
    </Card>
  );
}

function PreviewCoin({ logo, name }: { logo: CompanyLogoData; name: string }) {
  return (
    <CoinLogo coin={{ logo: isValidLogo(logo) ? logo : null, color: "#f2c14e", category: "player", name }} scale={3} />
  );
}

// ------------------------------------------------------------------ header

function CoinHeader({ coin }: { coin: MyCoin }) {
  const t = useTranslations("crypto");
  return (
    <Card padding="lg" className="flex flex-wrap items-center gap-4" data-testid="my-coin">
      <CoinLogo coin={coin} scale={4} className={cn(coin.status === "dead" && "opacity-50 grayscale")} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-pixel text-lg text-fg-1 uppercase">{coin.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="label-pixel text-fg-3">{coin.ticker}</span>
          <Badge tone={coin.status === "listed" ? "gain" : coin.status === "draft" ? "accent" : "loss"}>
            {t(`status.${coin.status}`)}
          </Badge>
        </div>
      </div>
      {coin.status === "listed" && (
        <div className="text-right">
          <p className="font-pixel nums text-xl text-fg-1">{formatPrice(coin.priceE4)}</p>
          <Delta bps={coin.change24hBps} />
        </div>
      )}
      {coin.status !== "draft" && (
        <Link
          href={`/crypto/${coin.ticker}`}
          className={buttonVariants({ variant: "secondary", size: "sm", className: "w-full sm:w-auto" })}
        >
          {t("studio.openCoin")}
        </Link>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ 2. develop

const STAT_OF: Record<CoinActionKey, "tech" | "hype" | "utility"> = {
  smart_contract: "tech",
  audit: "tech",
  bugfix: "tech",
  community: "hype",
  influencer: "hype",
  marketing_burn: "hype",
  partnership: "utility",
  staking: "utility",
};

function ActionsPanel({ coin }: { coin: MyCoin }) {
  const t = useTranslations("crypto.studio");
  const ts = useTranslations("crypto.statsNames");
  const errorText = useGameErrorText();
  const refresh = useCryptoRefresh();
  const now = useClock();
  const [busy, setBusy] = useState<CoinActionKey | null>(null);
  const reduced = useReducedMotion();
  // Burning has its own panel.
  const actions = coin.actions.filter((a) => a.key !== "marketing_burn");
  const running = coin.action;
  const progress =
    running && now !== null
      ? Math.min(
          1,
          (now - Date.parse(running.startedAt)) /
            Math.max(1, Date.parse(running.endsAt) - Date.parse(running.startedAt)),
        )
      : 0;

  const start = async (key: CoinActionKey) => {
    setBusy(key);
    try {
      await engine.startCoinAction(crypto.randomUUID(), key);
      haptic("success");
      void playSound("success");
      toast.success(t("started"), t(`actions.${key}`), { silent: true });
      await refresh();
    } catch (error) {
      toast.error(t(`actions.${key}`), errorText(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card padding="lg" className="space-y-4" data-testid="coin-actions">
      <div>
        <h2 className="label-pixel text-fg-2">{t("actionsTitle")}</h2>
        <p className="mt-1 text-xs text-pretty text-fg-3">{t("actionsHint")}</p>
      </div>
      {running && (
        <div
          className="space-y-2 rounded-lg border border-accent/40 bg-accent-soft/40 p-3"
          data-testid="coin-action-running"
        >
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-fg-1">
              {t("running")}: {t(`actions.${running.key}`)}
            </span>
            <Countdown target={Date.parse(running.endsAt)} className="nums text-fg-2" />
          </div>
          <Progress value={progress} label={t(`actions.${running.key}`)} size="sm" />
        </div>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {actions.map((a, i) => {
          const config = create.actions.find((x) => x.key === a.key)!;
          const stat = STAT_OF[a.key];
          const gain = config[stat] ?? 0;
          const locked = config.afterLaunch && coin.status !== "listed";
          return (
            <motion.li
              key={a.key}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING.smooth, delay: reduced ? 0 : i * STAGGER }}
              className={cn(
                "flex flex-col gap-2 rounded-lg border border-line-1 bg-surface-1 p-3",
                locked && "opacity-60",
              )}
              data-action={a.key}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-fg-1">{t(`actions.${a.key}`)}</span>
                <Badge tone={stat === "tech" ? "accent" : stat === "hype" ? "warn" : "gain"}>
                  {t("gains", { value: gain, stat: ts(stat) })}
                </Badge>
              </div>
              <p className="text-xs text-pretty text-fg-3">{t(`actionText.${a.key}`)}</p>
              <p className="nums text-xs text-fg-2">
                {t("duration", { hours: a.hours })} · {formatMoney(a.costCents, { whole: true })} ·{" "}
                {t("chance", { pct: plainPct(a.successBps) })}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-auto"
                disabled={!a.available || busy !== null}
                state={busy === a.key ? "loading" : "idle"}
                onClick={() => void start(a.key)}
              >
                {locked ? t("afterLaunch") : running ? t("busy") : t("start")}
              </Button>
            </motion.li>
          );
        })}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ 3. launch

function LaunchPanel({ coin }: { coin: MyCoin }) {
  const t = useTranslations("crypto.studio");
  const errorText = useGameErrorText();
  const refresh = useCryptoRefresh();
  const cash = useGame((s) => s.portfolio?.cashCents ?? 0);
  const [price, setPrice] = useState(String(create.startPriceOptionsE4[1] ?? create.startPriceOptionsE4[0]));
  const [liquidity, setLiquidity] = useState(String(create.minLiquidityCents / 100));
  const [share, setShare] = useState(2_000);
  const [state, setState] = useState<ButtonState>("idle");
  const techOk = coin.stats.tech >= create.launchMinTech;
  const liquidityCents = parseEuroCents(liquidity) ?? 0;
  const priceE4 = Number(price);
  const preview = liquidityCents > 0 ? launchPool(BigInt(liquidityCents), BigInt(priceE4), share) : null;
  const ok = techOk && liquidityCents >= create.minLiquidityCents && liquidityCents <= cash;

  const launch = async (target: HTMLElement) => {
    setState("loading");
    try {
      await engine.launchCoin(crypto.randomUUID(), priceE4, liquidityCents, share);
      setState("success");
      burstConfetti(target);
      haptic("success");
      void playSound("levelUp");
      toast.success(t("launched"), coin.name, { silent: true });
      await refresh();
    } catch (error) {
      setState("idle");
      toast.error(t("launchTitle"), errorText(error));
    }
  };

  return (
    <Card padding="lg" className="space-y-4" data-testid="coin-launch">
      <h2 className="label-pixel text-fg-2">{t("launchTitle")}</h2>
      {!techOk && (
        <div className="space-y-2">
          <p className="text-sm text-pretty text-warn">
            {t("launchNeedsTech", { tech: create.launchMinTech, now: coin.stats.tech })}
          </p>
          <Progress value={coin.stats.tech / create.launchMinTech} label={t("launchTitle")} tone="warn" size="sm" />
        </div>
      )}
      <fieldset disabled={!techOk} className={cn("space-y-4", !techOk && "opacity-60")}>
        <div className="space-y-1.5">
          <p className="text-sm text-fg-2">{t("startPrice")}</p>
          <Segmented
            value={price}
            onValueChange={setPrice}
            options={create.startPriceOptionsE4.map((p) => ({ value: String(p), label: formatPrice(p) }))}
            label={t("startPrice")}
            size="sm"
            block
          />
        </div>
        <Field
          label={t("liquidity")}
          inputMode="decimal"
          value={liquidity}
          onChange={(e) => setLiquidity(e.target.value)}
          hint={t("liquidityHint")}
          error={liquidityCents > cash ? formatMoney(cash) : undefined}
        />
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-fg-2">{t("teamShare")}</span>
            <span className="nums font-medium text-fg-1">{plainPct(share)}</span>
          </div>
          <Slider
            label={t("teamShare")}
            value={(share - create.teamShareMinBps) / (create.teamShareMaxBps - create.teamShareMinBps)}
            onValueChange={(v) =>
              setShare(
                Math.round((create.teamShareMinBps + v * (create.teamShareMaxBps - create.teamShareMinBps)) / 500) *
                  500,
              )
            }
            valueText={plainPct(share)}
          />
          <p className="text-xs text-pretty text-fg-3">{t("teamShareHint")}</p>
        </div>
        {preview && (
          <p className="rounded-md bg-surface-2 px-3 py-2 nums text-sm text-fg-2">
            {t("preview", {
              supply: formatShares(Number(preview.supplyE6)),
              team: formatShares(Number(preview.teamTokensE6)),
            })}
          </p>
        )}
        <Button
          size="lg"
          block
          state={state}
          disabled={!ok}
          onClick={(e) => void launch(e.currentTarget)}
          data-testid="coin-launch-submit"
        >
          {t("launch")}
        </Button>
      </fieldset>
    </Card>
  );
}

// ------------------------------------------------------------------ 4. run

function TeamPanel({ coin }: { coin: MyCoin }) {
  const t = useTranslations("crypto.studio");
  const detail = useCoin(coin.ticker);
  const [sell, setSell] = useState(false);
  const used = coin.rugLimitE6 > 0 ? coin.teamSoldWindowE6 / coin.rugLimitE6 : 0;
  return (
    <Card padding="lg" className="space-y-3" data-testid="coin-team">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label-pixel text-fg-2">{t("teamTokens")}</h2>
        <span className="nums text-sm text-fg-1">{formatShares(coin.teamTokensE6)}</span>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between gap-3 text-xs text-fg-3">
          <span>{t("rugMeter")}</span>
          <span className="nums">{t("rugLimit", { limit: formatShares(coin.rugLimitE6) })}</span>
        </div>
        <Progress value={Math.min(1, used)} label={t("rugMeter")} tone={used >= 0.75 ? "warn" : "accent"} size="sm" />
      </div>
      <Button variant="secondary" block disabled={coin.teamTokensE6 <= 0 || !detail.data} onClick={() => setSell(true)}>
        {t("sellTeam")}
      </Button>
      {detail.data && (
        <CoinTradeSheet coin={detail.data} side={sell ? "sell" : null} onClose={() => setSell(false)} mine={coin} />
      )}
    </Card>
  );
}

function BurnPanel({ coin }: { coin: MyCoin }) {
  const t = useTranslations("crypto.studio");
  const errorText = useGameErrorText();
  const refresh = useCryptoRefresh();
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  const now = useClock();
  const quantity = parseQuantityE6(amount) ?? 0;
  const waitUntil = coin.burnAvailableAt ? Date.parse(coin.burnAvailableAt) : null;
  const waiting = waitUntil !== null && (now === null || waitUntil > now);
  const ok = quantity >= coin.burnMinE6 && quantity <= coin.teamTokensE6 && !waiting;

  const burnNow = async () => {
    setState("loading");
    try {
      await engine.burnCoinTokens(crypto.randomUUID(), quantity);
      setState("success");
      void playSound("success");
      toast.success(t("burned"), `${formatShares(quantity)} ${coin.ticker}`, { silent: true });
      setAmount("");
      await refresh();
      window.setTimeout(() => setState("idle"), 900);
    } catch (error) {
      setState("idle");
      toast.error(t("burnTitle"), errorText(error));
    }
  };

  return (
    <Card padding="lg" className="space-y-3" data-testid="coin-burn">
      <h2 className="label-pixel text-fg-2">{t("burnTitle")}</h2>
      <p className="text-sm text-pretty text-fg-3">{t("burnText", { hype: coin.burnHype })}</p>
      <Field
        label={t("burnAmount")}
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        hint={`${t("burnMin", { amount: formatShares(coin.burnMinE6) })} · ${formatShares(coin.teamTokensE6)}`}
      />
      {waiting && waitUntil !== null && (
        <p className="flex items-center justify-between gap-3 text-xs text-fg-3">
          {t("burnWait")}
          <Countdown target={waitUntil} className="nums text-fg-2" />
        </p>
      )}
      <Button variant="secondary" block state={state} disabled={!ok} onClick={() => void burnNow()}>
        {t("burn")}
      </Button>
    </Card>
  );
}

function DiscontinuePanel({ coin }: { coin: MyCoin }) {
  const t = useTranslations("crypto.studio");
  const errorText = useGameErrorText();
  const refresh = useCryptoRefresh();
  const [busy, setBusy] = useState(false);

  const close = async () => {
    setBusy(true);
    try {
      await engine.discontinueCoin(crypto.randomUUID());
      void playSound("coin");
      toast.success(t("discontinued"), coin.name, { silent: true });
      await refresh();
    } catch (error) {
      toast.error(t("discontinueTitle"), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="lg" className="space-y-3" data-testid="coin-discontinue">
      <h2 className="label-pixel text-fg-2">{t("discontinueTitle")}</h2>
      <p className="text-sm text-pretty text-fg-3">{t("discontinueText")}</p>
      <HoldButton tone="loss" onConfirm={() => void close()} disabled={busy} className="w-full">
        {t("discontinue")}
      </HoldButton>
    </Card>
  );
}
