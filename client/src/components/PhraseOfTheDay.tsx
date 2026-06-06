import { Quote } from "lucide-react";
import { motion } from "framer-motion";

// Curated for a business-development / client-service team. Rotates daily.
const PHRASES: { text: string; author?: string }[] = [
  { text: "Every call is a chance to change someone's day — and someone's case." },
  { text: "Relationships built today are the referrals of tomorrow." },
  { text: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
  { text: "Opportunities don't happen. You create them.", author: "Chris Grosser" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "People don't care how much you know until they know how much you care.", author: "Theodore Roosevelt" },
  { text: "The fortune is in the follow-up." },
  { text: "A 'no' today is a 'not yet' — not a 'never'." },
  { text: "Show up. Follow up. Never give up." },
  { text: "Be so good they can't ignore you.", author: "Steve Martin" },
  { text: "Energy and persistence conquer all things.", author: "Benjamin Franklin" },
  { text: "One genuine conversation can outweigh a hundred cold pitches." },
  { text: "Trust is built in drops and lost in buckets — pour generously." },
  { text: "The best way to predict the future is to create it.", author: "Peter Drucker" },
  { text: "Champions keep playing until they get it right.", author: "Billie Jean King" },
  { text: "Make each day your masterpiece.", author: "John Wooden" },
  { text: "You miss 100% of the calls you don't make." },
  { text: "Great things never come from comfort zones." },
  { text: "Hard work beats talent when talent doesn't work hard." },
  { text: "Plant the seed today; the referral grows tomorrow." },
  { text: "Win the morning, win the day." },
  { text: "Discipline is choosing between what you want now and what you want most." },
  { text: "Kindness is a language partners never forget." },
  { text: "Progress, not perfection." },
  { text: "Serve first — the results follow." },
  { text: "Your network is your net worth." },
  { text: "Persistence is the twin sister of excellence.", author: "Marabel Morgan" },
  { text: "Don't watch the clock; do what it does — keep going.", author: "Sam Levenson" },
  { text: "Small daily improvements are the key to staggering long-term results." },
  { text: "The expert in anything was once a beginner.", author: "Helen Hayes" },
  { text: "A goal without a plan is just a wish.", author: "Antoine de Saint-Exupéry" },
  { text: "Today's effort is tomorrow's reputation." },
  { text: "Every partnership starts with a single hello." },
  { text: "Consistency compounds." },
  { text: "Your attitude determines your direction." },
  { text: "Stay patient and trust the process." },
  { text: "The harder the work, the sweeter the win." },
  { text: "Be the reason a partner says 'yes' today." },
  { text: "Make the call. Build the bond. Change a life." },
  { text: "Do the work others won't, to live like others can't." },
];

function phraseForToday() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  return PHRASES[dayOfYear % PHRASES.length];
}

export function PhraseOfTheDay() {
  const p = phraseForToday();
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl border border-primary/20 bg-card px-5 py-4 sm:px-6 sm:py-5"
    >
      <div
        className="absolute -left-8 -top-8 w-32 h-32 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(106,155,216,0.16), transparent 70%)" }}
      />
      <div className="relative flex items-start gap-3.5">
        <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Quote className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-primary/70 mb-1">Phrase of the day</p>
          <p className="text-sm sm:text-base font-medium text-foreground leading-relaxed" style={{ fontFamily: "'Playfair Display', serif" }}>
            &ldquo;{p.text}&rdquo;
          </p>
          {p.author && <p className="text-xs text-muted-foreground mt-1.5">— {p.author}</p>}
        </div>
      </div>
    </motion.div>
  );
}
