import { describe, expect, it } from "vitest";
import { NO_SOURCE, TEAM_CHANNEL, derive, monthIndexer, monthOf, monthsBetween, rowNameOf, sourceOf } from "./common";
import { delta, prevMonth, scopeOf, usdK } from "../../client/src/pages/marketing/shared";

describe("monthIndexer", () => {
  const months = ["2026-08", "2026-09"];
  const at = monthIndexer(months);

  it("uses Pacific month boundaries", () => {
    expect(at(new Date("2026-08-01T06:59:59Z"))).toBe(-1);   // Jul 31, 11:59 pm Pacific
    expect(at(new Date("2026-08-01T07:00:00Z"))).toBe(0);
    expect(at(new Date("2026-09-01T06:59:59Z"))).toBe(0);
    expect(at(new Date("2026-09-01T07:00:00Z"))).toBe(1);
    expect(at(new Date("2026-10-01T06:59:59Z"))).toBe(1);
    expect(at(new Date("2026-10-01T07:00:00Z"))).toBe(-1);
    expect(at("2026-09-15T12:00:00Z")).toBe(1);
  });

  it("agrees with monthOf across daylight-saving changes", () => {
    const span = monthsBetween(new Date("2024-01-15T12:00:00Z"), new Date("2026-12-15T12:00:00Z"));
    const idx = monthIndexer(span);
    const start = Date.parse("2024-01-01T08:00:00Z"), end = Date.parse("2027-01-01T08:00:00Z");
    for (let t = start; t < end; t += 3_600_000 * 7 + 1234) {
      const d = new Date(t);
      expect(idx(d)).toBe(span.indexOf(monthOf(d)));
    }
  });

  it("returns -1 with no months", () => {
    expect(monthIndexer([])(new Date())).toBe(-1);
  });
});

describe("derive", () => {
  const rows = [
    { leadDate: new Date("2026-09-03T18:00:00Z"), outcome: "Signed", marketingSource: "Walker Advertising Contract 26" },
    { leadDate: new Date("2026-08-20T18:00:00Z"), outcome: "Rejected", marketingSource: "  " },
    { leadDate: null, outcome: "Signed", marketingSource: "Web Search" },
  ];

  it("names rows by channel, keeps No source whole and drops undated rows", () => {
    const leads = derive(rows, ["2026-08", "2026-09"], "channel");
    expect(leads).toHaveLength(2);
    expect(leads[0]).toMatchObject({ i: 1, source: "Walker Advertising Contract 26", name: "Walker Advertising", signed: true, bucket: "signedInHouse" });
    expect(leads[1]).toMatchObject({ i: 0, source: NO_SOURCE, name: NO_SOURCE, signed: false, bucket: "rejected" });
  });

  it("keeps each source its own row in the source view", () => {
    expect(derive(rows, ["2026-09"], "source")[0].name).toBe("Walker Advertising Contract 26");
    expect(rowNameOf(NO_SOURCE, "channel")).toBe(NO_SOURCE);
  });
});

describe("client helpers", () => {
  it("formats changes", () => {
    expect(delta(144, 132, "count")).toEqual({ text: "+12 (+9%)", tone: "ok" });
    expect(delta(5, 3, "count")).toEqual({ text: "+2", tone: "ok" });
    expect(delta(11, 18, "count")).toEqual({ text: "−7 (−39%)", tone: "bad" });
    expect(delta(3, 0, "count")).toEqual({ text: "new", tone: "ok" });
    expect(delta(0, 0, "count")).toEqual({ text: "·", tone: "grey" });
    expect(delta(101, 100, "count").tone).toBe("grey");
    expect(delta(16.4, 15, "pct")).toEqual({ text: "+1.4 pts", tone: "ok" });
    expect(delta(15.5, 15, "pct").tone).toBe("grey");
    expect(delta(398, 455, "money", true)).toEqual({ text: "−$57 (−13%)", tone: "ok" });
  });

  it("formats money compactly and steps months back", () => {
    expect(usdK(4500)).toBe("$4.5k");
    expect(usdK(12000)).toBe("$12k");
    expect(usdK(950)).toBe("$950");
    expect(prevMonth("2026-01")).toBe("2025-12");
    expect(prevMonth("2026-10")).toBe("2026-09");
  });

  it("asks for a channel's member sources", () => {
    expect(scopeOf({ name: "Walker Advertising", members: ["Walker Advertising Contract 26"] })).toEqual({ sources: ["Walker Advertising Contract 26"] });
    expect(scopeOf({ name: NO_SOURCE, members: [] })).toEqual({ source: NO_SOURCE });
  });
});

describe("the BD/FR team row", () => {
  const lead = (marketingSource: string | null, teamRole: string | null) =>
    ({ leadDate: new Date("2026-09-10T18:00:00Z"), outcome: "Signed", marketingSource, teamRole });

  it("puts every BDR and FR lead in one row, whatever its Marketing Source names", () => {
    expect(sourceOf(lead("BDR Grace Lanayon", "BDR"))).toBe(TEAM_CHANNEL);
    expect(sourceOf(lead("Field Representative Lupe Campos", "FR"))).toBe(TEAM_CHANNEL);
    // Malvin Rosales (Intake) is credited like a rep but isn't BD/FR.
    expect(sourceOf(lead("Malvin Rosales", "Intake"))).toBe("Malvin Rosales");
    expect(sourceOf(lead("Walker Advertising Contract 26", null))).toBe("Walker Advertising Contract 26");
  });

  it("stays whole in the Channels view and is never a channel member", () => {
    expect(rowNameOf(TEAM_CHANNEL, "channel")).toBe(TEAM_CHANNEL);
    const rows = derive([lead("BDR Grace Lanayon", "BDR"), lead("FR Jezel Mercado", "FR"), lead("Walker Advertising Contract 9", null)], ["2026-09"], "channel");
    expect(rows.map((r) => r.name)).toEqual([TEAM_CHANNEL, TEAM_CHANNEL, "Walker Advertising"]);
  });

  it("drills as the whole team, not as a source list", () => {
    expect(scopeOf({ name: TEAM_CHANNEL, members: [] })).toEqual({ source: TEAM_CHANNEL });
  });
});
