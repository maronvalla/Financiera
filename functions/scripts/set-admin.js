import admin from "firebase-admin";

admin.initializeApp({
  projectId: "financiera-95144",
});

// 👉 poné todos los UID que quieras
const ADMIN_UIDS = [
  "epgxc4aVqyLq9dh9B6CB2RuFw9m2",
  "7i4xeeJZnrRPndOqoo1OOPvSjVJ2",
];

async function setAdmins() {
  for (const uid of ADMIN_UIDS) {
    await admin.auth().setCustomUserClaims(uid, {
      admin: true,
    });
    console.log(`✅ Admin asignado a ${uid}`);
  }

  console.log("🎉 Todos los admins configurados");
}

setAdmins().catch(console.error);