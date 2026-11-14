"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useMyCompany } from "../hooks";
import { CompanyChat } from "./company-chat";

/** The chat on its own page: back (button or Escape) leads to the own company, for employees to the job. */
export function ChatPageBody() {
  const router = useRouter();
  const company = useMyCompany();
  const founder = Boolean(company.data?.company);
  const back = useCallback(() => router.push(founder ? "/company" : "/career"), [router, founder]);
  return <CompanyChat className="mx-auto max-w-2xl" onBack={back} />;
}
