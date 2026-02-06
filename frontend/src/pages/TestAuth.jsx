import { useState } from "react";
import AppHeader from "../components/AppHeader.jsx";
import { api } from "../lib/api.js";

export default function TestAuth() {
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleTest = async () => {
    setLoading(true);
    setResult("");
    setError("");
    try {
      const { data } = await api.get("/auth/me");
      setResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Error al llamar /auth/me");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <AppHeader title="MV Prestamos - Test Auth" />
      <div className="card">
        <h2>Probar /auth/me</h2>
        <p className="muted">
          Este endpoint verifica que el token de Firebase llegue al backend.
        </p>
      </div>

      <div className="card">
        <button className="btn-primary" type="button" onClick={handleTest} disabled={loading}>
          {loading ? "Probando..." : "Probar /auth/me"}
        </button>
        {error && <p className="error" style={{ marginTop: "1rem" }}>{error}</p>}
        {result && (
          <pre style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }}>{result}</pre>
        )}
      </div>
    </div>
  );
}
