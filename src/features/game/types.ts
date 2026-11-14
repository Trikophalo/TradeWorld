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

export type SecurityKind = "stock" | "bond" | "crypto";
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
  /** The company behind a stock (ADR-125); null for bonds. */
  companyId: string | null;
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
  /** Hours worked in the current rank (ADR-094). */
  rankHours: number;
  /** Next rank and what it takes; null on servers before M4i. */
  promotion: PromotionState | null;
  /** Presence (ADR-103): pay share now and when the job ends without a visit; null on servers before M4k. */
  presence: { lastActiveAt: string; payBps: number; fireAt: string } | null;
}

// ------------------------------------------------------------------ promotions (ADR-094)

export type PromotionRequirementKey = "level" | "branch" | "management" | "hours";

export interface PromotionRequirementInfo {
  key: PromotionRequirementKey;
  branch: SkillBranch | null;
  need: number;
  have: number;
  met: boolean;
}

export interface PromotionState {
  /** Null at the top (C-level). */
  nextTier: CareerTier | null;
  mainBranch: SkillBranch;
  requirements: PromotionRequirementInfo[];
  ready: boolean;
  boss: "ai" | "player";
  /** AI bosses: chance of a yes now; player bosses: null. */
  chanceBps: number | null;
  /** After a no: the next request is possible from then on. */
  retryAt: string | null;
  /** Request waiting for a player boss. */
  pendingSince: string | null;
  nextSalaryCentsPerHour: number | null;
}

export interface PromotionResult {
  status: "promoted" | "declined" | "pending";
  tier: CareerTier;
  salaryCentsPerHour: number;
  retryAt: string | null;
  chanceBps: number | null;
}

// ------------------------------------------------------------------ crypto (ADR-101)

export type CoinCategory = "stable" | "major" | "alt" | "meme" | "player";
export type CoinStatus = "draft" | "listed" | "dead" | "closed";
export type CryptoRegime = "bull" | "flat" | "bear";

export interface CoinStats {
  tech: number;
  hype: number;
  utility: number;
}

export interface CoinRow {
  ticker: string;
  name: string;
  category: CoinCategory;
  status: CoinStatus;
  priceE4: number;
  change24hBps: number;
  high24hE4: number;
  low24hE4: number;
  poolCents: number;
  marketCapCents: number;
  volume24hCents: number;
  feeBps: number;
  color: string;
  logo: CompanyLogoData | null;
  creator: { nickname: string; tag: string | null; trust: Pick<TrustInfo, "score" | "band"> } | null;
  stats: CoinStats | null;
  myQuantityE6: number;
}

export interface CryptoEvent {
  /** "*" for market-wide events. */
  ticker: string;
  name: string;
  key: string;
  shockBps: number;
  at: string;
  payload: Record<string, unknown>;
}

export interface CryptoMarket {
  regime: { kind: CryptoRegime; until: string };
  coins: CoinRow[];
  events: CryptoEvent[];
}

export interface CoinDetail extends CoinRow {
  pool: { cashCents: number; tokensE6: number };
  supplyE6: number;
  teamTokensE6: number | null;
  holders: number;
  myPosition: { quantityE6: number; avgPriceE4: number; valueCents: number } | null;
  events: CryptoEvent[];
}

export interface CryptoTradeInput {
  requestId: string;
  ticker: string;
  side: "buy" | "sell";
  amountCents?: number;
  quantityE6?: number;
  maxSlippageBps: number;
}

export interface CryptoTradeResult {
  side: "buy" | "sell";
  ticker: string;
  quantityE6: number;
  cashCents: number;
  feeCents: number;
  priceE4: number;
  avgPriceE4: number;
  positionE6: number;
  cashAfterCents: number;
  taxCents: number;
  xpAwarded: number;
  /** The creator sold too many team coins (ADR-101). */
  rugPull: boolean;
}

export type CoinActionKey =
  "smart_contract" | "audit" | "community" | "influencer" | "partnership" | "staking" | "bugfix" | "marketing_burn";

