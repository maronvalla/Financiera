import { useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { formatName, sanitizeDni, validateDni, validateName } from "../lib/format.js";

const PERIODS = {
  monthly: { label: "Mensual", monthsFactor: 1, toMonthly: 1 },
  weekly: { label: "Semanal", monthsFactor: 1 / 4, toMonthly: 4 },
  biweekly: { label: "Quincenal", monthsFactor: 1 / 2, toMonthly: 2 }
};

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2
});

function getNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function NewLoan() {
  const [form, setForm] = useState({
    dni: "",
    fullName: "",
    principal: "",
    ratePercent: "",
    ratePeriod: "monthly",
    termCount: "",
    termPeriod: "monthly"
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const calculated = useMemo(() => {
    const principal = getNumber(form.principal);
    const ratePercent = getNumber(form.ratePercent);
    const termCount = getNumber(form.termCount);
    const ratePeriod = PERIODS[form.ratePeriod] || PERIODS.monthly;
    const termPeriod = PERIODS[form.termPeriod] || PERIODS.monthly;

    const monthlyRate = (ratePercent / 100) * ratePeriod.toMonthly;
    const monthsEquivalent = termCount * termPeriod.monthsFactor;
    const totalDue =
      principal > 0 && termCount > 0 ? principal * (1 + monthlyRate * monthsEquivalent) : 0;

    return {
      principal,
      ratePercent,
      termCount,
      monthlyRate,
      monthsEquivalent,
      totalDue
    };
  }, [form]);

  const canSubmit =
    validateDni(form.dni.trim()) &&
    validateName(form.fullName.trim()) &&
    calculated.principal > 0 &&
    calculated.termCount > 0;

  const handleChange = (field) => (event) => {
    const raw = event.target.value;
    const nextValue =
      field === "dni" ? sanitizeDni(raw) : field === "fullName" ? formatName(raw) : raw;
    setForm((prev) => ({ ...prev, [field]: nextValue }));
    setSuccess("");
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.post("/loans", {
        customerDni: form.dni.trim(),
        customerName: form.fullName.trim(),
        principal: calculated.principal,
        rateValue: calculated.ratePercent,
        ratePeriod: form.ratePeriod,
        termCount: calculated.termCount,
        termPeriod: form.termPeriod,
        totalDue: Number(calculated.totalDue.toFixed(2))
      });
      setForm({
        dni: "",
        fullName: "",
        principal: "",
        ratePercent: "",
        ratePeriod: "monthly",
        termCount: "",
        termPeriod: "monthly"
      });
      setSuccess("Préstamo registrado correctamente.");
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "No se pudo guardar el préstamo.");
    } finally {
      setSaving(false);
    }
  };

  const dniValue = form.dni.trim();
  const nameValue = form.fullName.trim();
  const showDniError = dniValue.length > 0 && !validateDni(dniValue);
  const showNameError = nameValue.length > 0 && !validateName(nameValue);

  return (
    <div
      className="container"
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(140deg, rgba(229,57,53,0.08) 0%, rgba(251,140,0,0.12) 45%, rgba(0,0,0,0.02) 100%)"
      }}
    >
      <div
        className="card"
        style={{
          borderColor: "rgba(0,0,0,0.2)",
          background: "linear-gradient(120deg, #ffffff 0%, #fff4e6 100%)",
          boxShadow: "0 18px 40px rgba(0,0,0,0.08)"
        }}
      >
        <h1 style={{ fontSize: "1.9rem", fontWeight: 700 }}>
          Nuevo Préstamo – MV Préstamos
        </h1>
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          Registro rápido con cálculo en vivo del total a devolver.
        </p>
      </div>

      <div className="grid">
        <div
          className="card"
          style={{
            border: "1px solid rgba(0,0,0,0.15)",
            boxShadow: "0 14px 32px rgba(0,0,0,0.07)"
          }}
        >
          <div className="section-title">Datos del cliente</div>
          <form onSubmit={handleSubmit} className="form">
            <label>
              DNI del cliente
              <input
                value={form.dni}
                onChange={handleChange("dni")}
                placeholder="Ej: 30123456"
                inputMode="numeric"
                pattern="[0-9]*"
                required
              />
            </label>
            {showDniError && <p className="error">DNI invalido. Usa 7 a 9 digitos.</p>}
            <label>
              Nombre y apellido
              <input
                value={form.fullName}
                onChange={handleChange("fullName")}
                placeholder="Ej: Marta Gómez"
                required
              />
            </label>
            {showNameError && (
              <p className="error">Nombre invalido. Usa solo letras y espacios.</p>
            )}
            <label>
              Monto prestado
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.principal}
                onChange={handleChange("principal")}
                placeholder="Ej: 250000"
                required
              />
            </label>
            <label>
              Interés (%)
              <div className="inline">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.ratePercent}
                  onChange={handleChange("ratePercent")}
                  placeholder="Ej: 15"
                  required
                />
                <select value={form.ratePeriod} onChange={handleChange("ratePeriod")}>
                  {Object.entries(PERIODS).map(([value, item]) => (
                    <option key={value} value={value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label>
              Plazo (cantidad)
              <div className="inline">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.termCount}
                  onChange={handleChange("termCount")}
                  placeholder="Ej: 6"
                  required
                />
                <select value={form.termPeriod} onChange={handleChange("termPeriod")}>
                  {Object.entries(PERIODS).map(([value, item]) => (
                    <option key={value} value={value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            {error && <p className="error">{error}</p>}
            {success && <p style={{ color: "var(--mv-green)" }}>{success}</p>}
            <button type="submit" className="btn-primary btn-large" disabled={!canSubmit || saving}>
              {saving ? "Registrando..." : "Registrar Préstamo"}
            </button>
          </form>
        </div>

        <div className="stack">
          <div
            className="card"
            style={{
              background: "linear-gradient(135deg, #111111 0%, #2b2b2b 100%)",
              color: "var(--mv-white)"
            }}
          >
            <div className="section-title" style={{ color: "var(--mv-white)" }}>
              Total a devolver
            </div>
            <div style={{ fontSize: "2.4rem", fontWeight: 700 }}>
              {calculated.totalDue > 0
                ? currencyFormatter.format(calculated.totalDue)
                : "$ -"}
            </div>
            <p style={{ color: "rgba(255,255,255,0.7)", marginTop: "0.75rem" }}>
              Interés simple aplicado sobre el capital inicial.
            </p>
          </div>

          <div className="card">
            <div className="section-title">Resumen financiero</div>
            <div className="grid">
              <div>
                <div className="muted">Principal</div>
                <div>{currencyFormatter.format(calculated.principal || 0)}</div>
              </div>
              <div>
                <div className="muted">Tasa mensual equivalente</div>
                <div>{(calculated.monthlyRate * 100).toFixed(2)}%</div>
              </div>
              <div>
                <div className="muted">Meses equivalentes</div>
                <div>{calculated.monthsEquivalent.toFixed(2)}</div>
              </div>
              <div>
                <div className="muted">Periodo del plazo</div>
                <div>{PERIODS[form.termPeriod]?.label}</div>
              </div>
            </div>
            <p className="muted" style={{ marginTop: "1rem" }}>
              Si seleccionás un interés semanal o quincenal, la tasa se convierte a mensual y
              luego se aplica al plazo informado.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}


