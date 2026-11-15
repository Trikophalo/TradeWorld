import { z } from "zod";
import type { GameEngine, NewsShowChatMessage, NewsShowFigure, NewsShowState } from "./types";
import { rpc } from "./rpc";

/*
 * NEXA Nachrichten (ADR-150): the hourly live show and its chat, against the server.
 */
const chatSchema = z.array(
  z.object({
    id: z.number(),
    nickname: z.string(),
    body: z.string(),
    at: z.string(),
    mine: z.boolean(),
    bot: z.boolean().default(false),
  }),
);
const figureSchema = z.object({
  nickname: z.string(),
  avatar_key: z.string().nullable(),
  accessories: z.array(z.string()).default([]),
});
const showSchema = z.object({
  now: z.string(),
  next_airs_at: z.string(),
  viewers: z.number(),
  audience: z.array(figureSchema.extend({ friend: z.boolean(), me: z.boolean() })).default([]),
  upcoming: z.object({ id: z.number(), airs_at: z.string(), needs_script: z.boolean() }).nullable(),
  show: z
    .object({
      id: z.number(),
      airs_at: z.string(),
      started_at: z.string(),
      writer: z.enum(["mini", "claude"]),
      segments: z.array(
        z.object({
          kind: z.string(),
          mood: z
            .enum(["neutral", "shocked", "crying", "laughing", "angry", "smug", "confused", "proud"])
            .optional()
            .catch(undefined),
          headline: z.string(),
          text: z.string(),
          effects: z
            .array(z.object({ label: z.string(), tone: z.enum(["gain", "loss", "neutral"]).catch("neutral") }))
            .default([]),
          figure: figureSchema.nullish().catch(null),
        }),
      ),
    })
    .nullable(),
  chat: chatSchema,
});
const postSchema = z.object({ chat: chatSchema });

export const NEWS_SHOW_RPC_SCHEMAS = {
  get_news_show: showSchema,
  post_news_show_message: postSchema,
} as const;

const toChat = (rows: z.infer<typeof chatSchema>): NewsShowChatMessage[] => rows;
const toFigure = (f: z.infer<typeof figureSchema>): NewsShowFigure => ({
  nickname: f.nickname,
  avatarKey: f.avatar_key,
  accessories: f.accessories,
});

export const liveNewsShowEngine: Pick<GameEngine, "newsShow" | "postNewsShowMessage"> = {
  async newsShow(): Promise<NewsShowState> {
    const r = await rpc("get_news_show", {}, showSchema);
    return {
      now: r.now,
      nextAirsAt: r.next_airs_at,
      viewers: r.viewers,
      audience: r.audience.map((a) => ({ ...toFigure(a), friend: a.friend, me: a.me })),
      upcoming: r.upcoming && { id: r.upcoming.id, airsAt: r.upcoming.airs_at, needsScript: r.upcoming.needs_script },
      show: r.show && {
        id: r.show.id,
        airsAt: r.show.airs_at,
        startedAt: r.show.started_at,
        writer: r.show.writer,
        segments: r.show.segments.map(({ figure, ...segment }) =>
          figure ? { ...segment, figure: toFigure(figure) } : segment,
        ),
      },
      chat: toChat(r.chat),
    };
  },
  async postNewsShowMessage(requestId, body) {
    return toChat((await rpc("post_news_show_message", { p_request_id: requestId, p_body: body }, postSchema)).chat);
  },
};
