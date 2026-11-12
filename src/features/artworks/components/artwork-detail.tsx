"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, type ButtonState } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { Artwork } from "@/features/game/types";
import { parseEuroCents } from "@/features/market/order-schema";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { useArtRefresh, useArtwork } from "../hooks";
import { LikeButton, OriginLabel } from "./artwork-card";
import { ArtworkImage } from "./artwork-image";

const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const euros = (cents: number) => String(cents / 100).replace(".", ",");

/** One artwork in a large window: picture, facts, bidding, selling and its history (ADR-080). */
export function ArtworkDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTranslations("art");
  const detail = useArtwork(id);
  const art = detail.data?.artwork;
  return (
    <Modal
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      title={art ? t("detailTitle", { code: art.code, title: art.title }) : t("title")}
    >
      {!detail.data || !art ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]" data-testid="artwork-detail">
          <div className="flex flex-col items-center gap-3">
            <div className="grid place-items-center rounded-lg bg-surface-2 p-4 sm:p-6">
              <ArtworkImage artwork={art} scale={8} className="hidden sm:inline-block" />
              <ArtworkImage artwork={art} scale={6} className="sm:hidden" />
            </div>
            <LikeButton artwork={art} className="px-4 py-2 text-sm" />
          </div>
          <div className="min-w-0 space-y-5">
            <Facts artwork={art} />
            <AuctionPanel artwork={art} />
            <History sales={detail.data.sales} bids={detail.data.bids} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function Facts({ artwork }: { artwork: Artwork }) {
  const t = useTranslations("art");
  const person = (name: string | null, fallback: string) =>
    name ? (
      <Link href={`/players/${encodeURIComponent(name)}`} className="text-accent focus-ring hover:underline">
        {name}
      </Link>
    ) : (
      fallback
    );
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      <div>
        <dt className="label-pixel text-fg-3">{t("code")}</dt>
        <dd className="nums text-fg-1">{artwork.code}</dd>
      </div>
      <div>
        <dt className="label-pixel text-fg-3">{t("origin")}</dt>
        <dd>
          <OriginLabel artwork={artwork} />
        </dd>
      </div>
      <div>
        <dt className="label-pixel text-fg-3">{t("creator")}</dt>
        <dd className="text-fg-1">{person(artwork.creator, t("gallery"))}</dd>
      </div>
      <div>
        <dt className="label-pixel text-fg-3">{t("owner")}</dt>
        <dd className="text-fg-1">{person(artwork.owner, t("gallery"))}</dd>
      </div>
      <div className="col-span-2">
        <dt className="label-pixel text-fg-3">{t("value")}</dt>
        <dd className="text-xl font-semibold text-fg-1">
          {artwork.valueCents !== null ? formatMoney(artwork.valueCents, { whole: true }) : t("noValue")}
        </dd>
      </div>
    </dl>
  );
}

function AuctionPanel({ artwork }: { artwork: Artwork }) {
  const t = useTranslations("art");
  const me = useGame((state) => state.portfolio?.nickname);
  const a = artwork.auction;
  if (a) {
    if (a.seller === me) return <OwnAuction artwork={artwork} />;
    return <BidBox artwork={artwork} />;
  }
  if (artwork.owner && artwork.owner === me) return <SellBox artwork={artwork} />;
  return artwork.owner ? null : <p className="text-sm text-fg-3">{t("ownedByGallery")}</p>;
}

function AuctionHead({ artwork }: { artwork: Artwork }) {
  const t = useTranslations("art");
  const a = artwork.auction!;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="label-pixel text-fg-3">{a.currentCents ? t("currentBid") : t("startPrice")}</p>
        <p className="text-2xl font-semibold text-fg-1">
          {formatMoney(a.currentCents ?? a.startCents, { whole: true })}
        </p>
        <p className="text-xs text-fg-3">
          {t("bids", { count: a.bids })}
          {a.leader && ` · ${a.leader}`}
        </p>
      </div>
      <div className="text-right">
        <p className="label-pixel text-fg-3">{t("endsIn")}</p>
        <Countdown target={Date.parse(a.endsAt)} className="text-xl font-semibold text-warn" />
      </div>
    </div>
  );
}

