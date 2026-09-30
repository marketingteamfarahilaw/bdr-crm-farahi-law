// /bdr/fr-expenses — the Field Rep ledger on its own (the Expenses page shows it as a tab).
import ExpenseLedger from "./expenses/ExpenseLedger";

export default function FrExpenses() {
  return <ExpenseLedger ledger="fr" />;
}
