import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import NavHome from "../components/NavHome";
import QuestionPlayer, {
  normalizeMcDisplayOptions,
  type PlayerAnswer,
} from "../components/QuestionPlayer";
import { getSocket } from "../socket";
import { playCorrect, playSubmit, playWrong, playYouJoined, resumeSounds } from "../sounds";
import { camootLog, camootWarn } from "../log";
import type { GameState } from "../types";

function formatPlayerAnswerForReveal(
  q: Record<string, unknown> | null | undefined,
  answer: PlayerAnswer,
): string | null {
  if (!q) return null;
  const t = String((q as { type: string }).type);
  if (t === "multiple_choice") {
    const opts = normalizeMcDisplayOptions(q);
    const ids = Array.isArray(answer) ? answer : [answer as number];
    if (!ids.every((x) => typeof x === "number" && !Number.isNaN(x))) return null;
    const texts = ids
      .map((id) => opts.find((o) => o.id === id)?.text)
      .filter((x): x is string => Boolean(x));
    return texts.length ? texts.join(", ") : null;
  }
  if (t === "slider" && typeof answer === "number") return String(answer);
  if (t === "odd_color_out" && typeof answer === "number")
    return `Square ${answer + 1}`;
  if (
    t === "click_location" &&
    typeof answer === "object" &&
    answer !== null &&
    "x" in answer &&
    "y" in answer
  ) {
    const pt = answer as { x: number; y: number };
    return `(${Math.round(pt.x * 100) / 100}, ${Math.round(pt.y * 100) / 100})`;
  }
  if (t === "order" && Array.isArray(answer)) {
    const items = (q as { items?: { id: number; text: string }[] }).items;
    if (!Array.isArray(items)) return null;
    const byId = new Map(items.map((it) => [it.id, it.text]));
    const texts = (answer as number[]).map((id) => byId.get(id)).filter((x): x is string => Boolean(x));
    return texts.length ? texts.join(" → ") : null;
  }
  if (
    t === "match" &&
    typeof answer === "object" &&
    answer !== null &&
    "matchByLeft" in answer
  ) {
    const m = answer as { matchByLeft: number[] };
    if (!Array.isArray(m.matchByLeft)) return null;
    const left = (q as { left?: { text: string }[] }).left;
    const right = (q as { right?: { text: string }[] }).right;
    if (!Array.isArray(left) || !Array.isArray(right)) return null;
    const parts = m.matchByLeft
      .map((rid, li) => {
        const lt = left[li]?.text;
        const rt = right[rid]?.text;
        if (lt && rt) return `${lt} ↔ ${rt}`;
        return null;
      })
      .filter((x): x is string => Boolean(x));
    return parts.length ? parts.join(" · ") : null;
  }
  return null;
}

const PLAYER_KEY = "camoot_player";

type StoredPlayer = { playerId: string; pin: string; username: string };

