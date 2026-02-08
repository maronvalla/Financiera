import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader.jsx";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2
});

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "short",
  year: "numeric"
});

function toNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  if (typeof value.toDate === "function") return value.toDate();
  return null;
}

export default function Dollars() {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("buy");
  const [buyForm, setBuyForm] = useState({ qtyUsd: "", buyPrice: "", note: "", usdType: "blue" });
  const [sellForm, setSellForm] = useState({ qtyUsd: "", sellPrice: "", note: "" });
  const [buyError, setBuyError] = useState("");
  const [buyMessage, setBuyMessage] = useState("");
  const [sellError, setSellError] = useState("");
  const [sellMessage, setSellMessage] = useState("");
  const [savingBuy, setSavingBuy] = useState(false);
  const [savingSell, setSavingSell] = useState(false);
  const [usdOnHand, setUsdOnHand] = useState(0);
  const [usdByType, setUsdByType] = useState({
    blue: 0,
    greenLarge: 0,
    greenSmall: 0,
    unknown: 0
  });
  const [monthProfitArs, setMonthProfitArs] = useState(0);
  const [trades, setTrades] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [summaryError, setSummaryError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [actionMenuId, setActionMenuId] = useState(null);
  const [isCompactActions, setIsCompactActions] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const canViewReports = isAdmin;
  const fetchData = async () => {
    setLoadingData(true);
    setSummaryError("");
    try {
      if (canViewReports) {
        const results = await Promise.allSettled([
          api.get("/dollars/trades"),
          api.get("/dollars/stock"),
          api.get("/dollars/summary")
        ]);
        const [tradesRes, stockRes, summaryRes] = results;
        if (tradesRes.status === "fulfilled") {
          setTrades(Array.isArray(tradesRes.value?.data?.items) ? tradesRes.value.data.items : []);
        }
        if (stockRes.status === "fulfilled") {
          const availableUsd = Number(stockRes.value?.data?.availableUsd ?? 0);
          setUsdOnHand(availableUsd);
          setUsdByType({
            blue: Number(stockRes.value?.data?.usdByType?.blue ?? 0),
            greenLarge: Number(stockRes.value?.data?.usdByType?.greenLarge ?? 0),
            greenSmall: Number(stockRes.value?.data?.usdByType?.greenSmall ?? 0),
            unknown: Number(stockRes.value?.data?.usdByType?.unknown ?? 0)
          });
        }
        if (summaryRes.status === "fulfilled") {
          setMonthProfitArs(Number(summaryRes.value?.data?.monthProfitArs ?? 0));
        } else {
          const message =
            summaryRes.reason?.response?.data?.message ||
            summaryRes.reason?.message ||
            "No se pudo cargar el resumen USD.";
          setSummaryError(message);
        }
      } else {
        const stockRes = await api.get("/dollars/stock");
        const availableUsd = Number(stockRes?.data?.availableUsd ?? 0);
        setUsdOnHand(availableUsd);
        setUsdByType({
          blue: Number(stockRes?.data?.usdByType?.blue ?? 0),
          greenLarge: Number(stockRes?.data?.usdByType?.greenLarge ?? 0),
          greenSmall: Number(stockRes?.data?.usdByType?.greenSmall ?? 0),
          unknown: Number(stockRes?.data?.usdByType?.unknown ?? 0)
        });
        setTrades([]);
        setMonthProfitArs(0);
      }
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [canViewReports]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const updateCompact = () => setIsCompactActions(media.matches);
    updateCompact();
    if (media.addEventListener) {
      media.addEventListener("change", updateCompact);
    } else {
      media.addListener(updateCompact);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener("change", updateCompact);
      } else {
        media.removeListener(updateCompact);
      }
    };
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 2500);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    if (!canViewReports && activeTab === "reports") {
      setActiveTab("buy");
    }
  }, [canViewReports, activeTab]);

  const reportRows = useMemo(() => {
    const ordered = [...trades].sort((a, b) => {
      const dateA = toDate(a.occurredAt || a.createdAt);
      const dateB = toDate(b.occurredAt || b.createdAt);
      const timeA = dateA ? dateA.getTime() : 0;
      const timeB = dateB ? dateB.getTime() : 0;
      return timeA - timeB;
    });
    let stock = 0;
    const withStock = ordered.map((trade) => {
      const qty = Number(trade.usd ?? 0);
      if (trade.type === "buy") {
        stock += qty;
      } else if (trade.type === "sell") {
        stock -= qty;
      }
      return { ...trade, stockAfter: stock };
    });
    return withStock.reverse();
  }, [trades]);

  const usdOnHandDisplay = Number(usdOnHand || 0);
  const usdByTypeDisplay = useMemo(
    () => ({
      blue: Number(usdByType?.blue || 0),
      greenLarge: Number(usdByType?.greenLarge || 0),
      greenSmall: Number(usdByType?.greenSmall || 0)
    }),
    [usdByType]
  );

  const monthProfit = useMemo(() => Number(monthProfitArs || 0), [monthProfitArs]);

  const buyTotalArs = useMemo(() => {
    const qty = toNumber(buyForm.qtyUsd);
    const price = toNumber(buyForm.buyPrice);
    return qty > 0 && price > 0 ? qty * price : 0;
  }, [buyForm.qtyUsd, buyForm.buyPrice]);

  const sellTotalArs = useMemo(() => {
    const qty = toNumber(sellForm.qtyUsd);
    const price = toNumber(sellForm.sellPrice);
    return qty > 0 && price > 0 ? qty * price : 0;
  }, [sellForm.qtyUsd, sellForm.sellPrice]);

  const canSubmitBuy = toNumber(buyForm.qtyUsd) > 0 && toNumber(buyForm.buyPrice) > 0;
  const canSubmitSell = toNumber(sellForm.qtyUsd) > 0 && toNumber(sellForm.sellPrice) > 0;

  const handleBuyChange = (field) => (event) => {
    setBuyForm((prev) => ({ ...prev, [field]: event.target.value }));
    setBuyError("");
    setBuyMessage("");
  };

  const handleSellChange = (field) => (event) => {
    setSellForm((prev) => ({ ...prev, [field]: event.target.value }));
    setSellError("");
    setSellMessage("");
  };

  const handleBuySubmit = async (event) => {
    event.preventDefault();
    if (!buyForm.qtyUsd || !buyForm.buyPrice) {
      setBuyError("Completa cantidad y precio.");
      return;
    }
    const qty = toNumber(buyForm.qtyUsd);
    const price = toNumber(buyForm.buyPrice);
    if (qty <= 0 || price <= 0) {
      setBuyError("Completa cantidad y precio validos.");
      return;
    }
    setSavingBuy(true);
    setBuyError("");
    setBuyMessage("");
    try {
      await api.post("/dollars/buy", {
        usd: qty,
        price,
        note: buyForm.note.trim(),
        usdType: buyForm.usdType
      });
      setBuyForm({ qtyUsd: "", buyPrice: "", note: "", usdType: "blue" });
      setBuyMessage("Compra registrada correctamente.");
      fetchData();
    } catch (err) {
      setBuyError(err?.response?.data?.message || err.message || "No se pudo registrar la compra.");
    } finally {
      setSavingBuy(false);
    }
  };

  const handleSellSubmit = async (event) => {
    event.preventDefault();
    if (!sellForm.qtyUsd || !sellForm.sellPrice) {
      setSellError("Completa cantidad y precio.");
      return;
    }
    const qty = toNumber(sellForm.qtyUsd);
    const price = toNumber(sellForm.sellPrice);
    if (qty <= 0 || price <= 0) {
      setSellError("Completa cantidad y precio validos.");
      return;
    }
    setSavingSell(true);
    setSellError("");
    setSellMessage("");
    try {
      await api.post("/dollars/sell", {
        usd: qty,
        price,
        note: sellForm.note.trim()
      });
      setSellForm({ qtyUsd: "", sellPrice: "", note: "" });
      setSellMessage("Venta registrada correctamente.");
      fetchData();
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === "INSUFFICIENT_USD") {
        const available = Number(data?.details?.availableUsd || 0).toFixed(2);
        setSellError(`No hay USD suficientes. Disponibles: ${available}`);
      } else if (data?.code === "INVALID_INPUT") {
        const fields = Array.isArray(data?.details?.invalidFields)
          ? data.details.invalidFields.join(", ")
          : "";
        const details = fields ? ` Campos: ${fields}.` : data?.message ? ` ${data.message}` : "";
        setSellError(`Datos inválidos.${details}`);
      } else {
        setSellError(data?.message || err.message || "No se pudo registrar la venta.");
      }
    } finally {
      setSavingSell(false);
    }
  };

  const handleOpenDelete = (trade) => {
    setDeleteTarget(trade);
    setDeleteReason("");
    setDeleteError("");
    setActionMenuId(null);
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
      await api.delete(`/dollars/movements/${deleteTarget.id}`, {
        data: { reason: deleteReason.trim() }
      });
      handleCloseDelete();
      fetchData();
      setToastMessage("Operación eliminada");
    } catch (err) {
      const data = err?.response?.data;
      const status = err?.response?.status;
      if (import.meta.env.DEV) {
        console.warn("[DOLLARS_VOID_FAILED]", { status, message: data?.message || err?.message });
      }
      if (status === 401) {
        setDeleteError("Sesión vencida, volvé a iniciar sesión");
        return;
      }
      if (status === 403) {
        setDeleteError("No tenés permisos para anular.");
        return;
      }
      if (status === 404) {
        setDeleteError("La operación ya no existe o fue eliminada.");
        return;
      }
      if (data?.code === "LOT_ALREADY_USED") {
        setDeleteError("No se puede eliminar: la compra ya fue usada en ventas.");
        return;
      }
      if (status === 400) {
        setDeleteError(data?.message || "No se pudo eliminar la operación.");
        return;
      }
      setDeleteError(data?.message || err.message || "No se pudo eliminar la operación.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="container">
      <AppHeader title="MV Prestamos - Dolares" />
      <div className="card">
        <h2>Modulo dolares</h2>
        <p className="muted">Registra compras/ventas USD y consulta reportes.</p>
      </div>

      <div className="card">
        <div className="button-row">
          <button
            type="button"
            className={activeTab === "buy" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("buy")}
          >
            Registrar compra
          </button>
          <button
            type="button"
            className={activeTab === "sell" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("sell")}
          >
            Registrar venta
          </button>
          {canViewReports && (
            <button
              type="button"
              className={activeTab === "reports" ? "btn-primary" : "btn-secondary"}
              onClick={() => setActiveTab("reports")}
            >
              Reportes
            </button>
          )}
        </div>
      </div>

      {activeTab === "buy" && (
        <div className="card">
          <form className="form form-grid" onSubmit={handleBuySubmit}>
            <label>
              Tipo de USD
              <select value={buyForm.usdType} onChange={handleBuyChange("usdType")}>
                <option value="blue">Azules</option>
                <option value="green_large">Verde Cara Grande</option>
                <option value="green_small">Verde Cara Chica</option>
              </select>
            </label>
            <label>
              Cantidad USD
              <input
                type="number"
                min="0"
                step="1"
                value={buyForm.qtyUsd}
                onChange={handleBuyChange("qtyUsd")}
                required
              />
            </label>
            <label>
              Precio compra (ARS/USD)
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={buyForm.buyPrice}
                onChange={handleBuyChange("buyPrice")}
                required
              />
            </label>
            <label>
              Nota
              <input value={buyForm.note} onChange={handleBuyChange("note")} />
            </label>
            <div className="card span-full" style={{ background: "rgba(30,64,175,0.08)" }}>
              <div className="section-title">Total a pagar (ARS)</div>
              <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>
                {currencyFormatter.format(buyTotalArs || 0)}
              </div>
            </div>
            {buyError && <p className="error span-full">{buyError}</p>}
            {buyMessage && <p className="span-full" style={{ color: "var(--mv-green)" }}>{buyMessage}</p>}
            <div className="form-actions">
              <button
                className="btn-primary btn-large"
                type="submit"
                disabled={!canSubmitBuy || savingBuy}
              >
                {savingBuy ? "Registrando..." : "Registrar compra"}
              </button>
            </div>
          </form>
        </div>
      )}

      {activeTab === "sell" && (
        <div className="card">
          <form className="form form-grid" onSubmit={handleSellSubmit}>
            <label>
              Cantidad USD
              <input
                type="number"
                min="0"
                step="1"
                value={sellForm.qtyUsd}
                onChange={handleSellChange("qtyUsd")}
                required
              />
            </label>
            <label>
              Precio venta (ARS/USD)
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={sellForm.sellPrice}
                onChange={handleSellChange("sellPrice")}
                required
              />
            </label>
            <label>
              Nota
              <input value={sellForm.note} onChange={handleSellChange("note")} />
            </label>
            <div className="card span-full" style={{ background: "rgba(30,64,175,0.08)" }}>
              <div className="section-title">Total a cobrar (ARS)</div>
              <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>
                {currencyFormatter.format(sellTotalArs || 0)}
              </div>
            </div>
            <div className="muted span-full">USD disponibles: {usdOnHandDisplay || 0}</div>
            {sellError && <p className="error span-full">{sellError}</p>}
            {sellMessage && <p className="span-full" style={{ color: "var(--mv-green)" }}>{sellMessage}</p>}
            <div className="form-actions">
              <button
                className="btn-primary btn-large"
                type="submit"
                disabled={!canSubmitSell || savingSell}
              >
                {savingSell ? "Registrando..." : "Registrar venta"}
              </button>
            </div>
          </form>
        </div>
      )}

      {canViewReports && activeTab === "reports" && (
        <div className="stack">
          <div className="grid">
            <div className="card">
              <div className="section-title">USD actuales</div>
              <div style={{ fontSize: "2rem", fontWeight: 700 }}>
                {Number(usdOnHandDisplay || 0).toFixed(2)}
              </div>
              <div className="muted" style={{ marginTop: "0.35rem" }}>
                Azules: {usdByTypeDisplay.blue.toFixed(2)}
              </div>
              <div className="muted">Verde Cara Grande: {usdByTypeDisplay.greenLarge.toFixed(2)}</div>
              <div className="muted">Verde Cara Chica: {usdByTypeDisplay.greenSmall.toFixed(2)}</div>
            </div>
            <div className="card">
              <div className="section-title">Ganancia realizada del mes</div>
              <div style={{ fontSize: "2rem", fontWeight: 700 }}>
                {currencyFormatter.format(monthProfit || 0)}
              </div>
            </div>
          </div>
          {summaryError && <p className="error">{summaryError}</p>}

          <div className="card">
            <div className="section-title">Tabla contable</div>
            {loadingData && <p className="muted">Cargando...</p>}
            {!loadingData && (
              <div className="table-scroll" style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Tipo USD</th>
                      <th>Cantidad USD</th>
                      <th>Precio</th>
                      <th>Total ARS</th>
                      <th>Ganancia ARS</th>
                      <th>Stock USD</th>
                      <th style={{ width: 40, minWidth: 40, textAlign: "center" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.map((trade) => {
                      const tradeDate = toDate(trade.occurredAt || trade.createdAt);
                      const allocations = Array.isArray(trade.fifoBreakdown)
                        ? trade.fifoBreakdown
                        : [];
                      const profit =
                        trade.type === "sell"
                          ? (Number(trade.profitArsTotal || 0) ||
                            allocations.reduce(
                              (sum, item) => sum + Number(item.profitArs || 0),
                              0
                            ))
                          : 0;
                      return (
                        <tr key={trade.id}>
                          <td>{tradeDate ? dateFormatter.format(tradeDate) : "Sin fecha"}</td>
                          <td>{trade.type === "buy" ? "Compra" : "Venta"}</td>
                          <td>
                            {trade.type === "buy"
                              ? trade.usdType === "green_large"
                                ? "Verde Cara Grande"
                                : trade.usdType === "green_small"
                                  ? "Verde Cara Chica"
                                  : "Azules"
                              : "-"}
                          </td>
                          <td>{Number(trade.usd ?? 0)}</td>
                          <td>{currencyFormatter.format(Number(trade.price ?? 0))}</td>
                          <td>{currencyFormatter.format(Number(trade.totalArs || 0))}</td>
                          <td>{trade.type === "sell" ? currencyFormatter.format(profit) : "-"}</td>
                          <td>{Number(trade.stockAfter || 0).toFixed(2)}</td>
                          <td style={{ width: 40, minWidth: 40, textAlign: "center" }}>
                            {isAdmin && (
                              <div style={{ position: "relative", display: "inline-block" }}>
                                {isCompactActions ? (
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    style={{
                                      padding: "0.4rem",
                                      borderRadius: "0.375rem",
                                      minWidth: 0
                                    }}
                                    onClick={() =>
                                      setActionMenuId((prev) => (prev === trade.id ? null : trade.id))
                                    }
                                  >
                                    ⋯
                                  </button>
                                ) : (
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
                                    onClick={() => handleOpenDelete(trade)}
                                    aria-label="Eliminar"
                                    title="Eliminar"
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
                                {isCompactActions && actionMenuId === trade.id && (
                                  <div
                                    style={{
                                      position: "absolute",
                                      right: 0,
                                      top: "100%",
                                      marginTop: 6,
                                      background: "#fff",
                                      border: "1px solid rgba(0,0,0,0.08)",
                                      borderRadius: 8,
                                      padding: 6,
                                      zIndex: 10,
                                      boxShadow: "0 6px 20px rgba(0,0,0,0.12)"
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="btn-secondary"
                                      style={{
                                        width: "100%",
                                        justifyContent: "flex-start",
                                        padding: "0.4rem 0.6rem"
                                      }}
                                      onClick={() => handleOpenDelete(trade)}
                                    >
                                      Eliminar
                                    </button>
                                  </div>
                                )}
                              </div>
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
            <h3>¿Eliminar esta operación?</h3>
            <p className="muted">Esto revertirá stock/ganancias.</p>
            <div className="muted" style={{ fontSize: "0.95rem" }}>
              {deleteTarget.type === "buy" ? "Compra" : "Venta"} · USD{" "}
              {Number(deleteTarget.usd ?? 0)} ·{" "}
              {currencyFormatter.format(Number(deleteTarget.price ?? 0))}
            </div>
            <label>
              Motivo (opcional)
              <textarea
                rows={2}
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
                style={{ resize: "vertical" }}
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
                disabled={deleting}
              >
                {deleting ? "Eliminando..." : "Eliminar"}
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