export interface MyCoin extends CoinRow {
  id: string;
  stats: CoinStats;
  action: { key: CoinActionKey; startedAt: string; endsAt: string } | null;
  actions: { key: CoinActionKey; costCents: number; hours: number; successBps: number; available: boolean }[];
  teamTokensE6: number;
  teamAtLaunchE6: number;
  teamSoldWindowE6: number;
  rugLimitE6: number;
  launch: { startPriceE4: number; liquidityCents: number; teamShareBps: number; at: string } | null;
  createdAt: string;
  /** Burning team coins: hype per burn, smallest amount, next possible burn (null: now). */
  burnHype: number;
  burnMinE6: number;
  burnAvailableAt: string | null;
}

// ------------------------------------------------------------------ org chart (ADR-104)

export interface OrgPerson {
  nickname: string;
  tag: string | null;
  avatarKey: string;
  isMe: boolean;
}

export interface OrgMember extends OrgPerson {
  tier: CareerTier;
  title: string | null;
  since: string | null;
  /** Direct supervisor (ADR-129); null = the founder. */
  supervisor?: string | null;
}

export interface CompanyOrg {
  company: { id: string; name: string; tier: CompanyTier };
  founder: OrgPerson;
  members: OrgMember[];
  aiWorkers: number;
  aiWorkerSkills: string[];
}

// ------------------------------------------------------------------ campaigns (ADR-097)

export type CampaignKind = "flyer" | "online" | "tv";
export type CampaignResonance = "weak" | "solid" | "strong";

export interface CompanyCampaign {
  id: string;
  kind: CampaignKind;
  startedAt: string;
  endsAt: string;
  costCents: number;
  /** Extra demand while it runs, in bps. */
  demandBps: number;
  resonance: CampaignResonance;
}

// ------------------------------------------------------------------ trust and deals (ADR-098)

export type TrustBand = "risky" | "shaky" | "blank" | "reliable" | "rock";

export interface TrustInfo {
  score: number;
  band: TrustBand;
  /** Deals kept and broken (null where the server sends only the score). */
  kept: number | null;
  broken: number | null;
}

export type DealKind = "loan" | "supply" | "stake";
export type DealRole = "lender" | "borrower" | "supplier" | "buyer" | "investor" | "company";
export type DealStatus =
  | "open"
  | "active"
  | "overdue"
  | "defaulted"
  | "completed"
  | "forgiven"
  | "broken"
  | "cancelled"
  | "declined"
  | "expired";

export interface DealParty extends FeedActor {
  trust: Pick<TrustInfo, "score" | "band">;
}

export interface DealTerms {
  hours: number;
  principalCents?: number;
  interestBps?: number;
  volumeCentsPerHour?: number;
  feeBps?: number;
  prepayBps?: number;
  amountCents?: number;
  shareBps?: number;
}

export interface DealProgress {
  dueCents?: number;
  repaidCents?: number;
  leftCents?: number;
  deliveredCents?: number;
  neededCents?: number;
  feesPaidCents?: number;
  prepayCents?: number;
  prepayLeftCents?: number;
  payoutsCents?: number;
}

export interface Deal {
  id: string;
  kind: DealKind;
  status: DealStatus;
  /** Role of the viewer; null on the board for offers of others. */
  myRole: DealRole | null;
  /** Role the proposer took; the other side takes the opposite one. */
  proposerRole: DealRole;
  isProposer: boolean;
  proposer: DealParty;
  /** The other side once fixed, else the target, else null (open offer). */
  counterparty: DealParty | null;
  supplierCompany: { id: string; name: string } | null;
  buyerCompany: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  terms: DealTerms;
  message: string | null;
  createdAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  endsAt: string | null;
  closedAt: string | null;
  progress: DealProgress;
  brokenByMe: boolean;
}

export interface DealsOverview {
  incoming: Deal[];
  outgoing: Deal[];
  running: Deal[];
  history: Deal[];
  trust: TrustInfo;
  /** Largest loan and largest deal of the own company (ADR-098); null in older responses. */
  limits: { companyDealMaxCents: number | null; loanMaxCents: number } | null;
}

