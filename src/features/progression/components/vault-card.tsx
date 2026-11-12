"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { COIN, COMPANY_BUILDINGS, GOLD_BAR, UI_ICONS, VAULT_DOOR } from "@/components/pixel/art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { flyCoins } from "@/components/ui/effects";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useMyJob } from "@/features/career/hooks";
import { useMyCompany } from "@/features/company/hooks";
import { useGameErrorText } from "@/features/game/errors";
import { useGame } from "@/features/game/store";
import { emitTutorial } from "@/features/tutorial/store";
import { formatCountdown, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const format = (value: number) => formatMoney(Math.round(value));
const RATE = BALANCE.economy.basicIncomeCentsPerHour;
const CAP_CENTS = RATE * BALANCE.economy.vaultCapHours;
const HOUR_MS = 3_600_000;
const DOOR_SCALE = 5;

interface Source {
  key: "basic" | "job" | "ceo";
  art: PixelArt;
  name: string;
  detail: string;
  perHourCents: number;
  /** Where the source is managed; null for the basic income. */
  href: string | null;
  tone: string;
}

/**
 * The vault (ADR-086): a heavy pixel door that swings open. Inside lie gold bars and coins by how full it is, and
 * every income source flows in as a live stream: basic income, job and the automatic CEO payout. Emptying it sends
 * the coins to the cash balance in the top bar; the server books the amount (`claim_vault`).
 */
export function VaultCard() {
  const t = useTranslations("vault");
  const reduced = useReducedMotion();
  const job = useMyJob();
  const company = useMyCompany().data?.company ?? null;
  const now = useClock();
  const vault = useGame((state) => state.portfolio?.vault);
  const skew = useGame((state) => state.clockSkewMs);
  const claim = useGame((state) => state.claimVault);
  const errorText = useGameErrorText();
  const [state, setState] = useState<ButtonState>("idle");
  const [open, setOpen] = useState(false);
  const [burst, setBurst] = useState(0);
  const art = useRef<HTMLDivElement>(null);

  // Amount as of now: the server value plus what accrued since it was read, capped.
  const amount =
    !vault || now === null
      ? 0
      : Math.min(
          vault.capCents,
          vault.accruedCents + ((now - skew - Date.parse(vault.serverTime)) / HOUR_MS) * vault.rateCentsPerHour,
        );
  const fill = Math.min(1, amount / CAP_CENTS);
  const full = amount >= CAP_CENTS;
  const secondsToFull = ((CAP_CENTS - amount) / RATE) * 3600;

  const jobRate = job.data?.effectiveSalaryCentsPerHour ?? 0;
  const sources: Source[] = [
    {
      key: "basic",
      art: COIN,
      name: t("sources.basic"),
      detail: t("sources.basicDetail", { hours: BALANCE.economy.vaultCapHours }),
      perHourCents: vault?.rateCentsPerHour ?? RATE,
      href: null,
      tone: "bg-gold",
    },
    {
      key: "job",
      art: UI_ICONS.briefcase,
      name: t("sources.job"),
      detail: job.data ? job.data.company.name : t("sources.jobNone"),
      perHourCents: jobRate,
      href: "/job",
      tone: "bg-accent",
    },
    {
      key: "ceo",
      art: company ? COMPANY_BUILDINGS[company.tier] : COMPANY_BUILDINGS.garage,
      name: t("sources.ceo"),
      detail: !company
        ? t("sources.ceoNone")
        : company.founderPayoutBps === 0
          ? t("sources.ceoOff", { name: company.name })
          : t("sources.ceoOn", {
              name: company.name,
              percent: Math.round(company.founderPayoutBps / 100),
              today: formatMoney(company.live?.todayFounderPayoutCents ?? 0, { whole: true }),
            }),
      perHourCents: company?.live?.founderPayoutPerHourCents ?? 0,
      href: "/company",
      tone: "bg-gain",
    },
  ];
  const totalPerHour = sources.reduce((sum, s) => sum + s.perHourCents, 0);

  const toggle = () => {
    haptic("tap");
    void playSound(open ? "tap" : "coin", 0.6);
    if (!open) setBurst((b) => b + 1);
    setOpen((o) => !o);
  };

  const onClaim = async () => {
    setState("loading");
    try {
      const claimed = await claim();
      emitTutorial("vault-claimed");
      setBurst((b) => b + 1);
      if (art.current) flyCoins(art.current, document.querySelector('[data-fly-target="cash"]'));
      void playSound("coin");
      haptic("success");
      setState("success");
      toast.success(t("claimed"), t("claimedText", { amount: formatMoney(claimed) }), { silent: true });
      window.setTimeout(() => setState("idle"), 1200);
    } catch (error) {
      setState("idle");
      toast.error(t("claimFailed"), errorText(error));
    }
  };

  return (
    <Card padding="lg" className="space-y-4 overflow-hidden" data-testid="vault" data-open={open}>
      <div className="flex items-center gap-4 sm:gap-5">
        <VaultDoor open={open} fill={fill} full={full} burst={burst} reduced={Boolean(reduced)} onToggle={toggle}>
          <div ref={art} className="absolute inset-0" />
        </VaultDoor>
        <div className="min-w-0 flex-1">
          <h2 className="label-pixel text-fg-2">{t("title")}</h2>
          <NumberTicker value={amount} format={format} className="mt-0.5 text-2xl font-semibold text-fg-1" />
          <p className="truncate text-sm text-fg-3">
            {t("subtitle", { rate: formatMoney(vault?.rateCentsPerHour ?? RATE, { whole: true }) })}
            {vault && vault.factorBps < 10_000 && ` · ${t("treasuryLow")}`}
          </p>
          {jobRate > 0 && (
            <p className="truncate nums text-sm text-gain" data-testid="vault-job-income">
              {t("jobIncome", { amount: formatMoney(jobRate) })}
            </p>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            data-testid="vault-open"
            className="mt-1.5 text-sm font-medium text-accent focus-ring transition duration-fast hover:underline"
          >
            {open ? t("close") : t("open")}
          </button>
        </div>
      </div>

      <div>
        <Progress value={fill} label={t("progress")} tone={full ? "warn" : "gold"} />
        <div className="mt-2 flex justify-between text-sm">
          <span className={full ? "text-warn" : "text-fg-3"}>{full ? t("fullHint") : t("fillsIn")}</span>
          {!full && <span className="nums text-fg-2">{now === null ? "--:--" : formatCountdown(secondsToFull)}</span>}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.section
            key="sources"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={SPRING.snappy}
            aria-label={t("sourcesTitle")}
            className="space-y-3 rounded-lg bg-surface-2 p-3 sm:p-4"
            data-testid="vault-sources"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="label-pixel text-fg-2">{t("sourcesTitle")}</p>
              <p className="nums text-sm font-semibold text-gain" data-testid="vault-total">
                {t("perHour", { amount: formatMoney(totalPerHour, { whole: true }) })}
              </p>
            </div>
            <ul className="space-y-2.5">
              {sources.map((source, i) => (
                <SourceRow
                  key={source.key}
                  source={source}
                  share={totalPerHour > 0 ? source.perHourCents / totalPerHour : 0}
                  index={i}
                  reduced={Boolean(reduced)}
                />
              ))}
            </ul>
            <p className="text-xs text-pretty text-fg-3">{t("sourcesHint")}</p>
          </motion.section>
        )}
      </AnimatePresence>

      <Button block data-tour="vault-claim" state={state} disabled={amount < 100} onClick={() => void onClaim()}>
        {amount < 100 ? t("empty") : t("claim")}
      </Button>
    </Card>
  );
}

/**
 * The door in its frame. Opened, it swings on its hinges (rotateY) and shows the inside: gold bars and coins by
 * fill level. Every opening and every claim drops a handful of coins.
 */
function VaultDoor({
  open,
  fill,
  full,
  burst,
  reduced,
  onToggle,
  children,
}: {
  open: boolean;
  fill: number;
  full: boolean;
  burst: number;
  reduced: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("vault");
  const size = 24 * DOOR_SCALE;
  // A pyramid of gold bars (3 + 2 + 1) and coin stacks; it grows with the fill level.
  const bars = Math.max(1, Math.ceil(fill * 6));
  const rows = [bars >= 6 ? 1 : 0, Math.min(2, Math.max(0, bars - 3)), Math.min(3, bars)].filter((n) => n > 0);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={open ? t("close") : t("open")}
      className="relative shrink-0 rounded-lg focus-ring [perspective:600px]"
      style={{ width: size, height: size }}
      data-testid="vault-door"
    >
      {/* Inside: dark room with a golden glow, the bar pyramid and coin stacks by fill level */}
      <span
        aria-hidden
        className="absolute inset-[6%] flex flex-col items-center justify-end gap-0.5 overflow-hidden rounded-md bg-bg pb-3 shadow-inner"
        style={{
          backgroundImage: `radial-gradient(circle at 50% 85%, color-mix(in oklab, var(--gold) ${Math.round(20 + fill * 40)}%, transparent), transparent 70%)`,
        }}
      >
        {rows.map((count, row) => (
          <span key={row} className="flex gap-0.5">
            {Array.from({ length: count }, (_, i) => (
              <PixelIcon key={i} {...GOLD_BAR} scale={2} />
            ))}
          </span>
        ))}
        <span className="absolute bottom-2 left-2 flex flex-col-reverse">
          {Array.from({ length: 1 + Math.round(fill * 3) }, (_, i) => (
            <PixelIcon key={i} {...COIN} scale={1} className="-mt-2.5" />
          ))}
        </span>
        <span className="absolute right-2 bottom-2 flex flex-col-reverse">
          {Array.from({ length: Math.round(fill * 4) }, (_, i) => (
            <PixelIcon key={i} {...COIN} scale={1} className="-mt-2.5" />
          ))}
        </span>
      </span>
      <AnimatePresence>{open && !reduced && <CoinBurst key={burst} />}</AnimatePresence>
      {children}
      <motion.span
        aria-hidden
        className="absolute inset-0 block origin-left"
        animate={reduced ? { opacity: open ? 0 : 1 } : { rotateY: open ? -78 : 0 }}
        whileHover={open || reduced ? undefined : { rotateY: -8 }}
        whileTap={open || reduced ? undefined : { scale: 0.97 }}
        transition={SPRING.smooth}
        style={{ transformStyle: "preserve-3d" }}
      >
        <PixelIcon {...VAULT_DOOR} scale={DOOR_SCALE} />
        {full && !open && (
          <motion.span
            className="absolute inset-0 rounded-lg ring-2 ring-gold"
            animate={reduced ? { opacity: 0.8 } : { opacity: [0.2, 0.9, 0.2] }}
            transition={{ duration: DURATION.slower * 4, repeat: Infinity, ease: EASE.inOut }}
          />
        )}
      </motion.span>
    </button>
  );
}

/** A handful of coins hopping out of the open vault. */
function CoinBurst() {
  const coins = [
    { x: -34, y: -54, r: -30, d: 0 },
    { x: -8, y: -70, r: 20, d: 0.05 },
    { x: 20, y: -60, r: -15, d: 0.1 },
    { x: 42, y: -44, r: 35, d: 0.12 },
    { x: 4, y: -40, r: 0, d: 0.18 },
    { x: -22, y: -36, r: 25, d: 0.22 },
  ];
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-10">
      {coins.map((c, i) => (
        <motion.span
          key={i}
          className="absolute top-1/2 left-1/2 -mt-4 -ml-4"
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.6, rotate: 0 }}
          animate={{ x: c.x, y: [0, c.y, c.y + 70], opacity: [0, 1, 0], scale: 1, rotate: c.r }}
          transition={{ duration: DURATION.slower * 2.5, delay: c.d, ease: EASE.out }}
        >
          <PixelIcon {...COIN} scale={2} />
        </motion.span>
      ))}
    </span>
  );
}

