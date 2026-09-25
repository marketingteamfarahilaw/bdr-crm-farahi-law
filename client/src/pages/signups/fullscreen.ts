/**
 * Fullscreen for the Sign-ups Report's presentation mode.
 *
 * Kept apart from the deck, and loaded with the page, on purpose: browsers only
 * grant fullscreen from inside the click that asked for it (Safari strictly so),
 * and at the moment of the Present click the deck's lazily loaded code may not
 * have arrived yet. So the page calls enterFullscreen() in its click handler and
 * the deck only listens for the outcome.
 *
 * Fullscreen is a nicety on top of the deck's own full-window overlay, never a
 * requirement: every call here is a silent no-op where it isn't supported
 * (iPhone Safari) or is refused.
 */

type FullscreenDoc = {
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => void;
};
type FullscreenEl = {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
  webkitRequestFullscreen?: () => void;
};

export const FULLSCREEN_EVENTS = ["fullscreenchange", "webkitfullscreenchange"] as const;

const doc = () => document as unknown as FullscreenDoc;

/** Swallows a rejected promise or a thrown error: a refusal is not worth an error. */
function quietly(run: () => unknown) {
  try {
    const result = run();
    if (result instanceof Promise) result.catch(() => {});
  } catch {
    /* unsupported or refused */
  }
}

export function fullscreenElement(): Element | null {
  const d = doc();
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

/** The whole page, so the deck (a fixed overlay on <body>) fills the screen. */
export function enterFullscreen() {
  if (fullscreenElement()) return;
  const el = document.documentElement as unknown as FullscreenEl;
  if (el.requestFullscreen) quietly(() => el.requestFullscreen!({ navigationUI: "hide" }));
  else if (el.webkitRequestFullscreen) quietly(() => el.webkitRequestFullscreen!());
}

export function exitFullscreen() {
  if (!fullscreenElement()) return;
  const d = doc();
  if (d.exitFullscreen) quietly(() => d.exitFullscreen!());
  else if (d.webkitExitFullscreen) quietly(() => d.webkitExitFullscreen!());
}

/**
 * Leaves fullscreen now or, when a request made in this same click hasn't taken
 * effect yet (browsers switch about a frame later), as soon as it does. A
 * refused request sends no change, so the wait gives up after `ms`.
 */
export function exitFullscreenSoon(ms = 2000) {
  if (fullscreenElement()) return exitFullscreen();
  const stop = () => {
    window.clearTimeout(timer);
    FULLSCREEN_EVENTS.forEach((t) => document.removeEventListener(t, onChange));
  };
  const onChange = () => {
    stop();
    exitFullscreen();
  };
  const timer = window.setTimeout(stop, ms);
  FULLSCREEN_EVENTS.forEach((t) => document.addEventListener(t, onChange));
}
