import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { Navigate } from "react-router-dom";
import { auth } from "../firebase.js";
import { api } from "../lib/api.js";

export default function ProtectedRoute({ children }) {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState(null);
  const [walletEnsured, setWalletEnsured] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setChecking(false);
      setWalletEnsured(false);
    });

    return () => unsubscribe();
  }, []);

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

  if (checking) {
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

  return children;
}
