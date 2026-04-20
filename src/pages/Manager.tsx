import { useCallback, useEffect, useRef, useState } from "react";
import NavHome from "../components/NavHome";
import * as api from "../api";
import {
  playPickQuiz,
  playSaved,
  playTap,
  playUnlockOk,
  resumeSounds,
} from "../sounds";
import type { MatchPair, McOption, Quiz, QuizQuestion } from "../types";

function getMcRows(options: (string | McOption)[]): McOption[] {
  return options.map((raw) => {
    if (typeof raw === "string") return { text: raw };
    const o = raw as McOption & { wrongPickPenalty?: number };
    const legacyTrap = o.wrongPickPenalty != null && o.wrongPickPenalty > 0;
    return {
      text: String(o.text ?? ""),
      penalizeIfWrong: !!o.penalizeIfWrong || legacyTrap,
    };
  });
}

function serializeMcOptions(rows: McOption[]): (string | McOption)[] {
  return rows.map((m) => {
    if (m.penalizeIfWrong) return { text: m.text, penalizeIfWrong: true };
    return m.text;
  });
}

/** Same normalization as player taps (`QuestionPlayer` click_location). */
function normalizedPointOnImage(
  img: HTMLImageElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const rect = img.getBoundingClientRect();
  const rw = rect.width;
  const rh = rect.height;
  if (rw <= 0 || rh <= 0) return null;
  const x = Math.min(1, Math.max(0, (clientX - rect.left) / rw));
  const y = Math.min(1, Math.max(0, (clientY - rect.top) / rh));
  return { x, y };
}

const TOKEN_KEY = "camoot_manager_token";
/** Same key as Host page: set when starting live from Create so Host opens the lobby without a second login. */
const HOST_MGR_TOKEN = "camoot_host_mgr_token";
const HOST_SESSION = "camoot_host_session";

const QUESTION_KIND: Record<QuizQuestion["type"], { label: string; tooltip: string }> = {
  multiple_choice: {
    label: "Choice",
    tooltip:
      "Multiple choice: players pick one or more answers from the options you list (correct answers can be marked as traps with a penalty).",
  },
  music: {
    label: "Music",
    tooltip:
      "Music clip: host plays an uploaded audio sample, players pick from options. You can hide artist/title for guessing rounds.",
  },
  slider: {
    label: "Slider",
    tooltip: "Numeric slider: players drag to a value between your min and max; you set the correct value and optional tolerance.",
  },
  click_location: {
    label: "Click",
    tooltip:
      "Image tap: players tap the picture where you placed the target. Click the preview image to set the spot and adjust the circle size for how precise they must be.",
  },
  order: {
    label: "Order",
    tooltip: "Ordering: players arrange items into the correct sequence by dragging.",
  },
  match: {
    label: "Connect",
    tooltip:
      "Connect pairs: each row is one correct match (e.g. picture on the left, name on the right). Players see both sides shuffled and tap a left item then its match on the right.",
  },
  odd_color_out: {
    label: "Odd color",
    tooltip:
      "Four squares: three share one color, one is different. Which block is odd is random each game. Tweak the two hex colors for easier or meaner difficulty.",
  },
};

const ADD_QUESTION_TYPES: QuizQuestion["type"][] = [
  "multiple_choice",
  "music",
  "slider",
  "click_location",
  "order",
  "match",
  "odd_color_out",
];

function AddQuestionToolbar({
  onAdd,
  style,
}: {
  onAdd: (type: QuizQuestion["type"]) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        flexWrap: "wrap",
        marginBottom: "1rem",
        ...style,
      }}
    >
      <span style={{ fontWeight: 700, alignSelf: "center" }}>Add question:</span>
      {ADD_QUESTION_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          className="kh-btn kh-btn-outline kh-btn-sm"
          title={QUESTION_KIND[type].tooltip}
          onClick={() => onAdd(type)}
        >
          {QUESTION_KIND[type].label}
        </button>
      ))}
    </div>
  );
}

function newId() {
  return crypto.randomUUID();
}

