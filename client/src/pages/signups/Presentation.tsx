/**
 * Presentation mode for the Sign-ups Report: the report as a full-screen deck,
 * one idea per slide, for presenting to the CEO. Opened by the report's Present
 * button; the slides themselves are in ./slides.
 *
 * Why it works the way it does:
 * - It uses only the report data already on screen (no server calls) and freezes
 *   it on entry, so a Lead Docket sync landing mid-meeting can't move a number
 *   while someone is talking about it. Exit and present again to refresh.
 * - Slides are laid out on a fixed 1920×1080 stage scaled evenly to the screen,
 *   so a projector, a TV and a laptop all show the same layout.
 * - It is a fixed overlay portalled to <body>, above everything in the app
 *   (sidebar, RingCentral widget, the report's own dialogs). The page asks for
 *   real fullscreen inside the Present click (./fullscreen); that only removes
 *   the browser's chrome, and where it isn't available (iPhone Safari) the
 *   overlay alone fills the window.
 * - While it is up, the page behind is inert and toasts are hidden, so a stray
 *   Tab or Space can't reach a hidden button and a "Call ended — (phone)" toast
 *   can't appear in front of the CEO.
 * - A presenter clicker is a keyboard: it sends arrows or PageUp/PageDown, B or
 *   "." for a black screen, and F5/Esc from its slideshow button. Keys never
 *   bring up the control bar, so the audience's view stays clean.
 * - A mouse click anywhere is "next", as in PowerPoint: the pointer hides when
 *   idle, so which half of the screen it is on can't decide the direction. Only
 *   a touch tap, where the finger shows the side, goes back on the left half.
 * - Leaving fullscreen ends the deck, but the page remembers the slide (onPlace),
 *   so presenting the same filters again picks up where it was (resume).
 * - It holds a screen wake lock, so a laptop left on one slide while the room
 *   talks doesn't dim or lock. And main.tsx holds off a new build's reload while
 *   the deck is up (it watches the sr-presenting class on <html>).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import type { ReportData } from "../SignupsDashboard";
import { buildSlides, type DeckContext } from "./slides";
import { FULLSCREEN_EVENTS, exitFullscreen, fullscreenElement } from "./fullscreen";
import "./Presentation.css";

/** Where a presentation is: the slide on screen, and when presenting began (the presenter's clock). */
export type DeckPlace = { slide: string; startedAt: number };

export type PresentationProps = DeckContext & {
  data: ReportData;
  /** Pick up here: the page passes the last place when the same filters are presented again. */
  resume?: DeckPlace;
  /** Told of every slide change, so the page can offer resume. */
  onPlace?: (place: DeckPlace) => void;
  onExit: () => void;
};

const STAGE_W = 1920, STAGE_H = 1080;
const BAR_ENTRY_MS = 4000, BAR_IDLE_MS = 2500;
// A still mouse, or a clicker's mouse-mode jitter, shouldn't wake the bar.
const WAKE_PX = 4;
const SWIPE_PX = 60, TAP_PX = 10;

