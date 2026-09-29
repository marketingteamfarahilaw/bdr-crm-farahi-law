/**
 * Holding navigation while a form has unsaved changes (hooks/useUnsavedChanges).
 *
 * Imported first thing in main.tsx, before the router, on purpose. For the
 * browser's Back/Forward, Chromium runs a window's popstate listeners in the
 * order they were added whatever their capture flag, so this one must be added
 * before wouter's to be able to stop wouter from seeing the change.
 *
 * Links, buttons and menu items navigate through history.pushState/replaceState
 * (wouter patches them); those are wrapped here too, so a move to another page
 * is held while a guard is on and asked about instead.
 */
type Guard = { holding: () => boolean; ask: (go: () => void) => void };

let guard: Guard | null = null;
/** Set by the form while it's open; null when it closes. */
export function setNavigationGuard(g: Guard | null) {
  guard = g;
}
/** While true, navigation passes straight through (the user chose to leave). */
let passing = false;
const through = (go: () => void) => () => { passing = true; try { go(); } finally { passing = false; } };

if (typeof window !== "undefined" && !(window as any).__navGuardInstalled) {
  (window as any).__navGuardInstalled = true;
  const held = () => !passing && !!guard?.holding();
  const leavesPage = (url?: string | URL | null) => url != null && new URL(String(url), location.href).pathname !== location.pathname;

  for (const type of ["pushState", "replaceState"] as const) {
    const original = history[type];
    history[type] = function (this: History, data: any, unused: string, url?: string | URL | null) {
      if (leavesPage(url) && held()) {
        // Ask; if they leave, go the same way, through wouter's own patch above this one.
        guard!.ask(through(() => history[type](data, unused, url)));
        return;
      }
      return original.call(this, data, unused, url);
    };
  }

  // Back/Forward already moved the address bar. Put the form's address back
  // (without wouter noticing) and ask; leaving then goes where they were headed.
  let formUrl = location.href;
  window.addEventListener("popstate", (e) => {
    if (!held()) { formUrl = location.href; return; }
    e.stopImmediatePropagation();
    const target = location.href;
    const push = History.prototype.pushState;
    push.call(history, history.state, "", formUrl);
    guard!.ask(through(() => history.pushState(null, "", target)));
  });
  // Keep formUrl current for the page the guard is protecting.
  for (const type of ["pushState", "replaceState"] as const)
    window.addEventListener(type, () => { formUrl = location.href; });
}
