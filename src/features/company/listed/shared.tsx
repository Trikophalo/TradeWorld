"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import type { ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { LISTED_COMPANY_KEY, type ListedCompany } from "@/features/game/listed-types";
import { useClockSkew, useServerClock } from "@/features/game/server-clock";
import { engine, useGame } from "@/features/game/store";
import { formatCountdown, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { InfoTip } from "../components/firm-layout";

export const money = (cents: number) => formatMoney(cents, { whole: true });
export const signed = (cents: number) => formatMoney(cents, { whole: true, sign: true });

/** The own listed company (ADR-167); `null` while the company is private. Shares its cache with Mira. */
export function useListedCompany(enabled = true) {
  return useQuery({
    queryKey: LISTED_COMPANY_KEY,
    queryFn: () => engine.listedCompany(),
    refetchInterval: 60_000,
    enabled,
  });
}

export const BOARD_KEY = (companyId: string | null) => ["company", "board", companyId ?? "mine"] as const;

export function useCompanyBoard(companyId: string | null, enabled = true) {
  return useQuery({
    queryKey: BOARD_KEY(companyId),
    queryFn: () => engine.companyBoard(companyId),
    refetchInterval: 30_000,
    enabled,
    retry: false,
  });
}

/**
 * Runs a write of the listed rules: button state, toast, sound, and the fresh state straight into the cache.
 * `key` tells which button is busy when several share the hook.
 */
export function useListedAction() {
  const client = useQueryClient();
  const errorText = useGameErrorText();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (
    key: string,
    action: () => Promise<ListedCompany | { listed: ListedCompany }>,
    texts: { title: string; done: string; detail?: string },
  ): Promise<boolean> => {
    setBusy(key);
    try {
      const result = await action();
      client.setQueryData(LISTED_COMPANY_KEY, "listed" in result ? result.listed : result);
      toast.success(texts.done, texts.detail, { silent: true });
      void playSound("success");
      haptic("success");
      setDone(key);
      window.setTimeout(() => setDone((d) => (d === key ? null : d)), 900);
      void Promise.all([
        client.invalidateQueries({ queryKey: ["company"], refetchType: "active" }),
        useGame.getState().refreshPortfolio(),
      ]);
      return true;
    } catch (error) {
      toast.error(texts.title, errorText(error));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const state = (key: string): ButtonState => (busy === key ? "loading" : done === key ? "success" : "idle");
  return { run, state, busy };
}

/** Time left until a server timestamp; a placeholder until the clock is there. */
export function ServerCountdown({ at, className }: { at: string; className?: string }) {
  const now = useServerClock();
  return (
    <time className={cn("nums", className)} dateTime={at}>
      {now === null ? "--:--" : formatCountdown((Date.parse(at) - now) / 1000)}
    </time>
  );
}

/** Client epoch of a server timestamp, for components that take a client-side target. */
export function useClientTarget(at: string | null): number | null {
  const skew = useClockSkew();
  return at === null ? null : Date.parse(at) + skew;
}

/** A titled card: the building block of every tab. */
export function Panel({
  title,
  aside,
  description,
  info,
  children,
  className,
  id,
  testId,
}: {
  title: string;
  aside?: ReactNode;
  /** One line under the title: what the card is for (ADR-183). */
  description?: ReactNode;
  /** An "i" next to the title with a longer explanation (ADR-183). */
  info?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  testId?: string;
}) {
  return (
    <Card
      padding="lg"
      id={id}
      data-testid={testId}
      className={cn("scroll-mt-24 space-y-4 data-[highlight]:ring-2 data-[highlight]:ring-accent", className)}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className="flex items-center gap-1.5 label-pixel text-fg-2">
            {title}
            {info && <InfoTip text={info} label={title} />}
          </h3>
          {aside}
        </div>
        {description && <p className="text-xs text-pretty text-fg-3">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

/** One number with its label: the small tiles of the dashboard. */
export function Stat({
  label,
  children,
  hint,
  info,
  tone,
  className,
  testId,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  /** An "i" next to the label: what the number means (ADR-183). */
  info?: ReactNode;
  tone?: "gain" | "loss" | "warn";
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-md bg-surface-2 px-3 py-2.5", className)} data-testid={testId}>
      <p className="flex items-center gap-1 text-xs text-fg-3">
        <span className="min-w-0 truncate">{label}</span>
        {info && <InfoTip text={info} label={label} className="size-4" />}
      </p>
      <p
        className={cn(
          "truncate nums text-lg font-semibold",
          tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : tone === "warn" ? "text-warn" : "text-fg-1",
        )}
      >
        {children}
      </p>
      {hint && <p className="truncate nums text-xs text-fg-3">{hint}</p>}
    </div>
  );
}

/** Label and value on one line, for statements. */
export function Line({
  label,
  value,
  tone,
  strong,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "gain" | "loss" | "warn" | "muted";
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn("min-w-0 text-sm", strong ? "font-semibold text-fg-1" : "text-fg-2")}>{label}</dt>
      <dd
        className={cn(
          "shrink-0 nums text-sm",
          strong && "font-semibold",
          tone === "gain"
            ? "text-gain"
            : tone === "loss"
              ? "text-loss"
              : tone === "warn"
                ? "text-warn"
                : tone === "muted"
                  ? "text-fg-3"
                  : "text-fg-1",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Translated name and description of a catalogue item. */
export function useItemText() {
  const t = useTranslations("listed.items");
  type Key = Parameters<typeof t>[0];
  return {
    name: (key: string) => (t.has(`${key}.name` as Key) ? t(`${key}.name` as Key) : key),
    description: (key: string) => (t.has(`${key}.description` as Key) ? t(`${key}.description` as Key) : ""),
  };
}
