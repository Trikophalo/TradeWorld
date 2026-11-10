import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BEAR } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";

export default async function StockNotFound() {
  const t = await getTranslations("markets");
  return (
    <EmptyState
      art={<PixelIcon {...BEAR} scale={4} />}
      title={t("notFoundTitle")}
      description={t("notFoundText")}
      action={
        <Link href="/markets" className={buttonVariants({ variant: "secondary" })}>
          {t("back")}
        </Link>
      }
    />
  );
}
