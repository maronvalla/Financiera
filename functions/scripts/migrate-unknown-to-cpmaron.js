const admin = require("firebase-admin");

const TARGET_EMAIL = "cpmaron@gmail.com";

admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();

function isMissingOrUnknown(value) {
  const text = String(value || "").trim().toLowerCase();
  return !text || text === "unknown" || text === "sin asignar";
}

async function getTargetUid() {
  try {
    const user = await admin.auth().getUserByEmail(TARGET_EMAIL);
    return user?.uid || null;
  } catch (error) {
    console.warn("[MIGRATE] No se encontro UID para", TARGET_EMAIL);
    return null;
  }
}

async function processSnapshot(label, snap, targetUid) {
  if (!snap || snap.empty) {
    console.log(`[MIGRATE] ${label}: 0 documentos`);
    return 0;
  }

  let updated = 0;
  let batch = db.batch();
  let batchSize = 0;
  const flush = async () => {
    if (!batchSize) return;
    await batch.commit();
    batch = db.batch();
    batchSize = 0;
  };

  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const createdByRaw = data.createdBy || null;
    const currentEmail =
      data.createdByEmail || data.userEmail || (createdByRaw && createdByRaw.email) || "";
    const currentUid =
      data.createdByUid ||
      (createdByRaw && createdByRaw.uid) ||
      (typeof createdByRaw === "string" ? createdByRaw : "");
    if (!isMissingOrUnknown(currentEmail) && !isMissingOrUnknown(currentUid)) {
      continue;
    }

    const payload = {};
    if (isMissingOrUnknown(currentEmail)) {
      payload.createdByEmail = TARGET_EMAIL;
    }
    if (isMissingOrUnknown(currentUid) && targetUid) {
      payload.createdByUid = targetUid;
    }
    if (Object.keys(payload).length === 0) continue;

    batch.set(docSnap.ref, payload, { merge: true });
    batchSize += 1;
    updated += 1;
    if (batchSize >= 400) {
      await flush();
    }
  }

  await flush();
  console.log(`[MIGRATE] ${label}: ${updated} documentos actualizados`);
  return updated;
}

async function run() {
  const targetUid = await getTargetUid();
  console.log("[MIGRATE] targetUid:", targetUid || "(no encontrado)");

  const paymentsSnap = await db.collectionGroup("payments").get();
  const ledgerSnap = await db.collection("ledger").get();

  const updatedPayments = await processSnapshot("payments", paymentsSnap, targetUid);
  const updatedLedger = await processSnapshot("ledger", ledgerSnap, targetUid);

  console.log("[MIGRATE] Total actualizados:", updatedPayments + updatedLedger);
}

run()
  .then(() => {
    console.log("[MIGRATE] done");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[MIGRATE] Error:", error);
    process.exit(1);
  });