export default function Presentation({ data, resume, onPlace, onExit, ...filters }: PresentationProps) {
  // Frozen for the meeting (see above); the filters with it, so labels always match the numbers.
  const [frozen] = useState(() => ({ data, ctx: filters }));
  const slides = useMemo(() => buildSlides(frozen.data, frozen.ctx), [frozen]);
  // Tracked by id, so a re-render can never jump to another slide. On resume, a
  // slide that no longer exists (the data changed since) starts from the cover.
  const [currentId, setCurrentId] = useState(() =>
    resume && slides.some((s) => s.id === resume.slide) ? resume.slide : slides[0].id);
  // Only for the entry hint, which then says how to get back to the start.
  const [resumed] = useState(() => currentId !== slides[0].id);
  const found = slides.findIndex((s) => s.id === currentId);
  const index = found < 0 ? 0 : found;
  const slide = slides[index];
  const total = slides.length;

  const deckRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(() => Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
  const [blank, setBlank] = useState(false);
  const [barOn, setBarOn] = useState(true);
  const [hint, setHint] = useState(true);
  // The same meeting carries on, so its clock does too.
  const [startedAt] = useState(() => resume?.startedAt ?? Date.now());

  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  useEffect(() => {
    onPlaceRef.current?.({ slide: slide.id, startedAt });
  }, [slide.id, startedAt]);

  // ---- leaving: Esc, Exit, or the browser leaving fullscreen on its own
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const left = useRef(false);
  const leave = useCallback(() => {
    if (left.current) return;
    left.current = true;
    exitFullscreen();
    onExitRef.current();
  }, []);

  // ---- the control bar: shown on entry and on mouse movement, hidden when idle
  const hideTimer = useRef(0);
  const holdBar = useRef(false);   // hovered, or a bar button has keyboard focus
  const showBar = useCallback((ms = BAR_IDLE_MS) => {
    setBarOn(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (holdBar.current) return;
      setBarOn(false);
      setHint(false);
    }, ms);
  }, []);
  useEffect(() => {
    showBar(BAR_ENTRY_MS);
    return () => window.clearTimeout(hideTimer.current);
  }, [showBar]);

  // ---- navigation. While blanked, any navigation key just brings the slide back.
  const goTo = (i: number) => {
    setCurrentId(slides[Math.max(0, Math.min(total - 1, i))].id);
    setHint(false);
  };
  const next = () => {
    if (blank) return setBlank(false);
    // Nothing after the last slide; show the bar so Exit is in reach.
    if (index >= total - 1) return showBar();
    goTo(index + 1);
  };
  const prev = () => {
    if (blank) return setBlank(false);
    if (index > 0) goTo(index - 1);
  };
  const jump = (i: number) => (blank ? setBlank(false) : goTo(i));
  const toggleBlank = () => {
    // Black means black: the bar goes with the slide, until the mouse moves.
    if (!blank && !holdBar.current) {
      window.clearTimeout(hideTimer.current);
      setBarOn(false);
      setHint(false);
    }
    setBlank(!blank);
  };
  const nav = useRef({ next, prev, jump, toggleBlank });
  nav.current = { next, prev, jump, toggleBlank };

  // ---- keyboard and clicker, on the capture phase so nothing behind the deck sees these keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      const mod = e.ctrlKey || e.metaKey;
      // The app's own shortcuts would act unseen behind the slides: Ctrl/Cmd+K
      // opens the search palette, Ctrl/Cmd+B folds the sidebar.
      if (mod && (k === "k" || k === "K" || k === "b" || k === "B")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // A clicker's slideshow button sends F5 (and Esc on its second press):
      // F5 would reload the CRM mid-meeting.
      if (k === "F5" && !mod && !e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (mod || e.altKey) return;   // every other combination is the browser's
      // Enter or Space on a focused bar button: its own click handles it.
      if ((k === "Enter" || k === " ") && e.target instanceof Element && e.target.closest(".sr-deck-bar button")) return;

      const go = nav.current;
      switch (k) {
        case "ArrowRight": case "ArrowDown": case "PageDown": case "n": case "N":
          go.next(); break;
        case " ":
          if (e.shiftKey) go.prev(); else go.next();
          break;
        case "ArrowLeft": case "ArrowUp": case "PageUp": case "Backspace": case "p": case "P":
          go.prev(); break;
        case "Home": go.jump(0); break;
        case "End": go.jump(Number.MAX_SAFE_INTEGER); break;
        case "Escape": leave(); break;
        case "b": case "B": case ".":
          go.toggleBlank(); break;
        default:
          return;
      }
      // Nothing behind the deck scrolls or reacts.
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [leave]);

  // ---- the browser leaving fullscreen by itself (its own Esc, F11, an OS gesture) ends the presentation.
  // Only once fullscreen was actually reached: a refused or unsupported request
  // leaves the overlay up on purpose.
  useEffect(() => {
    let entered = !!fullscreenElement();
    const onChange = () => {
      if (fullscreenElement()) entered = true;
      else if (entered) leave();
    };
    FULLSCREEN_EVENTS.forEach((t) => document.addEventListener(t, onChange));
    return () => FULLSCREEN_EVENTS.forEach((t) => document.removeEventListener(t, onChange));
  }, [leave]);

  // ---- the page behind: no scrolling, no focus, no toasts; all put back on the way out,
  // including when Back or a route change unmounts the deck. Layout effect, so
  // the page is live again before the Present button takes focus back.
  useLayoutEffect(() => {
    const html = document.documentElement, body = document.body;
    const root = document.getElementById("root");
    const before = { html: html.style.overflow, body: body.style.overflow, inert: root?.inert ?? false };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.classList.add("sr-presenting");
    if (root) root.inert = true;
    deckRef.current?.focus({ preventScroll: true });
    return () => {
      exitFullscreen();
      html.style.overflow = before.html;
      body.style.overflow = before.body;
      html.classList.remove("sr-presenting");
      if (root) root.inert = before.inert;
    };
  }, []);

  // ---- keep the screen on. Fullscreen alone doesn't: a laptop left on one slide
  // while the room talks would dim, then lock, on the projector. The system drops
  // the lock whenever the tab is hidden, so it is asked for again on return.
  // Unsupported or refused (battery saver) is fine: the deck works without it.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let asking = false, done = false;
    const hold = async () => {
      if (done || asking || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
      if (lock && !lock.released) return;
      asking = true;
      try {
        const got = await navigator.wakeLock.request("screen");
        if (done) got.release().catch(() => {});
        else lock = got;
      } catch {
        /* refused */
      } finally {
        asking = false;
      }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") hold(); };
    hold();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      done = true;
      document.removeEventListener("visibilitychange", onVisibility);
      lock?.release().catch(() => {});
    };
  }, []);

  // ---- fit the stage to the screen; follows fullscreen, rotation and iOS toolbars
  useLayoutEffect(() => {
    const el = deckRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w && h) setScale(Math.min(w / STAGE_W, h / STAGE_H));
    };
    fit();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", fit);
      return () => window.removeEventListener("resize", fit);
    }
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- pointer: a click is next; on touch, tap the right or left half, or swipe
  const lastPoint = useRef<{ x: number; y: number; at: number; moved: number } | null>(null);
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const p = lastPoint.current;
    // Movement adds up only while it continues; a pause starts the count again.
    const moved = p && e.timeStamp - p.at < 400 ? p.moved + Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) : 0;
    lastPoint.current = { x: e.clientX, y: e.clientY, at: e.timeStamp, moved: moved >= WAKE_PX ? 0 : moved };
    if (moved >= WAKE_PX) showBar();
  };

  const inBar = (target: EventTarget) => target instanceof Element && !!target.closest(".sr-deck-bar");

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const touchedAt = useRef(0);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
    // A phone has no Esc key: every touch brings Exit back.
    showBar();
  };
  // Taps are handled here rather than by click: iOS Safari doesn't reliably send
  // a click for a plain div when the only listener is on <body>, where the deck
  // is portalled. The click that may follow is then ignored.
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const t = e.changedTouches[0];
    if (!start || !t || inBar(e.target)) return;
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      touchedAt.current = Date.now();
      if (dx < 0) next(); else prev();
    } else if (Math.abs(dx) < TAP_PX && Math.abs(dy) < TAP_PX) {
      touchedAt.current = Date.now();
      if (t.clientX >= window.innerWidth / 2) next(); else prev();
    }
  };
  const onClick = (e: React.MouseEvent) => {
    // The deck is portalled, but React still bubbles its events up the page's tree.
    e.stopPropagation();
    if (inBar(e.target)) return;
    if (Date.now() - touchedAt.current < 700) return;   // already handled as a tap or swipe
    // Always forward: going back is the keyboard's, the clicker's and the bar's.
    next();
  };

  // A mouse click must not leave focus on a bar button, where Space would press it again.
  const noFocus = (e: React.MouseEvent) => e.preventDefault();
  const barHold = (on: boolean) => {
    holdBar.current = on;
    if (on) {
      setBarOn(true);
      window.clearTimeout(hideTimer.current);
    } else {
      showBar();
    }
  };

  return createPortal(
    <div
      ref={deckRef}
      className={`sr sr-deck${barOn ? "" : " idle"}${blank ? " blank" : slide.dark ? " on-dark" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Sign-ups report presentation"
      tabIndex={-1}
      onClick={onClick}
      onPointerMove={onPointerMove}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {!blank && (
        <div className="sr-deck-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
          <div key={slide.id} className="sr-deck-slide" role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${total}: ${slide.label}`}>
            {slide.render({ n: index + 1, of: total })}
          </div>
        </div>
      )}
      {!blank && <div className="sr-deck-progress" style={{ width: `${((index + 1) / total) * 100}%` }} />}
      <div className="sr-deck-rotate">Turn your phone sideways to present</div>

      <div
        className={`sr-deck-bar${barOn ? "" : " off"}`}
        role="toolbar"
        aria-label="Presentation controls"
        onMouseEnter={() => barHold(true)}
        onMouseLeave={() => barHold(false)}
        onFocus={() => barHold(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) barHold(false); }}
      >
        {/* aria-disabled, not disabled: a disabled button drops keyboard focus out
            of the dialog (to <body>) at the first or last slide. prev() and next()
            already do nothing there. */}
        <button onMouseDown={noFocus} onClick={prev} aria-disabled={index === 0 && !blank} aria-label="Previous slide">
          <ChevronLeft /><span className="t">Previous</span>
        </button>
        <span className="sr-deck-count">{index + 1} / {total}</span>
        <button onMouseDown={noFocus} onClick={next} aria-disabled={index === total - 1 && !blank} aria-label="Next slide">
          <span className="t">Next</span><ChevronRight />
        </button>
        <span className="sep" />
        <Elapsed since={startedAt} />
        <span className="sep" />
        <button onMouseDown={noFocus} onClick={leave} className="exit"><X /> Exit</button>
        {hint && (
          <span className="sr-deck-hint">{resumed ? "Picked up where you left off · Home for the first slide" : "← → or clicker · Esc to exit"}</span>
        )}
      </div>

      <div className="sr-deck-live" aria-live="polite">
        {blank ? "Screen blanked" : `Slide ${index + 1} of ${total}: ${slide.label}`}
      </div>
    </div>,
    document.body,
  );
}

/** Time since presenting began, for the presenter only. Its own component, so the tick doesn't re-render slides. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="sr-deck-time" title="Time presenting">
      <Clock />{h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`}
    </span>
  );
}
