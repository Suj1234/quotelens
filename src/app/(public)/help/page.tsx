import type { Metadata } from "next";
import Link from "next/link";
import { Doc, type Section } from "../doc";
import s from "../doc.module.css";

export const metadata: Metadata = { title: "Help · QuoteLens" };

const SECTIONS: Section[] = [
  {
    id: "start", title: "Getting started",
    body: <>
      <p>QuoteLens takes a sourcing event from the first draft to an approved award:</p>
      <ol>
        <li><b>Send.</b> Draft the RFx with the co-pilot (lines, terms, questionnaire, vendors) and issue it. Each vendor gets an email with the line sheet and questionnaire attached.</li>
        <li><b>Receive.</b> Vendors reply by email in whatever format they use. QuoteLens reads every attachment and the email body.</li>
        <li><b>Compare.</b> Prices are converted to the same unit and currency and laid out line by line. Anything QuoteLens is unsure about goes to the review queue.</li>
        <li><b>Award.</b> Ask questions in plain language, save scenarios, and send the award memo for approval.</li>
      </ol>
      <p>Most buyers spend their time on the <b>Compare</b> and <b>Review</b> tabs. Approvers usually open the <b>Decide</b> page and the award memo.</p>
    </>,
  },
  {
    id: "access", title: "Signing in",
    body: <>
      <ul>
        <li>Sign in with your Meridian Foods work email and the password IT gave you. Sessions last 7 days on the same browser.</li>
        <li><b>Forgot your password?</b> Call IT Service Desk on ext. 4400 or email itsupport@meridianfoods.in. For security, passwords are not reset by email link.</li>
        <li><b>&ldquo;Email or password is incorrect&rdquo;</b>: check you are using your work email, not a personal one.</li>
        <li><b>No account yet?</b> Ask your manager to raise an access request for QuoteLens with the role you need (buyer or approver).</li>
      </ul>
      <p className={s.note}>Suppliers never sign in. If a supplier asks for a login, tell them to reply to the RFx email instead.</p>
    </>,
  },
  {
    id: "roles", title: "Roles",
    body: <table>
      <thead><tr><th>Role</th><th>Can</th><th>Cannot</th></tr></thead>
      <tbody>
        <tr><td><b>Buyer</b></td><td>Create and issue RFx, add responses, clear the review queue, send clarifications, save scenarios, generate the award memo</td><td>Approve an award</td></tr>
        <tr><td><b>Approver</b></td><td>View every RFx, ask questions, compare scenarios, approve or return the award memo</td><td>Change prices, matches or review items</td></tr>
      </tbody>
    </table>,
  },
  {
    id: "create", title: "Creating an RFx",
    body: <>
      <p>Go to <b>RFx → New RFx</b>. On the left is the co-pilot; on the right are four tabs it fills in: <b>Lines</b>, <b>Terms</b>, <b>Questionnaire</b> and <b>Vendors</b>.</p>
      <h3>Lines</h3>
      <p>Attach last year&rsquo;s line sheet (xlsx or csv) or paste rows into the co-pilot. QuoteLens never invents line items: every line comes from what you attach or type, and you can edit any cell. Include the weight per piece where you have it, so per-kg quotes can be converted later.</p>
      <h3>Terms</h3>
      <p>Type &ldquo;standard terms&rdquo; for the usual Meridian Foods terms (payment, delivery, validity, freight basis), then change what differs for this event.</p>
      <h3>Questionnaire</h3>
      <p>Attach an existing questionnaire or ask the co-pilot to draft one. Mark the questions a vendor must pass; a vendor who fails one is shown as disqualified in the comparison.</p>
      <h3>Vendors</h3>
      <p>Choose vendors from the vendor master. Each vendor gets its own reply address so replies are matched automatically.</p>
    </>,
  },
  {
    id: "issue", title: "Issuing to vendors",
    body: <>
      <p><b>Issue to n vendors</b> becomes available once lines, terms and a questionnaire exist. Issuing:</p>
      <ul>
        <li>freezes the RFx as version 1, so later edits create a new version rather than changing what vendors received;</li>
        <li>generates the line sheet (xlsx) and questionnaire (PDF);</li>
        <li>sends each vendor an email with both attached, and a reply address in the form <span className="mono">rfx-mer-0419-balaji</span>.</li>
      </ul>
      <p>Sent emails appear under <b>Outbox</b> and on the RFx <b>Timeline</b>.</p>
    </>,
  },
  {
    id: "receive", title: "Receiving replies",
    body: <>
      <p>Replies are picked up from the mailbox automatically every 30 seconds while the RFx overview is open, or straight away with <b>Sync</b>. A reply is matched to its RFx and vendor using the reply address, then the subject line, then the email thread.</p>
      <h3>Formats QuoteLens reads</h3>
      <table>
        <thead><tr><th>Format</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td>Excel (xlsx, xls, csv)</td><td>Every sheet, including hidden rows and cell comments</td></tr>
          <tr><td>PDF</td><td>Typed and scanned; long documents are read page by page</td></tr>
          <tr><td>Word (docx)</td><td>Paragraphs and tables</td></tr>
          <tr><td>Photos (jpg, png)</td><td>Printed rate cards, handwritten notes; rotated photos are straightened first</td></tr>
          <tr><td>Email text</td><td>Quoted earlier messages and signatures are removed before reading</td></tr>
        </tbody>
      </table>
      <p>Certificates, company profiles and brochures are recognised as supporting documents and filed under <b>Documents</b> without being read as prices.</p>
      <h3>Adding a reply by hand</h3>
      <p>If a vendor sends a quote on WhatsApp or hands over paper, open the RFx and use <b>Add response</b> to upload the file or paste the text, and choose the vendor.</p>
      <h3>Replies that match nothing</h3>
      <p>A reply that can&rsquo;t be matched to an RFx or vendor goes to <b>Inbox → Unmatched</b>. Open it and choose <b>Assign vendor</b>; QuoteLens then reads it as normal.</p>
    </>,
  },
  {
    id: "review", title: "The review queue",
    body: <>
      <p>The <b>Review</b> tab lists every number, match or answer QuoteLens is not sure about. Nothing in the queue counts in totals until you decide. Each card shows the evidence (the source cell, page or line) on the left and your options on the right.</p>
      <table>
        <thead><tr><th>Action</th><th>What it does</th></tr></thead>
        <tbody>
          <tr><td><b>Confirm</b></td><td>Accept the value as read. The cell turns green (reviewed).</td></tr>
          <tr><td><b>Override</b></td><td>Enter the correct value or unit. A reason is required and appears in the ledger.</td></tr>
          <tr><td><b>Map</b></td><td>Match the vendor&rsquo;s item to a different RFx line.</td></tr>
          <tr><td><b>Exclude</b></td><td>Leave the price out of the comparison, with a reason.</td></tr>
          <tr><td><b>Ask vendor</b></td><td>Add the item to a clarification email (see section 9).</td></tr>
          <tr><td><b>Ignore / Dismiss</b></td><td>For informational items that need no change.</td></tr>
        </tbody>
      </table>
      <h3>Keyboard shortcuts</h3>
      <p><kbd>J</kbd> next card · <kbd>K</kbd> previous card · <kbd>C</kbd> confirm the current card</p>
    </>,
  },
  {
    id: "compare", title: "Reading the comparison",
    body: <>
      <p>The <b>Prices</b> tab has one row per RFx line and one column per vendor. A teal edge on the left of a cell marks the lowest eligible price on that line. Switch between <b>Unit price</b>, <b>Landed cost</b> (including freight) and <b>As written</b> (the vendor&rsquo;s own figure and unit) above the grid.</p>
      <table>
        <thead><tr><th>Cell looks like</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td>Plain number</td><td>Read with confidence, no conversion needed</td></tr>
          <tr><td>Number with a small dot</td><td>Converted: a different unit, pack size or currency. Hover to see how.</td></tr>
          <tr><td>Green number</td><td>Reviewed by a person</td></tr>
          <tr><td>Amber, &ldquo;best guess?&rdquo;</td><td>Unsure reading or unit. Left out of totals until reviewed.</td></tr>
          <tr><td>Grey hatch, &ldquo;not quoted&rdquo;</td><td>The vendor didn&rsquo;t price this line</td></tr>
          <tr><td>Stripes, &ldquo;prior pricing&rdquo;</td><td>The vendor referred to an earlier price instead of stating one</td></tr>
          <tr><td>Struck through</td><td>Excluded by a reviewer</td></tr>
          <tr><td>Red outline</td><td>Two sources from the same vendor disagree</td></tr>
        </tbody>
      </table>
      <p>Click any cell to open its source: the original file at the exact cell, page or line, the matching alternatives QuoteLens considered, and every step of the conversion with the assumption behind it.</p>
    </>,
  },
  {
    id: "clarify", title: "Asking a vendor to clarify",
    body: <>
      <p>Select one or more review items and choose <b>Ask vendor</b>. QuoteLens drafts one email per vendor listing exactly what is unclear, for example &ldquo;Please confirm the number of pieces per bundle for items 5, 9, 15 and 19&rdquo;. Edit the draft and send it.</p>
      <p>When the vendor replies, only the lines they clarified are updated, and the matching review items are marked <b>resolved by reply</b>. The rest of their quotation is left as it was.</p>
    </>,
  },
  {
    id: "ask", title: "Asking questions",
    body: <>
      <p>Open <b>Ask</b> and type a question in plain language. QuoteLens turns it into a read-only query on this RFx, runs it and explains the result. Examples:</p>
      <ul>
        <li>&ldquo;What is the cheapest total if we award each line to the lowest vendor?&rdquo;</li>
        <li>&ldquo;Which vendors cleared the questionnaire?&rdquo;</li>
        <li>&ldquo;How much would we save by splitting between the two cheapest vendors?&rdquo;</li>
        <li>&ldquo;Which lines have only one quote?&rdquo;</li>
      </ul>
      <p>Every answer shows <b>How I computed this</b> and the query itself, lists what was left out (disqualified vendors, unreviewed cells) and can be exported. Choose <b>Include best guesses</b> to see the answer with unreviewed cells counted.</p>
    </>,
  },
  {
    id: "award", title: "Scenarios, award memo and approval",
    body: <>
      <ol>
        <li>Save an answer as a <b>scenario</b>, or build one from a rule: cheapest per line, or grouped by vendor. Override individual lines with a reason.</li>
        <li>Compare scenarios side by side by total, number of vendors and lines changed.</li>
        <li>Choose <b>Generate memo</b>. The PDF includes the recommendation, allocation, exclusions, open assumptions, the review ledger and a signature block.</li>
        <li>The approver reviews and chooses <b>Approve</b>. The RFx is then locked: the grid becomes read-only and review actions are disabled.</li>
      </ol>
    </>,
  },
  {
    id: "export", title: "Exporting",
    body: <p>Use <b>Export</b> above the grid for an Excel workbook (cells coloured by state, with a legend) or a CSV. Any Ask answer can be exported on its own. Exports are logged in the audit trail. Keep them on Meridian Foods systems only.</p>,
  },
  {
    id: "faq", title: "Frequently asked questions",
    body: <>
      <h3>Why doesn&rsquo;t a vendor&rsquo;s total match their quotation?</h3>
      <p>Totals leave out unreviewed cells and use the RFx unit. Switch to <b>As written</b> to see the vendor&rsquo;s own figures, or clear their items in the review queue.</p>
      <h3>A vendor quoted per kg and we buy per piece. What happens?</h3>
      <p>QuoteLens converts using the weight per piece on the RFx line. The conversion appears in the cell&rsquo;s source view and in the ledger. If there is no weight, the cell is marked amber for review.</p>
      <h3>A vendor quoted in USD.</h3>
      <p>It is converted at the rate in <b>Settings → FX rates</b>. Changing a rate adds a new ledger entry; cells already converted keep their original chain.</p>
      <h3>Can I undo a review decision?</h3>
      <p>Yes, until the award is approved. Open the cell, then choose a different action from its review history. Both decisions stay in the audit trail.</p>
      <h3>A vendor sent two replies.</h3>
      <p>Both are kept. Where they price the same line differently, the cell shows a red outline until you choose which one applies.</p>
    </>,
  },
  {
    id: "trouble", title: "Troubleshooting",
    body: <table>
      <thead><tr><th>Problem</th><th>Try this</th></tr></thead>
      <tbody>
        <tr><td>A reply hasn&rsquo;t appeared</td><td>Press <b>Sync</b> on the RFx overview. Check <b>Inbox → Unmatched</b>. Ask the vendor to reply to the original email rather than writing a new one.</td></tr>
        <tr><td>A stage shows &ldquo;failed&rdquo;</td><td>Open the response and choose <b>Retry</b> on that stage. If it fails again, note the error code shown and contact support.</td></tr>
        <tr><td>A photo was read badly</td><td>Ask the vendor for a straight, well-lit photo or the original file, or override the cells with a reason.</td></tr>
        <tr><td>A line was matched to the wrong item</td><td>Open the cell and choose <b>Map</b> to pick the right line.</td></tr>
        <tr><td>The page looks out of date</td><td>Reload. Changes made by colleagues appear on reload.</td></tr>
      </tbody>
    </table>,
  },
  {
    id: "support", title: "Contact support",
    body: <>
      <dl className={s.contact}>
        <dt>QuoteLens support</dt><dd>quotelens-support@meridianfoods.in · replies within 1 working day</dd>
        <dt>Accounts and passwords</dt><dd>IT Service Desk, ext. 4400 · itsupport@meridianfoods.in</dd>
        <dt>Procurement Policy</dt><dd>procurement.office@meridianfoods.in</dd>
        <dt>Hours</dt><dd>Monday to Saturday, 09:00–19:00 IST</dd>
      </dl>
      <p>When reporting a problem, include the RFx code, the vendor, and the error code if one was shown. See also the <Link href="/privacy">Privacy notice</Link> and <Link href="/terms">Terms of use</Link>.</p>
    </>,
  },
];

export default function HelpPage() {
  return (
    <Doc
      eyebrow="Help centre"
      title="Using QuoteLens"
      updated="25 September 2026"
      intro={<p>Everything you need to run a sourcing event in QuoteLens, from drafting the RFx to getting the award approved. New to QuoteLens? Start with section 1.</p>}
      sections={SECTIONS}
    />
  );
}
