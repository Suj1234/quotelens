import { requireUser } from "@/lib/auth";

export default async function RfxListPage() {
  const user = await requireUser();
  return (
    <main style={{ padding: "22px 28px" }}>
      <h1>RFx</h1>
      <p className="lead" style={{ marginTop: 8 }}>Signed in as {user.name}.</p>
    </main>
  );
}
