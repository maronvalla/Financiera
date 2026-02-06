const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();

function toDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function resolveUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  try {
    return await admin.auth().getUserByEmail(normalized);
  } catch (error) {
    return null;
  }
}

async function run() {
  const migrationRef = db.collection("migrations").doc("walletsHistory");
  const migrationSnap = await migrationRef.get();
  if (migrationSnap.exists && migrationSnap.data()?.done) {
    console.log("[MIGRATION] ya ejecutada.");
    return;
  }

  const cutoff = new Date();
  await migrationRef.set(
    {
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      cutoffAt: cutoff.toISOString(),
      done: false
    },
    { merge: true }
  );

  const paymentsSnap = await db.collectionGroup("payments").get();
  const totalsByKey = new Map();
  paymentsSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (data.voided) return;
    const createdAt = toDateValue(data.createdAt) || toDateValue(data.paidAt);
    if (createdAt && createdAt > cutoff) return;
    const createdByRaw = data.createdBy || null;
    const uid =
      data.createdByUid ||
      (createdByRaw && createdByRaw.uid) ||
      (typeof createdByRaw === "string" ? createdByRaw : null) ||
      null;
    const email =
      data.createdByEmail ||
      (createdByRaw && createdByRaw.email) ||
      data.userEmail ||
      null;
    const amount =
      toNumber(data.amountPaid ?? data.amount ?? 0) ||
      toNumber(data.interestPaid || 0) + toNumber(data.principalPaid || 0);
    if (!amount || amount <= 0) return;
    const key = uid || email;
    if (!key) return;
    const current = totalsByKey.get(key) || { uid, email, total: 0 };
    totalsByKey.set(key, {
      uid: current.uid || uid,
      email: current.email || email,
      total: current.total + amount
    });
  });

  let updated = 0;
  for (const entry of totalsByKey.values()) {
    let targetUid = entry.uid || null;
    let targetEmail = entry.email || null;
    if (!targetUid && targetEmail) {
      const resolved = await resolveUserByEmail(targetEmail);
      if (resolved) {
        targetUid = resolved.uid;
        targetEmail = resolved.email || targetEmail;
      }
    }
    if (!targetUid) continue;
    const email = String(targetEmail || "").trim() || "Sin asignar";
    const ledgerRef = db.collection("ledger").doc();
    await db.runTransaction(async (tx) => {
      const walletRef = db.collection("wallets").doc(targetUid);
      const walletSnap = await tx.get(walletRef);
      const data = walletSnap.exists ? walletSnap.data() || {} : {};
      const currentBalance = roundMoney(toNumber(data.balance ?? data.balanceArs ?? data.liquidARS ?? 0));
      const nextBalance = roundMoney(currentBalance + entry.total);
      tx.set(
        walletRef,
        {
          uid: targetUid,
          email,
          balance: nextBalance,
          balanceArs: nextBalance,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      tx.set(ledgerRef, {
        type: "migration",
        amountARS: roundMoney(entry.total),
        toUid: targetUid,
        createdByUid: "migration-script",
        createdByEmail: "migration-script",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        note: "Migración histórico previo a wallets"
      });
      const movementRef = db.collection("wallet_movements").doc();
      tx.set(movementRef, {
        type: "migration",
        amount: roundMoney(entry.total),
        toUid: targetUid,
        createdByUid: "migration-script",
        createdByEmail: "migration-script",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        note: "Migración histórico previo a wallets"
      });
    });
    updated += 1;
  }

  await migrationRef.set(
    {
      done: true,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      walletsUpdated: updated
    },
    { merge: true }
  );

  console.log("[MIGRATION] walletsUpdated:", updated);
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[MIGRATION] Error:", error);
    process.exit(1);
  });
