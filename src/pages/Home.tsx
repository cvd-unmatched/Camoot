import { Link } from "react-router-dom";
import { playMenuTap, resumeSounds } from "../sounds";
import "../styles/home.css";

export default function Home() {
  return (
    <div className="home-page">
    <div className="home-root">
      <div className="home-brand">
        <h1 className="home-title" aria-label="Camoot!">
          <span className="home-title-text">Camoot</span>
          <span className="home-title-bang" aria-hidden>
            !
          </span>
        </h1>
        <p className="home-sub">Play together</p>
      </div>

      <nav className="home-actions" aria-label="Main">
        <Link
          className="home-action home-action-join"
          to="/play"
          onClick={() => {
            resumeSounds();
            playMenuTap();
          }}
        >
          <span className="home-action-icon home-action-icon-join" aria-hidden>
            🎯
          </span>
          <span className="home-action-text">
            <span className="home-action-title">Join</span>
            <span className="home-action-hint">Enter a game PIN</span>
          </span>
        </Link>

        <Link
          className="home-action home-action-host"
          to="/host"
          onClick={() => {
            resumeSounds();
            playMenuTap();
          }}
        >
          <span className="home-action-icon home-action-icon-host" aria-hidden>
            🎤
          </span>
          <span className="home-action-text">
            <span className="home-action-title">Host</span>
            <span className="home-action-hint">Pick a quiz you made & go live</span>
          </span>
        </Link>

        <Link
          className="home-action home-action-create"
          to="/create"
          onClick={() => {
            resumeSounds();
            playMenuTap();
          }}
        >
          <span className="home-action-icon home-action-icon-create" aria-hidden>
            ✏️
          </span>
          <span className="home-action-text">
            <span className="home-action-title">Create</span>
            <span className="home-action-hint">Build quizzes (password required)</span>
          </span>
        </Link>
      </nav>

      <p className="home-admin-foot">
        <Link to="/admin" className="home-admin-foot-link">
          Admin · live sessions
        </Link>
      </p>
    </div>
    </div>
  );
}
