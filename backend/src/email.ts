import { config } from "./config";
import { audit } from "./db/pool";

export async function sendEmail(to: string | undefined, subject: string, text: string): Promise<string> {
  if (!to) {
    await audit("email", "skipped", { subject, reason: "no recipient" });
    return "skipped:no-recipient";
  }

  if (!config.resendKey || config.notificationsDryRun) {
    await audit("email", "logged", { to, subject, text });
    return `dry-run:email:${to}`;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [to],
      subject,
      text,
    }),
  });

  const result = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) {
    throw new Error(`email failed: ${res.status} ${result.message ?? "provider rejected request"}`);
  }

  await audit("email", "sent", { to, subject, providerId: result.id ?? null });
  return result.id ?? "sent";
}

export async function emailReceipt(to: string | undefined, title: string, details: Record<string, unknown>): Promise<void> {
  const lines = Object.entries(details)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  await sendEmail(to, `ASOC receipt — ${title}`, `America Ships On Click\n${title}\n\n${lines}`);
}

export async function emailShipperTracking(to: string | undefined, loadId: string, plate: string): Promise<void> {
  await sendEmail(
    to,
    `ASOC tracking — load ${loadId} picked up`,
    `Your shipment ${loadId} was picked up.\nVehicle plate: ${plate}\nTrack live in the ASOC app.`,
  );
}
