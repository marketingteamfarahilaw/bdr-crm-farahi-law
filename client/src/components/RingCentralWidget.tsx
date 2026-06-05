/**
 * RingCentral click-to-dial via the DESKTOP APP + auto-sync recaps.
 *
 * Clicking any phone number opens the installed RingCentral desktop app
 * (rcapp://r/call) and places the call there — no browser softphone, no mic,
 * nothing to break. After the call, the server's 5-minute auto-sync pulls the
 * recording → transcript → AI summary/recap + follow-up tasks and attaches them
 * to the facility. A "Sync now" button is provided so you don't have to wait.
 *
 * Exports kept stable for the rest of the app:
 *   RingCentralProvider, useRingCentral, ClickToCallButton, RingCentralWidget, CallEndData
 */
import { createContext, useCallback, useContext, useState } from "react";
import { Phone, X, RefreshCw, PhoneCall } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export interface CallEndData {
  callId?: string;
  duration?: number;
  durationStr?: string;
  phoneNumber?: string;
  facilityId?: number;
  direction?: string;
  result?: string;
  startTime?: string;
}

interface RingCentralContextValue {
  triggerCall: (phoneNumber: string, facilityId?: number) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isConnected: boolean;
}

const RingCentralContext = createContext<RingCentralContextValue>({
  triggerCall: () => {},
  isOpen: false,
  setIsOpen: () => {},
  isConnected: false,
});

export function useRingCentral() {
  return useContext(RingCentralContext);
}

// Normalize a phone number to E.164 for the dialer (assume US when 10 digits).
function toE164(raw: string): string {
  const d = (raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return d ? "+" + d : "";
}

// Launch a custom protocol without navigating the page away.
function launchProtocol(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

export function RingCentralProvider({ children }: { onCallEnd?: (d: CallEndData) => void; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const utils = trpc.useUtils();

  const sync = trpc.crm.ringcentral.syncRecent.useMutation({
    onSuccess: (r: any) => {
      utils.crm.invalidate();
      const n = r?.transcribed ?? 0;
      toast.success(n > 0 ? `Synced — ${n} new recap${n === 1 ? "" : "s"} attached` : "Synced — no new recorded calls yet", {
        description: r ? `Scanned ${r.scanned} · matched ${r.matched} · logged ${r.logged}.` : undefined,
      });
    },
    onError: (e) => toast.error(e.message),
  });

  const triggerCall = useCallback((phoneNumber: string) => {
    const num = toE164(phoneNumber);
    if (!num) {
      toast.error("No phone number on file for this facility.");
      return;
    }
    // Open the installed RingCentral desktop app and place the call.
    launchProtocol(`rcapp://r/call?number=${encodeURIComponent(num)}`);
    toast("📞 Opening RingCentral…", {
      description: `Calling ${num} in your RingCentral app. The transcript, summary & recap auto-attach to this facility within ~5 minutes after you hang up.`,
      duration: 9000,
    });
  }, []);

  return (
    <RingCentralContext.Provider value={{ triggerCall, isOpen, setIsOpen, isConnected: true }}>
      {children}

      {/* Floating control */}
      <button
        onClick={() => setIsOpen((p) => !p)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full px-4 py-3 shadow-lg transition-all text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isOpen ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
        title="RingCentral calls"
      >
        {isOpen ? <X size={16} /> : <Phone size={16} />}
        <span className="hidden sm:inline">{isOpen ? "Close" : "Calls"}</span>
      </button>

      {isOpen && (
        <div className="fixed bottom-20 right-6 z-50 w-[320px] rounded-xl border border-border bg-background shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border">
            <PhoneCall size={14} className="text-primary" />
            <span className="text-xs font-medium text-foreground">RingCentral</span>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Click any phone number in the CRM — it opens your <strong className="text-foreground">RingCentral desktop app</strong> and dials.
              After the call, the recording is transcribed and the <strong className="text-foreground">summary + recap</strong> attach to that facility automatically (every 5 minutes).
            </p>
            <button
              onClick={() => sync.mutate({ lookbackMinutes: 120 })}
              disabled={sync.isPending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-medium py-2 hover:bg-primary/90 disabled:opacity-50"
            >
              <RefreshCw size={14} className={sync.isPending ? "animate-spin" : ""} /> {sync.isPending ? "Syncing…" : "Sync now"}
            </button>
            <p className="text-[11px] text-muted-foreground text-center">Pulls the last 2 hours of calls now instead of waiting.</p>
          </div>
        </div>
      )}
    </RingCentralContext.Provider>
  );
}

// Legacy alias — kept for existing imports.
export const RingCentralWidget = RingCentralProvider;

interface ClickToCallButtonProps {
  phoneNumber: string;
  facilityId?: number;
  facilityName?: string;
  className?: string;
  children?: React.ReactNode;
}

export function ClickToCallButton({ phoneNumber, facilityId, className, children }: ClickToCallButtonProps) {
  const { triggerCall } = useRingCentral();
  if (!phoneNumber) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerCall(phoneNumber, facilityId);
      }}
      className={cn("inline-flex items-center gap-1 text-primary hover:text-primary/80 transition-colors", className)}
      title={`Call ${phoneNumber}`}
    >
      <Phone size={12} className="shrink-0" />
      {children ?? phoneNumber}
    </button>
  );
}
