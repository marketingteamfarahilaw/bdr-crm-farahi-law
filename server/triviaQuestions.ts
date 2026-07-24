/**
 * Team Trivia question bank — SERVER-ONLY. Never import this from client code:
 * question text is sent to players via trivia.state, and the answer only after
 * the host reveals, so answers never reach the client bundle.
 */

export type TriviaQuestion = { q: string; a: string; note: string };
export type TriviaCategory = {
  key: string;
  name: string;
  /** Points for the 1st / 2nd / 3rd correct answer by submission order. */
  pts: [number, number, number];
  /** True for the sudden-death category — host opens it only to break a tie. */
  tiebreaker?: boolean;
  qs: TriviaQuestion[];
};

export const TRIVIA_CATEGORIES: TriviaCategory[] = [
  {
    key: "easy",
    name: "Easy",
    pts: [3, 2, 1],
    qs: [
      {
        q: "In our line of work, what do the letters “P.I.” stand for?",
        a: "Personal Injury",
        note: "It also stands for Private Investigator — which is only our job on the fun days.",
      },
      {
        q: "In a lawsuit, the person who files the case is called the ______, and the person being sued is the ______.",
        a: "Plaintiff and Defendant",
        note: "From the Old French “plaintif” — literally, the one doing the complaining.",
      },
      {
        q: "What do we call the fee arrangement where the client pays nothing unless we win their case?",
        a: "A contingency fee",
        note: "It’s the reason “no fee unless we win” appears on roughly every PI billboard in California.",
      },
      {
        q: "In California, how many years does an adult generally have to file a personal injury lawsuit after an accident?",
        a: "Two years",
        note: "Code of Civil Procedure §335.1 — one of the shorter clocks in the building, which is why intake speed matters.",
      },
      {
        q: "What is the general legal term for the money awarded to compensate an injured person?",
        a: "Damages",
        note: "Confusingly singular in meaning: one dollar of compensation is still “damages.”",
      },
    ],
  },
  {
    key: "intermediate",
    name: "Intermediate",
    pts: [7, 4, 2],
    qs: [
      {
        q: "California follows a negligence rule that lets an injured person recover money even if they were 99% at fault. What is this rule called?",
        a: "Pure comparative negligence",
        note: "Your recovery just shrinks by your share of fault — 99% at fault still recovers 1%. Some states cut you off at 50%.",
      },
      {
        q: "Compensatory damages come in two big buckets. Name both.",
        a: "Economic damages (medical bills, lost wages) and non-economic damages (pain and suffering)",
        note: "Lawyers also call them “special” and “general” damages — same buckets, older labels.",
      },
      {
        q: "Which type of auto insurance coverage protects our client when the at-fault driver has no insurance — or not enough?",
        a: "Uninsured / Underinsured Motorist coverage (UM/UIM)",
        note: "Roughly one in six California drivers is uninsured — UM/UIM is often the only real money in the case.",
      },
      {
        q: "What do we call the formal package sent to an insurance company laying out liability, the injuries, and the amount we want to settle for?",
        a: "A demand letter (demand package)",
        note: "A great demand tells the whole story so well the adjuster can picture losing at trial.",
      },
      {
        q: "What is the sworn, out-of-court testimony where attorneys question a witness on the record before trial?",
        a: "A deposition",
        note: "Everything said is transcribed and can be read back at trial — which is why prep matters so much.",
      },
    ],
  },
  {
    key: "advanced",
    name: "Advanced",
    pts: [10, 7, 4],
    qs: [
      {
        q: "Before suing a California city, county, or the State itself, an injured person must first file what — and within how long?",
        a: "A government claim under the Government Claims Act — within six months of the injury",
        note: "Miss the six-month window and you’re begging the entity for leave to file late. The two-year rule does not save you here.",
      },
      {
        q: "A client’s health insurer paid their treatment bills and now wants to be repaid out of the settlement. What is the insurer’s right called?",
        a: "Subrogation — usually asserted as a lien on the recovery",
        note: "Negotiating these liens down is often worth thousands to the client — money won after the case is “won.”",
      },
      {
        q: "An insurer unreasonably rejects a settlement demand within policy limits, and trial ends in a verdict above those limits. What claim can force the insurer to pay the full verdict — beyond the policy?",
        a: "Bad faith (wrongful failure to settle) — it “opens up” the policy limits",
        note: "California’s Comunale and Crisci cases built this doctrine; it’s why a clean policy-limits demand is such a powerful weapon.",
      },
    ],
  },
  {
    key: "tiebreaker",
    name: "Sudden Death",
    pts: [5, 0, 0],
    tiebreaker: true,
    qs: [
      {
        q: "Closest answer wins! Out of 12 jurors, how many must agree to reach a civil verdict in California?",
        a: "Nine (three-quarters of the jury)",
        note: "Criminal verdicts need all 12 — civil justice settles for 9.",
      },
      {
        q: "Closest answer wins! As of January 1, 2025, what is California’s minimum bodily-injury liability coverage per person?",
        a: "$30,000 per person ($60,000 per accident)",
        note: "Doubled from the old 15/30 minimums that stood for over 50 years.",
      },
    ],
  },
];

/** Category metadata that is safe to send to every client (no answers). */
export function categoryMeta() {
  return TRIVIA_CATEGORIES.map((c) => ({
    key: c.key,
    name: c.name,
    pts: c.pts,
    tiebreaker: !!c.tiebreaker,
    count: c.qs.length,
  }));
}
