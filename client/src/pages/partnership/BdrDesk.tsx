import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ClickToCallButton } from "@/components/RingCentralWidget";
import { Phone, PhoneCall, CalendarCheck, Star, Clock, Sparkles, MapPin, Check, Voicemail, PhoneOff, CalendarPlus, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { format } from "@/lib/datetime";
import { canManage } from "@shared/permissions";
import { PageHeader, StatCard } from "./shared";

const CATEGORY: Record<string, { label: string; cls: string; icon: any }> = {
  post_visit: { label: "Post-visit follow-up", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30", icon: CalendarCheck },
  confirm_visit: { label: "Confirm visit", cls: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30", icon: CalendarCheck },
  visit_requested: { label: "Visit requested", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30", icon: Star },
  gone_quiet: { label: "Gone quiet", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30", icon: Clock },
  first_contact: { label: "First contact", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30", icon: Sparkles },
};

export default function BdrDesk() {
  const { user } = useAuth();
  const isMgr = canManage(user?.role);
  const { data: team } = trpc.team.list.useQuery(undefined, { enabled: isMgr });
  const [agent, setAgent] = useState<string>("");
  const agentArg = isMgr && agent ? { agent } : undefined;

  const { data: scorecard } = trpc.partnership.bdr.scorecard.useQuery(agentArg ?? {});
  const { data: queue, isLoading } = trpc.partnership.bdr.queue.useQuery(agentArg ?? {});

  const agentNames: string[] = Array.from(new Set((team ?? []).map((u: any) => u.agentName).filter(Boolean))).sort();

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <PageHeader title="BDR Desk" subtitle="Your daily cockpit: who to call next and why. Open the door, keep it propped open — set the FR up to close.">
        {isMgr && (
          <Select value={agent || "all"} onValueChange={(v) => setAgent(v === "all" ? "" : v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All BDRs" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All BDRs</SelectItem>
              {agentNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={PhoneCall} label="Calls today" value={scorecard?.callsToday ?? 0} />
        <StatCard icon={Phone} label="Calls this week" value={scorecard?.callsWeek ?? 0} />
        <StatCard icon={TrendingUp} label="Connect rate" value={`${scorecard?.connectRate ?? 0}%`} color="text-primary" sub="this week" />
        <StatCard icon={CalendarCheck} label="Visits set" value={scorecard?.apptsSet ?? 0} sub="this month" />
        <StatCard icon={Star} label="Qualified leads" value={scorecard?.qualifiedLeads ?? 0} color="text-emerald-500" sub="this month" />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground mb-2">Call queue {queue ? `(${queue.length})` : ""}</h2>
        {isLoading ? <Skeleton className="h-64 rounded-xl" /> : !queue?.length ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            Queue is clear — nothing needs a call right now. 🎉
          </div>
        ) : (
          <div className="space-y-2">
            {queue.map((row: any) => <QueueRow key={row.id} row={row} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function QueueRow({ row }: { row: any }) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const cat = CATEGORY[row.category] ?? CATEGORY.first_contact;
  const Icon = cat.icon;
  const log = trpc.partnership.bdr.logTouch.useMutation({
    onSuccess: () => { toast.success("Call logged"); utils.partnership.bdr.queue.invalidate(); utils.partnership.bdr.scorecard.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="p-3.5 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full border text-[11px] font-medium inline-flex items-center gap-1 ${cat.cls}`}><Icon className="w-3 h-3" /> {cat.label}</span>
            <p className="font-semibold text-foreground">{row.name}</p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{row.reason}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {row.city || "—"}</span>
            {row.assignedRepName && <span>· {row.assignedRepName}</span>}
            {row.nextAppt && <span>· visit {format(new Date(row.nextAppt), "MMM d, h:mm a")}</span>}
            {row.lastContactDate && <span>· last contact {format(new Date(row.lastContactDate), "MMM d")}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {row.phone && <ClickToCallButton phoneNumber={row.phone} facilityId={row.id} />}
          {row.category === "visit_requested" || row.category === "confirm_visit" ? (
            <Button size="sm" variant="outline" onClick={() => navigate("/partnership/visits")}><CalendarPlus className="w-3.5 h-3.5" /> Visits</Button>
          ) : null}
          {row.category === "post_visit" ? (
            <Button size="sm" variant="outline" className="text-emerald-600" disabled={log.isPending}
              onClick={() => log.mutate({ facilityId: row.id, callResult: "connected", callType: "partner_checkin", advanceTo: "nurture", summary: "Post-visit follow-up call" })}>
              <Check className="w-3.5 h-3.5" /> Followed up
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" className="text-emerald-600 px-2" title="Connected" disabled={log.isPending} onClick={() => log.mutate({ facilityId: row.id, callResult: "connected" })}><Check className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" className="text-amber-600 px-2" title="Voicemail" disabled={log.isPending} onClick={() => log.mutate({ facilityId: row.id, callResult: "voicemail" })}><Voicemail className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground px-2" title="No answer" disabled={log.isPending} onClick={() => log.mutate({ facilityId: row.id, callResult: "no_answer" })}><PhoneOff className="w-4 h-4" /></Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
