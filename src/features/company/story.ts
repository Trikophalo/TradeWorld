"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import type { CompanyBrief, CompanyEvent, CompanyNewsItem } from "@/features/game/types";
import { companyProfile, seedOf, storyValues, tell, fillTemplate, type CompanyProfile } from "@/lib/company-story";
import { formatMoney } from "@/lib/format";
import { useProductText } from "./product-name";

/**
 * Texts of company events and news (ADR-091): Claude's words when the server has them, otherwise the Mini-KI fills
 * the templates from messages (companyEvents.*, companyNews.*) with words that fit the product.
 */
export function useCompanyStory(company: CompanyBrief | undefined, profileWords: Record<string, string[]> | null) {
  const t = useTranslations("companyEvents");
  const tn = useTranslations("companyNews");
  const tf = useTranslations("firm.tiers");
  const product = useProductText();
  const profile: CompanyProfile | null = useMemo(
    () =>
      company
        ? companyProfile({
            name: company.name,
            idea: company.idea,
            sector: company.sector,
            productName: company.productKey ? product.name(company.productKey) : null,
            aiWords: profileWords,
          })
        : null,
    [company, profileWords, product],
  );

  const raw = useCallback(
    (key: string): string[] => {
      const value = t.raw(key as "title") as unknown;
      return Array.isArray(value) ? (value as string[]) : typeof value === "string" ? [value] : [];
    },
    [t],
  );

  return useMemo(() => {
    const name = company?.name ?? "";
    const fill = (template: string, seedKey: string) =>
      profile ? fillTemplate(template, storyValues(profile, name, seedOf(seedKey))) : template;
    const headline = (archetype: string, seedKey: string) =>
      profile ? tell(raw(`archetypes.${archetype}.headlines`), profile, name, seedOf(seedKey)) : "";
    return {
      profile,
      archetypeName: (archetype: string) => t(`archetypes.${archetype}.name` as "title"),
      eventHeadline: (e: Pick<CompanyEvent, "id" | "archetype" | "aiHeadline">) =>
        e.aiHeadline ?? headline(e.archetype, e.id),
      eventBody: (e: Pick<CompanyEvent, "id" | "archetype" | "aiBody">) =>
        e.aiBody ??
        (profile ? tell(raw(`archetypes.${e.archetype}.bodies`), profile, name, seedOf(`${e.id}:body`)) : ""),
      strategyName: (archetype: string, strategy: string) =>
        t(`archetypes.${archetype}.strategies.${strategy}` as "title"),
      strategyText: (archetype: string, strategy: string, seedKey: string) =>
        fill(t.raw(`archetypes.${archetype}.strategyText.${strategy}` as "title") as string, seedKey),
      stepName: (archetype: string, step: string) => t(`archetypes.${archetype}.steps.${step}` as "title"),
      newsText: (item: CompanyNewsItem) => {
        if (item.aiHeadline) return item.aiHeadline;
        const p = item.payload;
        const archetype = typeof p.archetype === "string" ? p.archetype : null;
        const eventId = typeof p.event_id === "string" ? p.event_id : String(item.id);
        if (item.kind === "event_started" && archetype) return headline(archetype, eventId);
        const templates = (() => {
          const value = tn.raw(`kinds.${item.kind}` as "title") as unknown;
          return Array.isArray(value) ? (value as string[]) : [];
        })();
        if (templates.length === 0) return "";
        const values: Record<string, string> = {
          ...(profile ? storyValues(profile, name, seedOf(String(item.id))) : { company: name }),
          step: archetype && typeof p.step === "string" ? t(`archetypes.${archetype}.steps.${p.step}` as "title") : "",
          tier:
            typeof p.tier === "string" && ["garage", "small_business", "gmbh", "ag"].includes(p.tier)
              ? tf(p.tier as "garage")
              : "",
          level: String(p.level ?? ""),
          ticker: String(p.ticker ?? ""),
          nickname: String(p.nickname ?? ""),
          title: String(p.title ?? ""),
          profit: typeof p.profit_cents === "number" ? formatMoney(p.profit_cents, { whole: true }) : "",
        };
        return fillTemplate(templates[seedOf(String(item.id)) % templates.length]!, values);
      },
    };
  }, [company, profile, raw, t, tn, tf]);
}