export interface ProposeDealInput {
  requestId: string;
  kind: DealKind;
  role: DealRole;
  /** Name or tag; null = open offer on the deal board. */
  counterparty: string | null;
  terms: DealTerms;
  message: string;
}

// ------------------------------------------------------------------ upgrades (ADR-093)

export type { UpgradeKey } from "@/config/upgrades";
import type { UpgradeKey } from "@/config/upgrades";

export interface UpgradesState {
  levels: Record<UpgradeKey, number>;
}

export interface BuyUpgradeResult extends UpgradesState {
  key: UpgradeKey;
  level: number;
  costCents: number;
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
  /** League trophies from closed weeks (ADR-089). */
  trophies: { gold: number; silver: number; bronze: number };
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
  /** Trust from kept and broken deals (ADR-098); null on servers before M4j. */
  trust: TrustInfo | null;
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
// ------------------------------------------------------------------ social (ADR-088, ADR-089) and events (ADR-090)

export interface FeedActor {
  nickname: string;
  tag: string | null;
  avatarKey: string;
  level: number;
}

/** One entry of the friends feed; the text is rendered from kind and payload. */
export interface FeedItem {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
  isMe: boolean;
  actor: FeedActor;
  reactions: number;
  reacted: boolean;
}

export interface FeedPage {
  items: FeedItem[];
  nextBefore: number | null;
}

export interface AppNotification {
  id: string;
  typeKey: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationList {
  items: AppNotification[];
  unread: number;
}

export type LeagueScope = "all" | "friends";

export interface LeagueEntry extends FeedActor {
  rank: number;
  growthBps: number;
  isMe: boolean;
}

export interface League {
  season: { weekStart: string; startsAt: string; endsAt: string; status: string };
  entries: LeagueEntry[];
  me: { rank: number; growthBps: number } | null;
  lastWinner: (Omit<FeedActor, "level"> & { growthBps: number; weekStart: string }) | null;
}

/** An announced market event (ADR-090); texts come from kind, ticker and outcome. */
export interface GameEvent {
  id: string;
  kind: string;
  importance: number;
  scheduledAt: string;
  announcedAt: string;
  status: string;
  ticker: string | null;
  companyName: string | null;
  sector: string | null;
  outcome: Record<string, unknown> | null;
}

export interface GameEvents {
  serverTime: string;
  upcoming: GameEvent[];
  recent: GameEvent[];
}

// ------------------------------------------------------------------ company events and news (ADR-091)

export interface CompanyBrief {
  id: string;
  name: string;
  idea: string;
  sector: string;
  productKey: string | null;
  tier: CompanyTier;
}

export interface CompanyEventStepState {
  idx: number;
  strategy: string;
  key: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  endsAt: string;
  costCents: number;
  successBps: number;
  retry: boolean;
}

export interface CompanyEvent {
  id: string;
  archetype: string;
  polarity: "crisis" | "chance";
  severity: 1 | 2 | 3;
  status: "open" | "accepted" | "solved" | "in_force" | "expired" | "over";
  startedAt: string;
  deadlineAt: string;
  resolvedAt: string | null;
  overAt: string | null;
  strategy: string | null;
  mitigation: number;
  aiHeadline: string | null;
  aiBody: string | null;
  aiCause: string | null;
  steps: CompanyEventStepState[];
  /** The next step of the chosen strategy with today's price and chance. */
  next: {
    strategy: string;
    idx: number;
    key: string;
    costCents: number;
    successBps: number;
    staffOk: boolean;
    hours: number;
  } | null;
  /** First step of every strategy, to compare before choosing. */
  options: { strategy: string; firstStepCostCents: number; firstStepSuccessBps: number }[];
}

export interface CompanyEventState {
  company: CompanyBrief;
  /** Only the founder decides; employees watch. */
  canAct: boolean;
  unitCents: number;
  headcount: number;
  branchScores: Record<SkillBranch, number>;
  event: CompanyEvent | null;
  history: {
    id: string;
    archetype: string;
    polarity: "crisis" | "chance";
    severity: number;
    status: string;
    startedAt: string;
    resolvedAt: string | null;
  }[];
  /** Product words written by Claude (company-writer), else null and the Mini-KI decides. */
  profileWords: Record<string, string[]> | null;
}

export interface CompanyNewsItem {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
  aiHeadline: string | null;
  aiBody: string | null;
}

export interface CompanyNews {
  company: CompanyBrief;
  profileWords: Record<string, string[]> | null;
  items: CompanyNewsItem[];
}

/** A hit of the player search in the top bar (ADR-085). */
export interface PlayerSearchResult {
  nickname: string;
  tag: string | null;
  level: number;
  avatarKey: string;
}

/** Business moves of the own company (ADR-127). */
export interface CompanyMoveOption {
  key: string;
  kind: "cash" | "awareness" | "quality";
  risk: "safe" | "normal" | "risky";
  branch: string;
  minutes: number;
  costCents: number;
  chanceBps: number;
  skillBonusBps: number;
  payoutCents: number;
  refundCents: number;
  gain: number;
  /** While the move rests after the last run. */
  availableAt: string | null;
}

export interface CompanyMoves {
  slots: number;
  used: number;
  cashCents: number;
  tier: string;
  product: string | null;
  moves: CompanyMoveOption[];
  running: { id: number; key: string; startedAt: string; endsAt: string; costCents: number; chanceBps: number }[];
  history: {
    id: number;
    key: string;
    status: "success" | "failure";
    costCents: number;
    payoutCents: number;
    gain: number;
    resolvedAt: string;
  }[];
}

/** Company tasks with mini-games (ADR-129). */
export type TaskGame = "pick" | "count" | "sort" | "order" | "seq" | "math";
export type TaskStatus = "open" | "assigned" | "playing" | "ai" | "success" | "failure" | "missed";

export interface CompanyTask {
  id: number;
  key: string;
  game: TaskGame;
  branch: string;
  status: TaskStatus;
  valueCents: number;
  createdAt: string;
  dueAt: string;
  assignee: string | null;
  assigneeAi: boolean;
  assignedBy: string | null;
  aiDoneAt: string | null;
  openedAt: string | null;
  mine: boolean;
  canDelegate: boolean;
}

export interface CompanyTaskPerson {
  nickname: string;
  tag: string | null;
  tier: CareerTier;
  isMe: boolean;
  supervisor: string | null;
  reportsToMe: boolean;
  openTasks: number;
}

export interface CompanyTasks {
  role: "founder" | "employee";
  company: { id: string; name: string; tier: string; product: string | null };
  myTier: string;
  autoAi: boolean;
  aiWorkers: number;
  aiMinutes: number;
  canUseAi: boolean;
  people: CompanyTaskPerson[];
  tasks: CompanyTask[];
  history: {
    id: number;
    key: string;
    status: "success" | "failure" | "missed";
    resultCents: number;
    scoreBps: number | null;
    ai: boolean;
    doneBy: string | null;
    resolvedAt: string;
  }[];
}

export interface CompanyTaskPlay {
  id: number;
  key: string;
  game: TaskGame;
  puzzle: Record<string, unknown>;
  openedAt: string;
  seconds: number;
  valueCents: number;
  dueAt: string;
}

export interface CompanyTaskResult {
  id: number;
  key: string;
  status: "success" | "failure" | "missed";
  scoreBps: number | null;
  resultCents: number;
  xp: number;
  late: boolean;
  solution: Record<string, unknown>;
}

/** Own strategies judged by Claude or the Mini-KI (ADR-132). */
export type PitchKind = "event" | "move";
export type PitchMoveKind = "cash" | "awareness" | "quality";
export interface CompanyPitch {
  id: number;
  kind: PitchKind;
  moveKind: PitchMoveKind | null;
  eventId: string | null;
  text: string;
  status: "judging" | "running" | "success" | "failure" | "backfire";
  judge: "claude" | "mini" | null;
  fit: number | null;
  backfire: number | null;
  chanceBps: number | null;
  verdict: string | null;
  successText: string | null;
  failureText: string | null;
  backfireText: string | null;
  costCents: number;
  resultCents: number;
  createdAt: string;
  endsAt: string | null;
  resolvedAt: string | null;
}
export interface CompanyPitches {
  eventId: string | null;
  eventCostCents: number;
  moveCostCents: number;
  pitches: CompanyPitch[];
}

/** One entry of the news tab (ADR-129). */
export type NewsFeedKind = "all" | "stock" | "company" | "market" | "fun";
export interface NewsFeedItem {
  id: string;
  kind: "stock" | "company" | "market" | "fun";
  at: string;
  headline: string | null;
  body: string | null;
  ticker: string | null;
  name: string | null;
  direction: "up" | "down" | null;
  newsKind: string | null;
  payload: Record<string, unknown>;
  product: string | null;
  tier: string | null;
  category: string | null;
  itemKey: string | null;
  nickname: string | null;
}

/** The public profile of any company (ADR-125). */
export interface CompanyProfile {
  company: {
    id: string;
    name: string;
    ticker: string | null;
    sector: string;
    isAi: boolean;
    tier: string | null;
    brandColor: string | null;
    logo: CompanyLogoData | null;
    idea: string | null;
    foundedAt: string;
    listed: boolean;
    priceE4: number | null;
    changeBps: number | null;
  };
  founder: { nickname: string; tag: string | null; avatarKey: string } | null;
  facts: {
    valueCents: number | null;
    revenueCents: number | null;
    profitCents: number | null;
    period: "quarter" | "ttm" | null;
    staff: number;
    maxStaff: number;
    aiWorkers: number;
    product: string | null;
    stage: number | null;
    qualityBps: number | null;
    awarenessBps: number | null;
  };
  members: {
    nickname: string;
    tag: string | null;
    avatarKey: string;
    tier: string;
    title: string | null;
    since: string;
  }[];
  /** Latest market news about the company (ADR-130). */
  news: { headline: string; body: string | null; category: string; publishedAt: string }[];
}

/** The own net worth over time (ADR-124), oldest first. */
export interface NetWorthPoint {
  at: string;
  netWorthCents: number;
}

/** What a player holds, shown to the player and to friends (ADR-121). */
export interface PlayerHoldings {
  /** False for everyone who is neither the player nor a friend. */
  visible: boolean;
  totalCents: number | null;
  positions: {
    ticker: string;
    name: string;
    kind: SecurityKind;
    sector: string | null;
    quantityE6: number;
    valueCents: number;
    shareBps: number;
  }[];
}

/** Stock news with a lead (ADR-119): a hint that a stock is about to move. */
export interface StockNewsItem {
  id: number;
  ticker: string;
  name: string;
  headline: string;
  body: string;
  direction: "up" | "down";
  strength: 1 | 2 | 3;
  publishedAt: string;
  /** When the move is expected. */
  dueAt: string;
  status: "open" | "confirmed" | "fizzled";
  /** Told once the hint is settled and came true. */
  moveBps: number | null;
}

export interface StockNews {
  /** Share of hints that come true. */
  reliabilityBps: number;
  items: StockNewsItem[];
}

/** Friend code (ADR-111): the own code to hand out and the one code a player may redeem. */
export interface FriendCode {
  /** "NEXA-K7Q2" */
  code: string;
  bonusCents: number;
  redeemed: boolean;
  redeemedFrom: { nickname: string; tag: string | null } | null;
  redeemedAt: string | null;
  /** Friends who entered this player's code. */
  invited: number;
}

export interface FriendCodeRedeemed extends FriendCode {
  paidCents: number;
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
    /** Automatic CEO payout (ADR-086): last hour and today. */
    founderPayoutPerHourCents: number;
    todayFounderPayoutCents: number;
  } | null;
  /** The last closed hours, oldest first. */
  hours: {
    hourStart: string;
    revenueCents: number;
    profitCents: number;
    contractRevenueCents: number;
    founderPayoutCents: number;
    /** Supply contracts (ADR-098): goods bought in and sold, fees paid and earned, own goods for others. */
    supplyRevenueCents: number;
    supplyFeePaidCents: number;
    supplyFeeIncomeCents: number;
    supplyGoodsCents: number;
    /** Profit shares paid to silent partners (ADR-098). */
    stakePayoutCents: number;
  }[];
  /** Share of every profitable hour paid to the founder automatically (ADR-086). */
  founderPayoutBps: number;
  /** Running marketing campaign (ADR-097), null when none runs. */
  campaign: CompanyCampaign | null;
  /** Current price of each campaign, from the last hour's demand; null on servers before M4j. */
  campaignCosts: Record<CampaignKind, number> | null;
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
  /** Close the current company first and found this one in its place (ADR-100). */
  replace?: boolean;
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
  /** Rank and promotion (ADR-094); null on servers before M4i. */
  tier: CareerTier | null;
  rankHours: number;
  promotion: Pick<
    PromotionState,
    "nextTier" | "requirements" | "ready" | "pendingSince" | "nextSalaryCentsPerHour"
  > | null;
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
  "event_closed",
  "event_needs_staff",
  "feed_item_not_found",
  "upgrade_maxed",
  "promotion_not_ready",
  "promotion_too_soon",
  "promotion_pending",
  "campaign_running",
  "deal_not_found",
  "deal_closed",
  "deal_terms",
  "deal_limit",
  "deal_self",
  "stake_share_full",
  "deal_needs_company",
  "deal_too_big",
  "coin_not_found",
  "coin_exists",
  "ticker_taken",
  "coin_not_tradable",
  "coin_action_running",
  "coin_tech_too_low",
  "slippage_exceeded",
  "coin_not_launched",
  "move_unknown",
  "task_not_found",
  "task_taken",
  "task_not_allowed",
  "task_closed",
  "no_ai_workers",
  "pitch_text_invalid",
  "pitch_busy",
  "move_busy",
  "move_resting",
  "friend_code_unknown",
  "friend_code_self",
  "friend_code_used",
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
  companyPitches(): Promise<CompanyPitches>;
  submitCompanyPitch(
    requestId: string,
    kind: PitchKind,
    text: string,
    moveKind: PitchMoveKind | null,
  ): Promise<CompanyPitches>;
  companyTasks(): Promise<CompanyTasks>;
  delegateCompanyTask(requestId: string, taskId: number, to: string): Promise<CompanyTasks>;
  startCompanyTask(requestId: string, taskId: number): Promise<CompanyTaskPlay>;
  submitCompanyTask(requestId: string, taskId: number, answer: Record<string, unknown>): Promise<CompanyTaskResult>;
  setJobSupervisor(requestId: string, nickname: string, supervisor: string | null): Promise<CompanyTasks>;
  setCompanyTasksAutoAi(requestId: string, on: boolean): Promise<CompanyTasks>;
  newsFeed(kind: NewsFeedKind, limit: number): Promise<NewsFeedItem[]>;
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
  /** Titles are unique, lookalikes included (ADR-100). */
  checkArtworkTitle(title: string): Promise<{ allowed: boolean; reason: GameErrorKey | null }>;
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
  /** Ask the boss for the next rank (ADR-094). */
  requestPromotion(requestId: string): Promise<PromotionResult>;
  upgrades(): Promise<UpgradesState>;
  buyUpgrade(requestId: string, key: UpgradeKey): Promise<BuyUpgradeResult>;
  /** Cryptocurrencies (ADR-101). */
  cryptoMarket(): Promise<CryptoMarket>;
  coin(ticker: string): Promise<CoinDetail>;
  cryptoTrade(input: CryptoTradeInput): Promise<CryptoTradeResult>;
  myCoin(): Promise<MyCoin | null>;
  checkCoinName(name: string, ticker: string): Promise<{ allowed: boolean; reason: GameErrorKey | null }>;
  createCoin(requestId: string, name: string, ticker: string, logo: CompanyLogoData): Promise<MyCoin>;
  startCoinAction(requestId: string, action: CoinActionKey): Promise<MyCoin>;
  launchCoin(requestId: string, startPriceE4: number, liquidityCents: number, teamShareBps: number): Promise<MyCoin>;
  burnCoinTokens(requestId: string, quantityE6: number): Promise<MyCoin>;
  discontinueCoin(requestId: string): Promise<MyCoin>;
  /** Org chart of a player company for the founder and the staff (ADR-104). */
  companyOrg(companyId: string): Promise<CompanyOrg>;
  /** Marketing campaign of the own company (ADR-097). */
  startCampaign(requestId: string, companyId: string, kind: CampaignKind): Promise<CompanyCampaign>;
  /** Deals between players (ADR-098). */
  deals(): Promise<DealsOverview>;
  dealBoard(): Promise<Deal[]>;
  proposeDeal(input: ProposeDealInput): Promise<Deal>;
  respondDeal(requestId: string, dealId: string, accept: boolean): Promise<Deal>;
  cancelDeal(requestId: string, dealId: string): Promise<Deal>;
  breakDeal(requestId: string, dealId: string): Promise<Deal>;
  repayLoan(requestId: string, dealId: string, amountCents: number): Promise<Deal>;
  forgiveLoan(requestId: string, dealId: string): Promise<Deal>;
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
  /** Automatic CEO payout share in bps (ADR-086). */
  setFounderPayout(requestId: string, bps: number): Promise<MyCompany>;
  /** Next expansion level, paid from the company's cash (ADR-083). */
  expandCompany(requestId: string): Promise<MyCompany>;
  /** Friends (ADR-084). */
  friends(): Promise<Friends>;
  sendFriendRequest(requestId: string, nickname: string): Promise<Friends>;
  respondFriendRequest(requestId: string, nickname: string, accept: boolean): Promise<Friends>;
  removeFriend(requestId: string, nickname: string): Promise<Friends>;
  /** Stock news with a lead (ADR-119). */
  stockNews(limit?: number): Promise<StockNews>;
  /** Business moves of the own company (ADR-127). */
  companyMoves(): Promise<CompanyMoves>;
  startCompanyMove(requestId: string, key: string): Promise<CompanyMoves>;
  /** Public profile of any company (ADR-125). */
  companyProfile(companyId: string): Promise<CompanyProfile>;
  /** Own net worth over the last hours (ADR-124). */
  netWorthHistory(hours: number): Promise<NetWorthPoint[]>;
  /** Investments of a player, for the player and friends (ADR-121). */
  playerHoldings(nickname: string): Promise<PlayerHoldings>;
  /** Friend code (ADR-111). */
  friendCode(): Promise<FriendCode>;
  redeemFriendCode(requestId: string, code: string): Promise<FriendCodeRedeemed>;
  /** Players by name or tag (ADR-085), at most 8. */
  searchPlayers(query: string): Promise<PlayerSearchResult[]>;
  /** Friends feed (ADR-088). */
  feed(before?: number | null): Promise<FeedPage>;
  reactFeed(requestId: string, itemId: number): Promise<FeedItem>;
  /** In-app notifications. */
  notifications(): Promise<NotificationList>;
  markNotificationsRead(ids?: string[]): Promise<number>;
  /** Weekly league (ADR-089). */
  league(scope: LeagueScope, week: "current" | "last"): Promise<League>;
  /** Announced events (ADR-090). */
  events(): Promise<GameEvents>;
  /** Company crises and chances (ADR-091): own company (null) or the employer's. */
  companyEvent(companyId?: string | null): Promise<CompanyEventState>;
  chooseEventStrategy(requestId: string, eventId: string, strategy: string): Promise<CompanyEventState>;
  startEventStep(requestId: string, eventId: string): Promise<CompanyEventState>;
  companyNews(companyId?: string | null): Promise<CompanyNews>;
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
  /** Boss promotes an employee who meets the requirements (ADR-094); salary null = the standard raise. */
  promoteEmployee(
    requestId: string,
    companyId: string,
    playerJobId: string,
    salaryCentsPerHour: number | null,
  ): Promise<{ tier: CareerTier; salaryCentsPerHour: number }>;
  declinePromotion(requestId: string, companyId: string, playerJobId: string): Promise<{ retryAt: string | null }>;
  trainEmployee(
    requestId: string,
    playerJobId: string,
    skillKey: string,
  ): Promise<{ costCents: number; salaryCentsPerHour: number }>;
}