/** One income source with a money stream: the bar shows its share, coins run along it. */
function SourceRow({
  source,
  share,
  index,
  reduced,
}: {
  source: Source;
  share: number;
  index: number;
  reduced: boolean;
}) {
  const t = useTranslations("vault");
  const active = source.perHourCents > 0;
  const body = (
    <>
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-md bg-surface-1",
          !active && "opacity-50 grayscale",
        )}
      >
        <PixelIcon {...source.art} scale={2} />
      </span>
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-fg-1">{source.name}</span>
          <span className={cn("nums text-sm font-semibold", active ? "text-fg-1" : "text-fg-3")}>
            {active ? t("perHour", { amount: formatMoney(source.perHourCents, { whole: true }) }) : "—"}
          </span>
        </span>
        <span className="relative block h-2 overflow-hidden rounded-pill bg-surface-3">
          <motion.span
            className={cn("absolute inset-y-0 left-0 w-full origin-left rounded-pill", source.tone)}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: share }}
            transition={{ ...SPRING.smooth, delay: 0.15 + index * 0.08 }}
          />
          {active && !reduced && (
            <motion.span
              aria-hidden
              className="absolute inset-0"
              initial={{ x: "-10%" }}
              animate={{ x: "100%" }}
              transition={{
                duration: DURATION.slower * (4 - index * 0.4),
                repeat: Infinity,
                ease: "linear",
                delay: index * 0.3,
              }}
            >
              <span className="absolute top-1/2 left-0 size-1.5 -translate-y-1/2 rounded-pill bg-fg-1/80" />
            </motion.span>
          )}
        </span>
        <span className="block truncate text-xs text-fg-3">{source.detail}</span>
      </span>
    </>
  );
  return (
    <motion.li
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...SPRING.snappy, delay: 0.1 + index * 0.07 }}
      data-source={source.key}
    >
      {source.href ? (
        <Link
          href={source.href}
          className="flex items-center gap-3 rounded-md p-1 focus-ring transition duration-fast hover:bg-surface-3"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 p-1">{body}</div>
      )}
    </motion.li>
  );
}
