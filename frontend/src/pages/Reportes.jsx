import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader.jsx";
import { api } from "../lib/api.js";
import { auth } from "../firebase.js";
import { useAuth } from "../context/AuthContext.jsx";

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2
});

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDate(value) {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : "Sin fecha";
}

function formatDateTime(value) {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date) : "Sin fecha";
}

function getTypeLabel(type) {
  switch (type) {
    case "loan_create":
      return "Préstamo alta";
    case "loan_void":
      return "Préstamo anulado";
    case "payment_create":
      return "Pago";
    case "payment_void":
      return "Pago anulado";
    case "usd_buy":
      return "Compra USD";
    case "usd_sell":
      return "Venta USD";
    case "usd_void":
      return "Anulación USD";
    default:
      return type || "Movimiento";
  }
}

function formatDetail(item) {
  if (!item) return "-";
  if (item.type === "loan_create" || item.type === "loan_void") {
    const loan = item.loan || {};
    const principal = Number(loan.principal || 0);
    const rate = Number(loan.interestRate || 0);
    const frequency = loan.frequency || "-";
    const loanType = loan.loanType || "-";
    return `Principal ${currencyFormatter.format(principal)} · Interés ${rate}% · ${frequency} · ${loanType}`;
  }
  if (item.type === "payment_create" || item.type === "payment_void") {
    const payment = item.payment || {};
    const amount = currencyFormatter.format(Number(payment.amount || 0));
    const interestTotal = Number(payment.interestTotal || 0);
    const interestMine = Number(payment.interestMine || 0);
    const interestIntermediary = Number(payment.interestIntermediary || 0);
    return `Monto ${amount} · Interés ${currencyFormatter.format(interestTotal)} · Mío ${currencyFormatter.format(
      interestMine
    )} · Intermediario ${currencyFormatter.format(interestIntermediary)}`;
  }
  if (item.type === "usd_buy" || item.type === "usd_sell" || item.type === "usd_void") {
    const usd = item.usd || {};
    const usdQty = Number(usd.usd || 0);
    const price = Number(usd.price || 0);
    const totalArs = Number(usd.totalArs || 0);
    return `USD ${usdQty} · ${currencyFormatter.format(price)} · Total ${currencyFormatter.format(totalArs)}`;
  }
  return item.note || "-";
}

