import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { NO_RULES } from "@/lib/line-rules";
import { CATEGORY, getDraft, openingLine } from "@/lib/rfx-draft";
import { getSetting } from "@/lib/settings";
import { NewRfx } from "@/components/rfx-new/new-rfx";

// DESIGN §3.3 / TRD §17.3, chat-first since P9 B. Buyer only (DESIGN §4): the approver is sent back to the RFx list.
export default async function NewRfxPage({ searchParams }: PageProps<"/rfx/new">) {
  const user = await requireUser(["buyer", "admin"]);
  const id = (await searchParams).id;
  const draft = typeof id === "string" ? await getDraft(id) : null;
  if (draft && (draft.rfx.status !== "draft" || draft.rfx.version !== 0)) redirect(`/rfx/${draft.rfx.id}`);
  const first = user.name.split(" ")[0];
  const template = (await getSetting("category_templates"))[CATEGORY]; // Settings → Masters
  return <NewRfx key={draft?.rfx.id ?? "new"} initial={draft} buyerName={first} opening={openingLine(first)} category={CATEGORY}
    rules={template?.line_rules ?? NO_RULES} standard={template?.standard_terms ?? null} />;
}
