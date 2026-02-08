import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase.js";
import { api } from "../lib/api.js";

const AuthContext = createContext({
  user: null,
  isAdmin: false,
  role: null,
  loading: true
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser || null);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;
    const resolveRole = async () => {
      if (!user?.uid) {
        if (mounted) setIsAdmin(false);
        if (mounted) setRole(null);
        return;
      }
      try {
        const response = await api.get("/auth/me");
        const data = response?.data || {};
        const adminFlag = data?.isAdmin === true || data?.admin === true || data?.role === "admin";
        if (mounted) setIsAdmin(Boolean(adminFlag));
        if (mounted) setRole(data?.role || null);
      } catch (error) {
        if (mounted) setIsAdmin(false);
        if (mounted) setRole(null);
      }
    };
    resolveRole();
    return () => {
      mounted = false;
    };
  }, [user]);

  const value = useMemo(() => ({ user, isAdmin, role, loading }), [user, isAdmin, role, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}


