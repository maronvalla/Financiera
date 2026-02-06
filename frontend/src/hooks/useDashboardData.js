import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

export default function useDashboardData() {
  const [summary, setSummary] = useState({
    collectedToday: 0,
    pendingCount: 0,
    overdueTotal: 0
  });
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get("/reports/dashboard");
        if (!alive) return;
        setSummary({
          collectedToday: Number(data?.summary?.collectedToday || 0),
          pendingCount: Number(data?.summary?.pendingCount || 0),
          overdueTotal: Number(data?.summary?.overdueTotal || 0)
        });
        setTransactions(Array.isArray(data?.transactions) ? data.transactions : []);
        setLoading(false);
      } catch (error) {
        if (!alive) return;
        setLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, []);

  const formatted = useMemo(() => {
    const currency = new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS"
    });
    const dateFmt = new Intl.DateTimeFormat("es-AR", {
      dateStyle: "short",
      timeStyle: "short"
    });
    return {
      summary: {
        collectedToday: currency.format(summary.collectedToday || 0),
        pendingCount: summary.pendingCount,
        overdueTotal: currency.format(summary.overdueTotal || 0)
      },
      transactions: transactions.map((tx) => ({
        ...tx,
        amountFormatted: currency.format(tx.amount || 0),
        paidAtFormatted: tx.paidAt ? dateFmt.format(new Date(tx.paidAt)) : "-"
      }))
    };
  }, [summary, transactions]);

  return { ...formatted, raw: summary, loading };
}
