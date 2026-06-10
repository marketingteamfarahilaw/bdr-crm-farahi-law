/**
 * RingCentral OAuth Callback
 *
 * After an agent signs into their own RingCentral, RingCentral redirects here
 * with an authorization code. This page exchanges that code (via the per-agent
 * `connect` mutation) and stores the token against the logged-in agent, then
 * sends them back to the RingCentral page.
 *
 * The redirect URI registered in the RingCentral Developer Console must be this
 * page's URL, e.g. https://bdcrm.farahilaw.com/ringcentral-callback
 */

import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { isIntakeOnly } from "@shared/permissions";

export default function RingCentralCallback() {
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [message, setMessage] = useState("Finishing RingCentral sign-in…");
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const ranRef = useRef(false);

  const connect = trpc.crm.ringcentral.connect.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    // Intake users connect from (and return to) their own settings page.
    const backPath = isIntakeOnly(user?.role) ? "/intake/settings" : "/crm/ringcentral";
    const goBack = (delay = 2200) => setTimeout(() => navigate(backPath), delay);

    if (error) {
      setStatus("error");
      setMessage(`Sign-in failed: ${errorDescription ?? error}`);
      // Legacy popup flow: tell the opener and close.
      if (window.opener) {
        try { window.opener.postMessage({ type: "rc-oauth-callback", error, errorDescription }, "*"); } catch { /* cross-origin */ }
        setTimeout(() => window.close(), 1500);
        return;
      }
      goBack();
      return;
    }

    if (!code) {
      setStatus("error");
      setMessage("No authorization code was returned by RingCentral.");
      goBack();
      return;
    }

    // Legacy embeddable popup flow — hand the code to the opener.
    if (window.opener) {
      try {
        window.opener.postMessage({ type: "rc-oauth-callback", callbackUri: window.location.href, code, state }, "*");
      } catch { /* cross-origin */ }
      setStatus("success");
      setMessage("Signed in. Closing…");
      setTimeout(() => window.close(), 800);
      return;
    }

    // Full-page per-agent flow: verify state, then exchange the code.
    const savedState = sessionStorage.getItem("rc_oauth_state");
    const redirectUri = sessionStorage.getItem("rc_oauth_redirect") || `${window.location.origin}/ringcentral-callback`;
    // Fail CLOSED: this connection must have been started from THIS browser
    // (handleConnect wrote rc_oauth_state) and the returned state must match it.
    // A missing saved state means the callback wasn't initiated here — reject it.
    if (!savedState || !state || state !== savedState) {
      sessionStorage.removeItem("rc_oauth_state");
      sessionStorage.removeItem("rc_oauth_redirect");
      setStatus("error");
      setMessage("Security check failed. Please start the RingCentral connection again from the RingCentral page.");
      goBack(2800);
      return;
    }

    connect.mutate(
      { code, redirectUri },
      {
        onSuccess: (res) => {
          sessionStorage.removeItem("rc_oauth_state");
          sessionStorage.removeItem("rc_oauth_redirect");
          utils.crm.ringcentral.status.invalidate();
          utils.crm.ringcentral.connectedAgents.invalidate();
          setStatus("success");
          setMessage(`Connected as ${res.ownerName}. Redirecting…`);
          toast.success(`RingCentral connected as ${res.ownerName}`, {
            description: "Your calls will now be logged under your name.",
          });
          goBack(1100);
        },
        onError: (e) => {
          setStatus("error");
          setMessage(e.message || "Could not complete RingCentral sign-in.");
          goBack(3200);
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center p-8 rounded-xl border border-border bg-card shadow-lg max-w-sm w-full mx-4">
        <div className="mb-4">
          {status === "processing" && (
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          )}
          {status === "success" && (
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          {status === "error" && (
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          )}
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">RingCentral Sign-In</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
