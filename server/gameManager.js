import { v4 as uuidv4 } from "uuid";
import { getQuiz } from "./quizStore.js";

/** @typedef {{ id: string, name: string, score: number, socketId: string | null }} Player */
/** @typedef {{ pin: string, quizId: string, hostToken: string, phase: 'lobby'|'question'|'reveal'|'ended', questionIndex: number, startedAt: number | null, players: Map<string, Player>, answers: Map<string, any>, quizSnapshot: object, playerQuestionSanitized: object | null, oddColorIndex: number | null }} Game */

const games = new Map();

function randomPin() {
  let pin = "";
  for (let i = 0; i < 6; i++) pin += Math.floor(Math.random() * 10).toString();
  if (pin === "000000") return randomPin();
  return pin;
}

function uniquePin() {
  for (let i = 0; i < 100; i++) {
    const p = randomPin();
    if (![...games.values()].some((g) => g.pin === p)) return p;
  }
  return String(Date.now()).slice(-6);
}

/**
 * Time-based scoring: max points decrease linearly with time.
 * @param {number} timeLimitMs
 * @param {number} elapsedMs
 * @param {number} maxPoints
 */
export function computePoints(timeLimitMs, elapsedMs, maxPoints) {
  if (timeLimitMs <= 0) return maxPoints;
  const ratio = Math.min(1, Math.max(0, elapsedMs / timeLimitMs));
  return Math.round(maxPoints * (1 - ratio / 2));
}

export function createGame(quizId) {
  const quiz = getQuiz(quizId);
  if (!quiz) return null;
  const pin = uniquePin();
  const hostToken = uuidv4();
  const quizSnapshot = JSON.parse(JSON.stringify(quiz));
  /** @type {Game} */
  const game = {
    pin,
    quizId,
    hostToken,
    phase: "lobby",
    questionIndex: -1,
    startedAt: null,
    players: new Map(),
    answers: new Map(),
    quizSnapshot,
    playerQuestionSanitized: null,
    oddColorIndex: null,
  };
  games.set(pin, game);
  return { pin, hostToken, quizTitle: quiz.title };
}

/**
 * Keep the same lobby/players/pin but swap to a different quiz and reset scores.
 * @returns {{ ok: boolean, error?: string, quizTitle?: string }}
 */
export function restartGameWithQuiz(game, quizId) {
  const quiz = getQuiz(quizId);
  if (!quiz) return { ok: false, error: "Quiz not found" };
  game.quizId = quizId;
  game.quizSnapshot = JSON.parse(JSON.stringify(quiz));
  game.phase = "lobby";
  game.questionIndex = -1;
  game.startedAt = null;
  game.answers = new Map();
  game.playerQuestionSanitized = null;
  game.oddColorIndex = null;
  for (const p of game.players.values()) {
    p.score = 0;
  }
  return { ok: true, quizTitle: quiz.title };
}

export function getGameByPin(pin) {
  return games.get(pin) || null;
}

export function getGameByHostToken(hostToken) {
  for (const g of games.values()) {
    if (g.hostToken === hostToken) return g;
  }
  return null;
}

export function destroyGame(pin) {
  games.delete(pin);
}

/** @returns {{ pin: string, quizTitle: string, phase: string, playerCount: number, quizId: string }[]} */
export function listGamesSummary() {
  return [...games.values()].map((g) => ({
    pin: g.pin,
    quizTitle: g.quizSnapshot?.title ?? "Quiz",
    phase: g.phase,
    playerCount: g.players.size,
    quizId: g.quizId,
  }));
}

/** @param {any} q multiple_choice question */
function normMcEntry(raw) {
  if (raw == null) return { text: "", penalizeIfWrong: false, wrongPickPenaltyLegacy: 0 };
  if (typeof raw === "string") return { text: raw, penalizeIfWrong: false, wrongPickPenaltyLegacy: 0 };
  const o = typeof raw === "object" ? raw : {};
  const text = String(o.text ?? "");
  const wrongPickPenaltyLegacy = Math.max(0, Number(o.wrongPickPenalty ?? 0) || 0);
  const penalizeIfWrong = !!o.penalizeIfWrong || wrongPickPenaltyLegacy > 0;
  return { text, penalizeIfWrong, wrongPickPenaltyLegacy };
}

