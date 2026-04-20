import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import NavHome from "../components/NavHome";
import {
  playGameStart,
  playHostStep,
  playPickQuiz,
  playUnlockOk,
  resumeSounds,
} from "../sounds";
import { createGame, listQuizzes, managerLogin, playerJoinUrl, qrUrl } from "../api";
import { getSocket } from "../socket";
import type { GameState } from "../types";

const HOST_SESSION = "camoot_host_session";
/** Host auth is separate from Create so opening Host always requires the password (unless already logged in on Host this session). */
const HOST_MGR_TOKEN = "camoot_host_mgr_token";

type HostGameSession = { pin: string; hostToken: string; quizTitle: string };

type QuizRow = { id: string; title: string; questionCount: number };

export default function Host() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(HOST_MGR_TOKEN));
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);

  const [hostSession, setHostSession] = useState<HostGameSession | null>(() => {
    try {
      const raw = sessionStorage.getItem(HOST_SESSION);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [state, setState] = useState<GameState | null>(null);
  const [quizzes, setQuizzes] = useState<QuizRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Shown on the quiz picker when saved host session (PIN/token) no longer exists on the server */
  const [lobbyExpiredMsg, setLobbyExpiredMsg] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  /** True until the first `state` after this host session connected (detect stale ended games on /host revisit). */
  const awaitingInitialHostState = useRef(false);

  useEffect(() => {
    if (!token || hostSession) return;
    let cancelled = false;
    setLoadingList(true);
    setErr(null);
    listQuizzes(token)
      .then((list) => {
        if (!cancelled) setQuizzes(list);
      })
      .catch(() => {
        if (!cancelled) {
          setErr("Session expired.");
          setToken(null);
          sessionStorage.removeItem(HOST_MGR_TOKEN);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, hostSession]);

  useEffect(() => {
    if (!hostSession) return;
    awaitingInitialHostState.current = true;
    const s = getSocket();
    const onState = (st: GameState) => {
      if (awaitingInitialHostState.current && st.phase === "ended") {
        awaitingInitialHostState.current = false;
        sessionStorage.removeItem(HOST_SESSION);
        setHostSession(null);
        setState(null);
        setLobbyExpiredMsg("That game was already finished. Pick a quiz to host a new one.");
        return;
      }
      awaitingInitialHostState.current = false;
      setState(st);
    };
    const onSockErr = (e: { message?: string }) => {
      const msg = e?.message || "Socket error";
      if (msg === "Invalid host credentials") {
        sessionStorage.removeItem(HOST_SESSION);
        setHostSession(null);
        setState(null);
        setErr(null);
        setLobbyExpiredMsg(
          "That lobby is no longer on the server (for example after a restart). Choose a quiz to start a new one.",
        );
        return;
      }
      setErr(msg);
    };
    const onSessionEnded = (e: { message?: string }) => {
      sessionStorage.removeItem(HOST_SESSION);
      setHostSession(null);
      setState(null);
      setErr(null);
      setLobbyExpiredMsg(e?.message || "This session was closed.");
    };
    const joinHost = () => {
      s.emit("host_join", { pin: hostSession!.pin, hostToken: hostSession!.hostToken });
    };
    s.on("state", onState);
    s.on("error", onSockErr);
    s.on("session_ended", onSessionEnded);
    joinHost();
    s.on("connect", joinHost);
    return () => {
      s.off("state", onState);
      s.off("connect", joinHost);
      s.off("error", onSockErr);
      s.off("session_ended", onSessionEnded);
    };
  }, [hostSession]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr(null);
    try {
      const t = await managerLogin(password);
      sessionStorage.setItem(HOST_MGR_TOKEN, t);
      setToken(t);
      setPassword("");
      resumeSounds();
      playUnlockOk();
    } catch {
      setLoginErr("Wrong password.");
    }
  };

  const logoutPassword = () => {
    sessionStorage.removeItem(HOST_MGR_TOKEN);
    sessionStorage.removeItem(HOST_SESSION);
    setToken(null);
    setHostSession(null);
    setState(null);
    setQuizzes([]);
    setLobbyExpiredMsg(null);
  };

  const pickQuiz = async (quizId: string) => {
    if (!token) return;
    setStartingId(quizId);
    setErr(null);
    setLobbyExpiredMsg(null);
    try {
      const g = await createGame(token, quizId);
      const sess: HostGameSession = { pin: g.pin, hostToken: g.hostToken, quizTitle: g.quizTitle };
      sessionStorage.setItem(HOST_SESSION, JSON.stringify(sess));
      resumeSounds();
      playPickQuiz();
      setHostSession(sess);
    } catch {
      setErr("Could not start game.");
    } finally {
      setStartingId(null);
    }
  };

  const clearLiveSession = () => {
    sessionStorage.removeItem(HOST_SESSION);
    setHostSession(null);
    setState(null);
    setLobbyExpiredMsg(null);
  };

  const kickPlayer = (p: { id: string; name: string }) => {
    if (!hostSession) {
      console.warn("[camoot:kick] no hostSession, skip");
      return;
    }
    if (!confirm(`Remove "${p.name}" from the lobby?`)) {
      console.log("[camoot:kick] host cancelled confirm");
      return;
    }
    const payload = {
      pin: hostSession.pin,
      hostToken: hostSession.hostToken,
      playerId: p.id,
    };
    const sock = getSocket();
    console.log("[camoot:kick] emit host_kick_player", {
      socketConnected: sock.connected,
      socketId: sock.id,
      pin: payload.pin,
      playerId: payload.playerId,
      hostTokenChars: typeof payload.hostToken === "string" ? payload.hostToken.length : 0,
    });
    sock.emit("host_kick_player", payload);
  };

  const hostStart = () => {
    if (!state || state.players.length < 1) return;
    resumeSounds();
    playGameStart();
    getSocket().emit("host_start");
  };
  const hostNext = () => {
    resumeSounds();
    playHostStep();
    getSocket().emit("host_next");
  };

  const hostEndQuiz = () => {
    if (state?.phase === "ended") return;
    if (!confirm("End the quiz for everyone now? Players will see the final scores screen.")) return;
    resumeSounds();
    getSocket().emit("host_end_quiz");
  };

  const copyInviteLink = async () => {
    if (!state?.pin) return;
    const url = playerJoinUrl(state.pin);
    const ok = async () => {
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 2000);
    };
    try {
      await navigator.clipboard.writeText(url);
      await ok();
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        await ok();
      } catch {
        setErr("Could not copy invite link.");
      }
    }
  };

  if (!token) {
    return (
      <div className="kh-page">
        <div className="kh-page-narrow-sm">
          <div className="kh-nav-home-wrap">
            <NavHome label="Back to home" />
          </div>
          <div className="kh-card" style={{ maxWidth: "100%" }}>
          <h1 style={{ marginTop: 0, color: "var(--camoot-purple)" }}>Host a game</h1>
          <p style={{ color: "#555", lineHeight: 1.5 }}>
            Enter the same password as <strong>Create</strong>. Host sign-in is separate from the editor, so unlocking Create does not unlock this screen.
          </p>
          {loginErr && <p style={{ color: "var(--camoot-pink)", fontWeight: 600 }}>{loginErr}</p>}
          <form onSubmit={login}>
            <label style={{ fontWeight: 600, display: "block", marginBottom: "0.35rem" }}>Password</label>
            <input
              type="password"
              className="kh-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              style={{ marginBottom: "1rem" }}
            />
            <button type="submit" className="kh-btn kh-btn-primary kh-btn-block">
              Continue
            </button>
          </form>
        </div>
        </div>
      </div>
    );
  }

  if (!hostSession) {
    return (
      <div className="kh-page">
        <div className="kh-page-narrow">
          <div className="kh-nav-home-wrap">
            <NavHome label="Back to home" />
          </div>
          <div className="kh-card" style={{ maxWidth: "100%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, color: "var(--camoot-purple)" }}>Choose a quiz</h1>
            <button type="button" className="kh-btn kh-btn-outline kh-btn-sm" onClick={logoutPassword}>
              Log out
            </button>
          </div>
          <p style={{ color: "#666" }}>Tap a quiz to start a live lobby (PIN + QR).</p>
          {lobbyExpiredMsg && (
            <p style={{ color: "#555", fontWeight: 600, lineHeight: 1.45 }}>{lobbyExpiredMsg}</p>
          )}
          {err && <p style={{ color: "var(--camoot-pink)", fontWeight: 600 }}>{err}</p>}
          {loadingList && <p>Loading…</p>}
          {!loadingList && quizzes.length === 0 && (
            <p>
              No quizzes yet.{" "}
              <Link to="/create">Create one</Link>.
            </p>
          )}
          <ul className="kh-host-pick-list">
            {quizzes.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  className="kh-host-pick-btn"
                  disabled={!!startingId}
                  onClick={() => pickQuiz(q.id)}
                >
                  <span className="kh-host-pick-title">{q.title}</span>
                  <span className="kh-host-pick-meta">{q.questionCount} questions</span>
                  {startingId === q.id && <span className="kh-host-pick-loading">Starting…</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="kh-page">
        <div className="kh-page-narrow-sm">
          <div className="kh-nav-home-wrap">
            <NavHome label="Back to home" />
          </div>
          <div className="kh-card">
            <p>Connecting…</p>
            {err && <p style={{ color: "var(--camoot-pink)" }}>{err}</p>}
          </div>
        </div>
      </div>
    );
  }

  const qr = qrUrl(hostSession.pin);

  return (
    <div className="kh-page kh-host">
      <div className="kh-host-bar">
        <span className="kh-host-brand">{state.quizTitle}</span>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          {state.phase !== "ended" && (
            <button
              type="button"
              className="kh-btn kh-btn-sm"
              style={{
                background: "rgba(201, 42, 42, 0.9)",
                color: "#fff",
                border: "2px solid rgba(255, 255, 255, 0.4)",
                boxShadow: "0 2px 0 rgba(0,0,0,0.15)",
              }}
              onClick={hostEndQuiz}
            >
              End quiz
            </button>
          )}
          <button type="button" className="kh-btn kh-btn-ghost kh-btn-sm" onClick={clearLiveSession}>
            Pick another quiz
          </button>
          <button type="button" className="kh-btn kh-btn-ghost kh-btn-sm" onClick={logoutPassword}>
            Log out
          </button>
        </div>
      </div>

      {state.phase === "lobby" && (
        <div className="kh-host-center-stage">
          <div className="kh-grid-2 kh-host-lobby">
            <div className="kh-panel kh-panel-glass">
              <h2 style={{ marginTop: 0 }}>Join with PIN</h2>
              <div className="kh-pin-display">{state.pin}</div>
              <button
                type="button"
                className="kh-btn kh-btn-outline kh-btn-block"
                onClick={() => void copyInviteLink()}
              >
                {inviteCopied ? "Copied!" : "Copy invite link"}
              </button>
              <div style={{ textAlign: "center" }}>
                <img src={qr} alt="QR code to join" width={280} height={280} style={{ borderRadius: 12 }} />
              </div>
              {state.players.length < 1 ? (
                <p style={{ textAlign: "center", color: "#666", fontSize: "0.95rem", marginTop: "1rem", marginBottom: "0.5rem" }}>
                  Waiting for at least one player to join…
                </p>
              ) : null}
              <button
                type="button"
                className="kh-btn kh-btn-primary kh-btn-block"
                style={{ marginTop: "1rem" }}
                disabled={state.players.length < 1}
                onClick={hostStart}
              >
                Start
              </button>
            </div>
            <div className="kh-panel kh-panel-glass">
              <h2 style={{ marginTop: 0 }}>Players ({state.players.length})</h2>
              <ul className="kh-host-players">
                {state.players.map((p) => (
                  <li key={p.id} className="kh-host-player-row">
                    <span className="kh-host-player-name">
                      {p.name}
                      {p.connected === false ? (
                        <span className="kh-host-player-offline"> (offline)</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="kh-btn kh-btn-outline kh-btn-sm kh-host-kick"
                      onClick={() => kickPlayer(p)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {state.phase === "question" && state.question && (
        <div className="kh-host-center-stage">
          <div className="kh-panel kh-host-q kh-panel-glass">
            <div className="kh-host-qhead">
              <span>
                Question {state.questionIndex + 1} / {state.totalQuestions}
              </span>
              <HostTimer state={state} />
            </div>
            {(state.question as { anyAnswerCorrect?: boolean }).anyAnswerCorrect ? (
              <p className="kh-host-joke-badge">Joke round: any answer is correct</p>
            ) : null}
            <h2>{String(state.question.question)}</h2>
            <HostMcQuestionImage q={state.question} />
            <HostQuestionPreview q={state.question} reveal={state.reveal} />
            <p className="kh-host-q-responses-label">Responses</p>
            <ul className="kh-host-q-responses" aria-label="Who has answered">
              {state.players.map((p) => (
                <li
                  key={p.id}
                  className={p.answered ? "kh-host-response is-answered" : "kh-host-response is-waiting"}
                >
                  <span className="kh-host-response-name">{p.name}</span>
                  {p.answered ? <span className="kh-host-response-badge">Done</span> : null}
                </li>
              ))}
            </ul>
            <p className="kh-host-hint">Players answer on their devices.</p>
            <button type="button" className="kh-btn kh-btn-primary kh-btn-block" onClick={hostNext}>
              Show answers
            </button>
          </div>
        </div>
      )}

      {state.phase === "reveal" && state.question && (
        <div className="kh-host-center-stage">
          <div className="kh-panel kh-host-q kh-panel-glass">
            <h2 style={{ marginTop: 0 }}>Reveal & standings</h2>
            <HostMcQuestionImage q={state.question} />
            <HostQuestionPreview q={state.question} reveal={state.reveal} showCorrect />
            <h3 style={{ margin: "1.25rem 0 0.5rem", fontSize: "1.05rem" }}>Leaderboard</h3>
            <ol className="kh-host-lb">
              {[...state.players]
                .sort((a, b) => b.score - a.score)
                .map((p) => (
                  <li key={p.id}>
                    {p.name} - {p.score}
                  </li>
                ))}
            </ol>
            <button type="button" className="kh-btn kh-btn-primary kh-btn-block" style={{ marginTop: "1rem" }} onClick={hostNext}>
              {state.questionIndex >= state.totalQuestions - 1 ? "Finish" : "Next question"}
            </button>
          </div>
        </div>
      )}

      {state.phase === "ended" && (
        <div className="kh-host-center-stage">
          <div className="kh-panel kh-host-q kh-panel-glass">
            <h1>Game over</h1>
            <ol className="kh-host-lb">
              {[...state.players]
                .sort((a, b) => b.score - a.score)
                .map((p) => (
                  <li key={p.id}>
                    {p.name} - {p.score}
                  </li>
                ))}
            </ol>
            <div className="kh-nav-home-wrap is-center" style={{ marginTop: "1.25rem" }}>
              <NavHome />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HostTimer({ state }: { state: GameState }) {
  const [, setTick] = useState(0);
  const q = state.question;
  const limitSec = q ? Number((q as { timeLimitSec?: number }).timeLimitSec ?? 20) : 20;
  const started = state.questionStartedAt;

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 300);
    return () => clearInterval(t);
  }, [started, state.questionIndex]);

  if (state.phase !== "question" || !started || !q) return null;
  const elapsed = (Date.now() - started) / 1000;
  const left = Math.max(0, Math.ceil(limitSec - elapsed));
  return <span className="kh-host-timer kh-host-timer-pulse">{left}s</span>;
}

function HostMcQuestionImage({ q }: { q: Record<string, unknown> }) {
  if (q.type !== "multiple_choice") return null;
  const url = q.imageUrl;
  if (typeof url !== "string" || url.trim() === "") return null;
  return <img src={url} alt="" className="kh-host-mc-qimage" decoding="async" />;
}

function normalizeMcOptions(q: Record<string, unknown>): string[] {
  const raw = q.options;
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => (typeof o === "string" ? o : String((o as { text?: string })?.text ?? "")));
}

function RevealExplanation({ text }: { text: string }) {
  return (
    <div className="kh-host-explanation">
      <strong style={{ display: "block", marginBottom: "0.25rem" }}>Why?</strong>
      {text}
    </div>
  );
}

function HostQuestionPreview({
  q,
  reveal,
  showCorrect,
}: {
  q: Record<string, unknown>;
  reveal?: Record<string, unknown>;
  showCorrect?: boolean;
}) {
  const t = q.type as string;
  const expl = reveal && typeof reveal.explanation === "string" ? reveal.explanation : null;
  const anyAnswerCorrect = !!(reveal && reveal.anyAnswerCorrect === true);

  if (showCorrect && anyAnswerCorrect) {
    return (
      <>
        <p className="kh-reveal-line">Joke round: any answer was treated as correct.</p>
        {expl ? <RevealExplanation text={expl} /> : null}
      </>
    );
  }

  if (t === "multiple_choice" && showCorrect && reveal) {
    const fromPayload = Array.isArray(reveal.correctLabels) ? (reveal.correctLabels as string[]) : [];
    if (fromPayload.length > 0) {
      return (
        <>
          <p className="kh-reveal-line">Correct: {fromPayload.join(" · ")}</p>
          {expl ? <RevealExplanation text={expl} /> : null}
        </>
      );
    }
    const opts = normalizeMcOptions(q);
    if (Array.isArray(reveal.correctIndices) && (reveal.correctIndices as number[]).length > 0) {
      const labels = (reveal.correctIndices as number[]).map((i) => opts[i]).filter(Boolean);
      return (
        <>
          <p className="kh-reveal-line">Correct: {labels.join(" · ")}</p>
          {expl ? <RevealExplanation text={expl} /> : null}
        </>
      );
    }
    if (typeof reveal.correctIndex === "number") {
      return (
        <>
          <p className="kh-reveal-line">Correct: {opts[reveal.correctIndex as number]}</p>
          {expl ? <RevealExplanation text={expl} /> : null}
        </>
      );
    }
  }
  if (t === "music") {
    const opts = Array.isArray(q.options) ? (q.options as string[]) : [];
    const artist = String(q.artist ?? "").trim();
    const title = String(q.title ?? "").trim();
    const trackNumber = q.trackNumber;
    if (showCorrect && reveal) {
      const label =
        typeof reveal.correctLabel === "string"
          ? String(reveal.correctLabel)
          : typeof reveal.correctIndex === "number"
            ? opts[reveal.correctIndex as number]
            : "";
      return (
        <>
          {label ? <p className="kh-reveal-line">Correct: {label}</p> : null}
          {(artist || title || typeof trackNumber === "number") ? (
            <p className="kh-reveal-line">
              {typeof trackNumber === "number" ? `#${trackNumber}` : ""}
              {typeof trackNumber === "number" && (artist || title) ? " - " : ""}
              {[artist, title].filter(Boolean).join(" - ")}
            </p>
          ) : null}
          {expl ? <RevealExplanation text={expl} /> : null}
        </>
      );
    }
    return (
      <>
        {(artist || title || typeof trackNumber === "number") ? (
          <p className="kh-reveal-line">
            {typeof trackNumber === "number" ? `#${trackNumber}` : ""}
            {typeof trackNumber === "number" && (artist || title) ? " - " : ""}
            {[artist, title].filter(Boolean).join(" - ")}
          </p>
        ) : null}
        {typeof q.coverImageUrl === "string" && q.coverImageUrl.trim() !== "" ? (
          <div className="kh-host-click-preview" style={{ maxWidth: 260 }}>
            <img src={q.coverImageUrl} alt="" />
          </div>
        ) : null}
        {typeof q.audioUrl === "string" && q.audioUrl.trim() !== "" ? (
          <audio controls preload="metadata" style={{ width: "100%", marginBottom: "0.65rem" }}>
            <source src={q.audioUrl} />
          </audio>
        ) : (
          <p className="kh-host-hint">Add an audio clip URL to play this round.</p>
        )}
        <ul className="kh-host-options">
          {opts.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      </>
    );
  }
  if (t === "slider" && showCorrect && reveal) {
    return (
      <>
        <p className="kh-reveal-line">
          Correct: {String(reveal.correctValue)} (±{String(reveal.tolerance ?? 0)})
        </p>
        {expl ? <RevealExplanation text={expl} /> : null}
      </>
    );
  }
  if (t === "click_location" && q.imageUrl && showCorrect && reveal?.correctRegion) {
    const r = reveal.correctRegion as { x: number; y: number; radius?: number };
    const rad = r.radius ?? 0.08;
    return (
      <>
        <div className="kh-host-click-preview">
          <img src={String(q.imageUrl)} alt="" />
          <div
            className="kh-host-hotspot"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${rad * 200}%`,
              height: `${rad * 200}%`,
              transform: "translate(-50%, -50%)",
            }}
          />
        </div>
        {expl ? <RevealExplanation text={expl} /> : null}
      </>
    );
  }
  if (t === "order" && showCorrect && reveal && Array.isArray(reveal.correctOrder)) {
    const labels = Array.isArray(reveal.items)
      ? (reveal.items as string[])
      : (q.items as { id: number; text: string }[]).map((it) => (typeof it === "string" ? it : it?.text));
    const ord = reveal.correctOrder as number[];
    const text = ord.map((i) => labels[i]).filter(Boolean).join(" → ");
    return (
      <>
        <p className="kh-reveal-line">Correct order: {text}</p>
        {expl ? <RevealExplanation text={expl} /> : null}
      </>
    );
  }
  if (t === "match" && showCorrect && reveal && Array.isArray(reveal.matchLines)) {
    const lines = reveal.matchLines as string[];
    return (
      <>
        <p className="kh-reveal-line">Correct pairs: {lines.join(" · ")}</p>
        {expl ? <RevealExplanation text={expl} /> : null}
      </>
    );
  }
  if (t === "odd_color_out" && Array.isArray(q.swatches)) {
    const swatches = q.swatches as { index: number; color: string }[];
    if (showCorrect && reveal && typeof reveal.correctIndex === "number") {
      const ci = reveal.correctIndex as number;
      return (
        <>
          <p className="kh-reveal-line">
            Different color: square {ci + 1} of 4 ({String(reveal.baseColor)} vs {String(reveal.oddColor)})
          </p>
          <div className="kh-host-odd-preview">
            {swatches.map((s) => (
              <div
                key={s.index}
                className={"kh-host-odd-preview-cell" + (s.index === ci ? " is-target" : "")}
                style={{ backgroundColor: s.color }}
              />
            ))}
          </div>
          {expl ? <RevealExplanation text={expl} /> : null}
        </>
      );
    }
    return (
      <div className="kh-host-odd-preview">
        {swatches.map((s) => (
          <div key={s.index} className="kh-host-odd-preview-cell" style={{ backgroundColor: s.color }} />
        ))}
      </div>
    );
  }
  if (
    t === "match" &&
    Array.isArray(q.left) &&
    Array.isArray(q.right) &&
    !showCorrect
  ) {
    const left = q.left as { id: number; text: string; imageUrl?: string }[];
    const right = q.right as { id: number; text: string; imageUrl?: string }[];
    return (
      <div className="kh-host-match-cols">
        <div>
          <p style={{ fontWeight: 700, margin: "0 0 0.5rem" }}>Left</p>
          <ul className="kh-host-options kh-host-match-list">
            {left.map((c) => (
              <li key={c.id}>
                {c.imageUrl ? <img src={c.imageUrl} alt="" className="kh-host-match-thumb" /> : null}
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p style={{ fontWeight: 700, margin: "0 0 0.5rem" }}>Right</p>
          <ul className="kh-host-options kh-host-match-list">
            {right.map((c) => (
              <li key={c.id}>
                {c.imageUrl ? <img src={c.imageUrl} alt="" className="kh-host-match-thumb" /> : null}
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  if (t === "multiple_choice") {
    const opts = normalizeMcOptions(q);
    return (
      <ul className="kh-host-options">
        {opts.map((o, i) => (
          <li key={i}>{o}</li>
        ))}
      </ul>
    );
  }
  return null;
}
