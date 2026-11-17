"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListedCompany } from "@/features/game/listed-types";
import { engine } from "@/features/game/store";
import type { MyCompany } from "@/features/game/types";
import { AwarenessBreakdown } from "../../awareness/awareness-breakdown";
import { ItemList, ResearchTree } from "../../listed/catalogue";
import { DividendCard, RestrictionNotes, UpkeepSummary } from "../../listed/controlling-panels";
import { money } from "../../listed/shared";
import type { CompanyTarget } from "../../tabs";
import { COMPANY_MOVES_KEY, CompanyMovesCard } from "../company-moves";
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
import { FirmSection, FoldBlock, MergedCard, SectionNav, SubSection, type Pane } from "../firm-layout";
import { Reveal } from "@/features/progression/components/reveal";
import { CompanySkillsCard } from "../company-skills";
import { GrowthAndExpansion } from "../growth-expansion";
import { ListingCard } from "../listing";
import { PitchCard } from "../pitch-card";
import { ProductionCard } from "../production";
import { PayoutCard, ProfitCoach, StrategyCard } from "../profit";
import { CampaignCard, ProfitRoutes } from "../routes";

/** A small grey chip with the current state of a block (budget, cash, research done …). */
function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-pill bg-surface-2 px-2 py-0.5 nums text-2xs font-normal text-fg-3">{children}</span>;
}

