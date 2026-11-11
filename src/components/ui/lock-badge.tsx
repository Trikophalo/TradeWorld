import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { cn } from "@/lib/utils";

/** "🔒 Level 5": marks a feature the player will unlock later. */
export function LockBadge({ level, className }: { level: number; className?: string }) {
  const t = useTranslations("locks");
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-xs bg-surface-3 px-1.5 label-pixel whitespace-nowrap text-fg-2",
        className,
      )}
    >
      <PixelIcon {...UI_ICONS.lock} scale={1} />
      {t("level", { level })}
    </span>
  );
}
