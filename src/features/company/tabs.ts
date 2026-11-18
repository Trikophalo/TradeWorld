/*
 * The tabs of the own company page (ADR-167, UI): Dashboard, Controlling, Mitarbeiter, Standort (ADR-208),
 * Buchhaltung, Geschäftsrat.
 * Pure: maps the old tabs and sections (Mira, overview, tasks, team, chat; ADR-071/138; the ids before ADR-187) and
 * Mira's "open" actions to the new places, and builds the links notifications and the dashboard use.
 */
export const COMPANY_TABS = ["dashboard", "controlling", "staff", "location", "books", "board"] as const;
export type CompanyTab = (typeof COMPANY_TABS)[number];

/** Tabs that only exist while the company has a stock at the exchange. */
export const LISTED_TABS: readonly CompanyTab[] = ["books", "board"];

export interface CompanyTarget {
  tab: CompanyTab;
  /**
   * Section to scroll to (id without the `section-` prefix). Since ADR-187 it may be a pane of a merged card: the
   * card then switches to that pane first.
   */
  section?: string;
  /** Element id to scroll to; defaults to the section. */
  target?: string;
}

/**
 * The merged cards of the tabs (ADR-187): a card groups the sections that belong together and shows one of them at a
 * time (segmented control). `panes` are the section ids inside, in order; a link to a pane opens the card on it.
 */
export const COMPANY_GROUPS = {
  // Dashboard
  numbers: { tab: "dashboard", panes: [] },
  charts: { tab: "dashboard", panes: [] },
  diagnosis: { tab: "dashboard", panes: [] },
  // Controlling
  "group-offer": { tab: "controlling", panes: ["profit", "business"] },
  "group-marketing": { tab: "controlling", panes: ["marketing", "moves"] },
  "group-money": { tab: "controlling", panes: ["money", "capital", "dividends"] },
  "group-growth": { tab: "controlling", panes: ["expansion", "skills", "risks", "research", "growth"] },
  "group-brand": { tab: "controlling", panes: [] },
  // Mitarbeiter
  todo: { tab: "staff", panes: [] },
  "staff-tasks": { tab: "staff", panes: [] },
  situation: { tab: "staff", panes: [] },
  talents: { tab: "staff", panes: [] },
  "group-team": { tab: "staff", panes: ["staff-team", "staff-mood", "staff-value"] },
  // Standort (ADR-208)
  location: { tab: "location", panes: [] },
} as const satisfies Record<string, { tab: CompanyTab; panes: readonly string[] }>;
export type CompanyGroup = keyof typeof COMPANY_GROUPS;

/** The merged card a section belongs to (itself when it is a card), or null. */
export function groupOf(section: string | null | undefined): CompanyGroup | null {
  if (!section) return null;
  if (section in COMPANY_GROUPS) return section as CompanyGroup;
  for (const [id, g] of Object.entries(COMPANY_GROUPS)) {
    if ((g.panes as readonly string[]).includes(section)) return id as CompanyGroup;
  }
  return null;
}

/** Old tab names (before the restructuring) and what they are now. */
const TAB_ALIASES: Record<string, CompanyTarget> = {
  mira: { tab: "dashboard", target: "mira" },
  overview: { tab: "controlling" },
  tasks: { tab: "staff", section: "staff-tasks", target: "tasks" },
  team: { tab: "staff", section: "staff-team" },
  chat: { tab: "staff", target: "chat" },
  accounting: { tab: "books" },
  taxes: { tab: "books", target: "taxes" },
  world: { tab: "location" },
  standort: { tab: "location" },
};

/**
 * Sections by name: the old overview sections, Mira's sections, the ids before ADR-187 and the new ones. `section` is
 * the pane or card that holds the place (a merged card opens on that pane), `target` the element to scroll to.
 */
