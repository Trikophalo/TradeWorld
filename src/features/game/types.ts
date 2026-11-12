/**
 * Client-side shapes of the game state. They mirror the JSON returned by the
 * Supabase RPCs (docs/DATA_MODEL.md, section "M1 API"), converted to camelCase.
 * Money is in cents, prices in e4 (euro × 10_000), share quantities in e6
 * (millionths, fractional shares, ADR-040), rates in basis points.
 * Plain `number` is safe for each value; products of quantity and price are
 * computed with BigInt (src/features/market/order-schema.ts).
 */
import type { SectorKey } from "@/components/pixel/art";
import type { FloorMaterial, PropertyTier } from "@/config/balance";
import type { SkillBranch } from "@/config/skills";
import type { CompanyLogoData } from "@/lib/sim/logo";

export type SecurityKind = "stock" | "bond";
export type SizeClass = "bluechip" | "midcap" | "penny";
export type Session = "regular" | "after_hours";
export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type CandleInterval = "1m" | "5m" | "1h" | "1q" | "1y";

export interface Security {
  id: string;
  ticker: string;
  name: string;
  kind: SecurityKind;
  sector: SectorKey | null;
  sizeClass: SizeClass | null;
  lastE4: number;
  bidE4: number;
  askE4: number;
  prevCloseE4: number;
  changeBps: number;
  dayHighE4: number;
  dayLowE4: number;
  dayVolumeE6: number;
  marketCapCents: number | null;
  bond: {
    termGameYears: number;
    couponBps: number;
    yieldBps: number;
    maturesAt: string;
    faceValueCents: number;
  } | null;
  /** Listed player companies (ADR-067) bring their own pixel logo. */
  companyKind: "ai" | "player";
  logo: CompanyLogoData | null;
}

export interface MarketSnapshot {
  serverTime: string;
  tickSeq: number;
  session: Session;
  paused: boolean;
  policyRateBps: number;
  index: { ticker: string; name: string; valueE4: number; prevCloseE4: number; changeBps: number };
  securities: Security[];
  /** Closed money system (ADR-041). Null in old server versions. */
  economy: { moneySupplyCents: number; treasuryCents: number; basicIncomeFactorBps: number } | null;
}

