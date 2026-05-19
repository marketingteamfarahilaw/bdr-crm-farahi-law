/**
 * RingCentral OAuth Callback Page
 *
 * This page handles the OAuth redirect from RingCentral after the user authorizes.
 * It works in two scenarios:
 *  1. Popup flow: sends the auth code back to the opener window via postMessage, then closes
 *  2. Tab redirect flow (popup blocked): stores the auth code in localStorage, then redirects back to the app
 *
 * The redirect URI registered in RingCentral Developer Console must include this page's URL.
 * e.g. https://your-app.com/ringcentral-callback
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export default function RingCentralCallback() {
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [message, setMessage] = useState("Processing login...");
  const [, navigate] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    if (error) {
      setStatus("error");
      setMessage(`Login failed: ${errorDescription ?? error}`);
      // If in popup, notify opener and close
      if (window.opener) {
        try {
          window.opener.postMessage(
            { type: "rc-oauth-callback", error, errorDescription },
            "*"
          );
          setTimeout(() => window.close(), 1500);
        } catch {
          // opener may be cross-origin, just close
          setTimeout(() => window.close(), 1500);
        }
      } else {
        // Tab/iframe flow: navigate top window back to app
        setTimeout(() => {
          if (window.top && window.top !== window) {
            window.top.location.href = window.location.origin + "/";
          } else {
            navigate("/");
          }
        }, 2000);
      }
      return;
    }

    if (!code) {
      setStatus("error");
      setMessage("No authorization code received.");
      setTimeout(() => navigate("/"), 2000);
      return;
    }

    // We have a code — try to send it to the widget
    if (window.opener) {
      // Popup flow: send to opener (the widget iframe's parent)
      try {
        // Try sending to the RingCentral embeddable redirect handler format
        // The widget listens for messages from the redirect page
        window.opener.postMessage(
          {
            type: "rc-oauth-callback",
            callbackUri: window.location.href,
            code,
            state,
          },
          "*"
        );
        setStatus("success");
        setMessage("Login successful! Closing...");
        setTimeout(() => window.close(), 800);
      } catch {
        setStatus("success");
        setMessage("Login successful! Closing...");
        setTimeout(() => window.close(), 800);
      }
    } else {
      // Tab redirect flow (or iframe redirect)
      setStatus("success");
      setMessage("Login successful! Redirecting back to app...");

      const callbackData = {
        code,
        state,
        callbackUri: window.location.href,
        timestamp: Date.now(),
      };

      if (window.top && window.top !== window) {
        // We're inside an iframe (the widget's popup was blocked and the iframe navigated here)
        // Send the auth code to the top-level window via postMessage, then navigate top to app
        try {
          window.top.postMessage(
            { type: "rc-oauth-callback-from-iframe", ...callbackData },
            window.location.origin
          );
        } catch {
          // Cross-origin postMessage may fail, fall back to localStorage
        }
        setTimeout(() => {
          try {
            window.top!.location.href = window.location.origin + "/";
          } catch {
            navigate("/");
          }
        }, 800);
      } else {
        // We're the top window (tab redirect flow)
        try {
          localStorage.setItem("rc_oauth_callback", JSON.stringify(callbackData));
        } catch {
          // localStorage may be unavailable
        }
        setTimeout(() => navigate("/"), 800);
      }
    }
  }, [navigate]);

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
        <h2 className="text-lg font-semibold text-foreground mb-2">RingCentral Login</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
