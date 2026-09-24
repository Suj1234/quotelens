import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getDraft } from "@/lib/rfx-draft";
import { NewRfx } from "@/components/rfx-new/new-rfx";

// DESIGN §3.3 / TRD §17.3. Buyer only (DESIGN §4): the approver is sent back to the RFx list.
export default async function NewRfxPage({ searchParams }: PageProps<"/rfx/new">) {
  const user = await requireUser(["buyer", "admin"]);
  const id = (await searchParams).id;
  const draft = typeof id === "string" ? await getDraft(id) : null;
  if (draft && (draft.rfx.status !== "draft" || draft.rfx.version !== 0)) redirect(`/rfx/${draft.rfx.id}`);
  return <NewRfx key={draft?.rfx.id ?? "new"} initial={draft} buyerName={user.name.split(" ")[0]} />;
}
