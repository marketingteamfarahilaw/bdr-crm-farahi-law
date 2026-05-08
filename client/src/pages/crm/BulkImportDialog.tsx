import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, FileText, CheckCircle2, AlertCircle, Download } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── CSV parsing ─────────────────────────────────────────────────────────────

const CATEGORIES = [
  "body_shop", "chiropractor", "physical_therapist",
  "medical_clinic", "orthopedic_doctor", "imaging_center", "other",
] as const;

const RELATIONSHIP_STATUSES = [
  "active_partner", "warm_lead", "cold", "churned", "do_not_contact", "needs_agent",
] as const;

type FacilityRow = {
  name: string;
  category: (typeof CATEGORIES)[number];
  address?: string;
  city?: string;
  phone?: string;
  phone2?: string;
  website?: string;
  contactName?: string;
  contactTitle?: string;
  contactPhone?: string;
  contactEmail?: string;
  assignedRepName?: string;
  relationshipStatus: (typeof RELATIONSHIP_STATUSES)[number];
  notes?: string;
};

function parseCSV(text: string): { rows: FacilityRow[]; errors: string[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { rows: [], errors: ["CSV must have a header row and at least one data row."] };

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows: FacilityRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] ?? ""; });

    const name = obj["name"] || obj["facility_name"] || obj["business_name"] || "";
    if (!name) { errors.push(`Row ${i + 1}: missing name — skipped`); continue; }

    const rawCat = (obj["category"] || "other").toLowerCase().replace(/\s+/g, "_");
    const category = CATEGORIES.includes(rawCat as any) ? (rawCat as (typeof CATEGORIES)[number]) : "other";

    const rawStatus = (obj["relationship_status"] || obj["status"] || "warm_lead").toLowerCase().replace(/\s+/g, "_");
    const relationshipStatus = RELATIONSHIP_STATUSES.includes(rawStatus as any)
      ? (rawStatus as (typeof RELATIONSHIP_STATUSES)[number])
      : "warm_lead";

    rows.push({
      name,
      category,
      relationshipStatus,
      address: obj["address"] || undefined,
      city: obj["city"] || undefined,
      phone: obj["phone"] || obj["phone_1"] || undefined,
      phone2: obj["phone_2"] || obj["phone2"] || undefined,
      website: obj["website"] || undefined,
      contactName: obj["contact_name"] || obj["contact"] || undefined,
      contactTitle: obj["contact_title"] || obj["title"] || undefined,
      contactPhone: obj["contact_phone"] || undefined,
      contactEmail: obj["contact_email"] || obj["email"] || undefined,
      assignedRepName: obj["assigned_rep"] || obj["bd_rep"] || obj["rep"] || undefined,
      notes: obj["notes"] || undefined,
    });
  }

  return { rows, errors };
}

const TEMPLATE_CSV = `name,category,address,city,phone,phone2,website,contact_name,contact_title,contact_phone,contact_email,assigned_rep,relationship_status,notes
Sunshine Body Shop,body_shop,123 Main St,Los Angeles,310-555-0100,,https://sunshinebody.com,John Smith,Owner,310-555-0101,john@sunshinebody.com,Ally,warm_lead,Good relationship
Pacific Chiropractic,chiropractor,456 Ocean Ave,Santa Monica,310-555-0200,,,Dr. Jane Doe,Doctor,,,Grace,active_partner,Sends 3-4 cases/month
`;

// ─── Component ───────────────────────────────────────────────────────────────

interface BulkImportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function BulkImportDialog({ open, onClose }: BulkImportDialogProps) {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<"upload" | "paste">("upload");
  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState<FacilityRow[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const bulkCreate = trpc.crm.facilities.bulkCreate.useMutation({
    onSuccess: (data) => {
      toast.success(`Imported ${data.created} facilities${data.skipped > 0 ? ` (${data.skipped} skipped)` : ""}.`);
      utils.crm.facilities.list.invalidate();
      handleClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleClose = () => {
    setPreview(null);
    setParseErrors([]);
    setPasteText("");
    setTab("upload");
    onClose();
  };

  const processText = (text: string) => {
    const { rows, errors } = parseCSV(text);
    setPreview(rows);
    setParseErrors(errors);
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => processText(e.target?.result as string);
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = () => {
    if (!preview || preview.length === 0) return;
    bulkCreate.mutate({ facilities: preview });
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "farahi_facilities_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Bulk Import Facilities
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Upload a CSV file or paste CSV data to add multiple facilities at once.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Need a template?</span>
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7" onClick={downloadTemplate}>
                <Download size={12} /> Download CSV Template
              </Button>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
              <TabsList className="bg-background border border-border w-full">
                <TabsTrigger value="upload" className="flex-1">Upload CSV File</TabsTrigger>
                <TabsTrigger value="paste" className="flex-1">Paste CSV Data</TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="mt-4">
                <div
                  className={cn(
                    "border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer",
                    isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  )}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">Drop your CSV file here</p>
                  <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  />
                </div>
              </TabsContent>

              <TabsContent value="paste" className="mt-4">
                <textarea
                  className="w-full h-48 rounded-lg border border-border bg-background text-foreground text-xs p-3 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder={`name,category,phone,city,...\nSunshine Body Shop,body_shop,310-555-0100,Los Angeles,...`}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <Button
                  className="mt-2 w-full"
                  variant="outline"
                  onClick={() => processText(pasteText)}
                  disabled={!pasteText.trim()}
                >
                  <FileText size={14} className="mr-2" /> Parse CSV
                </Button>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 size={16} />
                <span className="text-sm font-medium">{preview.length} facilities ready to import</span>
              </div>
              {parseErrors.length > 0 && (
                <div className="flex items-center gap-2 text-amber-400">
                  <AlertCircle size={16} />
                  <span className="text-sm">{parseErrors.length} rows skipped</span>
                </div>
              )}
            </div>

            {/* Errors */}
            {parseErrors.length > 0 && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-300 space-y-1 max-h-24 overflow-y-auto">
                {parseErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}

            {/* Preview table */}
            <div className="rounded-lg border border-border overflow-hidden max-h-56 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-card sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">Name</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">Category</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">Phone</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">City</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-t border-border hover:bg-card/60">
                      <td className="px-3 py-2 font-medium text-foreground">{row.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.category.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.phone ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.city ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.relationshipStatus.replace(/_/g, " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => { setPreview(null); setParseErrors([]); }}
            >
              ← Back to upload
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} className="border-border">
            Cancel
          </Button>
          {preview && preview.length > 0 && (
            <Button
              onClick={handleImport}
              disabled={bulkCreate.isPending}
              style={{ background: "var(--gold)", color: "#0a0f1e" }}
            >
              {bulkCreate.isPending ? "Importing..." : `Import ${preview.length} Facilities`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
