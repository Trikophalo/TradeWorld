import { z } from "zod";
import type { CompanyInterviewState, GameEngine } from "./types";
import { rpc } from "./rpc";

/*
 * CEO interviews of NEXA Nachrichten (ADR-173) against the server.
 */
const stateSchema = z.object({
  max_chars: z.number(),
  interview: z
    .object({
      id: z.number(),
      status: z.enum(["requested", "answered", "declined", "expired"]),
      company: z.string(),
      requested_at: z.string(),
      expires_at: z.string(),
      answered_at: z.string().nullable(),
      aired_at: z.string().nullable(),
      questions: z.array(z.object({ text: z.string(), quick: z.array(z.string()) })),
      answers: z
        .array(
          z.object({
            text: z
              .string()
              .nullable()
              .transform((v) => v ?? ""),
            verdict: z.enum(["good", "ok", "bad", "none"]).catch("ok"),
            reaction: z
              .string()
              .nullable()
              .transform((v) => v ?? ""),
          }),
        )
        .nullable(),
      awareness_bps: z.number(),
      reputation: z.number(),
    })
    .nullable(),
});

export const INTERVIEW_RPC_SCHEMAS = {
  get_company_interview: stateSchema,
  answer_company_interview: stateSchema,
  decline_company_interview: stateSchema,
} as const;

function toState(r: z.infer<typeof stateSchema>): CompanyInterviewState {
  const i = r.interview;
  return {
    maxChars: r.max_chars,
    interview: i && {
      id: i.id,
      status: i.status,
      company: i.company,
      requestedAt: i.requested_at,
      expiresAt: i.expires_at,
      answeredAt: i.answered_at,
      airedAt: i.aired_at,
      questions: i.questions,
      answers: i.answers,
      awarenessBps: i.awareness_bps,
      reputation: i.reputation,
    },
  };
}

export const liveInterviewEngine: Pick<
  GameEngine,
  "companyInterview" | "answerCompanyInterview" | "declineCompanyInterview"
> = {
  async companyInterview() {
    return toState(await rpc("get_company_interview", {}, stateSchema));
  },
  async answerCompanyInterview(requestId, id, answers) {
    return toState(
      await rpc(
        "answer_company_interview",
        { p_request_id: requestId, p_interview_id: id, p_answers: answers },
        stateSchema,
      ),
    );
  },
  async declineCompanyInterview(requestId, id) {
    return toState(
      await rpc("decline_company_interview", { p_request_id: requestId, p_interview_id: id }, stateSchema),
    );
  },
};
