import React from "react";
import { camootWarn } from "./log";

/**
 * Catches render errors so production builds don’t leave an empty #root (common on strict mobile engines).
 */
type Props = React.PropsWithChildren;

export default class RouteErrorBoundary extends React.Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    camootWarn("error-boundary", error.stack || error.message);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="kh-page"
          style={{
            padding: "2rem 1rem",
            color: "#fff",
            textAlign: "center",
            fontWeight: 600,
            textShadow: "0 1px 3px rgba(0,0,0,0.5)",
          }}
        >
          <p style={{ margin: "0 0 0.75rem", fontSize: "1.1rem" }}>Something went wrong loading this screen.</p>
          <p style={{ margin: 0, opacity: 0.9, fontSize: "0.95rem" }}>
            Try refreshing the page. If it keeps happening, use another browser or turn off Cloudflare Rocket Loader.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
