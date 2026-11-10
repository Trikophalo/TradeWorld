import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

const MISSIONS = [
  { key: "missionTrade", xp: 200 },
  { key: "missionVault", xp: 200 },
  { key: "missionWatch", xp: 300 },
] as const;

/** Compact list of today's three missions. Static examples until M2. */
export function MissionsCard() {
  const t = useTranslations("home");
  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>{t("missions")}</CardTitle>
        <span className="nums text-sm text-fg-3">0 / {MISSIONS.length}</span>
      </CardHeader>
      <ul className="space-y-2.5">
        {MISSIONS.map((mission) => (
          <li key={mission.key} className="flex items-center gap-3">
            <span aria-hidden className="size-4 shrink-0 border-2 border-line-2" />
            <span className="flex-1 text-fg-1">{t(mission.key)}</span>
            <Badge tone="accent">{t("missionReward", { xp: mission.xp })}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
