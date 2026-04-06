import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import sharp from "sharp";
import { Server } from "socket.io";
import QRCode from "qrcode";
import { v4 as uuidv4 } from "uuid";
import * as quizStore from "./quizStore.js";
import * as gameManager from "./gameManager.js";
import { log, logLoggingStatus, logPlayer, logPlayerWarn, logWarn } from "./log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const UPLOAD_DIR = path.join(ROOT, "data", "uploads");
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || "camoot123";
const JOIN_BASE_URL = process.env.JOIN_BASE_URL || "";
const PORT = Number(process.env.PORT) || 3001;

logLoggingStatus();

const managerSessions = new Map();

function requireManager(req, res, next) {
  const token = req.headers["x-manager-token"];
  if (!token || !managerSessions.has(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

app.post("/api/manager/login", (req, res) => {
  const { password } = req.body || {};
  if (password === MANAGER_PASSWORD) {
    const token = uuidv4();
    managerSessions.set(token, Date.now());
    return res.json({ token });
  }
  res.status(401).json({ error: "Invalid password" });
});

app.get("/api/quizzes", requireManager, (_req, res) => {
  res.json(quizStore.listQuizzes());
});

app.get("/api/quizzes/:id", requireManager, (req, res) => {
  const q = quizStore.getQuiz(req.params.id);
  if (!q) return res.status(404).json({ error: "Not found" });
  res.json(q);
});

app.post("/api/quizzes", requireManager, (req, res) => {
  const { title } = req.body || {};
  res.json(quizStore.createQuiz({ title }));
});

app.put("/api/quizzes/:id", requireManager, (req, res) => {
  const existing = quizStore.getQuiz(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  const body = req.body || {};
  const merged = {
    ...existing,
    ...body,
    id: existing.id,
    questions: body.questions !== undefined ? body.questions : existing.questions,
  };
  res.json(quizStore.saveQuiz(merged));
});

app.delete("/api/quizzes/:id", requireManager, (req, res) => {
  quizStore.deleteQuiz(req.params.id);
  res.json({ ok: true });
});

app.post("/api/upload", requireManager, uploadImage.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const filename = `${uuidv4()}.webp`;
  const dest = path.join(UPLOAD_DIR, filename);
  try {
    await sharp(req.file.buffer, { failOn: "none" })
      .rotate()
      .resize(4096, 4096, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toFile(dest);
  } catch {
    return res.status(400).json({ error: "Could not process image (use JPEG, PNG, GIF, WebP, etc.)" });
  }
  res.json({ url: `/uploads/${filename}` });
});

app.post("/api/games", requireManager, (req, res) => {
  const { quizId } = req.body || {};
  if (!quizId) return res.status(400).json({ error: "quizId required" });
  const created = gameManager.createGame(quizId);
  if (!created) return res.status(404).json({ error: "Quiz not found" });
  res.json(created);
});

app.get("/api/qr", async (req, res) => {
  const pin = String(req.query.pin || "");
  if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    return res.status(400).send("Invalid pin");
  }
  const host = req.get("host") || "localhost";
  const proto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  const base = JOIN_BASE_URL || `${proto}://${host}`;
  const joinUrl = `${base.replace(/\/$/, "")}/play?pin=${pin}`;
  try {
    const png = await QRCode.toBuffer(joinUrl, { type: "png", width: 320, margin: 2 });
    res.type("png").send(png);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

function broadcastGame(game) {
  const pin = game.pin;
  const hostPayload = gameManager.getPublicGameState(game, true);
  const playerPayload = gameManager.getPublicGameState(game, false);
  io.to(`host:${pin}`).emit("state", hostPayload);
  io.to(`game:${pin}`).emit("state", playerPayload);
}

const autoRevealTimers = new Map();

function clearQuestionDeadline(pin) {
  const t = autoRevealTimers.get(pin);
  if (t) {
    clearTimeout(t);
    autoRevealTimers.delete(pin);
  }
}

function scheduleQuestionDeadline(pin) {
  clearQuestionDeadline(pin);
  const game = gameManager.getGameByPin(pin);
  if (!game || game.phase !== "question") return;
  const qs = game.quizSnapshot.questions || [];
  const q = qs[game.questionIndex];
  /** Small cushion so mobile taps / in-flight player_answer packets are not rejected while phase flips to reveal. */
  const REVEAL_GRACE_MS = 220;
  const ms = Math.max(500, (q?.timeLimitSec ?? 20) * 1000) + REVEAL_GRACE_MS;
  const idx = game.questionIndex;
  const qType = q?.type ?? "?";
  logPlayer("question timer scheduled", {
    pin,
    qIndex: idx,
    qType,
    deadlineMs: ms,
    limitSec: q?.timeLimitSec ?? 20,
    graceMs: REVEAL_GRACE_MS,
    answersSoFar: game.answers?.size ?? 0,
  });
  const t = setTimeout(() => {
    autoRevealTimers.delete(pin);
    const g = gameManager.getGameByPin(pin);
    if (!g || g.phase !== "question" || g.questionIndex !== idx) {
      logPlayer("question timer fired — skipped (phase or index changed)", {
        pin,
        expectedIdx: idx,
        hasGame: !!g,
        phase: g?.phase,
        qIndex: g?.questionIndex,
      });
      return;
    }
    logPlayer("question timer fired → reveal", {
      pin,
      qIndex: idx,
      qType,
      answersRecorded: g.answers?.size ?? 0,
    });
    g.phase = "reveal";
    broadcastGame(g);
  }, ms);
  autoRevealTimers.set(pin, t);
}

/** Compact answer shape for logs (no big payloads). */
function summarizeAnswerForLog(answer) {
  if (answer == null) return { kind: "nullish", raw: answer };
  if (typeof answer === "number")
    return { kind: "number.value", value: answer, isInt: Number.isInteger(answer) };
  if (Array.isArray(answer))
    return {
      kind: "array",
      len: answer.length,
      sample: answer.slice(0, 12),
      numeric: answer.every((x) => typeof x === "number" && !Number.isNaN(x)),
    };
  if (typeof answer === "object") {
    if ("x" in answer && "y" in answer) {
      const x = Number(answer.x);
      const y = Number(answer.y);
      return { kind: "point", x, y, finite: Number.isFinite(x) && Number.isFinite(y) };
    }
    if ("matchByLeft" in answer && Array.isArray(answer.matchByLeft)) {
      const m = answer.matchByLeft;
      return { kind: "matchByLeft", len: m.length, sample: m.slice(0, 12) };
    }
  }
  const s = JSON.stringify(answer);
  return { kind: "other", preview: s.length > 160 ? `${s.slice(0, 160)}…` : s };
}

function clientMeta(socket) {
  const h = socket.handshake?.headers ?? {};
  const ua = typeof h["user-agent"] === "string" ? h["user-agent"].slice(0, 200) : "";
  const fwd = typeof h["x-forwarded-for"] === "string" ? h["x-forwarded-for"].split(",")[0].trim() : "";
  return { ua, forwardedFor: fwd || undefined, transport: socket.conn?.transport?.name };
}

const ADMIN_SESSION_MSG = "This live session was closed from the admin page.";

/** Prefix server logs when debugging host kick / lobby remove. */
function kickLog(...args) {
  console.log("[camoot:kick]", ...args);
}
function kickWarn(...args) {
  console.warn("[camoot:kick]", ...args);
}

function forceTerminateLiveSession(pin) {
  clearQuestionDeadline(pin);
  if (!gameManager.getGameByPin(pin)) return false;
  io.to(`host:${pin}`).emit("session_ended", { message: ADMIN_SESSION_MSG });
  io.to(`game:${pin}`).emit("session_ended", { message: ADMIN_SESSION_MSG });
  gameManager.destroyGame(pin);
  return true;
}

app.get("/api/admin/sessions", requireManager, (_req, res) => {
  res.json(gameManager.listGamesSummary());
});

app.delete("/api/admin/sessions/:pin", requireManager, (req, res) => {
  const raw = String(req.params.pin || "").replace(/\D/g, "");
  const pin = raw.length === 6 ? raw : "";
  if (!pin) return res.status(400).json({ error: "Invalid pin" });
  if (!gameManager.getGameByPin(pin)) return res.status(404).json({ error: "Not found" });
  forceTerminateLiveSession(pin);
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  log("io", "connect", socket.id);

  socket.on("host_join", ({ pin, hostToken }) => {
    const game = gameManager.getGameByPin(pin);
    if (!game || game.hostToken !== hostToken) {
      logWarn("host_join", "reject", { pin, reason: "invalid credentials" });
      socket.emit("error", { message: "Invalid host credentials" });
      return;
    }
    socket.join(`host:${pin}`);
    socket.data.role = "host";
    socket.data.pin = pin;
    socket.data.hostToken = hostToken;
    log("host_join", "ok", { pin, socketId: socket.id });
    socket.emit("state", gameManager.getPublicGameState(game, true));
  });

  socket.on("player_join", ({ pin, username, playerId }) => {
    const game = gameManager.getGameByPin(pin);
    if (!game) {
      logWarn("player_join", "reject game not found", { pin, username, socketId: socket.id });
      socket.emit("error", { message: "Game not found" });
      return;
    }

    // Reconnect: same player rejoining after refresh or disconnect (any phase)
    if (playerId && game.players.has(playerId)) {
      const player = game.players.get(playerId);
      player.socketId = socket.id;
      gameManager.setPlayerSocket(game, playerId, socket.id);
      socket.join(`game:${pin}`);
      socket.data.role = "player";
      socket.data.pin = pin;
      socket.data.playerId = player.id;
      log("player_join", "reconnect", {
        pin,
        playerId: player.id,
        phase: game.phase,
        qIndex: game.questionIndex,
        socketId: socket.id,
      });
      logPlayer("player_join reconnect (detail)", {
        pin,
        playerId: player.id,
        name: player.name,
        phase: game.phase,
        qIndex: game.questionIndex,
        ...clientMeta(socket),
      });
      socket.emit("joined", { playerId: player.id, pin: game.pin });
      broadcastGame(game);
      return;
    }

    if (game.phase !== "lobby") {
      logWarn("player_join", "reject not lobby", { pin, phase: game.phase, username, socketId: socket.id });
      socket.emit("error", { message: "Game already started. Only returning players can rejoin." });
      return;
    }

    const name = String(username || "Player").trim() || "Player";
    if (gameManager.isLobbyNameTaken(game, name)) {
      logWarn("player_join", "reject name taken", { pin, name, socketId: socket.id });
      socket.emit("error", { message: "That name is already taken in this lobby. Choose another." });
      return;
    }
    const player = gameManager.addPlayer(game, name, socket.id);
    socket.join(`game:${pin}`);
    socket.data.role = "player";
    socket.data.pin = pin;
    socket.data.playerId = player.id;
    log("player_join", "new player", { pin, name, playerId: player.id, socketId: socket.id });
    logPlayer("player_join new (detail)", { pin, name, playerId: player.id, ...clientMeta(socket) });
    socket.emit("joined", { playerId: player.id, pin: game.pin });
    broadcastGame(game);
  });

  socket.on("host_kick_player", (payload = {}) => {
    const { pin: rawPin, playerId, hostToken: bodyToken } = payload;
    kickLog("event recv", {
      fromSocket: socket.id,
      rawPin,
      playerId,
      payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
      dataPin: socket.data.pin,
      dataRole: socket.data.role,
      hasBodyToken: typeof bodyToken === "string" && bodyToken.length > 0,
    });
    const pin = String(rawPin || socket.data.pin || "").replace(/\D/g, "").slice(0, 6);
    if (pin.length !== 6) {
      kickWarn("abort: pin not 6 digits after normalize", { pin, rawPin, dataPin: socket.data.pin });
      return;
    }
    const game = gameManager.getGameByPin(pin);
    if (!game) {
      kickWarn("abort: no game for pin", { pin });
      return;
    }
    if (game.phase !== "lobby") {
      kickWarn("abort: not lobby phase", { pin, phase: game.phase });
      return;
    }
    const token = typeof bodyToken === "string" && bodyToken ? bodyToken : socket.data.hostToken;
    if (!token || game.hostToken !== token) {
      kickWarn("abort: host token mismatch", {
        pin,
        hadToken: !!token,
        gameHasToken: !!game.hostToken,
      });
      return;
    }
    const targetId = String(playerId ?? "").trim();
    const playerIdsBefore = [...game.players.keys()];
    kickLog("attempt remove", { targetId, playerCount: game.players.size, playerIdsBefore });
    const removed = gameManager.removePlayerFromLobby(game, targetId);
    if (!removed) {
      kickWarn("abort: playerId not in game", { targetId, playerIdsBefore });
      return;
    }
    kickLog("removed ok", {
      targetId,
      name: removed.name,
      hadSocketId: !!removed.socketId,
      remainingPlayers: game.players.size,
    });
    const rid = removed.socketId;
    const sock = rid ? io.sockets.sockets.get(rid) : null;
    const kickPayload = { message: "Removed from the lobby by the host." };
    if (sock) {
      sock.leave(`game:${pin}`);
      sock.emit("kicked", kickPayload);
      delete sock.data.role;
      delete sock.data.pin;
      delete sock.data.playerId;
      kickLog("notified socket via ref", { rid });
    } else if (rid) {
      io.to(rid).emit("kicked", kickPayload);
      kickLog("notified socket via io.to", { rid });
    } else {
      kickLog("no live socket for removed player");
    }
    broadcastGame(game);
  });

  socket.on("host_start", () => {
    const game = gameManager.getGameByPin(socket.data.pin);
    if (!game || socket.data.role !== "host") return;
    if (game.hostToken !== socket.data.hostToken) return;
    if (game.phase !== "lobby") return;
    if (game.players.size < 1) {
      socket.emit("error", { message: "Wait for at least one player to join before starting." });
      return;
    }
    log("host_start", game.pin, { players: game.players.size });
    clearQuestionDeadline(game.pin);
    const snap = game.quizSnapshot;
    const qs = snap.questions;
    if (snap.shuffleQuestionOrder && Array.isArray(qs) && qs.length > 1) {
      for (let i = qs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [qs[i], qs[j]] = [qs[j], qs[i]];
      }
    }
    game.phase = "question";
    game.questionIndex = 0;
    game.startedAt = Date.now();
    gameManager.clearAnswers(game);
    gameManager.refreshPlayerQuestionCache(game);
    broadcastGame(game);
    scheduleQuestionDeadline(game.pin);
  });

  socket.on("host_next", () => {
    const game = gameManager.getGameByPin(socket.data.pin);
    if (!game || socket.data.role !== "host") return;
    if (game.hostToken !== socket.data.hostToken) return;
    log("host_next", game.pin, { from: game.phase, qIndex: game.questionIndex });
    const qs = game.quizSnapshot.questions || [];
    clearQuestionDeadline(game.pin);
    if (game.phase === "question") {
      game.phase = "reveal";
      broadcastGame(game);
      return;
    }
    if (game.phase === "reveal") {
      if (game.questionIndex >= qs.length - 1) {
        game.phase = "ended";
        broadcastGame(game);
        return;
      }
      game.questionIndex += 1;
      game.phase = "question";
      game.startedAt = Date.now();
      gameManager.clearAnswers(game);
      gameManager.refreshPlayerQuestionCache(game);
      broadcastGame(game);
      scheduleQuestionDeadline(game.pin);
    }
  });

  socket.on("host_end_quiz", () => {
    const pin = socket.data.pin;
    const game = gameManager.getGameByPin(pin);
    if (!game || socket.data.role !== "host") return;
    if (game.hostToken !== socket.data.hostToken) return;
    if (game.phase === "ended") return;
    clearQuestionDeadline(pin);
    game.phase = "ended";
    broadcastGame(game);
  });

  socket.on("player_answer", (payload = {}) => {
    const { answer, questionIndex: rawQIdx, clientTime: rawClientTime } = payload;
    const pin = socket.data.pin;
    const playerId = socket.data.playerId;
    const serverNow = Date.now();
    const meta = clientMeta(socket);
    const answerSummary = summarizeAnswerForLog(answer);
    const questionIndex = rawQIdx === undefined || rawQIdx === null ? null : Number(rawQIdx);
    const clientTime = rawClientTime === undefined || rawClientTime === null ? null : Number(rawClientTime);
    const skewMs =
      clientTime != null && Number.isFinite(clientTime) ? serverNow - clientTime : null;

    logPlayer("player_answer packet", {
      socketId: socket.id,
      pin,
      playerId,
      role: socket.data.role,
      payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
      questionIndexPayload: rawQIdx,
      questionIndexParsed: questionIndex,
      clientTime: rawClientTime,
      skewMs,
      answerSummary,
      ...meta,
    });

    if (!pin || !playerId || socket.data.role !== "player") {
      logWarn("player_answer", "ignored bad socket data", { pin, playerId, role: socket.data.role });
      logPlayerWarn("player_answer REJECT bad socket", { pin, playerId, role: socket.data.role });
      return;
    }
    const game = gameManager.getGameByPin(pin);
    if (!game || game.phase !== "question") {
      logWarn("player_answer", "ignored wrong phase", { pin, phase: game?.phase, playerId });
      logPlayerWarn("player_answer REJECT wrong phase", {
        pin,
        playerId,
        phase: game?.phase,
        wanted: "question",
      });
      return;
    }
    if (questionIndex === null || Number.isNaN(questionIndex)) {
      logPlayerWarn("player_answer REJECT invalid questionIndex", {
        pin,
        playerId,
        rawQIdx,
        gameQIdx: game.questionIndex,
      });
      return;
    }
    if (game.questionIndex !== questionIndex) {
      logWarn("player_answer", "ignored q index mismatch", {
        pin,
        playerId,
        expected: game.questionIndex,
        got: questionIndex,
      });
      logPlayerWarn("player_answer REJECT q index mismatch", {
        pin,
        playerId,
        expected: game.questionIndex,
        got: questionIndex,
      });
      return;
    }
    if (game.answers.has(playerId)) {
      logPlayerWarn("player_answer REJECT duplicate (already have answer for player)", {
        pin,
        playerId,
        questionIndex,
        answersInGameMap: game.answers.size,
      });
      return;
    }

    const elapsed = Math.max(0, serverNow - (game.startedAt || serverNow));
    const qs = game.quizSnapshot?.questions || [];
    const qNow = qs[game.questionIndex];
    logPlayer("player_answer ACCEPT grading", {
      pin,
      playerId,
      questionIndex,
      qType: qNow?.type ?? "?",
      elapsedMs: elapsed,
      startedAt: game.startedAt,
      skewMs,
      answerSummary,
    });

    gameManager.recordAnswer(game, playerId, { answer, clientTime });
    const result = gameManager.gradeAnswer(game, playerId, answer, elapsed);
    log("player_answer", pin, { playerId, questionIndex, correct: result.correct, points: result.points });
    logPlayer("player_answer GRADED emit answer_result", {
      pin,
      playerId,
      questionIndex,
      correct: result.correct,
      points: result.points,
      penalty: result.penalty,
    });

    socket.emit("answer_result", { ...result, questionIndex });

    const allAnswered = gameManager.allActivePlayersAnswered(game);
    if (allAnswered) {
      logPlayer("all active players answered → reveal (clear deadline)", { pin, qIndex: questionIndex });
      clearQuestionDeadline(pin);
      game.phase = "reveal";
    }
    broadcastGame(game);
  });

  socket.on("disconnect", (reason) => {
    log("io", "disconnect", socket.id, reason, { role: socket.data.role, pin: socket.data.pin });
    const pin = socket.data.pin;
    if (!pin) return;
    const game = gameManager.getGameByPin(pin);
    if (!game) return;
    if (socket.data.role === "player") {
      gameManager.clearPlayerSocket(game, socket.id);
      broadcastGame(game);
    }
  });
});

const distPath = path.join(ROOT, "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use("/uploads", express.static(UPLOAD_DIR));

server.listen(PORT, () => {
  console.log(`Camoot server http://localhost:${PORT}`);
});
