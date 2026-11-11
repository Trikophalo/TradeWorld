"use client";

import { useTranslations } from "next-intl";

type ProductText = Parameters<ReturnType<typeof useTranslations<"products">>>[0];

/** Name and description of a product (ADR-062), texts in messages "products". */
export function useProductText() {
  const t = useTranslations("products");
  return {
    name: (key: string) => (t.has(`${key}.name` as ProductText) ? t(`${key}.name` as ProductText) : key),
    desc: (key: string) => (t.has(`${key}.desc` as ProductText) ? t(`${key}.desc` as ProductText) : ""),
  };
}
