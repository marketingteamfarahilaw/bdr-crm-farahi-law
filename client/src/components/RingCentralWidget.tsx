/**
 * RingCentral Embeddable Widget
 *
 * Renders the official RingCentral Embeddable iframe as a floating panel.
 * Auto-authenticates by passing clientId, clientSecret, and JWT directly
 * in the iframe URL — no Sign In button interaction required.
 *
 * Supports:
 *  - Auto JWT login via iframe URL parameters
 *  - Click-to-call via postMessage (use `triggerCall(phoneNumber)`)
 *  - Call-end event listener that fires `onCallEnd` with call metadata
 *  - Minimise / restore toggle
 *
 * IMPORTANT: Wrap the entire app with <RingCentralProvider onCallEnd={...}>
 * so that ClickToCallButton works from any page in the tree.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Minimize2, Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CallEndData {
  callId?: string;
  duration?: number;
  durationStr?: string;
  phoneNumber?: string;
  direction?: string;
  result?: string;
  startTime?: string;
}

interface RingCentralContextValue {
  triggerCall: (phoneNumber: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isConnected: boolean;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const RingCentralContext = createContext<RingCentralContextValue>({
  triggerCall: () => {},
  isOpen: false,
  setIsOpen: () => {},
  isConnected: false,
});

export function useRingCentral() {
  return useContext(RingCentralContext);
}

// ─── Provider (wraps entire app) ─────────────────────────────────────────────

interface RingCentralProviderProps {
  onCallEnd?: (data: CallEndData) => void;
  children: React.ReactNode;
}

export function RingCentralProvider({ onCallEnd, children }: RingCentralProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimised, setIsMinimised] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [activeCalls, setActiveCalls] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pendingCallRef = useRef<string | null>(null);

  // Fetch widget config (clientId, clientSecret, jwt) from backend
  const { data: widgetConfig } = trpc.crm.ringcentral.getWidgetConfig.useQuery(undefined, {
    staleTime: 60 * 60 * 1000, // 1 hour
    retry: false,
  });

  // Build the embeddable URL.
  // IMPORTANT: redirectUri must be the official RC embeddable redirect page.
  // The widget handles the OAuth popup internally using this URI.
  const officialRedirectUri = "https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/redirect.html";
  const widgetUrl = widgetConfig?.clientId
    ? (() => {
        const base = `https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/app.html`;
        const params = new URLSearchParams({
          clientId: widgetConfig.clientId,
          appServer: "https://platform.ringcentral.com",
          redirectUri: officialRedirectUri,
          defaultCallWith: "ringout",
          enableRingOut: "true",
        });
        return `${base}?${params.toString()}`;
      })()
    : null;

  // Send a postMessage to the iframe
  const postToWidget = useCallback((payload: object) => {
    iframeRef.current?.contentWindow?.postMessage(payload, "*");
  }, []);

  // Trigger a call — opens the widget and dials
  const triggerCall = useCallback((phoneNumber: string) => {
    setIsOpen(true);
    setIsMinimised(false);
    if (isConnected) {
      postToWidget({ type: "rc-adapter-new-call", phoneNumber, toCall: true });
    } else {
      // Store the number; dial it once the widget reports it is logged in
      pendingCallRef.current = phoneNumber;
    }
  }, [isConnected, postToWidget]);

  // Listen for messages from the RingCentral iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      switch (data.type) {
        case "rc-login-status-notify":
          setIsConnected(!!data.loggedIn);
          if (data.loggedIn) {
            // Switch calling mode to RingOut after login so calls go through desk/cell phone
            setTimeout(() => {
              postToWidget({
                type: "rc-adapter-update-calling-settings",
                callWith: "ringout",
              });
            }, 1200);
            if (pendingCallRef.current) {
              const num = pendingCallRef.current;
              pendingCallRef.current = null;
              setTimeout(() => {
                postToWidget({ type: "rc-adapter-new-call", phoneNumber: num, toCall: true });
              }, 1800);
            }
          }
          break;

        case "rc-adapter-pushAdapterState":
          if (pendingCallRef.current && isConnected) {
            const num = pendingCallRef.current;
            pendingCallRef.current = null;
            postToWidget({ type: "rc-adapter-new-call", phoneNumber: num, toCall: true });
          }
          break;

        case "rc-oauth-callback-from-iframe":
          if (data.callbackUri && iframeRef.current?.contentWindow) {
            postToWidget({
              type: "rc-adapter-authorization-code",
              callbackUri: data.callbackUri,
            });
          }
          break;

        case "rc-call-ring-notify":
        case "rc-call-start-notify":
          setActiveCalls((n) => n + 1);
          break;

        case "rc-call-end-notify": {
          setActiveCalls((n) => Math.max(0, n - 1));
          if (onCallEnd) {
            const call = data.call ?? {};
            const durationSecs = call.duration ?? 0;
            const durationStr = `${Math.floor(durationSecs / 60)}:${(durationSecs % 60).toString().padStart(2, "0")}`;
            onCallEnd({
              callId: call.sessionId ?? call.id,
              duration: durationSecs,
              durationStr,
              phoneNumber: call.toNumber ?? call.fromNumber,
              direction: call.direction,
              result: call.result,
              startTime: call.startTime,
            });
          }
          break;
        }

        default:
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [isConnected, onCallEnd, postToWidget]);

  // Listen for OAuth callback stored in localStorage
  useEffect(() => {
    const checkLocalStorageCallback = () => {
      const stored = localStorage.getItem("rc_oauth_callback");
      if (!stored) return;
      try {
        const data = JSON.parse(stored);
        if (Date.now() - data.timestamp > 60000) {
          localStorage.removeItem("rc_oauth_callback");
          return;
        }
        localStorage.removeItem("rc_oauth_callback");
        if (data.callbackUri && iframeRef.current?.contentWindow) {
          postToWidget({
            type: "rc-adapter-authorization-code",
            callbackUri: data.callbackUri,
          });
        }
      } catch {
        localStorage.removeItem("rc_oauth_callback");
      }
    };

    checkLocalStorageCallback();

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "rc_oauth_callback") {
        checkLocalStorageCallback();
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [postToWidget]);

  return (
    <RingCentralContext.Provider value={{ triggerCall, isOpen, setIsOpen, isConnected }}>
      {/* Render children (the rest of the app) */}
      {children}

      {/* Floating "Open Phone" toggle button */}
      <button
        onClick={() => {
          setIsOpen((prev) => !prev);
          setIsMinimised(false);
        }}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full px-4 py-3 shadow-lg transition-all",
          "text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isOpen
            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
        title={isOpen ? "Close phone" : "Open phone"}
      >
        {isOpen ? <PhoneOff size={16} /> : <Phone size={16} />}
        <span className="hidden sm:inline">{isOpen ? "Close Phone" : "Open Phone"}</span>
        {activeCalls > 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white font-bold">
            {activeCalls}
          </span>
        )}
      </button>

      {/* Widget panel */}
      {isOpen && (
        <div
          className={cn(
            "fixed bottom-20 right-6 z-50 flex flex-col rounded-xl border border-border bg-background shadow-2xl overflow-hidden transition-all",
            isMinimised ? "w-72 h-14" : "w-[360px] h-[600px]"
          )}
        >
          {/* Header bar */}
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <Phone size={14} className={isConnected ? "text-green-500" : "text-muted-foreground"} />
              <span className="text-xs font-medium text-foreground">RingCentral Phone</span>
              {isConnected && (
                <span className="text-[10px] text-green-500 font-medium">● Connected</span>
              )}
              {!isConnected && widgetConfig?.clientId && (
                <span className="text-[10px] text-yellow-500 font-medium">● Connecting…</span>
              )}
              {!widgetConfig?.clientId && (
                <span className="text-[10px] text-red-400 font-medium">● Not configured</span>
              )}
              {activeCalls > 0 && (
                <span className="text-[10px] text-red-500 font-medium animate-pulse">
                  ● {activeCalls} active call{activeCalls > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsMinimised((m) => !m)}
                className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                title={isMinimised ? "Expand" : "Minimise"}
              >
                {isMinimised ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                title="Close"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {/* RingOut mode hint */}
          {!isMinimised && isConnected && (
            <div className="px-3 py-1.5 bg-blue-950/40 border-b border-blue-500/20 flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] text-blue-300">📞 RingOut mode: your phone rings first, then connects to the facility.</span>
            </div>
          )}

          {/* Iframe or not-configured message */}
          {!isMinimised && (
            widgetUrl ? (
              <iframe
                ref={iframeRef}
                src={widgetUrl}
                className="flex-1 w-full border-0"
                allow="microphone; camera; autoplay; clipboard-write"
                title="RingCentral Phone"
              />
            ) : (
              <div className="flex-1 flex items-center justify-center p-6 text-center">
                <div>
                  <Phone size={32} className="mx-auto mb-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    RingCentral is not configured.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Please set the <strong>RINGCENTRAL_CLIENT_ID</strong> environment variable.
                  </p>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </RingCentralContext.Provider>
  );
}

// ─── Legacy named export (kept for backward compatibility) ───────────────────
// Some pages import { RingCentralWidget } — keep it as an alias.
export const RingCentralWidget = RingCentralProvider;

// ─── Click-to-Call Button ────────────────────────────────────────────────────

interface ClickToCallButtonProps {
  phoneNumber: string;
  className?: string;
  children?: React.ReactNode;
}

export function ClickToCallButton({ phoneNumber, className, children }: ClickToCallButtonProps) {
  const { triggerCall } = useRingCentral();

  if (!phoneNumber) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerCall(phoneNumber);
      }}
      className={cn(
        "inline-flex items-center gap-1 text-primary hover:text-primary/80 transition-colors",
        className
      )}
      title={`Call ${phoneNumber}`}
    >
      <Phone size={12} className="shrink-0" />
      {children ?? phoneNumber}
    </button>
  );
}
