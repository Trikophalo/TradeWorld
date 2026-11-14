import { z } from "zod";
import type { CompanyPitches, GameEngine } from "./types";
import { rpc } from "./rpc";

/*
 * Own strategies judged by Claude or the Mini-KI (ADR-132) against the server.
 */
const pitchesSchema = z.object({
  event_id: z.string().nullable(),
  event_cost_cents: z
    .number()
    .nullable()
    .transform((v) => v ?? 0),
  move_cost_cents: z
    .number()
    .nullable()
    .transform((v) => v ?? 0),
  pitches: z.array(
    z.object({
      id: z.number(),
      kind: z.enum(["event", "move"]),
      move_kind: z.enum(["cash", "awareness", "quality"]).nullable(),
      event_id: z.string().nullable(),
      text: z.string(),
      status: z.enum(["judging", "running", "success", "failure", "backfire"]),
      judge: z.enum(["claude", "mini"]).nullable(),
      fit: z.number().nullable(),
      backfire: z.number().nullable(),
      chance_bps: z.number().nullable(),
      verdict: z.string().nullable(),
      success_text: z.string().nullable(),
      failure_text: z.string().nullable(),
      backfire_text: z.string().nullable(),
      cost_cents: z.number(),
      result_cents: z.number(),
      created_at: z.string(),
      ends_at: z.string().nullable(),
      resolved_at: z.string().nullable(),
    }),
  ),
});

export const PITCH_RPC_SCHEMAS = {
  get_company_pitches: pitchesSchema,
  submit_company_pitch: pitchesSchema,
} as const;

const toPitches = (r: z.infer<typeof pitchesSchema>): CompanyPitches => ({
  eventId: r.event_id,
  eventCostCents: r.event_cost_cents,
  moveCostCents: r.move_cost_cents,
  pitches: r.pitches.map((p) => ({
    id: p.id,
    kind: p.kind,
    moveKind: p.move_kind,
    eventId: p.event_id,
    text: p.text,
    status: p.status,
    judge: p.judge,
    fit: p.fit,
    backfire: p.backfire,
    chanceBps: p.chance_bps,
    verdict: p.verdict,
    successText: p.success_text,
    failureText: p.failure_text,
    backfireText: p.backfire_text,
    costCents: p.cost_cents,
    resultCents: p.result_cents,
    createdAt: p.created_at,
    endsAt: p.ends_at,
    resolvedAt: p.resolved_at,
  })),
});

export const livePitchEngine: Pick<GameEngine, "companyPitches" | "submitCompanyPitch"> = {
  async companyPitches() {
    return toPitches(await rpc("get_company_pitches", {}, pitchesSchema));
  },
  async submitCompanyPitch(requestId, kind, text, moveKind) {
    return toPitches(
      await rpc(
        "submit_company_pitch",
        { p_request_id: requestId, p_kind: kind, p_text: text, p_move_kind: moveKind },
        pitchesSchema,
      ),
    );
  },
};
