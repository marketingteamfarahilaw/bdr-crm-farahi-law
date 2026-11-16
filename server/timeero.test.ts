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
  it("rejects, never throws, on a signature of non-ASCII characters", () => {
    // 64 characters but 128 bytes: timingSafeEqual would throw and stop the server.
    expect(() => signatureMatches(secret, ts, body, "é".repeat(64))).not.toThrow();
    expect(signatureMatches(secret, ts, body, "é".repeat(64))).toBe(false);
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

  it("counts a partner the rep clocked in at as a visit, without a job", () => {
    const [r] = summarise([
      { ...shift("2026-09-01", 6, null, null), facilityIds: [11, 12] },  // one all-day clock-in, two partners by GPS
      { ...shift("2026-09-01", 1, null, "A"), facilityIds: [11] },      // a job at the same partner: still one visit
      { ...shift("2026-09-02", 2, "Lunch", null), facilityIds: [13] },  // a lunch is a lunch, not also a visit
    ]);
    expect(r).toMatchObject({ visits: 2, lunches: 1 });
    expect(r.visitKeys.sort()).toEqual(["2026-09-01|11", "2026-09-01|12"]);
  });
});

import { pacificDay, shiftSeconds } from "./timeero";

describe("Timeero clock times", () => {
  it("takes the day from a wall-clock time, and converts an instant to Pacific", () => {
    expect(pacificDay("2026-09-30 08:12:00")).toBe("2026-09-30");
    expect(pacificDay("2026-10-01T02:30:00Z")).toBe("2026-09-30");          // 7:30 pm PDT the day before
    expect(pacificDay("2026-10-01T02:30:00+00:00")).toBe("2026-09-30");
  });

  it("works out hours from clock times when the duration is missing", () => {
    expect(shiftSeconds({ duration: "8:00:00", break_in_seconds: 1800 })).toBe(7.5 * 3600);
    expect(shiftSeconds({ duration: null, clock_in_time: "2026-09-30 08:00:00", clock_out_time: "2026-09-30 16:30:00" })).toBe(8.5 * 3600);
    expect(shiftSeconds({ duration: null, clock_in_time: "2026-09-30 08:00:00", clock_out_time: null })).toBe(0);
  });
});
