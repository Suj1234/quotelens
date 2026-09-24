import "server-only";
import { AppError } from "@/lib/errors";

// TRD §15.3 Gmail mode — out of scope for this build (DECISIONS 2026-09-24), kept as a documented stub like §15.4 Resend.
// Going live = implement these two with the same message options the mock uses (nodemailer SMTP transport to
// smtp.gmail.com:465 with GMAIL_USER / GMAIL_APP_PASSWORD; imapflow fetch of unseen `source`), and feed each
// fetched message to `ingestMessage()` in ./sync.ts exactly as the mock mailbox does.
const OUT = () => new AppError("NOT_CONFIGURED", "Live Gmail is out of scope for this build — Settings → email mode must be mock.", undefined, 501);

export const sendGmail: (m: { eml: Buffer; from: string; to: string }) => Promise<never> = async () => { throw OUT(); };
export const syncGmail: (rfxId: string) => Promise<never> = async () => { throw OUT(); };
