"use client";

import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { FirmSection, SectionNav, SubSection } from "../firm-layout";
import { GrowthPath } from "../growth-path";
import { ListingCard } from "../listing";
import { PitchCard } from "../pitch-card";
import { ProductionCard } from "../production";
import { ExpansionCard, PayoutCard, ProfitCoach, StrategyCard } from "../profit";
import { CampaignCard, ProfitRoutes } from "../routes";

/** A small grey chip with the current state of a block (budget, cash, research done …). */
function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-pill bg-surface-2 px-2 py-0.5 nums text-2xs font-normal text-fg-3">{children}</span>;
}

/**
 * Every lever of the company in one place (ADR-167; flat since ADR-183): five sections with a sticky jump bar, each
 * block with a title and one line of what it does, nothing folded away. Prices, marketing and business moves;
 * production and growth; the till, payouts, the exchange and dividends; for listed companies research and the growth
 * catalogue; banner, logo and closing.
 */
export function ControllingTab({
  company,
  listed,
  listedPending,
  go,
  onHire,
  onDrawLogo,
  onEditBanner,
}: {
  company: MyCompany;
  listed: ListedCompany | null;
  listedPending: boolean;
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
  const tg = useTranslations("hq.controlling.groups");
  const trainingOpen = company.employees + company.aiWorkers >= company.trainingFrom;
  const toStaff = () => go({ tab: "staff" });
  const toCampaign = () => go({ tab: "controlling", section: "marketing", target: "campaign" });
  const logoLocked = company.logo !== null && !company.logoHidden;
  const isListed = company.listing?.status === "listed";
  const research = listed?.items.filter((i) => i.kind === "research") ?? [];
  const researchDone = research.filter((i) => i.status === "active").length;
  const owned = (kinds: string[]) =>
    listed?.items.filter((i) => kinds.includes(i.kind) && (i.status === "active" || i.status === "paused")).length ?? 0;

  const groups = [
    { id: "sell", icon: UI_ICONS.star },
    { id: "run", icon: UI_ICONS.briefcase },
    { id: "money", icon: UI_ICONS.portfolio },
    ...(listed ? [{ id: "listed" as const, icon: UI_ICONS.search }] : []),
    { id: "brand", icon: UI_ICONS.art },
  ] as const;

  return (
    <div className="space-y-8" data-testid="company-controlling">
      {/* In-page navigation (ADR-176, ADR-183): the levers are grouped; the chips stay in reach while scrolling. */}
      <SectionNav
        items={groups.map((g) => ({ id: `group-${g.id}`, label: tg(g.id), icon: g.icon }))}
        label={tg("nav")}
        testId="controlling-nav"
      />

      {listed && <UpkeepSummary listed={listed} />}
      {listedPending && <Skeleton className="h-48 w-full rounded-lg" />}

      <div className="space-y-10" data-testid="company-overview">
        <FirmSection id="group-sell" icon={UI_ICONS.star} title={tg("sell")} description={tg("sellText")} columns={2}>
          <SubSection
            id="profit"
            title={t("sections.profit")}
            description={t("sub.profit")}
            badge={<Chip>{t(`sub.level.${company.priceLevel}`)}</Chip>}
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
          </SubSection>
          <SubSection
            id="marketing"
            title={t("sections.marketing")}
            description={t("sub.marketing")}
            badge={<Chip>{t("sections.marketingSummary", { amount: money(company.marketingCentsPerQuarter) })}</Chip>}
          >
            <MarketingBudgetCard company={company} />
            <CampaignCard company={company} />
          </SubSection>
          {/* The long list of business moves gets the full width instead of stretching one column. */}
          <SubSection id="moves" title={ts("moves")} description={t("sub.moves")} className="lg:col-span-2">
            <CompanyMovesCard />
            <PitchCard kind="move" />
          </SubSection>
        </FirmSection>

        <FirmSection id="group-run" icon={UI_ICONS.briefcase} title={tg("run")} description={tg("runText")} columns={2}>
          <SubSection id="business" title={t("sections.business")} description={t("sub.business")}>
            <ProductionCard company={company} onTeam={toStaff} onCampaign={toCampaign} />
            <ProfitRoutes company={company} />
            <StaffLink company={company} onTeam={toStaff} />
          </SubSection>
          <SubSection id="expansion" title={t("sections.expansion")} description={t("sub.expansion")}>
            <GrowthPath
              company={company}
              onFill={(skills) => onHire({ skills })}
              onTrain={trainingOpen ? () => go({ tab: "staff", target: "training" }) : undefined}
            />
            <ExpansionCard company={company} />
            <UpgradeCard company={company} />
          </SubSection>
        </FirmSection>

        <FirmSection
          id="group-money"
          icon={UI_ICONS.portfolio}
          title={tg("money")}
          description={tg("moneyText")}
          columns={2}
        >
          <SubSection
            id="money"
            title={t("sections.money")}
            description={t("sub.money")}
            badge={
              <Chip>{t("sections.moneySummary", { amount: money(listed?.freeCashCents ?? company.cashCents) })}</Chip>
            }
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
          </SubSection>
          <div className="space-y-6">
            <SubSection
              id="capital"
              title={t("sections.capital")}
              description={t(isListed ? "sections.capitalListed" : "sub.capital")}
            >
              <ListingCard company={company} />
              {!company.listing && !company.canGoPublic && (
                <p className="text-sm text-pretty text-fg-3">{t("capitalHint")}</p>
              )}
            </SubSection>
            {listed && (
              <SubSection
                id="dividends"
                title={t("sections.dividends")}
                description={t("sub.dividends")}
                badge={<Chip>{t("sections.dividendsSummary", { amount: money(listed.dividends.maxCents) })}</Chip>}
              >
                <DividendCard listed={listed} />
              </SubSection>
            )}
          </div>
        </FirmSection>

        {listed && (
          <FirmSection
            id="group-listed"
            icon={UI_ICONS.search}
            title={tg("listed")}
            description={tg("listedText")}
            testId="controlling-listed"
          >
            <SubSection
              id="research"
              title={tk("research")}
              description={t("researchIntro")}
              badge={<Chip>{t("sections.researchSummary", { done: researchDone, total: research.length })}</Chip>}
            >
              <ResearchTree listed={listed} />
            </SubSection>
            <SubSection
              id="growth"
              title={t("sections.growth")}
              description={t("sub.growth")}
              badge={
                <Chip>
                  {t("sections.growthSummary", {
                    count: owned(["product", "region", "machine", "acquisition", "licence"]),
                  })}
                </Chip>
              }
            >
              <div className="grid items-start gap-5 *:min-w-0 lg:grid-cols-2">
                {(["product", "region", "machine", "acquisition", "licence"] as const).map((kind) => (
                  <div key={kind} className="space-y-2">
                    <div>
                      <p className="font-semibold text-fg-1">{tk(kind)}</p>
                      <p className="text-xs text-pretty text-fg-3">{t(`kindHints.${kind}`)}</p>
                    </div>
                    <ItemList listed={listed} kinds={[kind]} />
                  </div>
                ))}
              </div>
            </SubSection>
          </FirmSection>
        )}

        <FirmSection id="group-brand" icon={UI_ICONS.art} title={tg("brand")} description={tg("brandText")} columns={2}>
          <SubSection id="brand" title={t("sections.brand")} description={t("sections.brandSummary")}>
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
          </SubSection>
          {/* Closing the company stays plainly visible, not folded away (ADR-147). */}
          <div id="section-company" className="scroll-mt-32">
            <DangerZone company={company} />
          </div>
        </FirmSection>
      </div>
    </div>
  );
}