export default function Reportes() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payments, setPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState("");
  const [includeVoided, setIncludeVoided] = useState(false);
  const [profitYear, setProfitYear] = useState(new Date().getFullYear());
  const [profitItems, setProfitItems] = useState([]);
  const [profitError, setProfitError] = useState("");
  const [loadingProfit, setLoadingProfit] = useState(false);
  const { isAdmin } = useAuth();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const filteredItems = useMemo(() => {
    return Array.isArray(items) ? items : [];
  }, [items]);

  const fetchReports = async (signal) => {
    setLoading(true);
    setError("");
    try {
      if (auth.currentUser?.getIdToken) {
        await auth.currentUser.getIdToken(true);
      }
      const response = await api.get("/reports", {
        params: {
          q: query.trim() || undefined,
          type
        },
        signal
      });
      const data = response?.data;
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      if (signal?.aborted) return;
      const status = err?.response?.status;
      if (status === 403) {
        setError("No ten\u00e9s permisos para ver reportes.");
      } else if (status === 401) {
        setError("Iniciá sesión para ver reportes.");
      } else {
        setError(err?.response?.data?.message || "No se pudieron cargar los reportes.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  const fetchPayments = async (signal) => {
    setPaymentsLoading(true);
    setPaymentsError("");
    try {
      if (auth.currentUser?.getIdToken) {
        await auth.currentUser.getIdToken(true);
      }
      const response = await api.get("/payments", {
        params: {
          q: query.trim() || undefined,
          includeVoided: includeVoided ? 1 : 0
        },
        signal
      });
      const data = response?.data;
      setPayments(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      if (signal?.aborted) return;
      const status = err?.response?.status;
      if (status === 403) {
        setPaymentsError("No ten\u00e9s permisos para ver pagos.");
      } else if (status === 401) {
        setPaymentsError("Iniciá sesión para ver pagos.");
      } else {
        setPaymentsError(err?.response?.data?.message || "No se pudieron cargar los pagos.");
      }
    } finally {
      if (!signal?.aborted) {
        setPaymentsLoading(false);
      }
    }
  };

  const fetchProfitMonthly = async (signal) => {
    setLoadingProfit(true);
    setProfitError("");
    try {
      if (auth.currentUser?.getIdToken) {
        await auth.currentUser.getIdToken(true);
      }
      const response = await api.get("/profits/monthly", {
        params: { year: profitYear },
        signal
      });
      const data = response?.data;
      setProfitItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      if (signal?.aborted) return;
      setProfitError(err?.response?.data?.message || "No se pudo cargar el resumen.");
    } finally {
      if (!signal?.aborted) {
        setLoadingProfit(false);
      }
    }
  };

  

  const canVoidPayments = useMemo(() => isAdmin, [isAdmin]);
  const canVoidMovements = true;
  const canVoid = deleteTarget?.kind === "payment" ? canVoidPayments : canVoidMovements;

  useEffect(() => {
    const controller = new AbortController();
    const handle = setTimeout(() => {
      if (type === "payments") {
        fetchPayments(controller.signal);
      } else {
        fetchReports(controller.signal);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [query, type, refreshKey, includeVoided]);

  

  useEffect(() => {
    const controller = new AbortController();
    fetchProfitMonthly(controller.signal);
    return () => controller.abort();
  }, [profitYear]);

  

  

  useEffect(() => {
    if (!toastMessage) return undefined;
    const timer = setTimeout(() => setToastMessage(""), 2500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const handleOpenDelete = (item, kind = "movement") => {
    setDeleteTarget({ ...item, kind });
    setDeleteReason("");
    setDeleteError("");
  };

  const handleCloseDelete = () => {
    setDeleteTarget(null);
    setDeleteReason("");
    setDeleteError("");
    setDeleting(false);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      if (auth.currentUser?.getIdToken) {
        await auth.currentUser.getIdToken(true);
      }
      if (deleteTarget.kind === "payment") {
        await api.post(`/payments/${deleteTarget.id}/void`, { reason: deleteReason || "" });
      } else {
        await api.delete(`/reports/movements/${deleteTarget.id}`, {
          data: { reason: deleteReason || "" }
        });
      }
      handleCloseDelete();
      setRefreshKey((prev) => prev + 1);
      setToastMessage(deleteTarget.kind === "payment" ? "Pago anulado" : "Movimiento anulado");
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      if (import.meta.env.DEV) {
        console.warn("[REPORTS_VOID_FAILED]", { status, message: data?.message || err?.message });
      }
      if (status === 401) {
        setDeleteError("Sesión vencida, volvé a iniciar sesión");
      } else if (status === 403) {
        setDeleteError("No ten\u00e9s permisos para anular esta operaci\u00f3n.");
      } else if (status === 404) {
        setDeleteError(deleteTarget.kind === "payment" ? "El pago ya no existe." : "El movimiento ya no existe.");
      } else {
        setDeleteError(data?.message || "No se pudo anular el movimiento.");
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="container">
      <AppHeader title="Reportes" />
      <div className="card">
        <h2>Historial del sistema</h2>
        <p className="muted">Filtrá préstamos y pagos, y anulá movimientos.</p>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3>Ganancia por mes</h3>
            <p className="muted">Intereses según fecha real de pago.</p>
          </div>
          <div className="card-header-actions">
            <select value={profitYear} onChange={(event) => setProfitYear(Number(event.target.value))}>
              {[profitYear - 2, profitYear - 1, profitYear, profitYear + 1].map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>
        {loadingProfit && <p className="muted">Cargando...</p>}
        {!loadingProfit && profitError && <p className="error">{profitError}</p>}
        {!loadingProfit && !profitError && (
          <div className="table-scroll" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Mi ganancia</th>
                  <th>Intermediarios</th>
                  <th>Total Interés</th>
                </tr>
              </thead>
              <tbody>
                {profitItems.map((item) => (
                  <tr key={item.month}>
                    <td>{item.month}</td>
                    <td>{currencyFormatter.format(Number(item.mineArs || 0))}</td>
                    <td>{currencyFormatter.format(Number(item.intermediaryArs || 0))}</td>
                    <td>{currencyFormatter.format(Number(item.interestTotalArs || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="form form-grid" style={{ marginBottom: 0 }}>
          <label>
            Buscar (DNI o nombre)
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ej: 30123456 o Ana"
            />
          </label>
          <label>
            Tipo
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="all">Todo</option>
              <option value="loans">préstamos</option>
              <option value="payments">Pagos</option>
              <option value="usd">Dólares</option>
            </select>
          </label>

      {type === "payments" && (
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              Ver anulados
              <input
                type="checkbox"
                checked={includeVoided}
                onChange={(event) => setIncludeVoided(event.target.checked)}
              />
            </label>
          )}
        </div>
      </div>

      {type === "payments" ? (
        <div className="card">
          <div className="section-title">Pagos</div>
          {paymentsLoading && <p className="muted">Cargando...</p>}
          {paymentsError && <p className="error">{paymentsError}</p>}
          {!paymentsLoading && !paymentsError && payments.length === 0 && (
            <p className="muted">No hay pagos para mostrar.</p>
          )}
          {!paymentsLoading && !paymentsError && payments.length > 0 && (
            <div className="table-scroll" style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha real</th>
                    <th>Cliente</th>
                    <th>Préstamo</th>
                    <th>Cuota</th>
                    <th>Monto</th>
                    <th>Método</th>
                    <th>Nota</th>
                    <th>Usuario</th>
                    <th>Estado</th>
                    <th style={{ width: 40, minWidth: 40, textAlign: "center" }} />
                  </tr>
                </thead>
                <tbody>
                  {payments.map((item) => {
                    const customerName = item.customer?.name || "-";
                    const customerDni = item.customer?.dni || "-";
                    const statusLabel = item.isVoided ? "ANULADO" : "ACTIVO";
                    return (
                      <tr key={item.id}>
                        <td>{formatDate(item.paymentDate)}</td>
                        <td>
                          <div>{customerName}</div>
                          <div className="muted" style={{ fontSize: "0.85rem" }}>
                            {customerDni}
                          </div>
                        </td>
                        <td>{item.loanId || "-"}</td>
                        <td>{item.installmentNumber || "-"}</td>
                        <td>{currencyFormatter.format(Number(item.amount || 0))}</td>
                        <td>{item.method || "-"}</td>
                        <td>{item.note || "-"}</td>
                        <td>{item.actorEmail || "unknown"}</td>
                        <td>{statusLabel}</td>
                        <td style={{ width: 40, minWidth: 40, textAlign: "center" }}>
                          {canVoidPayments && !item.isVoided && (
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{
                                padding: "0.4rem",
                                borderRadius: "0.375rem",
                                minWidth: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center"
                              }}
                              onClick={() => handleOpenDelete(item, "payment")}
                              aria-label="Anular pago"
                              title="Anular"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                width="18"
                                height="18"
                                fill="currentColor"
                                aria-hidden="true"
                              >
                                <path d="M9 3a1 1 0 0 0-1 1v1H5.5a1 1 0 1 0 0 2H6v11a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7h.5a1 1 0 1 0 0-2H16V4a1 1 0 0 0-1-1H9Zm1 2h4v1h-4V5Zm-1 5a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1Zm6 1a1 1 0 1 0-2 0v7a1 1 0 1 0 2 0v-7Z" />
                              </svg>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="section-title">Movimientos</div>
          {loading && <p className="muted">Cargando...</p>}
          {error && <p className="error">{error}</p>}
          {!loading && !error && filteredItems.length === 0 && (
            <p className="muted">No hay movimientos para mostrar.</p>
          )}
          {!loading && !error && filteredItems.length > 0 && (
            <div className="table-scroll" style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Cliente</th>
                    <th>Detalle</th>
                    <th style={{ width: 40, minWidth: 40, textAlign: "center" }} />
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const customerName = item.customer?.name || "-";
                    const customerDni = item.customer?.dni || "-";
                    return (
                      <tr key={item.id}>
                        <td>
                          <div>{formatDateTime(item.createdAt)}</div>
                          {item.occurredAt && (
                            <div className="muted" style={{ fontSize: "0.85rem" }}>
                              Fecha: {formatDate(item.occurredAt)}
                            </div>
                          )}
                        </td>
                        <td>{getTypeLabel(item.type)}</td>
                        <td>
                          <div>{customerName}</div>
                          <div className="muted" style={{ fontSize: "0.85rem" }}>
                            {customerDni}
                          </div>
                        </td>
                        <td>{formatDetail(item)}</td>
                        <td style={{ width: 40, minWidth: 40, textAlign: "center" }}>
                          {canVoidMovements && (
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{
                                padding: "0.4rem",
                                borderRadius: "0.375rem",
                                minWidth: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center"
                              }}
                              onClick={() => handleOpenDelete(item, "movement")}
                              aria-label="Anular"
                              title="Anular"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                width="18"
                                height="18"
                                fill="currentColor"
                                aria-hidden="true"
                              >
                                <path d="M9 3a1 1 0 0 0-1 1v1H5.5a1 1 0 1 0 0 2H6v11a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7h.5a1 1 0 1 0 0-2H16V4a1 1 0 0 0-1-1H9Zm1 2h4v1h-4V5Zm-1 5a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1Zm6 1a1 1 0 1 0-2 0v7a1 1 0 1 0 2 0v-7Z" />
                              </svg>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {deleteTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50
          }}
        >
          <div className="card" style={{ width: "min(520px, 92vw)" }}>
            <h3>{deleteTarget?.kind === "payment" ? "\u00bfAnular este pago?" : "\u00bfEliminar esta operaci\u00f3n?"}</h3>
            <p className="muted">{deleteTarget?.kind === "payment" ? "Esto revertir\u00e1 el impacto del pago." : "Esto anular\u00e1 el movimiento en reportes."}</p>
            <label>
              Motivo (opcional)
              <textarea
                rows={2}
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
                style={{ resize: "vertical" }}
                disabled={!canVoid}
              />
            </label>
            {deleteError && <p className="error">{deleteError}</p>}
            <div className="form-actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn-secondary" onClick={handleCloseDelete}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleConfirmDelete}
                disabled={deleting || !canVoid}
              >
                {deleting ? "Anulando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            background: "#111827",
            color: "#fff",
            padding: "0.6rem 0.9rem",
            borderRadius: 8,
            fontSize: "0.95rem",
            zIndex: 60,
            boxShadow: "0 6px 18px rgba(0,0,0,0.2)"
          }}
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}



































