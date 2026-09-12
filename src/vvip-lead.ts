import { config } from "./config";
import { audit } from "./db/pool";
import { sendEmail } from "./email";

export const VVIP_LEAD_INBOX = "americashipsonclick@gmail.com";

const INTERESTS = new Set(["holder", "shipper", "driver", "partner", "other"]);

export type VvipLead = {
  name: string;
  email: string;
  phone: string;
  company: string;
  interest: string;
  note: string;
  source: string;
};

export type VvipLeadParse =
  | { ok: true; lead: VvipLead }
  | { ok: false; error: string; spam?: boolean };

function str(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function leadInbox(): string {
  return VVIP_LEAD_INBOX;
}

export function parseVvipLead(body: unknown): VvipLeadParse {
  const raw = (body ?? {}) as Record<string, unknown>;
  const trap = str(raw.website, 200) || str(raw.companyUrl, 200);
  if (trap) {
    return { ok: false, error: "ignored", spam: true };
  }

  const name = str(raw.name, 80);
  const email = str(raw.email, 120).toLowerCase();
  const phone = str(raw.phone, 40);
  const company = str(raw.company, 80);
  const interestRaw = str(raw.interest, 40).toLowerCase();
  const interest = INTERESTS.has(interestRaw) ? interestRaw : "other";
  const note = str(raw.note ?? raw.message, 2000);
  const source = str(raw.source, 80) || "golden-vvip-desk";

  if (name.length < 2) return { ok: false, error: "Name is required." };
  if (!isEmail(email)) return { ok: false, error: "A real email is required." };

  return {
    ok: true,
    lead: { name, email, phone, company, interest, note, source },
  };
}

export function formatVvipLeadEmail(lead: VvipLead): { subject: string; text: string; html: string } {
  const subject = `Golden VVIP desk — ${lead.name} (${lead.interest})`;
  const lines = [
    "America Ships On Click — Golden VVIP desk",
    "Visionary America",
    "",
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    `Phone: ${lead.phone || "—"}`,
    `Company: ${lead.company || "—"}`,
    `Interest: ${lead.interest}`,
    `Source: ${lead.source}`,
    "",
    "Note:",
    lead.note || "—",
    "",
    "Desk terms on the page: open books, house ~5%, 2% load rewards.",
    "Holder economics (locked 2026-09-10): 1% hourly regular / 5% premium instead of 1%, never stack, buy-in required, 30-day lock.",
  ];
  const text = lines.join("\n");
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px 12px;color:#9a9078;width:140px">${label}</td><td style="padding:8px 12px;color:#f4efe3">${escapeHtml(value)}</td></tr>`;
  const html = `
    <div style="background:#090b0e;color:#f4efe3;font-family:Georgia,serif;padding:24px">
      <p style="color:#c8a44d;letter-spacing:.18em;text-transform:uppercase;font-size:12px;margin:0 0 8px">Golden VVIP desk</p>
      <h1 style="font-size:28px;margin:0 0 16px">New desk lead</h1>
      <table style="border-collapse:collapse;border:1px solid #c8a44d">${row("Name", lead.name)}${row("Email", lead.email)}${row("Phone", lead.phone || "—")}${row("Company", lead.company || "—")}${row("Interest", lead.interest)}${row("Source", lead.source)}</table>
      <p style="white-space:pre-wrap;margin-top:20px">${escapeHtml(lead.note || "—")}</p>
    </div>
  `;
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function deliverVvipLead(
  lead: VvipLead,
): Promise<{ ok: boolean; channels: string[]; inbox: string }> {
  const inbox = leadInbox();
  const { subject, text, html } = formatVvipLeadEmail(lead);
  const channels: string[] = [];

  await audit("vvip.lead", "received", { ...lead, inbox });

  if (config.resendKey) {
    try {
      await sendEmail(inbox, subject, text, html);
      channels.push("resend");
    } catch (err) {
      console.warn("vvip resend failed", err instanceof Error ? err.message : err);
    }
  }

  try {
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(inbox)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        _subject: subject,
        _template: "table",
        _captcha: "false",
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        company: lead.company,
        interest: lead.interest,
        source: lead.source,
        message: text,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { success?: string | boolean };
    if (res.ok && body.success !== false && body.success !== "false") {
      channels.push("formsubmit");
    } else if (res.ok) {
      channels.push("formsubmit-confirm");
    }
  } catch (err) {
    console.warn("vvip formsubmit failed", err instanceof Error ? err.message : err);
  }

  return { ok: channels.length > 0, channels, inbox };
}
