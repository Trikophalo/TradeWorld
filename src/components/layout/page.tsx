import { ViewTransition, type ReactNode } from "react";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { cn } from "@/lib/utils";

/**
 * Wrap every page in this. It gives the page its enter/exit transition:
 * a short fade-up between tabs, a directional slide for links tagged with
 * `transitionTypes={["nav-forward"]}` or `["nav-back"]`.
 */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ViewTransition
      enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page" }}
      exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page" }}
      default="none"
    >
      <div className={cn("page-stack space-y-5 lg:space-y-6", className)}>{children}</div>
    </ViewTransition>
  );
}

/** Where the little stars of a page banner sit (percent of the banner) and when they twinkle. */
const STARS = [
  { x: 58, y: 22, d: 0 },
  { x: 66, y: 64, d: 0.9 },
  { x: 74, y: 30, d: 1.7 },
  { x: 83, y: 72, d: 0.4 },
  { x: 95, y: 20, d: 1.3 },
] as const;

/**
 * The banner on top of a page (ADR-108): the title, one sentence that says what the page is for, and a pixel picture
 * that floats a little. Gives every page its own face.
 */
export function PageHeader({
  title,
  intro,
  art,
  children,
}: {
  title: string;
  intro?: string;
  art?: PixelArt;
  children?: ReactNode;
}) {
  return (
    <header className="relative isolate overflow-hidden rounded-lg border-2 border-line-1 bg-surface-1 shadow-1">
      <span aria-hidden className="absolute inset-0 -z-10 bg-hero" />
      <span aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-2 bg-dither opacity-80" />
      {STARS.map((star) => (
        <span
          key={star.x}
          aria-hidden
          className="absolute -z-10 size-[3px] animate-twinkle bg-gold"
          style={{ left: `${star.x}%`, top: `${star.y}%`, animationDelay: `${star.d}s` }}
        />
      ))}
      <div className="flex min-h-20 items-center gap-4 px-4 py-4 lg:min-h-24 lg:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="font-pixel text-xl text-fg-1 uppercase lg:text-2xl">{title}</h1>
          {intro && <p className="mt-1.5 max-w-2xl text-sm text-pretty text-fg-2">{intro}</p>}
        </div>
        {children}
        {art && (
          <span aria-hidden className="relative mr-1 shrink-0 lg:mr-3">
            <span className="block animate-float">
              <PixelIcon {...art} scale={3} className="lg:hidden" />
              <PixelIcon {...art} scale={4} className="hidden lg:block" />
            </span>
            <span className="absolute inset-x-2 -bottom-2 h-1 rounded-pill bg-edge opacity-60" />
          </span>
        )}
      </div>
    </header>
  );
}
