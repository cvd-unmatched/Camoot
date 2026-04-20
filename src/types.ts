export type QuestionType =
  | "multiple_choice"
  | "music"
  | "slider"
  | "click_location"
  | "order"
  | "match"
  | "odd_color_out";

/** One cell in a match / connect-pairs question (text and optional image). */
export type MatchItem = {
  text: string;
  imageUrl?: string;
};

export type MatchPair = {
  left: MatchItem;
  right: MatchItem;
};

/** One MC answer. Use `string` in JSON for simple options; object when marking trap answers. */
export type McOption = {
  text: string;
  /** If the question has `mcPenaltyPoints`, subtracts that total once when wrong and this option is among wrong picks. */
  penalizeIfWrong?: boolean;
};

type QCommon = {
  explanation?: string;
  /** If true, any submitted answer is treated as correct (fun/joke questions). */
  anyAnswerCorrect?: boolean;
  /** For slider / click / order only. Multiple choice uses `mcPenaltyPoints` + per-option checkboxes. */
  penaltyOnWrong?: boolean;
  penaltyPoints?: number;
};

export type QuizQuestion =
  | (QCommon & {
      id: string;
      type: "multiple_choice";
      question: string;
      /** Optional image shown above the answer choices (same `/uploads/…` URLs as elsewhere). */
      imageUrl?: string;
      options: (string | McOption)[];
      correctIndex?: number;
      correctIndices?: number[];
      /** If > 0, wrong answers that include any option marked `penalizeIfWrong` lose this many points once. */
      mcPenaltyPoints?: number;
      /** If true (default), each player sees options in a random order. */
      shuffleOptions?: boolean;
      timeLimitSec?: number;
      points?: number;
    })
  | (QCommon & {
      id: string;
      type: "music";
      question: string;
      /** Host-only playback clip URL (typically `/uploads/...`). */
      audioUrl: string;
      /** Optional artwork shown to players/host when enabled. */
      coverImageUrl?: string;
      /** Optional metadata text (can be hidden per-question). */
      artist?: string;
      title?: string;
      trackNumber?: number;
      /** Controls which metadata is shown during the question. */
      showArtist?: boolean;
      showTitle?: boolean;
      showCoverArt?: boolean;
      options: string[];
      correctIndex: number;
      timeLimitSec?: number;
      points?: number;
    })
  | (QCommon & {
      id: string;
      type: "slider";
      question: string;
      min: number;
      max: number;
      step?: number;
      correctValue: number;
      tolerance?: number;
      timeLimitSec?: number;
      points?: number;
    })
  | (QCommon & {
      id: string;
      type: "click_location";
      question: string;
      imageUrl: string;
      correctRegion: { x: number; y: number; radius?: number };
      timeLimitSec?: number;
      points?: number;
    })
  | (QCommon & {
      id: string;
      type: "order";
      question: string;
      items: string[];
      correctOrder: number[];
      timeLimitSec?: number;
      points?: number;
    })
  | (QCommon & {
      id: string;
      type: "match";
      question: string;
      /** Each row is one correct pair: left card ↔ right card (same index after shuffle). */
      pairs: MatchPair[];
      timeLimitSec?: number;
      points?: number;
    })
  | (QCommon & {
      id: string;
      type: "odd_color_out";
      question: string;
      /** Hex fill for the three identical squares (e.g. #2E7D32). */
      baseColor: string;
      /** Slightly different hex for the odd square out. */
      oddColor: string;
      timeLimitSec?: number;
      points?: number;
    });

export type Quiz = {
  id: string;
  title: string;
  questions: QuizQuestion[];
  /** When true, the server shuffles `questions` once when the host starts the game (each play-through can differ). */
  shuffleQuestionOrder?: boolean;
};

export type GameState = {
  pin: string;
  phase: "lobby" | "question" | "reveal" | "ended";
  questionIndex: number;
  totalQuestions: number;
  quizTitle: string;
  /** Host-only: `connected` in lobby; `answered` during the question phase. */
  players: { id: string; name: string; score: number; connected?: boolean; answered?: boolean }[];
  question: Record<string, unknown> | null;
  questionStartedAt: number | null;
  serverTime: number;
  reveal?: Record<string, unknown>;
};