function loadStoredSession(): StoredPlayer | null {
  try {
    const raw = sessionStorage.getItem(PLAYER_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<StoredPlayer>;
    if (j.playerId && j.pin) {
      return {
        playerId: j.playerId,
        pin: j.pin,
        username: typeof j.username === "string" ? j.username : "Player",
      };
    }
    return null;
  } catch {
    return null;
  }
}

function normalizePin(p: string) {
  return p.replace(/\D/g, "").slice(0, 6);
}

export default function Play() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const pinParam = search.get("pin") || "";

  const [pin, setPin] = useState(() => {
    const fromUrl = normalizePin(pinParam);
    if (fromUrl.length === 6) return fromUrl;
    return normalizePin(loadStoredSession()?.pin || "");
  });
  const [username, setUsername] = useState(() => loadStoredSession()?.username || "");
  const [joined, setJoined] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [answered, setAnswered] = useState(false);
  const [lastPoints, setLastPoints] = useState<number | null>(null);
  const [lastPenalty, setLastPenalty] = useState<number | null>(null);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [lastAnswerSummary, setLastAnswerSummary] = useState<string | null>(null);
  const revealSoundPlayedForKeyRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const pendingNameRef = useRef("");

  useEffect(() => {
    camootLog("play", "mount", {
      href: window.location.href,
      pinFromUrl: pinParam || "(none)",
      pinField: pin,
    });
  }, [pinParam, pin]);

  useEffect(() => {
    const s = getSocket();
    const onConnect = () => camootLog("play", "socket connect", { id: s.id });
    const onConnectErr = (err: Error) =>
      camootWarn("play", "socket connect_error", err?.message || String(err));
    s.on("connect", onConnect);
    s.on("connect_error", onConnectErr);
    return () => {
      s.off("connect", onConnect);
      s.off("connect_error", onConnectErr);
    };
  }, []);

  useEffect(() => {
    const s = getSocket();
    const onState = (st: GameState) => {
      camootLog("play", "state", {
        phase: st.phase,
        pin: st.pin,
        questionIndex: st.questionIndex,
        playerCount: st.players.length,
        hasQuestion: !!st.question,
      });
      setState(st);
      const stored = loadStoredSession();
      if (
        stored?.playerId &&
        normalizePin(stored.pin) === st.pin &&
        st.players.some((p) => p.id === stored.playerId)
      ) {
        setPlayerId(stored.playerId);
        setJoined(true);
        setReconnecting(false);
      }
      if (st.phase === "question") {
        setAnswered(false);
        setLastPoints(null);
        setLastPenalty(null);
        setLastCorrect(null);
        setLastAnswerSummary(null);
        revealSoundPlayedForKeyRef.current = null;
      }
    };
    const onJoined = (p: { playerId: string; pin: string }) => {
      camootLog("play", "joined", p);
      playYouJoined();
      setPlayerId(p.playerId);
      setJoined(true);
      setReconnecting(false);
      const name =
        pendingNameRef.current.trim() ||
        loadStoredSession()?.username ||
        "Player";
      sessionStorage.setItem(
        PLAYER_KEY,
        JSON.stringify({
          playerId: p.playerId,
          pin: p.pin,
          username: name.trim() || "Player",
        })
      );
    };
    const onErr = (e: { message?: string }) => {
      camootWarn("play", "server error event", e);
      setError(e.message || "Error");
      setReconnecting(false);
    };
    const onResult = (r: { points: number; correct: boolean; penalty?: number }) => {
      camootLog("play", "answer_result", r);
      setAnswered(true);
      setLastCorrect(r.correct);
      if (r.correct) {
        setLastPoints(r.points);
        setLastPenalty(null);
      } else {
        setLastPoints(null);
        setLastPenalty(typeof r.penalty === "number" && r.penalty > 0 ? r.penalty : null);
      }
    };
    const onSessionEnded = (e: { message?: string }) => {
      camootLog("play", "session_ended", e);
      setState(null);
      setJoined(false);
      setPlayerId(null);
      setAnswered(false);
      sessionStorage.removeItem(PLAYER_KEY);
      setError(e?.message || "Session ended.");
      setReconnecting(false);
    };
    const onKicked = (_e: { message?: string }) => {
      camootWarn("play", "kicked", _e);
      setState(null);
      setJoined(false);
      setPlayerId(null);
      setAnswered(false);
      sessionStorage.removeItem(PLAYER_KEY);
      setError(null);
      setReconnecting(false);
      navigate("/", { replace: true });
    };

    s.on("state", onState);
    s.on("joined", onJoined);
    s.on("error", onErr);
    s.on("answer_result", onResult);
    s.on("session_ended", onSessionEnded);
    s.on("kicked", onKicked);
    return () => {
      s.off("state", onState);
      s.off("joined", onJoined);
      s.off("error", onErr);
      s.off("answer_result", onResult);
      s.off("session_ended", onSessionEnded);
      s.off("kicked", onKicked);
    };
  }, [navigate]);

  useEffect(() => {
    if (!state || state.phase !== "reveal") return;
    if (!answered) return;
    if (lastCorrect !== true && lastCorrect !== false) return;
    const key = `${state.pin}-${state.questionIndex}`;
    if (revealSoundPlayedForKeyRef.current === key) return;
    revealSoundPlayedForKeyRef.current = key;
    resumeSounds();
    if (lastCorrect) playCorrect();
    else playWrong();
  }, [state?.phase, state?.pin, state?.questionIndex, answered, lastCorrect, state]);

  useEffect(() => {
    const s = getSocket();
    const tryRejoin = () => {
      const clean = normalizePin(pin);
      if (clean.length !== 6) return;
      const st = loadStoredSession();
      if (!st?.playerId || normalizePin(st.pin) !== clean) return;
      setReconnecting(true);
      setError(null);
      s.emit("player_join", {
        pin: clean,
        username: st.username || "Player",
        playerId: st.playerId,
      });
    };
    const onConnect = () => tryRejoin();
    s.on("connect", onConnect);
    if (s.connected) tryRejoin();
    return () => {
      s.off("connect", onConnect);
    };
  }, [pin]);

  const clearSavedPlayer = () => {
    sessionStorage.removeItem(PLAYER_KEY);
    setReconnecting(false);
    setJoined(false);
    setPlayerId(null);
    setState(null);
    setError(null);
  };

  const submitJoin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const clean = normalizePin(pin);
    if (clean.length !== 6) {
      setError("Enter a 6-digit game PIN.");
      return;
    }
    const name = username.trim() || "Player";
    pendingNameRef.current = name;
    resumeSounds();
    playSubmit();
    const s = getSocket();
    const stored = loadStoredSession();
    const sameSession = stored && normalizePin(stored.pin) === clean && stored.playerId;
    camootLog("play", "emit player_join", {
      pin: clean,
      username: name,
      reusingPlayerId: !!sameSession,
    });
    s.emit("player_join", {
      pin: clean,
      username: name,
      playerId: sameSession ? stored!.playerId : undefined,
    });
  };

  const onAnswer = useCallback(
    (answer: PlayerAnswer) => {
      if (!state || state.phase !== "question" || answered) return;
      setLastAnswerSummary(formatPlayerAnswerForReveal(state.question, answer));
      const s = getSocket();
      s.emit("player_answer", {
        answer,
        questionIndex: state.questionIndex,
        clientTime: Date.now(),
      });
    },
    [state, answered]
  );

  const rank = useMemo(() => {
    if (!state || !playerId) return null;
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    const idx = sorted.findIndex((p) => p.id === playerId);
    return idx >= 0 ? idx + 1 : null;
  }, [state, playerId]);

  if (!joined || !state) {
    return (
      <div className="kh-page kh-page-play-join">
        <div className="kh-page-narrow-sm">
          <div className="kh-nav-home-wrap">
            <NavHome label="Back to home" />
          </div>
          <div
            className="kh-card"
            style={{
              background: "rgba(255, 255, 255, 0.98)",
              color: "#1a1a1a",
              boxShadow:
                "0 12px 40px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.12) inset",
            }}
          >
          <h1 style={{ marginTop: 0, color: "var(--camoot-purple)" }}>Join game</h1>
          {reconnecting && (
            <p style={{ fontWeight: 600, color: "var(--camoot-blue)" }}>Reconnecting…</p>
          )}
          {error && (
            <p style={{ color: "var(--camoot-pink)", fontWeight: 600 }}>{error}</p>
          )}
          <form onSubmit={submitJoin}>
            <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600 }}>Game PIN</label>
            <input
              className="kh-input"
              value={pin}
              onChange={(e) => setPin(normalizePin(e.target.value))}
              placeholder="123456"
              inputMode="numeric"
              style={{ marginBottom: "1rem" }}
            />
            <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600 }}>Nickname</label>
            <input
              className="kh-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Your name"
              maxLength={24}
              style={{ marginBottom: "1rem" }}
            />
            <button
              type="submit"
              className="kh-btn kh-btn-primary kh-btn-block"
              disabled={reconnecting}
            >
              Enter
            </button>
          </form>
          <p style={{ marginTop: "1rem", textAlign: "center", fontSize: "0.9rem" }}>
            <button
              type="button"
              className="kh-btn kh-btn-outline kh-btn-sm kh-btn-block"
              onClick={clearSavedPlayer}
            >
              Forget saved player (use another name)
            </button>
          </p>
        </div>
        </div>
      </div>
    );
  }

  if (state.phase === "lobby") {
    return (
      <div className="kh-page kh-page-play-lobby">
        <div className="kh-lobby">
          <p className="kh-lobby-you">You’re in, {state.players.find((p) => p.id === playerId)?.name || "player"}!</p>
          <h2 className="kh-lobby-wait">See your name on the shared screen?</h2>
          <p className="kh-lobby-sub">Game PIN: {state.pin}</p>
          <ul className="kh-player-chips">
            {state.players.map((p) => (
              <li key={p.id} className={p.id === playerId ? "is-me" : ""}>
                {p.name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (state.phase === "ended") {
    const me = state.players.find((p) => p.id === playerId);
    return (
      <div className="kh-page">
        <div className="kh-card" style={{ textAlign: "center" }}>
          <h1 style={{ color: "var(--camoot-purple)" }}>Podium</h1>
          <p style={{ fontSize: "1.5rem", fontWeight: 800 }}>{state.quizTitle}</p>
          <p>
            Your score: <strong>{me?.score ?? 0}</strong>
            {rank && ` · Rank #${rank}`}
          </p>
          <ol className="kh-podium">
            {[...state.players]
              .sort((a, b) => b.score - a.score)
              .slice(0, 5)
              .map((p, i) => (
                <li key={p.id}>
                  {i + 1}. {p.name} · {p.score}
                </li>
              ))}
          </ol>
          <div className="kh-nav-home-wrap is-center" style={{ marginTop: "1.25rem" }}>
            <NavHome />
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === "reveal") {
    const r = state.reveal as Record<string, unknown> | undefined;
    const q = state.question;
    const labels = Array.isArray(r?.correctLabels) ? (r.correctLabels as string[]) : [];
    const me = state.players.find((p) => p.id === playerId);
    return (
      <div className="kh-page kh-page-play-reveal">
        <div className="kh-reveal-player">
          <h2>Answer reveal</h2>
          {answered && lastCorrect === true && (
            <p className="kh-reveal-verdict is-right">You got it right</p>
          )}
          {answered && lastCorrect === false && (
            <p className="kh-reveal-verdict is-wrong">Not quite</p>
          )}
          {!answered && (
            <p className="kh-reveal-verdict is-missed">You didn’t submit an answer</p>
          )}
          {lastAnswerSummary && (
            <p className="kh-reveal-your-answer">Your answer: {lastAnswerSummary}</p>
          )}
          {q?.type === "multiple_choice" &&
            typeof (q as { imageUrl?: string }).imageUrl === "string" &&
            (q as { imageUrl: string }).imageUrl.trim() !== "" && (
              <div className="kh-reveal-mc-figure">
                <img
                  src={(q as { imageUrl: string }).imageUrl}
                  alt=""
                  className="kh-reveal-qimage"
                  decoding="async"
                />
              </div>
            )}
          {lastPoints !== null && lastPoints > 0 && (
            <p className="kh-points-burst">+{lastPoints} points</p>
          )}
          {lastPenalty !== null && lastPenalty > 0 && (
            <p className="kh-penalty-burst">−{lastPenalty} points</p>
          )}
          {q?.type === "multiple_choice" && r && labels.length > 0 && (
            <p className="kh-reveal-correct">
              Correct: {labels.join(" · ")}
            </p>
          )}
          {q?.type === "multiple_choice" && r && labels.length === 0 && Array.isArray(r.correctIndices) && (r.correctIndices as number[]).length > 0 && (
            <p>
              Correct:{" "}
              {(r.correctIndices as number[])
                .map((i) => `option ${i + 1}`)
                .join(", ")}
            </p>
          )}
          {q?.type === "multiple_choice" && r && typeof r.correctIndex === "number" && !(r.correctIndices as number[] | undefined)?.length && (
            <p>Correct: option {(r.correctIndex as number) + 1}</p>
          )}
          {q?.type === "slider" && r && (
            <p>Correct value: {String(r.correctValue)}</p>
          )}
          {q?.type === "order" && r && Array.isArray(r.correctOrder) && (
            <p>
              Correct order:{" "}
              {(() => {
                const ord = r.correctOrder as number[];
                const raw = r.items as string[] | undefined;
                const fromQ = (q as { items?: unknown }).items;
                const row: string[] = Array.isArray(raw)
                  ? raw
                  : Array.isArray(fromQ)
                    ? (fromQ as { id: number; text: string }[]).map((it) =>
                        typeof it === "string" ? it : String(it?.text ?? "")
                      )
                    : [];
                return ord.map((i) => row[i]).filter(Boolean).join(" → ") || "(none)";
              })()}
            </p>
          )}
          {q?.type === "click_location" && <p>Target area shown on host screen.</p>}
          {q?.type === "match" && r && Array.isArray(r.matchLines) && (r.matchLines as string[]).length > 0 && (
            <p className="kh-reveal-correct">
              Correct pairs: {(r.matchLines as string[]).join(" · ")}
            </p>
          )}
          {q?.type === "odd_color_out" && r && typeof r.correctIndex === "number" && (r.correctIndex as number) >= 0 && (
            <p className="kh-reveal-correct">
              The different color was square {(r.correctIndex as number) + 1}.
            </p>
          )}
          {typeof r?.explanation === "string" && r.explanation.trim() !== "" ? (
            <div className="kh-reveal-explanation">
              <strong>Why?</strong>
              <p>{r.explanation}</p>
            </div>
          ) : null}
          <h3 className="kh-lb-title" style={{ margin: "1.35rem 0 0.35rem" }}>
            Leaderboard
          </h3>
          <p className="kh-lb-me" style={{ marginTop: 0 }}>
            {me?.name}: {me?.score ?? 0} pts
          </p>
          <ol className="kh-lb-list">
            {[...state.players]
              .sort((a, b) => b.score - a.score)
              .map((p, i) => (
                <li key={p.id} className={p.id === playerId ? "is-me" : ""}>
                  <span>{i + 1}</span>
                  <span>{p.name}</span>
                  <span>{p.score}</span>
                </li>
              ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="kh-page">
      <div className="kh-play-top">
        <span className="kh-play-score">
          {state.players.find((p) => p.id === playerId)?.score ?? 0} pts
        </span>
      </div>
      <QuestionPlayer state={state} disabled={answered} onSubmit={onAnswer} />
      {answered && (
        <p className="kh-wait-ans">Answer locked in…</p>
      )}
    </div>
  );
}
