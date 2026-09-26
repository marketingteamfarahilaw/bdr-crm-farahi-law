import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { Loader2, Plus, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { CURRENT_TEAM } from "@shared/team";

/** The CRM's partner kinds (crm.facilities.create), for adding one from Lead Docket's words. */
export const PARTNER_CATEGORIES = [
  { value: "body_shop", label: "Body shop" },
  { value: "chiropractor", label: "Chiropractor" },
  { value: "physical_therapist", label: "Physical therapist" },
  { value: "medical_clinic", label: "Medical clinic" },
  { value: "orthopedic_doctor", label: "Orthopedic doctor" },
  { value: "imaging_center", label: "Imaging center" },
  { value: "other", label: "Other (towing, insurance…)" },
] as const;
export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number]["value"];
export type NewPartner = { name: string; category: PartnerCategory; city: string };

const guessCategory = (s: string): PartnerCategory => {
  const t = s.toLowerCase();
  if (/chiro|spine/.test(t)) return "chiropractor";
  if (/physical therap|\bpt\b|rehab/.test(t)) return "physical_therapist";
  if (/ortho/.test(t)) return "orthopedic_doctor";
  if (/imaging|mri|x-?ray/.test(t)) return "imaging_center";
  if (/medical|clinic|health|urgent|\bdr\b|doctor/.test(t)) return "medical_clinic";
  if (/body|collision|paint|auto repair|autobody/.test(t)) return "body_shop";
  return "other";
};

const TEAM_NAMES = Object.values(CURRENT_TEAM).flat().map((n) => n.toLowerCase());
const GENERIC = new Set(["the", "and", "with", "from", "for", "auto", "body", "shop", "collision", "center", "centre", "repair",
  "towing", "tow", "medical", "health", "clinic", "care", "insurance", "services", "service", "group", "inc", "llc",
  "chiropractic", "chiro", "wellness", "urgent", "paint"]);
