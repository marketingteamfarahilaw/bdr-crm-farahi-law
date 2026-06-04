import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";

const CATEGORIES = [
  { value: "body_shop", label: "Body Shop" },
  { value: "chiropractor", label: "Chiropractor" },
  { value: "physical_therapist", label: "Physical Therapist" },
  { value: "medical_clinic", label: "Medical Clinic" },
  { value: "orthopedic_doctor", label: "Orthopedic Doctor" },
  { value: "imaging_center", label: "Imaging Center" },
  { value: "other", label: "Other" },
];

const STATUSES = [
  { value: "prospect", label: "Prospect" },
  { value: "active_partner", label: "Active Partner" },
  { value: "priority_partner", label: "Priority Partner" },
  { value: "needs_follow_up", label: "Needs Follow-Up" },
  { value: "dormant", label: "Dormant" },
  { value: "do_not_use", label: "Do Not Use" },
];

const BD_REPS = ["Ally", "Genysys", "Grace", "Jezel", "Lupe", "Malvin", "Queenie", "Miguel", "Zulema"];

interface FormState {
  name: string; category: string; address: string; city: string;
  phone: string; phone2: string; phone3: string; website: string;
  contactName: string; contactTitle: string; contactPhone: string; contactEmail: string;
  partnerStatus: string; assignedRepName: string; notes: string;
  managementNote: string; managementFlag: boolean;
}

const EMPTY: FormState = {
  name: "", category: "body_shop", address: "", city: "",
  phone: "", phone2: "", phone3: "", website: "",
  contactName: "", contactTitle: "", contactPhone: "", contactEmail: "",
  partnerStatus: "prospect", assignedRepName: "", notes: "",
  managementNote: "", managementFlag: false,
};

