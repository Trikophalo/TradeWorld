"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FigureBubble } from "@/components/ui/figure-bubble";
import type { NewsShowAudienceMember, NewsShowChatMessage } from "@/features/game/types";
import { bubblesAt, stageAudience } from "./audience";
import { AudienceStage } from "./audience-stage";

/*
 * The studio audience on /dev/ui (ADR-157): me, two friends, a stranger and made-up viewers, with up to three
 * bubbles at once on their lanes, and the reusable FigureBubble. The buttons pick a moment; nothing runs on a timer.
 */

const NOW = Date.parse("2026-11-15T18:01:00Z");
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

const AUDIENCE: NewsShowAudienceMember[] = [
  { nickname: "Zuschauerin", avatarKey: "coder", accessories: ["party_hat"], friend: false, me: true },
  { nickname: "Anna", avatarKey: "seller", accessories: ["cowboy_hat"], friend: true, me: false },
  { nickname: "Ben", avatarKey: "punk", accessories: [], friend: true, me: false },
  { nickname: "Dax_Dieter", avatarKey: "banker", accessories: [], friend: false, me: false },
];

const CHAT: NewsShowChatMessage[] = [
  {
    id: 1,
    nickname: "Jürgen Kowalski",
    body: "Wer hat diesem Mann ein Mikrofon gegeben?? 😤",
    at: at(50),
    mine: false,
    bot: true,
  },
  { id: 2, nickname: "Chantal Schröder", body: "Ich liebe ihn 😍", at: at(40), mine: false, bot: true },
  { id: 3, nickname: "Uschi Hoppenstedt", body: "Der Schnurrbart lügt.", at: at(30), mine: false, bot: true },
  { id: 4, nickname: "Anna", body: "Haha, Dax_Dieter ist im Fernsehen 😂", at: at(3), mine: false, bot: false },
  { id: 5, nickname: "Zuschauerin", body: "Hallo Leute, was für eine Show 🍿", at: at(2), mine: true, bot: false },
  {
    id: 6,
    nickname: "Jürgen Kowalski",
    body: "Unverschämtheit! Ich schreibe einen Leserbrief, und zwar einen langen, mit Durchschlag!!",
    at: at(1),
    mine: false,
    bot: true,
  },
];

const MOMENTS = [
  { label: "Zwei Blasen", now: NOW },
  { label: "Eine Blase", now: NOW + 5_000 },
  { label: "Still", now: NOW + 60_000 },
] as const;

export function NewsAudienceDemo() {
  const [moment, setMoment] = useState(0);
  const now = MOMENTS[moment]!.now;
  const crowd = stageAudience(AUDIENCE, CHAT, 9, now);
  const bubbles = bubblesAt(CHAT, new Set(crowd.figures.map((f) => f.nickname)), now);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap gap-2 p-3">
          {MOMENTS.map((m, i) => (
            <Button
              key={m.label}
              size="sm"
              variant={i === moment ? "primary" : "secondary"}
              onClick={() => setMoment(i)}
            >
              {m.label}
            </Button>
          ))}
        </div>
        <AudienceStage figures={crowd.figures} hidden={crowd.hidden} bubbles={bubbles} watching={9 + crowd.bots} live />
      </Card>
      <Card className="flex items-end justify-center gap-6 pt-24">
        <FigureBubble
          avatarKey="seller"
          accessories={["cowboy_hat"]}
          bubble={moment === 2 ? null : { key: moment, text: "Figur mit Sprechblase", author: "Anna" }}
          align="start"
          bubbleWidth={150}
        />
        <FigureBubble avatarKey="punk" scale={2} />
      </Card>
    </div>
  );
}
