"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { GIFT } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { burstConfetti, flyCoins } from "@/components/ui/effects";
import { Field } from "@/components/ui/input";
import { PlayerTag } from "@/components/ui/player-tag";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { DEMO_FRIEND } from "@/features/game/demo/friends";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { friendCodeOf, parseFriendCode } from "@/lib/player-tag";
import { playSound } from "@/lib/sound";
import { isDemoMode } from "@/lib/supabase/env";
import { useFriendCode, useSetFriendCode } from "../hooks";

/**
 * The friend code on the profile (ADR-111): the own code to hand out, and the field where a friend's code is
 * redeemed once for the bonus.
 */
export function FriendCodeCard() {
  const t = useTranslations("friendCode");
  const query = useFriendCode();
  const data = query.data;
  return (
    <Card padding="lg" className="space-y-4" data-testid="friend-code">
      <div className="flex items-start gap-3">
        <span aria-hidden className="shrink-0 motion-safe:animate-float">
          <PixelIcon {...GIFT} scale={3} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="label-pixel text-fg-2">{t("title")}</h2>
          {data ? (
            <p className="mt-1 text-sm text-pretty text-fg-3">
              {t("intro", { bonus: formatMoney(data.bonusCents, { whole: true }) })}
            </p>
          ) : (
            <Skeleton className="mt-1.5 h-4 w-full rounded-sm" />
          )}
        </div>
      </div>
      {data ? (
        <>
          <OwnCode code={data.code} invited={data.invited} bonusCents={data.bonusCents} />
          {data.redeemed ? (
            <div className="rounded-md bg-gain-soft px-3.5 py-3" data-testid="friend-code-redeemed">
              <p className="label-pixel text-gain">{t("redeemedTitle")}</p>
              {data.redeemedFrom && (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-pretty text-fg-2">
                  <span>{t("redeemedText", { name: data.redeemedFrom.nickname })}</span>
                  <PlayerTag tag={data.redeemedFrom.tag} />
                </p>
              )}
            </div>
          ) : (
            <RedeemForm bonusCents={data.bonusCents} />
          )}
        </>
      ) : (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
        </div>
      )}
    </Card>
  );
}

function OwnCode({ code, invited, bonusCents }: { code: string; invited: number; bonusCents: number }) {
  const t = useTranslations("friendCode");
  const [copied, setCopied] = useState(false);
  const copy = () => {
    haptic("tap");
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_400);
    });
  };
  const share = () => {
    haptic("tap");
    const text = t("shareText", { code, bonus: formatMoney(bonusCents, { whole: true }) });
    if (typeof navigator.share === "function") void navigator.share({ text }).catch(() => undefined);
    else copy();
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 rounded-md border-2 border-dashed border-line-2 bg-surface-2 px-3.5 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-2xs text-fg-3 uppercase">{t("mine")}</p>
          <p
            className="font-pixel text-xl tracking-wide whitespace-nowrap text-fg-1 select-all"
            data-testid="friend-code-own"
          >
            {code}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button
            variant="secondary"
            size="sm"
            onClick={copy}
            aria-label={t("copyLabel", { code })}
            data-testid="friend-code-copy"
          >
            {copied ? t("copied") : t("copy")}
          </Button>
          <Button variant="ghost" size="sm" onClick={share}>
            {t("share")}
          </Button>
        </div>
      </div>
      <p className="text-sm text-fg-3" data-testid="friend-code-invited">
        {t("invited", { count: invited })}
      </p>
    </div>
  );
}

function RedeemForm({ bonusCents }: { bonusCents: number }) {
  const t = useTranslations("friendCode");
  const errorText = useGameErrorText();
  const setFriendCode = useSetFriendCode();
  const refreshPortfolio = useGame((s) => s.refreshPortfolio);
  const [value, setValue] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state !== "idle") return;
    if (!parseFriendCode(value)) {
      setError(t("invalid"));
      return;
    }
    setError(null);
    setState("loading");
    try {
      const result = await engine.redeemFriendCode(crypto.randomUUID(), value);
      setState("success");
      void playSound("coin");
      haptic("success");
      if (button.current) {
        burstConfetti(button.current);
        flyCoins(button.current, document.querySelector('[data-fly-target="cash"]'));
      }
      toast.success(
        t("success"),
        t("successText", {
          amount: formatMoney(result.paidCents, { whole: true }),
          name: result.redeemedFrom?.nickname ?? "",
        }),
        { silent: true },
      );
      await refreshPortfolio();
      // Let the check mark and the coins land before the form makes room for the result.
      window.setTimeout(() => setFriendCode(result), 900);
    } catch (e) {
      setState("idle");
      haptic("error");
      setError(errorText(e));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2" data-testid="friend-code-form" noValidate>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field
            label={t("redeemLabel")}
            placeholder={friendCodeOf("K7Q2")}
            value={value}
            onChange={(e) => {
              setValue(e.target.value.toUpperCase());
              setError(null);
            }}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={12}
            className="font-pixel tracking-wide"
            data-testid="friend-code-input"
          />
        </div>
        <Button
          ref={button}
          type="submit"
          state={state}
          disabled={value.trim() === ""}
          data-testid="friend-code-submit"
        >
          {t("redeem")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-loss" data-testid="friend-code-error">
          {error}
        </p>
      ) : (
        <p className="text-sm text-fg-3">
          {t("redeemHint", { bonus: formatMoney(bonusCents, { whole: true }) })}
          {isDemoMode && <> {t("demoHint", { code: friendCodeOf(DEMO_FRIEND.tag) })}</>}
        </p>
      )}
    </form>
  );
}
