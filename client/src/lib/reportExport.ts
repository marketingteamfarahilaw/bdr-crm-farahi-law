import * as XLSX from "xlsx";

const fmtRow = (r: Record<string, any>) => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(r)) {
    out[k] = k === "date" && v ? new Date(v).toLocaleDateString() : v;
  }
  return out;
};

/** Build a multi-sheet .xlsx workbook from an agent report and trigger download. */
export function exportReportToExcel(report: any, agentLabel: string, rangeLabel: string) {
  const wb = XLSX.utils.book_new();
  const k = report.kpis;

  const summary = [
    ["Farahi Law — Activity Report"],
    ["Agent", agentLabel],
    ["Period", rangeLabel],
    [],
    ["Metric", "Value"],
    ["Calls (total)", k.callsTotal],
    ["  Connected", k.callsConnected],
    ["  Voicemail", k.callsVoicemail],
    ["Partner check-ins", k.partnerCheckins],
    ["Leads sent", k.leadsSent],
    ["Leads received", k.leadsReceived],
    ["Signed cases", k.signedCases],
    ["Field visits", k.visits],
    ["Facilities visited", k.facilitiesVisited],
    ["Hours worked", k.hours],
    ["Errands (total)", k.errandsTotal],
    ["Errands completed", k.errandsCompleted],
    ["Referral rewards (total)", k.rewardsTotal],
    ["  Accepted", k.rewardsAccepted],
    ["Payouts ($)", Number(k.payoutTotal.toFixed(2))],
    ["FR expenses ($)", Number(k.frExpenseTotal.toFixed(2))],
    ["BDR expenses ($)", Number(k.bdrExpenseTotal.toFixed(2))],
    ["Total expenses ($)", Number(k.expenseTotal.toFixed(2))],
  ];
  const sumWs = XLSX.utils.aoa_to_sheet(summary);
  sumWs["!cols"] = [{ wch: 26 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, sumWs, "Summary");

  const addSheet = (name: string, rows: any[]) => {
    if (rows && rows.length) {
      const ws = XLSX.utils.json_to_sheet(rows.map(fmtRow));
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
  };
  addSheet("Calls", report.detail.calls);
  addSheet("Leads", report.detail.leads);
  addSheet("Visits", report.detail.visits);
  addSheet("Rewards", report.detail.rewards);
  addSheet("Errands", report.detail.errands);
  addSheet("Expenses", report.detail.expenses);

  const safe = `${agentLabel}-${rangeLabel}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  XLSX.writeFile(wb, `farahi-report-${safe}.xlsx`);
}
