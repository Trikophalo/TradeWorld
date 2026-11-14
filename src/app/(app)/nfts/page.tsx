import { redirect } from "next/navigation";

/** /nfts is the name players know (ADR-135); the tab itself still lives at /artworks. */
export default function NftsPage() {
  redirect("/artworks");
}
