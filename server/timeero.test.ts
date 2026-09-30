import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { signatureMatches } from "./timeero";

describe("Timeero webhook signature", () => {
  const secret = "s3cret", ts = "1727712000";
  const body = Buffer.from('{"event":"timesheets","id":"42","operation":"timesheets_created","last_updated_at":1727712000}');
  const hmac = (msg: string) => createHmac("sha256", secret).update(msg);

  it("accepts Timeero's HMAC of timestamp + payload, hex or base64", () => {
    expect(signatureMatches(secret, ts, body, hmac(ts + body.toString()).digest("hex"))).toBe(true);
    expect(signatureMatches(secret, ts, body, hmac(ts + body.toString()).digest("base64"))).toBe(true);
  });
  it("rejects a wrong secret, a changed body or a changed timestamp", () => {
    const good = hmac(ts + body.toString()).digest("hex");
    expect(signatureMatches("other", ts, body, good)).toBe(false);
    expect(signatureMatches(secret, ts, Buffer.from(body.toString().replace("42", "43")), good)).toBe(false);
    expect(signatureMatches(secret, "1727712001", body, good)).toBe(false);
    expect(signatureMatches(secret, ts, body, "")).toBe(false);
  });
});