/** Two columns from lg: the cards of a pane side by side instead of one long stack. */
function Cols({ children }: { children: React.ReactNode }) {
  return <div className="grid items-start gap-4 *:min-w-0 lg:grid-cols-2">{children}</div>;
}
function Col({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}

const KINDS = ["product", "region", "machine", "acquisition", "licence"] as const;

/**
 * Every lever of the company (ADR-167; merged cards since ADR-187): five cards instead of fifteen stacked blocks,
 * each with a switch between its parts. Angebot & Produktion (prices and strategy, production), Marketing (budget and
 * campaigns, business moves), Geld (till and payout, capital, dividends), Wachstum (expansion, research, catalogue),
 * Marke & Firma. The old section ids are the panes, so every link opens the right one.
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
  const tw = useTranslations("hq.where.places");
  const tgr = useTranslations("hq.groupCards");
  const tl = useTranslations("logo");
  const tb = useTranslations("banner");
  const tk = useTranslations("listed.kinds");
  const tg = useTranslations("hq.controlling.groups");
  const tf = useTranslations("hq.folds");
  const moves = useQuery({
    queryKey: COMPANY_MOVES_KEY,
    queryFn: () => engine.companyMoves(),
    refetchInterval: 20_000,
  });
  const trainingOpen = company.employees + company.aiWorkers >= company.trainingFrom;
  const toStaff = () => go({ tab: "staff", section: "staff-team" });
  const toCampaign = () => go({ tab: "controlling", section: "marketing", target: "campaign" });
  const logoLocked = company.logo !== null && !company.logoHidden;
  const isListed = company.listing?.status === "listed";
  const research = listed?.items.filter((i) => i.kind === "research") ?? [];
  const researchDone = research.filter((i) => i.status === "active").length;
  const owned = (kinds: readonly string[]) =>
    listed?.items.filter((i) => kinds.includes(i.kind) && (i.status === "active" || i.status === "paused")).length ?? 0;

  const groups = [
    { id: "group-offer", icon: UI_ICONS.star },
    { id: "group-marketing", icon: UI_ICONS.news },
    { id: "group-money", icon: UI_ICONS.portfolio },
    { id: "group-growth", icon: UI_ICONS.briefcase },
    { id: "group-brand", icon: UI_ICONS.art },
  ] as const;

  const offer: Pane[] = [
    {
      id: "profit",
      label: tw("profit"),
      description: t("sub.profit"),
      badge: <Chip>{t(`sub.level.${company.priceLevel}`)}</Chip>,
      content: (
        <Cols>
          <Col>
            {listed && <RestrictionNotes restrictions={listed.restrictions} only={["price"]} />}
            <StrategyCard company={company} />
          </Col>
          <Col>
            <MarketCard company={company} />
            <ProfitCoach
              company={company}
              onNavigate={(to) => {
                if (to === "team") return toStaff();
                go({ tab: "controlling", section: "marketing", target: "company-controls" });
              }}
            />
          </Col>
        </Cols>
      ),
    },
    {
      id: "business",
      label: tw("business"),
      description: t("sub.business"),
      content: (
        <Cols>
          <ProductionCard company={company} onTeam={toStaff} onCampaign={toCampaign} />
          <Col>
            <ProfitRoutes company={company} />
            <StaffLink company={company} onTeam={toStaff} />
          </Col>
        </Cols>
      ),
    },
  ];

  const marketing: Pane[] = [
    {
      id: "marketing",
      label: tw("marketing"),
      description: t("sub.marketing"),
      badge: <Chip>{t("sections.marketingSummary", { amount: money(company.marketingCentsPerQuarter) })}</Chip>,
      content: (
        <Cols>
          <Col>
            <MarketingBudgetCard company={company} />
            {/* Where the awareness stands and where it came from (ADR-188), next to its levers. */}
            <AwarenessBreakdown />
          </Col>
          <CampaignCard company={company} />
        </Cols>
      ),
    },
    {
      id: "moves",
      label: ts("moves"),
      description: t("sub.moves"),
      content: (
        <FoldBlock id="moves" title={ts("moves")} summary={tf("running", { count: moves.data?.running.length ?? 0 })}>
          <div className="space-y-4">
            <CompanyMovesCard />
            <PitchCard kind="move" />
          </div>
        </FoldBlock>
      ),
    },
  ];

  const moneyPanes: Pane[] = [
    {
      id: "money",
      label: tw("money"),
      description: t("sub.money"),
      badge: <Chip>{t("sections.moneySummary", { amount: money(listed?.freeCashCents ?? company.cashCents) })}</Chip>,
      content: (
        <Cols>
          <TreasuryCard
            company={company}
            freeCashCents={listed?.freeCashCents}
            reservedCents={listed?.reservedCents}
            restrictions={listed?.restrictions}
          />
          <Col>
            {listed && <RestrictionNotes restrictions={listed.restrictions} only={["payout"]} />}
            {/* Remounts when the stored share changes, so the slider never shows an unsaved value as saved. */}
            <PayoutCard key={company.founderPayoutBps} company={company} />
            <PayFactorNote company={company} />
          </Col>
        </Cols>
      ),
    },
    {
      id: "capital",
      label: tw("capital"),
      description: t(isListed ? "sections.capitalListed" : "sub.capital"),
      content: (
        <div className="space-y-3">
          <ListingCard company={company} />
          {!company.listing && !company.canGoPublic && (
            <p className="text-sm text-pretty text-fg-3">{t("capitalHint")}</p>
          )}
        </div>
      ),
    },
    ...(listed
      ? [
          {
            id: "dividends",
            label: tw("dividends"),
            description: t("sub.dividends"),
            badge: <Chip>{t("sections.dividendsSummary", { amount: money(listed.dividends.maxCents) })}</Chip>,
            content: <DividendCard listed={listed} />,
          },
        ]
      : []),
  ];

  const growth: Pane[] = [
    {
      id: "expansion",
      label: tw("expansion"),
      description: t("sub.expansion"),
      content: (
        <div className="space-y-4">
          {/* Growth stages and endless expansion as one path (ADR-191); the legal form next to it. */}
          <GrowthAndExpansion
            company={company}
            onFill={(skills) => onHire({ skills })}
            onTrain={trainingOpen ? () => go({ tab: "staff", section: "staff-team", target: "training" }) : undefined}
          />
          <UpgradeCard company={company} />
        </div>
      ),
    },
    // Fertigkeiten (ADR-194): what the company itself gets better at, opened by the skill map
    {
      id: "skills",
      label: tw("skills"),
      description: t("sub.skills"),
      content: (
        <Reveal feature="companySkills">
          <CompanySkillsCard />
        </Reveal>
      ),
    },
    ...(listed
      ? [
          {
            id: "research",
            label: tk("research"),
            description: t("researchIntro"),
            badge: <Chip>{t("sections.researchSummary", { done: researchDone, total: research.length })}</Chip>,
            content: <ResearchTree listed={listed} />,
          },
          {
            id: "growth",
            label: tw("growth"),
            description: t("sub.growth"),
            badge: <Chip>{t("sections.growthSummary", { count: owned(KINDS) })}</Chip>,
            content: <Catalogue listed={listed} />,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6" data-testid="company-controlling">
      {/* In-page navigation (ADR-176, ADR-183): one chip per merged card, in reach while scrolling. */}
      <SectionNav
        items={groups.map((g) => ({ id: g.id, label: tw(g.id), icon: g.icon }))}
        label={tg("nav")}
        testId="controlling-nav"
      />

      {listed && <UpkeepSummary listed={listed} />}
      {listedPending && <Skeleton className="h-48 w-full rounded-lg" />}

      <div className="space-y-6" data-testid="company-overview">
        <MergedCard
          id="group-offer"
          icon={UI_ICONS.star}
          title={tw("group-offer")}
          description={tgr("group-offer")}
          panes={offer}
        />
        <MergedCard
          id="group-marketing"
          icon={UI_ICONS.news}
          title={tw("group-marketing")}
          description={tgr("group-marketing")}
          panes={marketing}
        />
        <MergedCard
          id="group-money"
          icon={UI_ICONS.portfolio}
          title={tw("group-money")}
          description={tgr("group-money")}
          panes={moneyPanes}
        />
        <MergedCard
          id="group-growth"
          icon={UI_ICONS.briefcase}
          title={tw("group-growth")}
          description={tgr("group-growth")}
          panes={growth}
        />

        <FirmSection
          id="group-brand"
          icon={UI_ICONS.art}
          title={tw("group-brand")}
          description={tgr("group-brand")}
          columns={2}
        >
          <SubSection id="brand" title={t("sections.brand")} description={t("sections.brandSummary")}>
            <Card
              padding="md"
              id="brand"
              className="flex scroll-mt-32 flex-wrap items-center gap-3"
              data-testid="brand"
            >
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

/** The growth catalogue: one kind at a time (products, regions, machines, acquisitions, licences). */
function Catalogue({ listed }: { listed: ListedCompany }) {
  const t = useTranslations("hq.controlling");
  const tk = useTranslations("listed.kinds");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("product");
  return (
    <div className="space-y-3">
      <Segmented
        value={kind}
        onValueChange={setKind}
        options={KINDS.map((k) => ({ value: k, label: tk(k) }))}
        label={t("sections.growth")}
        size="sm"
      />
      <p className="text-xs text-pretty text-fg-3">{t(`kindHints.${kind}`)}</p>
      <ItemList listed={listed} kinds={[kind]} />
    </div>
  );
}
