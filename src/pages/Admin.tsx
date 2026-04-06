import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import NavHome from "../components/NavHome";
import { listLiveSessions, managerLogin, terminateLiveSession, type LiveSession } from "../api";
import { playUnlockOk, resumeSounds } from "../sounds";

const TOKEN_KEY = "camoot_manager_token";

export default function Admin() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [endingPin, setEndingPin] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadErr(null);
    try {
      const list = await listLiveSessions(token);
      setSessions(list);
    } catch {
      setSessions([]);
      setLoadErr("Session expired.");
      setToken(null);
      sessionStorage.removeItem(TOKEN_KEY);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!token) return;
    const t = setInterval(() => {
      void refresh();
    }, 8000);
    return () => clearInterval(t);
  }, [token, refresh]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr(null);
    try {
      const t = await managerLogin(password);
      sessionStorage.setItem(TOKEN_KEY, t);
      setToken(t);
      setPassword("");
      resumeSounds();
      playUnlockOk();
    } catch {
      setLoginErr("Wrong password.");
    }
  };

  const logout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setSessions([]);
  };

  const endSession = async (pin: string) => {
    if (!token) return;
    if (!confirm(`Force-close the live session ${pin}? Everyone will be disconnected.`)) return;
    setEndingPin(pin);
    setLoadErr(null);
    try {
      await terminateLiveSession(token, pin);
      await refresh();
    } catch {
      setLoadErr("Could not end that session.");
    } finally {
      setEndingPin(null);
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
            <h1 style={{ marginTop: 0, color: "var(--camoot-purple)" }}>Admin</h1>
            <p style={{ color: "#555", lineHeight: 1.5 }}>
              Same password as <strong>Create</strong>. Lists active live games (PIN lobbies and in-progress quizzes) so you can force-close a stuck session.
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
                Sign in
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="kh-page">
      <div className="kh-page-narrow">
        <div className="kh-nav-home-wrap">
          <NavHome label="Back to home" />
        </div>
        <div className="kh-card" style={{ maxWidth: "100%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, color: "var(--camoot-purple)" }}>Live sessions</h1>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="kh-btn kh-btn-outline kh-btn-sm" disabled={loading} onClick={() => void refresh()}>
                Refresh
              </button>
              <button type="button" className="kh-btn kh-btn-outline kh-btn-sm" onClick={logout}>
                Log out
              </button>
            </div>
          </div>
          <p style={{ color: "#666", marginBottom: "1rem" }}>
            Force-close removes the game from the server and notifies players and host. Normal endings should use <Link to="/host">Host</Link> → End quiz.
          </p>
          {loadErr && <p style={{ color: "var(--camoot-pink)", fontWeight: 600 }}>{loadErr}</p>}
          {loading && sessions.length === 0 && <p>Loading…</p>}
          {!loading && sessions.length === 0 && <p style={{ color: "#666" }}>No active live sessions.</p>}
          {sessions.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {sessions.map((s) => (
                <li
                  key={s.pin}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.75rem",
                    padding: "0.85rem 0",
                    borderBottom: "1px solid #eee",
                  }}
                >
                  <div>
                    <strong style={{ fontSize: "1.05rem" }}>{s.quizTitle}</strong>
                    <div style={{ fontSize: "0.9rem", color: "#555", marginTop: "0.2rem" }}>
                      PIN <strong>{s.pin}</strong> · {s.phase} · {s.playerCount} player
                      {s.playerCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="kh-btn kh-btn-danger kh-btn-sm"
                    disabled={endingPin === s.pin}
                    onClick={() => void endSession(s.pin)}
                  >
                    {endingPin === s.pin ? "Ending…" : "End session"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
