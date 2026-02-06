const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(`${trimmed}T00:00:00Z`);
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function computeHistoricalPaid(loan) {
  // Campos usados (modelo actual):
  // - totalDue (total a devolver)
  // - paidTotal (pagado acumulado)
  // - balance (saldo pendiente)
  // - principalOriginal / principal
  // - principalOutstanding (americano)
  // - paidInterest / paidCapital (si existen)
  const paidTotal = toNumber(loan.paidTotal);
  if (paidTotal > 0) return paidTotal;
  const totalDue = toNumber(loan.totalDue);
  const balance = toNumber(loan.balance);
  if (totalDue > 0 && balance >= 0) {
    return Math.max(totalDue - balance, 0);
  }
  const principalOriginal = toNumber(loan.principalOriginal || loan.principal);
  const principalOutstanding = toNumber(loan.principalOutstanding || loan.balance);
  const paidInterest = toNumber(loan.paidInterest);
  if (principalOriginal > 0 || paidInterest > 0) {
    return Math.max(principalOriginal - principalOutstanding, 0) + paidInterest;
  }
  return 0;
}

async function main() {
  console.log("[migrateLedgerFromLoans] reading collections: loans, payments");
  const loansSnap = await db.collection("loans").get();
  let created = 0;
  let processed = 0;
  let skipped = 0;
  let batch = db.batch();
  let opCount = 0;

  const flush = async () => {
    if (opCount === 0) return;
    await batch.commit();
    batch = db.batch();
    opCount = 0;
  };

  for (const loanDoc of loansSnap.docs) {
    const loan = loanDoc.data() || {};
    if (loan.ledgerMigrated) {
      skipped += 1;
      continue;
    }

    const loanId = loanDoc.id;
    const historicalPaid = roundMoney(computeHistoricalPaid(loan));

    const paymentsSnap = await db.collection("payments").where("loanId", "==", loanId).get();
    let paymentsSum = 0;
    paymentsSnap.docs.forEach((paymentDoc) => {
      const payment = paymentDoc.data() || {};
      if (payment.voided) return;
      const interestTotal = toNumber(payment.interestTotal ?? payment.interestPaid);
      const amountPaid =
        payment.amountPaid != null
          ? toNumber(payment.amountPaid)
          : toNumber(payment.principalPaid) + interestTotal;
      paymentsSum += amountPaid;
    });

    const delta = roundMoney(historicalPaid - paymentsSum);
    const date =
      parseDate(loan.startDate) || parseDate(loan.createdAt) || new Date();

    if (delta > 0.01) {
      const ledgerRef = db.collection("ledger").doc();
      const payload = {
        type: "adjustment",
        amountARS: delta,
        interestARS: null,
        principalARS: null,
        date: admin.firestore.Timestamp.fromDate(date),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdByUid: loan.createdByUid || loan.createdBy || null,
        createdByEmail: loan.createdByEmail || null,
        loanId,
        customerDni: loan.customerDni || loan.dni || loan.dniCliente || null,
        note: "Pago histórico importado",
        source: "migration"
      };
      batch.set(ledgerRef, payload);
      opCount += 1;
      created += 1;
    }

    batch.update(loanDoc.ref, {
      ledgerMigrated: true,
      ledgerMigratedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    opCount += 1;
    processed += 1;

    if (opCount >= 400) {
      await flush();
    }
  }

  await flush();
  console.log(
    `[migrateLedgerFromLoans] processed=${processed} created=${created} skipped=${skipped}`
  );
}

main().catch((error) => {
  console.error("[migrateLedgerFromLoans] failed", error);
  process.exitCode = 1;
});

