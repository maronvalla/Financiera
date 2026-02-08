import { useNavigate } from "react-router-dom";
import useKpis from "../hooks/useKpis.js";
import AppHeader from "../components/AppHeader.jsx";

function MenuCard({ title, description, onClick }) {
  return (
    <button type="button" onClick={onClick} className="menu-card">
      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--mv-orange)" }}>
        {title}
      </div>
      <div style={{ color: "rgba(255,255,255,0.75)" }}>{description}</div>
      <div style={{ marginTop: "0.75rem", fontWeight: 600, color: "var(--mv-orange)" }}>
        Abrir →
      </div>
    </button>
  );
}

export default function Menu() {
  const navigate = useNavigate();
  const { collectedTotal, debtorsCount, interestMonth, usdByType } = useKpis();
  const currencyFormatter = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2
  });

  return (
    <div className="container">
      <AppHeader />
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Recaudado total (bruto)</div>
          <div className="kpi-value">{currencyFormatter.format(collectedTotal || 0)}</div>
          <div className="kpi-helper">Pagos históricos acumulados</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Pagos pendientes (deudores)</div>
          <div className="kpi-value">{debtorsCount || 0}</div>
          <div className="kpi-helper">Clientes con saldo activo</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Interés ganado este mes</div>
          <div className="kpi-value">{currencyFormatter.format(interestMonth || 0)}</div>
          <div className="kpi-helper">Según pagos del mes en curso</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">USD por tipo</div>
          <div className="kpi-value">
            <div>Azules: {Number(usdByType?.blue || 0).toFixed(2)}</div>
            <div>Verde Grande: {Number(usdByType?.greenLarge || 0).toFixed(2)}</div>
            <div>Verde Chica: {Number(usdByType?.greenSmall || 0).toFixed(2)}</div>
          </div>
          <div className="kpi-helper">Stock actual por tipo de billete</div>
        </div>
      </div>
      <div className="card">
        <h2>Menú principal</h2>
        <p className="muted">
          Elegí una acción rápida para registrar clientes, préstamos o pagos.
        </p>
      </div>
      <div className="action-grid">
        <MenuCard
          title="Registrar cliente"
          description="Alta rápida de clientes con DNI único."
          onClick={() => navigate("/clientes/nuevo")}
        />
        <MenuCard
          title="Registrar préstamo"
          description="Buscar cliente y cargar condiciones del préstamo."
          onClick={() => navigate("/prestamos/nuevo")}
        />
        <MenuCard
          title="Registrar pagos"
          description="Seleccionar préstamo activo y registrar cobro."
          onClick={() => navigate("/pagos/nuevo")}
        />
        <MenuCard
          title="Préstamos por estado"
          description="Ver préstamos activos, morosos, finalizados e incobrables."
          onClick={() => navigate("/prestamos/estado")}
        />
        <MenuCard
          title="Reportes"
          description="Historial de préstamos y pagos."
          onClick={() => navigate("/prestamos/reportes")}
        />
      </div>
    </div>
  );
}
