import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

// When a session expires mid-use a protected request fails with UNAUTHED_ERR_MSG.
// Reload once so the AuthGate takes over and shows the password login screen.
// We deliberately do NOT redirect to a password-less login route. The guard +
// AuthGate (which blocks protected queries pre-auth) prevent a reload loop.
let handlingUnauthorized = false;
const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (handlingUnauthorized) return;
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  if (error.message !== UNAUTHED_ERR_MSG) return;

  handlingUnauthorized = true;
  window.location.reload();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);

// After a deploy the new service worker takes over at once (skipWaiting +
// clientsClaim), but the page already open is still the old build — so people
// kept seeing the previous version until a second refresh. Reload once when a
// new worker takes control, and look for one whenever the tab comes back.
//
// Except around a presentation (Present on the Sign-ups or Marketing Report, which
// marks <html> with sr-presenting while it is up): a reload would end it in front of the CEO.
// It also waits a few minutes after one ends, because stepping out is often
// brief (Esc by mistake, a look at Lead Docket) and the page remembers the slide
// to pick up from; a reload would put the report back on "This month" instead.
const AFTER_PRESENTING_MS = 5 * 60_000;
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  const html = document.documentElement;
  const presenting = () => html.classList.contains("sr-presenting");
  let pending = false, reloading = false, timer = 0, presentedUntil = 0;
  const reloadWhenFree = () => {
    if (!pending || reloading) return;
    window.clearTimeout(timer);
    if (presenting()) return;   // the class watcher below calls again when it ends
    const wait = presentedUntil + AFTER_PRESENTING_MS - Date.now();
    if (wait > 0) {
      timer = window.setTimeout(reloadWhenFree, wait);
      return;
    }
    reloading = true;
    window.location.reload();
  };
  let wasPresenting = presenting();
  new MutationObserver(() => {
    const now = presenting();
    if (wasPresenting && !now) {
      presentedUntil = Date.now();
      reloadWhenFree();
    }
    wasPresenting = now;
  }).observe(html, { attributes: true, attributeFilter: ["class"] });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;   // first install: nothing stale to replace
    pending = true;
    reloadWhenFree();
  });
  document.addEventListener("visibilitychange", () => {
    // Not mid-presentation: the new worker would take over the old build's page
    // mid-meeting, only to queue the reload above until it ends.
    if (document.visibilityState === "visible" && !presenting()) {
      navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
    }
  });
}
