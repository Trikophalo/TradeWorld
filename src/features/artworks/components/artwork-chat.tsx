"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { Artwork, NftChat, NftMessage } from "@/features/game/types";
import { parseEuroCents } from "@/features/market/order-schema";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useArtRefresh, useArtworkChat } from "../hooks";

const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const euros = (cents: number) => String(Math.floor(cents / 100));

/** The offer chat under every NFT (ADR-135): messages, price offers, AI collectors; the owner accepts offers. */
export function ArtworkChat({ artwork }: { artwork: Artwork }) {
  const t = useTranslations("art");
  const chat = useArtworkChat(artwork.id);
  const list = useRef<HTMLOListElement>(null);
  const count = chat.data?.messages.length ?? 0;

  // Keep the newest message in view (inside the list, the page does not jump).
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [count]);

  return (
    <section className="space-y-3 rounded-lg border border-line-1 bg-surface-1 p-3 sm:p-4" data-testid="nft-chat">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label-pixel text-fg-1">{t("chatTitle")}</p>
        {artwork.offers > 0 && artwork.bestOfferCents !== null && (
          <Badge tone="accent" className="nums">
            {t("bestOffer", { amount: formatMoney(artwork.bestOfferCents, { whole: true }) })}
          </Badge>
        )}
      </div>
      {!chat.data ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-3/4 rounded-lg" />
          <Skeleton className="ml-auto h-12 w-2/3 rounded-lg" />
        </div>
      ) : (
        <>
          <ol
            ref={list}
            className="max-h-80 min-h-24 space-y-2 overflow-y-auto pr-1"
            aria-live="polite"
            data-testid="nft-chat-messages"
          >
            {chat.data.messages.length === 0 && (
              <li className="py-6 text-center text-sm text-pretty text-fg-3">{t("chatEmpty")}</li>
            )}
            {chat.data.messages.map((m) => (
              <Message key={m.id} message={m} chat={chat.data} />
            ))}
          </ol>
          <Composer artwork={artwork} chat={chat.data} onSent={() => void chat.refetch()} />
        </>
      )}
    </section>
  );
}

function Message({ message, chat }: { message: NftMessage; chat: NftChat }) {
  const t = useTranslations("art");
  if (message.kind === "sale") {
    return (
      <li className="flex justify-center">
        <span className="max-w-[90%] rounded-pill bg-gain-soft px-3 py-1 text-center text-xs text-pretty text-gain">
          {t("chatSold", {
            buyer: message.text,
            price: formatMoney(message.offerCents ?? 0, { whole: true }),
          })}
        </span>
      </li>
    );
  }
  const offer = message.kind === "offer";
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.base, ease: EASE.out }}
      className={cn("flex", message.mine && "justify-end")}
      data-testid={offer ? "nft-offer" : "nft-message"}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2",
          message.mine ? "bg-accent-soft" : message.ai ? "bg-info-soft" : "bg-surface-2",
          offer && "border border-accent/40",
        )}
      >
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-fg-3">
          <span className="font-medium text-fg-2">
            {message.mine ? t("chatYou") : (message.author ?? t("chatFormer"))}
          </span>
          {message.ai && <span className="label-pixel text-info">{t("aiBadge")}</span>}
          <span className="nums">{time.format(new Date(message.at))}</span>
        </p>
        <p className="mt-0.5 text-sm text-pretty break-words text-fg-1">{message.text}</p>
        {offer && message.offerCents !== null && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="nums text-lg font-semibold text-fg-1">
              {formatMoney(message.offerCents, { whole: true })}
            </span>
            {message.offerStatus && (
              <Badge
                tone={
                  message.offerStatus === "open" ? "accent" : message.offerStatus === "accepted" ? "gain" : "neutral"
                }
              >
                {t(`offerStatus.${message.offerStatus}`)}
              </Badge>
            )}
            {chat.isOwner && !message.mine && message.offerStatus === "open" && <AcceptButton message={message} />}
          </div>
        )}
      </div>
    </motion.li>
  );
}

