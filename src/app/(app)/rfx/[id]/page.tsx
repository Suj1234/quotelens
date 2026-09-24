import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

// DESIGN §4: the buyer opens on Overview (§3.4); the approver on Decide (§3.8).
export default async function RfxIndex({ params }: PageProps<"/rfx/[id]">) {
  const user = await requireUser();
  redirect(`/rfx/${(await params).id}/${user.role === "approver" ? "decide" : "overview"}`);
}