export default function FacilityForm() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const isEdit = !!params.id && params.id !== "new";
  const facilityId = isEdit ? parseInt(params.id!, 10) : undefined;

  const [form, setForm] = useState<FormState>(EMPTY);
  const utils = trpc.useUtils();

  const { data: existing, isLoading } = trpc.crm.facilities.get.useQuery(
    { id: facilityId! },
    { enabled: isEdit }
  );

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name ?? "",
        category: existing.category ?? "body_shop",
        address: existing.address ?? "",
        city: existing.city ?? "",
        phone: existing.phone ?? "",
        phone2: existing.phone2 ?? "",
        phone3: existing.phone3 ?? "",
        website: existing.website ?? "",
        contactName: existing.contactName ?? "",
        contactTitle: existing.contactTitle ?? "",
        contactPhone: existing.contactPhone ?? "",
        contactEmail: existing.contactEmail ?? "",
        partnerStatus: existing.partnerStatus ?? "prospect",
        assignedRepName: existing.assignedRepName ?? "",
        notes: existing.notes ?? "",
        managementNote: existing.managementNote ?? "",
        managementFlag: existing.managementFlag === 1,
      });
    }
  }, [existing]);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const createFacility = trpc.crm.facilities.create.useMutation({
    onSuccess: () => {
      toast.success("Facility created");
      utils.crm.facilities.list.invalidate();
      navigate("/crm/facilities");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateFacility = trpc.crm.facilities.update.useMutation({
    onSuccess: () => {
      toast.success("Facility updated");
      utils.crm.facilities.list.invalidate();
      utils.crm.facilities.get.invalidate({ id: facilityId! });
      navigate(`/crm/facilities/${facilityId}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!form.name) { toast.error("Facility name is required"); return; }
    const payload = {
      name: form.name,
      category: form.category as any,
      address: form.address || undefined,
      city: form.city || undefined,
      phone: form.phone || undefined,
      phone2: form.phone2 || undefined,
      phone3: form.phone3 || undefined,
      website: form.website || undefined,
      contactName: form.contactName || undefined,
      contactTitle: form.contactTitle || undefined,
      contactPhone: form.contactPhone || undefined,
      contactEmail: form.contactEmail || undefined,
      partnerStatus: form.partnerStatus as any,
      assignedRepName: form.assignedRepName || undefined,
      notes: form.notes || undefined,
      managementNote: form.managementNote || undefined,
    };
    if (isEdit) {
      updateFacility.mutate({ id: facilityId!, ...payload, managementFlag: form.managementFlag });
    } else {
      createFacility.mutate(payload);
    }
  };

  if (isEdit && isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const isPending = createFacility.isPending || updateFacility.isPending;

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <button
          onClick={() => navigate(isEdit ? `/crm/facilities/${facilityId}` : "/crm/facilities")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {isEdit ? "Back to Profile" : "Back to Facilities"}
        </button>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
          {isEdit ? "Edit Facility" : "Add New Facility"}
        </h1>
      </div>

      {/* Basic Info */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-4"><CardTitle className="text-sm">Facility Information</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Facility Name *</label>
              <Input value={form.name} onChange={set("name")} placeholder="ABC Body Shop" className="bg-background border-border" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Category *</label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Address</label>
              <Input value={form.address} onChange={set("address")} placeholder="123 Main St" className="bg-background border-border" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">City</label>
              <Input value={form.city} onChange={set("city")} placeholder="Los Angeles" className="bg-background border-border" />
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Phone 1</label>
              <Input value={form.phone} onChange={set("phone")} placeholder="(310) 555-0100" className="bg-background border-border" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Phone 2</label>
              <Input value={form.phone2} onChange={set("phone2")} placeholder="(310) 555-0101" className="bg-background border-border" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Phone 3</label>
              <Input value={form.phone3} onChange={set("phone3")} placeholder="(310) 555-0102" className="bg-background border-border" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Website</label>
            <Input value={form.website} onChange={set("website")} placeholder="https://example.com" className="bg-background border-border" />
          </div>
        </CardContent>
      </Card>

      {/* Contact Person */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-4"><CardTitle className="text-sm">Primary Contact</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contact Name</label>
              <Input value={form.contactName} onChange={set("contactName")} placeholder="Dr. John Smith" className="bg-background border-border" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Title / Role</label>
              <Input value={form.contactTitle} onChange={set("contactTitle")} placeholder="Office Manager" className="bg-background border-border" />
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contact Phone</label>
              <Input value={form.contactPhone} onChange={set("contactPhone")} placeholder="(310) 555-0200" className="bg-background border-border" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contact Email</label>
              <Input value={form.contactEmail} onChange={set("contactEmail")} placeholder="john@example.com" type="email" className="bg-background border-border" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Relationship */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-4"><CardTitle className="text-sm">Relationship</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Relationship Status</label>
              <Select value={form.partnerStatus} onValueChange={(v) => setForm((f) => ({ ...f, partnerStatus: v }))}>
                <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Assigned BD Rep</label>
              <Select value={form.assignedRepName} onValueChange={(v) => setForm((f) => ({ ...f, assignedRepName: v }))}>
                <SelectTrigger className="bg-background border-border"><SelectValue placeholder="Select rep..." /></SelectTrigger>
                <SelectContent>
                  {BD_REPS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
            <Textarea value={form.notes} onChange={set("notes")} rows={3} placeholder="Relationship notes, history, preferences..." className="bg-background border-border resize-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Management Note (visible to admins)</label>
            <Textarea value={form.managementNote} onChange={set("managementNote")} rows={2} placeholder="Escalation notes for management..." className="bg-background border-border resize-none" />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mgmtFlag"
              checked={form.managementFlag}
              onChange={(e) => setForm((f) => ({ ...f, managementFlag: e.target.checked }))}
              className="w-4 h-4 accent-amber-400"
            />
            <label htmlFor="mgmtFlag" className="text-sm text-muted-foreground cursor-pointer">
              Flag for management attention
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button
          onClick={handleSubmit}
          disabled={isPending}
          className="gap-2"
          style={{ background: "var(--gold)", color: "#0a0f1e" }}
        >
          <Save className="w-4 h-4" />
          {isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Facility"}
        </Button>
        <Button
          variant="outline"
          className="border-border"
          onClick={() => navigate(isEdit ? `/crm/facilities/${facilityId}` : "/crm/facilities")}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
