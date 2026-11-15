import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Paving stones of the friends plaza and the wardrobe stage (ADR-154): offset slabs in the theme's colours, drawn
 * as an inline SVG pattern so the tokens apply. Fills its positioned parent.
 */
export function PlazaGround({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const fill = (token: string) => ({ fill: `var(${token})` });
  return (
    <svg
      aria-hidden
      focusable="false"
      shapeRendering="crispEdges"
      className={cn("absolute inset-0 size-full", className)}
    >
      <defs>
        <pattern id={`plaza-${id}`} width="40" height="40" patternUnits="userSpaceOnUse">
          <rect width="40" height="40" style={fill("--bg-2")} />
          <rect y="0" width="40" height="2" style={fill("--shine")} />
          <rect y="20" width="40" height="2" style={fill("--shine")} />
          <rect y="18" width="40" height="2" style={fill("--line-1")} />
          <rect y="38" width="40" height="2" style={fill("--line-1")} />
          <rect x="18" y="0" width="2" height="18" style={fill("--line-1")} />
          <rect x="38" y="20" width="2" height="18" style={fill("--line-1")} />
          <rect x="6" y="8" width="2" height="2" style={fill("--line-1")} />
          <rect x="28" y="28" width="2" height="2" style={fill("--line-1")} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#plaza-${id})`} />
    </svg>
  );
}
