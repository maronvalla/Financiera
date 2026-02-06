import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader.jsx";
import { api } from "../lib/api.js";

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2
});

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

const STATUS_LABELS = {
  active: "Activo",
  finished: "Finalizado",
  late: "Moroso",
  bad_debt: "Incobrable",
  void: "Anulado"
};

function sanitizeDni(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  if (typeof value?._seconds === "number") return new Date(value._seconds * 1000);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export default function ClientesLista() {
  const navigate = useNavigate();
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [debtInfo, setDebtInfo] = useState(null);
  const [debtLoading, setDebtLoading] = useState(false);
  const [debtError, setDebtError] = useState("");
  const [customerLoans, setCustomerLoans] = useState([]);
  const [loansLoading, setLoansLoading] = useState(false);
  const [loansError, setLoansError] = useState("");

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", dni: "", phone: "", address: "", notes: "" });
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingCustomer, setDeletingCustomer] = useState(false);
  const [deleteHasActiveLoans, setDeleteHasActiveLoans] = useState(false);

  const [loanDeleteTarget, setLoanDeleteTarget] = useState(null);
  const [loanDeleteReason, setLoanDeleteReason] = useState("");
  const [loanDeleteError, setLoanDeleteError] = useState("");
  const [deletingLoan, setDeletingLoan] = useState(false);
  const [confirmVoidAll, setConfirmVoidAll] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const fetchClientes = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/customers");
      const items = Array.isArray(res?.data?.items)
        ? res.data.items
        : Array.isArray(res?.data)
          ? res.data
          : [];
      setClientes(items);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "No se pudo cargar la lista.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClientes();
  }, []);

  useEffect(() => {
    if (!toastMessage) return undefined;
    const timer = setTimeout(() => setToastMessage(""), 2500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const fetchLoansForCustomer = async (customer) => {
    if (!customer) return;
    setLoansLoading(true);
    setLoansError("");
    try {
      const res = await api.get("/loans", {
        params: { customerId: customer.id }
      });
      let items = Array.isArray(res?.data?.items) ? res.data.items : [];
      if (!items.length && customer.dni) {
        const fallback = await api.get("/loans", { params: { dni: customer.dni } });
        items = Array.isArray(fallback?.data?.items) ? fallback.data.items : [];
      }
      setCustomerLoans(items);
    } catch (err) {
      setLoansError(err?.response?.data?.message || err.message || "No se pudieron cargar los préstamos.");
    } finally {
      setLoansLoading(false);
    }
  };

  const openDebtModal = async (customer) => {
    setSelectedCustomer(customer);
    setDebtInfo(null);
    setDebtError("");
    setDebtLoading(true);
    setCustomerLoans([]);
    setLoansError("");
    try {
      const res = await api.get(`/customers/${customer.id}/debt`);
      setDebtInfo(res?.data || null);
    } catch (err) {
      setDebtError(err?.response?.data?.message || err.message || "No se pudo cargar la deuda.");
    } finally {
      setDebtLoading(false);
    }
    fetchLoansForCustomer(customer);
  };

  const closeDebtModal = () => {
    setSelectedCustomer(null);
    setDebtInfo(null);
    setDebtError("");
    setDebtLoading(false);
    setCustomerLoans([]);
    setLoansLoading(false);
    setLoansError("");
  };

  const openEditModal = (customer) => {
    setEditTarget(customer);
    setEditForm({
      name: customer.fullName || "",
      dni: sanitizeDni(customer.dni || customer.id || ""),
      phone: customer.phone || "",
      address: customer.address || "",
      notes: customer.notes || ""
    });
    setEditError("");
  };

  const closeEditModal = () => {
    setEditTarget(null);
    setEditError("");
    setSavingEdit(false);
  };

  const handleEditChange = (field) => (event) => {
    const raw = event.target.value;
    setEditForm((prev) => ({
      ...prev,
      [field]: field === "dni" ? sanitizeDni(raw) : raw
    }));
  };

  const handleEditBlur = () => {
    setEditForm((prev) => ({ ...prev, name: formatName(prev.name) }));
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setSavingEdit(true);
    setEditError("");
    try {
      await api.put(`/customers/${editTarget.id}`, {
        name: editForm.name ? editForm.name.trim() : "",
        dni: sanitizeDni(editForm.dni || ""),
        phone: editForm.phone ? editForm.phone.trim() : "",
        address: editForm.address ? editForm.address.trim() : "",
        notes: editForm.notes ? editForm.notes.trim() : ""
      });
      closeEditModal();
      fetchClientes();
      setToastMessage("Cliente actualizado");
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === "DNI_EXISTS") {
        setEditError("Ese DNI ya está registrado.");
      } else {
        setEditError(data?.message || err.message || "No se pudo actualizar el cliente.");
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const openDeleteModal = (customer) => {
    setDeleteTarget(customer);
    setDeleteReason("");
    setDeleteError("");
    setDeleteHasActiveLoans(false);
  };

  const closeDeleteModal = () => {
    setDeleteTarget(null);
    setDeleteReason("");
    setDeleteError("");
    setDeleteHasActiveLoans(false);
    setDeletingCustomer(false);
  };

  const confirmDeleteCustomer = async () => {
    if (!deleteTarget) return;
    setDeletingCustomer(true);
    setDeleteError("");
    setDeleteHasActiveLoans(false);
    try {
      await api.delete(`/customers/${deleteTarget.id}`);
      closeDeleteModal();
      fetchClientes();
      setToastMessage("Cliente eliminado");
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === "HAS_ACTIVE_LOANS") {
        setDeleteHasActiveLoans(true);
        setDeleteError("El cliente tiene préstamos activos.");
      } else {
        setDeleteError(err?.response?.data?.message || "No se pudo eliminar el cliente.");
      }
    } finally {
      setDeletingCustomer(false);
    }
  };

  const confirmVoidCustomer = async () => {
    if (!deleteTarget) return;
    setDeletingCustomer(true);
    setDeleteError("");
    try {
      await api.post(`/customers/${deleteTarget.id}/void`, { reason: deleteReason || "" });
      closeDeleteModal();
      fetchClientes();
      setToastMessage("Cliente anulado");
    } catch (err) {
      setDeleteError(err?.response?.data?.message || "No se pudo anular el cliente.");
    } finally {
      setDeletingCustomer(false);
    }
  };

  const openLoanDelete = (loan) => {
    setLoanDeleteTarget(loan);
    setLoanDeleteReason("");
    setLoanDeleteError("");
  };

  const closeLoanDelete = () => {
    setLoanDeleteTarget(null);
    setLoanDeleteReason("");
    setLoanDeleteError("");
    setDeletingLoan(false);
    setConfirmVoidAll(false);
  };

  const handleConfirmLoanDelete = async () => {
    if (!loanDeleteTarget) return;
    setDeletingLoan(true);
    setLoanDeleteError("");
    try {
      await api.post(`/loans/${loanDeleteTarget.id}/void-with-payments`, {
        reason: loanDeleteReason.trim()
      });
      closeLoanDelete();
      if (selectedCustomer) {
        openDebtModal(selectedCustomer);
      }
      setToastMessage("Préstamo anulado");
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === "HAS_PAYMENTS") {
        setLoanDeleteError("Primero anulá los pagos de ese préstamo.");
      } else {
        setLoanDeleteError(data?.message || err.message || "No se pudo anular el préstamo.");
      }
    } finally {
      setDeletingLoan(false);
    }
  };

  return (
    <div className="container">
      <AppHeader title="MV Prestamos - Clientes" />

      <div className="card">
        <div className="card-header">
          <div>
            <h2>Lista de clientes</h2>
            <p className="muted">Clientes cargados en el sistema.</p>
          </div>
          <div className="card-header-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate("/clientes/nuevo")}
            >
              Registrar cliente
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        {loading && <p className="muted">Cargando...</p>}
        {!loading && error && <p className="error">{error}</p>}
        {!loading && !error && clientes.length === 0 && (
          <p className="muted">No hay clientes cargados.</p>
        )}
        {!loading && !error && clientes.length > 0 && (
          <>
            <div className="table-scroll">
              <table className="table table-desktop">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>DNI</th>
                    <th>Telefono</th>
                    <th>Direccion</th>
                    <th>Notas</th>
                    <th style={{ width: 120 }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((cliente) => (
                    <tr key={cliente.id || cliente.dni}>
                      <td>
                        {cliente.fullName ? (
                          <button
                            type="button"
                            className="link"
                            onClick={() => openDebtModal(cliente)}
                          >
                            {cliente.fullName}
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{cliente.dni || "-"}</td>
                      <td>{cliente.phone || "-"}</td>
                      <td>{cliente.address || "-"}</td>
                      <td>{cliente.notes || "-"}</td>
                      <td>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => openEditModal(cliente)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => openDeleteModal(cliente)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="table-cards">
              {clientes.map((cliente) => (
                <div key={cliente.id || cliente.dni} className="table-card">
                  <div style={{ fontWeight: 700 }}>{cliente.fullName || "-"}</div>
                  <div className="muted">DNI: {cliente.dni || "-"}</div>
                  <div className="muted">Tel: {cliente.phone || "-"}</div>
                  <div className="muted">Dirección: {cliente.address || "-"}</div>
                  <div className="muted">Notas: {cliente.notes || "-"}</div>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                    {cliente.fullName && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => openDebtModal(cliente)}
                      >
                        Ver deuda
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => openEditModal(cliente)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => openDeleteModal(cliente)}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {selectedCustomer && (
        <div
          role="presentation"
          onClick={closeDebtModal}
          className="modal-overlay"
        >
          <div
            role="presentation"
            onClick={(event) => event.stopPropagation()}
            className="card modal-card"
          >
            <button
              type="button"
              aria-label="Cerrar"
              className="btn-secondary"
              onClick={closeDebtModal}
              style={{ position: "absolute", top: "1rem", right: "1rem" }}
            >
              X
            </button>
            <div className="section-title">Detalle de cliente</div>
            <h3 style={{ marginBottom: "0.35rem" }}>
              {selectedCustomer.fullName || "Cliente"}
            </h3>
            <div className="muted" style={{ marginBottom: "1rem" }}>
              DNI: {selectedCustomer.dni || selectedCustomer.id}
            </div>
            {debtLoading && <p className="muted">Cargando...</p>}
            {!debtLoading && debtError && <p className="error">{debtError}</p>}
            {!debtLoading && !debtError && debtInfo && (
              <div className="stack">
                <div>
                  <div className="section-title">Deuda total</div>
                  <div style={{ fontSize: "1.8rem", fontWeight: 700 }}>
                    {currencyFormatter.format(debtInfo.debt?.totalPending || 0)}
                  </div>
                </div>
                <div className="grid">
                  <div>
                    <div className="muted">Capital pendiente</div>
                    <div>
                      {currencyFormatter.format(debtInfo.debt?.capitalPending || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="muted">Intereses pendientes</div>
                    <div>
                      {currencyFormatter.format(debtInfo.debt?.interestPending || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="muted">Prestamos activos</div>
                    <div>{debtInfo.loansCount || 0}</div>
                  </div>
                </div>
                {debtInfo.debt?.american && (
                  <div>
                    <div className="section-title">Préstamos americanos</div>
                    <div className="grid">
                      <div>
                        <div className="muted">Capital pendiente</div>
                        <div>
                          {currencyFormatter.format(
                            debtInfo.debt.american?.principalOutstanding || 0
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="muted">Intereses pagados</div>
                        <div>
                          {currencyFormatter.format(debtInfo.debt.american?.interestPaid || 0)}
                        </div>
                      </div>
                      <div>
                        <div className="muted">Capital pagado</div>
                        <div>
                          {currencyFormatter.format(debtInfo.debt.american?.principalPaid || 0)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div>
                  <div className="section-title">Préstamos</div>
                  {loansLoading && <p className="muted">Cargando préstamos...</p>}
                  {!loansLoading && loansError && <p className="error">{loansError}</p>}
                  {!loansLoading && !loansError && customerLoans.length === 0 && (
                    <p className="muted">No hay préstamos para este cliente.</p>
                  )}
                  {!loansLoading && !loansError && customerLoans.length > 0 && (
                    <div className="table-scroll" style={{ overflowX: "auto" }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th>Estado</th>
                            <th>Saldo</th>
                            <th style={{ width: 40, minWidth: 40, textAlign: "center" }} />
                          </tr>
                        </thead>
                        <tbody>
                          {customerLoans.map((loan) => {
                            const startDate = toDate(loan.startDate);
                            const createdAt = toDate(loan.createdAt);
                            return (
                              <tr key={loan.id}>
                                <td>
                                  {startDate && (
                                    <div>Inicio: {dateFormatter.format(startDate)}</div>
                                  )}
                                  {createdAt && (
                                    <div className="muted" style={{ fontSize: "0.85rem" }}>
                                      Registrado: {dateFormatter.format(createdAt)}
                                    </div>
                                  )}
                                </td>
                                <td>{STATUS_LABELS[loan.status] || loan.status || "Activo"}</td>
                                <td>{currencyFormatter.format(Number(loan.balance || 0))}</td>
                                <td style={{ width: 40, minWidth: 40, textAlign: "center" }}>
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
                                    onClick={() => openLoanDelete(loan)}
                                    aria-label="Anular préstamo"
                                    title="Anular préstamo"
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
          </div>
        </div>
      )}

      {editTarget && (
        <div role="presentation" onClick={closeEditModal} className="modal-overlay">
          <div
            role="presentation"
            onClick={(event) => event.stopPropagation()}
            className="card modal-card"
          >
            <button
              type="button"
              aria-label="Cerrar"
              className="btn-secondary"
              onClick={closeEditModal}
              style={{ position: "absolute", top: "1rem", right: "1rem" }}
            >
              X
            </button>
            <div className="section-title">Editar cliente</div>
            <div className="form form-grid">
              <label>
                Nombre
                <input
                  value={editForm.name}
                  onChange={handleEditChange("name")}
                  onBlur={handleEditBlur}
                />
              </label>
              <label>
                DNI
                <input
                  type="text"
                  inputMode="numeric"
                  value={editForm.dni}
                  onChange={handleEditChange("dni")}
                />
              </label>
              <label>
                Teléfono
                <input value={editForm.phone} onChange={handleEditChange("phone")} />
              </label>
              <label>
                Dirección
                <input value={editForm.address} onChange={handleEditChange("address")} />
              </label>
              <label>
                Notas
                <textarea
                  value={editForm.notes}
                  onChange={handleEditChange("notes")}
                  rows={3}
                />
              </label>
            </div>
            {editError && <p className="error">{editError}</p>}
            <div className="form-actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn-secondary" onClick={closeEditModal}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveEdit}
                disabled={savingEdit}
              >
                {savingEdit ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loanDeleteTarget && (
        <div role="presentation" onClick={closeLoanDelete} className="modal-overlay">
          <div
            role="presentation"
            onClick={(event) => event.stopPropagation()}
            className="card modal-card"
          >
            <h3>¿Anular esta deuda completa?</h3>
            <p className="muted">Se anularán también los pagos asociados.</p>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={confirmVoidAll}
                onChange={(event) => setConfirmVoidAll(event.target.checked)}
              />
              Entiendo que se anularán los pagos
            </label>
            <label>
              Motivo (opcional)
              <textarea
                rows={2}
                value={loanDeleteReason}
                onChange={(event) => setLoanDeleteReason(event.target.value)}
                style={{ resize: "vertical" }}
              />
            </label>
            {loanDeleteError && <p className="error">{loanDeleteError}</p>}
            <div className="form-actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn-secondary" onClick={closeLoanDelete}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleConfirmLoanDelete}
                disabled={deletingLoan || !confirmVoidAll}
                style={{ background: "#dc2626" }}
              >
                {deletingLoan ? "Anulando..." : "Anular"}
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

      {deleteTarget && (
        <div role="presentation" onClick={closeDeleteModal} className="modal-overlay">
          <div
            role="presentation"
            onClick={(event) => event.stopPropagation()}
            className="card modal-card"
          >
            <h3>Eliminar cliente</h3>
            <p className="muted">Si tiene préstamos activos, debés anularlo.</p>
            {deleteError && <p className="error">{deleteError}</p>}
            <label>
              Motivo (opcional)
              <textarea
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
                rows={2}
              />
            </label>
            <div className="form-actions" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={closeDeleteModal}
                disabled={deletingCustomer}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={confirmDeleteCustomer}
                disabled={deletingCustomer}
              >
                {deletingCustomer ? "Eliminando..." : "Eliminar"}
              </button>
              {deleteHasActiveLoans && (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={confirmVoidCustomer}
                  disabled={deletingCustomer}
                >
                  {deletingCustomer ? "Anulando..." : "Anular cliente"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
