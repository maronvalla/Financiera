import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader.jsx";
import { api } from "../lib/api.js";
import { formatYMDToDMY, isValidDMY, parseDMYToYMD } from "../lib/date.js";

const PERIODS = {
  monthly: { label: "Mensual", monthsFactor: 1, toMonthly: 1 },
  weekly: { label: "Semanal", monthsFactor: 1 / 4, toMonthly: 4 },
  biweekly: { label: "Quincenal", monthsFactor: 1 / 2, toMonthly: 2 }
};

function getNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2
});

const currencyNoCentsFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0
});

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC"
});

function normalizeDMYInput(value) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  const parts = [];
  if (digits.length > 0) parts.push(digits.slice(0, 2));
  if (digits.length > 2) parts.push(digits.slice(2, 4));
  if (digits.length > 4) parts.push(digits.slice(4, 8));
  return parts.join("/").slice(0, 10);
}

function parseISODateUTC(value) {
  if (!/\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function addMonthsKeepingDayUTC(baseDate, monthsToAdd) {
  const baseDay = baseDate.getUTCDate();
  const target = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + monthsToAdd, 1));
  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const day = Math.min(baseDay, daysInTargetMonth);
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day));
}

function addDaysUTC(baseDate, daysToAdd) {
  return new Date(
    Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate() + daysToAdd)
  );
}

function isValidStartDate(value) {
  return !!parseISODateUTC(value);
}

