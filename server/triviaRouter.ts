/**
 * Team Trivia — live multiplayer quiz for team hangouts.
 *
 * Flow: any signed-in user creates a game and becomes its host (quizmaster —
 * hosts don't play, they see everyone's answers). Teammates open /trivia on
 * their own device and join. The host opens a question; players type and
 * submit; every submission is logged with its arrival order. The host closes
 * the question, marks which answers are correct, and reveals — points go to
 * the 1st/2nd/3rd correct answers automatically by submission order.
 *
 * Clients poll trivia.state (~2s). Answer text/correct-answer are only sent
 * to the host (while judging) or to everyone after reveal — never before.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { triviaAnswers, triviaGames, triviaPlayers, type TriviaGame } from "../drizzle/schema";
import { TRIVIA_CATEGORIES, categoryMeta } from "./triviaQuestions";

const gameCode = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 4);

// Live emoji reactions — ephemeral hype, so in-memory only (single-process
// server). Clients poll state every ~2s and animate whatever is <10s old.
type Reaction = { id: number; name: string; emoji: string; at: number };
const reactionBuf = new Map<number, Reaction[]>();
let reactionSeq = 1;
const REACTION_TTL_MS = 10_000;

function pushReaction(gameId: number, name: string, emoji: string) {
  const now = Date.now();
  const list = (reactionBuf.get(gameId) || []).filter((r) => now - r.at < REACTION_TTL_MS);
  list.push({ id: reactionSeq++, name, emoji, at: now });
  reactionBuf.set(gameId, list.slice(-60));
}

function recentReactions(gameId: number): Reaction[] {
  const now = Date.now();
  return (reactionBuf.get(gameId) || []).filter((r) => now - r.at < REACTION_TTL_MS);
}

async function db() {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return d;
}

async function getGame(id: number): Promise<TriviaGame> {
  const d = await db();
  const [game] = await d.select().from(triviaGames).where(eq(triviaGames.id, id)).limit(1);
  if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
  return game;
}

function requireHost(game: TriviaGame, userId: number) {
  if (game.hostUserId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the host can do that." });
  }
}

function currentQuestion(game: TriviaGame) {
  if (game.currentCat == null || game.currentQ == null) return null;
  const cat = TRIVIA_CATEGORIES[game.currentCat];
  const q = cat?.qs[game.currentQ];
  return q ? { cat, q } : null;
}

const doneKeys = (game: TriviaGame): string[] => {
  try {
    const v = JSON.parse(game.doneJson || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** Re-derive pointsAwarded for the live question from isCorrect + arrival order. */
async function recomputeAwards(game: TriviaGame) {
  const cur = currentQuestion(game);
  if (!cur) return;
  const d = await db();
  const rows = await d
    .select()
    .from(triviaAnswers)
    .where(and(eq(triviaAnswers.gameId, game.id), eq(triviaAnswers.catIdx, game.currentCat!), eq(triviaAnswers.qIdx, game.currentQ!)))
    .orderBy(asc(triviaAnswers.id)); // insertion order = submission order
  const correct = rows.filter((r) => r.isCorrect === 1);
  for (const row of rows) {
    const rank = correct.findIndex((c) => c.id === row.id);
    const pts = rank >= 0 && rank < 3 ? cur.cat.pts[rank] : 0;
    if (row.pointsAwarded !== pts) {
      await d.update(triviaAnswers).set({ pointsAwarded: pts }).where(eq(triviaAnswers.id, row.id));
    }
  }
}

