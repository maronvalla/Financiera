import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import AppHeader from "../components/AppHeader.jsx";
import { api } from "../lib/api.js";
import { auth } from "../firebase.js";

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2
});

const TABS = [
  { key: "users", label: "Por usuario" },
  { key: "totals", label: "Totales" }
];

const TOP_EMAILS = ["maronexequielvalla@gmail.com", "cpmaron@gmail.com"];

export default function Atesorado() {
  const [activeTab, setActiveTab] = useState("users");
  const [wallets, setWallets] = useState([]);
  const [totals, setTotals] = useState({
    totalLiquidARS: 0,
    totalCobradoARS: 0,
    capitalPrestadoARS: 0,
    totalGeneralARS: 0
  });
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);


  const [recipients, setRecipients] = useState([]);
  const [transferForm, setTransferForm] = useState({ toUid: "", amount: "" });
  const [transferError, setTransferError] = useState("");
  const [transferSuccess, setTransferSuccess] = useState("");
  const [transfering, setTransfering] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user || null);
    });
    return () => unsubscribe();
  }, []);

  const fetchSummary = async () => {
    setLoading(true);
    setPageError("");
    try {
      const { data } = await api.get("/wallets/summary");
      setWallets(Array.isArray(data?.wallets) ? data.wallets : []);
      setTotals({
        totalLiquidARS: Number(data?.totals?.totalLiquidARS || 0),
        totalCobradoARS: Number(data?.totals?.totalCobradoARS || 0),
        capitalPrestadoARS: Number(data?.totals?.capitalPrestadoARS || 0),
        totalGeneralARS: Number(data?.totals?.totalGeneralARS || 0)
      });
    } catch (error) {
      setPageError(error?.response?.data?.message || "No se pudo cargar las wallets.");
    } finally {
      setLoading(false);
    }
  };

  const fetchRecipients = async () => {
    try {
      const { data } = await api.get("/wallets/recipients");
      const items = Array.isArray(data?.items) ? data.items : [];
      setRecipients(items);
      if (items.length === 0) {
        console.warn("[WALLETS_RECIPIENTS_EMPTY]");
      }
    } catch (error) {
      setRecipients([]);
      console.warn("[WALLETS_RECIPIENTS_FAILED]", error);
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    fetchSummary();
    fetchRecipients();
  }, [currentUser]);

  const rows = useMemo(() => wallets, [wallets]);
  const walletsByEmail = useMemo(() => {
    const map = new Map();
    wallets.forEach((wallet) => {
      const email = String(wallet.email || "").trim().toLowerCase();
      if (email) map.set(email, wallet);
    });
    return map;
  }, [wallets]);
  const currentWallet = useMemo(
    () => wallets.find((item) => item.uid === currentUser?.uid) || null,
    [wallets, currentUser]
  );
  const recipientOptions = useMemo(
    () => recipients.filter((item) => item.uid && item.uid !== currentUser?.uid),
    [recipients, currentUser]
  );

  const handleTransferChange = (field) => (event) => {
    const value = event.target.value;
    setTransferForm((prev) => ({ ...prev, [field]: value }));
    setTransferError("");
    setTransferSuccess("");
  };

  const handleTransferSubmit = async (event) => {
    event.preventDefault();
    const amount = Number(transferForm.amount || 0);
    if (!transferForm.toUid) {
      setTransferError("Seleccioná un destinatario.");
      return;
    }
    if (!amount || amount <= 0) {
      setTransferError("Ingresá un monto válido.");
      return;
    }
    if (currentWallet && amount > Number(currentWallet.balance || currentWallet.balanceArs || 0)) {
      setTransferError("El monto supera el saldo disponible.");
      return;
    }
    setTransfering(true);
    setTransferError("");
    setTransferSuccess("");
    try {
      await api.post("/wallets/transfer", {
        toUid: transferForm.toUid,
        amountARS: amount
      });
      setTransferSuccess("Transferencia realizada.");
      setTransferForm({ toUid: "", amount: "" });
      await Promise.all([fetchSummary(), fetchRecipients()]);
    } catch (error) {
      setTransferError(error?.response?.data?.message || "No se pudo transferir.");
    } finally {
      setTransfering(false);
    }
  };

  return (
    <div className="container">
      <AppHeader title="Wallets" />
      <div className="card">
        <h2>Wallets (Atesorado)</h2>
        <p className="muted">Saldos por usuario y transferencias.</p>
      </div>

      <div className="card">
        <div className="section-title">Saldos principales</div>
        {loading && <p className="muted">Cargando saldos...</p>}
        {pageError && <p className="error">{pageError}</p>}
        {!loading && !pageError && (
          <div className="grid">
            {TOP_EMAILS.map((email) => {
              const wallet = walletsByEmail.get(email.toLowerCase());
              const balance = Number(wallet?.balance || wallet?.balanceArs || 0);
              return (
                <div key={email} className="card" style={{ padding: "0.75rem" }}>
                  <div className="muted">Saldo ({email})</div>
                  <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>
                    {currencyFormatter.format(balance)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title">Transferir entre wallets</div>
        {currentWallet && (
          <p className="muted">
            Saldo disponible:{" "}
            {currencyFormatter.format(Number(currentWallet.balance || currentWallet.balanceArs || 0))}
          </p>
        )}
        <form className="form" onSubmit={handleTransferSubmit}>
          <label>
            Destinatario
            <select value={transferForm.toUid} onChange={handleTransferChange("toUid")}>
              <option value="">Seleccionar</option>
              {recipientOptions.map((wallet) => (
                <option key={wallet.uid} value={wallet.uid}>
                  {wallet.email || "Sin asignar"}
                </option>
              ))}
            </select>
          </label>
          {!loading && recipientOptions.length === 0 && (
            <p className="muted">
              No hay destinatarios disponibles. Asegurate de que el otro usuario haya creado su cuenta.
            </p>
          )}
          <label>
            Monto (ARS)
            <input
              type="number"
              min="0"
              step="0.01"
              value={transferForm.amount}
              onChange={handleTransferChange("amount")}
            />
          </label>
          {transferError && <p className="error">{transferError}</p>}
          {transferSuccess && <p style={{ color: "var(--mv-green)" }}>{transferSuccess}</p>}
          <button type="submit" className="btn-primary" disabled={transfering}>
            {transfering ? "Transfiriendo..." : "Transferir"}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="button-row" style={{ flexWrap: "wrap" }}>
          {TABS.map((tab) => (
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
      </div>

      {activeTab === "users" && (
        <div className="card">
          <div className="section-title">Por usuario</div>
          {loading && <p className="muted">Cargando...</p>}
          {pageError && <p className="error">{pageError}</p>}
          {!loading && !pageError && rows.length === 0 && (
            <p className="muted">Inicializando wallets...</p>
          )}
          {!loading && !pageError && rows.length > 0 && (
            <div className="table-scroll" style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Usuario (email)</th>
                    <th>Saldo</th>
                    <th>Movimientos</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const balance = Number(row.balance || row.balanceArs || 0);
                    const movements = Number(row.movementsCount || 0);
                    return (
                      <tr key={row.uid || row.email}>
                        <td>{row.email || "Sin asignar"}</td>
                        <td>{currencyFormatter.format(balance)}</td>
                        <td>{movements}</td>
                        <td>{currencyFormatter.format(balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "totals" && (
        <div className="card">
          <div className="section-title">Totales</div>
          {loading && <p className="muted">Cargando...</p>}
          {pageError && <p className="error">{pageError}</p>}
          {!loading && !pageError && (
            <div className="grid">
              <div className="card" style={{ padding: "0.75rem" }}>
                <div className="muted">Total líquido</div>
                <div style={{ fontWeight: 700 }}>
                  {currencyFormatter.format(Number(totals.totalLiquidARS || 0))}
                </div>
              </div>
              <div className="card" style={{ padding: "0.75rem" }}>
                <div className="muted">Total cobrado</div>
                <div style={{ fontWeight: 700 }}>
                  {currencyFormatter.format(Number(totals.totalCobradoARS || 0))}
                </div>
              </div>
              <div className="card" style={{ padding: "0.75rem" }}>
                <div className="muted">Capital prestado</div>
                <div style={{ fontWeight: 700 }}>
                  {currencyFormatter.format(Number(totals.capitalPrestadoARS || 0))}
                </div>
              </div>
              <div className="card" style={{ padding: "0.75rem" }}>
                <div className="muted">Total general</div>
                <div style={{ fontWeight: 700 }}>
                  {currencyFormatter.format(Number(totals.totalGeneralARS || 0))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
