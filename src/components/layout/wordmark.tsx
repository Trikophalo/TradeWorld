import { COIN } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { APP_NAME } from "@/config/app";
import { cn } from "@/lib/utils";

export function Wordmark({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <PixelIcon {...COIN} scale={size === "lg" ? 3 : 2} />
      <span className={cn("font-pixel font-bold tracking-wider text-fg-1", size === "lg" ? "text-3xl" : "text-xl")}>
        {APP_NAME}
      </span>
    </span>
  );
}
