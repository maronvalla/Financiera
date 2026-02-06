import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader.jsx";
import { api } from "../lib/api.js";

const PERIODS = {
  monthly: { label: "Mensual", monthsFactor: 1, toMonthly: 1 },
  weekly: { label: "Semanal", monthsFactor: 1 / 4, toMonthly: 4 },
  biweekly: { label: "Quincenal", monthsFactor: 1 / 2, toMonthly: 2 }
};

const paymentMethods = [
  { value: "cash", label: "Efectivo" },
  { value: "transfer", label: "Transferencia" }
];

const paymentTypes = [
  { value: "interest", label: "Solo interés" },
  { value: "principal", label: "Solo capital" },
  { value: "mixed", label: "Interés + capital" }
];

function getLoanType(loan) {
  return loan?.loanType === "americano" ? "americano" : "simple";
}

function getOutstanding(loan) {
  if (!loan) return 0;
  if (getLoanType(loan) === "americano") {
    return Number(loan.principalOutstanding ?? loan.balance ?? loan.principal ?? 0);
  }
  return Number(loan.balance ?? 0);
}

function computePeriodicRate(loan) {
  if (!loan) return 0;
  const frequency = loan.frequency || loan.termPeriod || "monthly";
  const ratePeriod = loan.ratePeriod || frequency;
  const rateValue = Number(loan.interestRate ?? loan.rateValue ?? 0);
  const ratePeriodConfig = PERIODS[ratePeriod] || PERIODS.monthly;
  const frequencyConfig = PERIODS[frequency] || PERIODS.monthly;
  const monthlyRate = (rateValue / 100) * ratePeriodConfig.toMonthly;
  return monthlyRate / frequencyConfig.toMonthly;
}

function getInterestRatio(loan) {
  if (!loan) return 0;
  const totalDue = Number(loan.totalDue || 0);
  const principal = Number(loan.principal || 0);
  if (totalDue <= 0) return 0;
  const interestTotal = Math.max(totalDue - principal, 0);
  return interestTotal / totalDue;
}

function computeSplit(loan, interestTotal) {
  const total = Number(interestTotal || 0);
  if (!loan?.hasIntermediary) {
    return { interestTotal: total, interestMine: total, interestIntermediary: 0 };
  }
  const split = loan.interestSplit || { totalPct: 100, intermediaryPct: 0, myPct: 100 };
  const totalPct = Number(split.totalPct || 0) || 100;
  const myPct = Number(split.myPct || 0) || Math.max(totalPct - Number(split.intermediaryPct || 0), 0);
  const ratioMine = totalPct > 0 ? myPct / totalPct : 1;
  const interestMine = Number((total * ratioMine).toFixed(2));
  const interestIntermediary = Number((total - interestMine).toFixed(2));
  return { interestTotal: total, interestMine, interestIntermediary };
}

function formatYmdToDisplay(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function parseDisplayToYmd(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!day || !month || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2
});

