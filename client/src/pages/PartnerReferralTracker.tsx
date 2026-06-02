import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, ArrowUpRight, ArrowDownLeft, Download } from "lucide-react";

const AGENTS = ["Gracel", "Queenie", "Ally", "Miguel", "Rupert"];

const OUTBOUND_STATUSES = [
  "Pending Review",
  "Assigned to Agent",
  "Facility Selected",
  "Referral Sent",
  "Facility Confirmed",
  "Client Scheduled",
  "Client Attended",
  "Issue / Needs Follow-Up",
  "Completed",
  "Not Referred",
] as const;

type OutboundStatus = typeof OUTBOUND_STATUSES[number];

const STATUS_COLORS: Record<OutboundStatus, string> = {
  "Pending Review": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "Assigned to Agent": "bg-blue-100 text-blue-800 border-blue-200",
  "Facility Selected": "bg-indigo-100 text-indigo-800 border-indigo-200",
  "Referral Sent": "bg-purple-100 text-purple-800 border-purple-200",
  "Facility Confirmed": "bg-cyan-100 text-cyan-800 border-cyan-200",
  "Client Scheduled": "bg-orange-100 text-orange-800 border-orange-200",
  "Client Attended": "bg-teal-100 text-teal-800 border-teal-200",
  "Issue / Needs Follow-Up": "bg-red-100 text-red-800 border-red-200",
  "Completed": "bg-green-100 text-green-800 border-green-200",
  "Not Referred": "bg-gray-100 text-gray-700 border-gray-200",
};

// ─── Outbound Form ────────────────────────────────────────────────────────────

type OutboundForm = {
  clientName: string;
  filevineLinkOrRef: string;
  clientAddress: string;
  clientCity: string;
  clientZip: string;
  dateSigned: string;
  referralNeeded: boolean;
  referralType: string;
  assignedAgent: string;
  recommendedFacility: string;
  facilityOwner: string;
  distanceTravelTime: string;
  reasonForSelection: string;
  referralSentDate: string;
  status: OutboundStatus;
  followUpDate: string;
  facilityConfirmed: boolean;
  clientScheduled: boolean;
  clientAttended: boolean;
  facilityHadSentLeads: boolean;
  notes: string;
  lastUpdatedBy: string;
};

const defaultOutbound: OutboundForm = {
  clientName: "",
  filevineLinkOrRef: "",
  clientAddress: "",
  clientCity: "",
  clientZip: "",
  dateSigned: "",
  referralNeeded: true,
  referralType: "",
  assignedAgent: "",
  recommendedFacility: "",
  facilityOwner: "",
  distanceTravelTime: "",
  reasonForSelection: "",
  referralSentDate: "",
  status: "Pending Review",
  followUpDate: "",
  facilityConfirmed: false,
  clientScheduled: false,
  clientAttended: false,
  facilityHadSentLeads: false,
  notes: "",
  lastUpdatedBy: "",
};

// ─── Inbound Form ─────────────────────────────────────────────────────────────

type InboundForm = {
  leadName: string;
  dateReceived: string;
  referringFacility: string;
  facilityContact: string;
  assignedAgent: string;
  caseType: string;
  signed: boolean;
  signedDate: string;
  notSignedReason: string;
  countsTowardPartnerActivity: boolean;
  notes: string;
};

