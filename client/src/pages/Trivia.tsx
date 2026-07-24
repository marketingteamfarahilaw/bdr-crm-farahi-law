/**
 * Team Trivia — live multiplayer quiz for team hangouts, at /trivia.
 *
 * Everyone signs into the CRM on their own device. One person hosts (they see
 * everyone's answers, so they don't play); everyone else joins and submits
 * answers. The server logs each submission's arrival order, the host marks
 * which are correct, and points are awarded automatically to the 1st/2nd/3rd
 * correct answers. Rendered full-screen outside the dashboard shell.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Scale, Trophy, Users, Timer, Lock, Check, X, ArrowLeft, Crown,
  ChevronRight, Sparkles, Eye, RotateCcw, Loader2, PartyPopper,
} from "lucide-react";

const QUESTION_SECONDS = 60; // soft on-screen countdown; the host closes manually

type GameState = inferRouterOutputs<AppRouter>["trivia"]["state"];

// ─── tiny building blocks ────────────────────────────────────────────────────

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-background text-foreground dashboard-mesh">
      <div className={cn("mx-auto px-4 pb-16 pt-6", wide ? "max-w-5xl" : "max-w-2xl")}>
        <header className="mb-6 flex items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10">
              <Scale className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <div className="font-serif text-lg font-semibold uppercase tracking-[0.18em]">
                Burden <span className="text-amber-500">of</span> Proof
              </div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Personal Injury Team Trivia
              </div>
            </div>
          </div>
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
            <span className="inline-flex items-center gap-1"><ArrowLeft className="h-3.5 w-3.5" /> CRM</span>
          </Link>
        </header>
        {children}
      </div>
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-border/60 bg-card/70 p-5", className)}>{children}</div>;
}

function PointChips({ pts }: { pts: [number, number, number] }) {
  const labels = ["1st", "2nd", "3rd"];
  return (
    <div className="flex flex-wrap gap-2">
      {pts.map((p, i) =>
        p > 0 ? (
          <span key={i} className="rounded-full border border-border/70 px-3 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {labels[i]} <b className="font-semibold text-amber-500">+{p}</b>
          </span>
        ) : null
      )}
    </div>
  );
}

function RankBadge({ rank, points }: { rank: number; points: number }) {
  const styles = [
    "bg-amber-400 text-amber-950",
    "bg-slate-300 text-slate-900",
    "bg-orange-300 text-orange-950",
  ];
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", styles[rank] ?? "bg-muted text-muted-foreground")}>
      {["1st", "2nd", "3rd"][rank] ?? `${rank + 1}th`} +{points}
    </span>
  );
}

function Countdown({ openedAt }: { openedAt: Date | string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(h);
  }, []);
  if (!openedAt) return null;
  const elapsed = (Date.now() - new Date(openedAt).getTime()) / 1000;
  const left = Math.max(0, Math.ceil(QUESTION_SECONDS - elapsed));
  return (
    <div className={cn("flex items-center gap-1.5 font-mono text-lg tabular-nums", left <= 10 && left > 0 && "text-red-500", left === 0 && "text-muted-foreground")}>
      <Timer className="h-4 w-4" />
      {left > 0 ? `${left}s` : "time!"}
    </div>
  );
}

function Leaderboard({ players, meUserId }: { players: GameState["players"]; meUserId?: number }) {
  if (!players.length) return <p className="text-sm italic text-muted-foreground">No players yet.</p>;
  const top = players[0]?.score ?? 0;
  return (
    <div className="space-y-1.5">
      {players.map((p, i) => (
        <div
          key={p.userId}
          className={cn(
            "flex items-center gap-3 rounded-lg border border-transparent bg-muted/40 px-3 py-2 text-sm",
            p.score === top && top > 0 && "border-amber-500/40 bg-amber-500/10"
          )}
        >
          <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
          <span className="flex-1 truncate">
            {p.name}
            {p.userId === meUserId && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
          </span>
          {p.score === top && top > 0 && <Crown className="h-3.5 w-3.5 text-amber-500" />}
          <span className="font-serif text-base font-semibold tabular-nums text-amber-500">{p.score}</span>
        </div>
      ))}
    </div>
  );
}

/** Host's judging list: answers in arrival order, tap to toggle correct. */
function AnswerJudgeList({ state, locked, onToggle }: { state: GameState; locked: boolean; onToggle?: (id: number) => void }) {
  const answers = state.answers ?? [];
  const pts = state.question?.pts ?? [0, 0, 0];
  const correctIds = answers.filter((a) => a.isCorrect).map((a) => a.id);
  if (!answers.length) return <p className="text-sm italic text-muted-foreground">No answers were submitted.</p>;
  return (
    <div className="space-y-2">
      {answers.map((a, i) => {
        const rank = correctIds.indexOf(a.id);
        return (
          <button
            key={a.id}
            disabled={locked}
            onClick={() => onToggle?.(a.id)}
            className={cn(
              "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
              a.isCorrect ? "border-emerald-500/50 bg-emerald-500/10" : "border-border/60 bg-muted/30",
              !locked && "hover:border-amber-500/60"
            )}
          >
            <span className="mt-0.5 w-5 shrink-0 text-xs tabular-nums text-muted-foreground">#{i + 1}</span>
            <span
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                a.isCorrect ? "border-emerald-500 bg-emerald-500 text-emerald-50" : "border-muted-foreground/40"
              )}
            >
              {a.isCorrect && <Check className="h-3 w-3" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="mr-2 font-medium">{a.name}</span>
              <span className="break-words text-muted-foreground">{a.text}</span>
            </span>
            {rank >= 0 && rank < 3 && (pts[rank] ?? 0) > 0 && <RankBadge rank={rank} points={pts[rank]} />}
          </button>
        );
      })}
    </div>
  );
}

