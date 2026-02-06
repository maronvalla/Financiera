import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader.jsx";
import { api } from "../lib/api.js";
import { formatName, sanitizeDni, validateDni, validateName } from "../lib/format.js";

const emptyForm = {
  dni: "",
  fullName: "",
  phone: "",
  address: "",
  notes: ""
};

export default function RegisterCustomer() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savedCustomer, setSavedCustomer] = useState(null);

  useEffect(() => {
    const dniParam = searchParams.get("dni");
    const nameParam = searchParams.get("name");
    setForm((prev) => ({
      ...prev,
      dni: dniParam ? sanitizeDni(dniParam) : prev.dni,
      fullName: nameParam ? formatName(nameParam) : prev.fullName
    }));
  }, [searchParams]);

  const handleChange = (field) => (event) => {
    const raw = event.target.value;
    const nextValue =
      field === "dni" ? sanitizeDni(raw) : field === "fullName" ? formatName(raw) : raw;
    setForm((prev) => ({ ...prev, [field]: nextValue }));
    setError("");
    setSuccess("");
    setSavedCustomer(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const dni = form.dni.trim();
    const fullName = form.fullName.trim();
    if (!dni || !fullName) {
      setError("DNI y nombre son obligatorios.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    setSavedCustomer(null);
    try {
      await api.post("/customers", {
        dni,
        fullName,
        phone: form.phone.trim(),
        address: form.address.trim(),
        notes: form.notes.trim()
      });
      setForm(emptyForm);
      setSavedCustomer({ dni, fullName });
      setSuccess("Cliente registrado correctamente.");
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "No se pudo guardar el cliente.");
    } finally {
      setSaving(false);
    }
  };

  const dniValue = form.dni.trim();
  const nameValue = form.fullName.trim();
  const dniValid = validateDni(dniValue);
  const nameValid = validateName(nameValue);
  const showDniError = dniValue.length > 0 && !dniValid;
  const showNameError = nameValue.length > 0 && !nameValid;
  const canSubmit = dniValid && nameValid;

  return (
    <div className="container">
      <AppHeader />
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Registrar cliente</h2>
            <p className="muted">Completa la ficha basica para habilitar prestamos.</p>
          </div>
          <div className="card-header-actions">
            <button type="button" className="btn-secondary" onClick={() => navigate("/clientes")}>
              Ver lista
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <form className="form form-grid" onSubmit={handleSubmit}>
          <label>
            DNI
            <input
              value={form.dni}
              onChange={handleChange("dni")}
              inputMode="numeric"
              pattern="[0-9]*"
              required
            />
          </label>
          {showDniError && (
            <p className="error span-full">DNI invalido. Usa 7 a 9 digitos.</p>
          )}
          <label>
            Nombre y apellido
            <input value={form.fullName} onChange={handleChange("fullName")} required />
          </label>
          {showNameError && (
            <p className="error span-full">Nombre invalido. Usa solo letras y espacios.</p>
          )}
          <label>
            Telefono
            <input value={form.phone} onChange={handleChange("phone")} />
          </label>
          <label>
            Direccion
            <input value={form.address} onChange={handleChange("address")} />
          </label>
          <label>
            Notas
            <input value={form.notes} onChange={handleChange("notes")} />
          </label>
          {error && <p className="error span-full">{error}</p>}
          {success && (
            <div className="span-full">
              <p style={{ color: "var(--mv-green)" }}>{success}</p>
              {savedCustomer && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    navigate(`/prestamos/nuevo?q=${encodeURIComponent(savedCustomer.dni)}`)
                  }
                >
                  Registrar prestamo para este cliente
                </button>
              )}
            </div>
          )}
          <div className="form-actions">
            <button className="btn-primary btn-large" type="submit" disabled={!canSubmit || saving}>
              {saving ? "Guardando..." : "Guardar cliente"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
