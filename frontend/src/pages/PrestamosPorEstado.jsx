import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader.jsx";
import { api } from "../lib/api.js";

const STATUS_TABS = [
  { key: "active", label: "Activos" },
  { key: "finished", label: "Finalizados" },
  { key: "late", label: "Morosos" },
  { key: "bad_debt", label: "Incobrables" }
];

const STATUS_LABELS = {
  active: "Activo",
  finished: "Finalizado",
  late: "Moroso",
  bad_debt: "Incobrable"
};

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2
});

export default function PrestamosPorEstado() {
  const [loans, setLoans] = useState({
    active: [],
    late: [],
    bad_debt: [],
    finished: []
  });
  const [loadingLoans, setLoadingLoans] = useState(false);
  const [loansError, setLoansError] = useState("");
  const [activeTab, setActiveTab] = useState("active");

  useEffect(() => {
    let cancelled = false;

    const fetchLoans = async () => {
      setLoadingLoans(true);
      setLoansError("");
      try {
        const { data } = await api.get("/loans/by-status");
        if (!cancelled) {
          setLoans({
            active: Array.isArray(data?.active) ? data.active : [],
            late: Array.isArray(data?.late) ? data.late : [],
            bad_debt: Array.isArray(data?.bad_debt) ? data.bad_debt : [],
            finished: Array.isArray(data?.finished) ? data.finished : []
          });
        }
      } catch (error) {
        if (!cancelled) {
          setLoansError(error?.response?.data?.message || "No se pudieron cargar los préstamos.");
        }
      } finally {
        if (!cancelled) setLoadingLoans(false);
      }
    };

    fetchLoans();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredLoans = useMemo(() => loans[activeTab] || [], [loans, activeTab]);

  const handleMarkBadDebt = async (loan) => {
    const reason = window.prompt(
      "Motivo de incobrable (opcional):",
      ""
    );
    try {
      await api.post(`/loans/${loan.id}/mark-bad-debt`, { reason: reason || "" });
      const { data } = await api.get("/loans/by-status");
      setLoans({
        active: Array.isArray(data?.active) ? data.active : [],
        late: Array.isArray(data?.late) ? data.late : [],
        bad_debt: Array.isArray(data?.bad_debt) ? data.bad_debt : [],
        finished: Array.isArray(data?.finished) ? data.finished : []
      });
    } catch (error) {
      setLoansError(error?.response?.data?.message || "No se pudo marcar incobrable.");
    }
  };

  return (
    <div className="container">
      <AppHeader />
      <div className="card">
        <h2>Préstamos por estado</h2>
        <p className="muted">Filtra y visualiza los préstamos según su estado.</p>
      </div>

      <div className="card">
        <div className="button-row" style={{ flexWrap: "wrap" }}>
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={activeTab === tab.key ? "btn-primary btn-large" : "btn-secondary btn-large"}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {loadingLoans && <p className="muted" style={{ marginTop: "1rem" }}>Cargando...</p>}
        {loansError && <p className="error" style={{ marginTop: "1rem" }}>{loansError}</p>}
        {!loadingLoans && !loansError && filteredLoans.length === 0 && (
          <p className="muted" style={{ marginTop: "1rem" }}>
            No hay préstamos para mostrar.
          </p>
        )}
        {!loadingLoans && !loansError && filteredLoans.length > 0 && (
          <div className="list" style={{ gridTemplateColumns: "1fr" }}>
            {filteredLoans.map((loan) => (
              <div key={loan.id} className="card" style={{ padding: "1rem" }}>
                <div style={{ fontWeight: 700 }}>
                  {loan.customerName || loan.customerId || "Cliente"}
                </div>
                <div className="muted">
                  Saldo: {currencyFormatter.format(Number(loan.balance || 0))}
                </div>
                <div className="muted">
                  Estado: {STATUS_LABELS[loan.status] || loan.status || "Activo"}
                </div>
                {activeTab === "late" && (
                  <button
                    type="button"
                    className="btn-danger"
                    style={{ marginTop: "0.75rem" }}
                    onClick={() => handleMarkBadDebt(loan)}
                  >
                    Marcar incobrable
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
