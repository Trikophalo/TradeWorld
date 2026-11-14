import { COIN } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { APP_NAME } from "@/config/app";
import { cn } from "@/lib/utils";

/** Coin and name. `compact` hides the name below `sm`, where the top bar needs the room (ADR-137). */
export function Wordmark({
  className,
  size = "md",
  compact = false,
}: {
  className?: string;
  size?: "md" | "lg";
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <PixelIcon
        {...COIN}
        scale={size === "lg" ? 3 : 2}
        className="transition-transform duration-slow ease-out group-hover:-translate-y-0.5 group-hover:-rotate-12 group-active:scale-90"
      />
      <span
        className={cn(
          "font-pixel font-bold tracking-wider text-fg-1",
          size === "lg" ? "text-3xl" : "text-xl",
          compact && "hidden sm:inline",
        )}
      >
        {APP_NAME}
      </span>
    </span>
  );
}