const nameWords = (s: string) => s.toLowerCase().replace(/['’]s\b/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

/** Lead Docket's words without the rep ("Field Representative Lupe Campos / …" names no partner). */
export const partnerWords = (said: string | null) => String(said ?? "").split("/")
  .filter((part) => !/field rep|\bbdr\b|intake/i.test(part) && !TEAM_NAMES.some((n) => part.toLowerCase().includes(n)))
  .join(" ").trim();

/** Partners sharing a distinctive word with what Lead Docket says ("Luke with First Health Medical"). */
export function suggestPartners(options: { id: number; name: string; territory: string | null }[], said: string | null) {
  const words = new Set(nameWords(partnerWords(said)));
  if (!words.size) return [];
  return options
    .map((o) => {
      let score = 0;
      for (const w of Array.from(new Set(nameWords(o.name)))) if (words.has(w)) score += GENERIC.has(w) ? 0.2 : 1;
      return { o, score };
    })
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score || a.o.name.localeCompare(b.o.name))
    .slice(0, 6)
    .map((x) => x.o);
}

/**
 * Pick a referring partner — for one lead (Sign-ups Report) or for every lead
 * with the same words (Data Check). With onCreate, a partner the CRM doesn't
 * have yet can be added on the spot.
 */
export function PartnerPicker({ title, who, said, currentId, pending, onPick, none, onCreate, hint, onClose }: {
  title: string;
  who: ReactNode;
  said: string | null;
  currentId?: number | null;
  pending: boolean;
  onPick: (facilityId: number) => void;
  none?: { label: string; run: () => void };
  onCreate?: (p: NewPartner) => void;
  hint: string;
  onClose: () => void;
}) {
  const options = trpc.dataCheck.partners.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<NewPartner | null>(null);
  // Capture phase: Esc closes this picker only, not the window underneath.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const all = options.data ?? [];
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length
    ? all.filter((o) => words.every((w) => `${o.name} ${o.territory ?? ""}`.toLowerCase().includes(w)))
    : suggestPartners(all, said);
  const shown = found.slice(0, 40);
  const startAdding = () => {
    const name = search.trim() || partnerWords(said);
    setAdding({ name, category: guessCategory(`${name} ${said ?? ""}`), city: "" });
  };

  // Portalled so it isn't clipped by, or stacked under, the window it opens from.
  return createPortal(
    <div className="sr sr-layer">
      <div className="sr-modal-back sr-modal-top" onClick={onClose}>
        <div className="sr-modal sr-pick" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
          <div className="sr-panel-h" style={{ marginBottom: 6 }}>
            <div className="sr-ttl"><h2>{adding ? "Add a new partner" : "Link to a partner"}</h2></div>
            <button className="sr-arr" aria-label="Close" onClick={onClose}><X /></button>
          </div>
          <p className="sr-sub">
            {who}
            {said && <><br />Lead Docket says: “{said}”</>}
          </p>

          {adding ? (
            <form className="sr-add" onSubmit={(e) => { e.preventDefault(); if (adding.name.trim().length >= 2) onCreate?.(adding); }}>
              <label>Name
                <input autoFocus className="sr-input" value={adding.name} maxLength={255}
                  onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
              </label>
              <label>Kind
                <select className="sr-input" value={adding.category} onChange={(e) => setAdding({ ...adding, category: e.target.value as PartnerCategory })}>
                  {PARTNER_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <label>City <i>(optional)</i>
                <input className="sr-input" value={adding.city} maxLength={120} placeholder="e.g. Fresno"
                  onChange={(e) => setAdding({ ...adding, city: e.target.value })} />
              </label>
              <div className="sr-pick-foot">
                <span className="sr-hint">It's added to Facilities, and these leads count under it. Add its address and contacts there later.</span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="sr-btn2" onClick={() => setAdding(null)} disabled={pending}>Back</button>
                  <button type="submit" className="sr-btn1" disabled={pending || adding.name.trim().length < 2}>
                    {pending && <Loader2 className="sr-spin" />} Add and link
                  </button>
                </span>
              </div>
            </form>
          ) : (
            <>
              <input autoFocus className="sr-input" style={{ width: "100%", margin: "8px 0 12px" }} value={search}
                onChange={(e) => setSearch(e.target.value)} placeholder="Search partners by name or territory…" aria-label="Search partners" />
              {options.isLoading ? (
                <p className="sr-nil"><Loader2 size={13} className="sr-spin" /> Loading partners…</p>
              ) : (
                <>
                  {!words.length && <p className="sr-pick-h">{shown.length ? "Suggested from what Lead Docket says" : "Type a partner's name to find it"}</p>}
                  <div className="sr-pick-list">
                    {shown.map((o) => (
                      <button key={o.id} className={o.id === currentId ? "on" : ""} disabled={pending} onClick={() => onPick(o.id)}>
                        <b>{o.name}</b>{o.territory && <i>{o.territory}</i>}{o.id === currentId && <em>current</em>}
                      </button>
                    ))}
                    {words.length > 0 && found.length === 0 && !onCreate && (
                      <p className="sr-nil">No partner by that name. Add it under <Link href="/crm/facilities/new">Facilities</Link> first, then link it here.</p>
                    )}
                    {onCreate && (words.length > 0 || !shown.length) && (
                      <button className="sr-pick-new" disabled={pending} onClick={startAdding}>
                        <Plus /> <b>Add {search.trim() ? `“${search.trim()}”` : "a new partner"}</b><i>not in the CRM yet</i>
                      </button>
                    )}
                  </div>
                  {found.length > shown.length && <p className="sr-sub" style={{ marginTop: 8 }}>{found.length - shown.length} more — keep typing to narrow it down.</p>}
                </>
              )}
              <div className="sr-pick-foot">
                <span className="sr-hint">{hint}</span>
                {none && <button className="sr-btn2" disabled={pending} onClick={none.run}>{none.label}</button>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
