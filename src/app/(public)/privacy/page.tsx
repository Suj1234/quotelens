import type { Metadata } from "next";
import Link from "next/link";
import { Doc, type Section } from "../doc";
import s from "../doc.module.css";

export const metadata: Metadata = { title: "Privacy notice · QuoteLens" };

const SECTIONS: Section[] = [
  {
    id: "scope", title: "Who we are and what this notice covers",
    body: <>
      <p>QuoteLens is the internal sourcing workspace of <b>Meridian Foods Pvt Ltd</b> (&ldquo;Meridian Foods&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). Our Sourcing team uses it to write requests for quotation (RFx), send them to suppliers, read the quotations suppliers send back, compare them and record award decisions.</p>
      <p>This notice explains what personal data QuoteLens handles, why, who else processes it for us, how long we keep it and what you can ask us to do. It applies to the QuoteLens web application, the emails it sends and receives, and the files suppliers submit through it. It does not cover other Meridian Foods systems, which have their own notices.</p>
      <p>Meridian Foods is the <b>Data Fiduciary</b> for the personal data described here under the Digital Personal Data Protection Act, 2023 (&ldquo;DPDP Act&rdquo;) and the Information Technology Act, 2000 and rules made under it.</p>
    </>,
  },
  {
    id: "who", title: "Whose data we handle",
    body: <>
      <ul>
        <li><b>Meridian Foods staff</b> who sign in to QuoteLens: category buyers, approvers in Procurement and Finance, and administrators.</li>
        <li><b>Supplier contacts</b>: people at vendor companies who receive our RFx emails, reply with quotations, or are named in the documents they send (sales managers, signatories, accounts contacts).</li>
        <li><b>People mentioned in documents</b>: for example, a name on a certificate, a signature on a quotation, or a phone number in an email signature.</li>
      </ul>
      <p>Suppliers never sign in to QuoteLens. Everything we hold about a supplier contact arrives by email or as a file they choose to send us.</p>
    </>,
  },
  {
    id: "collect", title: "What we collect",
    body: <>
      <table>
        <thead><tr><th>Category</th><th>Examples</th><th>Where it comes from</th></tr></thead>
        <tbody>
          <tr><td>Account data</td><td>Name, work email, role (buyer, approver, admin), hashed password</td><td>Meridian Foods IT when your account is created</td></tr>
          <tr><td>Usage and audit data</td><td>Sign-in times, pages opened, review decisions, overrides and their reasons, approvals, exports</td><td>Recorded automatically as you use QuoteLens</td></tr>
          <tr><td>Supplier contact data</td><td>Name, job title, work email, phone number, company, GSTIN printed on a quotation</td><td>Our vendor master; emails and documents suppliers send</td></tr>
          <tr><td>Correspondence</td><td>RFx emails, supplier replies, clarification requests, attachments, message headers</td><td>Sent and received through the QuoteLens mailbox</td></tr>
          <tr><td>Commercial documents</td><td>Price sheets, PDFs, Word files, photographs of printed rate cards, certificates, company profiles</td><td>Attached to supplier replies or uploaded by a buyer</td></tr>
          <tr><td>Questions and answers</td><td>Questions staff ask about a comparison, the database query generated, the answer shown</td><td>Typed by staff in the Ask panel</td></tr>
          <tr><td>Technical data</td><td>IP address, browser type, error logs, request timings</td><td>Our hosting provider, automatically</td></tr>
        </tbody>
      </table>
      <p>We do not ask for, and ask suppliers not to send, sensitive personal data such as health, financial account or identity-document numbers. If a document contains it anyway, it is kept only as part of that document and is not extracted into the comparison.</p>
    </>,
  },
  {
    id: "use", title: "How we use it",
    body: <>
      <ul>
        <li><b>Running sourcing events</b>: sending RFx documents, matching replies to the right event and supplier, and sending clarification requests.</li>
        <li><b>Reading quotations</b>: turning supplier files into prices per line, in the same unit and currency, with a link from every number back to where it was found.</li>
        <li><b>Decisions and records</b>: keeping the review queue, the assumptions ledger, scenarios and the award memo, so a decision can be explained later.</li>
        <li><b>Security and accountability</b>: authenticating staff, recording who changed what and when, and investigating misuse.</li>
        <li><b>Quality</b>: measuring how accurately QuoteLens reads test documents so we can improve it. We use test documents for this, not live supplier files.</li>
        <li><b>Legal obligations</b>: keeping procurement records for audit, tax and company-law purposes.</li>
      </ul>
      <p>We do not sell personal data, use it for advertising, or build profiles of individual supplier contacts.</p>
    </>,
  },
  {
    id: "ai", title: "How AI models are used",
    body: <>
      <p>QuoteLens uses large language models to read supplier documents, suggest which of our RFx lines a supplier&rsquo;s item matches, and answer staff questions about a comparison. Specifically:</p>
      <ul>
        <li>Files and email text from suppliers are sent to <b>Google&rsquo;s Gemini API</b> to be read. Where configured, a second model provider accessed through <b>OpenRouter</b> may be used to score matching decisions.</li>
        <li>We use these services under paid API terms, which state that the provider does not use our prompts or files to train its models.</li>
        <li>Every model request is logged in QuoteLens with its purpose, model, token counts, time taken and cost, so we can audit what was sent and why.</li>
        <li><b>No decision is made by a model alone.</b> Numbers a model is unsure about are marked in the comparison and wait in the review queue. Awards are proposed by a buyer and approved by a named approver.</li>
      </ul>
      <p className={s.note}>A model can misread a document. Every price in QuoteLens links to the page, cell or line it came from, and staff are expected to check marked cells before relying on them.</p>
    </>,
  },
  {
    id: "basis", title: "Our legal basis",
    body: <>
      <p>For <b>staff</b>, we process personal data for employment purposes and to protect the company from loss or liability, which are legitimate uses under section 7 of the DPDP Act.</p>
      <p>For <b>supplier contacts</b>, we process personal data you voluntarily provide in order to respond to our RFx and to enter into or perform a supply contract (section 7(a) of the DPDP Act), and to comply with legal obligations such as record-keeping and tax requirements.</p>
      <p>Where we rely on consent, you may withdraw it at any time by writing to the Grievance Officer (section 16). Withdrawing consent does not affect processing already carried out.</p>
    </>,
  },
  {
    id: "share", title: "Who we share it with",
    body: <>
      <p>We share personal data only with service providers that process it on our instructions (&ldquo;Data Processors&rdquo;), under written contracts that require them to keep it confidential and secure:</p>
      <table>
        <thead><tr><th>Provider</th><th>What they do for us</th><th>Data involved</th></tr></thead>
        <tbody>
          <tr><td>Supabase Inc.</td><td>Database and file storage</td><td>All QuoteLens data</td></tr>
          <tr><td>Vercel Inc.</td><td>Hosting the web application</td><td>Requests, technical logs</td></tr>
          <tr><td>Google LLC</td><td>Gemini API (reading documents); Gmail (sending and receiving RFx email)</td><td>Supplier files, email content</td></tr>
          <tr><td>OpenRouter, Inc.</td><td>Routing matching decisions to a second model, only when enabled by an administrator</td><td>Short item descriptions and candidate lines</td></tr>
        </tbody>
      </table>
      <p>Within Meridian Foods, a supplier&rsquo;s quotation is visible only to staff with a QuoteLens account. Suppliers never see each other&rsquo;s prices. We may disclose data to auditors, advisers or authorities where the law requires it.</p>
    </>,
  },
  {
    id: "transfers", title: "Where data is stored",
    body: <>
      <p>QuoteLens is hosted on cloud infrastructure that may be located outside India, including the Asia-Pacific region and the United States. Transfers are made to countries not restricted by the Government of India under section 16 of the DPDP Act, and our providers apply the security measures described in section 10 wherever the data is held.</p>
    </>,
  },
  {
    id: "retention", title: "How long we keep it",
    body: <>
      <table>
        <thead><tr><th>Data</th><th>Kept for</th></tr></thead>
        <tbody>
          <tr><td>Awarded RFx, quotations, review decisions, award memo</td><td>8 years after the end of the financial year of the award, for audit and tax records</td></tr>
          <tr><td>RFx that were cancelled or never awarded</td><td>3 years after the last activity</td></tr>
          <tr><td>Emails and attachments that did not match any RFx</td><td>90 days, then deleted</td></tr>
          <tr><td>Model-call logs</td><td>2 years</td></tr>
          <tr><td>Staff accounts</td><td>Deactivated when you leave; audit entries you made are kept with the RFx they belong to</td></tr>
          <tr><td>Technical and error logs</td><td>30 days</td></tr>
        </tbody>
      </table>
      <p>When a retention period ends we delete the data or remove the parts that identify a person.</p>
    </>,
  },
  {
    id: "security", title: "How we protect it",
    body: <>
      <ul>
        <li>All traffic is encrypted in transit (TLS). Data is encrypted at rest by our storage provider.</li>
        <li>Service keys are held only on the server and never sent to your browser. Files are private and opened through short-lived signed links.</li>
        <li>Only named Meridian Foods staff can sign in. Sessions expire after 7 days.</li>
        <li>Questions asked in the Ask panel run as read-only queries, limited to the RFx you are looking at.</li>
        <li>Every review action, override, approval and export is written to an audit trail that cannot be edited from the application.</li>
      </ul>
      <p>If we become aware of a personal data breach, we will inform the Data Protection Board of India and affected people as the DPDP Act requires.</p>
    </>,
  },
  {
    id: "cookies", title: "Cookies and local storage",
    body: <>
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Purpose</th><th>Lifetime</th></tr></thead>
        <tbody>
          <tr><td className="mono">ql_session</td><td>Cookie, strictly necessary</td><td>Keeps you signed in; encrypted and HTTP-only</td><td>7 days</td></tr>
          <tr><td className="mono">ql-theme</td><td>Browser local storage</td><td>Remembers light or dark theme</td><td>Until you clear it</td></tr>
          <tr><td className="mono">ql-sidebar</td><td>Cookie, preference</td><td>Remembers whether the sidebar is collapsed</td><td>1 year</td></tr>
        </tbody>
      </table>
      <p>QuoteLens uses no analytics, advertising or third-party tracking cookies.</p>
    </>,
  },
  {
    id: "rights", title: "Your rights",
    body: <>
      <p>Under the DPDP Act you can ask us to:</p>
      <ul>
        <li>tell you what personal data we hold about you and how it is processed, and who we have shared it with;</li>
        <li>correct, complete or update it;</li>
        <li>erase it, where we no longer need it and the law does not require us to keep it;</li>
        <li>nominate another person to exercise these rights on your behalf in the event of death or incapacity;</li>
        <li>address a grievance about how we handled your data.</li>
      </ul>
      <p>Write to the Grievance Officer (section 16). We will acknowledge your request within 3 working days and reply within 30 days. If you are not satisfied with our reply, you can complain to the Data Protection Board of India.</p>
    </>,
  },
  {
    id: "suppliers", title: "A note for suppliers",
    body: <>
      <p>Please send only what the RFx asks for. You do not need to send staff identity documents, bank details or personal phone numbers to quote. If you send a document by mistake, email the address the RFx came from, quoting the RFx code (for example <span className="mono">MER-0419</span>), and we will delete it.</p>
      <p>Your prices are used only to evaluate the RFx you replied to and later RFx for the same category. They are never shared with other suppliers.</p>
    </>,
  },
  {
    id: "children", title: "Children",
    body: <p>QuoteLens is a business tool for adults. We do not knowingly process personal data of anyone under 18.</p>,
  },
  {
    id: "changes", title: "Changes to this notice",
    body: <p>We review this notice at least once a year and when QuoteLens changes how it handles personal data. The date at the top shows the latest version. Significant changes will be announced to staff by email before they take effect.</p>,
  },
  {
    id: "contact", title: "Contact and Grievance Officer",
    body: <>
      <dl className={s.contact}>
        <dt>Grievance Officer</dt><dd>Kavita Deshmukh, Head of Legal &amp; Compliance</dd>
        <dt>Email</dt><dd>privacy@meridianfoods.in</dd>
        <dt>Post</dt><dd>Meridian Foods Pvt Ltd, Meridian House, 4th Floor, Andheri–Kurla Road, Andheri (East), Mumbai 400 059, Maharashtra, India</dd>
        <dt>Hours</dt><dd>Monday to Friday, 10:00–18:00 IST</dd>
      </dl>
      <p>For questions about using QuoteLens rather than your data, see <Link href="/help">Help</Link>.</p>
    </>,
  },
];

export default function PrivacyPage() {
  return (
    <Doc
      eyebrow="Legal"
      title="Privacy notice"
      updated="25 September 2026"
      intro={<>
        <p>This notice explains how Meridian Foods handles personal data in QuoteLens: our staff&rsquo;s, and that of the suppliers who send us quotations.</p>
        <p>The short version: we collect only what a sourcing event needs, a model reads supplier files but never decides on its own, suppliers never see each other&rsquo;s prices, and every change is recorded against the person who made it.</p>
      </>}
      sections={SECTIONS}
    />
  );
}