function RevealCard({ reveal }: { reveal: NonNullable<GameState["reveal"]> }) {
  return (
    <div className="rounded-xl bg-amber-50 p-5 text-amber-950 shadow-lg dark:bg-[#efe6d0] dark:text-[#2a2318]">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-800/70">The record reflects</div>
      <div className="font-serif text-xl font-semibold leading-snug">{reveal.answer}</div>
      <p className="mt-2 text-[13px] leading-relaxed text-amber-900/80">
        <i>Counsel's note</i> — {reveal.note}
      </p>
    </div>
  );
}

function Podium({ players }: { players: GameState["players"] }) {
  const [first, second, third] = players;
  const Step = ({ p, place, h }: { p?: GameState["players"][number]; place: string; h: string }) =>
    p ? (
      <div
        className={cn(
          "flex w-28 flex-col items-center justify-start rounded-t-xl border border-b-0 border-border/60 bg-muted/40 px-2 pt-3 sm:w-36",
          place === "1st" && "border-amber-500/50 bg-amber-500/10",
          h
        )}
      >
        <div className={cn("text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground", place === "1st" && "text-amber-500")}>{place}</div>
        <div className="mt-1 w-full truncate text-center font-serif text-sm font-semibold sm:text-base">{p.name}</div>
        <div className="text-sm tabular-nums text-amber-500">{p.score} pts</div>
      </div>
    ) : (
      <div className="w-28 sm:w-36" />
    );
  return (
    <div className="flex items-end justify-center gap-3">
      <Step p={second} place="2nd" h="h-28" />
      <Step p={first} place="1st" h="h-36" />
      <Step p={third} place="3rd" h="h-24" />
    </div>
  );
}

// ─── screens ─────────────────────────────────────────────────────────────────

