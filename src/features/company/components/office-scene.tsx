"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";
import { OFFICE_DESK, OFFICE_PLANT, staffFigure } from "@/components/pixel/figures";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { useGame } from "@/features/game/store";
import type { MyCompany } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { useCompanyTeam } from "../hooks";

interface Staff {
  key: string;
  name: string;
  role: string;
  kind: "person" | "robot";
  boss?: boolean;
}

/** Pseudo-random but stable per name: every figure gets its own rhythm. */
function rhythm(key: string) {
  let h = 7;
  for (const ch of key) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return { delay: (h % 1000) / 1000, duration: 1.6 + ((h >> 4) % 900) / 1000, sway: (h >> 8) % 2 === 0 ? 2 : -2 };
}

/**
 * The office (ADR-078): everyone who works for the company stands there in a T-shirt in the company colour with
 * the logo on the chest and moves a little. Free places are empty desks. Tap opens the team.
 */
export function OfficeScene({ company, onTeam }: { company: MyCompany; onTeam: () => void }) {
  const t = useTranslations("firm");
  const team = useCompanyTeam(company.id);
  const founder = useGame((state) => state.portfolio?.nickname ?? "");
  const staff = useMemo<Staff[]>(() => {
    const list: Staff[] = [{ key: "founder", name: founder, role: t("boss"), kind: "person", boss: true }];
    for (const m of team.data ?? []) list.push({ key: m.playerJobId, name: m.nickname, role: m.title, kind: "person" });
    company.aiWorkerSkills.forEach((skill, i) =>
      list.push({ key: `ai-${skill}`, name: t("aiWorkerName"), role: `#${i + 1}`, kind: "robot" }),
    );
    const general = Math.max(0, company.aiWorkers - company.aiWorkerSkills.length);
    for (let i = 0; i < general; i++) {
      list.push({ key: `ai-general-${i}`, name: t("aiWorkerName"), role: t("aiGeneral"), kind: "robot" });
    }
    return list;
  }, [team.data, company.aiWorkers, company.aiWorkerSkills, founder, t]);
  const free = Math.max(0, company.maxEmployees + 1 - staff.length);

  return (
    <section
      aria-label={t("officeTitle")}
      data-testid="office"
      className="relative overflow-hidden rounded-xl border border-line-1 shadow-1"
      style={{
        backgroundImage: `linear-gradient(180deg, color-mix(in oklab, ${company.color} 18%, var(--bg-2)) 0%, var(--bg-2) 62%, color-mix(in oklab, ${company.color} 10%, var(--bg-3)) 62%, var(--bg-3) 100%)`,
      }}
    >
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4">
        <p className="label-pixel text-fg-2">{t("officeTitle")}</p>
        <button
          type="button"
          onClick={() => {
            haptic("tap");
            onTeam();
          }}
          className="text-xs text-accent focus-ring hover:underline"
        >
          {t("officeToTeam", { count: staff.length })}
        </button>
      </div>
      <PixelIcon
        {...OFFICE_PLANT}
        scale={4}
        className="pointer-events-none absolute bottom-4 left-2 hidden opacity-90 sm:block"
      />
      <PixelIcon {...OFFICE_PLANT} scale={3} className="pointer-events-none absolute right-3 bottom-4 opacity-90" />
      <ul className="relative flex [scrollbar-width:thin] gap-3 overflow-x-auto px-5 pt-6 pb-4 sm:gap-5 sm:pl-16">
        {staff.map((s) => (
          <li key={s.key} className="shrink-0">
            <Figure company={company} staff={s} />
          </li>
        ))}
        {Array.from({ length: Math.min(free, 6) }, (_, i) => (
          <li key={`free-${i}`} className="shrink-0">
            <button
              type="button"
              onClick={onTeam}
              className="flex h-full w-16 flex-col items-center justify-end gap-1.5 rounded-md text-fg-3 focus-ring transition duration-fast hover:text-fg-1"
            >
              <span className="grid h-12 w-12 place-items-center rounded-md border border-dashed border-line-2 text-lg">
                +
              </span>
              <span className="text-2xs">{t("freeDesk")}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Figure({ company, staff }: { company: MyCompany; staff: Staff }) {
  const art = useMemo(
    () => staffFigure(staff.kind, staff.name || staff.key, company.color, company.logo),
    [staff.kind, staff.name, staff.key, company.color, company.logo],
  );
  const r = rhythm(staff.key);
  const t = useTranslations("firm");
  const body = (
    <>
      {staff.boss && <span className="label-pixel text-2xs text-gold">★</span>}
      <div className="origin-bottom transition-transform duration-fast group-hover:scale-110">
        <motion.div
          animate={{ y: [0, -3, 0], rotate: [0, r.sway, 0] }}
          transition={{ duration: r.duration, delay: r.delay, repeat: Infinity, ease: "easeInOut" }}
          className="origin-bottom"
        >
          <PixelIcon {...art} scale={4} />
        </motion.div>
      </div>
      {staff.kind === "person" ? (
        <PixelIcon {...OFFICE_DESK} scale={4} className="relative -mt-5" />
      ) : (
        <span aria-hidden className="h-1 w-10 rounded-pill bg-fg-1/10" />
      )}
      <span className={cn("max-w-16 truncate text-2xs", staff.boss ? "font-semibold text-fg-1" : "text-fg-2")}>
        {staff.name}
      </span>
    </>
  );
  // People open their profile (ADR-084); AI workers have none.
  if (staff.kind === "person" && staff.name) {
    return (
      <Link
        href={`/players/${encodeURIComponent(staff.name)}`}
        className="group flex w-16 flex-col items-center gap-1 rounded-md focus-ring"
        title={`${staff.name} · ${staff.role}`}
        aria-label={t("openProfile", { name: staff.name })}
        data-testid="office-person"
        onClick={() => haptic("tap")}
      >
        {body}
      </Link>
    );
  }
  return (
    <div className="group flex w-16 flex-col items-center gap-1" title={`${staff.name} · ${staff.role}`}>
      {body}
    </div>
  );
}
