import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { err: error };
  }

  componentDidCatch(error, info) {
    this.setState({ err: error, info });
  }

  render() {
    const { err, info } = this.state;

    if (err) {
      return (
        <div style={{ padding: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>App crashed</h2>

          <p style={{ marginTop: 12 }}>
            <strong>Message:</strong> {String(err?.message || err)}
          </p>

          {err?.stack && (
            <>
              <h3 style={{ marginTop: 16, fontSize: 14, fontWeight: 600 }}>Stack</h3>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                {String(err.stack)}
              </pre>
            </>
          )}

          {info?.componentStack && (
            <>
              <h3 style={{ marginTop: 16, fontSize: 14, fontWeight: 600 }}>
                Component stack
              </h3>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                {String(info.componentStack)}
              </pre>
            </>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