function HostBoard({ state, gameId }: { state: GameState; gameId: number }) {
  const utils = trpc.useUtils();
  const open = trpc.trivia.openQuestion.useMutation({
    onSuccess: () => utils.trivia.state.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const finish = trpc.trivia.finishGame.useMutation({ onSuccess: () => utils.trivia.state.invalidate() });

  const done = state.game.done;
  const regular = state.categories.filter((c) => !c.tiebreaker);
  const tiebreaker = state.categories.find((c) => c.tiebreaker);
  const regularTotal = regular.reduce((n, c) => n + c.count, 0);
  const regularDone = done.filter((k) => Number(k.split(":")[0]) < regular.length).length;
  const allDone = regularDone >= regularTotal;
  const topTwo = state.players.slice(0, 2);
  const tied = topTwo.length === 2 && topTwo[0].score === topTwo[1].score && topTwo[0].score > 0;

  return (
    <div className="space-y-5">
      <Panel className="flex flex-wrap items-center justify-between gap-3 border-amber-500/30">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Players join at</div>
          <div className="font-mono text-lg">
            {window.location.host}<span className="text-amber-500">/trivia</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" /> {state.players.length} joined · game code{" "}
          <span className="font-mono font-semibold text-amber-500">{state.game.code}</span>
        </div>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-3">
        {regular.map((cat, ci) => (
          <Panel key={cat.key} className="p-4">
            <div className="mb-1 font-serif text-lg font-semibold">{cat.name}</div>
            <div className="mb-3 text-[11px] tabular-nums text-muted-foreground">
              1st {cat.pts[0]} · 2nd {cat.pts[1]} · 3rd {cat.pts[2]} pts
            </div>
            <div className="space-y-2">
              {Array.from({ length: cat.count }, (_, qi) => {
                const played = done.includes(`${ci}:${qi}`);
                return (
                  <button
                    key={qi}
                    disabled={played || open.isPending}
                    onClick={() => open.mutate({ gameId, catIdx: ci, qIdx: qi })}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-sm transition-colors",
                      played ? "opacity-40" : "hover:border-amber-500/60"
                    )}
                  >
                    <span className="font-serif">Q{qi + 1}</span>
                    {played ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-500"><Check className="h-3.5 w-3.5" /> played</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">up to {cat.pts[0]} pts</span>
                    )}
                  </button>
                );
              })}
            </div>
          </Panel>
        ))}
      </div>

      {tiebreaker && allDone && (
        <Panel className={cn("p-4", tied && "border-amber-500/50")}>
          <div className="mb-1 flex items-center gap-2 font-serif text-lg font-semibold">
            <Sparkles className="h-4 w-4 text-amber-500" /> {tiebreaker.name}
          </div>
          <div className="mb-3 text-xs text-muted-foreground">
            {tied
              ? `${topTwo[0].name} and ${topTwo[1].name} are tied — settle it! First correct answer takes +${tiebreaker.pts[0]}.`
              : `Only needed if the top scores are tied. Winner takes +${tiebreaker.pts[0]}.`}
          </div>
          <div className="flex gap-2">
            {Array.from({ length: tiebreaker.count }, (_, qi) => {
              const ci = regular.length;
              const played = done.includes(`${ci}:${qi}`);
              return (
                <Button key={qi} variant="outline" size="sm" disabled={played || open.isPending} onClick={() => open.mutate({ gameId, catIdx: ci, qIdx: qi })}>
                  {played ? "Played" : `Sudden death ${qi + 1}`}
                </Button>
              );
            })}
          </div>
        </Panel>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {regularDone} of {regularTotal} questions played
        </p>
        {allDone ? (
          <Button onClick={() => finish.mutate({ gameId })} disabled={finish.isPending} className="bg-amber-500 text-amber-950 hover:bg-amber-400">
            <Trophy className="mr-1.5 h-4 w-4" /> Read the verdict
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => { if (confirm("End the game now and show the podium?")) finish.mutate({ gameId }); }}
          >
            End game early
          </Button>
        )}
      </div>
    </div>
  );
}

