"use client";

import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListedCompany } from "@/features/game/listed-types";
import type { MyCompany } from "@/features/game/types";
import { ItemList, ResearchTree } from "../../listed/catalogue";
import { DividendCard, RestrictionNotes, UpkeepSummary } from "../../listed/controlling-panels";
import { money } from "../../listed/shared";
import type { CompanyTarget } from "../../tabs";
import { CompanyMovesCard } from "../company-moves";
import {
  DangerZone,
  MarketCard,
  MarketingBudgetCard,
  PayFactorNote,
  StaffLink,
  TreasuryCard,
  UpgradeCard,
} from "../company-parts";
import type { HireRequest } from "../employer";
import { GrowthPath } from "../growth-path";
import { ListingCard } from "../listing";
import { PitchCard } from "../pitch-card";
import { ProductionCard } from "../production";
import { ExpansionCard, PayoutCard, ProfitCoach, StrategyCard } from "../profit";
import { CampaignCard, ProfitRoutes } from "../routes";

type SectionProps = (id: string) => { id: string; open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Every lever of the company in one place (ADR-167, UI), grouped and folded: prices, production, marketing, business
 * moves, expansion, the till and payouts, the exchange, banner and logo, closing. Listed companies add the growth
 * catalogue (research tree, products, markets, machines, acquisitions, licences) and dividends.
 */
export function ControllingTab({
  company,
  listed,
  listedPending,
  section,
  go,
  onHire,
  onDrawLogo,
  onEditBanner,
}: {
  company: MyCompany;
  listed: ListedCompany | null;
  listedPending: boolean;
  section: SectionProps;
  go: (target: CompanyTarget) => void;
  onHire: (request: HireRequest) => void;
  onDrawLogo: () => void;
  onEditBanner: () => void;
}) {
  const ts = useTranslations("firm.sections");
  const t = useTranslations("hq.controlling");
  const tl = useTranslations("logo");
  const tb = useTranslations("banner");
  const tk = useTranslations("listed.kinds");
  const trainingOpen = company.employees + company.aiWorkers >= company.trainingFrom;
  const toStaff = () => go({ tab: "staff" });
  const toCampaign = () => go({ tab: "controlling", section: "marketing", target: "campaign" });
  const logoLocked = company.logo !== null && !company.logoHidden;
  const isListed = company.listing?.status === "listed";
  const research = listed?.items.filter((i) => i.kind === "research") ?? [];
  const researchDone = research.filter((i) => i.status === "active").length;
  const owned = (kinds: string[]) =>
    listed?.items.filter((i) => kinds.includes(i.kind) && (i.status === "active" || i.status === "paused")).length ?? 0;

  const tg = useTranslations("hq.controlling.groups");
  const groups = [
    { id: "sell", icon: UI_ICONS.star },
    { id: "run", icon: UI_ICONS.briefcase },
    { id: "money", icon: UI_ICONS.portfolio },
    ...(listed ? [{ id: "listed" as const, icon: UI_ICONS.search }] : []),
    { id: "brand", icon: UI_ICONS.art },
  ] as const;
  const jump = (id: string) =>
    document.getElementById(`group-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-6" data-testid="company-controlling">
      {/* In-page navigation (ADR-176): the levers are grouped; the chips stay in reach while scrolling. */}
      <nav
        aria-label={tg("nav")}
        className="sticky top-(--topbar-height) z-10 -mx-4 flex flex-wrap gap-1.5 border-b-2 border-line-1 bg-bg/88 px-4 py-2 backdrop-blur-lg lg:mx-0 lg:rounded-md lg:border-2"
        data-testid="controlling-nav"
      >
        {groups.map((g) => (
          <Button
            key={g.id}
            size="sm"
            variant="ghost"
            onClick={() => jump(g.id)}
            data-testid={`controlling-chip-${g.id}`}
          >
            <PixelIcon {...g.icon} scale={1} />
            {tg(g.id)}
          </Button>
        ))}
      </nav>

      {listed && <UpkeepSummary listed={listed} />}
      {listedPending && <Skeleton className="h-48 w-full rounded-lg" />}

      <div className="space-y-6" data-testid="company-overview">
        <Group id="sell" icon={UI_ICONS.star} title={tg("sell")} text={tg("sellText")}>
          <CollapsibleSection
            {...section("profit")}
            title={t("sections.profit")}
            summary={t("sections.profitSummary")}
            icon={<PixelIcon {...UI_ICONS.star} scale={2} />}
          >
            {listed && <RestrictionNotes restrictions={listed.restrictions} only={["price"]} />}
            <StrategyCard company={company} />
            <MarketCard company={company} />
            <ProfitCoach
              company={company}
              onNavigate={(to) => {
                if (to === "team") return toStaff();
                go({ tab: "controlling", section: "marketing", target: "company-controls" });
              }}
            />
          </CollapsibleSection>
          <div className="space-y-4">
            <CollapsibleSection
              {...section("marketing")}
              title={t("sections.marketing")}
              summary={t("sections.marketingSummary", { amount: money(company.marketingCentsPerQuarter) })}
              icon={<PixelIcon {...UI_ICONS.bell} scale={2} />}
            >
              <MarketingBudgetCard company={company} />
              <CampaignCard company={company} />
            </CollapsibleSection>
            <CollapsibleSection
              {...section("moves")}
              title={ts("moves")}
              summary={ts("movesSummary")}
              icon={<PixelIcon {...UI_ICONS.deal} scale={2} />}
            >
              <CompanyMovesCard />
              <PitchCard kind="move" />
            </CollapsibleSection>
          </div>
        </Group>

        <Group id="run" icon={UI_ICONS.briefcase} title={tg("run")} text={tg("runText")}>
          <CollapsibleSection
            {...section("business")}
            title={t("sections.business")}
            summary={t("sections.businessSummary")}
            icon={<PixelIcon {...UI_ICONS.briefcase} scale={2} />}
          >
            <ProductionCard company={company} onTeam={toStaff} onCampaign={toCampaign} />
            <ProfitRoutes company={company} />
            <StaffLink company={company} onTeam={toStaff} />
          </CollapsibleSection>
          <CollapsibleSection
            {...section("expansion")}
            title={t("sections.expansion")}
            summary={t("sections.expansionSummary")}
            icon={<PixelIcon {...UI_ICONS.upgrade} scale={2} />}
          >
            <GrowthPath
              company={company}
              onFill={(skills) => onHire({ skills })}
              onTrain={trainingOpen ? () => go({ tab: "staff", target: "training" }) : undefined}
            />
            <ExpansionCard company={company} />
            <UpgradeCard company={company} />
          </CollapsibleSection>
        </Group>

        <Group id="money" icon={UI_ICONS.portfolio} title={tg("money")} text={tg("moneyText")}>
          <CollapsibleSection
            {...section("money")}
            title={t("sections.money")}
            summary={t("sections.moneySummary", { amount: money(listed?.freeCashCents ?? company.cashCents) })}
            icon={<PixelIcon {...UI_ICONS.portfolio} scale={2} />}
          >
            <TreasuryCard
              company={company}
              freeCashCents={listed?.freeCashCents}
              reservedCents={listed?.reservedCents}
              restrictions={listed?.restrictions}
            />
            {listed && <RestrictionNotes restrictions={listed.restrictions} only={["payout"]} />}
            {/* Remounts when the stored share changes, so the slider never shows an unsaved value as saved. */}
            <PayoutCard key={company.founderPayoutBps} company={company} />
            <PayFactorNote company={company} />
          </CollapsibleSection>
          <div className="space-y-4">
            <CollapsibleSection
              {...section("capital")}
              title={t("sections.capital")}
              summary={t(isListed ? "sections.capitalListed" : "sections.capitalSummary")}
              icon={<PixelIcon {...UI_ICONS.markets} scale={2} />}
            >
              <ListingCard company={company} />
              {!company.listing && !company.canGoPublic && (
                <p className="text-sm text-pretty text-fg-3">{t("capitalHint")}</p>
              )}
            </CollapsibleSection>
            {listed && (
              <CollapsibleSection
                {...section("dividends")}
                title={t("sections.dividends")}
                summary={t("sections.dividendsSummary", { amount: money(listed.dividends.maxCents) })}
                icon={<PixelIcon {...UI_ICONS.gift} scale={2} />}
              >
                <DividendCard listed={listed} />
              </CollapsibleSection>
            )}
          </div>
        </Group>

        {listed && (
          <Group
            id="listed"
            icon={UI_ICONS.search}
            title={tg("listed")}
            text={tg("listedText")}
            testId="controlling-listed"
          >
            <CollapsibleSection
              {...section("research")}
              title={tk("research")}
              summary={t("sections.researchSummary", { done: researchDone, total: research.length })}
              icon={<PixelIcon {...UI_ICONS.search} scale={2} />}
            >
              <p className="text-sm text-pretty text-fg-3">{t("researchIntro")}</p>
              <ResearchTree listed={listed} />
            </CollapsibleSection>
            <CollapsibleSection
              {...section("growth")}
              title={t("sections.growth")}
              summary={t("sections.growthSummary", {
                count: owned(["product", "region", "machine", "acquisition", "licence"]),
              })}
              icon={<PixelIcon {...UI_ICONS.company} scale={2} />}
            >
              {(["product", "region", "machine", "acquisition", "licence"] as const).map((kind) => (
                <div key={kind} className="space-y-2">
                  <div>
                    <p className="font-semibold text-fg-1">{tk(kind)}</p>
                    <p className="text-xs text-pretty text-fg-3">{t(`kindHints.${kind}`)}</p>
                  </div>
                  <ItemList listed={listed} kinds={[kind]} />
                </div>
              ))}
            </CollapsibleSection>
          </Group>
        )}

        <Group id="brand" icon={UI_ICONS.art} title={tg("brand")} text={tg("brandText")}>
          <CollapsibleSection
            {...section("brand")}
            title={t("sections.brand")}
            summary={t("sections.brandSummary")}
            icon={<PixelIcon {...UI_ICONS.art} scale={2} />}
          >
            <Card padding="md" className="flex flex-wrap items-center gap-3" data-testid="brand">
              <p className="min-w-0 flex-1 text-sm text-pretty text-fg-2">{t("brandText")}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={onEditBanner} data-testid="brand-banner">
                  {tb("title")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onDrawLogo}
                  disabled={logoLocked}
                  title={logoLocked ? tl("locked") : undefined}
                  data-testid="brand-logo"
                >
                  {tl("draw")}
                </Button>
              </div>
            </Card>
          </CollapsibleSection>
          {/* Closing the company stays plainly visible, not folded away (ADR-147). */}
          <div id="section-company" className="scroll-mt-24">
            <DangerZone company={company} />
          </div>
        </Group>
      </div>
    </div>
  );
}

/** A group of levers: icon, title and one line on top, its sections side by side from lg. */
function Group({
  id,
  icon,
  title,
  text,
  testId,
  children,
}: {
  id: string;
  icon: (typeof UI_ICONS)[keyof typeof UI_ICONS];
  title: string;
  text: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`group-${id}`}
      aria-labelledby={`group-${id}-title`}
      className="scroll-mt-32 space-y-3"
      data-testid={testId}
    >
      <header className="flex items-start gap-3 border-b-2 border-line-1 pb-2">
        <PixelIcon {...icon} scale={2} />
        <div className="min-w-0">
          <h2 id={`group-${id}-title`} className="font-semibold text-fg-1">
            {title}
          </h2>
          <p className="text-xs text-pretty text-fg-3">{text}</p>
        </div>
      </header>
      <div className="grid items-start gap-4 *:min-w-0 lg:grid-cols-2 lg:gap-5">{children}</div>
    </section>
  );
}