function hexToColorInput(hex: string): string {
  const s = (hex || "").trim();
  const full = s.match(/^#([0-9a-fA-F]{6})$/);
  if (full) return `#${full[1].toLowerCase()}`;
  const short = s.match(/^#([0-9a-fA-F]{3})$/);
  if (short) {
    const x = short[1];
    return `#${x[0]}${x[0]}${x[1]}${x[1]}${x[2]}${x[2]}`.toLowerCase();
  }
  return "#808080";
}

export default function Manager() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [quizzes, setQuizzes] = useState<{ id: string; title: string; questionCount: number }[]>([]);
  const [editing, setEditing] = useState<Quiz | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const list = await api.listQuizzes(token);
      setQuizzes(list);
      setLoadError(null);
    } catch {
      setLoadError("Session expired. Log in again.");
      setToken(null);
      sessionStorage.removeItem(TOKEN_KEY);
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      const t = await api.managerLogin(password);
      sessionStorage.setItem(TOKEN_KEY, t);
      setToken(t);
      setPassword("");
      resumeSounds();
      playUnlockOk();
    } catch {
      setLoginError("Wrong password.");
    }
  };

  const logout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(HOST_MGR_TOKEN);
    setToken(null);
    setEditing(null);
  };

  const create = async () => {
    if (!token) return;
    resumeSounds();
    playTap();
    const q = await api.createQuiz(token, "New quiz");
    await refresh();
    const full = await api.getQuiz(token, q.id);
    setEditing(full);
  };

  const openEdit = async (id: string) => {
    if (!token) return;
    resumeSounds();
    playTap();
    const full = await api.getQuiz(token, id);
    setEditing(full);
  };

  const saveEditing = async () => {
    if (!token || !editing) return;
    await api.saveQuiz(token, editing);
    playSaved();
    await refresh();
  };

  const remove = async (id: string) => {
    if (!token || !confirm("Delete this quiz?")) return;
    await api.deleteQuiz(token, id);
    if (editing?.id === id) setEditing(null);
    await refresh();
  };

  const hostLive = async (quizId: string) => {
    if (!token) return;
    try {
      const g = await api.createGame(token, quizId);
      resumeSounds();
      playPickQuiz();
      sessionStorage.setItem(
        HOST_SESSION,
        JSON.stringify({ pin: g.pin, hostToken: g.hostToken, quizTitle: g.quizTitle }),
      );
      sessionStorage.setItem(HOST_MGR_TOKEN, token);
      window.location.href = "/host";
    } catch {
      alert("Could not create game.");
    }
  };

  if (!token) {
    return (
      <div className="kh-page">
        <div className="kh-page-narrow-sm">
          <div className="kh-nav-home-wrap">
            <NavHome label="Back to home" />
          </div>
          <div className="kh-card">
            <h1 style={{ marginTop: 0, color: "var(--camoot-purple)" }}>Create</h1>
            <p>Same password as <strong>Host</strong>. Build and edit quizzes here.</p>
            {loginError && <p style={{ color: "var(--camoot-pink)", fontWeight: 600 }}>{loginError}</p>}
            <form onSubmit={login}>
              <input
                type="password"
                className="kh-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                style={{ marginBottom: "1rem" }}
              />
            <button type="submit" className="kh-btn kh-btn-primary kh-btn-block">
              Unlock
            </button>
            </form>
            <p style={{ fontSize: "0.9rem", color: "#666", marginTop: "1.25rem" }}>
              Set <code>MANAGER_PASSWORD</code> in production (default <code>camoot123</code>).
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="kh-page">
        <div className="kh-page-narrow kh-page-editor-quiz">
          <div className="kh-editor-nav-row">
            <button
              type="button"
              className="kh-btn kh-btn-outline kh-btn-sm"
              onClick={() => setEditing(null)}
            >
              ← Back to list
            </button>
          </div>
          <QuizEditor quiz={editing} token={token} onChange={setEditing} onSave={saveEditing} />
        </div>
      </div>
    );
  }

  return (
    <div className="kh-page">
      <div className="kh-page-narrow" style={{ maxWidth: 800 }}>
        <div className="kh-nav-home-wrap">
          <NavHome label="Back to home" />
        </div>
        <div className="kh-card" style={{ maxWidth: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <h1 style={{ margin: 0, color: "var(--camoot-purple)" }}>Your quizzes</h1>
          <button type="button" className="kh-btn kh-btn-outline kh-btn-sm" onClick={logout}>
            Log out
          </button>
        </div>
        {loadError && <p style={{ color: "var(--camoot-pink)" }}>{loadError}</p>}
        <div style={{ margin: "1rem 0", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="kh-btn kh-btn-primary" onClick={create}>
            New quiz
          </button>
        </div>
        <ul className="kh-mgr-list">
          {quizzes.map((q) => (
            <li key={q.id}>
              <div className="kh-mgr-row-main">
                <strong>{q.title}</strong>
                <span className="kh-mgr-row-meta">
                  {q.questionCount} questions · <code>{q.id}</code>
                </span>
              </div>
              <div className="kh-mgr-row-actions">
                <button type="button" className="kh-btn kh-btn-outline kh-btn-sm" onClick={() => openEdit(q.id)}>
                  Edit
                </button>
                <button type="button" className="kh-btn kh-btn-success kh-btn-sm" onClick={() => hostLive(q.id)}>
                  Host live
                </button>
                <button type="button" className="kh-btn kh-btn-danger kh-btn-sm" onClick={() => remove(q.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
        </div>
      </div>
    </div>
  );
}

function QuizEditor({
  quiz,
  token,
  onChange,
  onSave,
}: {
  quiz: Quiz;
  token: string;
  onChange: (q: Quiz) => void;
  onSave: () => void | Promise<void>;
}) {
  const updateQuestion = (index: number, patch: Partial<QuizQuestion>) => {
    const questions = [...quiz.questions];
    questions[index] = { ...questions[index], ...patch } as QuizQuestion;
    onChange({ ...quiz, questions });
  };

  const makeNewQuestion = (type: QuizQuestion["type"]): QuizQuestion => {
    const base = { id: newId(), timeLimitSec: 20, points: 1000 };

    if (type === "multiple_choice") {
      return {
        ...base,
        type: "multiple_choice",
        question: "New question",
        options: ["A", "B", "C", "D"],
        correctIndices: [0],
        shuffleOptions: true,
      };
    }
    if (type === "slider") {
      return {
        ...base,
        type: "slider",
        question: "Slide to the answer",
        min: 0,
        max: 100,
        step: 1,
        correctValue: 50,
        tolerance: 0,
      };
    }
    if (type === "music") {
      return {
        ...base,
        type: "music",
        question: "Who is this song by?",
        audioUrl: "",
        coverImageUrl: "https://picsum.photos/seed/musiccover/420/420",
        artist: "Unknown Artist",
        title: "Unknown Track",
        trackNumber: 1,
        showArtist: false,
        showTitle: false,
        showCoverArt: true,
        options: ["Artist A", "Artist B", "Artist C", "Artist D"],
        correctIndex: 0,
      };
    }
    if (type === "click_location") {
      return {
        ...base,
        type: "click_location",
        question: "Click the correct location",
        imageUrl: "https://picsum.photos/800/500",
        correctRegion: { x: 0.5, y: 0.5, radius: 0.12 },
      };
    }
    if (type === "odd_color_out") {
      return {
        ...base,
        type: "odd_color_out",
        question: "Which square is a different color?",
        baseColor: "#0D47A1",
        oddColor: "#64B5F6",
        explanation: "Three deep blue squares, one lighter blue. Still tricky for some color vision, but obvious if you see blue levels well.",
      };
    }
    if (type === "match") {
      const demoPairs: MatchPair[] = [
        {
          left: { text: "Nurse", imageUrl: "https://picsum.photos/seed/nurse180/200/200" },
          right: { text: "Hospital care" },
        },
        {
          left: { text: "Engineer", imageUrl: "https://picsum.photos/seed/engineer180/200/200" },
          right: { text: "Builds systems" },
        },
        {
          left: { text: "Banker", imageUrl: "https://picsum.photos/seed/banker180/200/200" },
          right: { text: "Works with finance" },
        },
      ];
      return {
        ...base,
        type: "match",
        question: "Match each picture to the correct label",
        pairs: demoPairs,
      };
    }
    const orderItems = ["First", "Second", "Third"];
    const correctOrder = orderItems.map((_, i) => i);
    return {
      ...base,
      type: "order",
      question: "Put items in the right order",
      items: orderItems,
      correctOrder,
    };
  };

  const addQuestion = (type: QuizQuestion["type"]) => {
    onChange({ ...quiz, questions: [...quiz.questions, makeNewQuestion(type)] });
  };

  const removeQuestion = (index: number) => {
    const questions = quiz.questions.filter((_, i) => i !== index);
    onChange({ ...quiz, questions });
  };

  const moveQuestion = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= quiz.questions.length) return;
    const questions = [...quiz.questions];
    [questions[index], questions[j]] = [questions[j], questions[index]];
    onChange({ ...quiz, questions });
  };

  /** `bottomOnly` at page top, `topOnly` at page bottom, `both` in between. */
  const [editorScrollRail, setEditorScrollRail] = useState<
    "none" | "bottomOnly" | "topOnly" | "both"
  >("none");

  useEffect(() => {
    const EDGE = 132;
    const update = () => {
      const doc = document.documentElement;
      const sh = doc.scrollHeight;
      const vh = window.innerHeight;
      if (sh <= vh + 56) {
        setEditorScrollRail("none");
        return;
      }
      const y = window.scrollY;
      const distBottom = sh - y - vh;
      const nearTop = y < EDGE;
      const nearBottom = distBottom < EDGE;
      if (nearTop && !nearBottom) setEditorScrollRail("bottomOnly");
      else if (nearBottom && !nearTop) setEditorScrollRail("topOnly");
      else setEditorScrollRail("both");
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const t = window.setTimeout(update, 100);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.clearTimeout(t);
    };
  }, [quiz.questions.length, quiz.title]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  };

  const scrollToBottom = () => {
    const doc = document.documentElement;
    const body = document.body;
    const h = Math.max(doc.scrollHeight, body.scrollHeight, doc.offsetHeight, body.offsetHeight);
    const maxTop = Math.max(0, h - window.innerHeight);
    window.scrollTo({ top: maxTop, left: 0, behavior: "smooth" });
  };

  const showJumpTop = editorScrollRail === "topOnly" || editorScrollRail === "both";
  const showJumpBottom = editorScrollRail === "bottomOnly" || editorScrollRail === "both";

  return (
    <>
      <div className="kh-card" style={{ maxWidth: 900 }}>
        <label style={{ fontWeight: 700, display: "block" }}>Quiz title</label>
        <input
          className="kh-input"
          value={quiz.title}
          onChange={(e) => onChange({ ...quiz, title: e.target.value })}
          style={{ marginBottom: "1rem" }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.5rem",
            marginBottom: "1rem",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          <input
            type="checkbox"
            checked={!!quiz.shuffleQuestionOrder}
            onChange={(e) =>
              onChange({
                ...quiz,
                shuffleQuestionOrder: e.target.checked ? true : undefined,
              })
            }
            style={{ marginTop: "0.2rem" }}
          />
          <span>
            Randomize question order for each game
            <span style={{ display: "block", fontSize: "0.88rem", color: "#555", fontWeight: 400 }}>
              When the host taps Start, questions are shuffled once for that session. Order in the editor is unchanged.
            </span>
          </span>
        </label>
        <p style={{ fontSize: "0.9rem", color: "#555", margin: "0 0 0.75rem" }}>
          New questions are added at the bottom. Use ↑ / ↓ on a card to reorder.
        </p>
        <AddQuestionToolbar onAdd={addQuestion} />
        {quiz.questions.map((question, index) => (
          <div key={question.id} className="kh-q-block">
            <div className="kh-q-head">
              <span className="kh-q-head-title">
                <span className="kh-q-head-num">Question {index + 1}</span>
                <span className="kh-q-type-badge" title={QUESTION_KIND[question.type].tooltip}>
                  {QUESTION_KIND[question.type].label}
                </span>
              </span>
              <span style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  className="kh-btn kh-btn-outline kh-btn-sm"
                  style={{ minWidth: "2.35rem" }}
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => moveQuestion(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="kh-btn kh-btn-outline kh-btn-sm"
                  style={{ minWidth: "2.35rem" }}
                  title="Move down"
                  disabled={index === quiz.questions.length - 1}
                  onClick={() => moveQuestion(index, 1)}
                >
                  ↓
                </button>
                <button type="button" className="kh-btn kh-btn-danger kh-btn-sm" onClick={() => removeQuestion(index)}>
                  Delete question
                </button>
              </span>
            </div>
            <QuestionFields question={question} token={token} onChange={(patch) => updateQuestion(index, patch)} />
          </div>
        ))}
        {quiz.questions.length > 0 ? (
          <AddQuestionToolbar
            onAdd={addQuestion}
            style={{ marginTop: "1.25rem", marginBottom: "0.75rem" }}
          />
        ) : null}
        <button type="button" className="kh-btn kh-btn-primary" onClick={() => onSave()}>
          Save quiz
        </button>
      </div>
      {editorScrollRail !== "none" && (
        <div className="kh-editor-jump-layer" aria-live="polite">
          {showJumpTop && (
            <button
              type="button"
              className="kh-btn kh-btn-outline kh-btn-sm kh-editor-jump kh-editor-jump-top"
              onClick={scrollToTop}
              title="Scroll to top of page"
            >
              Jump to top
            </button>
          )}
          {showJumpBottom && (
            <button
              type="button"
              className="kh-btn kh-btn-outline kh-btn-sm kh-editor-jump kh-editor-jump-bottom"
              onClick={scrollToBottom}
              title="Scroll to bottom of page"
            >
              Jump to bottom
            </button>
          )}
        </div>
      )}
    </>
  );
}

function ClickLocationTargetEditor({
  imageUrl,
  correctRegion,
  onRegionChange,
}: {
  imageUrl: string;
  correctRegion: { x: number; y: number; radius?: number };
  onRegionChange: (region: { x: number; y: number; radius?: number }) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const radius = correctRegion.radius ?? 0.12;

  const applyClientPoint = (clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return;
    const pt = normalizedPointOnImage(img, clientX, clientY);
    if (!pt) return;
    onRegionChange({ ...correctRegion, ...pt, radius });
  };

  return (
    <>
      <p style={{ fontSize: "0.88rem", color: "#555", margin: "0.5rem 0 0.75rem" }}>
        Click or tap the image to place the correct spot (same coordinates players use when they tap). The circle shows
        what counts as correct; widen or narrow it with the slider.
      </p>
      <div className="kh-mgr-click-loc-editor">
        <div className="kh-mgr-click-loc-frame">
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            className="kh-mgr-click-loc-img"
            draggable={false}
          />
          <svg
            className="kh-mgr-click-loc-svg"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden
          >
            <circle
              cx={correctRegion.x}
              cy={correctRegion.y}
              r={radius}
              fill="rgba(245, 196, 0, 0.35)"
              stroke="rgba(255, 255, 255, 0.95)"
              strokeWidth={0.006}
            />
          </svg>
          <div
            className="kh-mgr-click-loc-hit"
            role="application"
            tabIndex={0}
            aria-label="Click or tap on the image to set the correct tap target"
            onPointerDown={(e) => {
              if (e.pointerType === "mouse" && e.button !== 0) return;
              e.preventDefault();
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              applyClientPoint(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
              applyClientPoint(e.clientX, e.clientY);
            }}
            onPointerUp={(e) => {
              const el = e.currentTarget as HTMLDivElement;
              if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={(e) => {
              const el = e.currentTarget as HTMLDivElement;
              if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
            }}
          />
        </div>
      </div>
      <label style={{ display: "block", marginTop: "0.75rem", fontWeight: 600 }}>
        Tap tolerance (circle radius)
      </label>
      <input
        type="range"
        min={0.03}
        max={0.35}
        step={0.01}
        value={radius}
        onChange={(e) =>
          onRegionChange({
            ...correctRegion,
            radius: Number(e.target.value),
          })
        }
        className="kh-mgr-click-loc-radius"
        aria-valuemin={0.03}
        aria-valuemax={0.35}
      />
      <p style={{ fontSize: "0.82rem", color: "#666", margin: "0.25rem 0 0" }}>
        Center ({correctRegion.x.toFixed(2)}, {correctRegion.y.toFixed(2)}) · radius {radius.toFixed(2)} — same units as
        the game (0–1 across the image).
      </p>
    </>
  );
}

function QuestionFields({
  question,
  token,
  onChange,
}: {
  question: QuizQuestion;
  token: string;
  onChange: (patch: Partial<QuizQuestion>) => void;
}) {
  const [uploading, setUploading] = useState(false);

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await api.uploadImage(token, file);
      onChange({ imageUrl: url } as Partial<QuizQuestion>);
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };
  const uploadAudio = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await api.uploadAudio(token, file);
      onChange({ audioUrl: url } as Partial<QuizQuestion>);
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="kh-q-fields">
      <label>Prompt</label>
      <textarea
        className="kh-input"
        rows={2}
        value={question.question}
        onChange={(e) => onChange({ question: e.target.value } as Partial<QuizQuestion>)}
        style={{ marginBottom: "0.75rem" }}
      />
      <div className="kh-row">
        <label>Time (sec)</label>
        <input
          type="number"
          className="kh-input"
          value={question.timeLimitSec ?? 20}
          onChange={(e) => onChange({ timeLimitSec: Number(e.target.value) } as Partial<QuizQuestion>)}
        />
        <label>Max points</label>
        <input
          type="number"
          className="kh-input"
          value={question.points ?? 1000}
          onChange={(e) => onChange({ points: Number(e.target.value) } as Partial<QuizQuestion>)}
        />
      </div>

      <label>Explanation (optional, shown to everyone on the answer screen)</label>
      <textarea
        className="kh-input"
        rows={2}
        value={question.explanation ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange({ explanation: v.trim() === "" ? undefined : v } as Partial<QuizQuestion>);
        }}
        style={{ marginBottom: "0.75rem" }}
        placeholder="Short explanation after the reveal…"
      />
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.65rem",
          marginBottom: "0.85rem",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={!!question.anyAnswerCorrect}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? ({ anyAnswerCorrect: true, penaltyOnWrong: undefined, penaltyPoints: undefined } as Partial<QuizQuestion>)
                  : ({ anyAnswerCorrect: undefined } as Partial<QuizQuestion>)
              )
            }
          />
          Any answer is correct
        </label>
      </div>
      {question.type !== "multiple_choice" && !question.anyAnswerCorrect && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0.65rem",
            marginBottom: "0.85rem",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={!!question.penaltyOnWrong}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? ({ penaltyOnWrong: true, penaltyPoints: question.penaltyPoints ?? 200 } as Partial<QuizQuestion>)
                    : ({ penaltyOnWrong: undefined, penaltyPoints: undefined } as Partial<QuizQuestion>)
                )
              }
            />
            Subtract points when wrong (whole answer)
          </label>
          {question.penaltyOnWrong ? (
            <>
              <label style={{ marginLeft: "0.25rem" }}>Penalty</label>
              <input
                type="number"
                min={0}
                className="kh-input"
                style={{ maxWidth: "7rem" }}
                value={question.penaltyPoints ?? 0}
                onChange={(e) => onChange({ penaltyPoints: Number(e.target.value) } as Partial<QuizQuestion>)}
              />
            </>
          ) : null}
        </div>
      )}

      {question.type === "multiple_choice" && (
        <>
          <label style={{ display: "block", marginTop: "0.25rem", fontWeight: 600 }}>
            Question image (optional)
          </label>
          <p style={{ fontSize: "0.85rem", color: "#666", margin: "0 0 0.5rem" }}>
            Shown on host and player screens above the choices (e.g. photo for “Who has this job?”).
          </p>
          <input
            className="kh-input"
            value={question.imageUrl ?? ""}
            onChange={(e) =>
              onChange({
                imageUrl: e.target.value.trim() === "" ? undefined : e.target.value.trim(),
              } as Partial<QuizQuestion>)
            }
            placeholder="/uploads/… or https://…"
            style={{ marginBottom: "0.5rem" }}
          />
          <input
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadImage(f);
            }}
            style={{ marginBottom: "0.5rem" }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginBottom: "0.85rem" }}>
            {question.imageUrl ? (
              <img
                src={question.imageUrl}
                alt=""
                style={{ maxHeight: 140, maxWidth: "100%", borderRadius: 10, border: "1px solid #ddd" }}
              />
            ) : null}
            {question.imageUrl ? (
              <button
                type="button"
                className="kh-btn kh-btn-outline kh-btn-sm"
                onClick={() => onChange({ imageUrl: undefined } as Partial<QuizQuestion>)}
              >
                Remove image
              </button>
            ) : null}
          </div>
          <McEditor q={question} onChange={onChange} />
        </>
      )}
      {question.type === "music" && (
        <>
          <label style={{ display: "block", marginTop: "0.25rem", fontWeight: 600 }}>
            Audio clip (host playback only)
          </label>
          <input
            className="kh-input"
            value={question.audioUrl}
            onChange={(e) =>
              onChange({
                audioUrl: e.target.value.trim(),
              } as Partial<QuizQuestion>)
            }
            placeholder="/uploads/… or https://…"
            style={{ marginBottom: "0.5rem" }}
          />
          <input
            type="file"
            accept="audio/*"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadAudio(f);
            }}
            style={{ marginBottom: "0.5rem" }}
          />
          {question.audioUrl?.trim() ? (
            <audio controls preload="metadata" style={{ width: "100%", marginBottom: "0.75rem" }}>
              <source src={question.audioUrl.trim()} />
            </audio>
          ) : (
            <p style={{ fontSize: "0.88rem", color: "#666", margin: "0.25rem 0 0.75rem" }}>
              Upload an audio clip or paste its URL.
            </p>
          )}
          <label style={{ display: "block", marginTop: "0.25rem", fontWeight: 600 }}>Cover image (optional)</label>
          <input
            className="kh-input"
            value={question.coverImageUrl ?? ""}
            onChange={(e) =>
              onChange({
                coverImageUrl: e.target.value.trim() === "" ? undefined : e.target.value.trim(),
              } as Partial<QuizQuestion>)
            }
            placeholder="/uploads/… or https://…"
            style={{ marginBottom: "0.5rem" }}
          />
          <input
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadImage(f);
            }}
            style={{ marginBottom: "0.5rem" }}
          />
          <div className="kh-row">
            <label>Artist</label>
            <input
              className="kh-input"
              value={question.artist ?? ""}
              onChange={(e) => onChange({ artist: e.target.value } as Partial<QuizQuestion>)}
            />
            <label>Title</label>
            <input
              className="kh-input"
              value={question.title ?? ""}
              onChange={(e) => onChange({ title: e.target.value } as Partial<QuizQuestion>)}
            />
          </div>
          <div className="kh-row">
            <label>Track #</label>
            <input
              type="number"
              className="kh-input"
              value={question.trackNumber ?? 1}
              onChange={(e) => onChange({ trackNumber: Number(e.target.value) } as Partial<QuizQuestion>)}
            />
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.75rem",
              margin: "0.6rem 0 0.85rem",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <input
                type="checkbox"
                checked={question.showArtist !== false}
                onChange={(e) => onChange({ showArtist: e.target.checked } as Partial<QuizQuestion>)}
              />
              Show artist
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <input
                type="checkbox"
                checked={question.showTitle !== false}
                onChange={(e) => onChange({ showTitle: e.target.checked } as Partial<QuizQuestion>)}
              />
              Show title
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <input
                type="checkbox"
                checked={question.showCoverArt !== false}
                onChange={(e) => onChange({ showCoverArt: e.target.checked } as Partial<QuizQuestion>)}
              />
              Show cover art
            </label>
          </div>
          <span style={{ fontWeight: 600 }}>Answer options:</span>
          <ul className="kh-order-edit" style={{ marginTop: "0.35rem" }}>
            {question.options.map((opt, i) => (
              <li key={i}>
                <input
                  className="kh-input kh-order-edit-input"
                  value={opt}
                  onChange={(e) => {
                    const options = [...question.options];
                    options[i] = e.target.value;
                    onChange({ options } as Partial<QuizQuestion>);
                  }}
                  aria-label={`Music option ${i + 1}`}
                />
                <span className="kh-order-edit-btns">
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                    <input
                      type="radio"
                      name={`music-correct-${question.id}`}
                      checked={question.correctIndex === i}
                      onChange={() => onChange({ correctIndex: i } as Partial<QuizQuestion>)}
                    />
                    Correct
                  </label>
                  <button
                    type="button"
                    className="kh-btn kh-btn-danger kh-btn-sm"
                    disabled={question.options.length <= 2}
                    onClick={() => {
                      if (question.options.length <= 2) return;
                      const options = question.options.filter((_, j) => j !== i);
                      const nextCorrect =
                        question.correctIndex === i
                          ? 0
                          : question.correctIndex > i
                            ? question.correctIndex - 1
                            : question.correctIndex;
                      onChange({ options, correctIndex: nextCorrect } as Partial<QuizQuestion>);
                    }}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="kh-btn kh-btn-outline kh-btn-sm"
            style={{ marginTop: "0.35rem" }}
            onClick={() =>
              onChange({
                options: [...question.options, `Option ${question.options.length + 1}`],
              } as Partial<QuizQuestion>)
            }
          >
            + Add option
          </button>
        </>
      )}
      {question.type === "slider" && (
        <>
          <div className="kh-row">
            <label>Min</label>
            <input
              type="number"
              className="kh-input"
              value={question.min}
              onChange={(e) => onChange({ min: Number(e.target.value) } as Partial<QuizQuestion>)}
            />
            <label>Max</label>
            <input
              type="number"
              className="kh-input"
              value={question.max}
              onChange={(e) => onChange({ max: Number(e.target.value) } as Partial<QuizQuestion>)}
            />
            <label>Step</label>
            <input
              type="number"
              className="kh-input"
              value={question.step ?? 1}
              onChange={(e) => onChange({ step: Number(e.target.value) } as Partial<QuizQuestion>)}
            />
          </div>
          <div className="kh-row">
            <label>Correct</label>
            <input
              type="number"
              className="kh-input"
              value={question.correctValue}
              onChange={(e) => onChange({ correctValue: Number(e.target.value) } as Partial<QuizQuestion>)}
            />
            <label>Tolerance</label>
            <input
              type="number"
              className="kh-input"
              value={question.tolerance ?? 0}
              onChange={(e) => onChange({ tolerance: Number(e.target.value) } as Partial<QuizQuestion>)}
            />
          </div>
        </>
      )}
      {question.type === "click_location" && (
        <>
          <label>Image URL (or upload)</label>
          <input
            className="kh-input"
            value={question.imageUrl}
            onChange={(e) => onChange({ imageUrl: e.target.value } as Partial<QuizQuestion>)}
            style={{ marginBottom: "0.5rem" }}
          />
          <input
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage(f);
            }}
          />
          {question.imageUrl?.trim() ? (
            <ClickLocationTargetEditor
              imageUrl={question.imageUrl.trim()}
              correctRegion={question.correctRegion}
              onRegionChange={(correctRegion) => onChange({ correctRegion } as Partial<QuizQuestion>)}
            />
          ) : (
            <p style={{ fontSize: "0.88rem", color: "#666", margin: "0.75rem 0 0" }}>
              Add an image URL or upload a file, then click the preview to set where players should tap.
            </p>
          )}
        </>
      )}
      {question.type === "order" && <OrderEditor q={question} onChange={onChange} />}
      {question.type === "match" && <MatchEditor q={question} token={token} onChange={onChange} />}
      {question.type === "odd_color_out" && (
        <>
          <p style={{ fontSize: "0.88rem", color: "#555", marginTop: 0 }}>
            Three blocks use <strong>Base</strong>, one random block uses <strong>Odd</strong>. Defaults are easy to
            spot; use closer hex values if you want it harder.
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "1.25rem",
              alignItems: "flex-end",
              marginBottom: "0.75rem",
            }}
          >
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>Base color</label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="color"
                  value={hexToColorInput(question.baseColor)}
                  onChange={(e) => onChange({ baseColor: e.target.value } as Partial<QuizQuestion>)}
                  aria-label="Pick base color"
                />
                <input
                  className="kh-input"
                  style={{ width: "8rem" }}
                  value={question.baseColor}
                  onChange={(e) => onChange({ baseColor: e.target.value.trim() } as Partial<QuizQuestion>)}
                  placeholder="#0D47A1"
                />
              </div>
            </div>
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>Odd color</label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="color"
                  value={hexToColorInput(question.oddColor)}
                  onChange={(e) => onChange({ oddColor: e.target.value } as Partial<QuizQuestion>)}
                  aria-label="Pick odd color"
                />
                <input
                  className="kh-input"
                  style={{ width: "8rem" }}
                  value={question.oddColor}
                  onChange={(e) => onChange({ oddColor: e.target.value.trim() } as Partial<QuizQuestion>)}
                  placeholder="#64B5F6"
                />
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <div style={{ textAlign: "center", fontSize: "0.8rem", color: "#666" }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 8,
                  backgroundColor: hexToColorInput(question.baseColor),
                  border: "1px solid #ccc",
                }}
              />
              Base
            </div>
            <div style={{ textAlign: "center", fontSize: "0.8rem", color: "#666" }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 8,
                  backgroundColor: hexToColorInput(question.oddColor),
                  border: "1px solid #ccc",
                }}
              />
              Odd
            </div>
          </div>
          <p style={{ fontSize: "0.78rem", color: "#888", marginBottom: 0 }}>
            Live games pick a random square for “odd”; players always see four tiles.
          </p>
        </>
      )}
    </div>
  );
}

