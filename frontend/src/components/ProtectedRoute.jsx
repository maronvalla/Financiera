import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";

export default function ProtectedRoute({ children, allowedRoles = null }) {
  const location = useLocation();
  const { user, isAdmin, role, loading } = useAuth();
  const [walletEnsured, setWalletEnsured] = useState(false);

  useEffect(() => {
    setWalletEnsured(false);
  }, [user?.uid]);

  useEffect(() => {
    if (!user || walletEnsured) return;
    const ensureWallet = async () => {
      try {
        await api.post("/wallets/ensure");
      } catch (error) {
        console.error("[WALLET_ENSURE_FAILED]", error);
      } finally {
        setWalletEnsured(true);
      }
    };
    ensureWallet();
  }, [user, walletEnsured]);

  const isDollarsOnly = role === "dollars" && !isAdmin;
  const isAllowedRole =
    !allowedRoles || isAdmin || (role && allowedRoles.map((item) => item.toLowerCase()).includes(role));

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <h2>Verificando sesión</h2>
          <p className="muted">Esperá un momento...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (isDollarsOnly && location.pathname !== "/dolares") {
    return <Navigate to="/dolares" replace />;
  }

  if (!isAllowedRole) {
    return <Navigate to="/dolares" replace />;
  }

  return children;
}
