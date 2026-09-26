/**
 * The referring partner as Lead Docket's intake wrote it, reduced to a key — so
 * every lead that says the same thing gets the same answer. The Lead Docket
 * mirror stores it on each lead (facility_leads.partnerKey); the Data Check page
 * groups by it, and a partner someone picks for one lead is remembered for the
 * key (partner_aliases) and applied to every lead with it, past and future.
 *
 * Only this file computes it: the mirror, and the one-offs that fill it in,
 * import it, and the app reads the stored value — a second copy of rules like
 * these drifted once and caused a real bug.
 */
import { TEAM } from "./leaddocket-rules.mjs";

/** Letters and digits only, lower-cased; "&" and "and" dropped ("B&B Auto" = "B and B Auto"). */
export const nk = (s) => String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/\band\b/g, " ").replace(/[^a-z0-9]/g, "");

// A part naming a person who referred — a former client, an employee — names no
// partner, and nothing else in it counts either: "Former Client Ignacio
// Hernandez" must not match Hernandez Auto Body. That part is dropped.
const PERSON = /\b((former|existing|current|past|previous) client|employee referral)\b/i;

// Intake often names the rep: "Field Representative Genysys Sanchez / Reginos
// Auto Body". The rep is not the partner — that text once matched Sanchez Auto
// Body — so a part naming a rep is dropped ("Neighbor of Genysys Sanchez",
// "Field Representative Arden Burrows"), unless the partner follows the rep's
// name: "Lupe Campos from Valley Towing", "Field Rep Lupe Campos - Xtreme Auto".
// A rep is anyone on the roster, or the name after a title — former reps
// ("Field Representative Monica Valles") are on no list.
const MARK = "\u0001";
const REP_NAMES = TEAM.map(([full]) => new RegExp(`\\b${full.split(/\s+/).join("\\s+")}\\b`, "gi"));
const TITLED = /\b(?:[Ff]ield\s+[Rr]ep(?:resentative)?|BDR|[Bb]dr|[Ii]ntake)\b(?:\s+[A-Z][A-Za-z'’.-]*){0,2}/g;
const AFTER_REP = /^\s*(?:from|with|at|[-–—,:;])\s*(.*[A-Za-z].*)$/i;

// How it was said, around the name: "Referred by …", "Referral from …".
// Whole words only, so "Fromm Auto Body" keeps its name.
const EDGE = /^[\s,.;:()\-–—]+|[\s,.;:()\-–—]+$/g;
const LEADING = /^(?:(?:referred|referral|ref|from|with|by|via|thru|through)\b[\s,.;:()\-–—]*)+/i;
const TRAILING = /(?:[\s,.;:()\-–—]+(?:from|with|by|via))+$/i;
// Intake's ways of leaving it blank.
const BLANK = /^(n\/?a|none|no|unknown|nothing|x|-+|\?+)$/i;

/** One "/"-separated part without the rep, or "" when it only names people. */
function partOf(part) {
  if (PERSON.test(part)) return "";
  let t = part;
  for (const name of REP_NAMES) t = t.replace(name, MARK);
  t = t.replace(TITLED, MARK);
  if (t.includes(MARK)) {
    const after = AFTER_REP.exec(t.slice(t.lastIndexOf(MARK) + 1));
    if (!after) return "";
    t = after[1];
  }
  t = t.replace(EDGE, "").replace(LEADING, "").replace(TRAILING, "").replace(EDGE, "").replace(/\s+/g, " ");
  return BLANK.test(t) ? "" : t;
}

/** The part of intake's text that can name a partner ("" when it only names people, or nothing). */
export const partnerPart = (referrer) => {
  const text = String(referrer ?? "").trim();
  if (BLANK.test(text)) return "";
  return text.split("/").map(partOf).filter(Boolean).join(" / ");
};

/**
 * The key for a lead's referral text: "" when nothing in it can name a partner.
 * Two letters or fewer ("BC", "JW") are too little to remember an answer by.
 */
export const partnerKey = (referrer) => {
  const k = nk(partnerPart(referrer)).slice(0, 255);
  return k.length >= 3 ? k : "";
};
