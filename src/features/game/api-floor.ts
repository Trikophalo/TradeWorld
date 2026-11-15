import { z } from "zod";
import type { CompanyFloor, GameEngine } from "./types";
import { rpc } from "./rpc";

/*
 * The company floor (ADR-156): the caller's workplace with every member as a dressed figure and speech bubbles.
 */
const memberSchema = z.object({
  nickname: z.string(),
  avatar_key: z.string(),
  accessories: z.array(z.string()),
  role: z.enum(["founder", "employee"]),
  title: z.string().nullable(),
  online: z.boolean(),
  me: z.boolean(),
  last_message: z.object({ body: z.string(), at: z.string() }).nullable(),
});
const floorSchema = z.object({
  company: z
    .object({
      name: z.string(),
      color: z.string().nullable(),
      kind: z.enum(["player", "ai"]),
      logo: z.object({ palette: z.array(z.string()), grid: z.array(z.string()) }).nullable(),
    })
    .nullable(),
  chat: z.boolean(),
  ai_workers: z.number(),
  bubble_seconds: z.number(),
  members: z.array(memberSchema),
});

export const FLOOR_RPC_SCHEMAS = { get_company_floor: floorSchema } as const;

export function toFloor(r: z.infer<typeof floorSchema>): CompanyFloor {
  return {
    company: r.company,
    chat: r.chat,
    aiWorkers: r.ai_workers,
    bubbleSeconds: r.bubble_seconds,
    members: r.members.map((m) => ({
      nickname: m.nickname,
      avatarKey: m.avatar_key,
      accessories: m.accessories,
      role: m.role,
      title: m.title,
      online: m.online,
      me: m.me,
      lastMessage: m.last_message,
    })),
  };
}

export const liveFloorEngine: Pick<GameEngine, "companyFloor"> = {
  async companyFloor() {
    return toFloor(await rpc("get_company_floor", {}, floorSchema));
  },
};
