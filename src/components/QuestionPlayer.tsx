import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "../types";
import { camootLog } from "../log";
import { playClick, playSubmit, playTick } from "../sounds";
import "./QuestionPlayer.css";

const COLORS = ["#e21b3c", "#1368ce", "#f5c400", "#26890c", "#0aa3a3", "#864cbf", "#d45400", "#b23aee"];

export function normalizeMcDisplayOptions(q: Record<string, unknown>): { id: number; text: string }[] {
  const raw = q.options;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const first = raw[0];
  if (typeof first === "object" && first !== null && "id" in first && "text" in first) {
    return (raw as { id: number; text: string }[]).map((o) => ({
      id: Number(o.id),
      text: String(o.text),
    }));
  }
  return (raw as string[]).map((text, i) => ({ id: i, text: String(text) }));
}

export type PlayerAnswer =
  | number
  | { x: number; y: number }
  | number[]
  | { matchByLeft: number[] };

type Props = {
  state: GameState;
  disabled: boolean;
  onSubmit: (answer: PlayerAnswer) => void;
};

export default function QuestionPlayer({ state, disabled, onSubmit }: Props) {
  const q = state.question;
  const timeLeft = useQuestionTimer(state);
  const lastTickSec = useRef<number | null>(null);

  const [sliderVal, setSliderVal] = useState<number | null>(null);
  const [orderIds, setOrderIds] = useState<number[]>([]);
  const orderIdsRef = useRef<number[]>([]);
  const [mcSelected, setMcSelected] = useState<number[]>([]);
  /** Never assign from React state on each render — concurrent passes can wipe a fresh pick before commit. */
  const mcSelectedRef = useRef<number[]>([]);
  const [singlePickedId, setSinglePickedId] = useState<number | null>(null);
  const singlePickedRef = useRef<number | null>(null);
  const mcAutoTimeSubmitRef = useRef(false);
  /** One graded answer per question; blocks double pointerdown+click and stacked playSubmit() on mobile. */
  const answerSentRef = useRef(false);
  const uiTapSoundAtRef = useRef(0);
  const [draggingOid, setDraggingOid] = useState<number | null>(null);
  /** Drop-row highlight while reordering with pointer (touch-friendly; HTML5 drag is disabled). */
  const [orderDropHoverIdx, setOrderDropHoverIdx] = useState<number | null>(null);
  const orderListRef = useRef<HTMLUListElement>(null);
  const orderPtrDragRef = useRef<{ pointerId: number; fromIdx: number } | null>(null);
  const [matchPairs, setMatchPairs] = useState<Map<number, number>>(new Map());
  const [matchPendingLeft, setMatchPendingLeft] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const qpDebugCtxRef = useRef({
    pin: "",
    questionIndex: -1,
    phase: "" as GameState["phase"],
  });
  qpDebugCtxRef.current = {
    pin: state.pin,
    questionIndex: state.questionIndex,
    phase: state.phase,
  };

  const tryTakeAnswerLock = useCallback((reason: string) => {
    const base = { ...qpDebugCtxRef.current, reason };
    if (disabled) {
      camootLog("qp", "answerLock denied (disabled)", base);
      return false;
    }
    if (answerSentRef.current) {
      camootLog("qp", "answerLock denied (already sent)", base);
      return false;
    }
    answerSentRef.current = true;
    camootLog("qp", "answerLock granted", base);
    return true;
  }, [disabled]);

  const playUiTapSound = () => {
    const t = Date.now();
    if (t - uiTapSoundAtRef.current < 140) return;
    uiTapSoundAtRef.current = t;
    playClick();
  };

  useEffect(() => {
    camootLog("qp", "answerLock ref reset (new question/phase)", {
      questionIndex: state.questionIndex,
      phase: state.phase,
      pin: state.pin,
    });
    answerSentRef.current = false;
  }, [state.questionIndex, state.phase]);

  useEffect(() => {
    if (timeLeft !== null && timeLeft > 0 && timeLeft <= 3) {
      if (lastTickSec.current !== timeLeft) {
        lastTickSec.current = timeLeft;
        playTick();
      }
    } else {
      lastTickSec.current = null;
    }
  }, [timeLeft]);

  /** Stable while the same slider question is shown; avoids resetting on every state broadcast (new `q` reference). */
  const sliderBounds =
    state.phase === "question" &&
    q &&
    (q as { type: string }).type === "slider"
      ? `${state.questionIndex}/${Number((q as { min: number }).min)}/${Number((q as { max: number }).max)}`
      : "";

  useEffect(() => {
    if (!sliderBounds) {
      setSliderVal(null);
      return;
    }
    const parts = sliderBounds.split("/");
    const min = Number(parts[1]);
    const max = Number(parts[2]);
    setSliderVal(Math.round((min + max) / 2));
  }, [sliderBounds]);

  const orderResetKey =
    state.phase === "question" &&
    q &&
    (q as { type: string }).type === "order"
      ? `${state.questionIndex}/${(q as { items: { id: number }[] }).items.map((i) => i.id).join(",")}`
      : "";

  useEffect(() => {
    if (!orderResetKey) {
      setOrderIds([]);
      orderIdsRef.current = [];
      return;
    }
    const slash = orderResetKey.indexOf("/");
    const idsPart = slash >= 0 ? orderResetKey.slice(slash + 1) : "";
    const next = idsPart ? idsPart.split(",").map(Number).filter((n) => !Number.isNaN(n)) : [];
    orderIdsRef.current = next;
    setOrderIds(next);
  }, [orderResetKey]);

  useEffect(() => {
    orderPtrDragRef.current = null;
    setDraggingOid(null);
    setOrderDropHoverIdx(null);
  }, [orderResetKey]);

  const mcResetKey =
    state.phase === "question" &&
    q &&
    (q as { type: string }).type === "multiple_choice"
      ? `${state.questionIndex}/${(q as { multiSelect?: boolean }).multiSelect ? "M" : "S"}/${normalizeMcDisplayOptions(q as Record<string, unknown>)
          .map((o) => o.id)
          .join(",")}`
      : "";

  useEffect(() => {
    camootLog("qp", "mcResetKey effect", { mcResetKey, ...qpDebugCtxRef.current });
    if (!mcResetKey) {
      setMcSelected([]);
      setSinglePickedId(null);
      mcSelectedRef.current = [];
      singlePickedRef.current = null;
      return;
    }
    if (mcResetKey.includes("/M/")) {
      setMcSelected([]);
      mcSelectedRef.current = [];
    } else {
      setSinglePickedId(null);
      singlePickedRef.current = null;
    }
  }, [mcResetKey]);

  const mcIsMulti =
    q &&
    (q as { type: string }).type === "multiple_choice" &&
    !!(q as { multiSelect?: boolean }).multiSelect;
  const questionType = q ? (q as { type: string }).type : "";

  useEffect(() => {
    mcAutoTimeSubmitRef.current = false;
  }, [state.questionIndex, state.phase]);

  useEffect(() => {
    if (!mcIsMulti || disabled || state.phase !== "question") return;
    if (timeLeft !== 0) return;
    if (mcAutoTimeSubmitRef.current) return;
    if (answerSentRef.current) return;
    const ids = mcSelectedRef.current;
    if (ids.length === 0) return;
    mcAutoTimeSubmitRef.current = true;
    answerSentRef.current = true;
    camootLog("qp", "mc auto-submit (multi, timer 0)", {
      ...qpDebugCtxRef.current,
      ids,
    });
    playSubmit();
    onSubmit([...ids]);
  }, [mcIsMulti, disabled, state.phase, timeLeft, onSubmit]);

  useEffect(() => {
    if (mcIsMulti || disabled || state.phase !== "question") return;
    if (questionType !== "multiple_choice") return;
    if (timeLeft !== 0) return;
    if (mcAutoTimeSubmitRef.current) return;
    if (answerSentRef.current) return;
    const id = singlePickedRef.current;
    if (id === null) return;
    mcAutoTimeSubmitRef.current = true;
    answerSentRef.current = true;
    camootLog("qp", "mc auto-submit (single, timer 0)", {
      ...qpDebugCtxRef.current,
      id,
    });
    playSubmit();
    onSubmit(id);
  }, [mcIsMulti, disabled, state.phase, timeLeft, onSubmit, questionType]);

  const matchResetKey =
    state.phase === "question" &&
    q &&
    (q as { type: string }).type === "match"
      ? `${state.questionIndex}/L${(q as { left: { id: number }[] }).left.map((x) => x.id).join(",")}R${(q as { right: { id: number }[] }).right.map((x) => x.id).join(",")}`
      : "";

  useEffect(() => {
    if (!matchResetKey) {
      setMatchPairs(new Map());
      setMatchPendingLeft(null);
      return;
    }
    setMatchPairs(new Map());
    setMatchPendingLeft(null);
  }, [matchResetKey]);

  const [oddPicked, setOddPicked] = useState<number | null>(null);
  const oddResetKey =
    state.phase === "question" &&
    q &&
    (q as { type: string }).type === "odd_color_out"
      ? `${state.questionIndex}/${((q as { swatches?: { index: number; color: string }[] }).swatches || [])
          .map((s) => s.color)
          .join("|")}`
      : "";

  useEffect(() => {
    if (!oddResetKey) {
      setOddPicked(null);
      return;
    }
    setOddPicked(null);
  }, [oddResetKey]);

  if (!q) return null;

  const qt = (q as { type: string }).type;
  const qpWrapClass = "qp-wrap qp-anim-in" + (disabled ? " qp-locked" : "");

  if (qt === "odd_color_out") {
    const swatches =
      (q as { swatches?: { index: number; color: string }[] }).swatches || [];
    const onOddPick = (index: number) => {
      if (disabled) return;
      if (!tryTakeAnswerLock("odd_color_out")) return;
      setOddPicked(index);
      playClick();
      playSubmit();
      onSubmit(index);
    };
    return (
      <div className={qpWrapClass}>
        <div className="qp-timer">{timeLeft !== null ? `${timeLeft}s` : ""}</div>
        <h2 className="qp-qtext">{String((q as { question: string }).question)}</h2>
        <p className="qp-hint">Tap the square that is not the same color as the other three.</p>
        <div
          className={"qp-odd-grid" + (disabled ? " qp-odd-grid-locked" : "")}
          role="group"
          aria-label="Four color squares"
        >
          {swatches.map((s) => {
            const picked = oddPicked === s.index;
            return (
              <button
                key={s.index}
                type="button"
                className={"qp-odd-cell" + (picked ? " qp-odd-cell-picked" : "")}
                style={{ backgroundColor: s.color }}
                disabled={disabled}
                aria-label={`Square ${s.index + 1}`}
                aria-pressed={picked}
                onClick={(e) => {
                  camootLog("qp", "odd square click", {
                    ...qpDebugCtxRef.current,
                    index: s.index,
                    detail: e.detail,
                  });
                  onOddPick(s.index);
                }}
              >
                <span className="qp-odd-cell-num" aria-hidden>
                  {s.index + 1}
                </span>
                {picked ? (
                  <span className="qp-odd-cell-check" aria-hidden>
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {oddPicked !== null && (
          <p className="qp-odd-sent" role="status">
            Square {oddPicked + 1} — answer sent
          </p>
        )}
      </div>
    );
  }

  if (qt === "multiple_choice") {
    const options = normalizeMcDisplayOptions(q as Record<string, unknown>);
    const multiSelect = !!(q as { multiSelect?: boolean }).multiSelect;
    const mcDbg = (extra: Record<string, unknown>) => ({
      ...qpDebugCtxRef.current,
      multiSelect,
      singlePickedRef: singlePickedRef.current,
      singlePickedState: singlePickedId,
      mcSelectedRef: [...mcSelectedRef.current],
      mcSelectedState: [...mcSelected],
      answerSent: answerSentRef.current,
      disabled,
      ...extra,
    });
    const toggleMc = (originalId: number) => {
      if (disabled) return;
      playUiTapSound();
      setMcSelected((prev) => {
        const s = new Set(prev);
        if (s.has(originalId)) s.delete(originalId);
        else s.add(originalId);
        const next = [...s].sort((a, b) => a - b);
        mcSelectedRef.current = next;
        camootLog("qp", "mc toggle", mcDbg({ toggledId: originalId, next }));
        return next;
      });
    };
    const submitMc = () => {
      const ids = mcSelectedRef.current;
      camootLog("qp", "mc submit multi attempt", mcDbg({ ids: [...ids] }));
      if (ids.length === 0) {
        camootLog("qp", "mc submit multi aborted (empty)", mcDbg({}));
        return;
      }
      if (!tryTakeAnswerLock("mc_multi_submit")) return;
      playSubmit();
      onSubmit(ids);
    };
    const pickSingleMc = (originalId: number) => {
      playUiTapSound();
      singlePickedRef.current = originalId;
      setSinglePickedId(originalId);
      camootLog("qp", "mc pick single", mcDbg({ pickedId: originalId }));
    };
    const submitSingleMc = () => {
      const id = singlePickedRef.current;
      camootLog("qp", "mc submit single attempt", mcDbg({ idFromRef: id }));
      if (id === null) {
        camootLog("qp", "mc submit single aborted (null ref)", mcDbg({}));
        return;
      }
      if (!tryTakeAnswerLock("mc_single_submit")) return;
      playSubmit();
      onSubmit(id);
    };
    const mcImageUrl = (q as { imageUrl?: string }).imageUrl;
    return (
      <div className={qpWrapClass}>
        <div className="qp-timer">{timeLeft !== null ? `${timeLeft}s` : ""}</div>
        <h2 className="qp-qtext">{String((q as { question: string }).question)}</h2>
        {typeof mcImageUrl === "string" && mcImageUrl.trim() !== "" ? (
          <div className="qp-mc-figure">
            <img className="qp-mc-qimage" src={mcImageUrl} alt="" decoding="async" />
          </div>
        ) : null}
        {multiSelect ? (
          <p className="qp-mc-hint">Select all that apply. Tap Submit, or wait: your picks send when time runs out.</p>
        ) : (
          <p className="qp-mc-hint">Choose an answer, then tap Submit (or wait: your choice sends when time runs out).</p>
        )}
        <div className={"qp-mc-grid" + (disabled ? " qp-mc-grid-locked" : "")}>
          {options.map((opt, displayIndex) => {
            const isChosen = multiSelect
              ? mcSelected.includes(opt.id)
              : singlePickedId === opt.id;
            const pickOpt = () => (multiSelect ? toggleMc(opt.id) : pickSingleMc(opt.id));
            return (
              <button
                key={opt.id}
                type="button"
                className={"qp-mc-btn" + (isChosen ? " qp-mc-btn-selected" : "")}
                style={{ background: COLORS[displayIndex % COLORS.length] }}
                disabled={disabled}
                onClick={(e) => {
                  camootLog("qp", "mc option click", mcDbg({
                    optId: opt.id,
                    detail: e.detail,
                  }));
                  pickOpt();
                }}
              >
                <span className={"qp-shape" + (isChosen ? " qp-shape-checked" : "")} aria-hidden />
                {opt.text}
              </button>
            );
          })}
        </div>
        {multiSelect ? (
          <button
            type="button"
            className="kh-btn kh-btn-primary qp-submit"
            disabled={disabled || mcSelected.length === 0}
            onClick={(e) => {
              camootLog("qp", "mc submit click (multi)", mcDbg({ detail: e.detail }));
              submitMc();
            }}
          >
            Submit answer
          </button>
        ) : (
          <button
            type="button"
            className="kh-btn kh-btn-primary qp-submit"
            disabled={disabled || singlePickedId === null}
            onClick={(e) => {
              camootLog("qp", "mc submit click (single)", mcDbg({ detail: e.detail }));
              submitSingleMc();
            }}
          >
            Submit answer
          </button>
        )}
      </div>
    );
  }

  if (qt === "slider") {
    const min = Number((q as { min: number }).min);
    const max = Number((q as { max: number }).max);
    const step = Number((q as { step?: number }).step ?? 1);
    const val = sliderVal ?? Math.round((min + max) / 2);
    return (
      <div className={qpWrapClass}>
        <div className="qp-timer">{timeLeft !== null ? `${timeLeft}s` : ""}</div>
        <h2 className="qp-qtext">{String((q as { question: string }).question)}</h2>
        <p className="qp-slider-range-hint">
          Slide between <strong>{min}</strong> and <strong>{max}</strong>, then lock in your answer.
        </p>
        <div className={"qp-slider-box" + (disabled ? " qp-slider-box-locked" : "")}>
          <div className="qp-slider-scale">
            <span>{min}</span>
            <span>{max}</span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={val}
            disabled={disabled}
            onChange={(e) => setSliderVal(Number(e.target.value))}
            onInput={(e) => setSliderVal(Number((e.target as React.FormEvent<HTMLInputElement>).currentTarget.value))}
            className="qp-range"
          />
          <div className="qp-slider-val">{val}</div>
          <button
            type="button"
            className="kh-btn kh-btn-primary qp-submit"
            disabled={disabled}
            onClick={() => {
              camootLog("qp", "slider lock click", { ...qpDebugCtxRef.current, val });
              if (!tryTakeAnswerLock("slider_lock")) return;
              playSubmit();
              onSubmit(val);
            }}
          >
            Lock in
          </button>
        </div>
      </div>
    );
  }

  if (qt === "click_location") {
    const url = String((q as { imageUrl: string }).imageUrl || "");
    const submitImgPt = (clientX: number, clientY: number) => {
      if (disabled || !imgRef.current) return;
      const rect = imgRef.current.getBoundingClientRect();
      const rw = rect.width;
      const rh = rect.height;
      if (rw <= 0 || rh <= 0) return;
      if (!tryTakeAnswerLock("click_location")) return;
      playClick();
      const x = (clientX - rect.left) / rw;
      const y = (clientY - rect.top) / rh;
      camootLog("qp", "click_location submit", { ...qpDebugCtxRef.current, x, y });
      onSubmit({ x, y });
    };
    const onImgClick = (e: React.MouseEvent<HTMLDivElement>) => {
      camootLog("qp", "click_location img click", { ...qpDebugCtxRef.current, detail: e.detail });
      submitImgPt(e.clientX, e.clientY);
    };
    return (
      <div className={qpWrapClass}>
        <div className="qp-timer">{timeLeft !== null ? `${timeLeft}s` : ""}</div>
        <h2 className="qp-qtext">{String((q as { question: string }).question)}</h2>
        <p className="qp-hint">Tap the correct spot on the image.</p>
        <div
          className="qp-click"
          onClick={onImgClick}
          role="presentation"
        >
          {url ? (
            <img ref={imgRef} src={url} alt="" className="qp-click-img" draggable={false} />
          ) : (
            <div className="qp-noimg">No image</div>
          )}
        </div>
      </div>
    );
  }

  if (qt === "match") {
    const leftCol = (q as { left: { id: number; text: string; imageUrl?: string }[] }).left || [];
    const rightCol = (q as { right: { id: number; text: string; imageUrl?: string }[] }).right || [];
    const n = leftCol.length;
    const addMatchPair = (l: number, r: number) => {
      setMatchPairs((prev) => {
        const m = new Map(prev);
        for (const [pl, pr] of m) {
          if (pl === l) m.delete(pl);
          if (pr === r) m.delete(pl);
        }
        m.set(l, r);
        return m;
      });
    };
    const onLeftTap = (id: number) => {
      if (disabled) return;
      playUiTapSound();
      if (matchPairs.has(id)) {
        setMatchPairs((prev) => {
          const m = new Map(prev);
          m.delete(id);
          return m;
        });
        setMatchPendingLeft(null);
        return;
      }
      setMatchPendingLeft((prev) => (prev === id ? null : id));
    };
    const onRightTap = (id: number) => {
      if (disabled || matchPendingLeft === null) return;
      playUiTapSound();
      addMatchPair(matchPendingLeft, id);
      setMatchPendingLeft(null);
    };
    const reverseMap = new Map<number, number>();
    matchPairs.forEach((r, l) => reverseMap.set(r, l));
    const complete =
      n > 0 &&
      matchPairs.size === n &&
      [...Array(n).keys()].every((i) => matchPairs.has(i));
    const submitMatch = () => {
      if (!complete) return;
      const matchByLeft = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        const v = matchPairs.get(i);
        if (v === undefined) return;
        matchByLeft[i] = v;
      }
      if (!tryTakeAnswerLock("match_submit")) return;
      playSubmit();
      onSubmit({ matchByLeft });
    };
    const renderCell = (
      row: { id: number; text: string; imageUrl?: string },
      side: "L" | "R",
      active: boolean,
      paired: boolean
    ) => {
      const url = row.imageUrl?.trim();
      const matchTap = () => (side === "L" ? onLeftTap(row.id) : onRightTap(row.id));
      return (
        <button
          key={`${side}-${row.id}`}
          type="button"
          className={
            "qp-match-cell" +
            (active ? " qp-match-cell-active" : "") +
            (paired ? " qp-match-cell-paired" : "")
          }
          style={{ borderColor: paired || active ? COLORS[row.id % COLORS.length] : undefined }}
          disabled={disabled}
          onClick={matchTap}
        >
          {url ? <img src={url} alt="" className="qp-match-img" draggable={false} /> : null}
          <span className="qp-match-text">{row.text || (url ? " " : "-")}</span>
        </button>
      );
    };
    return (
      <div className={qpWrapClass}>
        <div className="qp-timer">{timeLeft !== null ? `${timeLeft}s` : ""}</div>
        <h2 className="qp-qtext">{String((q as { question: string }).question)}</h2>
        <p className="qp-hint">Tap one item on the left, then its match on the right. Tap a paired left card to undo.</p>
        <div className="qp-match-cols">
          <div className="qp-match-col">
            <div className="qp-match-col-title">Left</div>
            <div className="qp-match-list">
              {leftCol.map((row) =>
                renderCell(
                  row,
                  "L",
                  matchPendingLeft === row.id,
                  matchPairs.has(row.id)
                )
              )}
            </div>
          </div>
          <div className="qp-match-col">
            <div className="qp-match-col-title">Right</div>
            <div className="qp-match-list">
              {rightCol.map((row) => {
                  const pairedFromLeft = reverseMap.get(row.id);
                  const canTapRight = matchPendingLeft !== null && !matchPairs.has(matchPendingLeft);
                  return (
                    <button
                      key={`R-${row.id}`}
                      type="button"
                      className={
                        "qp-match-cell" +
                        (canTapRight ? " qp-match-cell-pickable" : "") +
                        (pairedFromLeft !== undefined ? " qp-match-cell-paired" : "")
                      }
                      style={{
                        borderColor:
                          pairedFromLeft !== undefined
                            ? COLORS[(pairedFromLeft as number) % COLORS.length]
                            : undefined,
                      }}
                      disabled={disabled || !canTapRight}
                      onClick={() => onRightTap(row.id)}
                    >
                      {row.imageUrl?.trim() ? (
                        <img src={row.imageUrl} alt="" className="qp-match-img" draggable={false} />
                      ) : null}
                      <span className="qp-match-text">{row.text || "-"}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="kh-btn kh-btn-primary qp-submit"
          disabled={disabled || !complete}
          onClick={submitMatch}
        >
          Submit matches
        </button>
      </div>
    );
  }

  if (qt === "order") {
    const items = (q as { items: { id: number; text: string }[] }).items;
    const byId = new Map<number, string>();
    items.forEach((it) => byId.set(it.id, it.text));

    const move = (from: number, to: number) => {
      if (disabled) return;
      setOrderIds((prev) => {
        const next = [...prev];
        const [x] = next.splice(from, 1);
        next.splice(to, 0, x);
        orderIdsRef.current = next;
        return next;
      });
      playUiTapSound();
    };

    const rowIndexAtClientY = (clientY: number) => {
      const root = orderListRef.current;
      if (!root) return 0;
      const lis = root.querySelectorAll<HTMLLIElement>(":scope > li");
      if (lis.length === 0) return 0;
      for (let i = 0; i < lis.length; i++) {
        const r = lis[i].getBoundingClientRect();
        if (clientY < r.top + r.height / 2) return i;
      }
      return lis.length - 1;
    };

    const endOrderPointerDrag = (e: React.PointerEvent<HTMLLIElement>, rowEl: HTMLLIElement) => {
      const d = orderPtrDragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      orderPtrDragRef.current = null;
      try {
        rowEl.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      const toIdx = rowIndexAtClientY(e.clientY);
      setDraggingOid(null);
      setOrderDropHoverIdx(null);
      if (toIdx !== d.fromIdx) move(d.fromIdx, toIdx);
    };

    const onOrderRowPointerDown = (idx: number, oid: number) => (e: React.PointerEvent<HTMLLIElement>) => {
      if (disabled) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest(".qp-order-actions")) return;
      if (e.pointerType === "touch" || e.pointerType === "pen") e.preventDefault();
      orderPtrDragRef.current = { pointerId: e.pointerId, fromIdx: idx };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraggingOid(oid);
      setOrderDropHoverIdx(idx);
      camootLog("qp", "order pointer drag start", { idx, oid, pointerType: e.pointerType });
    };

    const onOrderRowPointerMove = (e: React.PointerEvent<HTMLLIElement>) => {
      const d = orderPtrDragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      setOrderDropHoverIdx(rowIndexAtClientY(e.clientY));
    };

    const onOrderRowPointerUp = (e: React.PointerEvent<HTMLLIElement>) => {
      endOrderPointerDrag(e, e.currentTarget);
    };

    const onOrderRowPointerCancel = (e: React.PointerEvent<HTMLLIElement>) => {
      const d = orderPtrDragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      orderPtrDragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ok */
      }
      setDraggingOid(null);
      setOrderDropHoverIdx(null);
    };

    return (
      <div className={qpWrapClass}>
        <div className="qp-timer">{timeLeft !== null ? `${timeLeft}s` : ""}</div>
        <h2 className="qp-qtext">{String((q as { question: string }).question)}</h2>
        <p className="qp-hint">
          Drag a row to reorder (top = first). On your phone, drag the row right away — no long-press. ↑ ↓ work too.
        </p>
        <ul
          ref={orderListRef}
          className={"qp-order-list" + (draggingOid !== null ? " qp-order-list-is-dragging" : "")}
        >
          {orderIds.map((oid, idx) => (
            <li
              key={oid}
              className={
                "qp-order-item" +
                (draggingOid === oid ? " qp-order-item-dragging" : "") +
                (orderDropHoverIdx === idx && draggingOid !== null && draggingOid !== oid
                  ? " qp-order-item-drop-target"
                  : "")
              }
              onPointerDown={onOrderRowPointerDown(idx, oid)}
              onPointerMove={onOrderRowPointerMove}
              onPointerUp={onOrderRowPointerUp}
              onPointerCancel={onOrderRowPointerCancel}
            >
              <span className="qp-order-grip" aria-hidden>
                ⋮⋮
              </span>
              <span className="qp-order-text">{byId.get(oid)}</span>
              <span className="qp-order-actions">
                <button
                  type="button"
                  disabled={disabled || idx === 0}
                  onClick={() => move(idx, idx - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={disabled || idx === orderIds.length - 1}
                  onClick={() => move(idx, idx + 1)}
                >
                  ↓
                </button>
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="kh-btn kh-btn-primary qp-submit"
          disabled={disabled}
          onClick={() => {
            camootLog("qp", "order submit click", {
              ...qpDebugCtxRef.current,
              orderIds: [...orderIdsRef.current],
            });
            if (!tryTakeAnswerLock("order_submit")) return;
            playSubmit();
            onSubmit([...orderIdsRef.current]);
          }}
        >
          Submit order
        </button>
      </div>
    );
  }

  return null;
}

function useQuestionTimer(state: GameState) {
  const [tick, setTick] = useState(0);
  const q = state.question;
  const limitSec = q ? Number((q as { timeLimitSec?: number }).timeLimitSec ?? 20) : 20;
  const started = state.questionStartedAt;

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [started, state.questionIndex]);

  return useMemo(() => {
    if (state.phase !== "question" || !started || !q) return null;
    const elapsed = (Date.now() - started) / 1000;
    const left = Math.ceil(limitSec - elapsed);
    return Math.max(0, left);
  }, [state.phase, started, limitSec, q, tick, state.questionIndex]);
}