function BidBox({ artwork }: { artwork: Artwork }) {
  const t = useTranslations("art");
  const errorText = useGameErrorText();
  const refresh = useArtRefresh();
  const a = artwork.auction!;
  const [text, setText] = useState(euros(a.minBidCents));
  const [shownMin, setShownMin] = useState(a.minBidCents);
  if (a.minBidCents !== shownMin) {
    setShownMin(a.minBidCents);
    setText(euros(a.minBidCents));
  }
  const [state, setState] = useState<ButtonState>("idle");
  const cents = parseEuroCents(text) ?? 0;
  const tooLow = cents < a.minBidCents;
  const bid = async () => {
    setState("loading");
    try {
      await engine.bidArtwork(crypto.randomUUID(), a.id, cents);
      setState("success");
      haptic("success");
      void playSound("coin");
      toast.success(t("bidDone"), formatMoney(cents, { whole: true }), { silent: true });
      await refresh();
      window.setTimeout(() => setState("idle"), 800);
    } catch (error) {
      setState("idle");
      toast.error(t("bidTitle"), errorText(error));
    }
  };
  return (
    <section className="space-y-4 rounded-lg border border-warn/40 bg-warn-soft/40 p-4" data-testid="bid-box">
      <AuctionHead artwork={artwork} />
      {a.myBidCents !== null && <p className="text-sm font-semibold text-gain">{t("leading")}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <Field
            label={t("bidLabel")}
            inputMode="decimal"
            value={text}
            error={
              tooLow && cents > 0 ? t("bidMin", { amount: formatMoney(a.minBidCents, { whole: true }) }) : undefined
            }
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <Button size="lg" state={state} disabled={tooLow} onClick={() => void bid()}>
          {t("bidButton", { amount: formatMoney(Math.max(cents, 0), { whole: true }) })}
        </Button>
      </div>
      <p className="text-xs text-pretty text-fg-3">{t("bidHint")}</p>
    </section>
  );
}

function OwnAuction({ artwork }: { artwork: Artwork }) {
  const t = useTranslations("art");
  const errorText = useGameErrorText();
  const refresh = useArtRefresh();
  const a = artwork.auction!;
  const cancel = async () => {
    try {
      await engine.cancelAuction(crypto.randomUUID(), a.id);
      toast.success(t("auctionCancelled"), undefined, { silent: true });
      await refresh();
    } catch (error) {
      toast.error(t("auctionCancel"), errorText(error));
    }
  };
  return (
    <section className="space-y-3 rounded-lg border border-line-2 p-4">
      <AuctionHead artwork={artwork} />
      <p className="text-sm text-fg-2">{t("ownAuction")}</p>
      {a.bids === 0 && (
        <Button size="sm" variant="ghost" onClick={() => void cancel()}>
          {t("auctionCancel")}
        </Button>
      )}
    </section>
  );
}

function SellBox({ artwork }: { artwork: Artwork }) {
  const t = useTranslations("art");
  const errorText = useGameErrorText();
  const refresh = useArtRefresh();
  const durations = BALANCE.artworks.auction.durationsHours;
  const [text, setText] = useState(
    euros(Math.max(artwork.valueCents ?? 0, BALANCE.artworks.auction.minStartCents * 10)),
  );
  const [hours, setHours] = useState<string>(String(durations[1] ?? durations[0]));
  const [state, setState] = useState<ButtonState>("idle");
  const cents = parseEuroCents(text) ?? 0;
  const start = async () => {
    setState("loading");
    try {
      await engine.startAuction(crypto.randomUUID(), artwork.id, cents, Number(hours));
      setState("success");
      void playSound("success");
      toast.success(t("auctionStarted"), undefined, { silent: true });
      await refresh();
    } catch (error) {
      setState("idle");
      toast.error(t("auctionStart"), errorText(error));
    }
  };
  return (
    <section className="space-y-4 rounded-lg border border-accent/40 bg-accent-soft/40 p-4" data-testid="sell-box">
      <p className="label-pixel text-fg-1">{t("auctionSell")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <Field
            label={t("auctionStartPrice")}
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <Segmented<string>
          value={hours}
          onValueChange={setHours}
          label={t("auctionDuration")}
          size="sm"
          options={durations.map((h) => ({ value: String(h), label: t("hours", { count: h }) }))}
        />
      </div>
      <p className="text-xs text-fg-3">{t("auctionFee")}</p>
      <Button state={state} disabled={cents < BALANCE.artworks.auction.minStartCents} onClick={() => void start()}>
        {t("auctionStart")}
      </Button>
    </section>
  );
}

function History({
  sales,
  bids,
}: {
  sales: { at: string; priceCents: number; seller: string | null; buyer: string }[];
  bids: { nickname: string; amountCents: number; at: string }[];
}) {
  const t = useTranslations("art");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section>
        <p className="mb-2 label-pixel text-fg-2">{t("bidsTitle")}</p>
        {bids.length === 0 ? (
          <p className="text-sm text-fg-3">{t("bidsEmpty")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {bids.slice(0, 8).map((b, i) => (
              <li key={`${b.at}-${i}`} className="flex justify-between gap-2">
                <span className="truncate text-fg-2">{b.nickname}</span>
                <span className="nums text-fg-1">{formatMoney(b.amountCents, { whole: true })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <p className="mb-2 label-pixel text-fg-2">{t("salesTitle")}</p>
        {sales.length === 0 ? (
          <p className="text-sm text-fg-3">{t("salesEmpty")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {sales.slice(0, 8).map((s, i) => (
              <li key={`${s.at}-${i}`} className="flex justify-between gap-2">
                <span className="truncate text-fg-3">{date.format(new Date(s.at))}</span>
                <span className="truncate text-fg-1">
                  {t("soldTo", { price: formatMoney(s.priceCents, { whole: true }), buyer: s.buyer })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
