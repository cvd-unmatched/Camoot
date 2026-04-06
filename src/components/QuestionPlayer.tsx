import { useEffect, useRef, useState, useMemo } from "react";
import type { GameState } from "../types";
import { playClick, playSubmit, playTick } from "../sounds";
import "./QuestionPlayer.css";

const COLORS = ["#e21b3c", "#1368ce", "#f5c400", "#26890c", "#0aa3a3", "#864cbf", "#d45400", "#b23aee"];

/** Touch/pen: run on pointerdown and preventDefault so the delayed synthetic click does not drop or double the action. Mouse uses onClick only (this handler skips mouse). */
function onTouchOrPenPointerDown(e: React.PointerEvent, action: () => void) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (e.pointerType === "touch" || e.pointerType === "pen") {
    e.preventDefault();
    action();
  }
}

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
  const [mcSelected, setMcSelected] = useState<number[]>([]);
  const mcSelectedRef = useRef(mcSelected);
  mcSelectedRef.current = mcSelected;
  const [singlePickedId, setSinglePickedId] = useState<number | null>(null);
  const singlePickedRef = useRef<number | null>(null);
  singlePickedRef.current = singlePickedId;
  const mcAutoTimeSubmitRef = useRef(false);
  const [draggingOid, setDraggingOid] = useState<number | null>(null);
  const [matchPairs, setMatchPairs] = useState<Map<number, number>>(new Map());
  const [matchPendingLeft, setMatchPendingLeft] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

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
      return;
    }
    const slash = orderResetKey.indexOf("/");
    const idsPart = slash >= 0 ? orderResetKey.slice(slash + 1) : "";
    setOrderIds(
      idsPart ? idsPart.split(",").map(Number).filter((n) => !Number.isNaN(n)) : [],
    );
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
    mcAutoTimeSubmitRef.current = true;
    playSubmit();
    onSubmit([...mcSelectedRef.current]);
  }, [mcIsMulti, disabled, state.phase, timeLeft, onSubmit]);

  useEffect(() => {
    if (mcIsMulti || disabled || state.phase !== "question") return;
    if (questionType !== "multiple_choice") return;
    if (timeLeft !== 0) return;
    if (mcAutoTimeSubmitRef.current) return;
    const id = singlePickedRef.current;
    if (id === null) return;
    mcAutoTimeSubmitRef.current = true;
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
                onPointerDown={(e) => {
                  if (disabled) return;
                  onTouchOrPenPointerDown(e, () => onOddPick(s.index));
                }}
                onClick={() => onOddPick(s.index)}
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
    const toggleMc = (originalId: number) => {
      if (disabled) return;
      playClick();
      setMcSelected((prev) => {
        const s = new Set(prev);
        if (s.has(originalId)) s.delete(originalId);
        else s.add(originalId);
        const next = [...s].sort((a, b) => a - b);
        mcSelectedRef.current = next;
        return next;
      });
    };
    const submitMc = () => {
      const ids = mcSelectedRef.current;
      if (ids.length === 0) return;
      playSubmit();
      onSubmit(ids);
    };
    const pickSingleMc = (originalId: number) => {
      playClick();
      singlePickedRef.current = originalId;
      setSinglePickedId(originalId);
    };
    const submitSingleMc = () => {
      const id = singlePickedRef.current;
      if (id === null) return;
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
                onPointerDown={(e) => {
                  if (disabled) return;
                  onTouchOrPenPointerDown(e, pickOpt);
                }}
                onClick={pickOpt}
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
            onPointerDown={(e) => {
              if (disabled || mcSelectedRef.current.length === 0) return;
              onTouchOrPenPointerDown(e, submitMc);
            }}
            onClick={submitMc}
          >
            Submit answer
          </button>
        ) : (
          <button
            type="button"
            className="kh-btn kh-btn-primary qp-submit"
            disabled={disabled || singlePickedId === null}
            onPointerDown={(e) => {
              if (disabled || singlePickedRef.current === null) return;
              onTouchOrPenPointerDown(e, submitSingleMc);
            }}
            onClick={submitSingleMc}
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
            onPointerDown={(e) => {
              if (disabled) return;
              onTouchOrPenPointerDown(e, () => {
                playSubmit();
                onSubmit(val);
              });
            }}
            onClick={() => {
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
      playClick();
      const rect = imgRef.current.getBoundingClientRect();
      const rw = rect.width;
      const rh = rect.height;
      if (rw <= 0 || rh <= 0) return;
      const x = (clientX - rect.left) / rw;
      const y = (clientY - rect.top) / rh;
      onSubmit({ x, y });
    };
    const onImgClick = (e: React.MouseEvent<HTMLDivElement>) => {
      submitImgPt(e.clientX, e.clientY);
    };
    return (
      <div className={qpWrapClass}>
        <div className="qp-timer">{timeLeft !== null ? `${timeLeft}s` : ""}</div>
        <h2 className="qp-qtext">{String((q as { question: string }).question)}</h2>
        <p className="qp-hint">Tap the correct spot on the image.</p>
        <div
          className="qp-click"
          onPointerDown={(e) => {
            if (disabled) return;
            if (e.pointerType === "mouse" && e.button !== 0) return;
            onTouchOrPenPointerDown(e, () => submitImgPt(e.clientX, e.clientY));
          }}
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
      playClick();
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
      playClick();
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
          onPointerDown={(e) => {
            if (disabled) return;
            onTouchOrPenPointerDown(e, matchTap);
          }}
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
                      onPointerDown={(e) => {
                        if (disabled || !canTapRight) return;
                        onTouchOrPenPointerDown(e, () => onRightTap(row.id));
                      }}
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
          onPointerDown={(e) => {
            if (disabled || !complete) return;
            onTouchOrPenPointerDown(e, submitMatch);
          }}
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
        return next;
      });
      playClick();
    };

    const onDragStart = (oid: number) => (e: React.DragEvent) => {
      if (disabled) return;
      e.dataTransfer.setData("text/plain", String(oid));
      e.dataTransfer.effectAllowed = "move";
      setDraggingOid(oid);
    };

    const onDragEnd = () => setDraggingOid(null);

    const onDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    };

    const onDrop = (targetIdx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      const fromOid = Number(e.dataTransfer.getData("text/plain"));
      setDraggingOid(null);
      if (Number.isNaN(fromOid)) return;
      const fromIdx = orderIds.indexOf(fromOid);
      if (fromIdx < 0 || fromIdx === targetIdx) return;
      move(fromIdx, targetIdx);
    };

    return (
      <div className={qpWrapClass}>
        <div className="qp-timer">{timeLeft !== null ? `${timeLeft}s` : ""}</div>
        <h2 className="qp-qtext">{String((q as { question: string }).question)}</h2>
        <p className="qp-hint">Drag rows to order (top = first). Arrows still work.</p>
        <ul className="qp-order-list">
          {orderIds.map((oid, idx) => (
            <li
              key={oid}
              className={
                "qp-order-item" +
                (draggingOid === oid ? " qp-order-item-dragging" : "")
              }
              draggable={!disabled}
              onDragStart={onDragStart(oid)}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDrop={onDrop(idx)}
            >
              <span className="qp-order-grip" aria-hidden>
                ⋮⋮
              </span>
              <span className="qp-order-text">{byId.get(oid)}</span>
              <span className="qp-order-actions">
                <button
                  type="button"
                  disabled={disabled || idx === 0}
                  onPointerDown={(e) => {
                    if (disabled || idx === 0) return;
                    onTouchOrPenPointerDown(e, () => move(idx, idx - 1));
                  }}
                  onClick={() => move(idx, idx - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={disabled || idx === orderIds.length - 1}
                  onPointerDown={(e) => {
                    if (disabled || idx === orderIds.length - 1) return;
                    onTouchOrPenPointerDown(e, () => move(idx, idx + 1));
                  }}
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
          onPointerDown={(e) => {
            if (disabled) return;
            onTouchOrPenPointerDown(e, () => {
              playSubmit();
              onSubmit(orderIds);
            });
          }}
          onClick={() => {
            playSubmit();
            onSubmit(orderIds);
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
