"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Tooltip } from "@/components/ui/tooltip";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/*
 * The building blocks of the company page since ADR-183: flat sections with one header (icon, title, one line of
 * what it is for), sub-sections without folding, a sticky jump bar per tab and a small "i" that explains a number
 * or a control. Nothing folds away any more: every feature is one scroll or one jump away.
 */

type Icon = (typeof UI_ICONS)[keyof typeof UI_ICONS];

/** A small "i" button with an explanation in a bubble (hover, focus or tap). */
export function InfoTip({ text, label, className }: { text: ReactNode; label: string; className?: string }) {
  const t = useTranslations("hq.layout");
  return (
    <Tooltip content={text} className="max-w-72">
      <button
        type="button"
        aria-label={t("info", { topic: label })}
        data-testid="info-tip"
        className={cn(
          "inline-grid size-5 shrink-0 place-items-center rounded-pill border border-line-2 font-pixel text-2xs leading-none text-fg-3 focus-ring transition duration-fast hover:border-accent hover:text-fg-1 active:scale-90",
          className,
        )}
      >
        i
      </button>
    </Tooltip>
  );
}

/** A top-level section of a tab: header with icon, title and what it is for, then its cards. */
export function FirmSection({
  id,
  icon,
  title,
  description,
  aside,
  columns = 1,
  testId,
  children,
}: {
  id: string;
  icon: Icon;
  title: string;
  description: string;
  aside?: ReactNode;
  /** 2: the cards sit side by side from lg. */
  columns?: 1 | 2;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={`section-${id}`}
      data-section={id}
      aria-labelledby={`section-${id}-title`}
      className="scroll-mt-32 space-y-3 data-[highlight]:rounded-lg data-[highlight]:ring-2 data-[highlight]:ring-accent"
      data-testid={testId ?? `firm-section-${id}`}
    >
      <header className="flex items-start gap-3 border-b-2 border-line-1 pb-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2 ring-1 ring-line-1">
          <PixelIcon {...icon} scale={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`section-${id}-title`} className="font-semibold text-balance text-fg-1">
            {title}
          </h2>
          <p className="text-sm text-pretty text-fg-3">{description}</p>
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </header>
      <div className={cn("grid items-start gap-4 *:min-w-0", columns === 2 && "lg:grid-cols-2 lg:gap-5")}>
        {children}
      </div>
    </section>
  );
}

/** A block inside a section (a former folding section): title and one line, never folded. */
export function SubSection({
  id,
  title,
  description,
  badge,
  className,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={`section-${id}`}
      data-section={id}
      className={cn(
        "scroll-mt-32 space-y-3 rounded-lg data-[highlight]:ring-2 data-[highlight]:ring-accent",
        className,
      )}
      data-testid={`section-${id}`}
    >
      <div>
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg-1">
          {title}
          {badge}
        </h3>
        {description && <p className="text-xs text-pretty text-fg-3">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export interface NavItem {
  id: string;
  label: string;
  icon?: Icon;
  badge?: number;
}

/**
 * The jump bar of a tab: sticky under the top bar, scrolls sideways on phones (the page never does) and marks the
 * section in view. Targets are `section-<id>` elements.
 */
export function SectionNav({ items, label, testId }: { items: NavItem[]; label: string; testId?: string }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const ids = items.map((x) => x.id).join("|");
  useEffect(() => {
    const els = ids
      .split("|")
      .map((id) => document.getElementById(`section-${id}`))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0 || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive((top.target as HTMLElement).dataset.section ?? null);
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, [ids]);
  return (
    <nav
      aria-label={label}
      data-testid={testId}
      className="sticky top-(--topbar-height) z-10 -mx-4 border-b-2 border-line-1 bg-bg/90 px-4 py-2 backdrop-blur-lg lg:mx-0 lg:rounded-md lg:border-2"
    >
      <ul className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {items.map((item) => (
          <li key={item.id} className="shrink-0">
            <button
              type="button"
              aria-current={active === item.id ? "true" : undefined}
              onClick={() => {
                haptic("tap");
                setActive(item.id);
                document.getElementById(`section-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              data-testid={`nav-${item.id}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-medium focus-ring transition duration-fast active:scale-95",
                active === item.id
                  ? "border-accent bg-accent-soft text-fg-1"
                  : "border-line-1 bg-surface-1 text-fg-2 hover:border-line-2 hover:text-fg-1",
              )}
            >
              {item.icon && <PixelIcon {...item.icon} scale={1} />}
              {item.label}
              {item.badge ? (
                <span className="rounded-pill bg-accent px-1.5 nums text-2xs text-on-accent">{item.badge}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