const SECTIONS = {
  // Dashboard: numbers and charts only (ADR-187)
  numbers: { tab: "dashboard", section: "numbers" },
  timers: { tab: "dashboard", section: "numbers" },
  charts: { tab: "dashboard", section: "charts" },
  history: { tab: "dashboard", section: "charts", target: "history" },
  quarter: { tab: "dashboard", section: "charts", target: "quarter" },
  reputation: { tab: "dashboard", section: "charts", target: "reputation" },
  "reputation-mood": { tab: "dashboard", section: "charts", target: "reputation" },
  mood: { tab: "dashboard", section: "charts", target: "mood" },
  diagnosis: { tab: "dashboard", section: "diagnosis" },
  health: { tab: "dashboard", section: "diagnosis", target: "health" },
  details: { tab: "dashboard", section: "diagnosis", target: "health" },
  strengths: { tab: "dashboard", section: "diagnosis", target: "health" },
  // Mira is a panel on every tab (ADR-187); the link opens it.
  mira: { tab: "dashboard", target: "mira" },
  assist: { tab: "dashboard", target: "mira" },
  // Mitarbeiter: the to-do center, tasks, the situation, the team card and the chat
  todo: { tab: "staff", section: "todo" },
  autopilot: { tab: "staff", section: "todo", target: "autopilot" },
  "staff-tasks": { tab: "staff", section: "staff-tasks" },
  tasks: { tab: "staff", section: "staff-tasks", target: "tasks" },
  situation: { tab: "staff", section: "situation" },
  event: { tab: "staff", section: "situation" },
  // Stellen & Talente (ADR-199)
  talents: { tab: "staff", section: "talents" },
  stellen: { tab: "staff", section: "talents" },
  "talent-market": { tab: "staff", section: "talents", target: "talents" },
  "group-team": { tab: "staff", section: "group-team" },
  "staff-team": { tab: "staff", section: "staff-team" },
  team: { tab: "staff", section: "staff-team" },
  applications: { tab: "staff", section: "staff-team", target: "applications" },
  training: { tab: "staff", section: "staff-team", target: "training" },
  "staff-mood": { tab: "staff", section: "staff-mood" },
  staff: { tab: "staff", section: "staff-mood", target: "satisfaction" },
  satisfaction: { tab: "staff", section: "staff-mood", target: "satisfaction" },
  benefits: { tab: "staff", section: "staff-mood", target: "benefits" },
  "staff-value": { tab: "staff", section: "staff-value" },
  "team-value": { tab: "staff", section: "staff-value" },
  "staff-chat": { tab: "staff", target: "chat" },
  chat: { tab: "staff", target: "chat" },
  // Controlling: Angebot & Produktion
  "group-offer": { tab: "controlling", section: "group-offer" },
  "group-sell": { tab: "controlling", section: "group-offer" },
  "group-run": { tab: "controlling", section: "group-offer" },
  profit: { tab: "controlling", section: "profit" },
  strategy: { tab: "controlling", section: "profit" },
  business: { tab: "controlling", section: "business" },
  // Marketing
  "group-marketing": { tab: "controlling", section: "group-marketing" },
  marketing: { tab: "controlling", section: "marketing" },
  campaign: { tab: "controlling", section: "marketing", target: "campaign" },
  boss: { tab: "controlling", section: "marketing", target: "company-controls" },
  "company-controls": { tab: "controlling", section: "marketing", target: "company-controls" },
  moves: { tab: "controlling", section: "moves" },
  // Geld
  "group-money": { tab: "controlling", section: "group-money" },
  money: { tab: "controlling", section: "money" },
  capital: { tab: "controlling", section: "capital" },
  dividends: { tab: "controlling", section: "dividends" },
  // Wachstum
  "group-growth": { tab: "controlling", section: "group-growth" },
  "group-listed": { tab: "controlling", section: "research" },
  expansion: { tab: "controlling", section: "expansion" },
  research: { tab: "controlling", section: "research" },
  growth: { tab: "controlling", section: "growth" },
  // Fertigkeiten (ADR-194)
  skills: { tab: "controlling", section: "skills" },
  risks: { tab: "controlling", section: "risks" },
  "company-skills": { tab: "controlling", section: "skills", target: "company-skills" },
  // Marke & Firma
  "group-brand": { tab: "controlling", section: "group-brand" },
  brand: { tab: "controlling", section: "group-brand", target: "brand" },
  close: { tab: "controlling", section: "group-brand", target: "section-company" },
  company: { tab: "controlling", section: "group-brand", target: "section-company" },
  // Buchhaltung
  books: { tab: "books", target: "books-duty" },
  "books-duty": { tab: "books", target: "books-duty" },
  "books-due": { tab: "books", target: "books-duty" },
  taxes: { tab: "books", target: "taxes" },
  accounting: { tab: "books", target: "accounting" },
  "books-ledger": { tab: "books", target: "accounting" },
  advisor: { tab: "books", target: "advisor" },
  // Standort (ADR-208): world map, headquarters, subsidiaries, lobby
  location: { tab: "location", section: "location" },
  world: { tab: "location", section: "location" },
  "world-map": { tab: "location", target: "world-map" },
  map: { tab: "location", target: "world-map" },
  "world-hq": { tab: "location", target: "world-hq" },
  headquarters: { tab: "location", target: "world-hq" },
  "world-effect": { tab: "location", target: "world-effect" },
  "world-subsidiaries": { tab: "location", target: "world-subsidiaries" },
  subsidiaries: { tab: "location", target: "world-subsidiaries" },
  "world-lobby": { tab: "location", target: "world-lobby" },
  lobby: { tab: "location", target: "world-lobby" },
  "location-fee": { tab: "location", target: "world-lobby" },
  // Geschäftsrat
  board: { tab: "board" },
  // ADR-185: more of Mira's places
  interview: { tab: "staff", section: "situation", target: "interview" },
} as const satisfies Record<string, CompanyTarget>;

