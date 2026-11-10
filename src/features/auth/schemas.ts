import { z } from "zod";

/** Error messages are keys in messages/*.json under "auth". */
export const loginSchema = z.object({
  email: z.email("errorEmail"),
  password: z.string().min(1, "errorPassword"),
});

export const registerSchema = z.object({
  displayName: z.string().regex(/^[A-Za-z0-9_ÄÖÜäöüß]{3,20}$/, "errorDisplayName"),
  email: z.email("errorEmail"),
  password: z.string().min(10, "errorPassword"),
  inviteCode: z.string().trim().min(4, "errorInvite"),
  ageConfirmed: z.literal(true, "errorAge"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

/** First error message per field. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    result[key] ??= issue.message;
  }
  return result;
}
