/**
 * Exports the CRM-vs-Filevine verification to an Excel workbook for the team:
 *   Summary · Agent Mismatches · Name Conflicts · Not in Filevine · Missing from CRM
 * Reads the report JSONs produced by verify-vs-filevine.mjs + verify-filevine-integrity.mjs.
 *
 * Run: node scripts/migration/export-filevine-verification.mjs
 */
import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";
import { formatInTimeZone } from "date-fns-tz";

const rep = JSON.parse(fs.readFileSync("scripts/migration/verify-vs-filevine-report.json", "utf8"));
const integ = JSON.parse(fs.readFileSync("scripts/migration/verify-filevine-integrity-report.json", "utf8"));
const c = rep.counts;
const fn = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase().replace(/@.*/, "").split(/\s+/)[0] || "";

const wb = xlsx.utils.book_new();

const summary = [
  ["FARAHI LAW — CRM vs FILEVINE VERIFICATION", ""],
  ["Generated (Pacific)", formatInTimeZone(new Date(), "America/Los_Angeles", "yyyy-MM-dd HH:mm")],
  ["Source of truth", "Filevine 'List of Projects' export (2026-06-16)"],
  ["", ""],
  ["Filevine partner projects", c.fv],
  ["  — distinct names", c.fvDistinct],
  ["CRM facilities", c.crm],
  ["", ""],
  ["CRM names confirmed in Filevine", c.matchedByName],
  ["  — assigned-agent differs from Filevine", c.agentMismatch],
  ["CRM names matched only by (scrambled) phone — review", c.matchedByPhoneOnly],
  ["CRM facilities not found in Filevine", c.notInFilevine],
  ["Filevine partners MISSING from CRM (distinct)", c.fvMissing],
  ["", ""],
  ["Filevine integrity test (Google Places)", `${integ.alignment.eitherOk}/${integ.alignment.n} names confirmed; failures were generic/placeholder names, not column misalignment`],
  ["Verdict", "Filevine name/address/phone columns are ALIGNED → trustworthy source of truth (unlike the prior Excel)"],
];
xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(summary), "Summary");

// Agent mismatches
const am = [["CRM ID", "Facility", "CRM agent", "Filevine agent", "Note"]];
for (const x of rep.agentMismatch) {
  const note = fn(x.agentFV) === "justin" ? "Filevine=Justin (likely admin default)" : "";
  am.push([x.id, x.crmName, x.agentCRM, x.agentFV, note]);
}
xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(am), `Agent Mismatches (${rep.agentMismatch.length})`);

// Name conflicts (with Google)
const nc = [["CRM ID", "CRM name", "Filevine name", "Google says (CRM name)", "Google says (FV name)", "Assessment"]];
const assess = (x) => {
  if (x.id === 451108) return "CRM 'Katlyn' is a person/placeholder — FV name likely correct (verify address)";
  if (x.id === 451842) return "CRM name is MORE specific than FV's generic 'Collision Center' — keep CRM";
  return "Phone-match only (phone column scrambled) — likely different businesses; do NOT change";
};
for (const x of integ.conflicts) nc.push([x.id, x.crmName, x.fvName, x.googleForCRM, x.googleForFV, assess(x)]);
xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(nc), `Name Conflicts (${integ.conflicts.length})`);

// Not in Filevine
const ni = [["CRM ID", "Facility", "CRM agent", "Phone", "City"]];
for (const x of rep.notInFilevine) ni.push([x.id, x.name, x.agent, x.phone, x.city]);
xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(ni), `Not in Filevine (${rep.notInFilevine.length})`);

// Missing from CRM
const mi = [["Filevine partner", "Filevine agent", "Phase", "Address"]];
for (const x of rep.fvMissing) mi.push([x.name, x.agent, x.phase, x.addr]);
xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(mi), `Missing from CRM (${rep.fvMissing.length})`);

const stamp = formatInTimeZone(new Date(), "America/Los_Angeles", "yyyy-MM-dd");
const out = `C:/Users/EOR - 4055/Downloads/Farahi CRM vs Filevine ${stamp}.xlsx`;
xlsx.writeFile(wb, out);
console.log("EXPORTED →", out);
