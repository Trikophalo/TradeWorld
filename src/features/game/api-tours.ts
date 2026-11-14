import { z } from "zod";
import type { GameEngine } from "./types";
import { rpc } from "./rpc";

/*
 * Finn's tours seen by the player, remembered on the server so a private window or a second device does not start
 * them again.
 */
const toursSchema = z.object({ tours: z.array(z.string()) });

export const TOUR_RPC_SCHEMAS = {
  get_seen_tours: toursSchema,
  mark_tour_seen: toursSchema,
} as const;

export const liveTourEngine: Pick<GameEngine, "seenTours" | "markTourSeen"> = {
  async seenTours() {
    return (await rpc("get_seen_tours", {}, toursSchema)).tours;
  },
  async markTourSeen(requestId, tour) {
    return (await rpc("mark_tour_seen", { p_request_id: requestId, p_tour: tour }, toursSchema)).tours;
  },
};
