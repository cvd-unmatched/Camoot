import { Routes, Route, Navigate } from "react-router-dom";
import NavHome from "./components/NavHome";
import Home from "./pages/Home";
import Manager from "./pages/Manager";
import Host from "./pages/Host";
import Play from "./pages/Play";
import Admin from "./pages/Admin";

export default function App() {
  return (
    <div className="kh-shell">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<Manager />} />
        <Route path="/manager" element={<Navigate to="/create" replace />} />
        <Route path="/host" element={<Host />} />
        <Route path="/play" element={<Play />} />
        <Route path="/admin" element={<Admin />} />
        <Route
          path="*"
          element={
            <div className="kh-page">
              <div className="kh-page-narrow-sm">
                <div className="kh-nav-home-wrap">
                  <NavHome label="Back to home" />
                </div>
                <div className="kh-card" style={{ textAlign: "center" }}>
                  <p style={{ fontWeight: 700, color: "var(--camoot-purple)" }}>Page not found</p>
                  <p style={{ color: "#666" }}>That link doesn’t exist.</p>
                </div>
              </div>
            </div>
          }
        />
      </Routes>
    </div>
  );
}
