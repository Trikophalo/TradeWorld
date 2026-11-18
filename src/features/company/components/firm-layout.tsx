"use client";

import { motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip } from "@/components/ui/tooltip";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { placeOf, resolveCompanyTarget, type CompanyTarget } from "../tabs";

/** "Beeinflussen in Controlling → Marketing": the hint of a dashboard link (ADR-187). */
export function useWhere() {
  const t = useTranslations("hq.where");
  const th = useTranslations("hq.tabs");
  return (target: CompanyTarget) => {
    const p = placeOf(target);
    const place = p.pane ?? p.group;
    type Key = Parameters<typeof t>[0];
    const key = `places.${place}` as Key;
    return place && t.has(key) ? t("hint", { tab: th(p.tab), place: t(key) }) : t("hintTab", { tab: th(p.tab) });
  };
}

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

// ------------------------------------------------------------------ folding blocks (ADR-187)

const FOLD_KEY = "nexa-company-folds";

function readFolds(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(FOLD_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Open or closed, remembered per player in this browser (read after hydration). */
function useFold(id: string, defaultOpen: boolean): [boolean, () => void] {
  // The server and the first client render use the default; the stored choice follows after hydration.
  const stored = useSyncExternalStore(
    noSubscribe,
    () => readFolds()[id],
    () => undefined,
  );
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? (typeof stored === "boolean" ? stored : defaultOpen);
  const toggle = () => {
    const next = !open;
    setChosen(next);
    try {
      window.localStorage.setItem(FOLD_KEY, JSON.stringify({ ...readFolds(), [id]: next }));
    } catch {
      // storage blocked: the state lives for this visit
    }
  };
  return [open, toggle];
}

const noSubscribe = () => () => {};

/**
 * A block that opens and closes (ADR-187, owner request): a header button with `aria-expanded` and, while closed, a
 * short summary (a count, a total). Used for long lists that are not needed every visit.
 */
export function FoldBlock({
  id,
  title,
  summary,
  defaultOpen = true,
  className,
  children,
}: {
  id: string;
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [stored, toggle] = useFold(id, defaultOpen);
  // A link to the place opens it for this visit (not remembered).
  const [forced, setForced] = useState(false);
  useEffect(() => {
    const on = (event: Event) => {
      const d = (event as CustomEvent<CompanyTarget>).detail;
      if (d && (d.target === id || d.section === id)) setForced(true);
    };
    window.addEventListener(COMPANY_FOCUS_EVENT, on);
    return () => window.removeEventListener(COMPANY_FOCUS_EVENT, on);
  }, [id]);
  const open = stored || forced;
  const body = `fold-${id}`;
  return (
    <div className={cn("space-y-3", className)} data-testid={`fold-${id}`} data-open={open}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={body}
        onClick={() => {
          haptic("tap");
          if (forced) {
            setForced(false);
            if (stored) toggle();
          } else toggle();
        }}
        data-testid={`fold-${id}-toggle`}
        className="group flex w-full items-center gap-2 rounded-md border-b border-line-1 px-1 pb-2 text-left focus-ring transition duration-fast hover:border-line-2 active:scale-[0.99]"
      >
        <span
          aria-hidden
          className={cn(
            "font-pixel text-xs text-fg-3 transition-transform duration-fast group-hover:text-fg-1",
            open && "rotate-90",
          )}
        >
          ›
        </span>
        <span className="min-w-0 flex-1 label-pixel text-fg-1">{title}</span>
        {summary !== undefined && (
          <span className="shrink-0 nums text-xs text-fg-3" data-testid={`fold-${id}-summary`}>
            {summary}
          </span>
        )}
      </button>
      {open && (
        <motion.div
          id={body}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.base, ease: EASE.out }}
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ merged cards (ADR-187)

/** Sent by the company page right before it scrolls to a place: merged cards switch to the right pane. */
export const COMPANY_FOCUS_EVENT = "nexa:company-focus";

export function announceFocus(target: CompanyTarget) {
  window.dispatchEvent(new CustomEvent<CompanyTarget>(COMPANY_FOCUS_EVENT, { detail: target }));
}

/** The pane of a merged card: from the address on arrival, from every focus afterwards, else the first one. */
function usePane(ids: string[]): [string, (id: string) => void] {
  const params = useSearchParams();
  const wanted = resolveCompanyTarget(params.get("tab"), params.get("section")).section;
  const key = ids.join("|");
  const [pane, setPane] = useState(() => (wanted && ids.includes(wanted) ? wanted : ids[0]!));
  // The address changed (a link inside the page): follow it once.
  const [seen, setSeen] = useState(wanted);
  if (seen !== wanted) {
    setSeen(wanted);
    if (wanted && ids.includes(wanted)) setPane(wanted);
  }
  useEffect(() => {
    const on = (event: Event) => {
      const section = (event as CustomEvent<CompanyTarget>).detail?.section;
      if (section && key.split("|").includes(section)) setPane(section);
    };
    window.addEventListener(COMPANY_FOCUS_EVENT, on);
    return () => window.removeEventListener(COMPANY_FOCUS_EVENT, on);
  }, [key]);
  return [ids.includes(pane) ? pane : ids[0]!, setPane];
}

export interface Pane {
  id: string;
  label: string;
  /** One line under the switch: what this pane is for (ADR-183). */
  description?: ReactNode;
  /** A small state chip next to the switch (budget, cash …). */
  badge?: ReactNode;
  content: ReactNode;
}

/**
 * A merged card (ADR-187): what belongs together sits in one card with one header; a segmented switch shows one pane
 * at a time instead of a long stack. Each pane keeps its old section id, so every link still lands on it.
 */
export function MergedCard({
  id,
  icon,
  title,
  description,
  panes,
  className,
}: {
  id: string;
  icon: Icon;
  title: string;
  description: string;
  panes: Pane[];
  className?: string;
}) {
  const [active, setActive] = usePane(panes.map((p) => p.id));
  const pane = panes.find((p) => p.id === active) ?? panes[0]!;
  return (
    <section
      id={`section-${id}`}
      data-section={id}
      aria-labelledby={`section-${id}-title`}
      className={cn(
        "min-w-0 scroll-mt-32 space-y-3 rounded-lg border-2 border-line-1 bg-surface-1 p-3 data-[highlight]:ring-2 data-[highlight]:ring-accent sm:p-4",
        className,
      )}
      data-testid={`firm-section-${id}`}
    >
      <header className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2 ring-1 ring-line-1">
          <PixelIcon {...icon} scale={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`section-${id}-title`} className="font-semibold text-balance text-fg-1">
            {title}
          </h2>
          <p className="text-sm text-pretty text-fg-3">{description}</p>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        {panes.length > 1 && (
          <Segmented
            value={pane.id}
            onValueChange={(next) => {
              haptic("tap");
              setActive(next);
            }}
            options={panes.map((p) => ({ value: p.id, label: p.label }))}
            label={title}
            size="sm"
            className="max-w-full"
          />
        )}
        {pane.badge}
      </div>
      <div
        key={pane.id}
        id={`section-${pane.id}`}
        data-section={pane.id}
        className="min-w-0 scroll-mt-32 space-y-3 rounded-lg data-[highlight]:ring-2 data-[highlight]:ring-accent motion-safe:animate-pop"
        data-testid={`section-${pane.id}`}
      >
        {pane.description && <p className="text-xs text-pretty text-fg-3">{pane.description}</p>}
        {pane.content}
      </div>
    </section>
  );
}

/**
 * A number or chart on the dashboard that leads to where it is influenced (ADR-187): the whole tile is a button, the
 * hint "Beeinflussen in Controlling → Marketing" shows on hover and focus (always on touch screens).
 */
export function DashLink({
  hint,
  onGo,
  testId,
  className,
  compact,
  children,
}: {
  hint: string;
  onGo: () => void;
  testId?: string;
  className?: string;
  /** The hint on one line (cut with …): tiles of a grid stay the same height. */
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic("tap");
        onGo();
      }}
      data-testid={testId}
      className={cn(
        "group relative flex min-w-0 flex-col rounded-md text-left focus-ring transition duration-fast hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]",
        className,
      )}
    >
      {children}
      <span
        className="mt-1 flex items-start gap-1 px-1 text-2xs text-accent transition-opacity duration-fast pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-visible:opacity-100"
        data-testid="dash-hint"
      >
        <span className={cn("min-w-0", compact ? "truncate" : "text-pretty")}>{hint}</span>
        <span aria-hidden className="font-pixel">
          ›
        </span>
      </span>
    </button>
  );
}

/** A chart card on the dashboard with a footer link to where it is influenced (inner buttons stay usable). */
export function ChartLink({
  hint,
  onGo,
  testId,
  children,
}: {
  hint: string;
  onGo: () => void;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5" data-testid={testId}>
      {children}
      <button
        type="button"
        onClick={() => {
          haptic("tap");
          onGo();
        }}
        data-testid={testId ? `${testId}-go` : undefined}
        className="group flex w-full items-center justify-between gap-2 rounded-md border border-line-1 bg-surface-1 px-3 py-2 text-left text-xs font-medium text-accent focus-ring transition duration-fast hover:border-accent hover:bg-accent-soft active:scale-[0.98]"
      >
        <span className="min-w-0 truncate">{hint}</span>
        <span aria-hidden className="font-pixel transition-transform duration-fast group-hover:translate-x-0.5">
          ›
        </span>
      </button>
    </div>
  );
}