function MatchEditor({
  q,
  token,
  onChange,
}: {
  q: Extract<QuizQuestion, { type: "match" }>;
  token: string;
  onChange: (patch: Partial<QuizQuestion>) => void;
}) {
  const [uploadKey, setUploadKey] = useState<string | null>(null);

  const upload = async (side: "left" | "right", index: number, file: File) => {
    const key = `${side}-${index}`;
    setUploadKey(key);
    try {
      const { url } = await api.uploadImage(token, file);
      const pairs = q.pairs.map((p, i) => {
        if (i !== index) return p;
        if (side === "left") return { ...p, left: { ...p.left, imageUrl: url } };
        return { ...p, right: { ...p.right, imageUrl: url } };
      });
      onChange({ pairs } as Partial<QuizQuestion>);
    } catch {
      alert("Upload failed");
    } finally {
      setUploadKey(null);
    }
  };

  const setPairs = (pairs: MatchPair[]) => onChange({ pairs } as Partial<QuizQuestion>);

  const patchLeft = (index: number, partial: Partial<MatchPair["left"]>) => {
    const next = q.pairs.map((p, i) => (i === index ? { ...p, left: { ...p.left, ...partial } } : p));
    setPairs(next);
  };

  const patchRight = (index: number, partial: Partial<MatchPair["right"]>) => {
    const next = q.pairs.map((p, i) => (i === index ? { ...p, right: { ...p.right, ...partial } } : p));
    setPairs(next);
  };

  const addPair = () => {
    setPairs([...q.pairs, { left: { text: "Left" }, right: { text: "Right" } }]);
  };

  const removePair = (index: number) => {
    if (q.pairs.length <= 2) return;
    setPairs(q.pairs.filter((_, i) => i !== index));
  };

  return (
    <>
      <p style={{ fontSize: "0.9rem", color: "#555", marginTop: 0 }}>
        Each row is one correct pair. The server shuffles the left column and the right column separately. Players match by
        tapping a left card then the matching right card. Optional images on either side (URL or upload).
      </p>
      {q.pairs.map((pair, index) => (
        <div
          key={index}
          className="kh-match-pair-row"
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: "0.85rem",
            marginBottom: "0.75rem",
            background: "#fff",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>Pair {index + 1}</div>
          <div className="kh-row" style={{ marginBottom: "0.5rem" }}>
            <span style={{ fontWeight: 600, gridColumn: "1 / -1" }}>Left</span>
            <label>Text</label>
            <input
              className="kh-input"
              value={pair.left.text}
              onChange={(e) => patchLeft(index, { text: e.target.value })}
            />
            <label>Image URL</label>
            <input
              className="kh-input"
              value={pair.left.imageUrl ?? ""}
              onChange={(e) =>
                patchLeft(index, { imageUrl: e.target.value.trim() === "" ? undefined : e.target.value })
              }
            />
            <label>Upload</label>
            <input
              type="file"
              accept="image/*"
              disabled={uploadKey !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload("left", index, f);
              }}
            />
          </div>
          <div className="kh-row">
            <span style={{ fontWeight: 600, gridColumn: "1 / -1" }}>Right</span>
            <label>Text</label>
            <input
              className="kh-input"
              value={pair.right.text}
              onChange={(e) => patchRight(index, { text: e.target.value })}
            />
            <label>Image URL</label>
            <input
              className="kh-input"
              value={pair.right.imageUrl ?? ""}
              onChange={(e) =>
                patchRight(index, { imageUrl: e.target.value.trim() === "" ? undefined : e.target.value })
              }
            />
            <label>Upload</label>
            <input
              type="file"
              accept="image/*"
              disabled={uploadKey !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload("right", index, f);
              }}
            />
          </div>
          <button
            type="button"
            className="kh-btn kh-btn-danger kh-btn-sm"
            style={{ marginTop: "0.5rem" }}
            disabled={q.pairs.length <= 2}
            onClick={() => removePair(index)}
          >
            Remove pair
          </button>
        </div>
      ))}
      <button type="button" className="kh-btn kh-btn-outline kh-btn-sm" onClick={addPair}>
        + Add pair
      </button>
    </>
  );
}

