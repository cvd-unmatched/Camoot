const headers = (token?: string | null): HeadersInit => {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["X-Manager-Token"] = token;
  return h;
};

export async function managerLogin(password: string) {
  const r = await fetch("/api/manager/login", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ password }),
  });
  if (!r.ok) throw new Error("Invalid password");
  const j = await r.json();
  return j.token as string;
}

export async function listQuizzes(token: string) {
  const r = await fetch("/api/quizzes", { headers: headers(token) });
  if (!r.ok) throw new Error("Unauthorized");
  return r.json();
}

export async function getQuiz(token: string, id: string) {
  const r = await fetch(`/api/quizzes/${id}`, { headers: headers(token) });
  if (!r.ok) throw new Error("Not found");
  return r.json();
}

export async function createQuiz(token: string, title: string) {
  const r = await fetch("/api/quizzes", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ title }),
  });
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

export async function saveQuiz(token: string, quiz: object) {
  const id = (quiz as { id: string }).id;
  const r = await fetch(`/api/quizzes/${id}`, {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify(quiz),
  });
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

export async function deleteQuiz(token: string, id: string) {
  const r = await fetch(`/api/quizzes/${id}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!r.ok) throw new Error("Failed");
}

export async function createGame(token: string, quizId: string) {
  const r = await fetch("/api/games", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ quizId }),
  });
  if (!r.ok) throw new Error("Failed");
  return r.json() as Promise<{ pin: string; hostToken: string; quizTitle: string }>;
}

export async function uploadImage(token: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/upload", {
    method: "POST",
    headers: { "X-Manager-Token": token },
    body: fd,
  });
  if (!r.ok) throw new Error("Upload failed");
  return r.json() as Promise<{ url: string }>;
}

export function qrUrl(pin: string) {
  return `/api/qr?pin=${encodeURIComponent(pin)}`;
}

/** Full URL for players (e.g. WhatsApp). Same path as QR when JOIN_BASE_URL / VITE_JOIN_BASE_URL match the page origin. */
export function playerJoinUrl(pin: string): string {
  const clean = pin.replace(/\D/g, "").slice(0, 6);
  const fromEnv = import.meta.env.VITE_JOIN_BASE_URL?.trim();
  const base = (fromEnv || (typeof window !== "undefined" ? window.location.origin : "")).replace(
    /\/$/,
    "",
  );
  return `${base}/play?pin=${encodeURIComponent(clean)}`;
}

export type LiveSession = {
  pin: string;
  quizTitle: string;
  phase: string;
  playerCount: number;
  quizId: string;
};

export async function listLiveSessions(token: string) {
  const r = await fetch("/api/admin/sessions", { headers: headers(token) });
  if (!r.ok) throw new Error("Unauthorized");
  return r.json() as Promise<LiveSession[]>;
}

export async function terminateLiveSession(token: string, pin: string) {
  const clean = pin.replace(/\D/g, "").slice(0, 6);
  const r = await fetch(`/api/admin/sessions/${clean}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!r.ok) throw new Error("Failed");
}
