import { redirect } from "next/navigation";

// Overview (DESIGN §3.4) lands in P5; until then an RFx opens on its responses.
export default async function RfxIndex({ params }: PageProps<"/rfx/[id]">) {
  redirect(`/rfx/${(await params).id}/responses`);
}
