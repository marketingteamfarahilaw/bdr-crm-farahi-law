import xlsx from "xlsx";
const FILE = process.argv[2] || "C:/Users/EOR - 4055/Downloads/Centralized BDR_FR Reports (3).xlsx";
const wb = xlsx.readFile(FILE);
console.log("SHEETS:", wb.SheetNames.join(" | "));
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
  // first non-empty row = header
  let hi = 0;
  while (hi < rows.length && rows[hi].every((c) => String(c).trim() === "")) hi++;
  const header = rows[hi] || [];
  const dataRows = rows.slice(hi + 1).filter((r) => r.some((c) => String(c).trim() !== ""));
  console.log(`\n===== "${name}" — ${dataRows.length} data rows =====`);
  console.log("COLS:", header.map((h, i) => `[${i}] ${String(h).slice(0, 28)}`).join("  "));
  for (let i = 0; i < Math.min(3, dataRows.length); i++) {
    console.log(`R${i + 1}:`, dataRows[i].map((c) => String(c).slice(0, 22)).join(" | "));
  }
}