export type CompanySection = keyof typeof SECTIONS;
export const COMPANY_SECTIONS = Object.keys(SECTIONS) as CompanySection[];

/** Every section name a link may carry (for tests). */
export const KNOWN_SECTIONS: readonly string[] = COMPANY_SECTIONS;

export function isCompanySection(value: string | null | undefined): value is CompanySection {
  return typeof value === "string" && Object.hasOwn(SECTIONS, value);
}

/** The place a section name leads to. */
export function sectionTarget(section: CompanySection): CompanyTarget {
  return SECTIONS[section];
}

/** Sections that render only for a listed company. */
const LISTED_SECTIONS = new Set<CompanySection>([
  "research",
  "growth",
  "dividends",
  "mood",
  "staff",
  "satisfaction",
  "benefits",
  "staff-mood",
]);

/**
 * Whether a section is on the page right now (ADR-185): the listed parts only while the company is listed, the
 * trainings once the team is big enough. Mira links only to places that are there.
 */
export function sectionAvailable(section: CompanySection, page: { listed: boolean; trainingOpen: boolean }): boolean {
  const target: CompanyTarget = SECTIONS[section];
  if (LISTED_TABS.includes(target.tab) || LISTED_SECTIONS.has(section)) return page.listed;
  if (section === "training") return page.trainingOpen;
  return true;
}

export function isCompanyTab(value: string | null | undefined): value is CompanyTab {
  return COMPANY_TABS.includes(value as CompanyTab);
}

/**
 * Where a tab (new or old name) and an optional section lead. The section wins over the tab when it is known:
 * Mira still says `overview` + `books`, and that is the Buchhaltung tab now.
 */
export function resolveCompanyTarget(tab?: string | null, section?: string | null): CompanyTarget {
  const bySection: CompanyTarget | undefined = isCompanySection(section) ? SECTIONS[section] : undefined;
  if (bySection) return bySection;
  if (isCompanyTab(tab)) return section ? { tab, target: section } : { tab };
  const alias = tab ? TAB_ALIASES[tab] : undefined;
  if (alias) return section ? { ...alias, target: section } : alias;
  return { tab: "dashboard" };
}

/**
 * The link to a place on the own company page. The most precise known name goes into the URL: the pane when the
 * element alone would not open the right pane (e.g. `brand`), otherwise the element.
 */
export function companyHref(target: CompanyTarget): string {
  const params = new URLSearchParams();
  if (target.tab !== "dashboard") params.set("tab", target.tab);
  const section = linkName(target);
  if (section) params.set("section", section);
  const query = params.toString();
  return query ? `/company?${query}` : "/company";
}

/** The name for `?section=`: the element if it resolves back to the same place, else the section. */
function linkName(target: CompanyTarget): string | undefined {
  if (!target.target && !target.section) return undefined;
  const same = (v: CompanyTarget) => v.tab === target.tab && v.section === target.section && v.target === target.target;
  for (const name of [target.target, target.section]) {
    if (isCompanySection(name) && same(SECTIONS[name])) return name;
  }
  // A known place under another name (e.g. `section-brand` is reached by `brand`).
  const named = Object.entries(SECTIONS).find(([, v]) => same(v))?.[0];
  return named ?? target.target ?? target.section;
}

/** Notification types of listed companies (ADR-167) whose server link is the bare company page. */
const NOTIFICATION_SECTIONS: Record<string, string> = {
  tax_office: "taxes",
  team_mood: "satisfaction",
  company_project: "research",
  company_dividend: "dividends",
  board: "board",
  world_location: "world-lobby",
};

/**
 * The link of a notification: the server sends `/company` for the new types; the client adds the tab.
 * `/company?board=<id>` (board of any company the player holds shares of) and every other link stay as they are.
 */
export function notificationHref(typeKey: string, link: string | null): string | null {
  if (link !== "/company") return link;
  const section = NOTIFICATION_SECTIONS[typeKey];
  return section ? companyHref(resolveCompanyTarget(null, section)) : link;
}

/** The place a section is influenced at, for the dashboard's "Beeinflussen in …" hints: tab and merged card. */
export function placeOf(target: CompanyTarget): { tab: CompanyTab; group: CompanyGroup | null; pane: string | null } {
  const group = groupOf(target.section);
  const pane =
    group && target.section && (COMPANY_GROUPS[group].panes as readonly string[]).includes(target.section)
      ? target.section
      : null;
  return { tab: target.tab, group, pane };
}