export default function RegisterPayment() {
  const navigate = useNavigate();
  const todayYmd = new Date().toISOString().slice(0, 10);
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [results, setResults] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [loans, setLoans] = useState([]);
  const [loansError, setLoansError] = useState("");
  const [selectedLoanId, setSelectedLoanId] = useState("");
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [installments, setInstallments] = useState([]);
  const [installmentsError, setInstallmentsError] = useState("");
  const [installmentsLoading, setInstallmentsLoading] = useState(false);
  const [selectedInstallment, setSelectedInstallment] = useState(null);
  const [form, setForm] = useState({
    amount: "",
    method: "cash",
    installmentNumber: "",
    paymentType: "interest",
    interestPaid: "",
    principalPaid: "",
    note: "",
    paidAt: formatYmdToDisplay(todayYmd)
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const handleSearch = async (event) => {
    event.preventDefault();
    const term = searchTerm.trim();
    if (!term) return;
    setSearching(true);
    setSearchError("");
    setResults([]);
    setSelectedCustomer(null);
    setLoans([]);
    setLoansError("");
    setSelectedLoanId("");
    setSelectedLoan(null);
    setInstallments([]);
    setInstallmentsError("");
    setSelectedInstallment(null);
    try {
      const isDni = /^\d+$/.test(term);
      const { data } = await api.get("/customers", {
        params: isDni ? { dni: term } : { q: term }
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length) {
        setResults(items);
      } else {
        setSearchError(
          isDni ? "No se encontró un cliente con ese DNI." : "No se encontraron clientes con ese nombre."
        );
      }
    } catch (err) {
      setSearchError("Error al conectar con el servidor");
    } finally {
      setSearching(false);
    }
  };

  const loadInstallments = async (loanId, selectedNumber = null) => {
    setInstallmentsLoading(true);
    setInstallmentsError("");
    setInstallments([]);
    setSelectedInstallment(null);
    try {
      const { data } = await api.get(`/loans/${loanId}/installments`);
      const items = Array.isArray(data?.items) ? data.items : [];
      setInstallments(items);
      if (selectedNumber) {
        const found = items.find((item) => Number(item.number) === Number(selectedNumber));
        setSelectedInstallment(found || null);
      }
    } catch (err) {
      setInstallmentsError(
        err?.response?.data?.message || "No se pudieron cargar las cuotas."
      );
      setInstallments([]);
      setSelectedInstallment(null);
    } finally {
      setInstallmentsLoading(false);
    }
  };

  const handleSelectCustomer = async (customer) => {
    setSelectedCustomer(customer);
    setSearchError("");
    setMessage("");
    setError("");
    setSelectedLoanId("");
    setSelectedLoan(null);
    setLoans([]);
    setLoansError("");
    setInstallments([]);
    setInstallmentsError("");
    setSelectedInstallment(null);
    try {
      const { data } = await api.get("/loans/active-by-dni", {
        params: {
          dni: customer.dni || ""
        }
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      const activeLoans = items.filter((loan) => getOutstanding(loan) > 0);
      setLoans(activeLoans);
    } catch (err) {
      setLoansError("Error al conectar con el servidor");
      setLoans([]);
    }
  };

  const handleFormChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
    setError("");
    setMessage("");
  };



  const handleLoanChange = (event) => {
    const loanId = event.target.value;
    const loan = loans.find((item) => item.id === loanId) || null;
    setSelectedLoanId(loanId);
    setSelectedLoan(loan);
    setForm((prev) => ({
      ...prev,
      amount: "",
      installmentNumber: "",
      interestPaid: "",
      principalPaid: "",
      paymentType: "interest"
    }));
    setError("");
    setMessage("");
    if (loanId) {
      if (getLoanType(loan) === "simple") {
        loadInstallments(loanId);
      } else {
        setInstallments([]);
        setInstallmentsError("");
        setSelectedInstallment(null);
      }
    } else {
      setInstallments([]);
      setInstallmentsError("");
      setSelectedInstallment(null);
    }
  };

  const handleInstallmentChange = (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, installmentNumber: value }));
    const next = installments.find((item) => Number(item.number) === Number(value));
    setSelectedInstallment(next || null);
    setError("");
    setMessage("");
  };

  const handlePayFullInstallment = () => {
    if (!selectedInstallment) return;
    const pendingAmount = Number(selectedInstallment.pendingAmount || 0);
    setForm((prev) => ({ ...prev, amount: pendingAmount ? String(pendingAmount) : "" }));
  };

  const handlePayment = async (event) => {
    event.preventDefault();
    if (!selectedLoanId) {
      setError("Seleccioná un préstamo.");
      return;
    }
    const paidAtYmd = parseDisplayToYmd(form.paidAt);
    if (!paidAtYmd) {
      setError("Fecha de pago inválida. Usá dd/mm/aaaa.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (getLoanType(selectedLoan) === "americano") {
        const interestValue =
          form.paymentType === "principal" ? 0 : Number(form.interestPaid || 0);
        const principalValue =
          form.paymentType === "interest" ? 0 : Number(form.principalPaid || 0);
        const totalPaid = interestValue + principalValue;
        if (totalPaid <= 0) {
          setError("Ingresá un monto de interés o capital.");
          setSaving(false);
          return;
        }

        await api.post("/payments", {
          loanId: selectedLoanId,
          paidAt: paidAtYmd,
          interestPaid: interestValue,
          principalPaid: principalValue,
          method: form.method,
          note: form.note.trim()
        });

        const nextOutstanding = Math.max(getOutstanding(selectedLoan) - principalValue, 0);
        const nextLoan = { ...selectedLoan, principalOutstanding: nextOutstanding, balance: nextOutstanding };
        setSelectedLoan(nextLoan);
        setLoans((prev) =>
          prev.map((loan) => (loan.id === selectedLoanId ? nextLoan : loan))
        );
        setForm((prev) => ({ ...prev, interestPaid: "", principalPaid: "", note: "" }));
        setMessage("Pago registrado.");
      } else {
        if (!form.installmentNumber) {
          setError("Seleccioná una cuota.");
          setSaving(false);
          return;
        }

        const amountValue = Number(form.amount);
        await api.post("/payments", {
          loanId: selectedLoanId,
          installmentNumber: Number(form.installmentNumber),
          amount: amountValue,
          paidAt: paidAtYmd,
          method: form.method,
          note: form.note.trim()
        });

        await loadInstallments(selectedLoanId, form.installmentNumber);
        setForm((prev) => ({ ...prev, amount: "", note: "" }));
        setMessage("Pago registrado y cuota actualizada.");
      }
    } catch (err) {
      const serverMessage = err?.response?.data?.message;
      if (serverMessage && serverMessage.toLowerCase().includes("pendiente")) {
        setError("El monto supera el pendiente de la cuota.");
      } else {
        setError(serverMessage || err.message || "No se pudo registrar el pago.");
      }
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    setForm((prev) => ({ ...prev, paidAt: formatYmdToDisplay(todayYmd) }));
  }, [todayYmd]);

  const isAmerican = getLoanType(selectedLoan) === "americano";
  const interestValue = form.paymentType === "principal" ? 0 : Number(form.interestPaid || 0);
  const principalValue = form.paymentType === "interest" ? 0 : Number(form.principalPaid || 0);
  const totalValue = interestValue + principalValue;
  const interestRatio = getInterestRatio(selectedLoan);
  const interestTotalForSimple = Number((Number(form.amount || 0) * interestRatio).toFixed(2));
  const previewInterestTotal = isAmerican ? interestValue : interestTotalForSimple;
  const splitPreview = computeSplit(selectedLoan, previewInterestTotal);
  const paidAtValid = !!parseDisplayToYmd(form.paidAt);
  const canSubmit = isAmerican
    ? paidAtValid && selectedLoanId && totalValue > 0
    : form.amount &&
      paidAtValid &&
      selectedLoanId &&
      form.installmentNumber &&
      Number(form.amount) > 0;

  return (
    <div className="container">
      <AppHeader />
      <div className="card">
        <h2>Registrar pago</h2>
        <p className="muted">Buscá un cliente y registrá un pago en su préstamo activo.</p>
      </div>

      <div className="card">
        <form className="form" onSubmit={handleSearch}>
          <label>
            Buscar cliente por DNI o nombre
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Ej: 30123456 o Marta Gómez"
              required
            />
          </label>
          <button className="btn-secondary" type="submit" disabled={searching}>
            {searching ? "Buscando..." : "Buscar"}
          </button>
          {searchError && <p className="error">{searchError}</p>}
        </form>

        {results.length > 0 && (
          <div className="list">
            {results.map((customer) => (
              <div key={customer.id} className="card">
                <div style={{ fontWeight: 700 }}>{customer.fullName}</div>
                <div className="muted">DNI: {customer.dni || customer.id}</div>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => handleSelectCustomer(customer)}
                  style={{ marginTop: "0.75rem" }}
                >
                  Seleccionar
                </button>
              </div>
            ))}
          </div>
        )}

        {searchError && (
          <div style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                navigate(
                  /^\d+$/.test(searchTerm.trim())
                    ? `/clientes/nuevo?dni=${encodeURIComponent(searchTerm.trim())}`
                    : `/clientes/nuevo?name=${encodeURIComponent(searchTerm.trim())}`
                )
              }
            >
              Registrar cliente
            </button>
          </div>
        )}
      </div>

      {selectedCustomer && (
        <div className="card">
          <div className="section-title">Préstamos activos</div>
          {loansError && <p className="error">{loansError}</p>}
          {!loansError && loans.length === 0 ? (
            <p className="muted">No hay préstamos activos para este cliente.</p>
          ) : (
            <div className="form">
              <label>
                Seleccionar préstamo
                <select value={selectedLoanId} onChange={handleLoanChange}>
                  <option value="">Seleccionar</option>
                  {loans.map((loan) => (
                    <option key={loan.id} value={loan.id}>
                      {loan.customerName} - {getLoanType(loan) === "americano" ? "Americano" : "Simple"} - {" "}
                      {currencyFormatter.format(getOutstanding(loan))} pendientes
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}

      {selectedCustomer && selectedLoanId && getLoanType(selectedLoan) === "simple" && (
        <div className="card">
          <div className="section-title">Cuotas del préstamo</div>
          {installmentsLoading && <p className="muted">Cargando cuotas...</p>}
          {installmentsError && <p className="error">{installmentsError}</p>}
          {!installmentsLoading && !installmentsError && installments.length === 0 && (
            <p className="muted">No hay cuotas disponibles para este préstamo.</p>
          )}
          {!installmentsLoading && installments.length > 0 && (
            <div className="form">
              <label>
                Seleccionar cuota
                <select value={form.installmentNumber} onChange={handleInstallmentChange}>
                  <option value="">Seleccionar</option>
                  {installments.map((item) => (
                    <option key={item.number} value={item.number}>
                      Cuota {item.number} - vence {item.dueDate} - pendiente {currencyFormatter.format(
                        item.pendingAmount || 0
                      )}
                    </option>
                  ))}
                </select>
              </label>

              {selectedInstallment && (
                <div className="grid" style={{ gap: "0.75rem" }}>
                  <div className="card" style={{ padding: "0.75rem" }}>
                    <div className="muted">Monto cuota</div>
                    <div style={{ fontWeight: 700 }}>
                      {currencyFormatter.format(selectedInstallment.amount || 0)}
                    </div>
                  </div>
                  <div className="card" style={{ padding: "0.75rem" }}>
                    <div className="muted">Pagado</div>
                    <div style={{ fontWeight: 700 }}>
                      {currencyFormatter.format(selectedInstallment.paidTotal || 0)}
                    </div>
                  </div>
                  <div className="card" style={{ padding: "0.75rem" }}>
                    <div className="muted">Pendiente</div>
                    <div style={{ fontWeight: 700 }}>
                      {currencyFormatter.format(selectedInstallment.pendingAmount || 0)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {selectedCustomer && selectedLoanId && getLoanType(selectedLoan) === "americano" && (
        <div className="card">
          <div className="section-title">Detalle del préstamo americano</div>
          <div className="grid">
            <div className="card" style={{ padding: "0.75rem" }}>
              <div className="muted">Capital pendiente</div>
              <div style={{ fontWeight: 700 }}>
                {currencyFormatter.format(getOutstanding(selectedLoan))}
              </div>
            </div>
            <div className="card" style={{ padding: "0.75rem" }}>
              <div className="muted">Interés estimado del período</div>
              <div style={{ fontWeight: 700 }}>
                {currencyFormatter.format(
                  getOutstanding(selectedLoan) * computePeriodicRate(selectedLoan)
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedCustomer && selectedLoanId && getLoanType(selectedLoan) === "simple" && installments.length > 0 && (
        <div className="card">
          <form className="form form-grid" onSubmit={handlePayment}>
            <label>
              Monto
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={handleFormChange("amount")}
                required
              />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handlePayFullInstallment}
                disabled={!selectedInstallment}
                style={{ width: "100%" }}
              >
                Pagar cuota completa
              </button>
            </div>
            <label>
              Fecha de pago
              <input
                value={form.paidAt}
                onChange={handleFormChange("paidAt")}
                placeholder="dd/mm/aaaa"
                required
              />
            </label>
            <label>
              Método
              <select value={form.method} onChange={handleFormChange("method")}>
                {paymentMethods.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nota
              <input value={form.note} onChange={handleFormChange("note")} />
            </label>
            {selectedLoan?.hasIntermediary && Number(form.amount || 0) > 0 && (
              <div className="card span-full" style={{ background: "rgba(229,57,53,0.06)" }}>
                <div className="section-title">Split de interés</div>
                <div className="grid">
                  <div>
                    <div className="muted">Interés total</div>
                    <div>{currencyFormatter.format(splitPreview.interestTotal || 0)}</div>
                  </div>
                  <div>
                    <div className="muted">Para intermediario</div>
                    <div>{currencyFormatter.format(splitPreview.interestIntermediary || 0)}</div>
                  </div>
                  <div>
                    <div className="muted">Para vos</div>
                    <div>{currencyFormatter.format(splitPreview.interestMine || 0)}</div>
                  </div>
                </div>
              </div>
            )}
            <button
              type="button"
              className="btn-secondary span-full"
              onClick={handlePayFullInstallment}
              disabled={!selectedInstallment || Number(selectedInstallment.pendingAmount || 0) <= 0}
            >
              Pagar cuota completa
            </button>
            {error && <p className="error span-full">{error}</p>}
            {message && <p className="span-full" style={{ color: "var(--mv-green)" }}>{message}</p>}
            <div className="form-actions">
              <button className="btn-primary btn-large" type="submit" disabled={!canSubmit || saving}>
                {saving ? "Registrando..." : "Registrar pago"}
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedCustomer && selectedLoanId && getLoanType(selectedLoan) === "americano" && (
        <div className="card">
          <form className="form form-grid" onSubmit={handlePayment}>
            <label>
              Tipo de pago
              <select value={form.paymentType} onChange={handleFormChange("paymentType")}>
                {paymentTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            {form.paymentType !== "principal" && (
              <label>
                Monto interés
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.interestPaid}
                  onChange={handleFormChange("interestPaid")}
                  required={form.paymentType !== "principal"}
                />
              </label>
            )}
            {form.paymentType !== "interest" && (
              <label>
                Monto capital
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.principalPaid}
                  onChange={handleFormChange("principalPaid")}
                  required={form.paymentType !== "interest"}
                />
              </label>
            )}
            <label>
              Fecha de pago
              <input
                value={form.paidAt}
                onChange={handleFormChange("paidAt")}
                placeholder="dd/mm/aaaa"
                required
              />
            </label>
            <label>
              Método
              <select value={form.method} onChange={handleFormChange("method")}>
                {paymentMethods.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nota
              <input value={form.note} onChange={handleFormChange("note")} />
            </label>
            {selectedLoan?.hasIntermediary && interestValue > 0 && (
              <div className="card span-full" style={{ background: "rgba(229,57,53,0.06)" }}>
                <div className="section-title">Split de interés</div>
                <div className="grid">
                  <div>
                    <div className="muted">Interés total</div>
                    <div>{currencyFormatter.format(splitPreview.interestTotal || 0)}</div>
                  </div>
                  <div>
                    <div className="muted">Para intermediario</div>
                    <div>{currencyFormatter.format(splitPreview.interestIntermediary || 0)}</div>
                  </div>
                  <div>
                    <div className="muted">Para vos</div>
                    <div>{currencyFormatter.format(splitPreview.interestMine || 0)}</div>
                  </div>
                </div>
              </div>
            )}
            {error && <p className="error span-full">{error}</p>}
            {message && <p className="span-full" style={{ color: "var(--mv-green)" }}>{message}</p>}
            <div className="form-actions">
              <button className="btn-primary btn-large" type="submit" disabled={!canSubmit || saving}>
                {saving ? "Registrando..." : "Registrar pago"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
