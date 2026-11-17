"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { ServerCountdown } from "@/features/company/listed/shared";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { NewsPromo, NewsPromoKind, NewsPromoState } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { NEWS_PROMO_HREF, NEWS_PROMO_KEY, useNewsPromo } from "./hooks";

const ICON: Record<NewsPromoKind, keyof typeof UI_ICONS> = {
  pack_sale: "nexamon",
  free_nft: "art",
  tax_return: "briefcase",
};

/** The short summary of a promotion, with its numbers. */
export function usePromoSummary() {
  const t = useTranslations("newsPromo");
  const tc = useTranslations("nexamonCards");
  return (promo: NewsPromo) =>
    promo.kind === "pack_sale"
      ? t("summary.pack_sale", { set: promo.set ? tc(`sets.${promo.set}`) : "", pct: promo.bps / 100 })
      : promo.kind === "tax_return"
        ? t("summary.tax_return", {
            pct: promo.bps / 100,
            cap: formatMoney(promo.tax?.capCents ?? BALANCE.newsPromos.taxReturn.capCents, { whole: true }),
          })
        : t("summary.free_nft");
}

/**
 * News-Aktionen (ADR-193): the running promotion on the news tab, with the time left and the way to it. The tax return
 * is filed right here. Without a promotion a calm empty line says that the show brings them now and then.
 */
export function NewsPromoCard({ preview }: { preview?: NewsPromo | null } = {}) {
  const t = useTranslations("newsPromo");
  const summary = usePromoSummary();
  const { promo, isPending } = useNewsPromo(preview);
  if (isPending) return <Skeleton className="h-32 w-full rounded-lg" aria-hidden />;
  if (!promo) {
    return (
      <Card padding="md" className="flex items-center gap-3" data-testid="news-promo-empty">
        <PixelIcon {...UI_ICONS.news} scale={2} className="text-fg-3" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-1">{t("emptyTitle")}</p>
          <p className="text-xs text-pretty text-fg-3">{t("emptyText")}</p>
        </div>
      </Card>
    );
  }
  return (
    <Card padding="lg" className="border-accent" data-testid="news-promo">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <PixelIcon {...UI_ICONS[ICON[promo.kind]]} scale={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{t("label")}</Badge>
            <span className="label-pixel text-fg-3">{t(`kinds.${promo.kind}`)}</span>
          </div>
          <p className="mt-1.5 font-medium text-pretty text-fg-1">{promo.headline}</p>
          <p className="mt-0.5 text-sm text-pretty text-fg-2">{summary(promo)}</p>
          <p className="mt-2 text-xs text-fg-3">
            {t("endsIn")} <ServerCountdown at={promo.endsAt} className="font-semibold text-fg-1" />
          </p>
        </div>
      </div>
      {promo.kind === "tax_return" ? (
        <TaxReturnForm promo={promo} className="mt-4" />
      ) : promo.claimed ? (
        <p className="mt-4 text-sm font-medium text-gain">{t("used")}</p>
      ) : (
        <Link
          href={NEWS_PROMO_HREF[promo.kind]}
          className={buttonVariants({ size: "sm", className: "mt-4 w-full sm:w-auto" })}
        >
          {t(`go.${promo.kind}`)}
        </Link>
      )}
    </Card>
  );
}

/** The tax return of a running News-Aktion on the company dashboard (ADR-193); hidden otherwise. */
export function TaxPromoCard({ preview }: { preview?: NewsPromo | null } = {}) {
  const t = useTranslations("newsPromo");
  const { promo } = useNewsPromo(preview);
  if (!promo || promo.kind !== "tax_return") return null;
  return (
    <Card padding="lg" className="border-accent" data-testid="tax-promo">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{t("label")}</Badge>
        <span className="text-xs text-fg-3">
          {t("endsIn")} <ServerCountdown at={promo.endsAt} className="font-semibold text-fg-1" />
        </span>
      </div>
      <TaxReturnForm promo={promo} className="mt-3" />
    </Card>
  );
}

/**
 * The tax return (ADR-193): a small form, the founder confirms the numbers and signs; the server pays the refund once.
 */
export function TaxReturnForm({ promo, className }: { promo: NewsPromo; className?: string }) {
  const t = useTranslations("newsPromo.tax");
  const errorText = useGameErrorText();
  const client = useQueryClient();
  const [checked, setChecked] = useState(false);
  const [signature, setSignature] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  const tax = promo.tax;
  const hours = BALANCE.newsPromos.taxReturn.windowHours;

  if (!tax?.owner) return <p className={cn("text-sm text-pretty text-fg-2", className)}>{t("noCompany")}</p>;
  if (promo.claimed) {
    return (
      <p className={cn("text-sm font-medium text-gain", className)} data-testid="tax-return-done">
        {t("doneShort", { amount: formatMoney(promo.claimedCents) })}
      </p>
    );
  }
  if (tax.refundCents <= 0) return <p className={cn("text-sm text-pretty text-fg-2", className)}>{t("noRevenue")}</p>;

  const submit = async () => {
    setState("loading");
    try {
      const r = await engine.fileNewsTaxReturn(crypto.randomUUID());
      client.setQueryData<NewsPromoState>(NEWS_PROMO_KEY, (old) =>
        old?.promo ? { ...old, promo: { ...old.promo, claimed: true, claimedCents: r.refundCents } } : old,
      );
      haptic("success");
      void playSound("coin");
      toast.success(t("done"), t("doneText", { amount: formatMoney(r.refundCents) }), { silent: true });
      setState("success");
      void useGame.getState().refreshPortfolio();
    } catch (error) {
      haptic("error");
      toast.error(t("failed"), errorText(error));
      setState("idle");
    }
  };
  const capped = tax.refundCents >= tax.capCents;
  return (
    <form
      className={cn("rounded-md border-2 border-line-1 bg-surface-2 p-4", className)}
      data-testid="tax-return-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="label-pixel text-fg-1">{t("title")}</p>
      <p className="mt-1 text-xs text-pretty text-fg-3">
        {t("intro", { pct: tax.shareBps / 100, hours, cap: formatMoney(tax.capCents, { whole: true }) })}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-fg-2">{t("revenue", { hours })}</dt>
        <dd className="text-right nums text-fg-1">{formatMoney(tax.revenueCents)}</dd>
        <dt className="text-fg-2">{t("refund")}</dt>
        <dd className="text-right nums font-semibold text-gain">{formatMoney(tax.refundCents)}</dd>
      </dl>
      {capped && (
        <p className="mt-1 text-right text-xs text-fg-3">
          {t("capped", { cap: formatMoney(tax.capCents, { whole: true }) })}
        </p>
      )}
      <label className="mt-3 flex items-start gap-2 text-sm text-fg-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-accent focus-ring"
          data-testid="tax-return-confirm"
        />
        <span className="text-pretty">{t("confirm")}</span>
      </label>
      <Field
        className="mt-3"
        label={t("signature")}
        placeholder={t("signatureHint")}
        value={signature}
        maxLength={40}
        onChange={(event) => setSignature(event.target.value)}
        data-testid="tax-return-signature"
      />
      <Button
        type="submit"
        className="mt-3 w-full sm:w-auto"
        state={state}
        disabled={!checked || signature.trim().length < 2}
        data-testid="tax-return-submit"
      >
        {t("submit")}
      </Button>
    </form>
  );
}
