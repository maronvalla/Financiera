const admin = require("firebase-admin");

async function logAudit(db, entry) {
  const payload = {
    action: entry.action,
    actorId: entry.actorId || null,
    actorEmail: entry.actorEmail || null,
    targetType: entry.targetType || null,
    targetId: entry.targetId || null,
    metadata: entry.metadata || {},
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await db.collection("audit_logs").add(payload);
}

module.exports = {
  logAudit
};
