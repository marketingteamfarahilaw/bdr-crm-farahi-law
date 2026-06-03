import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Phone, CheckCircle2, PhoneCall, FileText, Sparkles, Save } from "lucide-react";
import { toast } from "sonner";

export default function RingCentralSettings() {
  const { data: status } = trpc.crm.ringcentral.status.useQuery();
  const { data: widgetConfig, refetch: refetchConfig } = trpc.crm.ringcentral.getWidgetConfig.useQuery();
  const [myLocation, setMyLocation] = useState("");
  const [saving, setSaving] = useState(false);

  const setMyLocationMutation = trpc.crm.ringcentral.setMyLocation.useMutation({
    onSuccess: () => {
      toast.success("RingOut forwarding number saved");
      refetchConfig();
      setSaving(false);
    },
    onError: (err) => {
      toast.error("Failed to save: " + err.message);
      setSaving(false);
    },
  });

  useEffect(() => {
    if (widgetConfig?.myLocation) {
      setMyLocation(widgetConfig.myLocation);
    }
  }, [widgetConfig?.myLocation]);

  const handleSaveMyLocation = () => {
    setSaving(true);
    setMyLocationMutation.mutate({ myLocation });
  };

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

      {/* RingOut My Location */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-blue-400" />
            RingOut Forwarding Number
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            In <strong>RingOut</strong> mode, RingCentral calls <em>your</em> phone first, then connects you to the facility.
            Enter your cell or desk phone number below — this is the number that will ring when you make a call.
          </p>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="myLocation" className="text-xs text-muted-foreground mb-1 block">
                Your phone number (e.g. +12025551234)
              </Label>
              <Input
                id="myLocation"
                value={myLocation}
                onChange={e => setMyLocation(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="text-sm"
              />
            </div>
            <div className="flex items-end">
              <Button
                size="sm"
                onClick={handleSaveMyLocation}
                disabled={saving || !myLocation.trim()}
                className="gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          {widgetConfig?.myLocation && (
            <p className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Current: {widgetConfig.myLocation}
            </p>
          )}
          <p className="text-xs text-muted-foreground/60">
            Note: RingCentral phone numbers without a digital line cannot be used as the forwarding number.
            Use your mobile number or a number in format <code>+1XXXXXXXXXX</code> or <code>main_number*extension</code>.
          </p>
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
              <p className="text-foreground font-medium">Set your forwarding number above</p>
              <p className="text-xs mt-0.5">Enter your cell or desk phone number in the field above and click Save. This is required for RingOut mode to work.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">2</Badge>
            <div>
              <p className="text-foreground font-medium">Open the phone widget</p>
              <p className="text-xs mt-0.5">Click the <strong className="text-foreground">Open Phone</strong> button in the bottom-right corner of any page. Sign in with your RingCentral account when prompted.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">3</Badge>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <p className="text-foreground font-medium flex items-center gap-1.5"><PhoneCall className="w-3.5 h-3.5" /> Call a facility</p>
                <p className="text-xs mt-0.5">On any facility profile, click a phone number to auto-dial it. Your phone rings first, then connects to the facility — no browser microphone needed.</p>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">4</Badge>
            <div>
              <p className="text-foreground font-medium flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Automatic call logging</p>
              <p className="text-xs mt-0.5">When a call ends, the app automatically logs it to the facility's <strong className="text-foreground">Contact Log</strong> tab and fetches the recording for transcription.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">5</Badge>
            <div>
              <p className="text-foreground font-medium flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-blue-400" /> AI transcript & summary</p>
              <p className="text-xs mt-0.5">The call recording is transcribed and an AI summary is generated — covering what was discussed, commitments made, action items, and follow-up tasks. Both appear in the facility's <strong className="text-foreground">Updates</strong> tab.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
