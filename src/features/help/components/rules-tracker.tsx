"use client";

import { useEffect } from "react";
import { useGame } from "@/features/game/store";

/** Reading the rules counts for a quick mission. */
export function RulesTracker() {
  const track = useGame((state) => state.track);
  useEffect(() => track("open_rules"), [track]);
  return null;
}
