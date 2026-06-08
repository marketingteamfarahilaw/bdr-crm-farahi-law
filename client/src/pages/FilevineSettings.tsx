import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Link2,
  Link2Off,
  Key,
  Shield,
  Building2,
  Globe,
  Check,
  RefreshCw,
  ExternalLink,
  Info,
} from "lucide-react";
import { Input } from "@/components/ui/input";

export default function FilevineSettingsPage() {
  const utils = trpc.useUtils();
  const { data: settings, isLoading } = trpc.filevine.getSettings.useQuery();

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [orgId, setOrgId] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.filevine.io");
  const [showForm, setShowForm] = useState(false);

  const saveMutation = trpc.filevine.saveSettings.useMutation({
    onSuccess: () => {
      toast.success("Filevine connected successfully!");
      utils.filevine.getSettings.invalidate();
      setShowForm(false);
      setApiKey("");
      setApiSecret("");
    },
    onError: (e) => toast.error(e.message || "Failed to save settings"),
  });

  const disconnectMutation = trpc.filevine.disconnect.useMutation({
    onSuccess: () => {
      toast.success("Filevine disconnected.");
      utils.filevine.getSettings.invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to disconnect"),
  });

  // Zapier/n8n webhook → Filevine tasks (manager-only)
  const { data: webhook } = trpc.filevine.getWebhook.useQuery();
  const [webhookUrl, setWebhookUrl] = useState("");
  useEffect(() => { if (webhook?.url != null) setWebhookUrl(webhook.url); }, [webhook?.url]);
  const saveWebhook = trpc.filevine.setWebhook.useMutation({
    onSuccess: () => { toast.success("Filevine webhook saved."); utils.filevine.getWebhook.invalidate(); },
    onError: (e) => toast.error(e.message || "Failed to save webhook"),
  });

  const handleSave = () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast.error("API Key and API Secret are required.");
      return;
    }
    saveMutation.mutate({ apiKey, apiSecret, orgId: orgId || undefined, baseUrl });
  };

  const isConnected = settings?.connected ?? false;

  return (
    <div
      className="min-h-full"
      style={{
        background: "linear-gradient(160deg, #060b16 0%, #080f1e 50%, #060b16 100%)",
        padding: "28px 32px",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div
          style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 16px rgba(99,102,241,0.4)",
          }}
        >
          <Link2 size={18} color="#fff" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9", fontFamily: "'Playfair Display', serif" }}>
            Filevine Integration
          </h1>
          <p className="text-sm" style={{ color: "rgba(148,163,184,0.6)" }}>
            Connect your Filevine account to sync cases and contacts
          </p>
        </div>
      </div>

      {/* Connection status card */}
      <div
        style={{
          background: "linear-gradient(160deg, rgba(8,18,36,0.97) 0%, rgba(5,12,24,0.97) 100%)",
          backdropFilter: "blur(28px)",
          border: `1px solid ${isConnected ? "rgba(34,197,94,0.3)" : "rgba(99,102,241,0.25)"}`,
          borderRadius: 18,
          padding: "24px 28px",
          marginBottom: 24,
          boxShadow: `0 16px 48px rgba(0,0,0,0.5), 0 0 40px ${isConnected ? "rgba(34,197,94,0.06)" : "rgba(99,102,241,0.06)"}`,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Filevine logo placeholder */}
            <div
              style={{
                width: 56, height: 56, borderRadius: 14,
                background: isConnected
                  ? "linear-gradient(135deg, rgba(34,197,94,0.15), rgba(34,197,94,0.08))"
                  : "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(99,102,241,0.08))",
                border: `1px solid ${isConnected ? "rgba(34,197,94,0.3)" : "rgba(99,102,241,0.3)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24,
              }}
            >
              ⚖️
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginBottom: 4 }}>
                Filevine
              </div>
              <div className="flex items-center gap-2">
                <div
                  style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: isConnected ? "#22c55e" : "#64748b",
                    boxShadow: isConnected ? "0 0 8px rgba(34,197,94,0.6)" : "none",
                  }}
                />
                <span
                  style={{
                    fontSize: 12, fontWeight: 600,
                    color: isConnected ? "#22c55e" : "rgba(148,163,184,0.5)",
                  }}
                >
                  {isLoading ? "Checking..." : isConnected ? "Connected" : "Not Connected"}
                </span>
                {isConnected && settings?.orgId && (
                  <span style={{ fontSize: 11, color: "rgba(148,163,184,0.4)" }}>
                    · Org: {settings.orgId}
                  </span>
                )}
                {isConnected && settings?.lastSyncAt && (
                  <span style={{ fontSize: 11, color: "rgba(148,163,184,0.4)" }}>
                    · Last sync: {new Date(settings.lastSyncAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isConnected ? (
              <>
                <button
                  onClick={() => setShowForm(true)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 16px",
                    background: "rgba(99,102,241,0.1)",
                    border: "1px solid rgba(99,102,241,0.25)",
                    borderRadius: 8,
                    color: "#818cf8", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <RefreshCw size={12} />
                  Update Credentials
                </button>
                <button
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 16px",
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    borderRadius: 8,
                    color: "rgba(239,68,68,0.7)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    opacity: disconnectMutation.isPending ? 0.6 : 1,
                  }}
                >
                  <Link2Off size={12} />
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowForm(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 20px",
                  background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                  border: "none", borderRadius: 10,
                  color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  boxShadow: "0 4px 20px rgba(99,102,241,0.35)",
                }}
              >
                <Link2 size={14} strokeWidth={2.5} />
                Connect Filevine
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Credentials form */}
      {showForm && (
        <div
          style={{
            background: "linear-gradient(160deg, rgba(8,18,36,0.97) 0%, rgba(5,12,24,0.97) 100%)",
            backdropFilter: "blur(28px)",
            border: "1px solid rgba(99,102,241,0.25)",
            borderRadius: 18,
            padding: "24px 28px",
            marginBottom: 24,
            boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", marginBottom: 4 }}>
            {isConnected ? "Update API Credentials" : "Enter API Credentials"}
          </div>
          <div style={{ fontSize: 12, color: "rgba(148,163,184,0.5)", marginBottom: 20 }}>
            Your credentials are stored securely and never exposed to the frontend.
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                API Key <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <div className="relative">
                <Key size={13} className="absolute left-3 top-1/2 -translate-y-1/2" color="rgba(148,163,184,0.4)" />
                <Input
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="fv_api_key_..."
                  type="password"
                  className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#6366f1] pl-9"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                API Secret <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <div className="relative">
                <Shield size={13} className="absolute left-3 top-1/2 -translate-y-1/2" color="rgba(148,163,184,0.4)" />
                <Input
                  value={apiSecret}
                  onChange={e => setApiSecret(e.target.value)}
                  placeholder="fv_api_secret_..."
                  type="password"
                  className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#6366f1] pl-9"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Organization ID
              </label>
              <div className="relative">
                <Building2 size={13} className="absolute left-3 top-1/2 -translate-y-1/2" color="rgba(148,163,184,0.4)" />
                <Input
                  value={orgId}
                  onChange={e => setOrgId(e.target.value)}
                  placeholder="Your Filevine Org ID"
                  className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#6366f1] pl-9"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Base URL
              </label>
              <div className="relative">
                <Globe size={13} className="absolute left-3 top-1/2 -translate-y-1/2" color="rgba(148,163,184,0.4)" />
                <Input
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder="https://api.filevine.io"
                  className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#6366f1] pl-9"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 24px",
                background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                border: "none", borderRadius: 9,
                color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                boxShadow: "0 4px 16px rgba(99,102,241,0.3)",
                opacity: saveMutation.isPending ? 0.6 : 1,
              }}
            >
              <Check size={14} strokeWidth={2.5} />
              {saveMutation.isPending ? "Saving..." : "Save & Connect"}
            </button>
            <button
              onClick={() => { setShowForm(false); setApiKey(""); setApiSecret(""); }}
              style={{
                padding: "10px 20px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 9,
                color: "rgba(148,163,184,0.7)", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Zapier / n8n webhook → Filevine tasks */}
      {webhook?.canEdit && (
        <div
          style={{
            background: "linear-gradient(160deg, rgba(8,18,36,0.97) 0%, rgba(5,12,24,0.97) 100%)",
            border: "1px solid rgba(99,102,241,0.25)",
            borderRadius: 18,
            padding: "24px 28px",
            marginBottom: 24,
            boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", marginBottom: 4 }}>
            Auto-create Filevine tasks from calls
          </div>
          <div style={{ fontSize: 12, color: "rgba(148,163,184,0.6)", marginBottom: 16, lineHeight: 1.5 }}>
            Paste your <strong style={{ color: "#a5b4fc" }}>Zapier / n8n webhook URL</strong>. Every call recap is sent there —
            facility name, date &amp; time, call duration, the AI summary, and follow-up tasks — so your automation can create a
            Filevine task. Leave blank to turn it off. (No Filevine API key needed.)
          </div>
          <div className="flex gap-3 items-center">
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/hooks/catch/..."
              className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#6366f1]"
            />
            <button
              onClick={() => saveWebhook.mutate({ url: webhookUrl })}
              disabled={saveWebhook.isPending}
              style={{
                whiteSpace: "nowrap",
                padding: "9px 20px",
                background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                border: "none", borderRadius: 9,
                color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                opacity: saveWebhook.isPending ? 0.6 : 1,
              }}
            >
              {saveWebhook.isPending ? "Saving..." : "Save"}
            </button>
          </div>
          {webhook?.url && (
            <div style={{ fontSize: 11, color: "rgba(34,197,94,0.85)", marginTop: 10 }}>
              ● Active — call recaps are being sent to your webhook.
            </div>
          )}
        </div>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-4">
        {[
          {
            title: "What Filevine Integration Does",
            icon: "📋",
            items: [
              "Sync PI client cases from Filevine into the dashboard",
              "Link PI clients to Filevine case IDs for quick access",
              "Track case status changes across both platforms",
              "Pull contact information from existing Filevine cases",
            ],
          },
          {
            title: "How to Get Your API Credentials",
            icon: "🔑",
            items: [
              "Log in to your Filevine account at app.filevine.com",
              "Go to Settings → Integrations → API Access",
              "Generate a new API Key and Secret pair",
              "Copy your Organization ID from the account settings",
            ],
          },
        ].map((card, i) => (
          <div
            key={i}
            style={{
              background: "linear-gradient(160deg, rgba(8,18,36,0.97) 0%, rgba(5,12,24,0.97) 100%)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(99,102,241,0.15)",
              borderRadius: 16,
              padding: "20px 22px",
            }}
          >
            <div className="flex items-center gap-2 mb-4">
              <span style={{ fontSize: 18 }}>{card.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{card.title}</span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {card.items.map((item, j) => (
                <li key={j} className="flex items-start gap-2 mb-2">
                  <Check size={12} color="#6366f1" style={{ marginTop: 2, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "rgba(148,163,184,0.65)", lineHeight: 1.5 }}>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Filevine link */}
      <div style={{ marginTop: 16, textAlign: "center" }}>
        <a
          href="https://app.filevine.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 12, color: "rgba(99,102,241,0.7)",
            textDecoration: "none",
          }}
        >
          <ExternalLink size={12} />
          Open Filevine Dashboard
        </a>
      </div>
    </div>
  );
}
