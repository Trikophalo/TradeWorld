"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { OFFICE_DESK, OFFICE_PLANT, staffFigure } from "@/components/pixel/figures";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { PlayerFigure } from "@/components/ui/player-figure";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { CompanyLogoData } from "@/lib/sim/logo";
import type { FloorMember, MyCompany } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { bubbleLeftMs, bubbleText, floorRhythm, onlineCount } from "../floor";
import { useCompanyFloor } from "../hooks";
import { FloorBubble } from "./floor-bubble";

const MAX = BALANCE.startups.chat.maxMessageLength;

interface Robot {
  key: string;
  role: string;
}

/**
 * The office (ADR-078, ADR-156): every player at the workplace stands at a desk as their dressed pixel figure with
 * name; online ones work and bob, the others sleep (zzz). The newest message of each member floats above them as a
 * speech bubble for a while; the input under the scene writes into the company chat. AI workers stay robots in a
 * T-shirt in the company colour. With `company` (the founder's page) free desks and robots come from the company;
 * without it (an employee's job page) everything comes from get_company_floor(). Many people wrap into rows.
 */
export function OfficeScene({ company, onTeam }: { company?: MyCompany; onTeam?: () => void }) {
  const t = useTranslations("floor");
  const floor = useCompanyFloor();
  const founder = useGame((state) => state.portfolio?.nickname ?? "");
  const avatarKey = useGame((state) => state.portfolio?.avatarKey ?? null);
  const now = useClock();
  const data = floor.data;

  // Until the floor loads, the founder's own page shows the founder alone (the company is known already).
  const members = useMemo<FloorMember[]>(() => {
    if (data?.company) return data.members;
    if (!company) return [];
    return [
      {
        nickname: founder,
        avatarKey: avatarKey ?? "rookie",
        accessories: [],
        role: "founder",
        title: null,
        online: true,
        me: true,
        lastMessage: null,
      },
    ];
  }, [data, company, founder, avatarKey]);

  const robots = useMemo<Robot[]>(() => {
    if (company) {
      const list: Robot[] = company.aiWorkerSkills.map((skill, i) => ({ key: `ai-${skill}`, role: `#${i + 1}` }));
      const general = Math.max(0, company.aiWorkers - company.aiWorkerSkills.length);
      for (let i = 0; i < general; i++) list.push({ key: `ai-general-${i}`, role: t("aiGeneral") });
      return list;
    }
    return Array.from({ length: data?.aiWorkers ?? 0 }, (_, i) => ({ key: `ai-general-${i}`, role: t("aiGeneral") }));
  }, [company, data?.aiWorkers, t]);

  if (!company && floor.isPending) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!company && !data?.company) return null;

  const color = company?.color ?? data?.company?.color ?? "var(--accent)";
  const logo = company?.logo ?? data?.company?.logo ?? null;
  const ai = data?.company?.kind === "ai";
  const people = members.length + robots.length;
  const free = company ? Math.max(0, company.maxEmployees + 1 - people) : 0;
  const bubbleSeconds = data?.bubbleSeconds ?? BALANCE.startups.chat.bubbleSeconds;

  return (
    <section
      aria-label={ai ? t("titleAi", { company: data?.company?.name ?? "" }) : t("title")}
      data-testid="office"
      className="overflow-hidden rounded-xl border border-line-1 bg-surface-1 shadow-1"
    >
      <div
        className="relative isolate"
        style={{
          backgroundImage: `linear-gradient(180deg, color-mix(in oklab, ${color} 18%, var(--bg-2)) 0%, var(--bg-2) 66%, color-mix(in oklab, ${color} 10%, var(--bg-3)) 66%, var(--bg-3) 100%)`,
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4 sm:px-5">
          <p className="label-pixel text-fg-2">
            {ai ? t("titleAi", { company: data?.company?.name ?? "" }) : t("title")}
          </p>
          <p className="flex items-baseline gap-2 text-xs text-fg-3">
            <span className="nums" data-testid="office-summary">
              {t("summary", { count: members.length + robots.length, online: onlineCount(members) + robots.length })}
            </span>
            {onTeam && (
              <button
                type="button"
                onClick={() => {
                  haptic("tap");
                  onTeam();
                }}
                className="rounded-xs text-accent focus-ring hover:underline"
              >
                {t("toTeam")}
              </button>
            )}
          </p>
        </div>
        <PixelIcon
          {...OFFICE_PLANT}
          scale={4}
          className="pointer-events-none absolute bottom-3 left-3 -z-10 hidden opacity-90 lg:block"
        />
        <PixelIcon
          {...OFFICE_PLANT}
          scale={3}
          className="pointer-events-none absolute right-3 bottom-3 -z-10 hidden opacity-90 sm:block"
        />
        <ul
          aria-label={t("people")}
          className="flex max-h-[min(80vh,720px)] flex-wrap items-end justify-center gap-x-1 gap-y-4 overflow-y-auto overscroll-contain px-2 pt-4 pb-3 sm:gap-x-3 sm:px-12 lg:px-20"
        >
          {members.map((m, i) => {
            const left = now === null ? null : bubbleLeftMs(m, now, bubbleSeconds);
            return (
              <li key={m.nickname || `me-${i}`} className="w-20 min-w-0 sm:w-[104px]">
                <Person member={m} bubble={left !== null && m.lastMessage ? bubbleText(m.lastMessage.body) : null} />
              </li>
            );
          })}
          {robots.map((r) => (
            <li key={r.key} className="w-20 min-w-0 sm:w-[104px]">
              <RobotFigure color={color} logo={logo} robot={r} />
            </li>
          ))}
          {Array.from({ length: Math.min(free, 6) }, (_, i) => (
            <li key={`free-${i}`} className="w-20 min-w-0 sm:w-[104px]">
              <button
                type="button"
                onClick={onTeam}
                className="flex w-full flex-col items-center justify-end gap-1.5 rounded-md text-fg-3 focus-ring transition duration-fast hover:text-fg-1 active:scale-95"
              >
                <span className="grid h-12 w-12 place-items-center rounded-md border border-dashed border-line-2 text-lg">
                  +
                </span>
                <span className="text-2xs">{t("freeDesk")}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {data?.chat ? (
        <SayForm />
      ) : ai ? (
        <p className="border-t border-line-1 px-4 py-3 text-xs text-pretty text-fg-3 sm:px-5">{t("hintAi")}</p>
      ) : null}
    </section>
  );
}

function Person({ member, bubble }: { member: FloorMember; bubble: string | null }) {
  const t = useTranslations("floor");
  const reduced = useReducedMotionConfig();
  const r = floorRhythm(member.nickname);
  const boss = member.role === "founder";
  const label = member.title ?? (boss ? t("boss") : t("employee"));
  return (
    <Link
      href={`/players/${encodeURIComponent(member.nickname)}`}
      className="group flex w-full flex-col items-center rounded-md focus-ring"
      title={`${member.nickname} · ${label}${member.online ? "" : ` · ${t("asleep")}`}`}
      aria-label={
        bubble
          ? `${t("openProfile", { name: member.nickname })}. ${t("says", { name: member.nickname, body: bubble })}`
          : t("openProfile", { name: member.nickname })
      }
      data-testid="office-person"
      data-nickname={member.nickname}
      data-me={member.me ? "true" : "false"}
      data-online={member.online ? "true" : "false"}
      onClick={() => haptic("tap")}
    >
      <span className="flex min-h-0 w-full flex-col items-center justify-end">
        <AnimatePresence initial={false}>
          {bubble && <FloorBubble key={bubble} text={bubble} mine={member.me} className="mb-0.5 w-full" />}
        </AnimatePresence>
      </span>
      <span className="relative flex flex-col items-center">
        {!member.online && <Zzz delay={r.delay} />}
        <span
          className={cn(
            "block origin-bottom transition duration-fast ease-standard group-hover:-translate-y-1 group-active:translate-y-0",
            !member.online && "opacity-55 group-hover:opacity-80",
          )}
        >
          <motion.span
            className="block origin-bottom"
            animate={member.online && !reduced ? { y: [0, -3, 0], rotate: [0, r.sway / 2, 0] } : undefined}
            transition={{ duration: r.duration, delay: r.delay, repeat: Infinity, ease: "easeInOut" }}
          >
            <PlayerFigure
              avatarKey={member.avatarKey}
              accessories={member.accessories}
              scale={2}
              className="sm:h-[96px] sm:w-[72px]"
            />
          </motion.span>
        </span>
        <PixelIcon {...OFFICE_DESK} scale={4} className="relative -mt-4 sm:-mt-6 sm:h-5 sm:w-[70px]" />
      </span>
      <span className="mt-1 flex w-full min-w-0 items-center justify-center gap-1">
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-pill", member.online ? "bg-gain" : "bg-fg-3/50")} />
        <span
          className={cn("truncate text-2xs sm:text-xs", boss || member.me ? "font-semibold text-fg-1" : "text-fg-2")}
        >
          {member.nickname}
        </span>
      </span>
      <span className="h-4 text-2xs leading-4">
        {member.me ? (
          <span className="rounded-xs bg-accent px-1 font-pixel text-on-accent uppercase">{t("you")}</span>
        ) : boss ? (
          <span className="label-pixel text-gold">★ {t("boss")}</span>
        ) : null}
      </span>
    </Link>
  );
}

/** Sleepy letters over an away figure. */
function Zzz({ delay }: { delay: number }) {
  const reduced = useReducedMotionConfig();
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute -top-1 right-0 z-10 font-pixel text-2xs text-fg-3 sm:text-xs"
      animate={reduced ? undefined : { opacity: [0, 1, 0], y: [2, -6, -10] }}
      transition={{ duration: 2.4, delay, repeat: Infinity, ease: "easeOut" }}
      data-testid="office-zzz"
    >
      zzz
    </motion.span>
  );
}

function RobotFigure({ color, logo, robot }: { color: string; logo: CompanyLogoData | null; robot: Robot }) {
  const t = useTranslations("floor");
  const reduced = useReducedMotionConfig();
  const art = useMemo(() => staffFigure("robot", robot.key, color, logo), [robot.key, color, logo]);
  const r = floorRhythm(robot.key);
  return (
    <div className="flex w-full flex-col items-center" title={`${t("aiWorkerName")} · ${robot.role}`}>
      <motion.div
        animate={reduced ? undefined : { y: [0, -2, 0] }}
        transition={{ duration: r.duration, delay: r.delay, repeat: Infinity, ease: "easeInOut" }}
      >
        <PixelIcon {...art} scale={4} className="sm:h-20 sm:w-[60px]" />
      </motion.div>
      <span aria-hidden className="h-1 w-10 rounded-pill bg-fg-1/10" />
      <span className="mt-1 max-w-full truncate text-2xs text-fg-3 sm:text-xs">{t("aiWorkerName")}</span>
      <span className="h-4" />
    </div>
  );
}

/** "Sag was ins Büro …": a line into the company chat that shows as a bubble over the own figure. */
function SayForm() {
  const t = useTranslations("floor");
  const errorText = useGameErrorText();
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  useEffect(() => {
    if (state !== "success") return;
    const timer = window.setTimeout(() => setState("idle"), 1200);
    return () => window.clearTimeout(timer);
  }, [state]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || state === "loading") return;
    setState("loading");
    try {
      await engine.postCompanyMessage(crypto.randomUUID(), body);
      setText("");
      void playSound("tap");
      haptic("success");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["company", "floor"] }),
        client.invalidateQueries({ queryKey: ["company", "chat"] }),
      ]);
      setState("success");
    } catch (error) {
      toast.error(t("title"), errorText(error));
      setState("idle");
    }
  };

  return (
    <form
      onSubmit={(event) => void send(event)}
      className="border-t border-line-1 px-3 py-3 sm:px-5"
      data-testid="office-say"
    >
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("label")}</span>
          <input
            value={text}
            maxLength={MAX}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("placeholder")}
            enterKeyHint="send"
            className="h-11 w-full rounded-md border border-line-2 bg-surface-2 px-3 text-fg-1 focus-ring placeholder:text-fg-3"
          />
        </label>
        <Button type="submit" state={state} disabled={!text.trim() && state === "idle"}>
          {t("send")}
        </Button>
      </div>
      <p className="mt-1.5 text-2xs text-pretty text-fg-3 sm:text-xs">{t("hint")}</p>
    </form>
  );
}
