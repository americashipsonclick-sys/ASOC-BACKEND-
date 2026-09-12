import { expect } from "chai";
import { formatVvipLeadEmail, parseVvipLead, VVIP_LEAD_INBOX } from "../src/vvip-lead";

describe("golden VVIP lead capture", () => {
  it("requires a name and real email", () => {
    expect(parseVvipLead({ name: "A", email: "not-an-email" }).ok).to.equal(false);
    expect(parseVvipLead({ name: "Pump Ndrive", email: "pump@example.com" }).ok).to.equal(true);
  });

  it("silently drops honeypot spam", () => {
    const parsed = parseVvipLead({
      name: "Bot",
      email: "bot@example.com",
      website: "https://spam.test",
    });
    expect(parsed.ok).to.equal(false);
    if (!parsed.ok) expect(parsed.spam).to.equal(true);
  });

  it("formats an open-books desk email to americashipsonclick@gmail.com", () => {
    const parsed = parseVvipLead({
      name: "Jordan Hale",
      email: "jordan@example.com",
      phone: "2145550100",
      company: "Hale Freight",
      interest: "shipper",
      note: "Need the desk open for Dallas produce.",
    });
    expect(parsed.ok).to.equal(true);
    if (!parsed.ok) return;
    const mail = formatVvipLeadEmail(parsed.lead);
    expect(VVIP_LEAD_INBOX).to.equal("americashipsonclick@gmail.com");
    expect(mail.subject).to.include("Jordan Hale");
    expect(mail.text).to.include("Hale Freight");
    expect(mail.text).to.include("Dallas produce");
    expect(mail.html).to.include("Golden VVIP desk");
  });

  it("accepts the live preregister form fields", () => {
    const parsed = parseVvipLead({
      name: "Cursor Preregister Verify",
      email: "cursor-agent@americashipsonclick.com",
      business_type: "Shipper",
      location: "Austin, TX · VVIP-LIVE-8e28",
    });
    expect(parsed.ok).to.equal(true);
    if (!parsed.ok) return;
    expect(parsed.lead.interest).to.equal("shipper");
    expect(parsed.lead.company).to.equal("Austin, TX · VVIP-LIVE-8e28");
    expect(parsed.lead.source).to.equal("asoc-vip-preregister-nine");
    expect(parsed.lead.note).to.include("Austin, TX");
  });
});
