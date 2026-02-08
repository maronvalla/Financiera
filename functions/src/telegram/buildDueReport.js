async function buildDueReport({ db, helpers, baseDate = new Date() }) {
  const dateKey = helpers.getArgentinaDateString(baseDate);
  const loansSnap = await db.collection("loans").get();

  const customerCache = new Map();
  const clientsMap = new Map();
  let countLoans = 0;

  const resolveCustomer = async (loan) => {
    const rawDni = loan.customerDni || loan.dni || null;
    const key = loan.customerId ? `id:${loan.customerId}` : rawDni ? `dni:${rawDni}` : null;
    if (!key) {
      return {
        key: `loan:${loan.id}`,
        name: loan.customerName || "Sin nombre",
        dni: rawDni || "",
        phone: ""
      };
    }
    if (customerCache.has(key)) return customerCache.get(key);

    let name = loan.customerName || "";
    let dni = rawDni || "";
    let phone = "";

    if (loan.customerId) {
      const snap = await db.collection("customers").doc(loan.customerId).get();
      if (snap.exists) {
        const data = snap.data() || {};
        name = data.fullName || data.name || name;
        dni = data.dni || dni || snap.id;
        phone = data.phone || "";
      }
    } else if (dni) {
      const byDni = await db.collection("customers").where("dni", "==", String(dni)).limit(1).get();
      if (!byDni.empty) {
        const data = byDni.docs[0].data() || {};
        name = data.fullName || data.name || name;
        phone = data.phone || "";
      } else {
        const legacySnap = await db.collection("customers").doc(String(dni)).get();
        if (legacySnap.exists) {
          const data = legacySnap.data() || {};
          name = data.fullName || data.name || name;
          phone = data.phone || "";
        }
      }
    }

    const resolved = {
      key,
      name: name || "Sin nombre",
      dni: dni || "",
      phone: phone || ""
    };
    customerCache.set(key, resolved);
    return resolved;
  };

  for (const docSnap of loansSnap.docs) {
    const loan = docSnap.data() || {};
    if (loan.voided) continue;
    const normalizedStatus = helpers.normalizeLoanStatus(loan.status);
    if (normalizedStatus === "void" || normalizedStatus === "rejected") continue;
    const fundingStatus = String(loan?.funding?.status || "").toUpperCase();
    if (fundingStatus === "PENDING" || fundingStatus === "REJECTED") continue;

    const loanType = helpers.normalizeLoanType(loan.loanType);
    if (loanType === "americano") {
      continue;
    }

    const { installments } = helpers.ensureLoanInstallments(loan);
    if (!installments || installments.length === 0) continue;

    let overdue = 0;
    let dueToday = 0;

    for (const installment of installments) {
      if (helpers.isInstallmentPaid(installment)) continue;
      const dueDateValue = helpers.toDateValue(installment?.dueDate);
      if (!dueDateValue) continue;
      const dueKey = helpers.getArgentinaDateString(dueDateValue);
      const amount = helpers.toNumber(installment.amount);
      const paidTotal = helpers.toNumber(installment.paidTotal);
      const remaining = helpers.roundMoney(Math.max(amount - paidTotal, 0));
      if (remaining <= 0) continue;
      if (dueKey < dateKey) {
        overdue = helpers.roundMoney(overdue + remaining);
      } else if (dueKey === dateKey) {
        dueToday = helpers.roundMoney(dueToday + remaining);
      }
    }

    const total = helpers.roundMoney(overdue + dueToday);
    if (total <= 0) continue;

    countLoans += 1;
    const customer = await resolveCustomer({ ...loan, id: docSnap.id });
    const clientKey = customer.key;
    if (!clientsMap.has(clientKey)) {
      clientsMap.set(clientKey, {
        key: clientKey,
        name: customer.name,
        dni: customer.dni,
        phone: helpers.normalizePhone(customer.phone || ""),
        loans: [],
        totals: { overdue: 0, dueToday: 0, total: 0 },
        types: new Set()
      });
    }

    const client = clientsMap.get(clientKey);
    client.types.add(loanType);
    client.loans.push({
      id: docSnap.id,
      type: loanType,
      overdue,
      dueToday,
      total
    });
    client.totals.overdue = helpers.roundMoney(client.totals.overdue + overdue);
    client.totals.dueToday = helpers.roundMoney(client.totals.dueToday + dueToday);
    client.totals.total = helpers.roundMoney(client.totals.total + total);
  }

  const clients = Array.from(clientsMap.values()).map((client) => ({
    ...client,
    types: Array.from(client.types)
  }));
  clients.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return {
    dateKey,
    clients,
    countClients: clients.length,
    countLoans
  };
}

module.exports = {
  buildDueReport
};
