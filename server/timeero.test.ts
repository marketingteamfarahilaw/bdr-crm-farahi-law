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

import { categoryOf, summarise } from "./timeero";

describe("FR summary from Timeero", () => {
  const h = (n: number) => n * 3600;
  const shift = (day: string, hours: number, task: string | null, jobId: string | null) =>
    ({ rep: "Jezel Mercado", day, seconds: h(hours), miles: 10, category: categoryOf(task, !!jobId), jobId, flagged: false });

  it("reads the task, and a job clock-in without one is a facility visit", () => {
    expect(categoryOf("Offsite Lunch", true)).toBe("lunch");
    expect(categoryOf("Marketing Event", false)).toBe("event");
    expect(categoryOf("FR Errand", false)).toBe("errand");
    expect(categoryOf("Office Investigation", false)).toBe("investigation");
    expect(categoryOf(null, true)).toBe("visit");
    expect(categoryOf("", false)).toBe("field");
  });

  it("counts days, half days, errand days, visits once per partner per day, and the average", () => {
    const [r] = summarise([
      shift("2026-09-01", 2, null, "A"), shift("2026-09-01", 2, null, "B"), shift("2026-09-01", 1, null, "A"),   // 5 h: 1 day, 2 visits
      shift("2026-09-02", 1, null, "C"), shift("2026-09-02", 1, "Lunch", "C"),                                   // 2 h: ½ day, 1 visit + lunch
      shift("2026-09-03", 5, "FR Errand", null),                                                                 // errand day
    ]);
    expect(r).toMatchObject({ fieldDays: 1.5, errandDays: 1, totalDays: 2.5, visits: 3, lunches: 1, events: 0, total: 4, errands: 1, contract: "PT (20 hrs/wk)" });
    expect(r.avgPerDay).toBe(2.7);
  });
});
