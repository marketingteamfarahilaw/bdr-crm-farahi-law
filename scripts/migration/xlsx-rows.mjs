import xlsx from "xlsx";
const wb = xlsx.readFile("C:/Users/EOR - 4055/Downloads/Centralized BDR_FR Reports (3).xlsx", { cellDates: true });
for (const name of process.argv.slice(2)) {
  const ws = wb.Sheets[name];
  if (!ws) { console.log("missing:", name); continue; }
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
  console.log(`\n===== ${name} =====`);
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    console.log(`[${i}]`, rows[i].slice(0, 22).map((c) => String(c instanceof Date ? c.toISOString().slice(0, 10) : c).slice(0, 16)).join(" | "));
  }
}