function HostQuestion({ state, gameId }: { state: GameState; gameId: number }) {
  const utils = trpc.useUtils();
  const invalidate = () => utils.trivia.state.invalidate();
  const close = trpc.trivia.closeQuestion.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const reopen = trpc.trivia.reopenQuestion.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const toggle = trpc.trivia.toggleCorrect.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const revealQ = trpc.trivia.revealQuestion.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const back = trpc.trivia.backToBoard.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });

  const q = state.question!;
  const status = state.game.status;

  return (
    <div className="space-y-5">
      <Panel>
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              {q.catName} · Question {q.qIdx + 1}
            </div>
            <PointChips pts={q.pts} />
          </div>
          {status === "question_open" && <Countdown openedAt={state.game.questionOpenedAt} />}
        </div>
        <p className="font-serif text-xl leading-relaxed sm:text-2xl">{q.text}</p>
      </Panel>

      {status === "question_open" && (
        <>
          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Answers in — <b className="text-foreground">{state.answersCount}</b> of {state.players.length} players
              </div>
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
            <AnswerJudgeList state={state} locked />
          </Panel>
          <div className="flex justify-end">
            <Button onClick={() => close.mutate({ gameId })} disabled={close.isPending} className="bg-amber-500 text-amber-950 hover:bg-amber-400">
              <Lock className="mr-1.5 h-4 w-4" /> Close question
            </Button>
          </div>
        </>
      )}

      {status === "question_closed" && (
        <>
          <Panel>
            <div className="mb-3 text-sm text-muted-foreground">
              Tap every <b className="text-foreground">correct</b> answer — points follow submission order automatically.
            </div>
            <AnswerJudgeList state={state} locked={false} onToggle={(id) => toggle.mutate({ gameId, answerId: id })} />
          </Panel>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => reopen.mutate({ gameId })} disabled={reopen.isPending}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reopen
            </Button>
            <Button onClick={() => revealQ.mutate({ gameId })} disabled={revealQ.isPending} className="bg-amber-500 text-amber-950 hover:bg-amber-400">
              <Eye className="mr-1.5 h-4 w-4" /> Reveal & award points
            </Button>
          </div>
        </>
      )}

      {status === "question_revealed" && (
        <>
          <RevealCard reveal={state.reveal!} />
          <Panel>
            <div className="mb-3 text-sm text-muted-foreground">Misjudged one? Tap an answer to fix it — points recalculate.</div>
            <AnswerJudgeList state={state} locked={false} onToggle={(id) => toggle.mutate({ gameId, answerId: id })} />
          </Panel>
          <div className="flex justify-end">
            <Button onClick={() => back.mutate({ gameId })} disabled={back.isPending} className="bg-amber-500 text-amber-950 hover:bg-amber-400">
              Back to the board <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function PlayerQuestion({ state, gameId, meUserId }: { state: GameState; gameId: number; meUserId: number }) {
  const utils = trpc.useUtils();
  const [text, setText] = useState("");
  const submit = trpc.trivia.submit.useMutation({
    onSuccess: () => { setText(""); utils.trivia.state.invalidate(); },
    onError: (e) => { toast.error(e.message); utils.trivia.state.invalidate(); },
  });
  const q = state.question!;
  const status = state.game.status;
  const mine = state.myAnswer;

  return (
    <div className="space-y-5">
      <Panel>
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              {q.catName} · Question {q.qIdx + 1}
            </div>
            <PointChips pts={q.pts} />
          </div>
          {status === "question_open" && <Countdown openedAt={state.game.questionOpenedAt} />}
        </div>
        <p className="font-serif text-xl leading-relaxed sm:text-2xl">{q.text}</p>
      </Panel>

      {status === "question_open" && !mine && (
        <Panel className="border-amber-500/40">
          <Textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && text.trim()) { e.preventDefault(); submit.mutate({ gameId, text: text.trim() }); }
            }}
            placeholder="Type your answer — speed counts!"
            className="mb-3 min-h-20 text-base"
            maxLength={500}
          />
          <Button
            className="w-full bg-amber-500 text-base font-semibold text-amber-950 hover:bg-amber-400"
            size="lg"
            disabled={!text.trim() || submit.isPending}
            onClick={() => submit.mutate({ gameId, text: text.trim() })}
          >
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lock in answer"}
          </Button>
        </Panel>
      )}

      {status === "question_open" && mine && (
        <Panel className="border-emerald-500/40 text-center">
          <Lock className="mx-auto mb-2 h-5 w-5 text-emerald-500" />
          <div className="font-medium">Answer locked in!</div>
          <p className="mt-1 text-sm text-muted-foreground">"{mine.text}"</p>
          <p className="mt-2 text-xs text-muted-foreground">{state.answersCount} of {state.players.length} players have answered…</p>
        </Panel>
      )}

      {status === "question_closed" && (
        <Panel className="text-center">
          <div className="font-serif text-lg">Pencils down!</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {mine ? `Your answer: "${mine.text}"` : "You didn't answer this one."} The host is reviewing…
          </p>
        </Panel>
      )}

      {status === "question_revealed" && (
        <>
          <RevealCard reveal={state.reveal!} />
          <Panel>
            <div className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Points this question</div>
            {(() => {
              const winners = (state.answers ?? []).filter((a) => a.points > 0);
              const myRow = (state.answers ?? []).find((a) => a.userId === meUserId);
              return (
                <div className="space-y-2">
                  {winners.length ? (
                    winners.map((a, i) => (
                      <div key={a.id} className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                        <RankBadge rank={i} points={a.points} />
                        <span className="flex-1 truncate">{a.name}{a.userId === meUserId ? " (you)" : ""}</span>
                        <span className="truncate text-xs text-muted-foreground">"{a.text}"</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm italic text-muted-foreground">Nobody scored on this one.</p>
                  )}
                  {myRow && myRow.points === 0 && (
                    <p className="pt-1 text-xs text-muted-foreground">
                      {myRow.isCorrect ? "Correct, but the podium spots were taken — speed counts!" : "No points this round — next one's yours."}
                    </p>
                  )}
                </div>
              );
            })()}
          </Panel>
        </>
      )}
    </div>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function TriviaPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const current = trpc.trivia.current.useQuery(undefined, { refetchInterval: 5000 });
  const gameId = current.data?.id;

  const state = trpc.trivia.state.useQuery(
    { gameId: gameId! },
    { enabled: !!gameId, refetchInterval: 2000 }
  );

  const create = trpc.trivia.create.useMutation({
    onSuccess: () => { utils.trivia.current.invalidate(); utils.trivia.state.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const join = trpc.trivia.join.useMutation({
    onSuccess: () => utils.trivia.state.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  // Celebrate once when the podium appears.
  const celebratedRef = useRef(false);
  useEffect(() => {
    if (state.data?.game.status === "finished" && !celebratedRef.current) {
      celebratedRef.current = true;
      const winner = state.data.players[0];
      if (winner) toast(`🏆 ${winner.name} carries the day with ${winner.score} points!`, { duration: 8000 });
    }
  }, [state.data?.game.status, state.data?.players]);

  const s = state.data;
  const meUserId = user?.id as number | undefined;

  // ── no game yet ──
  if (current.isLoading || (gameId && state.isLoading)) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      </Shell>
    );
  }

  if (!gameId || !s) {
    return (
      <Shell>
        <Panel className="text-center">
          <Trophy className="mx-auto mb-3 h-8 w-8 text-amber-500" />
          <h2 className="font-serif text-2xl font-semibold">No game running</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Host a live PI trivia game for the team. You'll run the questions and judge answers on your screen —
            everyone else joins from their own device at <span className="font-mono text-foreground">/trivia</span> and races to answer.
          </p>
          <Button
            size="lg"
            className="mt-5 bg-amber-500 font-semibold text-amber-950 hover:bg-amber-400"
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Host a new game"}
          </Button>
          <div className="mx-auto mt-6 max-w-md rounded-lg border border-border/60 bg-muted/30 p-4 text-left text-xs text-muted-foreground">
            <b className="text-foreground">How scoring works:</b> Easy questions pay 3/2/1 points to the first three correct answers,
            Intermediate pays 7/4/2, Advanced pays 10/7/4 — by submission speed, logged server-side. Tied at the end?
            Sudden death settles it.
          </div>
        </Panel>
      </Shell>
    );
  }

  // ── finished: podium for everyone ──
  if (s.game.status === "finished") {
    return (
      <Shell>
        <div className="space-y-6 text-center">
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">The jury has spoken</div>
            <h2 className="mt-1 font-serif text-3xl font-semibold uppercase tracking-widest">Verdict Rendered</h2>
            {s.players[0] && (
              <p className="mt-2 text-sm text-muted-foreground">
                <PartyPopper className="mr-1 inline h-4 w-4 text-amber-500" />
                <b className="text-amber-500">{s.players[0].name}</b> carries the day with {s.players[0].score} points.
              </p>
            )}
          </div>
          <Podium players={s.players} />
          <Panel className="text-left">
            <div className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Final standings</div>
            <Leaderboard players={s.players} meUserId={meUserId} />
          </Panel>
          {s.isHost && (
            <Button variant="outline" disabled={create.isPending} onClick={() => { if (confirm("Start a fresh game?")) create.mutate(); }}>
              Start a new game
            </Button>
          )}
        </div>
      </Shell>
    );
  }

  // ── host ──
  if (s.isHost) {
    return (
      <Shell wide>
        <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
          <div>
            {s.question ? <HostQuestion state={s} gameId={gameId} /> : <HostBoard state={s} gameId={gameId} />}
          </div>
          <Panel className="h-fit lg:sticky lg:top-6">
            <div className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Standings</div>
            <Leaderboard players={s.players} meUserId={meUserId} />
          </Panel>
        </div>
      </Shell>
    );
  }

  // ── player: not joined yet ──
  if (!s.joined) {
    return (
      <Shell>
        <Panel className="text-center">
          <Users className="mx-auto mb-3 h-7 w-7 text-amber-500" />
          <h2 className="font-serif text-2xl font-semibold">{s.game.hostName || "Your host"} is hosting trivia!</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {s.players.length ? `${s.players.length} player${s.players.length > 1 ? "s" : ""} in so far.` : "Be the first to join."}
            {" "}Game code <span className="font-mono font-semibold text-amber-500">{s.game.code}</span>
          </p>
          <Button
            size="lg"
            className="mt-5 bg-amber-500 font-semibold text-amber-950 hover:bg-amber-400"
            disabled={join.isPending}
            onClick={() => join.mutate({ gameId })}
          >
            {join.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Join as ${user?.name || "player"}`}
          </Button>
        </Panel>
      </Shell>
    );
  }

  // ── player: in the game ──
  return (
    <Shell>
      {s.question && meUserId != null ? (
        <PlayerQuestion state={s} gameId={gameId} meUserId={meUserId} />
      ) : (
        <div className="space-y-5">
          <Panel className="text-center">
            <Check className="mx-auto mb-2 h-5 w-5 text-emerald-500" />
            <div className="font-medium">You're in!</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Waiting for {s.game.hostName || "the host"} to open the next question — keep this screen open.
            </p>
          </Panel>
          <Panel>
            <div className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Standings</div>
            <Leaderboard players={s.players} meUserId={meUserId} />
          </Panel>
        </div>
      )}
    </Shell>
  );
}