export interface Candle {
  /** Unix seconds */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BookLevel {
  priceE4: number;
  quantityE6: number;
  players: number;
}

export interface OrderBook {
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface NewsItem {
  publishedAt: string;
  headline: string;
  body: string | null;
}

export interface SecurityDetails {
  ticker: string;
  name: string;
  description: string | null;
  marketCapCents: number | null;
  sharesOutstanding: number | null;
  peX100: number | null;
  dividendYieldBps: number | null;
  revenueCents: number | null;
  netIncomeCents: number | null;
  marginBps: number | null;
  news: NewsItem[];
}

export interface Position {
  ticker: string;
  name: string;
  kind: SecurityKind;
  quantityE6: number;
  reservedQuantityE6: number;
  avgPriceE4: number;
  lastPriceE4: number;
  marketValueCents: number;
  costBasisCents: number;
  unrealizedPnlCents: number;
}

export interface OpenOrder {
  id: string;
  ticker: string;
  side: OrderSide;
  type: OrderType;
  quantityE6: number;
  filledQuantityE6: number;
  limitPriceE4: number | null;
  status: string;
  createdAt: string;
}

export interface Trade {
  id: string;
  ticker: string;
  side: OrderSide;
  quantityE6: number;
  priceE4: number;
  grossCents: number;
  feeCents: number;
  taxCents: number;
  realizedPnlCents: number | null;
  executedAt: string;
}

export interface Vault {
  accruedCents: number;
  capCents: number;
  /** Effective rate after the treasury factor. */
  rateCentsPerHour: number;
  /** Treasury factor on the basic income, 10_000 = full. */
  factorBps: number;
  lastClaimedAt: string | null;
  fullAt: string;
  serverTime: string;
}

export interface Portfolio {
  cashCents: number;
  reservedCents: number;
  positionsValueCents: number;
  totalCents: number;
  lossPotCents: number;
  vault: Vault;
  positions: Position[];
  openOrders: OpenOrder[];
  recentTrades: Trade[];
  level: number;
  xpTotal: number;
  xpIntoLevel: number;
  xpForNext: number;
  tutorialCompleted: boolean;
  nickname: string;
  /** When the next name change is possible; null = now. */
  nicknameChangeAvailableAt: string | null;
  missionsClaimable: number;
  streakDays: number;
  /** Portrait key (src/components/pixel/avatars.ts). */
  avatarKey: string;
  skillPointsFree: number;
  dailyRewardClaimable: boolean;
  /** Value of the own company (0 without one); counts for the rich list, not in totalCents. */
  companyValueCents: number;
  /** Open forced loan after an insolvency (ADR-058), repaid from incomes. */
  debtCents: number;
  debtWithholdingBps: number;
  foundingLockedUntil: string | null;
}

/** Either a quantity (fractions allowed) or an amount in cents; the server works out the other. */
export interface OrderInput {
  requestId: string;
  ticker: string;
  side: OrderSide;
  type: OrderType;
  quantityE6?: number | null;
  amountCents?: number | null;
  limitPriceE4?: number | null;
}

export interface OrderResult {
  orderId: string;
  status: "filled" | "open" | "partially_filled";
  quantityE6: number;
  filledQuantityE6: number;
  avgPriceE4: number | null;
  grossCents: number;
  feeCents: number;
  taxCents: number;
  realizedPnlCents: number | null;
  cashCents: number;
  xpAwarded: number;
  level: number;
  xpTotal: number;
}

export interface RichListEntry {
  rank: number;
  kind: "player" | "tycoon";
  id: string;
  name: string;
  description: string | null;
  netWorthCents: number;
  change24hBps: number | null;
  rankChange24h: number | null;
  isMe: boolean;
  avatarKey: string | null;
}

export interface RichList {
  serverTime: string;
  total: number;
  entries: RichListEntry[];
  me: { rank: number; netWorthCents: number; next: { rank: number; name: string; gapCents: number } | null } | null;
}

export interface RichNews {
  publishedAt: string;
  headline: string;
  body: string | null;
  kind: string;
}

export type RichListScope = "all" | "players";

// ------------------------------------------------------------------ artworks (ADR-080, docs/ARTWORKS.md)

export interface ArtworkPixels {
  palette: string[];
  grid: string[];
}

export interface ArtworkAuction {
  id: string;
  endsAt: string;
  startCents: number;
  currentCents: number | null;
  minBidCents: number;
  bids: number;
  leader: string | null;
  /** null = the NEXA gallery sells. */
  seller: string | null;
  /** My bid while I lead, else null. */
  myBidCents: number | null;
}

export interface Artwork {
  id: string;
  /** Unique display code, e.g. "ART-0042". */
  code: string;
  title: string;
  origin: "game" | "player";
  rarity: "common" | "rare" | "legendary" | null;
  creator: string | null;
  /** null = the NEXA gallery owns it. */
  owner: string | null;
  pixels: ArtworkPixels;
  /** Last sale price; null if never sold. */
  valueCents: number | null;
  likes: number;
  liked: boolean;
  createdAt: string;
  hot: number;
  auction: ArtworkAuction | null;
}

export type ArtSort = "hot" | "price" | "new" | "ending";

// ------------------------------------------------------------------ property (ADR-082, docs/PROPERTY.md)

export interface PlacedItem {
  id: string;
  itemKey: string;
  x: number;
  y: number;
  rot: 0 | 90;
}

export interface Property {
  owner: string;
  tier: PropertyTier | null;
  width: number;
  height: number;
  garageSlots: number;
  wallColor: string;
  floor: FloorMaterial;
  floorsOwned: FloorMaterial[];
  placed: PlacedItem[];
  garage: { id: string; carKey: string; slot: number }[];
  valueCents: number;
}

export interface PropertyInventory {
  furniture: { id: string; itemKey: string }[];
  cars: { id: string; carKey: string }[];
}

export interface PropertyState {
  property: Property;
  inventory: PropertyInventory | null;
}
export type ArtOrigin = "all" | "game" | "player";

export interface ArtworkList {
  serverTime: string;
  total: number;
  entries: Artwork[];
}

export interface ArtworkDetail {
  artwork: Artwork;
  sales: { at: string; priceCents: number; seller: string | null; buyer: string }[];
  bids: { nickname: string; amountCents: number; at: string }[];
}

export interface ArtStudio {
  painted: number;
  nextCostCents: number;
  unlocked: boolean;
}

export interface ArtRankings {
  collections: {
    rank: number;
    nickname: string;
    avatarKey: string | null;
    count: number;
    valueCents: number;
    isMe: boolean;
  }[];
  artworks: { rank: number; artwork: Artwork }[];
}

export interface ArtCollection {
  nickname: string;
  count: number;
  valueCents: number;
  artworks: Artwork[];
}

/** Ranking of the most valuable companies (ADR-074): AI companies by market value, player companies by value. */
export interface CompanyRankingEntry {
  rank: number;
  companyId: string;
  kind: "ai" | "player";
  name: string;
  color: string;
  logo: CompanyLogoData | null;
  ticker: string | null;
  sector: SectorKey | null;
  /** Player companies only. */
  tier: CompanyTier | null;
  founder: string | null;
  valueCents: number;
  revenueCents: number | null;
  teamSize: number | null;
  isMine: boolean;
}

export interface CompanyRanking {
  serverTime: string;
  total: number;
  entries: CompanyRankingEntry[];
  mine: { rank: number; valueCents: number } | null;
}

export type MissionKind = "quick" | "daily" | "weekly" | "milestone";

export interface Mission {
  id: string;
  key: string;
  title: string;
  description: string | null;
  progress: number;
  target: number;
  /** XP the player receives (multiplier already applied). */
  xp: number;
  status: "active" | "completed" | "claimed";
  expiresAt: string | null;
}

export interface MissionGroup {
  kind: MissionKind;
  resetsAt: string | null;
  missions: Mission[];
}

/** Client-only events that count for a few quick missions. */
export type TrackedEvent = "view_security" | "open_rich_list" | "open_rules" | "view_profile";

export interface ProgressResult {
  xpAwarded: number;
  level: number;
  xpTotal: number;
}

// ------------------------------------------------------------------ daily reward (ADR-053)

export interface DailyRewardDay {
  day: number;
  xp: number;
  cashCents: number;
  skillPoints: number;
}

export interface DailyRewardState {
  /** Cycle day (1–7) that can be claimed now, or the next one if today's is done. */
  day: number;
  claimable: boolean;
  streakDays: number;
  freezesLeft: number;
  nextResetAt: string;
  cycle: DailyRewardDay[];
}

export interface DailyRewardResult extends ProgressResult {
  day: number;
  cashCents: number;
  skillPoints: number;
  streakDays: number;
  leveledUp: boolean;
}

// ------------------------------------------------------------------ skills (ADR-050)

export interface SkillState {
  freePoints: number;
  branchPoints: Record<SkillBranch, number>;
  /** 0–1: progress from work towards the next branch point. */
  branchProgress: Record<SkillBranch, number>;
  branchScores: Record<SkillBranch, number>;
  learned: { key: string; learnedAt: string }[];
}

// ------------------------------------------------------------------ jobs (ADR-051)

export type CareerTier = "intern" | "junior" | "senior" | "team_lead" | "c_level";

export interface JobRequirementInfo {
  branch: SkillBranch;
  minScore: number;
}

export interface Employer {
  id: string;
  name: string;
  ticker: string | null;
  sector: SectorKey | null;
  color: string | null;
  isAi: boolean;
  /** Pixel logo of a player company (ADR-065), null for AI companies or without one. */
  logo: CompanyLogoData | null;
}

export interface JobPosting {
  id: string;
  company: Employer;
  tier: CareerTier;
  /** Translated title (jobs.titles.<key>) for AI postings, or the employer's own title. */
  titleKey: string | null;
  title: string | null;
  minLevel: number;
  required: JobRequirementInfo[];
  salaryCentsPerHour: number;
  /** AI employers: the most they pay me. Player employers: null (open). */
  maxSalaryCentsPerHour: number | null;
  matchScore: number;
  eligible: boolean;
  slotsOpen: number;
  postedAt: string;
  expiresAt: string | null;
  myApplication: { id: string; status: ApplicationStatus } | null;
  /** Concrete skills the employer asks for (ADR-062). */
  requiredSkills: string[];
}

export interface JobBoard {
  postings: JobPosting[];
  nextRefreshAt: string | null;
}

export type ApplicationStatus =
  "pending" | "offered" | "rejected" | "declined" | "withdrawn" | "expired" | "signed" | "closed";

export interface JobApplication {
  id: string;
  status: ApplicationStatus;
  posting: Pick<JobPosting, "id" | "company" | "tier" | "titleKey" | "title" | "required" | "requiredSkills">;
  salaryWishCentsPerHour: number;
  offerSalaryCentsPerHour: number | null;
  offerExpiresAt: string | null;
  message: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplyInput {
  requestId: string;
  postingId: string;
  salaryWishCentsPerHour: number;
  message: string;
}

export interface MyJob {
  id: string;
  company: Employer;
  tier: CareerTier;
  titleKey: string | null;
  title: string | null;
  required: JobRequirementInfo[];
  salaryCentsPerHour: number;
  payFactorBps: number;
  effectiveSalaryCentsPerHour: number;
  productivityBps: number;
  startedAt: string;
  paidHoursToday: number;
  paidHoursCap: number;
  earnedTotalCents: number;
  raiseAvailableAt: string | null;
  raiseMaxBps: number;
  pendingRaise: { requestedBps: number; createdAt: string } | null;
  quitCostCents: number;
  signature: string | null;
  /** Bonus of the last closed quarter (player companies, ADR-052). */
  lastBonusCents: number;
  nextWorkTaskAt: string | null;
  workTaskOpen: boolean;
  /** Quit with notice (ADR-063): the job ends at this time; null without notice. */
  noticeEndsAt: string | null;
  /** Quitting at once costs this (ADR-066). */
  quitNowCostCents: number;
}

/** What an employee sees about the employer in the job tab (ADR-064). */
export interface EmployerView {
  company: Employer;
  kind: "ai" | "player";
  productKey: string | null;
  stage: number | null;
  tier: CompanyTier | null;
  founder: string | null;
  teamSize: number;
  lastQuarter: { label: string; revenueCents: number; profitCents: number } | null;
  payFactorBps: number;
}

// ------------------------------------------------------------------ player card (ADR-054)

export interface PlayerCard {
  nickname: string;
  /** Permanent player tag without "#" (ADR-085); null until the server knows it. */
  tag: string | null;
  avatarKey: string;
  level: number;
  rank: number | null;
  netWorthCents: number;
  streakDays: number;
  skillsLearned: number;
  branchScores: Record<SkillBranch, number>;
  topSkills: { key: string; tier: number }[];
  job: { companyName: string; titleKey: string | null; title: string | null; tier: CareerTier; since: string } | null;
  company: { name: string; ticker: string | null } | null;
  memberSince: string;
}

// ------------------------------------------------------------------ player companies (ADR-057)

export type CompanyTier = "garage" | "small_business" | "gmbh" | "ag";
export type PriceLevel = "budget" | "normal" | "premium";

/** Friends (ADR-084). */
export interface FriendEntry {
  nickname: string;
  tag: string | null;
  level: number;
  /** Friends since / request sent at. */
  at: string;
}
/** A hit of the player search in the top bar (ADR-085). */
export interface PlayerSearchResult {
  nickname: string;
  tag: string | null;
  level: number;
  avatarKey: string;
}

export interface Friends {
  friends: FriendEntry[];
  incoming: FriendEntry[];
  outgoing: FriendEntry[];
}

export interface CompanyQuarter {
  label: string;
  demandCents: number;
  capacityCents: number;
  revenueCents: number;
  cogsCents: number;
  fixedCents: number;
  aiWorkerCents: number;
  marketingCents: number;
  wagesCents: number;
  operatingProfitCents: number;
  utilizationBps: number;
  bonusCents: number;
}

export interface MyCompany {
  id: string;
  name: string;
  idea: string;
  sector: SectorKey;
  color: string;
  tier: CompanyTier;
  foundedAt: string;
  /** Product and growth stages (ADR-062). */
  productKey: string;
  stage: number;
  stages: {
    stage: number;
    reached: boolean;
    /** coveredBy: nickname of a team member with the skill; coveredByAi: an AI worker hired for it (ADR-071). */
    skills: { key: string; coveredBy: string | null; coveredByAi: boolean }[];
  }[];
  /** Skills AI workers were hired for; the others are general (ADR-071). */
  aiWorkerSkills: string[];
  /** Trainings unlock at this team size (ADR-071). */
  trainingFrom: number;
  /** Hourly operations (ADR-072): the last closed hour, today and the running quarter. Null before the first hour. */
  live: {
    lastHourAt: string;
    revenuePerHourCents: number;
    profitPerHourCents: number;
    payFactorBps: number;
    todayRevenueCents: number;
    todayProfitCents: number;
    quarterRevenueCents: number;
    quarterProfitCents: number;
    /** The last closed hour in detail, for the profit coach (ADR-083). */
    contractRevenuePerHourCents: number;
    demandPerHourCents: number;
    capacityPerHourCents: number;
    fixedPerHourCents: number;
    aiWagesPerHourCents: number;
    marketingPerHourCents: number;
  } | null;
  /** The last closed hours, oldest first. */
  hours: { hourStart: string; revenueCents: number; profitCents: number; contractRevenueCents: number }[];
  /** Profit levers and endless growth (ADR-083). */
  priceLevel: PriceLevel;
  contractWork: boolean;
  expansionLevel: number;
  canExpand: boolean;
  /** Price of the next expansion level, paid from the company's cash; null when the legal form cannot expand. */
  expansionCostCents: number | null;
  /** Market reach: legal form × expansion. */
  marketFactor: number;
  aiWageCentsPerHour: number;
  cashCents: number;
  valueCents: number;
  unpaidCents: number;
  distress: boolean;
  awarenessBps: number;
  qualityBps: number;
  quartersActive: number;
  estimateLowCents: number;
  estimateHighCents: number;
  marketingCentsPerQuarter: number;
  aiWorkers: number;
  aiWorkerCostCents: number;
  maxEmployees: number;
  employees: number;
  openPostings: number;
  pendingApplications: number;
  founderProductivityBps: number;
  teamProductivityBps: number;
  capacityCents: number;
  nextQuarterAt: string;
  canUpgrade: boolean;
  upgradeCostCents: number | null;
  lastQuarter: CompanyQuarter | null;
  history: { label: string; revenueCents: number; profitCents: number }[];
  payFactorBps: number;
  distressQuarters: number;
  graceQuarters: number;
  logo: CompanyLogoData | null;
  logoHidden: boolean;
  /** Pixel banner above the company page (ADR-078). */
  banner: CompanyLogoData | null;
  /** Founder with a job elsewhere (ADR-066). */
  founderHasJob: boolean;
  fullTimeFrom: number;
  headcount: number;
  /** Going public (ADR-067). */
  listing: {
    status: "subscription" | "listed";
    ticker: string | null;
    sharesTotalE6: number;
    founderSharesE6: number;
    offer: Offer | null;
    lastPriceE4: number | null;
  } | null;
  canGoPublic: boolean;
  canCapitalIncrease: boolean;
}

/** A running IPO or capital increase players can subscribe to (ADR-067). */
export interface Offer {
  id: string;
  kind: "ipo" | "capital_increase";
  company: {
    id: string;
    name: string;
    color: string;
    logo: CompanyLogoData | null;
    sector: SectorKey;
    productKey: string | null;
    stage: number | null;
  };
  ticker: string | null;
  priceCents: number;
  sharesOfferedE6: number;
  sharesSubscribedE6: number;
  endsAt: string;
  status: "open" | "closed";
  mySharesE6: number;
  valueCents: number;
  lastQuarter: { label: string; revenueCents: number; profitCents: number } | null;
}

export interface Dissolution {
  companyName: string;
  reason: "insolvent" | "closed";
  at: string;
  totalDebtCents: number;
  fromFounderCents: number;
  loanCents: number;
}

export interface CompanyOverview {
  company: MyCompany | null;
  lastDissolution: Dissolution | null;
}

export interface CloseCompanyResult {
  fromCompanyCents: number;
  fromFounderCents: number;
  loanCents: number;
  toFounderCents: number;
  totalDebtCents: number;
}

// ------------------------------------------------------------------ company chat (ADR-060)

export interface ChatMessage {
  id: number;
  kind: "player" | "system";
  author: string | null;
  avatarKey: string | null;
  isMe: boolean;
  isFounder: boolean;
  body: string;
  createdAt: string;
}

export interface CompanyChat {
  company: { id: string; name: string; color: string } | null;
  members: number;
  messages: ChatMessage[];
}

// ------------------------------------------------------------------ work tasks (ADR-059)

export type WorkTask =
  | WorkTaskBase<
      "finance_choice",
      { amountCents: number; years: number; offers: { rateBps: number; feeCents: number }[] }
    >
  | WorkTaskBase<
      "sales_pick",
      { customers: { units: number; priceCents: number; unitCostCents: number; serviceCents: number }[] }
    >
  | WorkTaskBase<
      "analyst_estimate",
      { revenueCents: number; cogsBps: number; fixedCents: number; marketingCents: number; options: number[] }
    >;

interface WorkTaskBase<K extends string, P> {
  id: string;
  kind: K;
  params: P;
  createdAt: string;
  expiresAt: string;
  startedAt: string | null;
}

export interface WorkTaskResult extends ProgressResult {
  correct: boolean;
  correctIndex: number;
  bonusCents: number;
}

export interface FoundCompanyInput {
  requestId: string;
  name: string;
  idea: string;
  sector: SectorKey;
  color: string;
  tier: CompanyTier;
  product: string;
}

export interface CompanyPosting {
  id: string;
  tier: CareerTier;
  title: string | null;
  titleKey: string | null;
  required: JobRequirementInfo[];
  salaryCentsPerHour: number;
  slots: number;
  slotsOpen: number;
  status: "open" | "closed";
  applicationsPending: number;
  postedAt: string;
  requiredSkills: string[];
}

export interface CreatePostingInput {
  requestId: string;
  companyId: string;
  tier: CareerTier;
  title: string;
  required: JobRequirementInfo[];
  salaryCentsPerHour: number;
  slots: number;
  requiredSkills: string[];
}

export interface Applicant {
  nickname: string;
  avatarKey: string;
  level: number;
  matchScore: number;
  branchScores: Record<SkillBranch, number>;
  /** The applicant's skills among those the posting or the product asks for. */
  skills: string[];
}

export interface CompanyApplication extends JobApplication {
  applicant: Applicant;
}

export interface TeamMember {
  playerJobId: string;
  nickname: string;
  avatarKey: string;
  title: string;
  salaryCentsPerHour: number;
  productivityBps: number;
  startedAt: string;
  pendingRaise: { requestedBps: number; createdAt: string } | null;
  skills: string[];
  noticeEndsAt: string | null;
}

/** Error keys the server raises (message of the Postgres exception). Texts: messages/de.json "errors". */
export const GAME_ERROR_KEYS = [
  "not_authenticated",
  "unknown_security",
  "not_tradable",
  "invalid_quantity",
  "invalid_price",
  "insufficient_funds",
  "insufficient_position",
  "order_not_found",
  "order_not_open",
  "rate_limited",
  "market_paused",
  "nothing_to_claim",
  "locked",
  "invalid_argument",
  "invalid_interval",
  "forbidden",
  "order_too_small",
  "market_illiquid",
  "name_too_short",
  "name_too_long",
  "name_invalid_chars",
  "name_profanity",
  "name_reserved",
  "name_taken",
  "name_change_too_soon",
  "confirm_mismatch",
  "skill_already_covered",
  "training_locked",
  "logo_locked",
  "logo_forbidden",
  "artworks_locked",
  "artwork_not_found",
  "auction_not_found",
  "auction_ended",
  "bid_too_low",
  "own_artwork",
  "already_on_auction",
  "auction_has_bids",
  "property_locked",
  "no_home",
  "invalid_tier",
  "item_not_found",
  "layout_invalid",
  "floor_not_owned",
  "garage_full",
  "mission_not_found",
  "mission_not_completed",
  "mission_already_claimed",
  "avatar_unknown",
  "avatar_locked",
  "daily_reward_claimed",
  "skill_unknown",
  "skill_learned",
  "skill_locked",
  "skill_points_insufficient",
  "job_not_found",
  "job_level_too_low",
  "job_skills_missing",
  "application_limit",
  "application_exists",
  "application_not_found",
  "application_not_offered",
  "offer_expired",
  "job_active_exists",
  "no_active_job",
  "raise_too_soon",
  "raise_too_high",
  "player_not_found",
  "employer_only",
  "company_exists",
  "company_not_found",
  "company_level_too_low",
  "owns_company",
  "employee_limit",
  "company_upgrade_unavailable",
  "founding_locked",
  "not_in_company",
  "work_task_not_found",
  "work_task_expired",
  "work_task_done",
  "offer_closed",
  "offer_sold_out",
  "already_listed",
] as const;
export type GameErrorKey = (typeof GAME_ERROR_KEYS)[number] | "unknown";

export class GameError extends Error {
  constructor(public readonly key: GameErrorKey) {
    super(key);
    this.name = "GameError";
  }
}

/** Everything the game can do. Implemented by the live Supabase API and by the offline demo. */
export interface GameEngine {
  snapshot(): Promise<MarketSnapshot>;
  candles(ticker: string, interval: CandleInterval, limit: number): Promise<Candle[]>;
  orderBook(ticker: string, levels: number): Promise<OrderBook>;
  details(ticker: string): Promise<SecurityDetails>;
  portfolio(): Promise<Portfolio>;
  placeOrder(input: OrderInput): Promise<OrderResult>;
  cancelOrder(requestId: string, orderId: string): Promise<void>;
  claimVault(requestId: string): Promise<{ claimedCents: number; cashCents: number }>;
  completeTutorial(requestId: string): Promise<ProgressResult>;
  richList(scope: RichListScope, limit: number, offset: number): Promise<RichList>;
  richNews(limit: number): Promise<RichNews[]>;
  /** The most valuable companies (ADR-074). */
  companyRanking(scope: RichListScope, limit: number): Promise<CompanyRanking>;
  // Artworks (ADR-080)
  artworks(sort: ArtSort, origin: ArtOrigin, onAuction: boolean, limit: number, offset: number): Promise<ArtworkList>;
  artwork(id: string): Promise<ArtworkDetail>;
  artStudio(): Promise<ArtStudio>;
  createArtwork(
    requestId: string,
    title: string,
    pixels: ArtworkPixels,
  ): Promise<{ artwork: Artwork; costCents: number; nextCostCents: number }>;
  likeArtwork(requestId: string, artworkId: string, like: boolean): Promise<{ likes: number; liked: boolean }>;
  startAuction(requestId: string, artworkId: string, startCents: number, hours: number): Promise<Artwork>;
  cancelAuction(requestId: string, auctionId: string): Promise<Artwork>;
  bidArtwork(requestId: string, auctionId: string, amountCents: number): Promise<Artwork>;
  artRankings(limit: number): Promise<ArtRankings>;
  collection(nickname: string): Promise<ArtCollection>;
  // Property (ADR-082)
  property(nickname: string | null): Promise<PropertyState>;
  buyHome(requestId: string, tier: PropertyTier): Promise<PropertyState & { costCents: number }>;
  buyFurniture(requestId: string, itemKey: string, count: number): Promise<PropertyState>;
  buyFloor(requestId: string, material: FloorMaterial): Promise<PropertyState>;
  saveLayout(
    requestId: string,
    wallColor: string,
    floor: FloorMaterial,
    placed: { id: string; x: number; y: number; rot: 0 | 90 }[],
  ): Promise<PropertyState>;
  buyCar(requestId: string, carKey: string): Promise<PropertyState>;
  sellItem(requestId: string, kind: "furniture" | "car", id: string): Promise<PropertyState & { refundCents: number }>;
  checkNickname(nickname: string): Promise<{ allowed: boolean; reason: GameErrorKey | null }>;
  changeNickname(requestId: string, nickname: string): Promise<{ nickname: string; nextChangeAt: string }>;
  /** Starts over as a new player; `confirm` is the current nickname (ADR-070). */
  resetAccount(requestId: string, confirm: string): Promise<void>;
  /** Deletes the account for good; `confirm` is the current nickname (ADR-070). */
  deleteAccount(confirm: string): Promise<void>;
  missions(): Promise<MissionGroup[]>;
  claimMission(requestId: string, missionId: string): Promise<ProgressResult>;
  checkIn(requestId: string): Promise<ProgressResult & { streakDays: number; alreadyCheckedIn: boolean }>;
  track(event: TrackedEvent, ref?: string): Promise<void>;
  setAvatar(requestId: string, avatarKey: string): Promise<string>;
  dailyReward(): Promise<DailyRewardState>;
  claimDailyReward(requestId: string): Promise<DailyRewardResult>;
  skills(): Promise<SkillState>;
  learnSkill(requestId: string, skillKey: string): Promise<SkillState>;
  jobBoard(): Promise<JobBoard>;
  applyForJob(input: ApplyInput): Promise<JobApplication>;
  applications(): Promise<JobApplication[]>;
  counterOffer(requestId: string, applicationId: string, salaryWishCentsPerHour: number): Promise<JobApplication>;
  withdrawApplication(requestId: string, applicationId: string): Promise<JobApplication>;
  signContract(requestId: string, applicationId: string, signature: string): Promise<MyJob>;
  myJob(): Promise<MyJob | null>;
  quitJob(
    requestId: string,
    immediate?: boolean,
  ): Promise<{ noticeEndsAt: string | null; ended: boolean; paidCents: number }>;
  cancelQuit(requestId: string): Promise<MyJob>;
  employer(): Promise<EmployerView | null>;
  requestRaise(
    requestId: string,
    raiseBps: number,
  ): Promise<{ status: "accepted" | "pending"; salaryCentsPerHour: number }>;
  playerCard(nickname: string): Promise<PlayerCard>;
  setCompanyLogo(requestId: string, logo: CompanyLogoData): Promise<MyCompany>;
  /** Pixel banner, may be redrawn any time; null removes it (ADR-078). */
  setCompanyBanner(requestId: string, banner: CompanyLogoData | null): Promise<MyCompany>;
  reportCompanyLogo(requestId: string, companyId: string): Promise<void>;
  goPublic(requestId: string, sharePercent: number): Promise<MyCompany>;
  capitalIncrease(requestId: string, sharePercent: number): Promise<MyCompany>;
  offers(): Promise<Offer[]>;
  subscribeOffer(
    requestId: string,
    offerId: string,
    amountCents: number,
  ): Promise<{ sharesE6: number; amountCents: number }>;
  checkCompanyName(name: string): Promise<{ allowed: boolean; reason: GameErrorKey | null }>;
  foundCompany(input: FoundCompanyInput): Promise<MyCompany>;
  myCompany(): Promise<CompanyOverview>;
  closeCompany(requestId: string): Promise<CloseCompanyResult>;
  companyChat(beforeId?: number): Promise<CompanyChat>;
  postCompanyMessage(requestId: string, body: string): Promise<ChatMessage>;
  workTask(): Promise<{ task: WorkTask | null; nextTaskAt: string | null }>;
  submitWorkTask(requestId: string, taskId: string, choice: number): Promise<WorkTaskResult>;
  setCompanyMarketing(requestId: string, marketingCents: number): Promise<MyCompany>;
  setAiWorkers(requestId: string, count: number): Promise<MyCompany>;
  /** Hire AI workers, optionally one for a stage skill it then covers (ADR-071). */
  hireAiWorkers(requestId: string, count: number, skill?: string | null): Promise<MyCompany>;
  /** Let one AI worker go: the one for this skill, or a general one. */
  dismissAiWorker(requestId: string, skill?: string | null): Promise<MyCompany>;
  companyDeposit(requestId: string, amountCents: number): Promise<MyCompany>;
  companyWithdraw(requestId: string, amountCents: number): Promise<MyCompany>;
  upgradeCompany(requestId: string): Promise<MyCompany>;
  /** Price strategy and contract work (ADR-083). */
  setCompanyStrategy(requestId: string, priceLevel: PriceLevel, contractWork: boolean): Promise<MyCompany>;
  /** Next expansion level, paid from the company's cash (ADR-083). */
  expandCompany(requestId: string): Promise<MyCompany>;
  /** Friends (ADR-084). */
  friends(): Promise<Friends>;
  sendFriendRequest(requestId: string, nickname: string): Promise<Friends>;
  respondFriendRequest(requestId: string, nickname: string, accept: boolean): Promise<Friends>;
  removeFriend(requestId: string, nickname: string): Promise<Friends>;
  /** Players by name or tag (ADR-085), at most 8. */
  searchPlayers(query: string): Promise<PlayerSearchResult[]>;
  companyPostings(): Promise<CompanyPosting[]>;
  createJobPosting(input: CreatePostingInput): Promise<void>;
  closeJobPosting(requestId: string, postingId: string): Promise<void>;
  companyApplications(companyId: string): Promise<CompanyApplication[]>;
  respondApplication(
    requestId: string,
    applicationId: string,
    action: "accept" | "reject" | "counter",
    salaryCentsPerHour?: number,
  ): Promise<void>;
  companyTeam(companyId: string): Promise<TeamMember[]>;
  fireEmployee(requestId: string, playerJobId: string): Promise<{ severanceCents: number }>;
  respondRaise(requestId: string, playerJobId: string, accept: boolean): Promise<void>;
  trainEmployee(
    requestId: string,
    playerJobId: string,
    skillKey: string,
  ): Promise<{ costCents: number; salaryCentsPerHour: number }>;
}
