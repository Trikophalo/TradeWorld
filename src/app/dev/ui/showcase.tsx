"use client";

import { PlayerTag } from "@/components/ui/player-tag";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page";
import { ALL_PIXEL_ART, BEAR, BULL, COIN, MIRA, UI_ICONS } from "@/components/pixel/art";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { DelegatedTaskOverlay } from "@/features/company/components/delegated-task-overlay";
import { AVATAR_ART } from "@/components/pixel/avatars";
import { NEWS_STUDIO_ART } from "@/components/pixel/news-art";
import { Mascot } from "@/components/pixel/mascot";
import { Avatar } from "@/components/ui/avatar";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { Delta } from "@/components/ui/delta";
import { burstConfetti, flyCoins } from "@/components/ui/effects";
import { EmptyState } from "@/components/ui/empty-state";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { BusinessCard } from "@/features/career/components/business-card";
import { PlayerFigure } from "@/components/ui/player-figure";
import { FloorBubble } from "@/features/company/components/floor-bubble";
import { OfficeScene } from "@/features/company/components/office-scene";
import { ACCESSORIES } from "@/config/accessories";
import { BattleShowcase } from "@/features/news/battle/showcase";
import { FriendsPlaza } from "@/features/friends/components/plaza";
import { ChatIconButton, ChatsView, ChatUnreadBadge, MessageFriendButton } from "@/features/friends/components/chats";
import { RentalShowcase } from "@/features/property/components/rental-showcase";
import { NexamonShowcase } from "@/features/nexamon/components/showcase";
import { BattleModesShowcase } from "@/features/nexamon/live/battle-showcase";
import { PokeButton } from "@/features/friends/components/poke";
import { FigureCard } from "@/features/wardrobe/components/figure-card";
import { CareerLadder, PayRoutes } from "@/features/career/components/career-ladder";
import { CloneCard } from "@/features/career/components/clone-card";
import { PostingPerks } from "@/features/career/components/job-portal";
import { RewardsBox } from "@/features/career/components/my-job-card";
import { PostingPerksFields } from "@/features/company/components/employer";
import { UpgradeCard } from "@/features/upgrades/components/upgrade-shop";
import { CRYPTO } from "@/config/crypto";
import { StatBars } from "@/features/crypto/components/coin-detail";
import { CoinLogo } from "@/features/crypto/components/coin-logo";
import { SignaturePad } from "@/features/career/components/signature-pad";
import { CompanyMovesCard } from "@/features/company/components/company-moves";
import { CompanySkillsCard } from "@/features/company/components/company-skills";
import { LogoRedraw } from "@/features/company/components/logo-redraw";
import { HealthCompact, HealthPanel } from "@/features/company/components/health-panel";
import { FirmSection, InfoTip, SectionNav, SubSection } from "@/features/company/components/firm-layout";
import { ReputationCard } from "@/features/company/components/reputation-card";
import { companyHealth, type HealthCompany } from "@/lib/sim/company-health";
import { InterviewCard } from "@/features/company/components/interview-card";
import { NewsPromoCard, TaxPromoCard } from "@/features/news/promo/promo-card";
import type { CompanySkillsState, NewsPromo } from "@/features/game/types";
import { TaskGameView } from "@/features/company/tasks/games";
import { TaskBoard } from "@/features/company/tasks/task-board";
import { AutopilotCard } from "@/features/company/components/autopilot-card";
import { AwarenessBreakdown } from "@/features/company/awareness/awareness-breakdown";
import { PulseCard } from "@/features/company/components/pulse-card";
import type { CompanyAutopilot, CompanyAwareness, MyCompany } from "@/features/game/types";
import type { CompanyMoves, CompanyTasks, MyJob, PlayerCard } from "@/features/game/types";
import { SpeechBubble } from "@/features/tutorial/components/speech-bubble";
import { useTutorial } from "@/features/tutorial/store";
import { resetDemoPlayer } from "@/features/game/demo-engine";
import { FriendCodeCard } from "@/features/friends/components/friend-code";
import { NewsAudienceDemo } from "@/features/news/show/audience-demo";
import { NewsStudioDemo } from "@/features/news/show/studio-demo";
import { StockNewsCard } from "@/features/news/stock-news";
import { StockFiguresCard } from "@/features/market/components/stock-figures";
import { LevelCard } from "@/features/progression/components/level-card";
import { PatchNotesButton, PatchNotesList } from "@/features/patch-notes/components/patch-notes";
import { usePatchNotesSeen } from "@/features/patch-notes/seen";
import { PATCH_NOTES } from "@/config/patch-notes.generated";
import { formatMoney, formatPrice } from "@/lib/format";
import { DURATION, SPRING, fadeUp, staggerContainer } from "@/lib/motion";
import { SOUND_NAMES, playSound } from "@/lib/sound";
import { useMountTime } from "@/lib/use-now";
import { useSettings } from "@/stores/settings";
import { cn } from "@/lib/utils";
import { CriticBadge } from "@/features/artworks/components/artwork-card";
import type { Artwork } from "@/features/game/types";
import { ToplistShowcase } from "@/features/rich-list/components/toplist-showcase";

const COLOR_GROUPS = [
  { title: "Flächen", tokens: ["bg-0", "bg-1", "bg-2", "bg-3"] },
  { title: "Text", tokens: ["fg-1", "fg-2", "fg-3"] },
  { title: "Linien", tokens: ["line-1", "line-2"] },
  { title: "Akzent", tokens: ["accent", "accent-strong", "accent-soft"] },
  { title: "Semantik", tokens: ["gain", "loss", "warn", "info", "gold"] },
] as const;

const SAMPLE_CARD: PlayerCard = {
  nickname: "Boersenfuchs_7",
  cloneJob: null,
  tag: "K7Q2",
  trophies: { gold: 2, silver: 1, bronze: 0 },
  avatarKey: "analyst",
  level: 23,
  rank: 42,
  netWorthCents: 18_450_000_00,
  streakDays: 12,
  skillsLearned: 14,
  branchScores: { it: 12, finance: 9, law: 0, craft: 0, sales: 4, management: 3, science: 0, logistics: 0 },
  topSkills: [{ key: "it_cloud", tier: 4 }],
  job: {
    companyName: "KlarSoft AG",
    titleKey: "it_team_lead",
    title: null,
    tier: "team_lead",
    since: "2026-10-01T00:00:00Z",
  },
  company: null,
  memberSince: "2026-09-01T00:00:00Z",
  trust: { score: 72, band: "reliable", kept: 6, broken: 0 },
  accessories: ["superhero_cape", "tuxedo", "sunglasses", "top_hat", "money_bag", "parrot"],
};

