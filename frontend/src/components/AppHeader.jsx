import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase.js";

function AppHeader({ title = "MV Préstamos", showBack = true, showLogout = true }) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("[LOGOUT_FAILED]", error);
    }
  };

  return (
    <header className="header">
      <div>
        <h1>{title}</h1>
        <div className="muted">Gestión rápida de clientes, préstamos y pagos</div>
      </div>
      {(showBack || showLogout) && (
        <div className="header-actions">
          {showBack && (
            <button className="btn-secondary" onClick={() => navigate("/")}>
              Volver al menú
            </button>
          )}
          {showLogout && (
            <button className="btn-secondary" onClick={handleLogout}>
              Cerrar sesión
            </button>
          )}
        </div>
      )}
    </header>
  );
}

export default AppHeader;