export const triviaRouter = router({
  /** Categories/points for the rules screen (no answers, safe for everyone). */
  categories: protectedProcedure.query(() => categoryMeta()),

  /** The game to show on /trivia: the newest one that is live, or finished recently (podium). */
  current: protectedProcedure.query(async () => {
    const d = await db();
    const [game] = await d.select().from(triviaGames).orderBy(desc(triviaGames.id)).limit(1);
    if (!game) return null;
    if (game.status === "finished") {
      const ageMs = Date.now() - new Date(game.updatedAt).getTime();
      if (ageMs > 3 * 60 * 60 * 1000) return null; // podium stays up for 3h, then /trivia resets
    }
    return { id: game.id };
  }),

  create: protectedProcedure.mutation(async ({ ctx }) => {
    const d = await db();
    // Close out any stale unfinished games so /trivia always points at the new one.
    await d
      .update(triviaGames)
      .set({ status: "finished" })
      .where(inArray(triviaGames.status, ["lobby", "question_open", "question_closed", "question_revealed"]));
    const result: any = await d.insert(triviaGames).values({
      code: gameCode(),
      hostUserId: ctx.user.id,
      hostName: ctx.user.name || ctx.user.email || "Host",
    });
    const id = result?.[0]?.insertId ?? result?.insertId;
    return { id: Number(id) };
  }),

  join: protectedProcedure.input(z.object({ gameId: z.number() })).mutation(async ({ ctx, input }) => {
    const game = await getGame(input.gameId);
    if (game.status === "finished") throw new TRPCError({ code: "BAD_REQUEST", message: "This game is over." });
    if (game.hostUserId === ctx.user.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The host runs the show — you see everyone's answers, so you can't play too." });
    }
    const d = await db();
    const existing = await d
      .select({ id: triviaPlayers.id })
      .from(triviaPlayers)
      .where(and(eq(triviaPlayers.gameId, game.id), eq(triviaPlayers.userId, ctx.user.id)))
      .limit(1);
    if (!existing.length) {
      await d.insert(triviaPlayers).values({
        gameId: game.id,
        userId: ctx.user.id,
        displayName: ctx.user.name || ctx.user.agentName || ctx.user.email || `Player ${ctx.user.id}`,
      });
    }
    return { ok: true };
  }),

  /** The single polling endpoint — everything a client needs to render its view. */
  state: protectedProcedure.input(z.object({ gameId: z.number() })).query(async ({ ctx, input }) => {
    const game = await getGame(input.gameId);
    const d = await db();
    const isHost = game.hostUserId === ctx.user.id;

    const playerRows = await d.select().from(triviaPlayers).where(eq(triviaPlayers.gameId, game.id)).orderBy(asc(triviaPlayers.id));
    const allAnswers = await d.select().from(triviaAnswers).where(eq(triviaAnswers.gameId, game.id)).orderBy(asc(triviaAnswers.id));

    const scoreByUser = new Map<number, number>();
    for (const a of allAnswers) scoreByUser.set(a.userId, (scoreByUser.get(a.userId) || 0) + a.pointsAwarded);

    // Hot streak = consecutive most-recent played questions where the player
    // scored points. Order of play = done keys (+ the live question once revealed).
    const playOrder = [...doneKeys(game)];
    if (game.status === "question_revealed" && game.currentCat != null && game.currentQ != null) {
      const k = `${game.currentCat}:${game.currentQ}`;
      if (!playOrder.includes(k)) playOrder.push(k);
    }
    const scoredOn = (userId: number, key: string) =>
      allAnswers.some((a) => a.userId === userId && `${a.catIdx}:${a.qIdx}` === key && a.pointsAwarded > 0);
    const streakOf = (userId: number) => {
      let n = 0;
      for (let i = playOrder.length - 1; i >= 0; i--) {
        if (scoredOn(userId, playOrder[i])) n++;
        else break;
      }
      return n;
    };

    const players = playerRows
      .map((p) => ({ userId: p.userId, name: p.displayName, score: scoreByUser.get(p.userId) || 0, streak: streakOf(p.userId) }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    const cur = currentQuestion(game);
    const inQuestion = ["question_open", "question_closed", "question_revealed"].includes(game.status);
    const qAnswers =
      cur && inQuestion
        ? allAnswers.filter((a) => a.catIdx === game.currentCat && a.qIdx === game.currentQ)
        : [];
    const mine = qAnswers.find((a) => a.userId === ctx.user.id);

    return {
      game: {
        id: game.id,
        code: game.code,
        status: game.status,
        hostName: game.hostName,
        currentCat: game.currentCat,
        currentQ: game.currentQ,
        done: doneKeys(game),
        questionOpenedAt: game.questionOpenedAt,
      },
      isHost,
      joined: isHost || playerRows.some((p) => p.userId === ctx.user.id),
      players,
      categories: categoryMeta(),
      question:
        cur && inQuestion
          ? {
              catIdx: game.currentCat!,
              qIdx: game.currentQ!,
              catName: cur.cat.name,
              pts: cur.cat.pts,
              tiebreaker: !!cur.cat.tiebreaker,
              text: cur.q.q,
            }
          : null,
      answersCount: qAnswers.length,
      // Names only (never text) — lets players watch teammates lock in live.
      answeredNames: game.status === "question_open" ? qAnswers.map((a) => a.displayName) : [],
      reactions: recentReactions(game.id),
      myAnswer: mine ? { text: mine.answerText, submittedAt: mine.submittedAt } : null,
      // Answer texts: host sees them live while judging; players only after reveal.
      answers:
        (isHost || game.status === "question_revealed") && inQuestion
          ? qAnswers.map((a) => ({
              id: a.id,
              userId: a.userId,
              name: a.displayName,
              text: a.answerText,
              isCorrect: a.isCorrect === 1,
              points: a.pointsAwarded,
              submittedAt: a.submittedAt,
            }))
          : undefined,
      reveal: game.status === "question_revealed" && cur ? { answer: cur.q.a, note: cur.q.note } : undefined,
    };
  }),

  submit: protectedProcedure
    .input(z.object({ gameId: z.number(), text: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const game = await getGame(input.gameId);
      if (game.status !== "question_open") throw new TRPCError({ code: "BAD_REQUEST", message: "This question is closed." });
      const d = await db();
      const [player] = await d
        .select()
        .from(triviaPlayers)
        .where(and(eq(triviaPlayers.gameId, game.id), eq(triviaPlayers.userId, ctx.user.id)))
        .limit(1);
      if (!player) throw new TRPCError({ code: "BAD_REQUEST", message: "Join the game first." });
      const existing = await d
        .select({ id: triviaAnswers.id })
        .from(triviaAnswers)
        .where(and(eq(triviaAnswers.gameId, game.id), eq(triviaAnswers.catIdx, game.currentCat!), eq(triviaAnswers.qIdx, game.currentQ!), eq(triviaAnswers.userId, ctx.user.id)))
        .limit(1);
      if (existing.length) throw new TRPCError({ code: "BAD_REQUEST", message: "You already answered — it's locked in!" });
      await d.insert(triviaAnswers).values({
        gameId: game.id,
        catIdx: game.currentCat!,
        qIdx: game.currentQ!,
        userId: ctx.user.id,
        displayName: player.displayName,
        answerText: input.text,
      });
      return { ok: true };
    }),

  /** Tap an emoji — it floats up on everyone's screen. Pure fun, no points. */
  react: protectedProcedure
    .input(z.object({ gameId: z.number(), emoji: z.string().trim().min(1).max(8) }))
    .mutation(async ({ ctx, input }) => {
      const game = await getGame(input.gameId);
      if (game.status === "finished") return { ok: true };
      const name = ctx.user.name || ctx.user.email || "Someone";
      pushReaction(game.id, name, input.emoji);
      return { ok: true };
    }),

  // ── Host controls ──────────────────────────────────────────────────────────

  openQuestion: protectedProcedure
    .input(z.object({ gameId: z.number(), catIdx: z.number().int().min(0), qIdx: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      const game = await getGame(input.gameId);
      requireHost(game, ctx.user.id);
      const cat = TRIVIA_CATEGORIES[input.catIdx];
      if (!cat || !cat.qs[input.qIdx]) throw new TRPCError({ code: "BAD_REQUEST", message: "No such question." });
      if (doneKeys(game).includes(`${input.catIdx}:${input.qIdx}`)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That question was already played." });
      }
      const d = await db();
      await d
        .update(triviaGames)
        .set({ status: "question_open", currentCat: input.catIdx, currentQ: input.qIdx, questionOpenedAt: new Date() })
        .where(eq(triviaGames.id, game.id));
      return { ok: true };
    }),

  closeQuestion: protectedProcedure.input(z.object({ gameId: z.number() })).mutation(async ({ ctx, input }) => {
    const game = await getGame(input.gameId);
    requireHost(game, ctx.user.id);
    if (game.status !== "question_open") throw new TRPCError({ code: "BAD_REQUEST", message: "No open question." });
    const d = await db();
    await d.update(triviaGames).set({ status: "question_closed" }).where(eq(triviaGames.id, game.id));
    return { ok: true };
  }),

  /** Closed too early? Let players keep answering. */
  reopenQuestion: protectedProcedure.input(z.object({ gameId: z.number() })).mutation(async ({ ctx, input }) => {
    const game = await getGame(input.gameId);
    requireHost(game, ctx.user.id);
    if (game.status !== "question_closed") throw new TRPCError({ code: "BAD_REQUEST", message: "Question is not closed." });
    const d = await db();
    await d.update(triviaGames).set({ status: "question_open" }).where(eq(triviaGames.id, game.id));
    return { ok: true };
  }),

  toggleCorrect: protectedProcedure
    .input(z.object({ gameId: z.number(), answerId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const game = await getGame(input.gameId);
      requireHost(game, ctx.user.id);
      if (!["question_closed", "question_revealed"].includes(game.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Close the question before judging answers." });
      }
      const d = await db();
      const [row] = await d.select().from(triviaAnswers).where(eq(triviaAnswers.id, input.answerId)).limit(1);
      if (!row || row.gameId !== game.id) throw new TRPCError({ code: "NOT_FOUND", message: "Answer not found." });
      await d.update(triviaAnswers).set({ isCorrect: row.isCorrect === 1 ? 0 : 1 }).where(eq(triviaAnswers.id, row.id));
      // After reveal, correcting a judgment re-runs the awards so scores stay right.
      if (game.status === "question_revealed") await recomputeAwards(game);
      return { ok: true };
    }),

  revealQuestion: protectedProcedure.input(z.object({ gameId: z.number() })).mutation(async ({ ctx, input }) => {
    const game = await getGame(input.gameId);
    requireHost(game, ctx.user.id);
    if (!["question_closed", "question_revealed"].includes(game.status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Close the question first." });
    }
    await recomputeAwards(game);
    const d = await db();
    await d.update(triviaGames).set({ status: "question_revealed" }).where(eq(triviaGames.id, game.id));
    return { ok: true };
  }),

  backToBoard: protectedProcedure.input(z.object({ gameId: z.number() })).mutation(async ({ ctx, input }) => {
    const game = await getGame(input.gameId);
    requireHost(game, ctx.user.id);
    if (game.status !== "question_revealed") throw new TRPCError({ code: "BAD_REQUEST", message: "Reveal the answer first." });
    const done = doneKeys(game);
    const key = `${game.currentCat}:${game.currentQ}`;
    if (!done.includes(key)) done.push(key);
    const d = await db();
    await d
      .update(triviaGames)
      .set({ status: "lobby", currentCat: null, currentQ: null, questionOpenedAt: null, doneJson: JSON.stringify(done) })
      .where(eq(triviaGames.id, game.id));
    return { ok: true };
  }),

  finishGame: protectedProcedure.input(z.object({ gameId: z.number() })).mutation(async ({ ctx, input }) => {
    const game = await getGame(input.gameId);
    requireHost(game, ctx.user.id);
    const d = await db();
    await d.update(triviaGames).set({ status: "finished" }).where(eq(triviaGames.id, game.id));
    return { ok: true };
  }),
});
