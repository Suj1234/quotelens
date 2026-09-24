import type { Metadata } from "next";
import Link from "next/link";
import { Doc, type Section } from "../doc";
import s from "../doc.module.css";

export const metadata: Metadata = { title: "Terms of use · QuoteLens" };

const SECTIONS: Section[] = [
  {
    id: "agreement", title: "About these terms",
    body: <>
      <p>These terms govern your use of QuoteLens, the sourcing workspace operated by <b>Meridian Foods Pvt Ltd</b> (&ldquo;Meridian Foods&rdquo;). By signing in you agree to them. They sit alongside your employment terms, the Meridian Foods Information Security Policy and the Procurement Policy; where these terms and the Procurement Policy differ on how a purchase must be approved, the Procurement Policy wins.</p>
      <p>Section 6 applies to suppliers who send quotations to the QuoteLens mailbox, even though suppliers never sign in.</p>
    </>,
  },
  {
    id: "definitions", title: "Words we use",
    body: <table>
      <thead><tr><th>Term</th><th>Meaning</th></tr></thead>
      <tbody>
        <tr><td><b>RFx</b></td><td>A request for quotation, proposal or information issued to suppliers, identified by a code such as <span className="mono">MER-0419</span>.</td></tr>
        <tr><td><b>Response</b></td><td>Everything a supplier sends back for an RFx: email text and every attached file.</td></tr>
        <tr><td><b>Comparison</b></td><td>The grid of normalised prices per RFx line and supplier.</td></tr>
        <tr><td><b>Review item</b></td><td>A number, match or answer QuoteLens is not sure about, which waits for a person to decide.</td></tr>
        <tr><td><b>Scenario</b></td><td>A saved allocation of lines to suppliers with its total cost.</td></tr>
        <tr><td><b>Award memo</b></td><td>The document that records a proposed award and its approval.</td></tr>
        <tr><td><b>Buyer / Approver</b></td><td>The role on your account: buyers run events and clear reviews; approvers ask questions and approve awards.</td></tr>
      </tbody>
    </table>,
  },
  {
    id: "access", title: "Accounts and access",
    body: <>
      <ul>
        <li>Accounts are issued by Meridian Foods IT to named staff only. You must not share your password or let anyone else use your session.</li>
        <li>Your role decides what you can do. Buyers cannot approve their own awards; approvers cannot change prices or clear review items.</li>
        <li>Tell IT Service Desk at once if you think someone else has used your account.</li>
        <li>Access ends when you leave Meridian Foods or move to a role that does not need it. Your audit entries stay with the RFx they belong to.</li>
      </ul>
    </>,
  },
  {
    id: "use", title: "Acceptable use",
    body: <>
      <p>Use QuoteLens only for Meridian Foods sourcing work. You must not:</p>
      <ul>
        <li>send a supplier another supplier&rsquo;s prices, or anything from the comparison, before the award is announced;</li>
        <li>change a price, unit or match without recording the reason QuoteLens asks for;</li>
        <li>upload files that are not supplier submissions or RFx material, or that you do not have the right to share;</li>
        <li>try to reach data from RFx you are not working on, bypass the read-only limits of the Ask panel, or probe the service for weaknesses;</li>
        <li>export comparisons to personal devices or accounts.</li>
      </ul>
      <p>Breaches may lead to suspension of access and action under the Meridian Foods Code of Conduct.</p>
    </>,
  },
  {
    id: "data", title: "Your data and ours",
    body: <>
      <p>All RFx content, supplier responses, comparisons, scenarios and memos belong to Meridian Foods and are <b>Confidential Information</b>. You may use them only for the RFx they relate to and for reporting within Meridian Foods.</p>
      <p>How personal data is handled is described in the <Link href="/privacy">Privacy notice</Link>.</p>
    </>,
  },
  {
    id: "suppliers", title: "Terms for suppliers",
    body: <>
      <p>If you reply to a Meridian Foods RFx sent from QuoteLens:</p>
      <ul>
        <li>Your quotation is read automatically and compared with other suppliers&rsquo;. Prices are converted to the RFx unit and currency. The conversion used is recorded, and we may ask you to confirm it.</li>
        <li>Quote the RFx code in the subject line and reply to the address the RFx came from, so your response is matched to the right event.</li>
        <li>The price, validity, freight and payment terms in your quotation are what we evaluate. If your quotation refers to earlier pricing instead of stating a price, that line will be treated as not quoted until you confirm the figure.</li>
        <li>Sending a quotation does not create a contract. A purchase order or signed supply agreement does.</li>
        <li>Meridian Foods may reject any response, split an award across suppliers, or cancel an RFx without giving a reason.</li>
        <li>We keep your submission confidential and never share your prices with other suppliers.</li>
      </ul>
    </>,
  },
  {
    id: "ai", title: "Automated reading and your judgement",
    body: <>
      <p>QuoteLens uses AI models to read documents and suggest matches. These suggestions can be wrong. For that reason:</p>
      <ul>
        <li>every number shows its source and its conversion, and uncertain cells are marked and left out of totals until someone decides;</li>
        <li>you are responsible for checking the cells, matches and answers you rely on, and for the reasons you record;</li>
        <li>answers in the Ask panel show the query they ran. If an answer looks wrong, check the query and the cells behind it before you use it;</li>
        <li>no award is final until a named approver approves the memo.</li>
      </ul>
      <p className={s.note}>QuoteLens helps you compare. It does not replace the checks the Procurement Policy requires before an award.</p>
    </>,
  },
  {
    id: "records", title: "Records and audit",
    body: <p>QuoteLens records who confirmed, overrode, excluded or approved what, and when. These records form part of the procurement file and may be reviewed by Internal Audit, statutory auditors and the Audit Committee. Once an RFx is approved it is locked; later corrections are made by reopening the event through Procurement, which is itself recorded.</p>,
  },
  {
    id: "availability", title: "Availability and changes",
    body: <>
      <p>We aim to keep QuoteLens available during business hours (Monday to Saturday, 08:00–20:00 IST). Planned maintenance is announced at least 2 working days ahead and scheduled outside those hours where possible.</p>
      <p>We may change features, supported file types or model providers at any time. If a change affects how prices are read or compared, we will record it in the release notes and re-run our accuracy checks before it goes live.</p>
    </>,
  },
  {
    id: "ip", title: "Intellectual property",
    body: <p>The QuoteLens software, its design and documentation belong to Meridian Foods or its licensors. You may not copy, modify, reverse-engineer or distribute them. Suppliers keep ownership of their documents and give Meridian Foods the right to store, read and use them to evaluate their RFx responses and administer any resulting contract.</p>,
  },
  {
    id: "liability", title: "Liability",
    body: <>
      <p>QuoteLens is provided to staff as an internal tool &ldquo;as is&rdquo;. To the extent permitted by law, Meridian Foods is not liable to suppliers for any loss arising from how a response was read, matched or evaluated, including loss of an award, except where caused by our wilful misconduct or fraud.</p>
      <p>Nothing in these terms limits liability that cannot be limited under Indian law.</p>
    </>,
  },
  {
    id: "suspension", title: "Suspension and termination",
    body: <p>Meridian Foods may suspend or withdraw access at any time, including to protect the security of the service or during an investigation. Sections 5, 6, 8, 10 and 11 continue to apply after access ends.</p>,
  },
  {
    id: "law", title: "Governing law",
    body: <p>These terms are governed by the laws of India. The courts at Mumbai, Maharashtra have exclusive jurisdiction over any dispute arising from them.</p>,
  },
  {
    id: "updates", title: "Updates to these terms",
    body: <p>We may update these terms. The date at the top shows the current version. If you keep using QuoteLens after an update, you accept the new terms. Significant changes will be announced to staff by email in advance.</p>,
  },
  {
    id: "contact", title: "Contact",
    body: <dl className={s.contact}>
      <dt>Questions about these terms</dt><dd>legal@meridianfoods.in</dd>
      <dt>Procurement Policy</dt><dd>procurement.office@meridianfoods.in</dd>
      <dt>Access and accounts</dt><dd>IT Service Desk, ext. 4400 · itsupport@meridianfoods.in</dd>
      <dt>Using QuoteLens</dt><dd><Link href="/help">Help</Link></dd>
    </dl>,
  },
];

export default function TermsPage() {
  return (
    <Doc
      eyebrow="Legal"
      title="Terms of use"
      updated="25 September 2026"
      intro={<>
        <p>These terms set out how Meridian Foods staff may use QuoteLens and what suppliers can expect when they send us a quotation.</p>
        <p>In short: QuoteLens is for Meridian Foods sourcing work only, supplier prices stay confidential, the software suggests but people decide, and every decision is recorded.</p>
      </>}
      sections={SECTIONS}
    />
  );
}
