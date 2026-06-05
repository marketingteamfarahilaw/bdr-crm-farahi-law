import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Scale, Loader2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useBrandLogo } from "@/hooks/useBranding";

export default function Login() {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const logo = useBrandLogo();

  useEffect(() => {
    fetch("/api/auth/google/status")
      .then((r) => r.json())
      .then((d) => setGoogleEnabled(!!d?.enabled))
      .catch(() => {});
  }, []);

  const login = trpc.auth.login.useMutation({
    onSuccess: async ({ user }) => {
      // Flip the auth gate to "authenticated" instantly, then re-verify with the server.
      utils.auth.me.setData(undefined, user as any);
      await utils.auth.me.invalidate();
    },
    onError: (e) => setError(e.message || "Sign in failed. Please try again."),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    login.mutate({ email: email.trim(), password });
  };

  return (
    <div className="dashboard-mesh min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <img
            src={logo}
            alt="Farahi Law Firm"
            className="w-28 h-28 rounded-2xl object-contain bg-card p-2 mb-4 shadow-xl ring-1 ring-border"
          />
          <p className="text-sm text-muted-foreground mt-1">BD Partner CRM</p>
        </div>

        {/* Card */}
        <form onSubmit={submit} className="premium-card rounded-2xl p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Sign in</h2>
            <p className="text-xs text-muted-foreground">
              Enter your credentials to access the dashboard.
            </p>
          </div>

          {googleEnabled && (
            <>
              <a
                href="/api/auth/google"
                className="flex items-center justify-center gap-2.5 w-full rounded-md border border-border bg-white text-gray-700 text-sm font-medium py-2.5 hover:bg-gray-50 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Sign in with Google
              </a>
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[11px] text-muted-foreground">or continue with email</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="email" className="text-xs">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@farahilaw.com"
              className="bg-card border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-xs">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="bg-card border-border pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <p className="text-center text-[11px] text-muted-foreground mt-6">
          Farahi Law · Business Development · Authorized users only
        </p>
      </div>
    </div>
  );
}
