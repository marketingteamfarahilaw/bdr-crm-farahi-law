import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Check, FileText } from "lucide-react";
import { toast } from "sonner";

const TYPES = ["Call", "Visit", "Lunch / Drop-in", "Meeting", "Delivery", "Text", "Email", "Other"];
const todayLA = () => new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "long", day: "numeric" });

export default function FileVineNote() {
  const { user } = useAuth();
  const [f, setF] = useState({ date: todayLA(), partner: "", type: "Call", contactName: "", contactRole: "", summary: "", amount: "", category: "", nextStep: "" });
  const [copied, setCopied] = useState(false);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });

  const note = useMemo(() => {
    const lines = [`${f.date} — ${f.partner || "[Partner]"} — ${f.type}`, ""];
    lines.push(`Contact: ${[f.contactName, f.contactRole].filter(Boolean).join(", ") || "—"}`, "");
    lines.push(`Summary: ${f.summary || "—"}`, "");
    if (f.amount || f.category) lines.push(`Expenses: $${f.amount || "0"} — ${f.category || "—"}`, "");
    lines.push(`Next Step: ${f.nextStep || "—"}`, "");
    lines.push(`Logged by: ${user?.name ?? user?.email ?? "—"}`);
    return lines.join("\n");
  }, [f, user]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(note); setCopied(true); toast.success("Note copied — paste into FileVine"); setTimeout(() => setCopied(false), 1800); }
    catch { toast.error("Couldn't access clipboard"); }
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>FileVine Note Generator</h1>
        <p className="text-sm text-muted-foreground mt-1">Format a call or visit note the way FileVine likes it, then copy it in one click.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><Input value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
              <Field label="Interaction type">
                <Select value={f.type} onValueChange={(v) => set("type", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
              </Field>
            </div>
            <Field label="Partner / facility"><Input value={f.partner} onChange={(e) => set("partner", e.target.value)} placeholder="Tip Top Auto Body Shop" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact name"><Input value={f.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="Jaron" /></Field>
              <Field label="Contact role"><Input value={f.contactRole} onChange={(e) => set("contactRole", e.target.value)} placeholder="Manager" /></Field>
            </div>
            <Field label="Summary"><textarea className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[80px]" value={f.summary} onChange={(e) => set("summary", e.target.value)} placeholder="What was discussed and the outcome…" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expense amount ($)"><Input value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="25" /></Field>
              <Field label="Expense category"><Input value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="food delivery" /></Field>
            </div>
            <Field label="Next step"><Input value={f.nextStep} onChange={(e) => set("nextStep", e.target.value)} placeholder="Schedule visit next week" /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" /> Preview</CardTitle>
            <Button size="sm" onClick={copy}>{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? "Copied" : "Copy"}</Button>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm text-foreground bg-muted/40 rounded-lg p-4 font-mono leading-relaxed min-h-[260px]">{note}</pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>{children}</div>;
}