function mcResolvedCorrect(q: Extract<QuizQuestion, { type: "multiple_choice" }>): number[] {
  if (Array.isArray(q.correctIndices) && q.correctIndices.length > 0) {
    return [...new Set(q.correctIndices)]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < q.options.length)
      .sort((a, b) => a - b);
  }
  if (typeof q.correctIndex === "number" && q.correctIndex >= 0 && q.correctIndex < q.options.length) {
    return [q.correctIndex];
  }
  return [0];
}

function McEditor({
  q,
  onChange,
}: {
  q: Extract<QuizQuestion, { type: "multiple_choice" }>;
  onChange: (patch: Partial<QuizQuestion>) => void;
}) {
  const optionTextRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusOptionTextIndex = useRef<number | null>(null);
  const rows = getMcRows(q.options);

  useEffect(() => {
    const idx = focusOptionTextIndex.current;
    if (idx == null || idx < 0 || idx >= rows.length) return;
    focusOptionTextIndex.current = null;
    requestAnimationFrame(() => {
      const el = optionTextRefs.current[idx];
      el?.focus();
      el?.select();
    });
  }, [q.options.length]);
  const penaltyTotalActive = (q.mcPenaltyPoints ?? 0) > 0;
  const pushOptions = (next: McOption[]) => {
    onChange({ options: serializeMcOptions(next) } as Partial<QuizQuestion>);
  };
  const setMcPenaltyTotal = (raw: string) => {
    const n = raw === "" ? 0 : Math.max(0, Math.floor(Number(raw)) || 0);
    if (n <= 0) {
      const cleared = getMcRows(q.options).map((r) => ({ text: r.text, penalizeIfWrong: false }));
      onChange({
        mcPenaltyPoints: undefined,
        options: serializeMcOptions(cleared),
      } as Partial<QuizQuestion>);
    } else {
      onChange({ mcPenaltyPoints: n } as Partial<QuizQuestion>);
    }
  };
  const setOptionText = (i: number, text: string) => {
    pushOptions(rows.map((r, j) => (j === i ? { ...r, text } : r)));
  };
  const setOptionPenalize = (i: number, checked: boolean) => {
    pushOptions(rows.map((r, j) => (j === i ? { ...r, penalizeIfWrong: checked } : r)));
  };
  const addOption = () => pushOptions([...rows, { text: `Option ${rows.length + 1}` }]);
  const removeOption = (i: number) => {
    if (rows.length <= 2) return;
    const nextRows = rows.filter((_, j) => j !== i);
    const cur = mcResolvedCorrect(q)
      .filter((j) => j !== i)
      .map((j) => (j > i ? j - 1 : j));
    onChange({
      options: serializeMcOptions(nextRows),
      correctIndices: cur,
      correctIndex: undefined,
    } as Partial<QuizQuestion>);
  };
  const toggleCorrect = (i: number) => {
    const cur = mcResolvedCorrect(q);
    if (cur.includes(i)) {
      if (cur.length <= 1) return;
      onChange({ correctIndices: cur.filter((x) => x !== i), correctIndex: undefined });
    } else {
      onChange({ correctIndices: [...cur, i].sort((a, b) => a - b), correctIndex: undefined });
    }
  };
  const correct = mcResolvedCorrect(q);
  return (
    <>
      <p style={{ fontSize: "0.9rem", color: "#555", marginTop: 0 }}>
        Check every correct answer (players must match all of them).
      </p>
      <label>Total penalty on wrong answer (optional)</label>
      <p style={{ fontSize: "0.85rem", color: "#666", margin: "0 0 0.5rem" }}>
        If you set a number, you can mark specific wrong answers below so that total is subtracted{" "}
        <strong>once</strong> when the player is wrong and picked at least one of those answers.
      </p>
      <input
        type="number"
        min={0}
        className="kh-input"
        style={{ maxWidth: "8rem", marginBottom: "1rem" }}
        value={penaltyTotalActive ? q.mcPenaltyPoints ?? "" : ""}
        onChange={(e) => setMcPenaltyTotal(e.target.value)}
      />
      <label>Options (add as many as you like)</label>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.35rem",
            marginBottom: "0.5rem",
            alignItems: "center",
          }}
        >
          <input
            ref={(el) => {
              optionTextRefs.current[i] = el;
            }}
            className="kh-input"
            style={{ flex: "1 1 12rem", minWidth: "8rem" }}
            value={row.text}
            onChange={(e) => setOptionText(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Tab" || e.shiftKey || i !== rows.length - 1) return;
              e.preventDefault();
              const newIdx = rows.length;
              focusOptionTextIndex.current = newIdx;
              pushOptions([...rows, { text: `Option ${newIdx + 1}` }]);
            }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={correct.includes(i)} onChange={() => toggleCorrect(i)} />
            correct
          </label>
          {penaltyTotalActive ? (
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                checked={!!row.penalizeIfWrong}
                onChange={(e) => setOptionPenalize(i, e.target.checked)}
              />
              <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#555" }}>Trap (applies total)</span>
            </label>
          ) : null}
          <button
            type="button"
            className="kh-btn kh-btn-danger kh-mc-opt-remove"
            title={rows.length <= 2 ? "Need at least 2 options" : "Remove this option"}
            disabled={rows.length <= 2}
            onClick={() => removeOption(i)}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="kh-btn kh-btn-outline kh-btn-sm" style={{ marginTop: "0.25rem" }} onClick={addOption}>
        + Add option
      </button>
      <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", marginTop: "0.85rem", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={q.shuffleOptions !== false}
          onChange={(e) => onChange({ shuffleOptions: e.target.checked })}
          style={{ marginTop: "0.2rem" }}
        />
        <span>
          <strong>Random order of answers</strong>
          <span style={{ display: "block", fontSize: "0.88rem", color: "#555", fontWeight: 400 }}>
            Each player sees the options shuffled (correct answer is still detected).
          </span>
        </span>
      </label>
    </>
  );
}