/** A junior in IT who is two IT points short of senior (ADR-094). */
/** Business moves of a courier garage (ADR-127), one running and one done. */
// Always 20 of 35 minutes left when the page loads, so the countdown looks real.
const SAMPLE_END = Date.now() + 20 * 60_000;
const SAMPLE_MOVES: CompanyMoves = {
  slots: 2,
  used: 1,
  cashCents: 900_000,
  tier: "small_business",
  product: "courier",
  moves: [
    {
      key: "hospital_express",
      kind: "cash",
      risk: "normal",
      branch: "logistics",
      minutes: 30,
      costCents: 480_000,
      chanceBps: 7_600,
      skillBonusBps: 600,
      payoutCents: 720_000,
      refundCents: 144_000,
      gain: 0,
      availableAt: null,
      restMinutes: 90,
    },
    {
      key: "courier_app",
      kind: "awareness",
      risk: "normal",
      branch: "it",
      minutes: 35,
      costCents: 400_000,
      chanceBps: 7_000,
      skillBonusBps: 0,
      payoutCents: 0,
      refundCents: 120_000,
      gain: 0.04,
      // Resting: the cooldown box with its countdown (company fixes, migration 5300).
      availableAt: new Date(SAMPLE_END + 25 * 60_000).toISOString(),
      restMinutes: 105,
    },
  ],
  running: [
    {
      id: 2,
      key: "courier_app",
      startedAt: new Date(SAMPLE_END - 35 * 60_000).toISOString(),
      endsAt: new Date(SAMPLE_END).toISOString(),
      costCents: 400_000,
      chanceBps: 7_000,
    },
  ],
  history: [
    {
      id: 1,
      key: "hospital_express",
      status: "success",
      costCents: 480_000,
      payoutCents: 720_000,
      gain: 0,
      resolvedAt: "2026-11-14T11:30:00.000Z",
    },
  ],
};

/** Task board of a fashion label (ADR-129): one open task, one with the senior, a few results. */
const SAMPLE_TASKS: CompanyTasks = {
  role: "founder",
  company: { id: "demo", name: "Mona Moden", tier: "small_business", product: "fashion" },
  momentum: 1.35,
  myTier: "c_level",
  autoAi: true,
  aiWorkers: 1,
  aiMinutes: 12,
  canUseAi: true,
  people: [
    { nickname: "Sven", tag: "A1B2", tier: "senior", isMe: false, supervisor: null, reportsToMe: true, openTasks: 1 },
    { nickname: "Ida", tag: "C3D4", tier: "intern", isMe: false, supervisor: "Sven", reportsToMe: false, openTasks: 0 },
  ],
  tasks: [
    {
      id: 1,
      key: "pack_shirts",
      game: "pick",
      branch: "logistics",
      status: "open",
      valueCents: 165_000,
      createdAt: new Date(SAMPLE_END - 30 * 60_000).toISOString(),
      dueAt: new Date(SAMPLE_END).toISOString(),
      assignee: null,
      assigneeAi: false,
      assignedBy: null,
      aiDoneAt: null,
      openedAt: null,
      mine: false,
      canDelegate: true,
    },
    {
      id: 2,
      key: "runway_order",
      game: "seq",
      branch: "sales",
      status: "assigned",
      valueCents: 135_000,
      createdAt: new Date(SAMPLE_END - 20 * 60_000).toISOString(),
      dueAt: new Date(SAMPLE_END + 25 * 60_000).toISOString(),
      assignee: "Sven",
      assigneeAi: false,
      assignedBy: "Mona",
      aiDoneAt: null,
      openedAt: null,
      mine: false,
      canDelegate: true,
    },
  ],
  history: [
    {
      id: 3,
      key: "color_match",
      status: "success",
      resultCents: 150_000,
      scoreBps: 10_000,
      ai: false,
      doneBy: "Ida",
      resolvedAt: "2026-11-14T11:30:00.000Z",
    },
    {
      id: 4,
      key: "size_count",
      status: "missed",
      resultCents: -72_000,
      scoreBps: null,
      ai: false,
      doneBy: null,
      resolvedAt: "2026-11-14T11:10:00.000Z",
    },
  ],
};

/** A CEO interview request (ADR-173); sending goes to the demo engine, which knows no such id. */
/** News-Aktionen (ADR-193): the three kinds, the empty state and the tax return on the dashboard. */
function NewsPromoShowcase() {
  const now = useMountTime();
  if (now === null) return null;
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  const base: NewsPromo = {
    id: 1,
    kind: "pack_sale",
    set: "cosmic_winds",
    bps: 2000,
    startsAt: at(-3),
    endsAt: at(12),
    headline: "Booster-Rabatt: Cosmic Winds 20 % günstiger",
    text: "",
    claimed: false,
    claimedCents: 0,
    tax: null,
  };
  const tax: NewsPromo = {
    ...base,
    id: 3,
    kind: "tax_return",
    set: null,
    bps: 1000,
    headline: "Steuererklärung mit Rückzahlung",
    tax: { owner: true, revenueCents: 2_400_000, refundCents: 240_000, capCents: 5_000_000, shareBps: 1000 },
  };
  return (
    <Demo label="News-Aktionen (ADR-193)" className="flex-col items-stretch gap-3">
      <NewsPromoCard preview={base} />
      <NewsPromoCard
        preview={{ ...base, id: 2, kind: "free_nft", set: null, bps: 0, headline: "Gratis-NFT für alle" }}
      />
      <NewsPromoCard preview={tax} />
      <TaxPromoCard preview={{ ...tax, claimed: true, claimedCents: 240_000 }} />
      <NewsPromoCard preview={null} />
    </Demo>
  );
}

/** Fertigkeiten (ADR-194): one learned, one in training, one locked, one at the maximum. */
const SAMPLE_COMPANY_SKILLS: CompanySkillsState = {
  freeCashCents: 1_200_000,
  skills: BALANCE.companySkills.skills.map((s, i) => {
    const level = [2, 1, 0, 5, 0, 0, 0, 0, 0][i] ?? 0;
    const max = BALANCE.companySkills.maxLevel;
    return {
      key: s.key,
      branch: s.branch,
      effect: s.effect,
      level,
      maxLevel: max,
      trainingUntil: i === 1 ? "2099-01-01T12:00:00Z" : null,
      requires: [...s.requires],
      nextRequires: level < max ? (s.requires[level] ?? null) : null,
      missing: level < max && i !== 0 && i !== 4 ? (s.requires[level] ?? null) : null,
      nextCostCents: level < max ? (BALANCE.companySkills.costCentsByLevel[level] ?? null) : null,
      nextHours: level < max ? (BALANCE.companySkills.trainingHoursByLevel[level] ?? null) : null,
      effectBps: s.perLevelBps * level,
      nextEffectBps: level < max ? s.perLevelBps * (level + 1) : null,
    };
  }),
  totalBps: { demand: 200, capacity: 0, cogs: 500, fixed: 0, quality: 0 },
  capBps: { ...BALANCE.companySkills.capBps },
};

const SAMPLE_INTERVIEW = {
  maxChars: 240,
  interview: {
    id: 999,
    status: "requested" as const,
    company: "Pixelwerft",
    requestedAt: "2026-11-14T10:00:00.000Z",
    expiresAt: "2099-11-14T16:00:00.000Z",
    answeredAt: null,
    airedAt: null,
    questions: [
      {
        text: "Wo steht Pixelwerft in fünf Jahren? Und bitte nicht „auf dem Mond“.",
        quick: ["Marktführer, mit glücklichen Kunden und Team.", "Hoffentlich noch da.", "Auf dem Mond."],
      },
      {
        text: "Letzte Frage, sehr wichtig: Wie finden Sie meine Krawatte?",
        quick: ["Mutig. Fast so mutig wie unser nächstes Produkt.", "Sie ist… eine Krawatte.", "Ehrlich? Furchtbar."],
      },
    ],
    answers: null,
    awarenessBps: 0,
    reputation: 0,
  },
};

