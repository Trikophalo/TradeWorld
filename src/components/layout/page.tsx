import { ViewTransition, type ReactNode } from "react";
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
      <div className={cn("space-y-5 lg:space-y-6", className)}>{children}</div>
    </ViewTransition>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4">
      <h1 className="font-pixel text-xl text-fg-1 uppercase lg:text-2xl">{title}</h1>
      {children}
    </div>
  );
}
