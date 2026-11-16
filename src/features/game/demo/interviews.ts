import { BALANCE } from "@/config/balance";
import { formatMoney } from "@/lib/format";
import {
  fillInterview,
  interviewChancePerDayBps,
  interviewEffects,
  interviewPercent,
  judgeInterviewAnswer,
  pickInterviewQuestions,
  type InterviewFacts,
} from "@/lib/sim/interviews";
import {
  GameError,
  type CompanyInterview,
  type CompanyInterviewState,
  type GameEngine,
  type InterviewAnswer,
  type NewsShowMood,
  type NewsShowSegment,
} from "../types";

/*
 * CEO interviews in the offline demo (ADR-173): the same rules as the server. The first time the player has a
 * company the show asks at once (the demo interview); after that the request comes by chance, rolled once an hour.
 * The answers are judged by the Mini-KI, the effects hit the demo company at once, and the next show airs it.
 */
const cfg = BALANCE.interviews;
const HOUR = 3_600_000;

interface StoredQuestion {
  key: string;
  text: string;
  quick: { text: string; tone: "good" | "ok" | "bad" }[];
  good: readonly string[];
}

export interface DemoInterview {
  id: number;
  status: CompanyInterview["status"];
  company: string;
  requestedAt: number;
  expiresAt: number;
  answeredAt: number | null;
  airedAt: number | null;
  questions: StoredQuestion[];
  answers: { text: string; verdict: "good" | "ok" | "bad" | "none"; points: number; reaction: string }[] | null;
  awarenessBps: number;
  reputation: number;
}

export interface DemoInterviewState {
  list: DemoInterview[];
  seq: number;
  rolledAt: number;
}

export interface InterviewHost {
  state(): DemoInterviewState | undefined;
  setState(s: DemoInterviewState): void;
  nickname(): string;
  company(): {
    name: string;
    tier: string;
    awareness: number;
    profitCents: number | null;
    staff: number;
    listed: boolean;
  } | null;
  /** Adds bps of the 0..1 awareness scale to the demo company. */
  addAwareness(bps: number): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
  random(): number;
}

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length)]!;

export function createInterviewEngine(host: InterviewHost): Pick<
  GameEngine,
  "companyInterview" | "answerCompanyInterview" | "declineCompanyInterview"
