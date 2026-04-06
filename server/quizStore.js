import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const QUIZZES_FILE = path.join(DATA_DIR, "quizzes.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll() {
  ensureDataDir();
  if (!fs.existsSync(QUIZZES_FILE)) {
    const sample = getSampleQuiz();
    fs.writeFileSync(QUIZZES_FILE, JSON.stringify([sample], null, 2), "utf8");
    return [sample];
  }
  try {
    const raw = fs.readFileSync(QUIZZES_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAll(quizzes) {
  ensureDataDir();
  fs.writeFileSync(QUIZZES_FILE, JSON.stringify(quizzes, null, 2), "utf8");
}

export function listQuizzes() {
  return readAll().map((q) => ({ id: q.id, title: q.title, questionCount: (q.questions || []).length }));
}

export function getQuiz(id) {
  return readAll().find((q) => q.id === id) || null;
}

export function saveQuiz(quiz) {
  const quizzes = readAll();
  const idx = quizzes.findIndex((q) => q.id === quiz.id);
  if (idx >= 0) quizzes[idx] = quiz;
  else quizzes.push(quiz);
  writeAll(quizzes);
  return quiz;
}

export function createQuiz({ title }) {
  const quizzes = readAll();
  const quiz = {
    id: uuidv4(),
    title: title || "Untitled quiz",
    questions: [],
  };
  quizzes.push(quiz);
  writeAll(quizzes);
  return quiz;
}

export function deleteQuiz(id) {
  const quizzes = readAll().filter((q) => q.id !== id);
  writeAll(quizzes);
}

function getSampleQuiz() {
  return {
    id: uuidv4(),
    title: "Demo: all question types",
    questions: [
      {
        id: uuidv4(),
        type: "multiple_choice",
        question: "What is 7 × 6?",
        options: ["36", "42", "48", "56"],
        correctIndex: 1,
        timeLimitSec: 20,
        points: 1000,
      },
      {
        id: uuidv4(),
        type: "slider",
        question: "In which year was the first iPhone released?",
        min: 2004,
        max: 2012,
        step: 1,
        correctValue: 2007,
        tolerance: 0,
        timeLimitSec: 25,
        points: 1000,
      },
      {
        id: uuidv4(),
        type: "order",
        question: "Put these numbers in ascending order (lines are the correct order)",
        items: ["1", "2", "5", "9"],
        correctOrder: [0, 1, 2, 3],
        timeLimitSec: 30,
        points: 1000,
      },
      {
        id: uuidv4(),
        type: "odd_color_out",
        question: "Which square is a different color?",
        baseColor: "#0D47A1",
        oddColor: "#64B5F6",
        timeLimitSec: 25,
        points: 1000,
        explanation: "Three deep blue, one lighter blue. Live play randomizes which tile is odd.",
      },
      {
        id: uuidv4(),
        type: "match",
        question: "Match each role to what they do",
        pairs: [
          { left: { text: "Nurse", imageUrl: "https://picsum.photos/seed/demo-nurse/220/220" }, right: { text: "Patient care" } },
          { left: { text: "Engineer", imageUrl: "https://picsum.photos/seed/demo-eng/220/220" }, right: { text: "Build & design" } },
          { left: { text: "Banker", imageUrl: "https://picsum.photos/seed/demo-bank/220/220" }, right: { text: "Finance" } },
        ],
        timeLimitSec: 35,
        points: 1000,
      },
    ],
  };
}
