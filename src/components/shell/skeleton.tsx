/** Route-level loading state (Next loading.tsx): the shape of the page, no spinner, no layout jump (DESIGN §2.16). */
export function PageSkeleton({ title = true, cards = 1, rows = 6 }: { title?: boolean; cards?: number; rows?: number }) {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      {title && <><div className="skel" style={{ width: 180, height: 22 }} /><div className="skel" style={{ width: 360, height: 13, marginTop: 10 }} /></>}
      {Array.from({ length: cards }, (_, c) => (
        <div className="card" key={c} style={{ marginTop: 18 }}>
          <div className="hd"><div className="skel" style={{ width: 140, height: 13 }} /></div>
          <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Array.from({ length: rows }, (_, r) => <div className="skel" key={r} style={{ height: 13, width: `${92 - ((r * 17) % 30)}%` }} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
