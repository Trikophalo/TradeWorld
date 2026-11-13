"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { CompanyEventState } from "@/features/game/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Companies asked this session: the AI writes once, every later visit reads the stored words. */
const asked = new Set<string>();

/**
 * Optional KI-Redaktion (ADR-091): when the server has no product words or no text for the current event yet, ask the
 * company-writer Edge Function once. Without a configured Claude key it answers `not_configured` and nothing changes:
 * the Mini-KI texts stay. Never in demo mode.
 */
export function useCompanyWriter(state: CompanyEventState | undefined) {
  const client = useQueryClient();
  const companyId = state?.company.id;
  const needsWords = state ? state.profileWords === null : false;
  const needsEventText = Boolean(state?.event && state.event.aiHeadline === null);
  const key = companyId ? `${companyId}:${state?.event?.id ?? "-"}` : null;

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !companyId || !key || (!needsWords && !needsEventText) || asked.has(key)) return;
    asked.add(key);
    void supabase.functions
      .invoke<{ ok?: boolean; profile?: boolean; events?: number }>("company-writer", {
        body: { company_id: companyId },
      })
      .then(({ data }) => {
        if (data?.ok && (data.profile || (data.events ?? 0) > 0))
          void client.invalidateQueries({ queryKey: ["company"] });
      })
      .catch(() => undefined);
  }, [client, companyId, key, needsWords, needsEventText]);
}
