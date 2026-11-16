/*
 * The tabs of the own company page (ADR-167, UI): Dashboard, Controlling, Mitarbeiter, Buchhaltung, Geschäftsrat.
 * Pure: maps the old tabs and sections (Mira, overview, tasks, team, chat; ADR-071/138) and Mira's "open" actions
 * to the new places, and builds the links notifications and the dashboard use.
 */
export const COMPANY_TABS = ["dashboard", "controlling", "staff", "books", "board"] as const;
export type CompanyTab = (typeof COMPANY_TABS)[number];

/** Tabs that only exist while the company has a stock at the exchange. */
export const LISTED_TABS: readonly CompanyTab[] = ["books", "board"];

export interface CompanyTarget {
  tab: CompanyTab;
  /** Collapsible section to open (id without the `section-` prefix). */
  section?: string;
  /** Element id to scroll to; defaults to the section. */
  target?: string;
}

/** Old tab names (before the restructuring) and what they are now. */
const TAB_ALIASES: Record<string, CompanyTarget> = {
  mira: { tab: "dashboard", target: "mira" },
  overview: { tab: "controlling" },
  tasks: { tab: "staff", target: "tasks" },
  team: { tab: "staff" },
  chat: { tab: "staff", target: "chat" },
  accounting: { tab: "books" },
  taxes: { tab: "books", target: "taxes" },
};

/** Sections by name: the old overview sections, Mira's sections and the new ones. */
const SECTIONS: Record<string, CompanyTarget> = {
  // Dashboard
  mira: { tab: "dashboard", target: "mira" },
  health: { tab: "dashboard", target: "health" },
  todo: { tab: "dashboard", target: "todo" },
  situation: { tab: "dashboard", section: "situation" },
  history: { tab: "dashboard", section: "history" },
  numbers: { tab: "dashboard", section: "numbers" },
  quarter: { tab: "dashboard", section: "numbers", target: "quarter" },
  reputation: { tab: "dashboard", target: "reputation" },
  // Controlling
  profit: { tab: "controlling", section: "profit" },
  strategy: { tab: "controlling", section: "profit" },
  business: { tab: "controlling", section: "business" },
  marketing: { tab: "controlling", section: "marketing" },
  campaign: { tab: "controlling", section: "marketing", target: "campaign" },
  boss: { tab: "controlling", section: "marketing", target: "company-controls" },
  "company-controls": { tab: "controlling", section: "marketing", target: "company-controls" },
  moves: { tab: "controlling", section: "moves" },
  expansion: { tab: "controlling", section: "expansion" },
  money: { tab: "controlling", section: "money" },
  capital: { tab: "controlling", section: "capital" },
  brand: { tab: "controlling", section: "brand" },
  research: { tab: "controlling", section: "research" },
  growth: { tab: "controlling", section: "growth" },
  dividends: { tab: "controlling", section: "dividends" },
  close: { tab: "controlling", section: "company" },
  // Mitarbeiter
  team: { tab: "staff" },
  staff: { tab: "staff", target: "satisfaction" },
  satisfaction: { tab: "staff", target: "satisfaction" },
  benefits: { tab: "staff", target: "benefits" },
  training: { tab: "staff", target: "training" },
  tasks: { tab: "staff", target: "tasks" },
  chat: { tab: "staff", target: "chat" },
  // Buchhaltung
  books: { tab: "books", target: "books-duty" },
  "books-duty": { tab: "books", target: "books-duty" },
  taxes: { tab: "books", target: "taxes" },
  accounting: { tab: "books", target: "accounting" },
  advisor: { tab: "books", target: "advisor" },
  // Geschäftsrat
  board: { tab: "board" },
};

export function isCompanyTab(value: string | null | undefined): value is CompanyTab {
  return COMPANY_TABS.includes(value as CompanyTab);
}

/**
 * Where a tab (new or old name) and an optional section lead. The section wins over the tab when it is known:
 * Mira still says `overview` + `books`, and that is the Buchhaltung tab now.
 */
export function resolveCompanyTarget(tab?: string | null, section?: string | null): CompanyTarget {
  const bySection = section ? SECTIONS[section] : undefined;
  if (bySection) return bySection;
  if (isCompanyTab(tab)) return section ? { tab, target: section } : { tab };
  const alias = tab ? TAB_ALIASES[tab] : undefined;
  if (alias) return section ? { ...alias, target: section } : alias;
  return { tab: "dashboard" };
}

/** The link to a place on the own company page. */
export function companyHref(target: CompanyTarget): string {
  const params = new URLSearchParams();
  if (target.tab !== "dashboard") params.set("tab", target.tab);
  const section = target.target ?? target.section;
  if (section) params.set("section", section);
  const query = params.toString();
  return query ? `/company?${query}` : "/company";
}

/** Notification types of listed companies (ADR-167) whose server link is the bare company page. */
const NOTIFICATION_SECTIONS: Record<string, string> = {
  tax_office: "taxes",
  team_mood: "satisfaction",
  company_project: "research",
  company_dividend: "dividends",
  board: "board",
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
