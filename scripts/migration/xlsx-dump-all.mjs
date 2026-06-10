/**
 * Dumps the structure + sample content of the BDR/FR report workbooks to
 * .tmp-xlsx-dumps/<name>.txt so analysis agents can read them.
 */
import xlsx from "xlsx";
import fs from "fs";
import path from "path";

const FILES = [
  "C:/Users/EOR - 4055/Downloads/MTD BDR CHECK-IN & FR VISIT REPORT (5).xlsx",
  "C:/Users/EOR - 4055/Downloads/MTD BDR CHECK-IN & FR VISIT REPORT (4).xlsx",
  "C:/Users/EOR - 4055/Downloads/MTD BDR CHECK-IN & FR VISIT REPORT (3).xlsx",
  "C:/Users/EOR - 4055/Downloads/MTD NEW FACILITIES REPORT - BDR & FR (1).xlsx",
  "C:/Users/EOR - 4055/Downloads/BDR Daily Calls Tracker (1).xlsx",
  "C:/Users/EOR - 4055/Downloads/BDR_FR Leads Tracker (1).xlsx",
  "C:/Users/EOR - 4055/Downloads/BDR_FR Leads Tracker.xlsx",
  "C:/Users/EOR - 4055/Downloads/Sales Daily Tracker (1).xlsx",
  "C:/Users/EOR - 4055/Downloads/FR _ BDR Compiled Partners.xlsx",
];

const OUT = path.join(process.cwd(), ".tmp-xlsx-dumps");
fs.mkdirSync(OUT, { recursive: true });

for (const file of FILES) {
  if (!fs.existsSync(file)) { console.log("MISSING:", file); continue; }
  const wb = xlsx.readFile(file, { cellFormula: true });
  let out = `FILE: ${path.basename(file)}\nSHEETS (${wb.SheetNames.length}): ${wb.SheetNames.join(" | ")}\n`;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
    out += `\n===== SHEET "${name}" — ${nonEmpty.length} non-empty rows =====\n`;
    // first 30 rows
    const head = rows.slice(0, 30);
    head.forEach((r, i) => {
      const line = r.map((c) => String(c).replace(/\s+/g, " ").slice(0, 24)).join(" | ").slice(0, 700);
      if (line.replace(/[|\s]/g, "") !== "") out += `R${i + 1}: ${line}\n`;
    });
    // last 6 rows (totals usually live here)
    if (rows.length > 36) {
      out += `... (${rows.length - 36} rows skipped) ...\n`;
      rows.slice(-6).forEach((r, i) => {
        const line = r.map((c) => String(c).replace(/\s+/g, " ").slice(0, 24)).join(" | ").slice(0, 700);
        if (line.replace(/[|\s]/g, "") !== "") out += `R${rows.length - 6 + i + 1}: ${line}\n`;
      });
    }
    // sample formulas (up to 15) — these reveal the metric definitions
    const formulas = [];
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith("!")) continue;
      const cell = ws[addr];
      if (cell && cell.f && formulas.length < 15) formulas.push(`${addr} = ${String(cell.f).slice(0, 160)}`);
    }
    if (formulas.length) out += `FORMULAS:\n${formulas.join("\n")}\n`;
  }
  const outFile = path.join(OUT, path.basename(file).replace(/[^a-z0-9]+/gi, "_") + ".txt");
  fs.writeFileSync(outFile, out);
  console.log(`WROTE ${outFile} (${(out.length / 1024).toFixed(1)} KB)`);
}
