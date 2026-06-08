/**
 * Per-agent RingCentral connection card.
 *
 * Each agent connects their OWN RingCentral account here. Clicking "Connect"
 * sends them (full-page) to RingCentral's hosted login; after they sign in,
 * RingCentral redirects back to /ringcentral-callback, which stores the token
 * against THIS agent. From then on, their calls are pulled from their own
 * extension and attributed to them — not to the shared account.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Phone, CheckCircle2, LogOut, Loader2, ShieldCheck } from "lucide-react";

export default function RingCentralConnectCard() {
  const { data: status, isLoading } = trpc.crm.ringcentral.status.useQuery();
  const utils = trpc.useUtils();
  const [connecting, setConnecting] = useState(false);

  const disconnect = trpc.crm.ringcentral.disconnect.useMutation({
    onSuccess: () => {
      utils.crm.ringcentral.status.invalidate();
      utils.crm.ringcentral.connectedAgents.invalidate();
      toast.success("RingCentral disconnected from your account.");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/ringcentral-callback`;
      const state =
        (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("rc_oauth_state", state);
      sessionStorage.setItem("rc_oauth_redirect", redirectUri);
      const { url } = await utils.crm.ringcentral.getAuthorizeUrl.fetch({ redirectUri, state });
      window.location.href = url;
    } catch (e: any) {
      setConnecting(false);
      toast.error(e?.message ?? "Could not start RingCentral sign-in.");
    }
  };

  const connected = !!status?.connected;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Phone className="w-4 h-4 text-primary" />
          Your RingCentral account
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking connection…
          </div>
        ) : connected ? (
          <>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Connected as <span className="text-green-500">{status?.ownerName ?? "your RingCentral account"}</span>
                </p>
                {status?.ownerEmail && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{status.ownerEmail}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Your calls are now pulled from your own extension and logged under your name. Session renews automatically.
                </p>
                {status?.lastSyncAt && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Last synced: {new Date(status.lastSyncAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              <LogOut className="w-3.5 h-3.5" />
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-yellow-500/20 flex items-center justify-center mt-0.5 shrink-0">
                <div className="w-2 h-2 rounded-full bg-yellow-400" />
              </div>
              <p className="text-sm text-muted-foreground">
                Connect your RingCentral so <strong className="text-foreground">your calls are tracked under your name</strong> — not the shared account.
                You'll sign in to your own RingCentral account once; it stays connected after that.
              </p>
            </div>
            <Button onClick={handleConnect} disabled={connecting} className="gap-2">
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {connecting ? "Opening RingCentral…" : "Connect my RingCentral"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
