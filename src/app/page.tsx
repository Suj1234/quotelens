import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { SignInForm } from "@/components/auth/sign-in-form";
import s from "./signin.module.css";

const icon = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6 };

const STEPS = [
  { title: "Send", text: "Draft the RFx with a co-pilot and email it to your vendors.", svg: <svg {...icon}><path d="M4 6h16v12H4z" /><path d="M4 7l8 6 8-6" /></svg> },
  { title: "Receive", text: "Excel, PDF, Word, a photo or a plain email — nothing is retyped.", svg: <svg {...icon}><path d="M6 3h9l5 5v13H6z" /><path d="M14 3v6h6" /><path d="M9 13h7M9 17h7" /></svg> },
  { title: "Compare", text: "Same units, same currency, side by side. Unsure cells are marked, not hidden.", svg: <svg {...icon}><path d="M3 5h18v14H3z" /><path d="M3 10h18M9 10v9M15 10v9" /></svg> },
  { title: "Award", text: "Ask questions in plain language and approve a memo you can defend.", svg: <svg {...icon}><path d="M5 12l4 4L19 6" /></svg> },
];

export default async function SignInPage() {
  if (await currentUser()) redirect("/rfx");
  return (
    <div className={s.signin}>
      <div className={s.visual}>
        <div className={s.vis}>
          <div className="brand" style={{ fontSize: 15 }}><span className="brand-mark" />QuoteLens</div>
          <h1>Compare vendor quotes without retyping a single number.</h1>
          <p className="lead" style={{ marginTop: 12 }}>Send an RFx, receive quotes in any format, and get one comparison where every price shows where it came from.</p>
          <div className={s.steps}>
            {STEPS.map((st) => (
              <div key={st.title} className={s.step}><div className={s.ico}>{st.svg}</div><b>{st.title}</b><span>{st.text}</span></div>
            ))}
          </div>
          {/* Illustrative sample (not data) — same as design/prototype.html */}
          <div className={s.mini} aria-hidden>
            <div className={`${s.row} ${s.head}`}><span>Line</span><span>Vendor A</span><span>Vendor B</span><span>Vendor C</span></div>
            <div className={s.row}><span>Shipper carton 5-ply</span><span className="mono">38,240</span><span className={`mono ${s.min}`}>36,892</span><span className="mono">38,680</span></div>
            <div className={s.row}><span>Inner carton 3-ply</span><span className={`mono ${s.min}`}>7,140</span><span className="mono">7,415</span><span className={s.amb}>needs a look</span></div>
            <div className={s.row}><span>Corrugated sheet</span><span className="mono">38,610</span><span className={s.nq}>not quoted</span><span className={`mono ${s.min}`}>37,300</span></div>
            <div className={s.cap}>Lowest price marked on every line · missing and uncertain quotes stay visible</div>
          </div>
          <p className="hint" style={{ marginTop: "auto" }}>Meridian Foods Pvt Ltd · Sourcing</p>
        </div>
      </div>
      <div className={s.form}>
        <div>
          <div className={`brand ${s.mbrand}`} style={{ fontSize: 15 }}><span className="brand-mark" />QuoteLens</div>
          <SignInForm />
        </div>
        <p className="hint">Private to Meridian Foods. Vendors never sign in here.</p>
      </div>
    </div>
  );
}
