import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Phone, CheckCircle2, XCircle, RefreshCw, Info } from "lucide-react";

export default function RingCentralSettings() {
  const [jwt, setJwt] = useState("");
  const { data: status, refetch: refetchStatus } = trpc.crm.ringcentral.status.useQuery();

  const connectJwt = trpc.crm.ringcentral.connectJwt.useMutation({
    onSuccess: (data) => {
      toast.success(`Connected as ${data.ownerName}`);
      setJwt("");
      refetchStatus();
    },
    onError: (e) => toast.error(`Connection failed: ${e.message}`),
  });

  const disconnect = trpc.crm.ringcentral.disconnect.useMutation({
    onSuccess: () => {
      toast.success("Disconnected from RingCentral");
      refetchStatus();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
          RingCentral Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your RingCentral account to enable in-app calling and automatic call transcription.
        </p>
      </div>

      {/* Connection Status */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Phone className="w-4 h-4" />
            Connection Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {status?.connected ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Connected as <span className="text-green-400">{status.ownerName}</span>
                  </p>
                  {status.tokenExpiry && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Token expires: {new Date(status.tokenExpiry).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                {disconnect.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                <span className="ml-1.5">Disconnect</span>
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <XCircle className="w-5 h-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Not connected</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connect via JWT */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Connect with JWT</CardTitle>
          <CardDescription className="text-xs">
            Paste your RingCentral JWT token below to connect your account. The JWT is generated from the RingCentral Developer Console under your app credentials.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex gap-2">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300">
              Your JWT must be generated from a <strong>Production</strong> RingCentral app. Sandbox JWTs will not work. 
              Go to <a href="https://developers.ringcentral.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-200">developers.ringcentral.com</a> → Your App → Credentials → Create JWT.
            </p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">JWT Token</label>
            <Input
              type="password"
              placeholder="Paste your RingCentral JWT here..."
              value={jwt}
              onChange={(e) => setJwt(e.target.value)}
              className="bg-background border-border font-mono text-xs"
            />
          </div>
          <Button
            className="w-full"
            style={{ background: "var(--gold)", color: "#0a0f1e" }}
            disabled={!jwt.trim() || connectJwt.isPending}
            onClick={() => connectJwt.mutate({ jwt: jwt.trim() })}
          >
            {connectJwt.isPending ? (
              <><RefreshCw className="w-3.5 h-3.5 animate-spin mr-2" />Connecting...</>
            ) : (
              <><Phone className="w-3.5 h-3.5 mr-2" />Connect Account</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* How it works */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">How It Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div className="flex gap-2">
            <Badge variant="outline" className="shrink-0 text-xs w-5 h-5 flex items-center justify-center p-0">1</Badge>
            <p>Once connected, a <strong className="text-foreground">phone button</strong> appears in the bottom-right corner of every page.</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="shrink-0 text-xs w-5 h-5 flex items-center justify-center p-0">2</Badge>
            <p>On any facility profile, click a phone number to <strong className="text-foreground">auto-dial</strong> it through RingCentral.</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="shrink-0 text-xs w-5 h-5 flex items-center justify-center p-0">3</Badge>
            <p>After a call ends, use <strong className="text-foreground">Sync RingCentral</strong> on the facility's Contact Log tab to import the call record.</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="shrink-0 text-xs w-5 h-5 flex items-center justify-center p-0">4</Badge>
            <p>Call recordings are automatically <strong className="text-foreground">transcribed</strong> and saved to the facility's Updates tab.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