/** Hands-on task games (ADR-144) with fixed puzzles; answers only go to the toast. */
const SAMPLE_GAMES = [
  { game: "sort", taskKey: "pay_invoices", puzzle: { items: [5, 0, 3, 6, 1, 7, 2, 4] } },
  { game: "slider", taskKey: "align_labels", puzzle: { targets: [34, 72, 55] } },
  { game: "rotate", taskKey: "fix_antenna", puzzle: { start: [3, 6, 1], target: [0, 2, 5], steps: 8 } },
  { game: "match", taskKey: "file_documents", puzzle: { items: [4, 0, 7, 2, 3, 8], boxes: 3 } },
  { game: "path", taskKey: "office_route", puzzle: { size: 5, start: 10, goal: 9, walls: [1, 6, 11, 13, 18, 23, 8] } },
  { game: "math", taskKey: "payroll_check", puzzle: { a: 6, b: 24 } },
  // ADR-173
  { game: "memory", taskKey: "badge_pairs", puzzle: { cards: [2, 0, 3, 1, 0, 2, 1, 3] } },
  { game: "timing", taskKey: "stamp_timing", puzzle: { targets: [30, 72, 51], sweep_ms: 1600 } },
  {
    game: "diff",
    taskKey: "invoice_diff",
    puzzle: { left: [0, 2, 4, 1, 3, 5, 0, 2, 4, 1, 3, 5], right: [0, 3, 4, 1, 3, 4, 0, 2, 4, 0, 3, 5] },
  },
  {
    game: "quick",
    taskKey: "cash_count",
    puzzle: {
      problems: [
        { a: 34, b: 18, op: "add", options: [52, 49, 55] },
        { a: 61, b: 27, op: "add", options: [80, 88, 96] },
        { a: 12, b: 45, op: "add", options: [53, 57, 61] },
      ],
    },
  },
  {
    game: "route",
    taskKey: "delivery_tour",
    puzzle: {
      points: [
        [0, 0],
        [4, 1],
        [1, 4],
        [5, 5],
        [2, 2],
      ],
    },
  },
  {
    game: "haggle",
    taskKey: "supplier_haggle",
    puzzle: {
      rounds: [
        [1, 0, 2],
        [2, 1, 0],
        [0, 2, 1],
      ],
    },
  },
  { game: "pack", taskKey: "truck_pack", puzzle: { weights: [5, 2, 4, 3, 1, 2], values: [9, 3, 6, 5, 2, 4], cap: 8 } },
  {
    game: "catch",
    taskKey: "spam_catch",
    puzzle: {
      events: [
        { cell: 0, good: true },
        { cell: 4, good: false },
        { cell: 7, good: true },
        { cell: 2, good: true },
        { cell: 5, good: false },
        { cell: 1, good: true },
      ],
      every_ms: 1100,
      show_ms: 900,
    },
  },
  // ADR-180: five more games
  { game: "restock", taskKey: "restock_shelves", puzzle: { stock: [3, 9, 0, 5], target: [12, 14, 8, 10] } },
  { game: "receipts", taskKey: "expense_check", puzzle: { amounts: [23, 48, 15, 72, 9, 31], target: 87 } },
  {
    game: "offer",
    taskKey: "best_customer",
    puzzle: {
      offers: [
        [
          [12, 9],
          [4, 30],
          [18, 5],
        ],
        [
          [7, 16],
          [15, 8],
          [3, 35],
        ],
      ],
    },
  },
  {
    game: "pattern",
    taskKey: "sales_forecast",
    puzzle: {
      rows: [
        { seq: [3, 7, 11, 15], options: [21, 19, 17] },
        { seq: [2, 4, 8, 16], options: [32, 28, 36] },
      ],
    },
  },
  {
    game: "shelf",
    taskKey: "shelf_order",
    puzzle: { grid: [1, -1, 0, -1, 0, -1, 1, 2, -1, 0, -1, -1, 3, -1, 2, 0] },
  },
  // ADR-186: drag and see
  { game: "tiles", taskKey: "shipment_tiles", puzzle: { size: 3, board: [0, 1, 2, 3, -1, 5, 6, 4, 7] } },
  {
    game: "bins",
    taskKey: "crate_shelves",
    puzzle: {
      items: [
        [0, 1],
        [1, 0],
        [2, 2],
        [0, 0],
        [1, 2],
        [2, 1],
      ],
      by: 0,
      kinds: 3,
    },
  },
  {
    game: "untangle",
    taskKey: "cable_mess",
    puzzle: {
      grid: 5,
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
      points: [
        [0, 0],
        [3, 3],
        [3, 0],
        [0, 3],
      ],
    },
  },
  {
    game: "odd",
    taskKey: "defect_spot",
    puzzle: {
      rounds: [
        [4, 4, 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
        [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 13, 12, 12, 12, 12, 12],
      ],
    },
  },
  {
    game: "rebuild",
    taskKey: "desk_layout",
    puzzle: { size: 3, layout: [0, -1, -1, -1, 1, -1, 2, -1, 3], show_seconds: 3 },
  },
  { game: "align", taskKey: "line_setup", puzzle: { slots: [3, 0, 5, 1, 4, 2], parts: [0, 1, 2, 3] } },
  {
    game: "pipes",
    taskKey: "pipe_fix",
    puzzle: {
      size: 4,
      tiles: [1, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0],
      turns: [0, 1, 2, 3, 0, 1, 0, 1, 1, 0, 2, 3, 3, 2, 1, 0],
      from: 1,
      to: 1,
    },
  },
  { game: "sizes", taskKey: "parcel_sizes", puzzle: { sizes: [70, 40, 100, 55, 85, 30] } },
  { game: "conveyor", taskKey: "belt_sort", puzzle: { items: [0, 1, 2, 0], every_ms: 6000, travel_ms: 60000 } },
] as const;

/** Autopilot and the last hour (ADR-180). */
/** ADR-188: a garage of stage 1 with marketing, a solved task since the last hour. */
const SAMPLE_AWARENESS: CompanyAwareness = {
  awareness: 0.33,
  cap: 0.65,
  floor: 0.02,
  tier: "garage",
  stage: 1,
  expansionLevel: 0,
  tierCap: 0.6,
  perStage: 0.05,
  perExpansionLevel: 0.03,
  strength: 48,
  lastHour: {
    hourStart: "2026-11-17T09:00:00.000Z",
    parts: { marketing: 0.012, word_of_mouth: 0.0012, tasks: 0.005, decay: -0.0012 },
  },
  since: { tasks: 0.005, campaign: 0.03 },
  history: [],
};

const SAMPLE_AUTOPILOT: CompanyAutopilot = {
  on: true,
  canToggle: true,
  mood: 0.8,
  chanceBps: 10_800,
  rewardBps: 7_000,
  failPenaltyBps: 3_000,
  maxPerDay: 24,
  everyMinutes: 60,
  payFactorBps: 12_400,
  today: { done: 14, success: 9, cents: 342_000 },
  log: [
    { at: "2026-11-17T06:10:00Z", key: "restock_shelves", success: true, resultCents: 38_000, chanceBps: 10_800 },
    { at: "2026-11-17T05:10:00Z", key: "pay_invoices", success: false, resultCents: -12_000, chanceBps: 9_200 },
  ],
  lastHour: {
    hourStart: "2026-11-17T06:00:00Z",
    revenueCents: 281_900,
    profitCents: 31_700,
    demandCents: 250_000,
    capacityCents: 281_250,
    aiWorkers: 3,
    aiWagesDueCents: 25_300,
    aiUtilizationBps: 7_000,
    awarenessBefore: 0.48,
    awarenessAfter: 0.492,
    awarenessParts: { wordOfMouth: 0.006, marketing: 0.014, decay: 0.01, extra: 0.002, cap: 0.7 },
  },
};

function SampleGame({ sample }: { sample: (typeof SAMPLE_GAMES)[number] }) {
  const [round, setRound] = useState(0);
  return (
    <Card padding="lg" className="space-y-3 self-start">
      <div className="flex items-center justify-between gap-2">
        <p className="label-pixel text-fg-3">Minispiel „{sample.game}“ (ADR-144, ADR-173, ADR-186)</p>
        {(sample.game === "catch" || sample.game === "conveyor") && (
          <Button
            size="sm"
            variant="ghost"
            data-testid={`sample-restart-${sample.game}`}
            onClick={() => setRound((r) => r + 1)}
          >
            Neu
          </Button>
        )}
      </div>
      <TaskGameView
        key={round}
        game={sample.game}
        taskKey={sample.taskKey}
        puzzle={sample.puzzle as unknown as Record<string, unknown>}
        disabled={false}
        onAnswer={(answer) => {
          toast.info(sample.game, JSON.stringify(answer));
          // the reaction game runs by itself: restart it only on demand, or it loops forever
          if (sample.game !== "catch" && sample.game !== "conveyor") setRound((r) => r + 1);
        }}
      />
    </Card>
  );
}

/** Clone, rewards and posting perks (ADR-206) in their states. */
function CloneShowcase() {
  const [profit, setProfit] = useState(100);
  const [stock, setStock] = useState(200);
  const base = { minLevel: 20, feeCents: 2_500_000, job: null };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CloneCard state={{ ...base, level: 16, clone: null }} />
      <CloneCard state={{ ...base, level: 22, clone: null }} />
      <CloneCard
        state={{ ...base, level: 22, clone: { name: "Klon von Boersenfuchs_7", createdAt: "2026-11-10T08:00:00Z" } }}
      />
      <CloneCard
        state={{
          ...base,
          level: 22,
          clone: { name: "Klon von Boersenfuchs_7", createdAt: "2026-11-10T08:00:00Z" },
          job: {
            ...SAMPLE_JOB,
            isClone: true,
            holderName: "Klon von Boersenfuchs_7",
            tier: "senior",
            profitShareBps: 50,
          },
        }}
      />
      <Card padding="lg">
        <RewardsBox
          job={{
            skillPayBps: 21_000,
            profitShareBps: 200,
            stockGrantChanceBps: 500,
            rewards: { profitShareCents: 412_000, stockGrants: 2, stockGrantCents: 1_040_000, sharesE6: 34_000_000 },
          }}
        />
      </Card>
      <Card padding="lg" className="space-y-3">
        <PostingPerks
          posting={{
            skillPayBps: 14_350,
            marketSalaryCentsPerHour: 100_450,
            profitShareBps: 350,
            stockGrantChanceBps: 800,
            postingProfitShareBps: 300,
            postingStockGrantBps: 500,
            company: { id: "c", name: "Klon Werk", ticker: null, sector: "tech", color: null, isAi: false, logo: null },
          }}
        />
        <PostingPerksFields
          tier="senior"
          profitShare={profit}
          stockGrant={stock}
          onProfitShare={setProfit}
          onStockGrant={setStock}
        />
      </Card>
    </div>
  );
}

