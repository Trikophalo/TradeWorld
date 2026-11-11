import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "./card";

/** A card that leads to another page: icon, title, one line of context, chevron. */
export function LinkCard({ href, icon, title, hint }: { href: string; icon: ReactNode; title: string; hint: string }) {
  return (
    <Link href={href} transitionTypes={["nav-forward"]} className="block rounded-lg focus-ring">
      <Card padding="lg" interactive className="flex items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-md bg-surface-2">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-fg-1">{title}</span>
          <span className="block truncate text-sm text-fg-3">{hint}</span>
        </span>
        <svg viewBox="0 0 4 7" width="8" height="14" shapeRendering="crispEdges" aria-hidden className="text-fg-3">
          <path fill="currentColor" d="M0 0h1v1H0zM1 1h1v1H1zM2 2h1v1H2zM3 3h1v1H3zM2 4h1v1H2zM1 5h1v1H1zM0 6h1v1H0z" />
        </svg>
      </Card>
    </Link>
  );
}