const defaultInbound: InboundForm = {
  leadName: "",
  dateReceived: new Date().toISOString().split("T")[0],
  referringFacility: "",
  facilityContact: "",
  assignedAgent: "",
  caseType: "",
  signed: false,
  signedDate: "",
  notSignedReason: "",
  countsTowardPartnerActivity: true,
  notes: "",
};

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  return [headers, ...rows]
    .map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PartnerReferralTracker() {
  const utils = trpc.useUtils();

  // Outbound queries/mutations
  const { data: outboundList, isLoading: outboundLoading } = trpc.referralWorkflow.outbound.list.useQuery();
  const createOutbound = trpc.referralWorkflow.outbound.create.useMutation({
    onSuccess: () => { utils.referralWorkflow.outbound.list.invalidate(); toast.success("Outbound referral added"); setOutboundOpen(false); setOutboundForm(defaultOutbound); },
    onError: (e) => toast.error(e.message),
  });
  const updateOutbound = trpc.referralWorkflow.outbound.update.useMutation({
    onSuccess: () => { utils.referralWorkflow.outbound.list.invalidate(); toast.success("Referral updated"); setOutboundOpen(false); setEditingOutbound(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteOutbound = trpc.referralWorkflow.outbound.delete.useMutation({
    onSuccess: () => { utils.referralWorkflow.outbound.list.invalidate(); toast.success("Referral deleted"); },
    onError: (e) => toast.error(e.message),
  });

  // Inbound queries/mutations
  const { data: inboundList, isLoading: inboundLoading } = trpc.referralWorkflow.inbound.list.useQuery();
  const createInbound = trpc.referralWorkflow.inbound.create.useMutation({
    onSuccess: () => { utils.referralWorkflow.inbound.list.invalidate(); toast.success("Inbound lead added"); setInboundOpen(false); setInboundForm(defaultInbound); },
    onError: (e) => toast.error(e.message),
  });
  const updateInbound = trpc.referralWorkflow.inbound.update.useMutation({
    onSuccess: () => { utils.referralWorkflow.inbound.list.invalidate(); toast.success("Lead updated"); setInboundOpen(false); setEditingInbound(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteInbound = trpc.referralWorkflow.inbound.delete.useMutation({
    onSuccess: () => { utils.referralWorkflow.inbound.list.invalidate(); toast.success("Lead deleted"); },
    onError: (e) => toast.error(e.message),
  });

  // Outbound dialog state
  const [outboundOpen, setOutboundOpen] = useState(false);
  const [editingOutbound, setEditingOutbound] = useState<number | null>(null);
  const [outboundForm, setOutboundForm] = useState<OutboundForm>(defaultOutbound);

  // Inbound dialog state
  const [inboundOpen, setInboundOpen] = useState(false);
  const [editingInbound, setEditingInbound] = useState<number | null>(null);
  const [inboundForm, setInboundForm] = useState<InboundForm>(defaultInbound);

  function openCreateOutbound() { setEditingOutbound(null); setOutboundForm(defaultOutbound); setOutboundOpen(true); }
  function openEditOutbound(r: NonNullable<typeof outboundList>[0]) {
    setEditingOutbound(r.id);
    setOutboundForm({
      clientName: r.clientName,
      filevineLinkOrRef: r.filevineLinkOrRef ?? "",
      clientAddress: r.clientAddress ?? "",
      clientCity: r.clientCity ?? "",
      clientZip: r.clientZip ?? "",
      dateSigned: r.dateSigned ? new Date(r.dateSigned).toISOString().split("T")[0] : "",
      referralNeeded: r.referralNeeded ?? true,
      referralType: r.referralType ?? "",
      assignedAgent: r.assignedAgent ?? "",
      recommendedFacility: r.recommendedFacility ?? "",
      facilityOwner: r.facilityOwner ?? "",
      distanceTravelTime: r.distanceTravelTime ?? "",
      reasonForSelection: r.reasonForSelection ?? "",
      referralSentDate: r.referralSentDate ? new Date(r.referralSentDate).toISOString().split("T")[0] : "",
      status: (r.status as OutboundStatus) ?? "Pending Review",
      followUpDate: r.followUpDate ? new Date(r.followUpDate).toISOString().split("T")[0] : "",
      facilityConfirmed: r.facilityConfirmed ?? false,
      clientScheduled: r.clientScheduled ?? false,
      clientAttended: r.clientAttended ?? false,
      facilityHadSentLeads: r.facilityHadSentLeads ?? false,
      notes: r.notes ?? "",
      lastUpdatedBy: r.lastUpdatedBy ?? "",
    });
    setOutboundOpen(true);
  }

  function openCreateInbound() { setEditingInbound(null); setInboundForm(defaultInbound); setInboundOpen(true); }
  function openEditInbound(l: NonNullable<typeof inboundList>[0]) {
    setEditingInbound(l.id);
    setInboundForm({
      leadName: l.leadName,
      dateReceived: l.dateReceived ? new Date(l.dateReceived).toISOString().split("T")[0] : "",
      referringFacility: l.referringFacility ?? "",
      facilityContact: l.facilityContact ?? "",
      assignedAgent: l.assignedAgent ?? "",
      caseType: l.caseType ?? "",
      signed: l.signed ?? false,
      signedDate: l.signedDate ? new Date(l.signedDate).toISOString().split("T")[0] : "",
      notSignedReason: l.notSignedReason ?? "",
      countsTowardPartnerActivity: l.countsTowardPartnerActivity ?? true,
      notes: l.notes ?? "",
    });
    setInboundOpen(true);
  }

  function submitOutbound() {
    if (!outboundForm.clientName) return toast.error("Client name required");
    const payload = {
      ...outboundForm,
      dateSigned: outboundForm.dateSigned || undefined,
      referralSentDate: outboundForm.referralSentDate || undefined,
      followUpDate: outboundForm.followUpDate || undefined,
    };
    if (editingOutbound !== null) {
      updateOutbound.mutate({ id: editingOutbound, ...payload });
    } else {
      createOutbound.mutate(payload);
    }
  }

  function submitInbound() {
    if (!inboundForm.leadName) return toast.error("Lead name required");
    const payload = {
      ...inboundForm,
      dateReceived: inboundForm.dateReceived || undefined,
      signedDate: inboundForm.signedDate || undefined,
    };
    if (editingInbound !== null) {
      updateInbound.mutate({ id: editingInbound, ...payload });
    } else {
      createInbound.mutate(payload);
    }
  }

  function exportOutbound() {
    if (!outboundList?.length) return;
    const headers = ["Client Name", "Filevine Ref", "Address", "City", "ZIP", "Date Signed", "Referral Needed", "Referral Type", "Agent", "Facility", "Facility Owner", "Distance", "Reason", "Sent Date", "Status", "Follow-Up Date", "Facility Confirmed", "Client Scheduled", "Client Attended", "Facility Sent Leads", "Notes", "Last Updated By"];
    const rows = outboundList.map(r => [
      r.clientName, r.filevineLinkOrRef ?? "", r.clientAddress ?? "", r.clientCity ?? "", r.clientZip ?? "",
      r.dateSigned ? new Date(r.dateSigned).toLocaleDateString() : "",
      r.referralNeeded ? "Yes" : "No", r.referralType ?? "", r.assignedAgent ?? "", r.recommendedFacility ?? "",
      r.facilityOwner ?? "", r.distanceTravelTime ?? "", r.reasonForSelection ?? "",
      r.referralSentDate ? new Date(r.referralSentDate).toLocaleDateString() : "",
      r.status ?? "", r.followUpDate ? new Date(r.followUpDate).toLocaleDateString() : "",
      r.facilityConfirmed ? "Yes" : "No", r.clientScheduled ? "Yes" : "No", r.clientAttended ? "Yes" : "No",
      r.facilityHadSentLeads ? "Yes" : "No", r.notes ?? "", r.lastUpdatedBy ?? "",
    ]);
    downloadCsv(toCsv(headers, rows), `outbound-referrals-${new Date().toISOString().split("T")[0]}.csv`);
    toast.success(`Exported ${outboundList.length} outbound referrals`);
  }

  function exportInbound() {
    if (!inboundList?.length) return;
    const headers = ["Lead Name", "Date Received", "Referring Facility", "Facility Contact", "Agent", "Case Type", "Signed", "Signed Date", "Not Signed Reason", "Counts Toward Activity", "Notes"];
    const rows = inboundList.map(l => [
      l.leadName, l.dateReceived ? new Date(l.dateReceived).toLocaleDateString() : "",
      l.referringFacility ?? "", l.facilityContact ?? "", l.assignedAgent ?? "", l.caseType ?? "",
      l.signed ? "Yes" : "No", l.signedDate ? new Date(l.signedDate).toLocaleDateString() : "",
      l.notSignedReason ?? "", l.countsTowardPartnerActivity ? "Yes" : "No", l.notes ?? "",
    ]);
    downloadCsv(toCsv(headers, rows), `inbound-leads-${new Date().toISOString().split("T")[0]}.csv`);
    toast.success(`Exported ${inboundList.length} inbound leads`);
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Partner Referral Tracker</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Centralized log of outbound referrals sent to facilities and inbound leads received from partners
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-indigo-600">{outboundList?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">Outbound Referrals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-emerald-600">{inboundList?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">Inbound Leads</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-teal-600">{inboundList?.filter(l => l.signed).length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">Signed from Partners</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-orange-600">
              {outboundList?.filter(r => r.status === "Issue / Needs Follow-Up" || r.status === "Pending Review").length ?? 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Needs Attention</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="outbound">
        <TabsList>
          <TabsTrigger value="outbound" className="gap-2">
            <ArrowUpRight className="w-4 h-4" /> Outbound Referrals
          </TabsTrigger>
          <TabsTrigger value="inbound" className="gap-2">
            <ArrowDownLeft className="w-4 h-4" /> Inbound Leads
          </TabsTrigger>
        </TabsList>

        {/* ── Outbound Tab ── */}
        <TabsContent value="outbound" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{outboundList?.length ?? 0} referrals logged</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={exportOutbound} disabled={!outboundList?.length}>
                <Download className="w-4 h-4 mr-2" /> Export CSV
              </Button>
              <Button onClick={openCreateOutbound}><Plus className="w-4 h-4 mr-2" /> Add Referral</Button>
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              {outboundLoading ? (
                <p className="text-muted-foreground text-sm p-6">Loading...</p>
              ) : !outboundList?.length ? (
                <p className="text-muted-foreground text-sm text-center py-10">No outbound referrals yet. Add your first one.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>City</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Facility</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Follow-Up</TableHead>
                        <TableHead className="w-20">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outboundList.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>
                            <div className="font-medium">{r.clientName}</div>
                            {r.filevineLinkOrRef && (
                              <div className="text-xs text-muted-foreground truncate max-w-[140px]">{r.filevineLinkOrRef}</div>
                            )}
                          </TableCell>
                          <TableCell>{r.clientCity ?? "—"}</TableCell>
                          <TableCell><Badge variant="outline">{r.assignedAgent ?? "—"}</Badge></TableCell>
                          <TableCell className="max-w-[140px] truncate">{r.recommendedFacility ?? "—"}</TableCell>
                          <TableCell>{r.referralSentDate ? new Date(r.referralSentDate).toLocaleDateString() : "—"}</TableCell>
                          <TableCell>
                            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[r.status as OutboundStatus] ?? ""}`}>
                              {r.status}
                            </span>
                          </TableCell>
                          <TableCell>{r.followUpDate ? new Date(r.followUpDate).toLocaleDateString() : "—"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" onClick={() => openEditOutbound(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => deleteOutbound.mutate({ id: r.id })}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Inbound Tab ── */}
        <TabsContent value="inbound" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{inboundList?.length ?? 0} leads logged</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={exportInbound} disabled={!inboundList?.length}>
                <Download className="w-4 h-4 mr-2" /> Export CSV
              </Button>
              <Button onClick={openCreateInbound}><Plus className="w-4 h-4 mr-2" /> Add Lead</Button>
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              {inboundLoading ? (
                <p className="text-muted-foreground text-sm p-6">Loading...</p>
              ) : !inboundList?.length ? (
                <p className="text-muted-foreground text-sm text-center py-10">No inbound leads yet. Add your first one.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lead Name</TableHead>
                        <TableHead>Received</TableHead>
                        <TableHead>Facility</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Case Type</TableHead>
                        <TableHead>Signed</TableHead>
                        <TableHead>Counts</TableHead>
                        <TableHead className="w-20">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inboundList.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-medium">{l.leadName}</TableCell>
                          <TableCell>{l.dateReceived ? new Date(l.dateReceived).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="max-w-[140px] truncate">{l.referringFacility ?? "—"}</TableCell>
                          <TableCell><Badge variant="outline">{l.assignedAgent ?? "—"}</Badge></TableCell>
                          <TableCell>{l.caseType ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant={l.signed ? "default" : "secondary"}>{l.signed ? "Signed" : "Not Signed"}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={l.countsTowardPartnerActivity ? "outline" : "secondary"}>
                              {l.countsTowardPartnerActivity ? "Yes" : "No"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" onClick={() => openEditInbound(l)}><Pencil className="w-3.5 h-3.5" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => deleteInbound.mutate({ id: l.id })}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Outbound Dialog ── */}
      <Dialog open={outboundOpen} onOpenChange={setOutboundOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingOutbound !== null ? "Edit Outbound Referral" : "Add Outbound Referral"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 col-span-2">
                <Label>Client Name *</Label>
                <Input placeholder="Full client name" value={outboundForm.clientName} onChange={e => setOutboundForm({ ...outboundForm, clientName: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Filevine Link / Case Ref</Label>
                <Input placeholder="URL or case number" value={outboundForm.filevineLinkOrRef} onChange={e => setOutboundForm({ ...outboundForm, filevineLinkOrRef: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Date Signed</Label>
                <Input type="date" value={outboundForm.dateSigned} onChange={e => setOutboundForm({ ...outboundForm, dateSigned: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1 col-span-2">
                <Label>Client Address</Label>
                <Input placeholder="Street address" value={outboundForm.clientAddress} onChange={e => setOutboundForm({ ...outboundForm, clientAddress: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>City</Label>
                <Input placeholder="City" value={outboundForm.clientCity} onChange={e => setOutboundForm({ ...outboundForm, clientCity: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>ZIP Code</Label>
                <Input placeholder="90001" value={outboundForm.clientZip} onChange={e => setOutboundForm({ ...outboundForm, clientZip: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Referral Type</Label>
                <Input placeholder="e.g. Chiro, Body Shop" value={outboundForm.referralType} onChange={e => setOutboundForm({ ...outboundForm, referralType: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Assigned Agent</Label>
                <Select value={outboundForm.assignedAgent} onValueChange={v => setOutboundForm({ ...outboundForm, assignedAgent: v })}>
                  <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                  <SelectContent>{AGENTS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Recommended Facility</Label>
                <Input placeholder="Facility name" value={outboundForm.recommendedFacility} onChange={e => setOutboundForm({ ...outboundForm, recommendedFacility: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Facility Owner</Label>
                <Input placeholder="Owner / contact name" value={outboundForm.facilityOwner} onChange={e => setOutboundForm({ ...outboundForm, facilityOwner: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Distance / Travel Time</Label>
                <Input placeholder="e.g. 2.3 mi / 8 min" value={outboundForm.distanceTravelTime} onChange={e => setOutboundForm({ ...outboundForm, distanceTravelTime: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Referral Sent Date</Label>
                <Input type="date" value={outboundForm.referralSentDate} onChange={e => setOutboundForm({ ...outboundForm, referralSentDate: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Reason for Facility Selection</Label>
              <Textarea rows={2} placeholder="Why was this facility chosen?" value={outboundForm.reasonForSelection} onChange={e => setOutboundForm({ ...outboundForm, reasonForSelection: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={outboundForm.status} onValueChange={v => setOutboundForm({ ...outboundForm, status: v as OutboundStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{OUTBOUND_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Follow-Up Date</Label>
                <Input type="date" value={outboundForm.followUpDate} onChange={e => setOutboundForm({ ...outboundForm, followUpDate: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Last Updated By</Label>
                <Select value={outboundForm.lastUpdatedBy} onValueChange={v => setOutboundForm({ ...outboundForm, lastUpdatedBy: v })}>
                  <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                  <SelectContent>{AGENTS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {([
                ["referralNeeded", "Referral Needed"],
                ["facilityConfirmed", "Facility Confirmed"],
                ["clientScheduled", "Client Scheduled"],
                ["clientAttended", "Client Attended"],
                ["facilityHadSentLeads", "Facility Had Sent Leads to Firm"],
              ] as [keyof OutboundForm, string][]).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={key}
                    checked={outboundForm[key] as boolean}
                    onCheckedChange={v => setOutboundForm({ ...outboundForm, [key]: !!v })}
                  />
                  <label htmlFor={key} className="text-sm cursor-pointer">{label}</label>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea rows={2} value={outboundForm.notes} onChange={e => setOutboundForm({ ...outboundForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutboundOpen(false)}>Cancel</Button>
            <Button onClick={submitOutbound} disabled={createOutbound.isPending || updateOutbound.isPending}>
              {editingOutbound !== null ? "Save Changes" : "Add Referral"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Inbound Dialog ── */}
      <Dialog open={inboundOpen} onOpenChange={setInboundOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingInbound !== null ? "Edit Inbound Lead" : "Add Inbound Lead"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 col-span-2">
                <Label>Lead Name *</Label>
                <Input placeholder="Full name" value={inboundForm.leadName} onChange={e => setInboundForm({ ...inboundForm, leadName: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Date Received</Label>
                <Input type="date" value={inboundForm.dateReceived} onChange={e => setInboundForm({ ...inboundForm, dateReceived: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Referring Facility</Label>
                <Input placeholder="Facility name" value={inboundForm.referringFacility} onChange={e => setInboundForm({ ...inboundForm, referringFacility: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Facility Contact</Label>
                <Input placeholder="Contact name" value={inboundForm.facilityContact} onChange={e => setInboundForm({ ...inboundForm, facilityContact: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Assigned Agent</Label>
                <Select value={inboundForm.assignedAgent} onValueChange={v => setInboundForm({ ...inboundForm, assignedAgent: v })}>
                  <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                  <SelectContent>{AGENTS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Case Type</Label>
              <Input placeholder="e.g. Auto Accident, Slip & Fall" value={inboundForm.caseType} onChange={e => setInboundForm({ ...inboundForm, caseType: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Signed Date</Label>
                <Input type="date" value={inboundForm.signedDate} onChange={e => setInboundForm({ ...inboundForm, signedDate: e.target.value })} disabled={!inboundForm.signed} />
              </div>
              <div className="space-y-1">
                <Label>Not Signed Reason</Label>
                <Input placeholder="If not signed, why?" value={inboundForm.notSignedReason} onChange={e => setInboundForm({ ...inboundForm, notSignedReason: e.target.value })} disabled={inboundForm.signed} />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Checkbox id="signed" checked={inboundForm.signed} onCheckedChange={v => setInboundForm({ ...inboundForm, signed: !!v })} />
                <label htmlFor="signed" className="text-sm cursor-pointer">Lead Signed</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="counts" checked={inboundForm.countsTowardPartnerActivity} onCheckedChange={v => setInboundForm({ ...inboundForm, countsTowardPartnerActivity: !!v })} />
                <label htmlFor="counts" className="text-sm cursor-pointer">Counts Toward Partner Activity</label>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea rows={2} value={inboundForm.notes} onChange={e => setInboundForm({ ...inboundForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInboundOpen(false)}>Cancel</Button>
            <Button onClick={submitInbound} disabled={createInbound.isPending || updateInbound.isPending}>
              {editingInbound !== null ? "Save Changes" : "Add Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