const SAMPLE_JOB: MyJob = {
  id: "job-sample",
  company: {
    id: "demo-KLS",
    name: "KlarSoft AG",
    ticker: "KLS",
    sector: "tech",
    color: null,
    isAi: true,
    logo: null,
  },
  tier: "junior",
  titleKey: "it_junior",
  title: null,
  required: [{ branch: "it", minScore: 2 }],
  salaryCentsPerHour: 30_000,
  payFactorBps: 10_000,
  effectiveSalaryCentsPerHour: 30_000,
  productivityBps: 18_000,
  startedAt: "2026-11-01T00:00:00Z",
  paidHoursToday: 4,
  paidHoursCap: 12,
  earnedTotalCents: 1_200_000,
  raiseAvailableAt: null,
  raiseMaxBps: 0,
  pendingRaise: null,
  quitCostCents: 360_000,
  signature: null,
  lastBonusCents: 0,
  nextWorkTaskAt: null,
  workTaskOpen: false,
  noticeEndsAt: null,
  quitNowCostCents: 360_000,
  rankHours: 20,
  presence: { lastActiveAt: "2026-11-13T08:00:00Z", payBps: 10_000, fireAt: "2026-11-18T08:00:00Z" },
  isClone: false,
  holderName: "Boersenfuchs_7",
  skillPayBps: 13_200,
  profitShareBps: 0,
  stockGrantChanceBps: 100,
  rewards: { profitShareCents: 0, stockGrants: 0, stockGrantCents: 0, sharesE6: 0 },
  promotion: {
    nextTier: "senior",
    mainBranch: "it",
    requirements: [
      { key: "level", branch: null, need: 12, have: 14, met: true },
      { key: "branch", branch: "it", need: 6, have: 4, met: false },
      { key: "hours", branch: null, need: 36, have: 20, met: false },
    ],
    ready: false,
    boss: "ai",
    chanceBps: 0,
    retryAt: null,
    pendingSince: null,
    nextSalaryCentsPerHour: 70_000,
  },
};

// Patch notes sample: the two newest releases, the two newest entries marked as new.
const PATCH_SAMPLE = PATCH_NOTES.slice(0, 2);
const PATCH_FRESH: ReadonlySet<string> = new Set(PATCH_NOTES[0]?.entries.slice(0, 2).map((entry) => entry.id));
const NOTHING_FRESH: ReadonlySet<string> = new Set();

const money = (value: number) => formatMoney(Math.round(value));
const price = (value: number) => formatPrice(Math.round(value));

function Section({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-10 scroll-mt-6">
      <h2 id={`${id}-title`} className="mb-4 font-pixel text-base text-fg-1 uppercase">
        {title}
      </h2>
      <div className={className}>{children}</div>
    </section>
  );
}

function Demo({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Card padding="lg" className="flex flex-col">
      <p className="mb-4 label-pixel text-fg-3">{label}</p>
      <div className={cn("flex flex-1 flex-wrap items-center gap-3", className)}>{children}</div>
    </Card>
  );
}

