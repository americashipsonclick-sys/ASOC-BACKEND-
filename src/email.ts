import { config } from "./config";
import { audit } from "./db/pool";

export async function sendEmail(
  to: string | undefined,
  subject: string,
  text: string,
  html?: string,
): Promise<void> {
  if (!to) {
    await audit("email", "skipped", { subject, reason: "no recipient" });
    return;
  }

  if (!config.resendKey) {
    await audit("email", "logged", { to, subject, text });
    return;
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
      ...(html ? { html } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`email failed: ${res.status} ${body}`);
  }

  await audit("email", "sent", { to, subject });
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
