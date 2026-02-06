import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

export default function useKpis() {
  const [state, setState] = useState({
    loading: true,
    collectedTotal: 0,
    debtorsCount: 0,
    interestMonth: 0
  });

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const { data } = await api.get("/reports/kpis");
        const payload = data?.item || {};

        if (!alive) return;
        setState({
          loading: false,
          collectedTotal: Number(payload.collectedTotal || 0),
          debtorsCount: Number(payload.debtorsCount || 0),
          interestMonth: Number(payload.interestMonth || 0)
        });
      } catch (error) {
        if (!alive) return;
        setState((prev) => ({ ...prev, loading: false }));
      }
    };

    load();
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
