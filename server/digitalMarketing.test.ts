import { describe, expect, it } from "vitest";
import { JFJ_WEBSITE, TOLL_FREE } from "@shared/marketing";
import { buildDigitalReport, priorPeriod, rate, type BuildInput, type DmRow } from "./digitalMarketing";
import { targetPeriod } from "./signupsReport";

let nextId = 1;
/** A lead as leaddocket_leads holds it; the name is a placeholder, never a real client. */
const lead = (source: string, outcome: string, over: Partial<DmRow> = {}): DmRow => ({
  leadId: nextId++,
  leadDate: new Date("2026-09-10T19:00:00Z"),
  outcome,
  status: outcome === "Signed" ? "Signed Up" : outcome.includes("Referred") ? "Referred" : outcome,
  subStatus: null,
  caseType: "Auto",
  marketingSource: source,
  teamRole: null,
  clientName: `Client ${nextId}`,
  caseValue: null,
  incidentDate: null,
  relatedLeadIds: null,
  phoneKey: null,
  ...over,
});

const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(from + "T12:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};
const input = (rows: DmRow[], over: Partial<BuildInput> = {}): BuildInput => ({
  rows, prior: [], trend: rows, trendMonths: ["2026-08", "2026-09"], spend: [],
  from: "2026-09-01", to: "2026-09-30", priorFrom: "2026-08-02", priorTo: "2026-08-31",
  days: days("2026-09-01", "2026-09-30"), targetMonths: 1, priorTargetMonths: 1, prorated: false,
  ...over,
});

describe("buildDigitalReport — the team table", () => {
  const rows = [
    // GBP: 2 signed in-house (one accident: same day and phone), 1 signed referred out, 1 open, 1 pending referral, 1 lost, 1 rejected, 1 referred out
    lead("GMB 525 W Main St Visalia", "Signed", { incidentDate: "2026-09-01", phoneKey: "2135550100", caseValue: "Medium" }),
    lead("GMB 525 W Main St Visalia", "Signed", { incidentDate: "2026-09-01", phoneKey: "2135550100", caseValue: "Medium" }),
    lead("GMB 5601 Truxtun Ave", "Signed Referred Out", { subStatus: "Signed Up", caseType: "Workers Compensation", caseValue: "Low" }),
    lead("GMB 5601 Truxtun Ave", "Chase"),
    lead("Google My Business", "Pending Referral"),
    lead("GMB 14500 Roscoe Blvd", "Lost", { subStatus: "No Show" }),
    lead("GMB 14500 Roscoe Blvd", "Rejected", { subStatus: "No Injuries" }),
    lead("GMB 14500 Roscoe Blvd", "Referred Out", { subStatus: "Declined", caseType: "Employment Law" }),
    // SEO: duplicate spellings of one brand, and the toll-free line
    lead("JustinforJustice Website", "Signed", { caseValue: "High" }),
    lead("Justin For Justice website", "Rejected"),
    lead("Justin For Justice Toll Free for Website", "Signed"),
    // Ads
    lead("Google Local Services Ads", "Chase"),
    // not digital: never counted
    lead("Walker Advertising Contract 26", "Signed"),
    lead("BDR Someone", "Signed", { teamRole: "BDR" }),
    lead("GMB 525 W Main St Visalia", "Signed", { teamRole: "FR" }),
  ];
  const r = buildDigitalReport(input(rows));
  const row = (g: string) => r.team.find((t) => t.group === g)!;

  it("puts every digital lead in exactly one column", () => {
    const gbp = row("GBP");
    expect(gbp).toMatchObject({
      leads: 8, open: 2, pendingReferral: 1, rejected: 1, referredOut: 1, lostNI: 1,
      signedReferred: 1, signedInHouse: 2, signed: 3,
    });
    for (const t of [...r.team, r.total]) {
      expect(t.open + t.rejected + t.referredOut + t.lostNI + t.signedReferred + t.signedInHouse, t.group).toBe(t.leads);
      expect(t.signed).toBe(t.signedInHouse + t.signedReferred);
    }
  });

  it("counts one accident once in the unique count", () => {
    expect(row("GBP").unique).toBe(2);
    expect(row("GBP").uniqueInHouse).toBe(1);
  });

  it("leaves BD/FR and non-digital leads out, and merges one brand's spellings", () => {
    expect(r.total.leads).toBe(12);
    expect(row("SEO")).toMatchObject({ leads: 3, signed: 2 });
    const jfj = r.brands.find((b) => b.label === JFJ_WEBSITE)!;
    expect(jfj.leads).toBe(2);
    expect(jfj.members.map((m) => m.source).sort()).toEqual(["Justin For Justice website", "JustinforJustice Website"]);
    expect(r.brands.find((b) => b.label === TOLL_FREE)).toMatchObject({ leads: 1, signed: 1 });
  });

  it("measures GBP and SEO against their monthly targets; Ads has none", () => {
    expect(row("GBP")).toMatchObject({ target: 55, achieved: rate(3, 55), conversion: rate(3, 8) });
    expect(row("SEO").target).toBe(20);
    expect(row("Ads").target).toBeNull();
    expect(row("Ads").achieved).toBeNull();
    expect(r.total.target).toBe(75);
    // Achieved counts only the groups with a target.
    expect(r.total.achieved).toBe(rate(5, 75));
  });

  it("prorates the targets like the Sign-ups scorecard", () => {
    const week = buildDigitalReport(input(rows, { targetMonths: 7 / 30, prorated: true }));
    expect(week.team.find((t) => t.group === "GBP")!.target).toBe(12.8);
  });

  it("shows every SEO brand and ad campaign, with leads or not", () => {
    expect(r.brands.find((b) => b.label === "Collision Repair")).toMatchObject({ leads: 0, conversion: null });
    expect(r.campaigns.map((c) => c.label)).toEqual(["LSA", "Internal PPC", "Social Media", "RND Worx Google Ads"]);
  });

  it("splits the GBP outcomes, PI and non-PI, adding back to its leads", () => {
    const o = Object.fromEntries(r.outcomes.GBP.map((x) => [x.key, x]));
    expect(o.signedInHouse.total).toBe(2);
    expect(o.referredSignedUp).toMatchObject({ total: 1, pi: 0, nonPi: 1 });
    expect(o.referredDeclined).toMatchObject({ total: 1, pi: 0, nonPi: 1 });
    expect(o.pendingReferral.total).toBe(1);
    expect(o.open.total).toBe(1);
    expect(o.lostNI.total).toBe(1);
    expect(r.outcomes.GBP.reduce((a, x) => a + x.total, 0)).toBe(8);
  });

  it("counts sign-ups by Case Value, saying which aren't recorded yet", () => {
    const gbp = Object.fromEntries(r.caseValues.GBP.map((c) => [c.value, c]));
    expect(gbp.Medium).toMatchObject({ inHouse: 2, referred: 0, total: 2, unique: 1 });
    expect(gbp.Low).toMatchObject({ inHouse: 0, referred: 1, total: 1 });
    expect(r.caseValues.SEO.find((c) => c.value === "Not recorded yet")).toMatchObject({ total: 1 });
    expect(r.gaps).toMatchObject({ signed: 5, noCaseValue: 1 });
  });

  it("lists the sign-ups, in-house and referred out", () => {
    expect(r.signups).toHaveLength(5);
    expect(r.signups.filter((s) => s.kind === "referred")).toHaveLength(1);
    expect(r.signups.find((s) => s.kind === "referred")!.label).toBe("GBP Bakersfield");
  });

  it("builds sign-ups up day by day against the target's pace", () => {
    expect(r.cumulative.daily).toBe(true);
    expect(r.cumulative.rows).toHaveLength(30);
    const last = r.cumulative.rows[29];
    expect(last.total).toBe(r.total.signed);
    expect(last.pace).toBe(75);
    expect(r.cumulative.rows[9].total).toBe(r.total.signed);   // all signed on the 10th
    expect(r.cumulative.rows[8].total).toBe(0);
  });
});

describe("buildDigitalReport — ads, spend and trends", () => {
  it("costs each campaign from its sources' spend, never dividing by nothing", () => {
    const rows = [lead("Google Local Services Ads", "Signed"), lead("Google Local Services Ads", "Chase")];
    const r = buildDigitalReport(input(rows, {
      spend: [
        { month: "2026-09", source: "Google Local Services Ads", amount: 300 },
        { month: "2026-09", source: "RND Worx", amount: 500 },
        { month: "2026-08", source: "RND Worx", amount: 999 },       // another month
        { month: "2026-09", source: "Walker Advertising", amount: 5000 },   // not digital
      ],
    }));
    const lsa = r.campaigns.find((c) => c.label === "LSA")!;
    expect(lsa).toMatchObject({ spend: 300, cpl: 150, cpa: 300 });
    const rnd = r.campaigns.find((c) => c.label === "RND Worx Google Ads")!;
    expect(rnd).toMatchObject({ leads: 0, spend: 500, cpl: null, cpa: null });
    expect(r.spend.total).toBe(800);
  });

  it("compares with the period before", () => {
    const r = buildDigitalReport(input([lead("Yelp", "Signed")], { prior: [lead("Yelp", "Chase"), lead("Yelp", "Signed")] }));
    expect(r.prior).toMatchObject({ leads: 2, signed: 1, conversion: 50 });
  });

  it("puts each lead in its Pacific month for the 12-month trend", () => {
    const rows = [
      lead("Avvo", "Signed", { leadDate: new Date("2026-09-01T06:00:00Z") }),   // Aug 31, 11pm Pacific
      lead("Avvo", "Chase", { leadDate: new Date("2026-09-01T08:00:00Z") }),
    ];
    const r = buildDigitalReport(input(rows));
    expect(r.trend.find((t) => t.month === "2026-08")!.SEO).toMatchObject({ leads: 1, signed: 1, signedInHouse: 1 });
    expect(r.trend.find((t) => t.month === "2026-09")!.SEO.leads).toBe(1);
  });
});

describe("periods", () => {
  it("compares with the previous period of equal length", () => {
    expect(priorPeriod("2026-09-01", "2026-09-30")).toEqual({ from: "2026-08-02", to: "2026-08-31" });
    expect(priorPeriod("2026-09-21", "2026-09-27")).toEqual({ from: "2026-09-14", to: "2026-09-20" });
  });
  it("shares the Sign-ups scorecard's proration", () => {
    const at = (d: string) => new Date(d + "T19:00:00Z");
    expect(targetPeriod({ from: at("2026-09-01"), to: at("2026-09-30") }, 1, at("2026-09-30")).prorated).toBe(false);
    const week = targetPeriod({ from: at("2026-09-21"), to: at("2026-09-27") }, 1, at("2026-09-30"));
    expect(week.prorated).toBe(true);
    expect(week.targetMonths).toBeCloseTo(7 / 30);
  });
});
