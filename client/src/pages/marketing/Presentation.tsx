/**
 * Presentation mode for the Marketing Report: the report as a full-screen deck,
 * opened by its Present button. The shell (stage, keys, clicker, control bar,
 * fullscreen, wake lock, resume) is the Sign-ups deck's Deck; the slides are in
 * ./deckSlides.
 *
 * Like the Sign-ups deck it freezes the dashboard data on screen when it opens.
 * The one thing not already on screen is the appendix's list of rejected cases,
 * so that is fetched first, behind a "Preparing slides…" screen with its own way
 * out, and the deck is built once it arrives. The page's Rejected panel and the
 * Present button's hover ask for the very same list, so usually it is already
 * here. If it can't be had, the deck is built without the appendix rather than
 * keep a room waiting.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Deck, usePageBehind, type DeckPlace } from "../signups/Presentation";
import { FULLSCREEN_EVENTS, exitFullscreen, fullscreenElement } from "../signups/fullscreen";
import { REJECTED_FRESH_MS, rejectedQuery } from "./shared";
import { buildMarketingSlides, type DeckContext, type MarketingData, type RejectedCases } from "./deckSlides";
import "./Presentation.css";

export type MarketingPresentationProps = DeckContext & {
  data: MarketingData;
  /** Pick up here: the page passes the last place when the same filters are presented again. */
  resume?: DeckPlace;
  /** Told of every slide change, so the page can offer resume. */
  onPlace?: (place: DeckPlace) => void;
  onExit: () => void;
};

export default function MarketingPresentation({ data, resume, onPlace, onExit, ...ctx }: MarketingPresentationProps) {
  // Frozen for the meeting, the filters with it, so labels always match the numbers.
  const [frozen] = useState(() => ({ data, ctx }));
  // The appendix is only for those cleared for intake case facts, and only when something was rejected.
  const wanted = frozen.data.caseFacts && frozen.data.totals.rejected > 0;
  // undefined while it loads; null when there is none, or it couldn't be had.
  const [cases, setCases] = useState<RejectedCases | null | undefined>(wanted ? undefined : null);
  const q = trpc.marketing.leads.useQuery(rejectedQuery(frozen.ctx.from, frozen.ctx.to), {
    // Asked once: after that the deck is built and frozen, so a refetch would change nothing.
    enabled: cases === undefined,
    // A list fetched in the last minute (the panel's, or the button's hover) is used as is;
    // an older one is fetched again first, so it matches the numbers on the slides.
    staleTime: REJECTED_FRESH_MS,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  if (cases === undefined && !q.isFetching && (q.data || q.isError)) setCases(q.data ?? null);

  if (cases === undefined) return <Preparing onExit={onExit} />;
  return (
    <Deck build={() => buildMarketingSlides(frozen.data, frozen.ctx, cases)} label="Marketing report presentation"
      resume={resume} onPlace={onPlace} onExit={onExit} />
  );
}

/**
 * While the rejected cases load: the deck's own canvas, a line saying so, and
 * Exit. It holds the page as the deck does (inert, no toasts, no reload), and
 * Esc or the browser leaving fullscreen ends it, so a slow list never traps anyone.
 */
function Preparing({ onExit }: { onExit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const left = useRef(false);
  const leave = useCallback(() => {
    if (left.current) return;
    left.current = true;
    exitFullscreen();
    onExitRef.current();
  }, []);
  usePageBehind(ref);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key, mod = e.ctrlKey || e.metaKey;
      if (k === "Escape") leave();
      // As in the deck: a clicker's F5 would reload the CRM, and the app's own
      // shortcuts (search, sidebar) would act unseen behind this screen.
      else if (!(k === "F5" || (mod && /^[kb]$/i.test(k)))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    // Only once fullscreen was reached: a refused request leaves this screen up on purpose.
    let entered = !!fullscreenElement();
    const onChange = () => {
      if (fullscreenElement()) entered = true;
      else if (entered) leave();
    };
    window.addEventListener("keydown", onKey, true);
    FULLSCREEN_EVENTS.forEach((t) => document.addEventListener(t, onChange));
    return () => {
      window.removeEventListener("keydown", onKey, true);
      FULLSCREEN_EVENTS.forEach((t) => document.removeEventListener(t, onChange));
    };
  }, [leave]);

  return createPortal(
    <div ref={ref} className="sr sr-deck mk-dk-prep" role="dialog" aria-modal="true" aria-label="Marketing report presentation"
      aria-busy="true" tabIndex={-1}>
      <p className="mk-dk-prep-t" role="status"><Loader2 className="sr-spin" /> Preparing slides…</p>
      <div className="sr-deck-bar" role="toolbar" aria-label="Presentation controls">
        <button type="button" className="exit" onClick={leave}><X /> Exit</button>
      </div>
    </div>,
    document.body,
  );
}