export function Showcase() {
  const t = useTranslations("showcase");
  const settings = useSettings();
  const [buttonState, setButtonState] = useState<ButtonState>("idle");
  const [balance, setBalance] = useState(1_284_250);
  const [quote, setQuote] = useState(1_126_400);
  const [loaded, setLoaded] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [range, setRange] = useState("1T");
  const [toggle, setToggle] = useState(true);
  const [progress, setProgress] = useState(0.35);
  const [shake, setShake] = useState(0);
  const [items, setItems] = useState(["KLS", "VLT", "BRZ", "NPH"]);
  const [bubble, setBubble] = useState(0);
  const router = useRouter();
  const coinFrom = useRef<HTMLDivElement>(null);
  const coinTo = useRef<HTMLDivElement>(null);
  const now = useMountTime();

  const runButton = () => {
    setButtonState("loading");
    window.setTimeout(() => setButtonState("success"), 1200);
    window.setTimeout(() => setButtonState("idle"), 2400);
  };

  return (
    <>
      <DelegatedTaskOverlay />
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Segmented
          value={settings.theme}
          onValueChange={(value) => settings.set("theme", value)}
          label="Theme"
          size="sm"
          options={[
            { value: "dark", label: "Dunkel" },
            { value: "light", label: "Hell" },
          ]}
        />
        <Segmented
          value={settings.accent}
          onValueChange={(value) => settings.set("accent", value)}
          label="Akzent"
          size="sm"
          options={[
            { value: "violet", label: "Violett" },
            { value: "blue", label: "Blau" },
            { value: "pink", label: "Pink" },
            { value: "orange", label: "Orange" },
            { value: "cyan", label: "Cyan" },
          ]}
        />
      </div>

      <Section id="tokens" title={t("tokens")} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {COLOR_GROUPS.map((group) => (
          <Card key={group.title}>
            <p className="mb-3 label-pixel text-fg-3">{group.title}</p>
            <ul className="space-y-2">
              {group.tokens.map((name) => (
                <li key={name} className="flex items-center gap-3">
                  <span
                    className="size-8 shrink-0 rounded-xs border border-line-2"
                    style={{ background: `var(--${name})` }}
                  />
                  <code className="text-sm text-fg-2">--{name}</code>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </Section>

      <Section id="typography" title={t("typography")} className="grid gap-4 lg:grid-cols-2">
        <Card padding="lg" className="space-y-3">
          <p className="label-pixel text-fg-3">Inter · Fließtext und Zahlen</p>
          <p className="nums text-4xl font-semibold">12.842,50 €</p>
          <p className="text-2xl font-semibold">Volta Energie AG</p>
          <p className="text-lg">Quartalszahlen über den Erwartungen</p>
          <p className="text-fg-2">
            Der Umsatz stieg um 8,4 %, die Marge blieb stabil. Die Prognose für das nächste Quartal wurde angehoben.
          </p>
          <p className="text-sm text-fg-3">Kleingedrucktes und Hinweise, 13 px</p>
        </Card>
        <Card padding="lg" className="space-y-3">
          <p className="label-pixel text-fg-3">Silkscreen · Überschriften, Labels, Buttons</p>
          <p className="font-pixel text-2xl uppercase">Level 12 erreicht</p>
          <p className="font-pixel text-base uppercase">Börse geöffnet</p>
          <p className="label-pixel text-fg-2">Tägliche Missionen · Größe · Übernahme</p>
          <div className="flex flex-wrap gap-2">
            <Badge>VLT</Badge>
            <Badge tone="accent">Neu</Badge>
            <Badge tone="gain">Gewinn</Badge>
            <Badge tone="loss">Margin Call</Badge>
            <Badge tone="warn">Sperrfrist</Badge>
            <Badge tone="info">IPO</Badge>
            <PlayerTag tag="K7Q2" />
            <PlayerTag tag="M4XA" copy />
          </div>
        </Card>
        <FriendCodeCard />
        <StockNewsCard />
        <StockFiguresCard ticker="VLT" />
      </Section>

      <Section id="buttons" title={t("buttons")} className="grid gap-4 lg:grid-cols-2">
        <Demo label="Varianten">
          <Button>Primär</Button>
          <Button variant="secondary">Sekundär</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="gain">Kaufen</Button>
          <Button variant="loss">Verkaufen</Button>
          <Button variant="danger">Löschen</Button>
        </Demo>
        <Demo label="Größen und Zustände">
          <Button size="sm">Klein</Button>
          <Button>Mittel</Button>
          <Button size="lg">Groß</Button>
          <Button disabled>Deaktiviert</Button>
          <Button state="loading">Lädt</Button>
          <Button state="success">Fertig</Button>
        </Demo>
        <Demo label="Laden → Erfolg (antippen)">
          <Button state={buttonState} onClick={runButton} className="min-w-44">
            Order senden
          </Button>
        </Demo>
        <Demo label="Zum Kaufen halten" className="flex-col items-stretch">
          <HoldButton onConfirm={() => toast.success("Order ausgeführt", "10 × VLT für 1.127,40 €")}>
            Zum Kaufen halten
          </HoldButton>
          <HoldButton tone="loss" onConfirm={() => toast.info("Verkauf bestätigt")}>
            Zum Verkaufen halten
          </HoldButton>
        </Demo>
      </Section>

      <Section id="numbers" title={t("numbers")} className="grid gap-4 lg:grid-cols-3">
        <Demo label="Number Ticker" className="flex-col items-start">
          <NumberTicker value={balance} format={money} className="text-3xl font-semibold" />
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setBalance((v) => v + 123_450)}>
              + 1.234,50 €
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBalance((v) => Math.max(0, v - 80_000))}>
              − 800 €
            </Button>
          </div>
        </Demo>
        <Demo label="Kurs mit Aufblitzen" className="flex-col items-start">
          <div className="flex items-baseline gap-3">
            <NumberTicker value={quote} format={price} flash className="px-1 text-3xl font-semibold" />
            <Delta bps={Math.round(((quote - 1_104_000) / 1_104_000) * 10_000)} pill />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="gain" onClick={() => setQuote((v) => Math.round(v * 1.012))}>
              Kurs rauf
            </Button>
            <Button size="sm" variant="loss" onClick={() => setQuote((v) => Math.round(v * 0.988))}>
              Kurs runter
            </Button>
          </div>
        </Demo>
        <Demo label="Veränderung und Countdown" className="flex-col items-start">
          <div className="flex gap-4">
            <Delta bps={208} />
            <Delta bps={-142} />
            <Delta bps={0} />
          </div>
          <div className="flex gap-2">
            <Delta bps={1840} pill />
            <Delta bps={-720} pill />
          </div>
          <p className="text-fg-2">
            Zinsentscheid in{" "}
            {now === null ? (
              <span className="nums">--:--</span>
            ) : (
              <Countdown target={now + 4_520_000} className="font-semibold text-fg-1" />
            )}
          </p>
        </Demo>
      </Section>

      <Section id="banner" title="Seitenbanner (ADR-108)">
        <PageHeader title="Märkte" intro="Kaufen, wenn alle zittern. Verkaufen, wenn alle jubeln." art={BULL} />
      </Section>

      <Section id="cards" title={t("cards")} className="grid gap-4 lg:grid-cols-3">
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Statische Karte</CardTitle>
          </CardHeader>
          <p className="text-fg-2">Fläche auf Ebene 1 mit feiner Linie. Für Inhalte ohne eigene Aktion.</p>
        </Card>
        <Card padding="lg" interactive tabIndex={0} className="cursor-pointer focus-ring">
          <CardHeader>
            <CardTitle>Interaktive Karte</CardTitle>
          </CardHeader>
          <p className="text-fg-2">Hebt sich beim Hover an und gibt beim Drücken nach.</p>
        </Card>
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Gestaffelt und sortierbar</CardTitle>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setItems((list) => [...list].sort(() => Math.random() - 0.5))}
            >
              Mischen
            </Button>
          </CardHeader>
          <motion.ul
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="space-y-2"
          >
            {items.map((item) => (
              <motion.li
                key={item}
                layout
                variants={fadeUp}
                transition={SPRING.smooth}
                className="rounded-sm bg-surface-2 px-3 py-2 font-pixel text-xs"
              >
                {item}
              </motion.li>
            ))}
          </motion.ul>
        </Card>
      </Section>

      <Section id="skeletons" title={t("skeletons")} className="grid gap-4 lg:grid-cols-2">
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Liste</CardTitle>
            <Button size="sm" variant="secondary" onClick={() => setLoaded((v) => !v)}>
              {loaded ? "Laden zeigen" : "Inhalt zeigen"}
            </Button>
          </CardHeader>
          {loaded ? (
            <motion.ul variants={staggerContainer} initial="hidden" animate="visible">
              {["Volta Energie AG", "KlarSoft AG", "Brotzeit Handel AG"].map((name, i) => (
                <motion.li key={name} variants={fadeUp} className="flex items-center gap-3 py-2.5">
                  <PixelIcon {...Object.values(ALL_PIXEL_ART)[5 + i]!} scale={2} />
                  <span className="flex-1 font-medium">{name}</span>
                  <Delta bps={[208, 124, 31][i]!} />
                </motion.li>
              ))}
            </motion.ul>
          ) : (
            <div>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          )}
        </Card>
        <Card padding="lg" className="space-y-3">
          <p className="label-pixel text-fg-3">Karte mit Chart</p>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-36 w-full rounded-md" />
        </Card>
      </Section>

      <Section id="toasts" title={t("toasts")}>
        <Demo label="Großes Pop-up: Aufgabe delegiert (ADR-143)">
          <DelegatedPopupDemo />
        </Demo>
        <Demo label="Gestapelt, wischbar">
          <Button variant="secondary" onClick={() => toast.success("Order ausgeführt", "10 × VLT zu 112,64 €")}>
            Erfolg
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.error("Order abgelehnt", "Dafür reicht dein Guthaben nicht.")}
          >
            Fehler
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.warn("Margin Call", "Deine Position in QSL nähert sich dem Liquidationspreis.")}
          >
            Warnung
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.info("Quartalszahlen", "Volta Energie berichtet in 10 Minuten.")}
          >
            Info
          </Button>
        </Demo>
      </Section>

      <Section id="sheet" title={t("sheet")} className="grid gap-4 lg:grid-cols-2">
        <Demo label="Handy: von unten, wischbar · PC: Seitenpanel">
          <Button onClick={() => setSheet(true)}>Sheet öffnen</Button>
        </Demo>
        <Demo label="Tabs und Auswahl" className="flex-col items-start">
          <Segmented
            value={range}
            onValueChange={setRange}
            label="Zeitraum"
            options={["1T", "1W", "1M", "1J", "Max"].map((value) => ({ value, label: value }))}
          />
          <div className="flex items-center gap-3">
            <Switch checked={toggle} onCheckedChange={setToggle} label="Beispielschalter" />
            <span className="text-fg-2">{toggle ? "An" : "Aus"}</span>
          </div>
        </Demo>
      </Section>
      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="VLT kaufen"
        description="Market-Order zum aktuellen Kurs"
        footer={
          <HoldButton
            onConfirm={() => {
              setSheet(false);
              toast.success("Order ausgeführt");
            }}
          >
            Zum Kaufen halten
          </HoldButton>
        }
      >
        <Field label="Stückzahl" defaultValue="10" inputMode="numeric" hint="Ganze Aktien, mindestens 1" />
        <dl className="mt-5 space-y-3 text-fg-2">
          <div className="flex justify-between">
            <dt>Orderwert</dt>
            <dd className="nums text-fg-1">1.126,40 €</dd>
          </div>
          <div className="flex justify-between">
            <dt>Ordergebühr</dt>
            <dd className="nums text-fg-1">1,00 €</dd>
          </div>
        </dl>
      </Sheet>

      <Section id="patch-notes" title={t("patchNotes")} className="grid gap-4 lg:grid-cols-2">
        <Demo label="Knopf in der Leiste: blauer Punkt bei Neuem, öffnet Sheet (Handy) oder Fenster (PC)">
          <PatchNotesButton />
          <Button variant="secondary" size="sm" onClick={() => usePatchNotesSeen.getState().markSeen("showcase")}>
            Punkt wieder zeigen
          </Button>
        </Demo>
        <Demo label="Leer" className="justify-center">
          <PatchNotesList releases={[]} fresh={NOTHING_FRESH} />
        </Demo>
        <Demo label="Liste: neueste Version offen, neue Einträge mit Punkt" className="block lg:col-span-2">
          <PatchNotesList releases={PATCH_SAMPLE} fresh={PATCH_FRESH} />
        </Demo>
      </Section>

      <Section id="forms" title={t("forms")} className="grid gap-4 lg:grid-cols-3">
        <Card padding="lg">
          <Field label="Spielername" placeholder="z. B. Boersenfuchs" hint="3 bis 20 Zeichen" />
        </Card>
        <Card padding="lg">
          <Field label="Limit-Preis" defaultValue="abc" error="Gib einen Betrag in Euro ein." />
        </Card>
        <Card padding="lg">
          <Field label="Deaktiviert" defaultValue="KlarSoft AG" disabled className="opacity-50" />
        </Card>
      </Section>

      <Section id="feedback" title={t("feedback")} className="grid gap-4 lg:grid-cols-3">
        <LevelCard showcase />
        <Demo label="Münzen und Konfetti" className="flex-col items-stretch">
          <div className="flex items-center justify-between">
            <div ref={coinFrom} className="grid size-14 place-items-center rounded-md bg-surface-2">
              <PixelIcon {...COIN} scale={2} />
            </div>
            <div ref={coinTo} className="rounded-sm bg-surface-2 px-3 py-2 label-pixel text-fg-2">
              Konto
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              if (coinFrom.current) flyCoins(coinFrom.current, coinTo.current);
              void playSound("coin");
            }}
          >
            Tresor leeren
          </Button>
          <Button
            variant="secondary"
            onClick={(event) => {
              burstConfetti(event.currentTarget);
              void playSound("levelUp");
            }}
          >
            Großer Gewinn
          </Button>
        </Demo>
        <Card padding="lg" className="relative overflow-hidden">
          <p className="mb-4 label-pixel text-fg-3">Margin Call und Fortschritt</p>
          <div key={shake} className={cn("relative rounded-md bg-surface-2 p-4", shake > 0 && "animate-shake")}>
            {shake > 0 && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 animate-pulse-danger rounded-md border-2 border-loss"
              />
            )}
            <p className="font-medium">QSL · Hebel 5×</p>
            <p className="nums text-sm text-loss">Liquidation bei 0,6120 €</p>
          </div>
          <Button
            variant="danger"
            size="sm"
            className="mt-3"
            onClick={() => {
              setShake((v) => v + 1);
              void playSound("warning");
            }}
          >
            Warnung auslösen
          </Button>
          <Progress value={progress} label="Beispiel" className="mt-5" />
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => setProgress((v) => (v >= 1 ? 0.1 : Math.min(1, v + 0.25)))}
          >
            Fortschritt
          </Button>
        </Card>
      </Section>

      <Section id="empty" title={t("empty")} className="grid gap-4 lg:grid-cols-2">
        <Card>
          <EmptyState
            art={<PixelIcon {...BULL} scale={4} />}
            title="Noch keine Positionen"
            description="Kauf deine erste Aktie. Dein Startkapital wartet schon."
            action={<Button>Zu den Märkten</Button>}
          />
        </Card>
        <Card>
          <EmptyState
            art={<PixelIcon {...BEAR} scale={4} />}
            title="Watchlist ist leer"
            description="Beobachte Aktien, um ihre Kurse hier im Blick zu behalten."
            action={<Button variant="secondary">Aktien entdecken</Button>}
          />
        </Card>
      </Section>

      <Section id="mascot" title={t("mascot")} className="grid gap-4 lg:grid-cols-2">
        <Demo label="Finn, der Börsenfuchs: ruhig, sprechend, jubelnd" className="justify-around">
          <Mascot mood="idle" scale={6} />
          <Mascot mood="talk" scale={6} />
          <Mascot key={shake} mood="happy" scale={6} />
        </Demo>
        <Card padding="lg">
          <p className="mb-4 label-pixel text-fg-3">Sprechblase und Tutorial</p>
          <SpeechBubble
            key={bubble}
            name="Finn"
            text="Hi, ich bin Finn! Ich erkläre neuen Spielern in zwei Minuten, wie die Börse läuft."
            footer={
              <>
                <Button size="sm" variant="secondary" onClick={() => setBubble((v) => v + 1)}>
                  Nochmal
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    // Demo: also forget the demo player, so the tutorial reward counts again.
                    resetDemoPlayer();
                    useTutorial.getState().restart();
                    router.push("/");
                  }}
                >
                  Tutorial neu starten
                </Button>
              </>
            }
          />
        </Card>
      </Section>

      <Section id="news-studio" title="NEXA Nachrichten: Studio" className="space-y-4">
        <NewsStudioDemo />
        <NewsAudienceDemo />
        <Demo label="Mr. Doodle Dangle und sein Studio (große Sprites)" className="items-end gap-4">
          {Object.entries(NEWS_STUDIO_ART)
            .filter(([name]) => /^(anchor|hands|fx|mug|topic-screen|title|desk-sign|intro)/.test(name))
            .map(([name, art]) => (
              <figure key={name} className="flex flex-col items-center gap-2">
                <span className="rounded-md bg-surface-2 p-2">
                  <PixelIcon {...art} scale={2} title={name} />
                </span>
                <figcaption>
                  <code className="text-xs text-fg-3">{name}</code>
                </figcaption>
              </figure>
            ))}
        </Demo>
      </Section>

      <Section id="career" title={t("career")} className="grid gap-4 lg:grid-cols-2">
        <Demo label="Profilbilder (16×16, ganzzahlig skaliert)" className="flex-wrap justify-start gap-2">
          {Object.keys(AVATAR_ART).map((key) => (
            <Avatar key={key} avatarKey={key} size="sm" title={key} />
          ))}
        </Demo>
        <BusinessCard card={SAMPLE_CARD} />
        <FigureCard
          nickname={SAMPLE_CARD.nickname}
          avatarKey={SAMPLE_CARD.avatarKey}
          accessories={SAMPLE_CARD.accessories}
          own={false}
          action={<PokeButton nickname={SAMPLE_CARD.nickname} />}
        />
        <Demo label="Accessoires an der Pixelfigur (ADR-155)" className="flex-wrap justify-start gap-2">
          {ACCESSORIES.map((a) => (
            <PlayerFigure key={a.key} avatarKey="rookie" accessories={[a.key]} scale={2} title={a.name} />
          ))}
        </Demo>
        <FriendsPlaza />
        <Demo label="Chats mit Freunden (ADR-164): Nachricht, 💬, ungelesen" className="flex-wrap justify-start gap-3">
          <MessageFriendButton nickname={SAMPLE_CARD.nickname} size="sm" />
          <ChatIconButton nickname={SAMPLE_CARD.nickname} />
          <ChatUnreadBadge />
        </Demo>
        <Suspense fallback={null}>
          <ChatsView />
        </Suspense>
        <Demo label="Büro: Sprechblasen über den Figuren (ADR-156)" className="flex-wrap items-end justify-start gap-4">
          {[
            { key: "a", text: "Kaffee ist fertig", mine: true, avatar: "rookie", worn: ["cowboy_hat"] },
            { key: "b", text: "Die Zahlen sehen gut aus!", mine: false, avatar: "seller", worn: [] },
          ].map((s) => (
            <div key={s.key} className="flex w-24 flex-col items-center">
              <FloorBubble text={s.text} mine={s.mine} className="w-full" />
              <PlayerFigure avatarKey={s.avatar} accessories={s.worn} scale={2} />
            </div>
          ))}
        </Demo>
        <OfficeScene />
        <RentalShowcase />
        <BattleShowcase />
        <Card padding="lg">
          <SignaturePad onChange={() => undefined} />
        </Card>
        <CareerLadder job={SAMPLE_JOB} />
        <PayRoutes job={SAMPLE_JOB} />
        <CloneShowcase />
        <HealthShowcase />
        <FirmLayoutShowcase />
        <CompanyMovesCard preview={SAMPLE_MOVES} />
        <TaskBoard preview={SAMPLE_TASKS} />
        <AutopilotCard preview={SAMPLE_AUTOPILOT} />
        <AwarenessBreakdown preview={SAMPLE_AWARENESS} />
        <PulseCard lastHour={SAMPLE_AUTOPILOT.lastHour} />
        {SAMPLE_GAMES.map((sample) => (
          <SampleGame key={sample.game} sample={sample} />
        ))}
        <InterviewCard preview={SAMPLE_INTERVIEW} />
        <CompanySkillsCard preview={SAMPLE_COMPANY_SKILLS} />
        <LogoRedrawShowcase />
        <NewsPromoShowcase />
        <ShowcaseSection />
        <UpgradeCard upgradeKey="vault" level={2} />
        <UpgradeCard upgradeKey="rhetoric" level={0} />
        <UpgradeCard upgradeKey="vault_interest" level={1} />
        <UpgradeCard upgradeKey="ai_turbo" level={0} />
        <Demo label="Krypto: Pixel-Coins der Markt-Coins (ADR-101)" className="flex-wrap justify-start gap-3">
          {CRYPTO.coins.map((c) => (
            <CoinLogo key={c.ticker} coin={{ ...c, logo: null }} scale={3} />
          ))}
        </Demo>
        <Card padding="lg">
          <StatBars stats={{ tech: 42, hype: 77, utility: 15 }} />
        </Card>
      </Section>

      <Section id="sounds" title={t("sounds")}>
        <Demo label="Alle Effekte (Ton in den Einstellungen an)">
          {SOUND_NAMES.map((name) => (
            <Button key={name} size="sm" variant="secondary" onClick={() => void playSound(name)}>
              {name}
            </Button>
          ))}
        </Demo>
      </Section>

      <Section id="nexamon" title="Nexamon-Sammelkarten (ADR-165)">
        <NexamonShowcase />
      </Section>

      <Section id="battle-modes" title="Pack-Battle-Modi: Twist und Umgekehrt (ADR-205)">
        <BattleModesShowcase />
      </Section>

      <Section id="toplists" title="Ranglisten: Bewertung, Pfeile, Vermögensteile (ADR-203)">
        <ToplistShowcase />
      </Section>

      <Section id="critic" title="Kritiker-Urteil für NFTs (ADR-181)">
        <Demo label="CriticBadge: gut, mittel, schwach">
          {[92, 58, 12].map((score) => (
            <CriticBadge
              key={score}
              artwork={{ quality: { score, best: "harmony", worst: "outline", copy: null } } as Artwork}
            />
          ))}
        </Demo>
      </Section>

      <Section id="pixel" title={t("pixel")}>
        <Card padding="lg">
          <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-5 lg:grid-cols-10">
            {Object.entries(ALL_PIXEL_ART).map(([name, art]) => (
              <li key={name} className="flex flex-col items-center gap-2 text-fg-1">
                <span className="grid size-16 place-items-center rounded-md bg-surface-2">
                  <PixelIcon {...art} scale={art.grid.length === 12 ? 2 : 3} title={name} />
                </span>
                <code className="text-xs text-fg-3">{name}</code>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section id="motion" title={t("motion")} className="grid gap-4 lg:grid-cols-2">
        <Card padding="lg">
          <p className="mb-4 label-pixel text-fg-3">Dauern (Hover über die Balken)</p>
          <ul className="space-y-3">
            {(Object.entries(DURATION) as [string, number][]).map(([name, seconds]) => (
              <li key={name} className="group flex items-center gap-3">
                <code className="w-40 shrink-0 text-sm text-fg-2">
                  {name} · {Math.round(seconds * 1000)} ms
                </code>
                <span className="h-2 flex-1 overflow-hidden rounded-xs bg-surface-3">
                  <span
                    className="block h-full w-full origin-left scale-x-[0.15] bg-accent transition-transform ease-out group-hover:scale-x-100"
                    style={{ transitionDuration: `${seconds * 1000}ms` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card padding="lg">
          <p className="mb-4 label-pixel text-fg-3">Springs (antippen)</p>
          <div className="flex gap-4">
            {(Object.keys(SPRING) as (keyof typeof SPRING)[]).map((name) => (
              <motion.button
                key={name}
                type="button"
                whileTap={{ scale: 0.8, rotate: -6 }}
                transition={SPRING[name]}
                className="grid size-24 place-items-center rounded-lg bg-accent-soft label-pixel text-accent focus-ring"
              >
                {name}
              </motion.button>
            ))}
          </div>
        </Card>
      </Section>
    </>
  );
}

/** A company that loses money: few customers, idle AI workers, premium without the quality (ADR-162). */
const SAMPLE_HEALTH_COMPANY: HealthCompany = {
  sector: "retail",
  tier: "small_business",
  priceLevel: "premium",
  contractWork: false,
  expansionLevel: 0,
  stage: 1,
  stages: [1, 2, 3, 4].map((stage) => ({
    stage,
    reached: stage <= 1,
    skills: [{ key: "sales", coveredBy: stage <= 1 ? "Mona" : null, coveredByAi: false }],
  })),
  awarenessBps: 900,
  qualityBps: 4_200,
  marketingCentsPerQuarter: 0,
  aiWorkers: 2,
  aiWageCentsPerHour: 12_000,
  headcount: 2,
  maxEmployees: 5,
  capacityCents: 1_050_000,
  cashCents: 180_000,
  unpaidCents: 0,
  distress: false,
  distressQuarters: 0,
  graceQuarters: 4,
  estimateLowCents: 6_000_000,
  estimateHighCents: 12_000_000,
  payFactorBps: 10_000,
  campaign: null,
  campaignCosts: { flyer: 10_000, online: 30_000, tv: 90_000 },
  canExpand: false,
  canUpgrade: false,
  live: {
    revenuePerHourCents: 26_000,
    profitPerHourCents: -9_800,
    payFactorBps: 10_000,
    contractRevenuePerHourCents: 0,
    demandPerHourCents: 20_000,
    capacityPerHourCents: 218_750,
    fixedPerHourCents: 2_500,
    aiWagesPerHourCents: 24_000,
    marketingPerHourCents: 0,
  },
  lastQuarter: null,
};

/** Company health (ADR-162): the panel of the overview and the compact one of the Mira tab. */
function HealthShowcase() {
  const health = companyHealth(SAMPLE_HEALTH_COMPANY, BALANCE, { momentum: 1.04, openTasks: 2 });
  const ask = (factor: string) => toast.info("Mit Mira angehen", factor);
  return (
    <>
      <HealthPanel health={health} onAsk={ask} />
      <HealthCompact health={health} onAsk={ask} onShowAll={() => undefined} />
    </>
  );
}

/** Redrawing the company logo (ADR-200): available, in the cooldown, too little cash, loading. */
function LogoRedrawShowcase() {
  const company = {
    id: "showcase-logo",
    color: "#2266cc",
    cashCents: 12_000_000,
    unpaidCents: 0,
    logo: {
      palette: ["#2266cc", "#ffcc00"],
      grid: Array.from({ length: 16 }, (_, y) => (y > 3 && y < 12 ? "....00111100...." : "................")),
    },
  } as unknown as MyCompany;
  const info = { costCents: 5_000_000, cooldownHours: 24, redrawnAt: null, availableAt: null };
  return (
    <Demo label="Logo neu zeichnen (ADR-200)" className="flex-wrap justify-start gap-4">
      <LogoRedraw company={company} preview={info} />
      <LogoRedraw company={company} preview={{ ...info, availableAt: new Date(Date.UTC(2099, 0, 1)).toISOString() }} />
      <LogoRedraw company={{ ...company, cashCents: 1_000_000 }} preview={info} />
    </Demo>
  );
}

/** The flat company page (ADR-183): jump bar, section, block with an "i", and the reputation card. */
function FirmLayoutShowcase() {
  const company = {
    reputation: {
      value: 57.4,
      target: 61,
      demandFactor: 1.0296,
      drivers: { quality: 5, delivery: -1.2, price: 2, wages: 0, bills: 0, crisis: 0, campaign: 3 },
      at: "2026-11-17T12:00:00.000Z",
      history: Array.from({ length: 12 }, (_, i) => ({
        hourStart: new Date(Date.UTC(2026, 10, 17, i)).toISOString(),
        value: 50 + i * 0.6,
        target: 61,
      })),
    },
  } as unknown as MyCompany;
  return (
    <div className="space-y-4">
      <SectionNav
        items={[
          { id: "showcase-numbers", label: "Zahlen", icon: UI_ICONS.portfolio },
          { id: "showcase-rep", label: "Ruf", icon: UI_ICONS.heart, badge: 2 },
        ]}
        label="Sprungleiste"
      />
      <FirmSection
        id="showcase-numbers"
        icon={UI_ICONS.portfolio}
        title="Zahlen"
        description="Ein Abschnitt: Symbol, Titel und eine Zeile Zweck, darunter Karten."
      >
        <SubSection id="showcase-sub" title="Ein Block" description="Kein Akkordeon: immer offen.">
          <p className="flex items-center gap-2 text-sm text-fg-2">
            Kasse <InfoTip text="Geld in der Firmenkasse." label="Kasse" />
          </p>
        </SubSection>
      </FirmSection>
      <FirmSection id="showcase-rep" icon={UI_ICONS.heart} title="Ruf" description="Die Rufkarte jeder Firma.">
        <ReputationCard company={company} listed={null} />
      </FirmSection>
    </div>
  );
}

/** A folding section of the company overview (ADR-138). Mira's chat needs a company and lives on /company. */
function ShowcaseSection() {
  const [open, setOpen] = useState(true);
  return (
    <CollapsibleSection
      id="showcase"
      title="Quartal & Kasse"
      summary="Letztes Quartal: 1.240 €"
      icon={<PixelIcon {...MIRA.idle} scale={2} />}
      open={open}
      onOpenChange={setOpen}
    >
      <p className="text-sm text-fg-2">Inhalt eines aufklappbaren Bereichs.</p>
    </CollapsibleSection>
  );
}

/** Fires the delegated-task popup (ADR-143) by seeding a notification the real overlay then shows. */
function DelegatedPopupDemo() {
  const client = useQueryClient();
  return (
    <Button
      variant="secondary"
      onClick={() =>
        client.setQueryData(["social", "notifications"], {
          unread: 1,
          items: [
            {
              id: `demo-${Date.now()}`,
              typeKey: "company_task",
              title: "Chefin gibt dir eine Aufgabe",
              body: "Erledige sie vor Ablauf der Frist im Job-Tab.",
              link: "/dev/ui",
              createdAt: new Date().toISOString(),
              readAt: null,
            },
          ],
        })
      }
    >
      Pop-up zeigen
    </Button>
  );
}
