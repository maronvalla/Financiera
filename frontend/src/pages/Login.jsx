import { useEffect, useState } from "react";
import { signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader.jsx";
import { auth } from "../firebase.js";

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) navigate("/", { replace: true });
    });
    return () => unsubscribe();
  }, [navigate]);

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, form.email.trim(), form.password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err?.message || "No se pudo iniciar sesión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <AppHeader showBack={false} />
      <div className="card auth-card">
        <h2>Iniciar sesión</h2>
        <p className="muted">Ingresá tus credenciales para continuar.</p>
        <form className="form" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={handleChange("email")}
              required
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={form.password}
              onChange={handleChange("password")}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn-primary btn-large" type="submit" disabled={loading}>
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}

