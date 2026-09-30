// /bdr/bdr-expenses — the BDR ledger on its own (the Expenses page shows it as a tab).
import ExpenseLedger from "./expenses/ExpenseLedger";

export default function BdrExpenses() {
  return <ExpenseLedger ledger="bdr" />;
}
