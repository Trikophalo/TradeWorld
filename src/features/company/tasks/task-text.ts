"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

/**
 * Texts of a company task (ADR-129) from messages (companyTasks.items.<key>). Keys come from the server, so they
 * are plain strings; unknown keys fall back to empty values instead of throwing.
 */
export function useTaskText() {
  const t = useTranslations("companyTasks.items");
  return useMemo(() => {
    const raw = (key: string, field: string): unknown => {
      const path = `${key}.${field}` as Parameters<typeof t>[0];
      return t.has(path) ? t.raw(path) : undefined;
    };
    const string = (key: string, field: string) => {
      const v = raw(key, field);
      return typeof v === "string" ? v : "";
    };
    return {
      name: (key: string) => string(key, "name") || key,
      how: (key: string) => string(key, "how"),
      string,
      list: (key: string, field: string) => {
        const v = raw(key, field);
        return Array.isArray(v) ? (v as string[]) : [];
      },
      question: (key: string, a: number, b: number) =>
        string(key, "question").replace("{a}", a.toLocaleString("de-DE")).replace("{b}", b.toLocaleString("de-DE")),
      /** News line of a result: {company} filled in. */
      news: (key: string, ok: boolean, company: string) =>
        string(key, ok ? "ok" : "fail").replace("{company}", company),
    };
  }, [t]);
}
