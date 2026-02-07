import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader.jsx";

function HomeCard({ title, description, onClick }) {
  return (
    <button type="button" onClick={onClick} className="menu-card">
      <div style={{ fontSize: "1.35rem", fontWeight: 700, color: "var(--mv-orange)" }}>
        {title}
      </div>
      <div style={{ color: "rgba(255,255,255,0.75)" }}>{description}</div>
      <div style={{ marginTop: "0.75rem", fontWeight: 600, color: "var(--mv-orange)" }}>
        Abrir →
      </div>
    </button>
  );
}

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="container">
      <AppHeader showBack={false} />
      <div className="card">
        <h2>Menu inicial</h2>
        <p className="muted">Elegi el modulo que queres abrir.</p>
      </div>
      <div className="action-grid">
        <HomeCard
          title="Prestamos"
          description="Gestion de clientes, prestamos y pagos."
          onClick={() => navigate("/prestamos")}
        />
        <HomeCard
          title="Dolares"
          description="Registro de compras/ventas USD y reportes contables."
          onClick={() => navigate("/dolares")}
        />
        <HomeCard
          title="Wallets"
          description="Billeteras por usuario y transferencias."
          onClick={() => navigate("/atesorado")}
        />
      </div>
    </div>
  );
}