function mcOptsLen(q) {
  return (q.options || []).length;
}

function normalizeMusicOptions(q) {
  return Array.isArray(q.options) ? q.options.map((x) => String(x ?? "")) : [];
}

function getMcPenaltyTotal(q) {
  return Math.max(0, Number(q.mcPenaltyPoints ?? 0) || 0);
}

export function getMcCorrectIndices(q) {
  if (Array.isArray(q.correctIndices) && q.correctIndices.length > 0) {
    const optsLen = mcOptsLen(q);
    return [...new Set(q.correctIndices.map(Number))]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < optsLen)
      .sort((a, b) => a - b);
  }
  if (typeof q.correctIndex === "number" && Number.isInteger(q.correctIndex)) {
    const optsLen = mcOptsLen(q);
    if (q.correctIndex >= 0 && q.correctIndex < optsLen) return [q.correctIndex];
  }
  return [0];
}

function normalizeMcAnswer(answer) {
  if (Array.isArray(answer)) {
    return [...new Set(answer.map(Number))]
      .filter((i) => Number.isInteger(i))
      .sort((a, b) => a - b);
  }
  if (typeof answer === "number" && Number.isInteger(answer)) return [answer];
  return [];
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function shuffleArrayInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Normalize hex color for CSS (#RGB or #RRGGBB). */
function normalizeOddColorHex(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "#808080";
  const m = s.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return "#808080";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h.toLowerCase()}`;
}

function buildOddColorSanitized(q, oddIndex) {
  const base = {
    id: q.id,
    type: "odd_color_out",
    question: q.question,
    timeLimitSec: q.timeLimitSec ?? 20,
    points: q.points ?? 1000,
    anyAnswerCorrect: !!q.anyAnswerCorrect,
  };
  const baseColor = normalizeOddColorHex(q.baseColor);
  const oddColor = normalizeOddColorHex(q.oddColor);
  const swatches = [0, 1, 2, 3].map((i) => ({
    index: i,
    color: i === oddIndex ? oddColor : baseColor,
  }));
  return { ...base, swatches };
}

function sanitizeQuestionForPlayer(q) {
  const base = {
    id: q.id,
    type: q.type,
    question: q.question,
    timeLimitSec: q.timeLimitSec ?? 20,
    points: q.points ?? 1000,
    anyAnswerCorrect: !!q.anyAnswerCorrect,
  };
  if (q.type === "multiple_choice") {
    const correct = getMcCorrectIndices(q);
    const withIds = (q.options || []).map((raw, i) => {
      const { text } = normMcEntry(raw);
      return { id: i, text };
    });
    const shuffle = q.shuffleOptions !== false;
    if (shuffle && withIds.length > 1) {
      for (let i = withIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [withIds[i], withIds[j]] = [withIds[j], withIds[i]];
      }
    }
    const out = {
      ...base,
      options: withIds,
      multiSelect: correct.length > 1,
    };
    if (q.imageUrl) out.imageUrl = String(q.imageUrl);
    return out;
  }
  if (q.type === "slider") {
    return {
      ...base,
      min: q.min,
      max: q.max,
      step: q.step ?? 1,
    };
  }
  if (q.type === "music") {
    const options = normalizeMusicOptions(q);
    return {
      ...base,
      options,
      correctIndex: Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < options.length ? q.correctIndex : 0,
      coverImageUrl: q.coverImageUrl ? String(q.coverImageUrl) : undefined,
      trackNumber: Number.isFinite(Number(q.trackNumber)) ? Number(q.trackNumber) : undefined,
      artist: q.showArtist !== false ? String(q.artist ?? "").trim() || undefined : undefined,
      title: q.showTitle !== false ? String(q.title ?? "").trim() || undefined : undefined,
      showCoverArt: q.showCoverArt !== false,
    };
  }
  if (q.type === "click_location") {
    return {
      ...base,
      imageUrl: q.imageUrl,
    };
  }
  if (q.type === "order") {
    const shuffled = [...q.items].map((text, i) => ({ id: i, text }));
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return {
      ...base,
      items: shuffled,
    };
  }
  if (q.type === "match") {
    const rows = q.pairs || [];
    const left = rows.map((row, i) => ({
      id: i,
      text: String(row?.left?.text ?? ""),
      imageUrl: row?.left?.imageUrl ? String(row.left.imageUrl) : undefined,
    }));
    const right = rows.map((row, i) => ({
      id: i,
      text: String(row?.right?.text ?? ""),
      imageUrl: row?.right?.imageUrl ? String(row.right.imageUrl) : undefined,
    }));
    shuffleArrayInPlace(left);
    shuffleArrayInPlace(right);
    return {
      ...base,
      left,
      right,
    };
  }
  return base;
}

/**
 * Build and store the player-facing question once per question (shuffle etc. must not change on every broadcast).
 */
export function refreshPlayerQuestionCache(game) {
  const qs = game.quizSnapshot.questions || [];
  const idx = game.questionIndex;
  const q = idx >= 0 ? qs[idx] : undefined;
  game.oddColorIndex = null;
  if (!q) {
    game.playerQuestionSanitized = null;
    return;
  }
  if (q.type === "odd_color_out") {
    const oddIdx = Math.floor(Math.random() * 4);
    game.oddColorIndex = oddIdx;
    game.playerQuestionSanitized = buildOddColorSanitized(q, oddIdx);
    return;
  }
  game.playerQuestionSanitized = sanitizeQuestionForPlayer(q);
}

export function getPublicGameState(game, forHost) {
  const qs = game.quizSnapshot;
  const questions = qs.questions || [];
  const q = questions[game.questionIndex];
  const playerQuestion = game.phase === "lobby" ? null : game.playerQuestionSanitized;
  let outQuestion = playerQuestion;
  if (forHost && q && playerQuestion && q.type === "music" && playerQuestion.type === "music") {
    outQuestion = {
      ...playerQuestion,
      audioUrl: q.audioUrl ? String(q.audioUrl) : "",
    };
  }

  const players = [...game.players.values()].map((p) => {
    const row = { id: p.id, name: p.name, score: p.score };
    if (forHost && game.phase === "lobby") {
      row.connected = !!p.socketId;
    }
    if (forHost && game.phase === "question") {
      row.answered = game.answers.has(p.id);
    }
    return row;
  });

  const out = {
    pin: game.pin,
    phase: game.phase,
    questionIndex: game.questionIndex,
    totalQuestions: questions.length,
    quizTitle: qs.title,
    players,
    question: game.phase === "lobby" ? null : outQuestion,
    questionStartedAt: game.phase === "question" ? game.startedAt : null,
    serverTime: Date.now(),
  };

  if (forHost && q && (game.phase === "question" || game.phase === "reveal")) {
    out.reveal = getRevealPayload(q, game);
  }
  if (!forHost && q && game.phase === "reveal") {
    out.reveal = getRevealPayload(q, game);
  }

  return out;
}

function getRevealPayload(q, game) {
  const explanation = q.explanation ? String(q.explanation) : undefined;
  const anyAnswerCorrect = !!q.anyAnswerCorrect;
  if (q.type === "odd_color_out") {
    const idx = game?.oddColorIndex;
    const out = {
      correctIndex: typeof idx === "number" ? idx : -1,
      baseColor: normalizeOddColorHex(q.baseColor),
      oddColor: normalizeOddColorHex(q.oddColor),
    };
    if (anyAnswerCorrect) out.anyAnswerCorrect = true;
    if (explanation) out.explanation = explanation;
    return out;
  }
  if (q.type === "multiple_choice") {
    const correctIndices = getMcCorrectIndices(q);
    const labels = (q.options || []).map((raw) => normMcEntry(raw).text);
    const out = { correctIndices, correctLabels: correctIndices.map((i) => labels[i]).filter(Boolean) };
    if (correctIndices.length === 1) out.correctIndex = correctIndices[0];
    if (anyAnswerCorrect) out.anyAnswerCorrect = true;
    if (explanation) out.explanation = explanation;
    return out;
  }
  if (q.type === "music") {
    const options = normalizeMusicOptions(q);
    const idx = Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < options.length ? q.correctIndex : 0;
    const out = {
      correctIndex: idx,
      correctLabel: options[idx] || "",
      artist: String(q.artist ?? "").trim() || undefined,
      title: String(q.title ?? "").trim() || undefined,
      trackNumber: Number.isFinite(Number(q.trackNumber)) ? Number(q.trackNumber) : undefined,
    };
    if (anyAnswerCorrect) out.anyAnswerCorrect = true;
    if (explanation) out.explanation = explanation;
    return out;
  }
  if (q.type === "slider") {
    const out = { correctValue: q.correctValue, tolerance: q.tolerance ?? 0 };
    if (anyAnswerCorrect) out.anyAnswerCorrect = true;
    if (explanation) out.explanation = explanation;
    return out;
  }
  if (q.type === "click_location") {
    const out = {
      correctRegion: q.correctRegion,
    };
    if (anyAnswerCorrect) out.anyAnswerCorrect = true;
    if (explanation) out.explanation = explanation;
    return out;
  }
  if (q.type === "order") {
    const out = { correctOrder: q.correctOrder, items: q.items };
    if (anyAnswerCorrect) out.anyAnswerCorrect = true;
    if (explanation) out.explanation = explanation;
    return out;
  }
  if (q.type === "match") {
    const pairs = q.pairs || [];
    const matchLines = pairs.map((p) => {
      const a = String(p?.left?.text ?? "");
      const b = String(p?.right?.text ?? "");
      if (a && b) return `${a} ↔ ${b}`;
      return a || b || "";
    }).filter(Boolean);
    const out = { matchLines, pairs };
    if (anyAnswerCorrect) out.anyAnswerCorrect = true;
    if (explanation) out.explanation = explanation;
    return out;
  }
  if (anyAnswerCorrect && explanation) return { anyAnswerCorrect: true, explanation };
  if (anyAnswerCorrect) return { anyAnswerCorrect: true };
  return explanation ? { explanation } : {};
}

/** True if another player in the lobby already uses this name (case-insensitive, trimmed). */
export function isLobbyNameTaken(game, name) {
  const key = (String(name || "").trim().toLowerCase() || "player");
  for (const p of game.players.values()) {
    if (p.name.trim().toLowerCase() === key) return true;
  }
  return false;
}

export function addPlayer(game, name, socketId) {
  const id = uuidv4();
  const player = { id, name: name.slice(0, 24), score: 0, socketId };
  game.players.set(id, player);
  return player;
}

/** Remove a player only while the game is still in the lobby. */
export function removePlayerFromLobby(game, playerId) {
  if (game.phase !== "lobby") return null;
  const id = String(playerId ?? "").trim();
  if (!id) return null;
  const p = game.players.get(id);
  if (!p) return null;
  game.players.delete(id);
  return p;
}

/** Drop socket only; keeps player in game so they can reconnect. */
export function clearPlayerSocket(game, socketId) {
  for (const [, p] of game.players) {
    if (p.socketId === socketId) {
      p.socketId = null;
      return p.id;
    }
  }
  return null;
}

export function setPlayerSocket(game, playerId, socketId) {
  const p = game.players.get(playerId);
  if (p) p.socketId = socketId;
}

export function gradeAnswer(game, playerId, answer, elapsedMs) {
  const qs = game.quizSnapshot.questions || [];
  const q = qs[game.questionIndex];
  if (!q) return { correct: false, points: 0 };

  const timeLimitMs = (q.timeLimitSec ?? 20) * 1000;
  const maxPoints = q.points ?? 1000;

  let correct = false;
  let partialPoints = 0;
  /** @type {number[]} */
  let mcExpected = [];
  /** @type {number[]} */
  let mcGot = [];
  if (q.anyAnswerCorrect) {
    correct = true;
  } else if (q.type === "multiple_choice") {
    mcExpected = getMcCorrectIndices(q);
    mcGot = normalizeMcAnswer(answer);
    correct = arraysEqual(mcExpected, mcGot);
    // Multi-select partial credit: any correct picks earn a proportional share.
    // Full points still require exact match.
    if (!correct && mcExpected.length > 1) {
      const hitCount = mcGot.filter((i) => mcExpected.includes(i)).length;
      if (hitCount > 0) {
        const base = computePoints(timeLimitMs, elapsedMs, maxPoints);
        partialPoints = Math.round(base * (hitCount / mcExpected.length));
      }
    }
  } else if (q.type === "music") {
    const options = normalizeMusicOptions(q);
    const idx = Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < options.length ? q.correctIndex : 0;
    const got = Number(answer);
    correct = Number.isInteger(got) && got === idx;
  } else if (q.type === "slider") {
    const v = Number(answer);
    const tol = q.tolerance ?? 0;
    correct = Math.abs(v - q.correctValue) <= tol;
  } else if (q.type === "click_location") {
    const x = Number(answer?.x);
    const y = Number(answer?.y);
    const r = q.correctRegion;
    if (r && typeof x === "number" && typeof y === "number") {
      const dx = x - r.x;
      const dy = y - r.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      correct = dist <= (r.radius ?? 0.08);
    }
  } else if (q.type === "order") {
    const submitted = Array.isArray(answer) ? answer : [];
    correct =
      submitted.length === q.correctOrder.length &&
      q.correctOrder.every((idx, i) => submitted[i] === idx);
  } else if (q.type === "match") {
    const n = (q.pairs || []).length;
    const got = answer && typeof answer === "object" ? answer.matchByLeft : null;
    if (n === 0 || !Array.isArray(got) || got.length !== n) correct = false;
    else {
      correct = got.every((r, i) => Number(r) === i);
    }
  } else if (q.type === "odd_color_out") {
    const want = game.oddColorIndex;
    const got = Number(answer);
    correct = typeof want === "number" && Number.isInteger(got) && got === want && got >= 0 && got < 4;
  }

  const points = correct ? computePoints(timeLimitMs, elapsedMs, maxPoints) : partialPoints;
  let penalty = 0;
  const p = game.players.get(playerId);
  if (p) {
    if (correct) {
      p.score += points;
    } else if (q.type === "multiple_choice") {
      const wrongPicked = mcGot.filter((i) => !mcExpected.includes(i));
      const total = getMcPenaltyTotal(q);
      if (total > 0) {
        const opts = q.options || [];
        const hit = wrongPicked.some((i) => normMcEntry(opts[i]).penalizeIfWrong);
        if (hit) penalty = total;
      } else {
        penalty = wrongPicked.reduce((sum, i) => sum + normMcEntry((q.options || [])[i]).wrongPickPenaltyLegacy, 0);
      }
      if (penalty > 0) p.score -= penalty;
    } else if (q.penaltyOnWrong) {
      penalty = Math.max(0, Number(q.penaltyPoints) || 0);
      if (penalty > 0) p.score -= penalty;
    }
  }

  return { correct, points, penalty };
}

export function clearAnswers(game) {
  game.answers = new Map();
}

export function recordAnswer(game, playerId, payload) {
  game.answers.set(playerId, { ...payload, at: Date.now() });
}

/** True when every player with an active socket has submitted for the current question. */
export function allActivePlayersAnswered(game) {
  if (game.phase !== "question") return false;
  let active = 0;
  for (const p of game.players.values()) {
    if (p.socketId) {
      active++;
      if (!game.answers.has(p.id)) return false;
    }
  }
  return active > 0;
}