function AcceptButton({ message }: { message: NftMessage }) {
  const t = useTranslations("art");
  const errorText = useGameErrorText();
  const refresh = useArtRefresh();
  const [state, setState] = useState<ButtonState>("idle");
  const accept = async () => {
    setState("loading");
    try {
      const sale = await engine.acceptArtworkOffer(crypto.randomUUID(), message.id);
      setState("success");
      haptic("success");
      void playSound("coin");
      toast.success(t("chatAccepted", { amount: formatMoney(sale.priceCents, { whole: true }) }), undefined, {
        silent: true,
      });
      await refresh();
    } catch (error) {
      setState("idle");
      toast.error(t("chatAccept"), errorText(error));
    }
  };
  return (
    <Button size="sm" state={state} onClick={() => void accept()}>
      {t("chatAccept")}
    </Button>
  );
}

function Composer({ artwork, chat, onSent }: { artwork: Artwork; chat: NftChat; onSent: () => void }) {
  const t = useTranslations("art");
  const errorText = useGameErrorText();
  const refresh = useArtRefresh();
  const canOffer = !chat.isOwner && (artwork.owner !== null || artwork.aiOwner !== null) && artwork.auction === null;
  const [text, setText] = useState("");
  const [withOffer, setWithOffer] = useState(false);
  const [amount, setAmount] = useState(() =>
    euros(Math.max(chat.minOfferCents, artwork.bestOfferCents ?? 0, artwork.valueCents ?? 0)),
  );
  const [state, setState] = useState<ButtonState>("idle");
  const offerCents = withOffer && canOffer ? (parseEuroCents(amount) ?? 0) : null;
  const tooLow = offerCents !== null && offerCents < chat.minOfferCents;
  const body = text.trim() || (offerCents !== null ? t("chatOfferDefault") : "");

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!body || tooLow) return;
    setState("loading");
    try {
      await engine.postArtworkMessage(crypto.randomUUID(), artwork.id, body, offerCents);
      setText("");
      setState("success");
      haptic("tap");
      void playSound("tap");
      if (offerCents !== null) {
        toast.success(t("chatOfferSent"), formatMoney(offerCents, { whole: true }), { silent: true });
        setWithOffer(false);
      }
      onSent();
      await refresh();
      window.setTimeout(() => setState("idle"), 600);
    } catch (error) {
      setState("idle");
      toast.error(t("chatTitle"), errorText(error));
    }
  };

  return (
    <form onSubmit={(event) => void send(event)} className="space-y-2 border-t border-line-1 pt-3">
      {chat.myOfferCents !== null && (
        <p className="text-xs text-accent">
          {t("chatMyOffer", { amount: formatMoney(chat.myOfferCents, { whole: true }) })}
        </p>
      )}
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("chatLabel")}</span>
          <input
            value={text}
            maxLength={chat.maxLength}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("chatPlaceholder")}
            aria-label={t("chatLabel")}
            className="h-11 w-full rounded-md border border-line-2 bg-surface-2 px-3 text-fg-1 focus-ring placeholder:text-fg-3"
          />
        </label>
        <Button type="submit" state={state} disabled={!body || tooLow}>
          {offerCents !== null
            ? t("chatOfferButton", { amount: formatMoney(Math.max(offerCents, 0), { whole: true }) })
            : t("chatSend")}
        </Button>
      </div>
      {canOffer && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-fg-2">
            <Switch checked={withOffer} onCheckedChange={setWithOffer} label={t("chatWithOffer")} />
            {t("chatWithOffer")}
          </label>
          {withOffer && (
            <label className="flex min-w-0 items-center gap-2 text-sm text-fg-2">
              <span>{t("chatOfferLabel")}</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-label={t("chatOfferLabel")}
                aria-invalid={tooLow || undefined}
                className={cn(
                  "h-9 w-28 rounded-md border border-line-2 bg-surface-2 px-2 nums text-fg-1 focus-ring",
                  tooLow && "border-loss",
                )}
              />
            </label>
          )}
        </div>
      )}
      {withOffer && canOffer && <p className="text-xs text-pretty text-fg-3">{t("chatOfferHint")}</p>}
    </form>
  );
}
