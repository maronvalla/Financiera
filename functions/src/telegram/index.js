const functions = require("firebase-functions");
const { buildDueReport } = require("./buildDueReport");
const { sendTelegramMessage, splitTelegramMessage } = require("./sendTelegram");

function parseChatIds(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function getTelegramConfig() {
  const config = functions.config() || {};
  const chatRaw =
    (config.telegram && config.telegram.chat) || process.env.TELEGRAM_CHAT_IDS || "";
  const chatIds = parseChatIds(chatRaw);
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const debugSecret = process.env.TELEGRAM_DEBUG_SECRET || "";
  return { chatIds, token, debugSecret };
}

function buildMessage(report) {
  const lines = [];
  lines.push(`Recordatorios de cobro - ${report.dateKey}`);
  lines.push("");

  report.clients.forEach((client) => {
    const headerParts = [client.name || "Sin nombre"];
    if (client.dni) headerParts.push(`DNI ${client.dni}`);
    if (client.phone) headerParts.push(`Tel ${client.phone}`);
    lines.push(headerParts.join(" · "));
    const typesLabel = client.types.length ? client.types.join(", ") : "simple";
    lines.push(`Tipo: ${typesLabel}`);
    lines.push(
      `Lo vencido + lo de hoy: $${client.totals.overdue} + $${client.totals.dueToday} = $${client.totals.total}`
    );
    client.loans.forEach((loan) => {
      lines.push(
        `- Préstamo ${loan.id}: Vencido $${loan.overdue} | Hoy $${loan.dueToday} | Total $${loan.total}`
      );
    });
    lines.push("----");
  });

  return lines.join("\n");
}

async function runTelegramDaily({ db, admin, helpers, force = false }) {
  const report = await buildDueReport({ db, helpers });
  const runRef = db.collection("telegramRuns").doc(report.dateKey);
  const runSnap = await runRef.get();
  if (runSnap.exists && !force) {
    const data = runSnap.data() || {};
    return {
      skipped: true,
      sentTo: data.sentTo || [],
      countClients: data.countClients || 0,
      countLoans: data.countLoans || 0,
      dateKey: report.dateKey
    };
  }

  const { chatIds, token } = getTelegramConfig();
  if (!chatIds.length) {
    throw new Error("TELEGRAM_CHAT_IDS no configurado.");
  }

  const message = report.clients.length ? buildMessage(report) : `Sin cobros para hoy (${report.dateKey}).`;
  const chunks = splitTelegramMessage(message);
  const sentTo = [];

  for (const chatId of chatIds) {
    for (const chunk of chunks) {
      await sendTelegramMessage({ token, chatId, text: chunk });
    }
    sentTo.push(chatId);
  }

  await runRef.set(
    {
      ranAt: admin.firestore.FieldValue.serverTimestamp(),
      sentTo,
      countClients: report.countClients,
      countLoans: report.countLoans
    },
    { merge: true }
  );

  await db.collection("telegramLogs").add({
    type: "summary",
    dateKey: report.dateKey,
    sentTo,
    countClients: report.countClients,
    countLoans: report.countLoans,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return {
    sentTo,
    countClients: report.countClients,
    countLoans: report.countLoans,
    dateKey: report.dateKey
  };
}

async function handleTelegramDailyRequest({ req, res, db, admin, helpers }) {
  try {
    const { debugSecret } = getTelegramConfig();
    const secret = String(req.query.secret || "").trim();
    if (!debugSecret || secret !== debugSecret) {
      return res.status(403).json({ ok: false, message: "Secret inválido." });
    }
    const force = String(req.query.force || "") === "1";
    const result = await runTelegramDaily({ db, admin, helpers, force });
    return res.json(result);
  } catch (error) {
    await db.collection("telegramLogs").add({
      type: "error",
      message: error.message || "Error ejecutando telegramDailyDue",
      details: error.details || null,
      stack: error.stack || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return res.status(500).json({
      ok: false,
      message: error.message || "Fallo en Telegram.",
      details: error.details || null
    });
  }
}

module.exports = {
  runTelegramDaily,
  handleTelegramDailyRequest
};
