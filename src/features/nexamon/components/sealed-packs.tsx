"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { NexamonSetKey } from "@/config/nexamon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import type { NexamonPackResult } from "@/features/game/nexamon-types";
import { engine } from "@/features/game/store";
import { formatMoney } from "@/lib/format";
import { playSound } from "@/lib/sound";
import { NEXAMON_KEYS, useNexamonAction } from "../hooks";
import { NexamonPack } from "./pack";

/*
 * Sealed booster packs (ADR-177): the strip "Ungeöffnete Booster" at the top of the shop (battle prizes and packs
 * bought to open later) and the "Kaufen und später öffnen" button of the pack popup. Opening one hands the pack to
 * the shop's popup, which tears it open like a bought one (PackOpening).
 */
const SEALED_KEY = [...NEXAMON_KEYS.all, "sealed"] as const;

export function useSealedPacks() {
  return useQuery({ queryKey: SEALED_KEY, queryFn: () => engine.nexamonSealedPacks(), refetchInterval: 20_000 });
}

/** The unopened packs, grouped by set, each with "Öffnen". Nothing when there are none. */
export function SealedPacksStrip({ onOpened }: { onOpened: (pack: NexamonPackResult) => void }) {
  const t = useTranslations("nexamon.sealed");
  const tc = useTranslations("nexamonCards");
  const { data } = useSealedPacks();
  const action = useNexamonAction();
  const [opening, setOpening] = useState<string | null>(null);
  const packs = data?.packs ?? [];
  if (packs.length === 0) return null;
  const groups = new Map<NexamonSetKey, typeof packs>();
  for (const p of packs) groups.set(p.set, [...(groups.get(p.set) ?? []), p]);

  const open = (packId: string) => {
    setOpening(packId);
    void action
      .run((requestId) => engine.openNexamonSealedPack(requestId, packId), {
        errorTitle: t("openFailed"),
        onDone: (pack) => {
          void playSound("buy");
          onOpened(pack);
        },
      })
      .finally(() => setOpening(null));
  };

  return (
    <Card padding="lg" className="border-gold" data-testid="sealed-packs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-pixel text-sm text-fg-1 uppercase">{t("title")}</h2>
        <p className="nums text-xs text-fg-3">{t("count", { count: packs.length })}</p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-3">
        {[...groups].map(([set, list]) => (
          <li
            key={set}
            className="flex min-w-0 flex-1 basis-56 items-center gap-3 rounded-md border-2 border-line-1 bg-surface-2 p-3"
            data-testid={`sealed-${set}`}
          >
            <NexamonPack set={set} scale={1} sheen={false} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg-1">{tc(`sets.${set}`)}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-2">
                <span className="nums">× {list.length}</span>
                {list.some((p) => p.source === "battle") && <Badge tone="warn">{t("fromBattle")}</Badge>}
              </p>
            </div>
            <Button
              size="sm"
              state={opening === list[0]!.id ? action.state : "idle"}
              disabled={opening !== null && opening !== list[0]!.id}
              onClick={() => open(list[0]!.id)}
              data-testid={`sealed-open-${set}`}
            >
              {t("open")}
            </Button>
          </li>
        ))}
      </ul>
      {data && !data.unlocked && <p className="mt-2 text-xs text-warn">{t("locked")}</p>}
    </Card>
  );
}

/** "Kaufen und später öffnen": one pack of the set into the sealed inventory, at the pack price. */
export function BuySealedButton({
  set,
  priceCents,
  cashCents,
}: {
  set: NexamonSetKey;
  priceCents: number;
  cashCents: number;
}) {
  const t = useTranslations("nexamon.sealed");
  const tc = useTranslations("nexamonCards");
  const action = useNexamonAction();
  return (
    <Button
      variant="secondary"
      size="sm"
      state={action.state}
      disabled={cashCents < priceCents}
      data-testid="buy-sealed"
      onClick={() =>
        void action.run((requestId) => engine.buyNexamonSealedPack(requestId, set, 1), {
          errorTitle: t("buyFailed"),
          onDone: (r) => {
            void playSound("buy");
            toast.success(t("bought", { set: tc(`sets.${set}`) }), formatMoney(r.priceCents));
          },
        })
      }
    >
      {t("buyLater", { price: formatMoney(priceCents, { whole: true }) })}
    </Button>
  );
}
