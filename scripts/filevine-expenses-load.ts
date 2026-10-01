/**
 * Loads FR expenses read from Filevine into filevine_expenses, on the server —
 * the same thing Expenses → "FR: Filevine vs Sheet" → Load Filevine export
 * does. Run by the "Load Filevine expenses" workflow, which hands the rows
 * over in FV_DATA as base64 of gzipped JSON: { cols: [...], rows: [[...]] }.
 * The rows are pulled from Filevine with Claude's Filevine connector, since
 * the CRM's own API login still waits on a working client secret.
 *
 *   FV_DATA=… npx tsx scripts/filevine-expenses-load.ts
 */
import "dotenv/config";
import { gunzipSync } from "node:zlib";
import { importFilevineExpenses, type FvExpenseInput } from "../server/filevineExpenses";

const raw = process.env.FV_DATA?.trim();
if (!raw) { console.log("FAILED: no FV_DATA"); process.exit(1); }
const { cols, rows } = JSON.parse(gunzipSync(Buffer.from(raw, "base64")).toString("utf8")) as { cols: string[]; rows: unknown[][] };
const at = (name: string) => cols.indexOf(name);
const text = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const input: FvExpenseInput[] = rows.map((r) => ({
  itemId: String(r[at("itemId")]),
  projectId: Number(r[at("projectId")]),
  rep: String(r[at("rep")]),
  day: text(r[at("day")]),
  entered: text(r[at("entered")]),
  type: text(r[at("type")]),
  store: text(r[at("store")]),
  amount: Number(r[at("amount")]),
  payment: text(r[at("payment")]),
  requestedBy: text(r[at("requestedBy")]),
  enteredBy: text(r[at("enteredBy")]),
}));
const result = await importFilevineExpenses(input);
console.log(`LOADED ${result.imported} Filevine expenses for ${result.projects} projects (${result.skipped} skipped)`);
process.exit(0);
