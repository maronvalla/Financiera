import { Component } from "react";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("[UI_ERROR_BOUNDARY]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h2>Ocurrió un error</h2>
          <p className="muted">Recargá la página.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
