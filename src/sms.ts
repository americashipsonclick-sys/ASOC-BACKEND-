import { config } from "./config";

export async function sendSms(to: string, body: string): Promise<string> {
  if (!config.twilioSid || !config.twilioToken || !config.twilioFrom || config.dryRun) {
    console.log(`[sms dry-run] to=${to} ${body}`);
    return `dry-run:sms:${to}`;
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Messages.json`;
  const auth = Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString("base64");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: to,
      From: config.twilioFrom,
      Body: body,
    }),
  });
  const json = (await res.json()) as { sid?: string; message?: string };
  if (!res.ok) throw new Error(json.message ?? `twilio ${res.status}`);
  return json.sid ?? "sent";
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}
