import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

// Overview (DESIGN §3.4) lands in P5, Decide (§3.8) in P7; until then the buyer opens on Responses, the approver on Comparison.
export default async function RfxIndex({ params }: PageProps<"/rfx/[id]">) {
  const user = await requireUser();
  redirect(`/rfx/${(await params).id}/${user.role === "approver" ? "comparison" : "responses"}`);
}
