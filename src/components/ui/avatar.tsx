import { avatarArt } from "@/components/pixel/avatars";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { cn } from "@/lib/utils";

const SIZES = { xs: 2, sm: 3, md: 4, lg: 6, xl: 8 } as const;

export interface AvatarProps {
  avatarKey: string | null | undefined;
  /** xs 32 px, sm 48 px, md 64 px, lg 96 px, xl 128 px: always whole multiples of the 16 px art. */
  size?: keyof typeof SIZES;
  title?: string;
  className?: string;
}

/** A player's pixel portrait on its coloured tile. */
export function Avatar({ avatarKey, size = "sm", title, className }: AvatarProps) {
  const scale = SIZES[size];
  return (
    <span
      className={cn(
        "inline-grid shrink-0 overflow-hidden ring-1 ring-line-2",
        size === "xs" ? "rounded-xs" : size === "sm" ? "rounded-sm" : "rounded-md",
        className,
      )}
      style={{ width: 16 * scale, height: 16 * scale }}
    >
      <PixelIcon {...avatarArt(avatarKey)} scale={scale} title={title} />
    </span>
  );
}