> & {
  /** The next show's interview segments, marked aired (news_show_interviews + news_show_start). */
  airSegments(): NewsShowSegment[];
  /** Demo and tests: a new request right away. */
  requestNow(): void;
} {
  const load = (): DemoInterviewState => host.state() ?? { list: [], seq: 0, rolledAt: 0 };

  const facts = (): InterviewFacts | null => {
    const c = host.company();
    if (!c) return null;
    const tier = (
      ["garage", "small_business", "gmbh", "ag"].includes(c.tier) ? c.tier : "ag"
    ) as InterviewFacts["tier"];
    return {
      tier,
      listed: c.listed,
      profitCents: c.profitCents,
      satisfaction: null,
      layoffs: 0,
      scandal: false,
      staff: c.staff,
      awarenessBps: Math.round(c.awareness * 10_000),
    };
  };

  function request(s: DemoInterviewState, now: number) {
    const f = facts();
    const c = host.company();
    if (!f || !c || s.list.some((i) => i.status === "requested")) return;
    const values = {
      ceo: host.nickname(),
      company: c.name,
      profit: c.profitCents === null ? "" : formatMoney(Math.abs(c.profitCents), { whole: true }),
      satisfaction: "",
      staff: c.staff,
    };
    s.seq += 1;
    s.list.push({
      id: s.seq,
      status: "requested",
      company: c.name,
      requestedAt: now,
      expiresAt: now + cfg.expiresHours * HOUR,
      answeredAt: null,
      airedAt: null,
      questions: pickInterviewQuestions(f, host.random).map((q) => ({
        key: q.key,
        text: fillInterview(q.text, values),
        quick: q.quick.map((a) => ({ text: fillInterview(a.text, values), tone: a.tone })),
        good: q.good ?? [],
      })),
      answers: null,
      awarenessBps: 0,
      reputation: 0,
    });
    s.list = s.list.slice(-10);
  }

  function finish(iv: DemoInterview, status: "answered" | "declined" | "expired", now: number, points = 0) {
    const effect = interviewEffects(
      status === "answered" ? { kind: "answered", points } : { kind: status },
      host.company()?.listed ?? false,
    );
    iv.status = status;
    iv.answeredAt = now;
    iv.awarenessBps = effect.awarenessBps;
    iv.reputation = effect.reputation;
    host.addAwareness(effect.awarenessBps);
  }

  function tick(): DemoInterviewState {
    const s = load();
    const now = host.now();
    for (const iv of s.list) if (iv.status === "requested" && iv.expiresAt <= now) finish(iv, "expired", now);
    const f = facts();
    if (f && s.list.length === 0) request(s, now);
    else if (f && now - s.rolledAt >= HOUR) {
      s.rolledAt = now;
      const recent = s.list.some((i) => i.requestedAt > now - cfg.cooldownHours * HOUR);
      if (!recent && host.random() * 10_000 * 24 < interviewChancePerDayBps(f)) request(s, now);
    }
    host.setState(s);
    return s;
  }

  const view = (s: DemoInterviewState): CompanyInterviewState => {
    const now = host.now();
    const iv =
      s.list.find((i) => i.status === "requested") ??
      [...s.list].reverse().find((i) => i.requestedAt > now - 24 * HOUR) ??
      null;
    return {
      maxChars: cfg.maxChars,
      interview: iv && {
        id: iv.id,
        status: iv.status,
        company: iv.company,
        requestedAt: new Date(iv.requestedAt).toISOString(),
        expiresAt: new Date(iv.expiresAt).toISOString(),
        answeredAt: iv.answeredAt === null ? null : new Date(iv.answeredAt).toISOString(),
        airedAt: iv.airedAt === null ? null : new Date(iv.airedAt).toISOString(),
        questions: iv.questions.map((q) => ({ text: q.text, quick: q.quick.map((a) => a.text) })),
        answers: iv.answers?.map(({ text, verdict, reaction }) => ({ text, verdict, reaction })) ?? null,
        awarenessBps: iv.awarenessBps,
        reputation: iv.reputation,
      },
    };
  };

  const open = (s: DemoInterviewState, id: number) => {
    const iv = s.list.find((i) => i.id === id);
    if (!iv) throw new GameError("interview_not_found");
    if (iv.status !== "requested" || iv.expiresAt <= host.now()) throw new GameError("interview_closed");
    return iv;
  };

  const effectChips = (iv: DemoInterview) => [
    {
      label: `${cfg.texts.effectAwareness} ${interviewPercent(iv.awarenessBps)}`,
      tone: iv.awarenessBps > 0 ? ("gain" as const) : iv.awarenessBps < 0 ? ("loss" as const) : ("neutral" as const),
    },
  ];

  return {
    companyInterview: () => Promise.resolve().then(() => view(tick())),
    answerCompanyInterview: (requestId, id, answers: InterviewAnswer[]) =>
      Promise.resolve().then(() => {
        for (const a of answers) {
          const text = a.text ?? "";
          if (text.length > cfg.maxChars || /[\u0000-\u0008\u000b-\u001f]/.test(text)) {
            throw new GameError("interview_text_invalid");
          }
        }
        return host.idempotent(requestId, () => {
          const s = tick();
          const iv = open(s, id);
          if (answers.length !== iv.questions.length) throw new GameError("invalid_argument");
          const values = { ceo: host.nickname(), company: iv.company };
          const judged = iv.questions.map((q, k) => {
            const j = judgeInterviewAnswer(q, answers[k] ?? {});
            return {
              ...j,
              reaction: fillInterview(pick(cfg.texts.reactions[j.verdict], host.random), values),
            };
          });
          iv.answers = judged;
          finish(
            iv,
            "answered",
            host.now(),
            judged.reduce((sum, j) => sum + j.points, 0),
          );
          host.setState(s);
          return view(s);
        });
      }),
    declineCompanyInterview: (requestId, id) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          const s = tick();
          finish(open(s, id), "declined", host.now());
          host.setState(s);
          return view(s);
        }),
      ),
    airSegments() {
      const s = load();
      const now = host.now();
      const iv = s.list.find(
        (i) => i.status !== "requested" && i.airedAt === null && (i.answeredAt ?? 0) >= now - cfg.airWithinHours * HOUR,
      );
      if (!iv) return [];
      iv.airedAt = now;
      host.setState(s);
      const values = { ceo: host.nickname(), company: iv.company };
      const mood = (key: keyof typeof cfg.moods) => pick(cfg.moods[key], host.random) as NewsShowMood;
      if (iv.status === "answered" && iv.answers) {
        const total = iv.questions.length;
        return iv.questions.map((q, k) => {
          const a = iv.answers![k]!;
          return {
            kind: "interview",
            mood: mood(a.verdict),
            headline: fillInterview(cfg.texts.headline, { ...values, n: k + 1, total }),
            text: fillInterview(cfg.texts.text, {
              ...values,
              question: q.text,
              answer: a.text || cfg.texts.noAnswer,
              reaction: a.reaction,
            }),
            effects: k === total - 1 ? effectChips(iv) : [],
          };
        });
      }
      return [
        {
          kind: "interview",
          mood: mood("none"),
          headline: fillInterview(cfg.texts.noCommentHeadline, values),
          text: fillInterview(
            pick(iv.status === "declined" ? cfg.texts.declined : cfg.texts.ignored, host.random),
            values,
          ),
          effects: effectChips(iv),
        },
      ];
    },
    requestNow() {
      const s = load();
      for (const iv of s.list) if (iv.status === "requested") iv.expiresAt = host.now() - 1;
      tick();
      const t = load();
      request(t, host.now());
      host.setState(t);
    },
  };
}
