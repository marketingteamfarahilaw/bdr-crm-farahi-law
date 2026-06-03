import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, CheckCircle2, PhoneCall, FileText, Sparkles } from "lucide-react";

export default function RingCentralSettings() {
  const { data: status } = trpc.crm.ringcentral.status.useQuery();

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
          RingCentral Phone
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Make calls directly from the app and automatically log transcripts and AI summaries for every facility call.
        </p>
      </div>

      {/* Widget Status */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Phone className="w-4 h-4" />
            Widget Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {status?.connected ? (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Connected as <span className="text-green-400">{status.ownerName}</span>
                </p>
                {status.tokenExpiry && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Session active · Token expires: {new Date(status.tokenExpiry).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-yellow-400" />
              </div>
              <div>
                <p className="text-sm text-foreground font-medium">Not signed in yet</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Click the <strong>Open Phone</strong> button in the bottom-right corner and sign in with your RingCentral credentials.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* How it works */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">How to Use</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">1</Badge>
            <div>
              <p className="text-foreground font-medium">Open the phone widget</p>
              <p className="text-xs mt-0.5">Click the <strong className="text-foreground">Open Phone</strong> button in the bottom-right corner of any page. Sign in with your RingCentral account when prompted.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">2</Badge>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <p className="text-foreground font-medium flex items-center gap-1.5"><PhoneCall className="w-3.5 h-3.5" /> Call a facility</p>
                <p className="text-xs mt-0.5">On any facility profile, click a phone number to auto-dial it. The call goes through <strong className="text-foreground">RingOut</strong> — your desk or cell phone rings first, then connects to the facility.</p>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">3</Badge>
            <div>
              <p className="text-foreground font-medium flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Automatic call logging</p>
              <p className="text-xs mt-0.5">When a call ends, the app automatically logs it to the facility's <strong className="text-foreground">Contact Log</strong> tab and fetches the recording for transcription.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">4</Badge>
            <div>
              <p className="text-foreground font-medium flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-blue-400" /> AI transcript & summary</p>
              <p className="text-xs mt-0.5">The call recording is transcribed and an AI summary is generated — covering what was discussed, commitments made, and next steps. Both appear in the facility's <strong className="text-foreground">Updates</strong> tab.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* RingOut info */}
      <Card className="bg-blue-950/20 border-blue-500/20">
        <CardContent className="p-4">
          <div className="flex gap-3">
            <Phone className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-300">Using RingOut (recommended)</p>
              <p className="text-xs text-blue-300/70 mt-1">
                The widget is set to <strong>RingOut</strong> mode by default. When you dial a number, RingCentral calls <em>your</em> forwarding number first (cell or desk phone), then bridges you to the facility. No microphone or browser audio required — the call audio goes through your physical phone.
              </p>
              <p className="text-xs text-blue-300/70 mt-1">
                To set your forwarding number: open the widget → Settings gear → Calling → RingOut → enter your phone number.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