function OrderEditor({
  q,
  onChange,
}: {
  q: Extract<QuizQuestion, { type: "order" }>;
  onChange: (patch: Partial<QuizQuestion>) => void;
}) {
  const identityOrder = (items: string[]) => items.map((_, i) => i);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const setItemText = (index: number, text: string) => {
    const items = q.items.map((t, j) => (j === index ? text : t));
    onChange({ items, correctOrder: identityOrder(items) });
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= q.items.length) return;
    const items = [...q.items];
    const [row] = items.splice(from, 1);
    items.splice(to, 0, row);
    onChange({ items, correctOrder: identityOrder(items) });
  };
  const addItem = () => {
    const items = [...q.items, `Item ${q.items.length + 1}`];
    onChange({ items, correctOrder: identityOrder(items) });
  };
  const removeItem = (index: number) => {
    if (q.items.length <= 2) return;
    const items = q.items.filter((_, j) => j !== index);
    onChange({ items, correctOrder: identityOrder(items) });
  };
  const startDrag = (index: number) => (e: React.DragEvent<HTMLLIElement>) => {
    setDragFromIndex(index);
    setDragOverIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };
  const onDragOverItem = (index: number) => (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    if (dragOverIndex !== index) setDragOverIndex(index);
    e.dataTransfer.dropEffect = "move";
  };
  const onDropItem = (index: number) => (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    const from = dragFromIndex;
    setDragFromIndex(null);
    setDragOverIndex(null);
    if (from === null || from === index) return;
    move(from, index);
  };
  const endDrag = () => {
    setDragFromIndex(null);
    setDragOverIndex(null);
  };

  return (
    <>
      <p style={{ fontSize: "0.9rem", color: "#555", marginTop: 0 }}>
        Top to bottom is the correct order. Players see items shuffled and put them in this order.
      </p>
      <div style={{ marginTop: "0.5rem" }}>
        <span style={{ fontWeight: 600 }}>Items (drag and drop to reorder):</span>
        <ul className="kh-order-edit">
          {q.items.map((text, i) => (
            <li
              key={i}
              draggable
              onDragStart={startDrag(i)}
              onDragOver={onDragOverItem(i)}
              onDrop={onDropItem(i)}
              onDragEnd={endDrag}
              className={
                "kh-order-edit-item" +
                (dragFromIndex === i ? " is-dragging" : "") +
                (dragOverIndex === i && dragFromIndex !== i ? " is-drop-target" : "")
              }
            >
              <span className="kh-order-edit-grip" aria-hidden title="Drag to reorder">
                ⋮⋮
              </span>
              <input
                className="kh-input kh-order-edit-input"
                value={text}
                onChange={(e) => setItemText(i, e.target.value)}
                aria-label={`Order item ${i + 1}`}
              />
              <span className="kh-order-edit-btns">
                <button
                  type="button"
                  className="kh-btn kh-btn-danger kh-btn-sm"
                  title={q.items.length <= 2 ? "Need at least 2 items" : "Remove this item"}
                  disabled={q.items.length <= 2}
                  onClick={() => removeItem(i)}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <button type="button" className="kh-btn kh-btn-outline kh-btn-sm" style={{ marginTop: "0.35rem" }} onClick={addItem}>
        + Add item
      </button>
    </>
  );
}
