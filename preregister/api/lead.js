const INBOX = "americashipsonclick@gmail.com";
const FORMSUBMIT = "https://formsubmit.co/ajax/baa08064eef75ea2d6e26dc967e8c549";

function str(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch { body = {}; }
  }
  body = body || {};
  const name = str(body.name);
  const email = str(body.email).toLowerCase();
  const business_type = str(body.business_type);
  const location = str(body.location);
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !business_type || !location) {
    res.status(400).json({ ok: false, error: "Please fill every field." });
    return;
  }
  const message =
    "America Ships On Click Golden VVIP\nName: " +
    name +
    "\nEmail: " +
    email +
    "\nType: " +
    business_type +
    "\nLocation: " +
    location +
    "\nInbox: " +
    INBOX;
  try {
    const r = await fetch(FORMSUBMIT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: "ASOC Golden VVIP: " + business_type,
        _template: "table",
        _captcha: "false",
        name,
        email,
        business_type,
        location,
        message,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.success !== false && data.success !== "false") {
      res.status(200).json({ ok: true, inbox: INBOX, channel: "formsubmit" });
      return;
    }
  } catch (err) {
    console.warn("formsubmit", err);
  }
  res.status(502).json({ ok: false, error: "Mail did not go out", inbox: INBOX });
}
