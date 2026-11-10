import { formatBps } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Signed change in basis points with direction arrow and gain/loss colour. */
export function Delta({ bps, className, pill = false }: { bps: number; className?: string; pill?: boolean }) {
  const tone = bps > 0 ? "text-gain" : bps < 0 ? "text-loss" : "text-fg-3";
  const soft = bps > 0 ? "bg-gain-soft" : bps < 0 ? "bg-loss-soft" : "bg-surface-3";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 nums text-sm font-medium",
        tone,
        pill && cn("rounded-xs px-1.5 py-0.5", soft),
        className,
      )}
    >
      <svg
        viewBox="0 0 5 3"
        width="10"
        height="6"
        shapeRendering="crispEdges"
        aria-hidden
        className={cn(bps === 0 && "hidden")}
      >
        <path
          fill="currentColor"
          d={bps > 0 ? "M2 0h1v1H2zM1 1h3v1H1zM0 2h5v1H0z" : "M0 0h5v1H0zM1 1h3v1H1zM2 2h1v1H2z"}
        />
      </svg>
      {formatBps(bps)}
    </span>
  );
}
