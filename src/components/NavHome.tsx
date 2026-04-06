import { Link } from "react-router-dom";
import { playClick, resumeSounds } from "../sounds";

type Props = {
  /** Shown after the arrow, e.g. "Home" or "Back to home". */
  label?: string;
  className?: string;
};

/**
 * Prominent link back to the landing page (pill style, top of secondary screens).
 */
export default function NavHome({ label = "Home", className = "" }: Props) {
  return (
    <Link
      to="/"
      className={`kh-nav-home ${className}`.trim()}
      onClick={() => {
        resumeSounds();
        playClick();
      }}
    >
      <span className="kh-nav-home-arrow" aria-hidden>
        ←
      </span>
      <span className="kh-nav-home-label">{label}</span>
    </Link>
  );
}