export default function RegisterLoan() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(searchParams.get("q") || "");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [results, setResults] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const todayYmd = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    loanType: "simple",
    principal: "",
    rateValue: "",
    ratePeriod: "monthly",
    termCount: "",
    termPeriod: "monthly",
    startDate: todayYmd,
    hasIntermediary: false,
    intermediaryName: "",
    totalPct: "",
    intermediaryPct: ""
  });
  const [startDateDisplay, setStartDateDisplay] = useState(formatYMDToDMY(todayYmd));

  const calculated = useMemo(() => {
    const principal = getNumber(form.principal);
    const rateValue = getNumber(form.rateValue);
    const termCount = getNumber(form.termCount);
    const ratePeriod = PERIODS[form.ratePeriod] || PERIODS.monthly;
    const termPeriod = PERIODS[form.termPeriod] || PERIODS.monthly;
    const monthlyRate = (rateValue / 100) * ratePeriod.toMonthly;
    const monthsEquivalent = form.loanType === "simple" ? termCount * termPeriod.monthsFactor : 0;
    const totalDue =
      form.loanType === "simple" && principal > 0 && termCount > 0
        ? principal * (1 + monthlyRate * monthsEquivalent)
        : 0;

    return { principal, rateValue, termCount, totalDue, monthlyRate, monthsEquivalent };
  }, [form]);

  const schedule = useMemo(() => {
    if (form.loanType !== "simple") return [];
    if (calculated.totalDue <= 0 || calculated.termCount <= 0) {
      return [];
    }
    const installments = Math.round(calculated.termCount);
    if (!installments) return [];
    const totalForSchedule = Math.round(calculated.totalDue);
    const baseAmount = Math.round(totalForSchedule / installments);
    const baseDate = form.startDate ? parseISODateUTC(form.startDate) : null;
    if (!baseDate) return [];
    const results = [];

    for (let i = 1; i <= installments; i += 1) {
      const dueDate =
        form.termPeriod === "weekly"
          ? addDaysUTC(baseDate, 7 * i)
          : form.termPeriod === "biweekly"
            ? addDaysUTC(baseDate, 15 * i)
            : addMonthsKeepingDayUTC(baseDate, i);
      const amount =
        i === installments ? totalForSchedule - baseAmount * (installments - 1) : baseAmount;

      results.push({
        index: i,
        dueDate,
        amount
      });
    }

    return results;
  }, [calculated.totalDue, calculated.termCount, form.termPeriod, form.startDate, form.loanType]);

  const handleSearch = async (event) => {
    event.preventDefault();
    const term = searchTerm.trim();
    if (!term) return;
    setSearching(true);
    setSearchError("");
    setResults([]);
    setSelectedCustomer(null);
    try {
      const isDni = /^\d+$/.test(term);
      if (isDni) {
        const { data } = await api.get("/customers", { params: { dni: term } });
        const items = Array.isArray(data?.items) ? data.items : [];
        if (items.length) {
          setResults(items);
        } else {
          setSearchError("No se encontro un cliente con ese DNI.");
        }
      } else {
        const { data } = await api.get("/customers", { params: { q: term } });
        const items = Array.isArray(data?.items) ? data.items : [];
        if (items.length) {
          setResults(items);
        } else {
          setSearchError("No se encontraron clientes con ese nombre.");
        }
      }
    } catch (err) {
      setSearchError(err?.response?.data?.message || err.message || "No se pudo buscar el cliente.");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setSearchError("");
    setMessage("");
  };

  const handleFormChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "termPeriod" && prev.loanType === "americano") {
        next.ratePeriod = value;
      }
      return next;
    });
    setError("");
    setMessage("");
  };

  const handleLoanTypeChange = (event) => {
    const value = event.target.value;
    setForm((prev) => {
      const next = { ...prev, loanType: value };
      if (value === "americano") {
        next.termCount = "";
        next.ratePeriod = prev.termPeriod;
      }
      return next;
    });
    setError("");
    setMessage("");
  };

  const handleIntermediaryToggle = (event) => {
    const checked = event.target.checked;
    setForm((prev) => ({
      ...prev,
      hasIntermediary: checked,
      intermediaryName: checked ? prev.intermediaryName : "",
      totalPct: checked ? prev.totalPct || String(prev.rateValue || "") : "",
      intermediaryPct: checked ? prev.intermediaryPct || "" : ""
    }));
  };

  const handleStartDateChange = (event) => {
    const normalized = normalizeDMYInput(event.target.value || "");
    setStartDateDisplay(normalized);
    if (isValidDMY(normalized)) {
      const ymd = parseDMYToYMD(normalized);
      setForm((prev) => ({ ...prev, startDate: ymd }));
    } else {
      setForm((prev) => ({ ...prev, startDate: "" }));
    }
    setError("");
    setMessage("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!selectedCustomer) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const totalDue = Number(calculated.totalDue.toFixed(2));
      const totalPct = Number(form.totalPct || 0);
      const intermediaryPct = Number(form.intermediaryPct || 0);
      const myPct = Number((totalPct - intermediaryPct).toFixed(2));
      const payload = {
        customerId: selectedCustomer.id || "",
        customerDni: selectedCustomer.dni || selectedCustomer.id,
        customerName: selectedCustomer.fullName || "",
        loanType: form.loanType,
        principal: calculated.principal,
        principalOriginal: calculated.principal,
        principalOutstanding: calculated.principal,
        interestRate: calculated.rateValue,
        rateValue: calculated.rateValue,
        ratePeriod: form.ratePeriod,
        termCount: form.loanType === "simple" ? calculated.termCount : undefined,
        termPeriod: form.termPeriod,
        frequency: form.termPeriod,
        startDate: form.startDate,
        totalDue: form.loanType === "simple" ? totalDue : undefined,
        hasIntermediary: form.hasIntermediary,
        intermediaryName: form.hasIntermediary ? form.intermediaryName.trim() : "",
        interestSplit: form.hasIntermediary
          ? {
            totalPct,
            intermediaryPct,
            myPct
          }
          : { totalPct: 100, intermediaryPct: 0, myPct: 100 }
      };
      await api.post("/loans", payload);
      const nextStartDate = new Date().toISOString().slice(0, 10);
      setForm({
        loanType: "simple",
        principal: "",
        rateValue: "",
        ratePeriod: "monthly",
        termCount: "",
        termPeriod: "monthly",
        startDate: nextStartDate,
        hasIntermediary: false,
        intermediaryName: "",
        totalPct: "",
        intermediaryPct: ""
      });
      setStartDateDisplay(formatYMDToDMY(nextStartDate));
      setMessage("Prestamo registrado correctamente.");
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "No se pudo registrar el prestamo.");
    } finally {
      setSaving(false);
    }
  };

  const totalPctValue = Number(form.totalPct || 0);
  const intermediaryPctValue = Number(form.intermediaryPct || 0);
  const myPctValue = Number((totalPctValue - intermediaryPctValue).toFixed(2));
  const splitValid =
    !form.hasIntermediary ||
    (totalPctValue > 0 &&
      intermediaryPctValue >= 0 &&
      myPctValue >= 0 &&
      Math.abs(intermediaryPctValue + myPctValue - totalPctValue) < 0.01);
  const startDateError =
    startDateDisplay && !isValidDMY(startDateDisplay) ? "Fecha de inicio inválida." : "";
  const canSubmit =
    selectedCustomer &&
    calculated.principal > 0 &&
    calculated.rateValue >= 0 &&
    isValidStartDate(form.startDate) &&
    isValidDMY(startDateDisplay) &&
    (form.loanType === "americano" || calculated.termCount > 0) &&
    splitValid;

  return (
    <div className="container">
      <AppHeader />
      <div className="card">
        <h2>Registrar prestamo</h2>
        <p className="muted">Busca un cliente y completa las condiciones.</p>
      </div>

      <div className="card">
        <form className="form" onSubmit={handleSearch}>
          <label>
            Buscar cliente por DNI o nombre
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Ej: 30123456 o Marta Gomez"
              required
            />
          </label>
          <button className="btn-secondary btn-large" type="submit" disabled={searching}>
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
        <div className="grid">
          <div className="card">
            <div className="section-title">Cliente seleccionado</div>
            <div style={{ fontWeight: 700 }}>{selectedCustomer.fullName}</div>
            <div className="muted">DNI: {selectedCustomer.dni || selectedCustomer.id}</div>
          </div>

          <div className="card" style={{ background: "rgba(229,57,53,0.05)" }}>
            <div className="section-title">
              {form.loanType === "americano" ? "Capital inicial" : "Total a devolver"}
            </div>
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>
              {form.loanType === "americano"
                ? currencyFormatter.format(calculated.principal || 0)
                : calculated.totalDue > 0
                  ? currencyFormatter.format(calculated.totalDue)
                  : "$ -"}
            </div>
            <div className="muted" style={{ marginTop: "0.5rem" }}>
              {form.loanType === "americano"
                ? "Interés periódico sobre el capital pendiente."
                : "Interes simple aplicado en base mensual equivalente."}
            </div>
          </div>

          {schedule.length > 0 && (
            <div className="card">
              <div className="section-title">Plan de cuotas</div>
              <div className="list" style={{ marginTop: 0 }}>
                {schedule.map((item) => (
                  <div key={item.index}>
                    Cuota {item.index} - {dateFormatter.format(item.dueDate)} -{" "}
                    {currencyNoCentsFormatter.format(item.amount)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedCustomer && (
        <div className="card">
          <form className="form form-grid" onSubmit={handleSubmit}>
            <label>
              Tipo de préstamo
              <select value={form.loanType} onChange={handleLoanTypeChange}>
                <option value="simple">Interés simple</option>
                <option value="americano">Americano (solo interés + capital)</option>
              </select>
            </label>
            <label>
              Principal
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.principal}
                onChange={handleFormChange("principal")}
                required
              />
            </label>
            <label>
              Interes (%)
              <div className="inline">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.rateValue}
                  onChange={handleFormChange("rateValue")}
                  required
                />
                {form.loanType === "simple" && (
                  <select value={form.ratePeriod} onChange={handleFormChange("ratePeriod")}>
                    {Object.entries(PERIODS).map(([key, item]) => (
                      <option key={key} value={key}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </label>
            {form.loanType === "simple" ? (
              <label>
                Plazo (cantidad)
                <div className="inline">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.termCount}
                    onChange={handleFormChange("termCount")}
                    required
                  />
                  <select value={form.termPeriod} onChange={handleFormChange("termPeriod")}>
                    {Object.entries(PERIODS).map(([key, item]) => (
                      <option key={key} value={key}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            ) : (
              <label>
                Frecuencia
                <select value={form.termPeriod} onChange={handleFormChange("termPeriod")}>
                  {Object.entries(PERIODS).map(([key, item]) => (
                    <option key={key} value={key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Fecha de inicio
              <input
                type="text"
                value={startDateDisplay}
                onChange={handleStartDateChange}
                placeholder="dd/mm/aaaa"
                inputMode="numeric"
                maxLength={10}
                required
              />
            </label>
            <label className="span-full" style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <input
                type="checkbox"
                checked={form.hasIntermediary}
                onChange={handleIntermediaryToggle}
              />
              Tiene intermediario
            </label>
            {form.hasIntermediary && (
              <>
                <label>
                  Intermediario
                  <input
                    value={form.intermediaryName}
                    onChange={handleFormChange("intermediaryName")}
                    placeholder="Nombre"
                  />
                </label>
                <label>
                  Interés total (%)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.totalPct}
                    onChange={handleFormChange("totalPct")}
                    required={form.hasIntermediary}
                  />
                </label>
                <label>
                  % Intermediario
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.intermediaryPct}
                    onChange={handleFormChange("intermediaryPct")}
                    required={form.hasIntermediary}
                  />
                </label>
                <label>
                  % Mío
                  <input type="number" value={Number.isFinite(myPctValue) ? myPctValue : 0} readOnly />
                </label>
              </>
            )}
            {startDateError && (
              <div className="span-full">
                <p className="error">{startDateError}</p>
              </div>
            )}
            {!splitValid && (
              <div className="span-full">
                <p className="error">El split de interés no coincide.</p>
              </div>
            )}
            {error && (
              <div className="span-full">
                <p className="error">{error}</p>
              </div>
            )}
            {message && (
              <div className="span-full">
                <p style={{ color: "var(--mv-green)" }}>{message}</p>
              </div>
            )}
            <div className="form-actions">
              <button className="btn-primary btn-large" type="submit" disabled={!canSubmit || saving}>
                {saving ? "Registrando..." : "Registrar prestamo"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
