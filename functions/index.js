const admin = require("firebase-admin");
const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const { computeTotalDue, roundMoney } = require("./computeTotalDue");
const { logAudit } = require("./audit");
const { requireAuth } = require("./middleware/requireAuth");
const { runTelegramDaily, handleTelegramDailyRequest } = require("./src/telegram");

admin.initializeApp();
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const app = express();
const corsOptions = {
  origin: [
    "https://financiera-95144.web.app",
    "https://financiera-95144.firebaseapp.com",
    "http://localhost:5173"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

app.use((req, res, next) => {
  res.set("Content-Type", "application/json; charset=utf-8");
  next();
});

app.use("/loans", requireAuth);
app.use("/payments", requireAuth);
app.use("/dollars", requireAuth);
app.use("/reports", requireAuth);

app.get("/", (req, res) => {
  return res.json({ ok: true, service: "api" });
});

app.get("/health", (req, res) => {
  return res.json({ ok: true });
});
app.get("/auth/me", requireAuth, (req, res) => {
  (async () => {
    const uid = req.user?.uid || null;
    const roleInfo = await getRoleInfo(uid, req.user?.email || null);
    res.json({
      ok: true,
      uid,
      role: roleInfo.role,
      roleSource: roleInfo.source,
      isAdmin: roleInfo.admin === true,
      active: roleInfo.active,
      email: req.user?.email || null
    });
  })().catch((error) => {
    res.json({
      ok: true,
      uid: req.user?.uid || null,
      role: null,
      roleSource: "error",
      isAdmin: false,
      active: null,
      email: req.user?.email || null,
      message: error.message || "No se pudo cargar el usuario."
    });
  });
});

app.get("/bot/telegram-daily", async (req, res) => {
  return handleTelegramDailyRequest({ req, res, db, admin, helpers: getTelegramHelpers() });
});

exports.api = functions
  .runWith({ secrets: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_DEBUG_SECRET"] })
  .https.onRequest(app);

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLoanType(value) {
  const raw = String(value || "").toLowerCase();
  if (raw === "american") return "americano";
  return raw === "americano" ? "americano" : "simple";
}

function normalizeLoanStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "active" || raw === "activo" || raw === "activos") return "active";
  if (raw === "finished" || raw === "finalizado" || raw === "finalizados") return "finished";
  if (raw === "late" || raw === "moroso" || raw === "morosos") return "late";
  if (
    raw === "bad_debt" ||
    raw === "incobrable" ||
    raw === "incobrables" ||
    raw === "defaulted"
  ) {
    return "bad_debt";
  }
  if (raw === "void" || raw === "anulado" || raw === "voided") return "void";
  return raw;
}

function getTelegramHelpers() {
  return {
    normalizeLoanType,
    normalizeLoanStatus,
    ensureLoanInstallments,
    isInstallmentPaid,
    toDateValue,
    getArgentinaDateString,
    roundMoney,
    toNumber,
    normalizePhone
  };
}
function getStatusFilterValues(rawStatus) {
  const normalized = normalizeLoanStatus(rawStatus);
  if (!normalized) return { normalized: "", values: [] };
  switch (normalized) {
    case "active":
      return { normalized, values: ["active", "activo", "activos"] };
    case "finished":
      return { normalized, values: ["finished", "finalizado", "finalizados"] };
    case "late":
      return { normalized, values: ["late", "moroso", "morosos"] };
    case "bad_debt":
      return { normalized, values: ["bad_debt", "incobrable", "incobrables", "defaulted"] };
    case "void":
      return { normalized, values: ["void", "anulado", "voided"] };
    default:
      return { normalized, values: [normalized] };
  }
}

function isInstallmentPaid(installment) {
  const amount = roundMoney(toNumber(installment?.amount));
  const paidTotal = roundMoney(toNumber(installment?.paidTotal));
  return amount > 0 ? paidTotal >= amount - 0.01 : paidTotal > 0;
}

function computeNextDueDateFromInstallments(installments) {
  if (!Array.isArray(installments) || installments.length === 0) return null;
  let next = null;
  installments.forEach((item) => {
    if (isInstallmentPaid(item)) return;
    const dueDateValue = toDateValue(item?.dueDate);
    if (!dueDateValue) return;
    if (!next || dueDateValue < next) {
      next = dueDateValue;
    }
  });
  return next;
}

function computeCapitalPending(loan) {
  const loanType = normalizeLoanType(loan?.loanType);
  if (loanType === "americano") {
    return roundMoney(Math.max(toNumber(loan?.principalOutstanding ?? loan?.balance ?? 0), 0));
  }
  return roundMoney(Math.max(toNumber(loan?.balance ?? 0), 0));
}

function getLoanOutstanding(loan) {
  const loanType = normalizeLoanType(loan?.loanType);
  if (loanType === "americano") {
    return roundMoney(
      Math.max(
        toNumber(loan?.principalOutstanding ?? loan?.balance ?? loan?.principal ?? 0),
        0
      )
    );
  }
  const balance = loan?.balance;
  if (balance != null) return roundMoney(Math.max(toNumber(balance), 0));
  const totalDue = toNumber(loan?.totalDue);
  const paidTotal = toNumber(loan?.paidTotal);
  return roundMoney(Math.max(totalDue - paidTotal, 0));
}

function describeValue(value) {
  return {
    value,
    type: typeof value,
    isArray: Array.isArray(value)
  };
}

function isMissingIndexError(error) {
  if (!error) return false;
  const code = error.code;
  const message = String(error.message || "");
  if (code === 9 || code === "FAILED_PRECONDITION") return true;
  const lowerMessage = message.toLowerCase();
  return lowerMessage.includes("failed_precondition") || lowerMessage.includes("requires an index");
}

function parseDecimal(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NaN;
  }
  if (value == null) return NaN;
  const text = String(value).trim();
  if (!text) return NaN;
  let normalized = text.replace(/\s/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function toNumberLoose(value) {
  if (value === null || value === undefined) return NaN;
  const s = String(value).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function parseCreatedAt(value, fallback = new Date()) {
  if (!value) return fallback;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
}

function formatDateOnly(value) {
  const date = toDateValue(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function formatDateTime(value) {
  const date = toDateValue(value);
  return date ? date.toISOString() : null;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDni(value) {
  return String(value || "").replace(/\D/g, "");
}

function toNumberSafe(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.includes("+")) {
    cleaned = `+${cleaned.replace(/[^\d]/g, "")}`;
  }
  return cleaned;
}

function normalizeEmailValue(value) {
  const email = String(value || "").trim();
  return email || "Sin asignar";
}

function normalizeEmailForMatch(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email === "sin asignar") return "";
  return email;
}

let cachedAdminConfig = {
  fetchedAt: 0,
  uids: new Set(),
  emails: new Set()
};

async function getAdminConfig() {
  const now = Date.now();
  if (cachedAdminConfig.fetchedAt && now - cachedAdminConfig.fetchedAt < 5 * 60 * 1000) {
    return cachedAdminConfig;
  }
  const snap = await db.collection("config").doc("admins").get();
  const data = snap.exists ? snap.data() || {} : {};
  const uids = Array.isArray(data.uids) ? data.uids : [];
  const emails = Array.isArray(data.emails) ? data.emails : [];
  cachedAdminConfig = {
    fetchedAt: now,
    uids: new Set(uids.map((uid) => String(uid || "").trim()).filter(Boolean)),
    emails: new Set(
      emails.map((email) => normalizeEmailForMatch(email)).filter(Boolean)
    )
  };
  return cachedAdminConfig;
}

async function resolveUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  try {
    return await admin.auth().getUserByEmail(normalized);
  } catch (error) {
    functions.logger.warn("[WALLET] user not found for email", normalized);
    return null;
  }
}

async function getWalletData(tx, uid, fallbackEmail) {
  const walletUid = uid || "unknown";
  const walletRef = db.collection("wallets").doc(walletUid);
  const walletSnap = await tx.get(walletRef);
  const data = walletSnap.exists ? walletSnap.data() || {} : {};
  const email = normalizeEmailValue(data.email || fallbackEmail || "Sin asignar");
  const balance = roundMoney(toNumber(data.balance ?? data.balanceArs ?? data.liquidARS ?? 0));
  return { walletRef, walletUid, email, balance };
}

function buildWalletSnapshot(wallet) {
  return {
    uid: wallet.uid,
    email: normalizeEmailValue(wallet.email || "Sin asignar"),
    balance: roundMoney(toNumber(wallet.balance ?? wallet.balanceArs ?? wallet.liquidARS ?? 0)),
    movementsCount: Number(wallet.movementsCount || 0),
    totalIn: roundMoney(toNumber(wallet.totalIn || 0)),
    totalOut: roundMoney(toNumber(wallet.totalOut || 0))
  };
}

async function ensureWalletExists(uid, email) {
  if (!uid) return;
  const ref = db.collection("wallets").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      uid,
      email: normalizeEmailValue(email || "Sin asignar"),
      balance: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } else if (email) {
    await ref.set(
      {
        uid,
        email: normalizeEmailValue(email || "Sin asignar"),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  }
}

async function ensureAuthWalletsThrottled() {
  const markerRef = db.collection("walletsBootstrap").doc("auth");
  const markerSnap = await markerRef.get();
  const lastRun = markerSnap.exists ? toDateValue(markerSnap.data()?.updatedAt) : null;
  const now = new Date();
  if (lastRun && now.getTime() - lastRun.getTime() < 60 * 60 * 1000) {
    return;
  }
  const users = await admin.auth().listUsers(1000);
  for (const user of users.users) {
    if (!user?.uid) continue;
    await ensureWalletExists(user.uid, user.email || "Sin asignar");
  }
  await markerRef.set(
    {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      count: users.users.length
    },
    { merge: true }
  );
}


function normalizeInterestSplit(input, fallback = { totalPct: 100, intermediaryPct: 0, myPct: 100 }) {
  if (!input) return { ...fallback };
  const totalPct = toNumberSafe(input.totalPct);
  const intermediaryPct = toNumberSafe(input.intermediaryPct);
  const myPct = toNumberSafe(input.myPct);
  const normalizedTotal = totalPct > 0 ? totalPct : intermediaryPct + myPct;
  const normalizedMy = myPct > 0 ? myPct : Math.max(normalizedTotal - intermediaryPct, 0);
  return {
    totalPct: normalizedTotal > 0 ? normalizedTotal : fallback.totalPct,
    intermediaryPct: intermediaryPct > 0 ? intermediaryPct : 0,
    myPct: normalizedMy > 0 ? normalizedMy : fallback.myPct
  };
}

function computeInterestSplit(loan, interestTotal) {
  const total = roundMoney(Math.max(toNumberSafe(interestTotal), 0));
  const hasIntermediary = !!loan?.hasIntermediary;
  const split = hasIntermediary
    ? normalizeInterestSplit(loan?.interestSplit, { totalPct: 100, intermediaryPct: 0, myPct: 100 })
    : { totalPct: 100, intermediaryPct: 0, myPct: 100 };
  const ratioMine = split.totalPct > 0 ? split.myPct / split.totalPct : 1;
  const interestMine = roundMoney(total * ratioMine);
  const interestIntermediary = roundMoney(Math.max(total - interestMine, 0));
  return {
    interestTotal: total,
    interestMine,
    interestIntermediary
  };
}

function formatMonthKey(date) {
  if (!date) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildMovementPayload({
  type,
  customer = null,
  loan = null,
  payment = null,
  usd = null,
  note = "",
  occurredAt = null,
  createdBy = null,
  relatedId = null
}) {
  return {
    type,
    customer,
    loan,
    payment,
    usd,
    note,
    occurredAt,
    relatedId,
    createdBy: createdBy || null,
    voided: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

function buildLedgerPayload({
  type,
  amountARS,
  interestARS = null,
  principalARS = null,
  date,
  createdByUid = null,
  createdByEmail = null,
  loanId = null,
  customerDni = null,
  note = "",
  source = "payments",
  interestMineARS = null,
  interestIntermediaryARS = null
}) {
  const payload = {
    type,
    amountARS: roundMoney(toNumber(amountARS)),
    date: date ? admin.firestore.Timestamp.fromDate(date) : null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdByUid: createdByUid || null,
    createdByEmail: createdByEmail || null,
    loanId: loanId || null,
    customerDni: customerDni || null,
    note: note || "",
    source
  };
  if (interestARS != null) payload.interestARS = roundMoney(toNumber(interestARS));
  if (principalARS != null) payload.principalARS = roundMoney(toNumber(principalARS));
  if (interestMineARS != null) payload.interestMineARS = roundMoney(toNumber(interestMineARS));
  if (interestIntermediaryARS != null) {
    payload.interestIntermediaryARS = roundMoney(toNumber(interestIntermediaryARS));
  }
  return payload;
}

function sendJsonError(res, status, { code, message, details }) {
  return res.status(status).json({
    ok: false,
    code,
    message,
    details
  });
}

async function getRoleInfo(uid, emailHint) {
  if (!uid) return { admin: false, role: null, source: "no-uid", active: null, raw: {} };
  const [userSnap, adminConfig] = await Promise.all([
    db.collection("users").doc(uid).get(),
    getAdminConfig()
  ]);
  const user = userSnap.exists ? userSnap.data() || {} : {};
  const rawRole = user.role ?? null;
  const roleText = rawRole != null ? String(rawRole).trim() : "";
  const roleLower = roleText.toLowerCase();
  const normalizedEmail = normalizeEmailForMatch(
    emailHint || user.email || user.userEmail || user.mail || ""
  );
  const isAdmin =
    adminConfig.uids.has(uid) || (normalizedEmail && adminConfig.emails.has(normalizedEmail));
  return {
    admin: isAdmin,
    role: isAdmin ? "admin" : roleLower || null,
    source: isAdmin ? "config/admins" : "users",
    active: user.active ?? null,
    raw: { role: rawRole, email: normalizedEmail }
  };
}

async function isAdmin(req) {
  const uid = req.user?.uid || null;
  const roleInfo = await getRoleInfo(uid, req.user?.email || null);
  return { admin: roleInfo.admin, source: roleInfo.source, role: roleInfo.role, raw: roleInfo.raw };
}

async function requireAdmin(req, res) {
  const uid = req.user?.uid;
  if (!uid) {
    res.status(401).json({ ok: false, code: "UNAUTHENTICATED", message: "Token requerido." });
    return null;
  }
  const { admin, source, role, raw } = await isAdmin(req);
  const email = req.user?.email || null;
  console.log("[ADMIN_CHECK]", { uid, email, admin, source, role, raw });
  if (!admin) {
    res.status(403).json({ ok: false, code: "FORBIDDEN", message: "No tenés permisos para anular." });
    return null;
  }
  return { uid, role: "admin", email, source };
}
function toDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
}

function parseISODateUTC(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function toUtcDate(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDaysUTC(baseDate, daysToAdd) {
  return new Date(
    Date.UTC(
      baseDate.getUTCFullYear(),
      baseDate.getUTCMonth(),
      baseDate.getUTCDate() + daysToAdd
    )
  );
}

function addMonthsKeepingDayUTC(baseDate, monthsToAdd) {
  const baseDay = baseDate.getUTCDate();
  const target = new Date(
    Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + monthsToAdd, 1)
  );
  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const day = Math.min(baseDay, daysInTargetMonth);
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day));
}

const PERIODS = {
  monthly: { monthsFactor: 1, toMonthly: 1 },
  weekly: { monthsFactor: 1 / 4, toMonthly: 4 },
  biweekly: { monthsFactor: 1 / 2, toMonthly: 2 }
};

function addPeriods(startDate, frequency, count) {
  let current = toUtcDate(startDate);
  for (let i = 0; i < count; i += 1) {
    current = addPeriod(current, frequency);
  }
  return current;
}

function buildInstallmentsForLoan(loan) {
  const termCount = toNumber(loan.termCount);
  const totalDue = roundMoney(toNumber(loan.totalDue));
  const frequency = loan.termPeriod || loan.frequency || "monthly";
  const startDate = toDateValue(loan.startDate) || toDateValue(loan.createdAt);

  if (!termCount || totalDue <= 0 || !startDate) {
    return null;
  }

  const totalCents = Math.round(totalDue * 100);
  const baseCents = Math.floor(totalCents / termCount);
  const installments = [];

  for (let i = 1; i <= termCount; i += 1) {
    const dueDate = addPeriods(startDate, frequency, i);
    const amountCents =
      i === termCount ? totalCents - baseCents * (termCount - 1) : baseCents;

    installments.push({
      number: i,
      dueDate: admin.firestore.Timestamp.fromDate(dueDate),
      amount: amountCents / 100,
      paidTotal: 0
    });
  }

  return installments;
}

function applyPaidTotalToInstallments(installments, paidTotal) {
  let remaining = roundMoney(toNumber(paidTotal));
  installments.forEach((installment) => {
    if (remaining <= 0) {
      installment.paidTotal = roundMoney(toNumber(installment.paidTotal));
      return;
    }
    const amount = roundMoney(toNumber(installment.amount));
    const applied = Math.min(amount, remaining);
    installment.paidTotal = roundMoney(applied);
    remaining = roundMoney(remaining - applied);
  });
}

function normalizeInstallments(installments) {
  if (!Array.isArray(installments)) return null;
  return installments.map((item, index) => {
    const dueDateValue = toDateValue(item?.dueDate);
    return {
      number: toNumber(item?.number) || index + 1,
      dueDate: dueDateValue ? admin.firestore.Timestamp.fromDate(toUtcDate(dueDateValue)) : null,
      amount: roundMoney(toNumber(item?.amount)),
      paidTotal: roundMoney(Math.max(toNumber(item?.paidTotal), 0))
    };
  });
}

function ensureLoanInstallments(loan) {
  if (normalizeLoanType(loan?.loanType) === "americano") {
    return {
      installments: null,
      needsUpdate: false,
      error: "Plan de cuotas no disponible para Préstamos americanos."
    };
  }
  const termCount = toNumber(loan.termCount);
  const totalDue = roundMoney(toNumber(loan.totalDue));

  if (!termCount || totalDue <= 0) {
    return { installments: null, needsUpdate: false, error: "Plan de cuotas no disponible." };
  }

  const existing = normalizeInstallments(loan.installments);
  let installments = existing && existing.length ? existing : null;
  let needsUpdate = false;

  const hasInvalid =
    !installments ||
    installments.length !== termCount ||
    installments.some((item) => !item.amount || !item.dueDate);

  if (hasInvalid) {
    installments = buildInstallmentsForLoan(loan);
    if (installments) {
      applyPaidTotalToInstallments(installments, loan.paidTotal);
      needsUpdate = true;
    }
  } else {
    const needsPaidFix = installments.some((item) => item.paidTotal == null);
    if (needsPaidFix) {
      installments = installments.map((item) => ({
        ...item,
        paidTotal: roundMoney(toNumber(item.paidTotal))
      }));
      needsUpdate = true;
    }
    const sumPaid = installments.reduce((sum, item) => sum + toNumber(item.paidTotal), 0);
    if (toNumber(loan.paidTotal) > 0 && Math.abs(sumPaid - toNumber(loan.paidTotal)) > 0.01) {
      applyPaidTotalToInstallments(installments, loan.paidTotal);
      needsUpdate = true;
    }
  }

  return { installments, needsUpdate, error: null };
}

function parsePaidAtInput(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsedDay = parseISODateUTC(text);
  if (parsedDay) return parsedDay;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function computeLoanStatus(loan, now = new Date()) {
  const normalizedStatus = normalizeLoanStatus(loan?.status);
  if (normalizedStatus === "bad_debt") return "bad_debt";
  const fundingStatus = String(loan?.funding?.status || "").toUpperCase();
  if (fundingStatus === "PENDING") return "pending";
  if (fundingStatus === "REJECTED") return "rejected";
  const loanType = normalizeLoanType(loan?.loanType);
  const balance = loanType === "americano" ? getLoanOutstanding(loan) : Number(loan.balance || 0);
  const capitalPending = computeCapitalPending(loan);
  if (loanType === "americano") {
    if (capitalPending <= 0) return "finished";
    const nextDueDateValue =
      toDateValue(loan.nextDueDate) ||
      toDateValue(loan.nextDueAt) ||
      toDateValue(loan.lastInterestPaidAt);
    if (nextDueDateValue && now > nextDueDateValue) return "late";
    return "active";
  }

  const frequency = loan.frequency || loan.termPeriod || "monthly";
  const totalDue = Number(loan.totalDue || 0);
  const termCount = Number(loan.termCount || 0);
  const paidTotal = Number(loan.paidTotal || 0);
  const startDate = toDateValue(loan.startDate) || toDateValue(loan.createdAt);
  const installments = normalizeInstallments(loan.installments || []);

  if (capitalPending <= 0 || balance <= 0) {
    if (installments && installments.length > 0) {
      const allPaid = installments.every((item) => isInstallmentPaid(item));
      if (allPaid) return "finished";
    } else if (termCount > 0 && totalDue > 0) {
      return "finished";
    }
  }

  const computedNextDueDate =
    toDateValue(loan.nextDueDate) ||
    toDateValue(loan.nextDueAt) ||
    computeNextDueDateFromInstallments(installments);
  if (computedNextDueDate) {
    return now > computedNextDueDate ? "late" : "active";
  }

  if (!startDate || termCount <= 0 || totalDue <= 0) {
    return "active";
  }

  const installmentAmount = totalDue / termCount;
  let dueCount = 0;
  for (let i = 1; i <= termCount; i += 1) {
    const dueDate = addPeriods(startDate, frequency, i);
    if (dueDate <= now) {
      dueCount += 1;
    } else {
      break;
    }
  }

  if (dueCount === 0) return "active";

  const paidInstallments = installmentAmount > 0
    ? Math.floor((paidTotal + 0.01) / installmentAmount)
    : 0;

  if (paidInstallments >= dueCount) return "active";

  const overdueIndex = Math.min(paidInstallments + 1, termCount);
  const overdueDate = addPeriods(startDate, frequency, overdueIndex);
  return now > overdueDate ? "late" : "active";
}

function computeLoanPendingBreakdown(loan) {
  const loanType = normalizeLoanType(loan?.loanType);
  if (loanType === "americano") {
    const capitalPending = getLoanOutstanding(loan);
    return {
      capitalPending,
      interestPending: 0,
      totalPending: capitalPending
    };
  }
  const totalDue = toNumber(loan.totalDue);
  const principal = toNumber(loan.principal);
  const paidTotal = toNumber(loan.paidTotal);
  const balance = toNumber(loan.balance);
  const remainingTotal = balance > 0 ? balance : Math.max(totalDue - paidTotal, 0);

  const hasExplicitBreakdown =
    loan.totalCapital != null ||
    loan.totalInterest != null ||
    loan.paidCapital != null ||
    loan.paidInterest != null;

  if (hasExplicitBreakdown) {
    const totalCapital =
      loan.totalCapital != null ? toNumber(loan.totalCapital) : principal;
    const totalInterest =
      loan.totalInterest != null ? toNumber(loan.totalInterest) : Math.max(totalDue - totalCapital, 0);
    const paidCapital = loan.paidCapital != null ? toNumber(loan.paidCapital) : 0;
    const paidInterest = loan.paidInterest != null ? toNumber(loan.paidInterest) : 0;
    const capitalPending = Math.max(totalCapital - paidCapital, 0);
    const interestPending = Math.max(totalInterest - paidInterest, 0);
    return {
      capitalPending,
      interestPending,
      totalPending: capitalPending + interestPending
    };
  }

  // TODO: Si luego se guarda un breakdown real por cuota/pago, reemplazar este prorrateo.
  if (totalDue <= 0) {
    return { capitalPending: remainingTotal, interestPending: 0, totalPending: remainingTotal };
  }
  const capitalShare = principal > 0 ? principal / totalDue : 0;
  const capitalPending = Math.round(remainingTotal * capitalShare);
  const interestPending = Math.max(remainingTotal - capitalPending, 0);
  return {
    capitalPending,
    interestPending,
    totalPending: capitalPending + interestPending
  };
}

async function registerInstallmentPayment({
  loanId,
  paymentId,
  installmentNumber,
  amount,
  paidAt,
  method,
  note,
  createdBy,
  createdByUid,
  createdByEmail
}) {
  const loanRef = db.collection("loans").doc(loanId);
  const paymentRef = paymentId
    ? db.collection("payments").doc(paymentId)
    : db.collection("payments").doc();
  const loanPaymentRef = loanRef.collection("payments").doc(paymentRef.id);
  const movementRef = db.collection("movements").doc();
  const ledgerRef = db.collection("ledger").doc();
  const walletPaymentLedgerRef = db.collection("ledger").doc();
  const walletInterestLedgerRef = db.collection("ledger").doc();
  const walletPrincipalLedgerRef = db.collection("ledger").doc();
  const walletMovementRef = db.collection("wallet_movements").doc();
  const treasurySummaryRef = db.collection("treasurySummary").doc("primary");
  const treasuryUserRef = db.collection("treasuryUsers").doc(createdByUid || "unknown");
  let result = null;

  await db.runTransaction(async (tx) => {
    const [loanSnap, paymentSnap] = await Promise.all([
      tx.get(loanRef),
      tx.get(paymentRef)
    ]);
    if (!loanSnap.exists) {
      const error = new Error("Préstamo no existe.");
      error.status = 404;
      throw error;
    }

    const loan = loanSnap.data() || {};
    if (paymentSnap.exists) {
      result = {
        paymentId: paymentRef.id,
        installmentUpdated: false,
        loanStatus: normalizeLoanStatus(loan.status) || loan.status,
        alreadyExists: true
      };
      return;
    }
    const fundingStatus = String(loan?.funding?.status || "").toUpperCase();
    if (fundingStatus === "PENDING") {
      const err = new Error("El Préstamo está pendiente de aprobación.");
      err.status = 400;
      throw err;
    }
    const { installments, error } = ensureLoanInstallments(loan);
    if (!installments) {
      const err = new Error(error || "Plan de cuotas no disponible.");
      err.status = 400;
      throw err;
    }

    const walletUid = createdByUid || createdBy || "unknown";
    const walletEmail = normalizeEmailValue(createdByEmail || "Sin asignar");
    const wallet = await getWalletData(tx, walletUid, walletEmail);

    const numericInstallment = toNumber(installmentNumber);
    let installmentIndex = -1;
    if (numericInstallment > 0) {
      installmentIndex = installments.findIndex(
        (item) => toNumber(item.number) === numericInstallment
      );
    } else {
      installmentIndex = installments.findIndex((item) => {
        const pending = roundMoney(Math.max(toNumber(item.amount) - toNumber(item.paidTotal), 0));
        return pending > 0;
      });
    }

    if (installmentIndex < 0) {
      const err = new Error("Cuota inv?lida.");
      err.status = 400;
      throw err;
    }

    const installment = installments[installmentIndex];
    const pendingAmount = roundMoney(
      Math.max(toNumber(installment.amount) - toNumber(installment.paidTotal), 0)
    );

    if (amount > pendingAmount) {
      const err = new Error("El monto excede el pendiente de la cuota.");
      err.status = 400;
      err.code = "EXCEEDS_PENDING";
      throw err;
    }

    const newPaidTotal = roundMoney(toNumber(installment.paidTotal) + amount);
    installments[installmentIndex] = { ...installment, paidTotal: newPaidTotal };

    const loanPaidTotal = roundMoney(toNumber(loan.paidTotal) + amount);
    const balance = roundMoney(Math.max(toNumber(loan.totalDue) - loanPaidTotal, 0));
    const allPaid = installments.every(
      (item) => roundMoney(toNumber(item.amount) - toNumber(item.paidTotal)) <= 0
    );
    const status = allPaid || balance <= 0 ? "finished" : "active";

    const loanTotalDue = roundMoney(toNumber(loan.totalDue));
    const loanPrincipal = roundMoney(toNumber(loan.principal));
    const loanInterestTotal = Math.max(loanTotalDue - loanPrincipal, 0);
    const interestRatio = loanTotalDue > 0 ? loanInterestTotal / loanTotalDue : 0;
    const interestPaid = roundMoney(amount * interestRatio);
    const principalPaid = roundMoney(amount - interestPaid);
    const interestSplit = computeInterestSplit(loan, interestPaid);
    const amountPaid = roundMoney(principalPaid + interestSplit.interestTotal);
    const nextDueDateValue = computeNextDueDateFromInstallments(installments);
    const endDate = status === "finished" ? formatDateOnly(paidAt || new Date()) : null;

    const paidAtDate = paidAt ? paidAt : new Date();
    const paidMonth = formatMonthKey(paidAtDate);
    const paymentPayload = {
      loanId: loanRef.id,
      customerId: loan.customerId || null,
      customerDni: loan.customerDni || loan.dni || loan.dniCliente || null,
      customerName: loan.customerName || null,
      installmentNumber: toNumber(installment.number),
      amount,
      amountPaid,
      interestPaid,
      interestTotal: interestSplit.interestTotal,
      interestMine: interestSplit.interestMine,
      interestIntermediary: interestSplit.interestIntermediary,
      principalPaid,
      capitalPaid: principalPaid,
      paidAt: admin.firestore.Timestamp.fromDate(paidAtDate),
      paidAtText: paidAtDate.toISOString().slice(0, 10),
      paidMonth,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      method: method || "cash",
      note: note || "",
      createdBy: createdBy || null,
      createdByUid: createdByUid || createdBy || null,
      createdByEmail: createdByEmail || null
    };

    const profitRef = db.collection("profitMonthly").doc(paidMonth);

    tx.set(paymentRef, paymentPayload);
    tx.set(loanPaymentRef, paymentPayload);
    tx.set(
      ledgerRef,
      buildLedgerPayload({
        type: "payment",
        amountARS: amountPaid,
        interestARS: interestSplit.interestTotal,
        principalARS: principalPaid,
        interestMineARS: interestSplit.interestMine,
        interestIntermediaryARS: interestSplit.interestIntermediary,
        date: paidAtDate,
        createdByUid: createdByUid || createdBy || null,
        createdByEmail: createdByEmail || null,
        loanId: loanRef.id,
        customerDni: loan.customerDni || loan.dni || loan.dniCliente || null,
        note: note || "",
        source: "payments"
      })
    );
    const nextBalance = roundMoney(wallet.balance + amountPaid);
    tx.set(
      wallet.walletRef,
      {
        uid: wallet.walletUid,
        email: wallet.email,
        balance: nextBalance,
        balanceArs: nextBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    tx.set(walletPaymentLedgerRef, {
      type: "PAYMENT_CREDIT",
      amountARS: amountPaid,
      toUid: wallet.walletUid,
      loanId: loanRef.id,
      paymentId: paymentRef.id,
      createdByUid: wallet.walletUid,
      createdByEmail: wallet.email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      meta: {
        interestTotal: interestSplit.interestTotal,
        principalPaid
      }
    });
    if (interestSplit.interestTotal > 0) {
      tx.set(walletInterestLedgerRef, {
        type: "LOAN_REPAY_INTEREST",
        amountARS: interestSplit.interestTotal,
        toUid: wallet.walletUid,
        loanId: loanRef.id,
        paymentId: paymentRef.id,
        createdByUid: wallet.walletUid,
        createdByEmail: wallet.email,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    if (principalPaid > 0) {
      tx.set(walletPrincipalLedgerRef, {
        type: "LOAN_REPAY_PRINCIPAL",
        amountARS: principalPaid,
        toUid: wallet.walletUid,
        loanId: loanRef.id,
        paymentId: paymentRef.id,
        createdByUid: wallet.walletUid,
        createdByEmail: wallet.email,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    tx.set(walletMovementRef, {
      type: "PAYMENT_CREDIT",
      amount: amountPaid,
      toUid: wallet.walletUid,
      createdByUid: wallet.walletUid,
      createdByEmail: wallet.email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      meta: {
        loanId: loanRef.id,
        paymentId: paymentRef.id
      }
    });
    tx.set(
      movementRef,
      buildMovementPayload({
        type: "payment_create",
        customer: {
          id: loan.customerId || null,
          dni: loan.customerDni || loan.dni || loan.dniCliente || null,
          name: loan.customerName || null
        },
        loan: {
          id: loanRef.id,
          loanType: normalizeLoanType(loan.loanType),
          status
        },
        payment: {
          id: paymentRef.id,
          amount,
          interestTotal: interestSplit.interestTotal,
          interestMine: interestSplit.interestMine,
          interestIntermediary: interestSplit.interestIntermediary,
          principalPaid,
          paidAt: paidAtDate.toISOString().slice(0, 10),
          method: method || "cash",
          note: note || ""
        },
        note: note || "",
        occurredAt: paidAtDate.toISOString().slice(0, 10),
        createdBy
      })
    );
    tx.set(
      profitRef,
      {
        month: paidMonth,
        mineArs: admin.firestore.FieldValue.increment(interestSplit.interestMine),
        intermediaryArs: admin.firestore.FieldValue.increment(interestSplit.interestIntermediary),
        interestTotalArs: admin.firestore.FieldValue.increment(interestSplit.interestTotal),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    tx.set(
      treasurySummaryRef,
      {
        totalCollectedArs: admin.firestore.FieldValue.increment(amountPaid),
        totalLoanOutstandingArs: admin.firestore.FieldValue.increment(-principalPaid),
        liquidArs: admin.firestore.FieldValue.increment(amountPaid),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    tx.set(
      treasuryUserRef,
      {
        email: createdByEmail || "Sin asignar",
        paymentsCount: admin.firestore.FieldValue.increment(1),
        collectedArs: admin.firestore.FieldValue.increment(amountPaid),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    tx.update(loanRef, {
      installments,
      paidTotal: loanPaidTotal,
      balance,
      capitalPending: balance,
      paidCapital: admin.firestore.FieldValue.increment(principalPaid),
      paidInterest: admin.firestore.FieldValue.increment(interestPaid),
      interestEarnedMineTotal: admin.firestore.FieldValue.increment(interestSplit.interestMine),
      interestEarnedIntermediaryTotal: admin.firestore.FieldValue.increment(
        interestSplit.interestIntermediary
      ),
      nextDueDate: nextDueDateValue ? formatDateOnly(nextDueDateValue) : null,
      nextDueAt: nextDueDateValue ? admin.firestore.Timestamp.fromDate(nextDueDateValue) : null,
      endDate,
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    result = {
      paymentId: paymentRef.id,
      installmentUpdated: {
        number: toNumber(installment.number),
        paidTotal: newPaidTotal,
        pendingAmount: roundMoney(Math.max(toNumber(installment.amount) - newPaidTotal, 0))
      },
      loanStatus: status
    };
  });

  return result;
}

async function registerAmericanPayment({
  loanId,
  paymentId,
  interestPaid,
  principalPaid,
  paidAt,
  method,
  note,
  createdBy,
  createdByUid,
  createdByEmail
}) {
  const loanRef = db.collection("loans").doc(loanId);
  const paymentRef = paymentId
    ? db.collection("payments").doc(paymentId)
    : db.collection("payments").doc();
  const loanPaymentRef = loanRef.collection("payments").doc(paymentRef.id);
  const movementRef = db.collection("movements").doc();
  const ledgerRef = db.collection("ledger").doc();
  const walletPaymentLedgerRef = db.collection("ledger").doc();
  const walletInterestLedgerRef = db.collection("ledger").doc();
  const walletPrincipalLedgerRef = db.collection("ledger").doc();
  const walletMovementRef = db.collection("wallet_movements").doc();
  const treasurySummaryRef = db.collection("treasurySummary").doc("primary");
  const treasuryUserRef = db.collection("treasuryUsers").doc(createdByUid || "unknown");
  let result = null;

  await db.runTransaction(async (tx) => {
    const [loanSnap, paymentSnap] = await Promise.all([
      tx.get(loanRef),
      tx.get(paymentRef)
    ]);
    if (!loanSnap.exists) {
      const error = new Error("Préstamo no existe.");
      error.status = 404;
      throw error;
    }

    const loan = loanSnap.data() || {};
    if (paymentSnap.exists) {
      result = {
        paymentId: paymentRef.id,
        loanStatus: normalizeLoanStatus(loan.status) || loan.status,
        principalOutstanding: Number(loan.principalOutstanding || loan.balance || 0),
        alreadyExists: true
      };
      return;
    }
    const fundingStatus = String(loan?.funding?.status || "").toUpperCase();
    if (fundingStatus === "PENDING") {
      const err = new Error("El Préstamo está pendiente de aprobación.");
      err.status = 400;
      throw err;
    }
    const loanType = normalizeLoanType(loan.loanType);
    if (loanType !== "americano") {
      const error = new Error("El Préstamo no es americano.");
      error.status = 400;
      throw error;
    }

    const walletUid = createdByUid || createdBy || "unknown";
    const walletEmail = normalizeEmailValue(createdByEmail || "Sin asignar");
    const wallet = await getWalletData(tx, walletUid, walletEmail);

    const currentOutstanding = getLoanOutstanding(loan);
    if (principalPaid > currentOutstanding) {
      const error = new Error("El capital pagado excede el pendiente.");
      error.status = 400;
      throw error;
    }

    const nextOutstanding = roundMoney(Math.max(currentOutstanding - principalPaid, 0));
    const totalPaid = roundMoney(toNumber(interestPaid) + toNumber(principalPaid));
    const nextPaidTotal = roundMoney(toNumber(loan.paidTotal) + totalPaid);
    const status = nextOutstanding <= 0 ? "finished" : normalizeLoanStatus(loan.status) || "active";
    const interestSplit = computeInterestSplit(loan, interestPaid);
    const amountPaid = roundMoney(principalPaid + interestSplit.interestTotal);
    const endDate = status === "finished" ? formatDateOnly(paidAt || new Date()) : null;

    const paidAtDate = paidAt ? paidAt : new Date();
    const paidMonth = formatMonthKey(paidAtDate);
    const paymentPayload = {
      loanId: loanRef.id,
      customerId: loan.customerId || null,
      customerDni: loan.customerDni || loan.dni || loan.dniCliente || null,
      customerName: loan.customerName || null,
      amount: totalPaid,
      amountPaid,
      interestPaid,
      interestTotal: interestSplit.interestTotal,
      interestMine: interestSplit.interestMine,
      interestIntermediary: interestSplit.interestIntermediary,
      principalPaid,
      capitalPaid: principalPaid,
      paidAt: admin.firestore.Timestamp.fromDate(paidAtDate),
      paidAtText: paidAtDate.toISOString().slice(0, 10),
      paidMonth,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      method: method || "cash",
      note: note || "",
      createdBy: createdBy || null,
      createdByUid: createdByUid || createdBy || null,
      createdByEmail: createdByEmail || null
    };

    const profitRef = db.collection("profitMonthly").doc(paidMonth);

    tx.set(paymentRef, paymentPayload);
    tx.set(loanPaymentRef, paymentPayload);
    tx.set(
      ledgerRef,
      buildLedgerPayload({
        type: "payment",
        amountARS: amountPaid,
        interestARS: interestSplit.interestTotal,
        principalARS: principalPaid,
        interestMineARS: interestSplit.interestMine,
        interestIntermediaryARS: interestSplit.interestIntermediary,
        date: paidAtDate,
        createdByUid: createdByUid || createdBy || null,
        createdByEmail: createdByEmail || null,
        loanId: loanRef.id,
        customerDni: loan.customerDni || loan.dni || loan.dniCliente || null,
        note: note || "",
        source: "payments"
      })
    );
    const nextBalance = roundMoney(wallet.balance + amountPaid);
    tx.set(
      wallet.walletRef,
      {
        uid: wallet.walletUid,
        email: wallet.email,
        balance: nextBalance,
        balanceArs: nextBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    tx.set(walletPaymentLedgerRef, {
      type: "PAYMENT_CREDIT",
      amountARS: amountPaid,
      toUid: wallet.walletUid,
      loanId: loanRef.id,
      paymentId: paymentRef.id,
      createdByUid: wallet.walletUid,
      createdByEmail: wallet.email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      meta: {
        interestTotal: interestSplit.interestTotal,
        principalPaid
      }
    });
    if (interestSplit.interestTotal > 0) {
      tx.set(walletInterestLedgerRef, {
        type: "LOAN_REPAY_INTEREST",
        amountARS: interestSplit.interestTotal,
        toUid: wallet.walletUid,
        loanId: loanRef.id,
        paymentId: paymentRef.id,
        createdByUid: wallet.walletUid,
        createdByEmail: wallet.email,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    if (principalPaid > 0) {
      tx.set(walletPrincipalLedgerRef, {
        type: "LOAN_REPAY_PRINCIPAL",
        amountARS: principalPaid,
        toUid: wallet.walletUid,
        loanId: loanRef.id,
        paymentId: paymentRef.id,
        createdByUid: wallet.walletUid,
        createdByEmail: wallet.email,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    tx.set(walletMovementRef, {
      type: "PAYMENT_CREDIT",
      amount: amountPaid,
      toUid: wallet.walletUid,
      createdByUid: wallet.walletUid,
      createdByEmail: wallet.email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      meta: {
        loanId: loanRef.id,
        paymentId: paymentRef.id
      }
    });
    tx.set(
      movementRef,
      buildMovementPayload({
        type: "payment_create",
        customer: {
          id: loan.customerId || null,
          dni: loan.customerDni || loan.dni || loan.dniCliente || null,
          name: loan.customerName || null
        },
        loan: {
          id: loanRef.id,
          loanType: normalizeLoanType(loan.loanType),
          status
        },
        payment: {
          id: paymentRef.id,
          amount: totalPaid,
          interestTotal: interestSplit.interestTotal,
          interestMine: interestSplit.interestMine,
          interestIntermediary: interestSplit.interestIntermediary,
          principalPaid,
          paidAt: paidAtDate.toISOString().slice(0, 10),
          method: method || "cash",
          note: note || ""
        },
        note: note || "",
        occurredAt: paidAtDate.toISOString().slice(0, 10),
        createdBy
      })
    );
    tx.set(
      profitRef,
      {
        month: paidMonth,
        mineArs: admin.firestore.FieldValue.increment(interestSplit.interestMine),
        intermediaryArs: admin.firestore.FieldValue.increment(interestSplit.interestIntermediary),
        interestTotalArs: admin.firestore.FieldValue.increment(interestSplit.interestTotal),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    tx.set(
      treasurySummaryRef,
      {
        totalCollectedArs: admin.firestore.FieldValue.increment(amountPaid),
        totalLoanOutstandingArs: admin.firestore.FieldValue.increment(-principalPaid),
        liquidArs: admin.firestore.FieldValue.increment(amountPaid),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    tx.set(
      treasuryUserRef,
      {
        email: createdByEmail || "Sin asignar",
        paymentsCount: admin.firestore.FieldValue.increment(1),
        collectedArs: admin.firestore.FieldValue.increment(amountPaid),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    tx.update(loanRef, {
      principalOutstanding: nextOutstanding,
      balance: nextOutstanding,
      paidTotal: nextPaidTotal,
      capitalPending: nextOutstanding,
      paidCapital: admin.firestore.FieldValue.increment(principalPaid),
      paidInterest: admin.firestore.FieldValue.increment(interestPaid),
      interestEarnedMineTotal: admin.firestore.FieldValue.increment(interestSplit.interestMine),
      interestEarnedIntermediaryTotal: admin.firestore.FieldValue.increment(
        interestSplit.interestIntermediary
      ),
      nextDueDate: formatDateOnly(addPeriod(paidAtDate, loan.frequency || loan.termPeriod || "monthly")),
      nextDueAt: admin.firestore.Timestamp.fromDate(
        addPeriod(paidAtDate, loan.frequency || loan.termPeriod || "monthly")
      ),
      endDate,
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    result = {
      paymentId: paymentRef.id,
      principalOutstanding: nextOutstanding,
      loanStatus: status
    };
  });

  return result;
}

app.get("/customers", requireAuth, async (req, res) => {
  try {
    const term = String(req.query.q || "").trim().toLowerCase();
    const dni = normalizeDni(req.query.dni);

    if (dni) {
      const items = [];
      const snapByField = await db.collection("customers").where("dni", "==", dni).limit(1).get();
      if (!snapByField.empty) {
        const docSnap = snapByField.docs[0];
        const data = docSnap.data() || {};
        if (!data.voided) items.push({ id: docSnap.id, ...data });
      } else {
        const snap = await db.collection("customers").doc(dni).get();
        if (snap.exists) {
          const data = snap.data() || {};
          if (!data.voided) items.push({ id: snap.id, ...data });
        }
      }
      return res.json({ items });
    }

    const snap = await db.collection("customers").orderBy("fullName").get();
    let items = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((customer) => !customer.voided);
    if (term) {
      items = items.filter((customer) => {
        const name = String(customer.fullName || "").toLowerCase();
        const customerDni = String(customer.dni || customer.id || "");
        return name.includes(term) || customerDni.includes(term);
      });
    }
    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudieron cargar los clientes." });
  }
});

app.get("/customers/search", requireAuth, async (req, res) => {
  try {
    const term = String(req.query.q || "").trim();
    if (!term) return res.json({ items: [] });

    const isDni = /^\d+$/.test(term);
    if (isDni) {
      const items = [];
      const snapByField = await db.collection("customers").where("dni", "==", term).limit(1).get();
      if (!snapByField.empty) {
        const docSnap = snapByField.docs[0];
        const data = docSnap.data() || {};
        if (!data.voided) items.push({ id: docSnap.id, ...data });
        return res.json({ items });
      }
      const snap = await db.collection("customers").doc(term).get();
      if (snap.exists) {
        const data = snap.data() || {};
        if (!data.voided) items.push({ id: snap.id, ...data });
        return res.json({ items });
      }
      const allSnap = await db.collection("customers").orderBy("fullName").get();
      const filtered = allSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((customer) => !customer.voided)
        .filter((customer) => {
          const customerDni = String(customer.dni || customer.id || "");
          return customerDni.startsWith(term);
        });
      return res.json({ items: filtered });
    }

    const allSnap = await db.collection("customers").orderBy("fullName").get();
    const query = term.toLowerCase();
    const items = allSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((customer) => !customer.voided)
      .filter((customer) => {
        const name = String(customer.fullName || customer.name || "").toLowerCase();
        const customerDni = String(customer.dni || customer.id || "");
        return name.includes(query) || customerDni.includes(query);
      });
    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ message: "Error al buscar clientes." });
  }
});

app.get("/customers/:id/debt", requireAuth, async (req, res) => {
  try {
    let customerId = String(req.params.id || "").trim();
    if (!customerId) return res.status(400).json({ message: "ID requerido." });

    let customerSnap = await db.collection("customers").doc(customerId).get();
    if (!customerSnap.exists) {
      const dni = normalizeDni(customerId);
      if (dni) {
        const byDniSnap = await db.collection("customers").where("dni", "==", dni).limit(1).get();
        if (!byDniSnap.empty) {
          customerSnap = byDniSnap.docs[0];
          customerId = customerSnap.id;
        }
      }
    }
    if (!customerSnap.exists) {
      return res.status(404).json({ message: "Cliente no encontrado." });
    }

    const [dniLoansSnap, idLoansSnap] = await Promise.all([
      db.collection("loans").where("customerDni", "==", customerId).get(),
      db.collection("loans").where("customerId", "==", customerId).get()
    ]);

    const loanMap = new Map();
    dniLoansSnap.docs.forEach((docSnap) => {
      loanMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
    });
    idLoansSnap.docs.forEach((docSnap) => {
      loanMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
    });

    const loans = Array.from(loanMap.values());
    let capitalPending = 0;
    let interestPending = 0;
    let activeLoans = 0;

    let americanOutstanding = 0;
    let americanInterestPaid = 0;
    let americanPrincipalPaid = 0;

    for (const loan of loans) {
      if (loan.voided) continue;
      const loanType = normalizeLoanType(loan.loanType);
      if (loanType === "americano") {
        const outstanding = getLoanOutstanding(loan);
        if (outstanding > 0) {
          activeLoans += 1;
        }
        capitalPending += outstanding;
        americanOutstanding += outstanding;

        const paymentsSnap = await db.collection("loans").doc(loan.id).collection("payments").get();
        paymentsSnap.docs.forEach((docSnap) => {
          const payment = docSnap.data() || {};
          americanInterestPaid += Number(payment.interestPaid || 0);
          americanPrincipalPaid += Number(payment.principalPaid || 0);
        });
        continue;
      }

      const breakdown = computeLoanPendingBreakdown(loan);
      if (!breakdown || breakdown.totalPending <= 0) continue;
      activeLoans += 1;
      capitalPending += breakdown.capitalPending;
      interestPending += breakdown.interestPending;
    }

    return res.json({
      customer: {
        id: customerSnap.id,
        name: customerSnap.data().fullName || customerSnap.data().name || "",
        dni: customerSnap.data().dni || customerSnap.id,
        phone: customerSnap.data().phone || ""
      },
      debt: {
        capitalPending,
        interestPending,
        totalPending: capitalPending + interestPending,
        american: {
          principalOutstanding: americanOutstanding,
          interestPaid: americanInterestPaid,
          principalPaid: americanPrincipalPaid
        }
      },
      loansCount: activeLoans
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "No se pudo calcular la deuda del cliente." });
  }
});

app.post("/customers", requireAuth, async (req, res) => {
  try {
    const dni = normalizeDni(req.body.dni);
    const fullName = String(req.body.fullName || req.body.name || "").trim();
    if (!dni || dni.length < 6 || dni.length > 12 || !fullName) {
      return res.status(400).json({ message: "DNI y nombre son obligatorios." });
    }

    const existingByField = await db.collection("customers").where("dni", "==", dni).limit(1).get();
    const legacySnap = await db.collection("customers").doc(dni).get();
    if (!existingByField.empty || legacySnap.exists) {
      return res.status(400).json({ code: "DNI_EXISTS", message: "Ese DNI ya esta registrado." });
    }

    const customerRef = db.collection("customers").doc();
    const payload = {
      dni,
      fullName,
      phone: normalizePhone(req.body.phone),
      address: String(req.body.address || "").trim(),
      notes: String(req.body.notes || "").trim(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await customerRef.set(payload);
    return res.status(201).json({ item: { id: customerRef.id, ...payload } });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudo guardar el cliente." });
  }
});

app.put("/customers/:id", requireAuth, async (req, res) => {
  try {
    const customerId = String(req.params.id || "").trim();
    if (!customerId) return res.status(400).json({ message: "ID requerido." });

    const name = String(req.body.name || req.body.fullName || "").trim();
    const dni = normalizeDni(req.body.dni);
    const phone = normalizePhone(req.body.phone);
    const address = String(req.body.address || "").trim();
    const notes = String(req.body.notes || "").trim();

    if (!name || name.length < 2 || !dni || dni.length < 6 || dni.length > 12) {
      return sendJsonError(res, 400, {
        code: "INVALID_INPUT",
        message: "Nombre o DNI inválido."
      });
    }

    const customerRef = db.collection("customers").doc(customerId);
    const snap = await customerRef.get();
    if (!snap.exists) {
      return sendJsonError(res, 404, { code: "NOT_FOUND", message: "Cliente no encontrado." });
    }

    const existingByField = await db.collection("customers").where("dni", "==", dni).limit(1).get();
    if (!existingByField.empty && existingByField.docs[0].id !== customerId) {
      return sendJsonError(res, 400, {
        code: "DNI_EXISTS",
        message: "Ese DNI ya est? registrado."
      });
    }
    const legacySnap = await db.collection("customers").doc(dni).get();
    if (legacySnap.exists && legacySnap.id !== customerId) {
      return sendJsonError(res, 400, {
        code: "DNI_EXISTS",
        message: "Ese DNI ya est? registrado."
      });
    }

    const updatePayload = {
      fullName: name,
      dni,
      phone,
      address,
      notes,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    Object.keys(updatePayload).forEach((key) => {
      if (updatePayload[key] === undefined) delete updatePayload[key];
    });
    await customerRef.set(updatePayload, { merge: true });
    const updated = await customerRef.get();
    return res.json({ ok: true, customer: { id: updated.id, ...updated.data() } });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudo actualizar el cliente." });
  }
});

app.delete("/customers/:id", requireAuth, async (req, res) => {
  try {
    const customerId = String(req.params.id || "").trim();
    if (!customerId) return res.status(400).json({ message: "ID requerido." });
    const customerRef = db.collection("customers").doc(customerId);
    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) {
      return res.status(404).json({ message: "Cliente no encontrado." });
    }
    const loansSnap = await db.collection("loans").where("customerId", "==", customerId).get();
    const hasActiveLoans = loansSnap.docs.some((docSnap) => {
      const loan = docSnap.data() || {};
      if (loan.voided) return false;
      const status = computeLoanStatus(loan, new Date());
      return status === "active" || status === "late" || status === "bad_debt";
    });
    if (hasActiveLoans) {
      return sendJsonError(res, 400, {
        code: "HAS_ACTIVE_LOANS",
        message: "El cliente tiene Préstamos activos."
      });
    }
    await customerRef.set(
      {
        voided: true,
        voidedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudo eliminar el cliente." });
  }
});

app.post("/customers/:id/void", requireAuth, async (req, res) => {
  try {
    const customerId = String(req.params.id || "").trim();
    const reason = String(req.body?.reason || "").trim();
    if (!customerId) return res.status(400).json({ message: "ID requerido." });
    const customerRef = db.collection("customers").doc(customerId);
    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) {
      return res.status(404).json({ message: "Cliente no encontrado." });
    }
    await customerRef.set(
      {
        voided: true,
        voidedAt: admin.firestore.FieldValue.serverTimestamp(),
        voidReason: reason || ""
      },
      { merge: true }
    );
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudo anular el cliente." });
  }
});

app.get("/loans", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const dni = String(req.query.dni || "").trim();
    const customerId = String(req.query.customerId || "").trim();
    const rawStatus = String(req.query.status || "").trim().toLowerCase();
    const { normalized: normalizedStatus } = getStatusFilterValues(rawStatus);

    const base = db.collection("loans");
    const now = new Date();
    const loansMap = new Map();

    const pushSnap = (snap) => {
      if (!snap || snap.empty) return;
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        if (data.voided) return;
        const loanType = normalizeLoanType(data.loanType);
        const outstanding = getLoanOutstanding(data);
        const computedStatus = computeLoanStatus(data, now);
        if (normalizedStatus && computedStatus !== normalizedStatus) return;
        loansMap.set(docSnap.id, {
          id: docSnap.id,
          ...data,
          totalDue: Number(data.totalDue || 0),
          principal: Number(data.principal || 0),
          balance: loanType === "americano" ? outstanding : Number(data.balance || 0),
          principalOutstanding: loanType === "americano" ? outstanding : Number(data.principalOutstanding || 0),
          paidTotal: Number(data.paidTotal || 0),
          loanType,
          status: computedStatus
        });
      });
    };

    if (customerId) {
      const queryByCustomerId = base.where("customerId", "==", customerId);
      const snapCustomerId = await queryByCustomerId.get();
      pushSnap(snapCustomerId);
      return res.json({ items: Array.from(loansMap.values()) });
    }

    if (!dni) {
      const snapAll = await base.get();
      pushSnap(snapAll);
      return res.json({ items: Array.from(loansMap.values()) });
    }

    const queryByCustomerDni = base.where("customerDni", "==", dni);
    const snapCustomerDni = await queryByCustomerDni.get();
    pushSnap(snapCustomerDni);

    if (loansMap.size === 0) {
      const queryByDniField = base.where("dni", "==", dni);
      const snapDniField = await queryByDniField.get();
      pushSnap(snapDniField);
    }

    if (loansMap.size === 0) {
      const queryByDniCliente = base.where("dniCliente", "==", dni);
      const snapDniCliente = await queryByDniCliente.get();
      pushSnap(snapDniCliente);
    }

    return res.json({ items: Array.from(loansMap.values()) });
  } catch (err) {
    console.error("[LOANS_GET_FAILED]", err);
    console.error("query:", req.query);
    return res.status(500).json({
      message: "Error al obtener Préstamos",
      code: "LOANS_GET_FAILED"
    });
  }
});

app.get("/loans/by-status", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const snap = await db.collection("loans").get();
    const now = new Date();
    const result = {
      active: [],
      late: [],
      bad_debt: [],
      finished: [],
      pending: []
    };

    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (data.voided) return;
      const loanType = normalizeLoanType(data.loanType);
      const outstanding = getLoanOutstanding(data);
      const status = computeLoanStatus(data, now);
      const capitalPending =
        loanType === "americano" ? outstanding : roundMoney(Math.max(Number(data.balance || 0), 0));
      const item = {
        id: docSnap.id,
        ...data,
        loanType,
        status,
        balance: loanType === "americano" ? outstanding : Number(data.balance || 0),
        principalOutstanding: loanType === "americano" ? outstanding : Number(data.principalOutstanding || 0),
        capitalPending
      };
      if (status === "active") result.active.push(item);
      else if (status === "late") result.late.push(item);
      else if (status === "bad_debt") result.bad_debt.push(item);
      else if (status === "finished") result.finished.push(item);
      else if (status === "pending") result.pending.push(item);
    });

    return res.json(result);
  } catch (error) {
    console.error("[LOANS_BY_STATUS_FAILED]", error);
    return res.status(500).json({ message: "No se pudieron cargar los Préstamos." });
  }
});

app.post("/loans/:id/mark-bad-debt", requireAuth, async (req, res) => {
  try {
    const loanId = String(req.params.id || "").trim();
    const reason = String(req.body?.reason || "").trim();
    if (!loanId) return res.status(400).json({ message: "ID requerido." });

    const loanRef = db.collection("loans").doc(loanId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(loanRef);
      if (!snap.exists) {
        const error = new Error("Préstamo no encontrado.");
        error.status = 404;
        throw error;
      }
      const loan = snap.data() || {};
      if (loan.voided) {
        const error = new Error("El Préstamo ya está anulado.");
        error.status = 400;
        throw error;
      }
      const computedStatus = computeLoanStatus(loan, new Date());
      if (computedStatus !== "late") {
        const error = new Error("Solo se puede marcar incobrable desde morosos.");
        error.status = 400;
        throw error;
      }
      tx.update(loanRef, {
        status: "bad_debt",
        badDebtReason: reason || "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return res.json({ ok: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || "No se pudo marcar incobrable." });
  }
});

app.post("/loans/migrate-status", requireAuth, async (req, res) => {
  try {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;

    const snap = await db.collection("loans").get();
    const now = new Date();
    let updatedCount = 0;
    let batch = db.batch();
    let batchSize = 0;

    const flushBatch = async () => {
      if (batchSize === 0) return;
      await batch.commit();
      batch = db.batch();
      batchSize = 0;
    };

    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      const currentStatus = data.status;
      let nextStatus = "";
      if (data.voided) {
        nextStatus = "void";
      } else {
        const normalized = normalizeLoanStatus(currentStatus);
        nextStatus = normalized || computeLoanStatus(data, now) || "active";
      }
      if (!nextStatus || nextStatus === currentStatus) continue;
      batch.update(docSnap.ref, {
        status: nextStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      updatedCount += 1;
      batchSize += 1;
      if (batchSize >= 400) {
        await flushBatch();
      }
    }

    await flushBatch();

    return res.json({ ok: true, updated: updatedCount });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudo migrar el estado." });
  }
});

app.post("/loans", requireAuth, async (req, res) => {
  try {
    const loanType = normalizeLoanType(req.body.loanType);
    const principal = toNumber(req.body.principal);
    const rateValue = toNumber(req.body.rateValue ?? req.body.interestRate);
    const termCount = toNumber(req.body.termCount);
    const customerDni = String(req.body.customerDni || req.body.dniCliente || "").trim();
    if (!customerDni || principal <= 0 || rateValue < 0 || (loanType === "simple" && termCount <= 0)) {
      return res.status(400).json({ message: "Datos del prestamo invalidos." });
    }

    const rawStartDate = String(req.body.startDate || "").trim();
    const startDateString = rawStartDate || new Date().toISOString().slice(0, 10);
    const startDateValue = parseISODateUTC(startDateString);
    if (!startDateValue) {
      return res.status(400).json({ message: "Fecha de inicio invalida." });
    }

    const ratePeriod = req.body.ratePeriod || "monthly";
    const termPeriod = req.body.termPeriod || "monthly";
    const frequency = req.body.frequency || termPeriod || ratePeriod || "monthly";
    const ratePeriodConfig = PERIODS[ratePeriod] || PERIODS.monthly;
    const termPeriodConfig = PERIODS[termPeriod] || PERIODS.monthly;
    const monthlyRate = (rateValue / 100) * ratePeriodConfig.toMonthly;
    const monthsEquivalent = termCount * termPeriodConfig.monthsFactor;
    const computedTotal =
      principal > 0 && termCount > 0 ? principal * (1 + monthlyRate * monthsEquivalent) : 0;
    const totalDue = toNumber(req.body.totalDue || computedTotal);
    const fundingMode = "SELF";
    const fundingSourceUid = req.user?.uid || null;
    const fundingSourceEmail = req.user?.email || null;
    if (!fundingSourceUid) {
      return res.status(401).json({ message: "Usuario no autenticado." });
    }

    let resolvedCustomerId = String(req.body.customerId || "").trim() || null;
    if (!resolvedCustomerId && customerDni) {
      const dniNormalized = normalizeDni(customerDni);
      if (dniNormalized) {
        const byDniSnap = await db.collection("customers").where("dni", "==", dniNormalized).limit(1).get();
        if (!byDniSnap.empty) {
          resolvedCustomerId = byDniSnap.docs[0].id;
        } else {
          const legacySnap = await db.collection("customers").doc(dniNormalized).get();
          if (legacySnap.exists) {
            resolvedCustomerId = legacySnap.id;
          }
        }
      }
    }

    const hasIntermediary = !!req.body.hasIntermediary;
    const intermediaryName = String(req.body.intermediaryName || "").trim();
    const splitInput = req.body.interestSplit || {};
    const totalPct = toNumberSafe(splitInput.totalPct ?? req.body.totalPct);
    const intermediaryPct = toNumberSafe(splitInput.intermediaryPct ?? req.body.intermediaryPct);
    const myPct = toNumberSafe(splitInput.myPct ?? req.body.myPct);
    let interestSplit = null;
    if (hasIntermediary) {
      const computedTotal = totalPct > 0 ? totalPct : intermediaryPct + myPct;
      if (
        computedTotal <= 0 ||
        intermediaryPct < 0 ||
        myPct < 0 ||
        Math.abs(intermediaryPct + myPct - computedTotal) > 0.01
      ) {
        return res.status(400).json({ message: "El split de Interés es inválido." });
      }
      interestSplit = {
        totalPct: computedTotal,
        intermediaryPct,
        myPct
      };
    } else {
      interestSplit = { totalPct: 100, intermediaryPct: 0, myPct: 100 };
    }

    const fundingStatus = "APPROVED";
    const funding = {
      sourceUid: fundingSourceUid,
      sourceEmail: normalizeEmailValue(fundingSourceEmail || "Sin asignar"),
      mode: fundingMode,
      status: fundingStatus,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      decidedByUid: req.user?.uid || null
    };

    let payload = null;

    if (loanType === "americano") {
      const principalOriginal = toNumber(req.body.principalOriginal || principal);
      const principalOutstanding = toNumber(req.body.principalOutstanding || principalOriginal);
      if (principalOriginal <= 0) {
        return res.status(400).json({ message: "Principal invalido." });
      }
      const nextDueDateValue = addPeriod(startDateValue, frequency);
      payload = {
        customerId: resolvedCustomerId,
        customerDni: String(customerDni),
        customerName: String(req.body.customerName || "").trim(),
        principal: principalOriginal,
        principalOriginal,
        principalOutstanding,
        interestRate: rateValue,
        frequency,
        rateValue,
        ratePeriod: frequency,
        termCount: termCount > 0 ? termCount : null,
        termPeriod: frequency,
        startDate: startDateString,
        totalDue: principalOriginal,
        totalCapital: principalOriginal,
        totalInterest: 0,
        paidCapital: 0,
        paidInterest: 0,
        balance: principalOutstanding,
        paidTotal: 0,
        installments: [],
        loanType: "americano",
        hasIntermediary,
        intermediaryName: hasIntermediary ? intermediaryName : "",
        interestSplit,
        status: "active",
        endDate: null,
        nextDueDate: formatDateOnly(nextDueDateValue),
        nextDueAt: nextDueDateValue ? admin.firestore.Timestamp.fromDate(nextDueDateValue) : null,
        capitalPending: principalOutstanding,
        interestEarnedMineTotal: 0,
        interestEarnedIntermediaryTotal: 0,
        funding,
        createdByUid: req.user?.uid || null,
        createdByEmail: req.user?.email || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
    } else {
      const installments = buildInstallmentsForLoan({
        termCount,
        totalDue,
        termPeriod,
        frequency: termPeriod,
        startDate: startDateValue,
        createdAt: startDateValue
      });

      const nextDueDateValue = installments?.length
        ? toDateValue(installments[0]?.dueDate)
        : addPeriod(startDateValue, termPeriod);
      payload = {
        customerId: resolvedCustomerId,
        customerDni: String(customerDni),
        customerName: String(req.body.customerName || "").trim(),
        principal,
        principalOriginal: principal,
        principalOutstanding: principal,
        interestRate: rateValue,
        frequency: termPeriod,
        rateValue,
        ratePeriod,
        termCount,
        termPeriod,
        startDate: startDateString,
        totalDue,
        totalCapital: principal,
        totalInterest: Math.max(totalDue - principal, 0),
        paidCapital: 0,
        paidInterest: 0,
        balance: totalDue,
        paidTotal: 0,
        installments: installments || [],
        loanType: "simple",
        hasIntermediary,
        intermediaryName: hasIntermediary ? intermediaryName : "",
        interestSplit,
        status: "active",
        endDate: null,
        nextDueDate: nextDueDateValue ? formatDateOnly(nextDueDateValue) : null,
        nextDueAt: nextDueDateValue ? admin.firestore.Timestamp.fromDate(nextDueDateValue) : null,
        capitalPending: totalDue,
        interestEarnedMineTotal: 0,
        interestEarnedIntermediaryTotal: 0,
        funding,
        createdByUid: req.user?.uid || null,
        createdByEmail: req.user?.email || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
    }

    const loanRef = db.collection("loans").doc();
    const treasurySummaryRef = db.collection("treasurySummary").doc("primary");
    const walletLedgerRef = db.collection("ledger").doc();
    const walletMovementRef = db.collection("wallet_movements").doc();
    const disbursedAmount = roundMoney(toNumber(payload.principalOriginal || payload.principal || 0));
    const outstandingAmount = roundMoney(toNumber(payload.capitalPending || payload.balance || 0));

    await db.runTransaction(async (tx) => {
      const fundingWallet = await getWalletData(tx, funding.sourceUid, funding.sourceEmail);

      tx.set(loanRef, payload);

      tx.set(
        fundingWallet.walletRef,
        {
          uid: fundingWallet.walletUid,
          email: fundingWallet.email,
          balance: roundMoney(fundingWallet.balance - disbursedAmount),
          balanceArs: roundMoney(fundingWallet.balance - disbursedAmount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      tx.set(walletLedgerRef, {
        type: "LOAN_DISBURSE",
        amountARS: disbursedAmount,
        fromUid: fundingWallet.walletUid,
        loanId: loanRef.id,
        createdByUid: req.user?.uid || null,
        createdByEmail: normalizeEmailValue(req.user?.email || "Sin asignar"),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        meta: {
          fromEmail: fundingWallet.email
        }
      });
      tx.set(walletMovementRef, {
        type: "LOAN_DISBURSE",
        amount: disbursedAmount,
        fromUid: fundingWallet.walletUid,
        createdByUid: req.user?.uid || null,
        createdByEmail: normalizeEmailValue(req.user?.email || "Sin asignar"),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        meta: {
          loanId: loanRef.id
        }
      });
      tx.set(
        treasurySummaryRef,
        {
          totalDisbursedArs: admin.firestore.FieldValue.increment(disbursedAmount),
          totalLoanOutstandingArs: admin.firestore.FieldValue.increment(outstandingAmount),
          liquidArs: admin.firestore.FieldValue.increment(-disbursedAmount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    await db.collection("movements").add(
      buildMovementPayload({
        type: "loan_create",
        customer: {
          id: payload.customerId || null,
          dni: payload.customerDni || null,
          name: payload.customerName || null
        },
        loan: {
          id: loanRef.id,
          loanType: payload.loanType,
          status: payload.status,
          principal: payload.principal || payload.principalOriginal || 0,
          interestRate: payload.interestRate || payload.rateValue || 0,
          frequency: payload.frequency || payload.termPeriod || null
        },
        note: payload.intermediaryName ? `Intermediario: ${payload.intermediaryName}` : "",
        occurredAt: payload.startDate
          ? toDateValue(payload.startDate)?.toISOString().slice(0, 10)
          : null,
        createdBy: req.user?.uid || null,
        relatedId: loanRef.id
      })
    );

    return res.status(201).json({ item: { id: loanRef.id, ...payload } });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || "No se pudo crear el prestamo." });
  }
});

app.get("/loans/pending-approvals", requireAuth, async (req, res) => {
  return res.status(410).json({
    items: [],
    message: "Aprobaciones de préstamos desactivadas."
  });
});

app.post("/loans/:id/approveFunding", requireAuth, async (req, res) => {
  return res.status(410).json({
    ok: false,
    message: "Aprobaciones de préstamos desactivadas."
  });
});

app.post("/loans/:id/rejectFunding", requireAuth, async (req, res) => {
  return res.status(410).json({
    ok: false,
    message: "Aprobaciones de préstamos desactivadas."
  });
});

app.post("/loans/pending-approvals/migrate", requireAuth, async (req, res) => {
  try {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;

    const mode = String(req.body?.mode || "reject").trim().toLowerCase();
    if (mode !== "reject") {
      return res.status(400).json({ message: "Modo inválido. Usá mode=reject." });
    }

    const snap = await db.collection("pendingApprovals").where("status", "==", "PENDING").get();
    if (snap.empty) {
      return res.json({ ok: true, updatedPending: 0, updatedLoans: 0, skippedLoans: 0 });
    }

    let updatedPending = 0;
    let updatedLoans = 0;
    let skippedLoans = 0;
    let batch = db.batch();
    let batchOps = 0;

    for (const docSnap of snap.docs) {
      const pendingRef = docSnap.ref;
      const loanRef = db.collection("loans").doc(docSnap.id);
      const loanSnap = await loanRef.get();
      if (loanSnap.exists) {
        batch.update(loanRef, {
          funding: {
            ...(loanSnap.data()?.funding || {}),
            status: "REJECTED",
            decidedAt: admin.firestore.FieldValue.serverTimestamp(),
            decidedByUid: req.user?.uid || null
          },
          status: "rejected",
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        updatedLoans += 1;
        batchOps += 1;
      } else {
        skippedLoans += 1;
      }

      batch.set(
        pendingRef,
        {
          status: "REJECTED",
          decidedAt: admin.firestore.FieldValue.serverTimestamp(),
          decidedByUid: req.user?.uid || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      updatedPending += 1;
      batchOps += 1;

      if (batchOps >= 450) {
        await batch.commit();
        batch = db.batch();
        batchOps = 0;
      }
    }

    if (batchOps > 0) {
      await batch.commit();
    }

    return res.json({ ok: true, updatedPending, updatedLoans, skippedLoans });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudo migrar pendientes." });
  }
});

app.delete("/loans/:id", requireAuth, async (req, res) => {
  try {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;

    const loanId = String(req.params.id || "").trim();
    if (!loanId) return res.status(400).json({ message: "ID requerido." });
    const reason = String(req.body?.reason || "").trim();

    const loanRef = db.collection("loans").doc(loanId);
    await db.runTransaction(async (tx) => {
      const loanSnap = await tx.get(loanRef);
      if (!loanSnap.exists) {
        const err = new Error("Préstamo no encontrado.");
        err.status = 404;
        err.code = "NOT_FOUND";
        throw err;
      }
      const loan = loanSnap.data() || {};
      if (loan.voided) {
        const err = new Error("El Préstamo ya estaba anulado.");
        err.status = 400;
        err.code = "ALREADY_VOIDED";
        throw err;
      }

      const paymentsSnap = await tx.get(db.collection("payments").where("loanId", "==", loanId));
      const hasPayments = paymentsSnap.docs.some((docSnap) => {
        const data = docSnap.data() || {};
        return !data.voided;
      });
      if (hasPayments) {
        const err = new Error("No se puede anular: el Préstamo ya tiene pagos.");
        err.status = 400;
        err.code = "HAS_PAYMENTS";
        throw err;
      }

      const loanPaymentsSnap = await tx.get(loanRef.collection("payments"));
      const hasSubPayments = loanPaymentsSnap.docs.some((docSnap) => {
        const data = docSnap.data() || {};
        return !data.voided;
      });
      if (hasSubPayments) {
        const err = new Error("No se puede anular: el Préstamo ya tiene pagos.");
        err.status = 400;
        err.code = "HAS_PAYMENTS";
        throw err;
      }

      tx.update(loanRef, {
        voided: true,
        voidedAt: admin.firestore.FieldValue.serverTimestamp(),
        voidReason: reason || "",
        status: "void",
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const movementRef = db.collection("movements").doc();
      tx.set(
        movementRef,
        buildMovementPayload({
          type: "loan_void",
          customer: {
            id: loan.customerId || null,
            dni: loan.customerDni || loan.dni || loan.dniCliente || null,
            name: loan.customerName || null
          },
          loan: {
            id: loanRef.id,
            loanType: normalizeLoanType(loan.loanType),
            status: "void"
          },
          note: reason || "",
          relatedId: loanRef.id,
          createdBy: adminUser.uid
        })
      );
    });

    return res.json({ ok: true });
  } catch (error) {
    const status = error.status || 500;
    if (status !== 500) {
      return sendJsonError(res, status, {
        code: error.code || "LOAN_DELETE_FAILED",
        message: error.message || "No se pudo anular el Préstamo."
      });
    }
    return res.status(500).json({ message: error.message || "No se pudo anular el Préstamo." });
  }
});

app.post("/loans/:id/void", requireAuth, async (req, res) => {
  try {
    const loanId = String(req.params.id || "").trim();
    if (!loanId) return res.status(400).json({ message: "ID requerido." });
    const reason = String(req.body?.reason || "").trim();

    const loanRef = db.collection("loans").doc(loanId);
    const treasurySummaryRef = db.collection("treasurySummary").doc("primary");
    await db.runTransaction(async (tx) => {
      const loanSnap = await tx.get(loanRef);
      if (!loanSnap.exists) {
        const err = new Error("Préstamo no encontrado.");
        err.status = 404;
        err.code = "NOT_FOUND";
        throw err;
      }
      const loan = loanSnap.data() || {};
      if (loan.voided) {
        const err = new Error("El Préstamo ya estaba anulado.");
        err.status = 400;
        err.code = "ALREADY_VOIDED";
        throw err;
      }

      const paymentsSnap = await tx.get(db.collection("payments").where("loanId", "==", loanId));
      const hasPayments = paymentsSnap.docs.some((docSnap) => {
        const data = docSnap.data() || {};
        return !data.voided;
      });
      if (hasPayments) {
        const err = new Error("No se puede anular: el Préstamo ya tiene pagos.");
        err.status = 400;
        err.code = "HAS_PAYMENTS";
        throw err;
      }

      const loanPaymentsSnap = await tx.get(loanRef.collection("payments"));
      const hasSubPayments = loanPaymentsSnap.docs.some((docSnap) => {
        const data = docSnap.data() || {};
        return !data.voided;
      });
      if (hasSubPayments) {
        const err = new Error("No se puede anular: el Préstamo ya tiene pagos.");
        err.status = 400;
        err.code = "HAS_PAYMENTS";
        throw err;
      }

      tx.update(loanRef, {
        voided: true,
        voidedAt: admin.firestore.FieldValue.serverTimestamp(),
        voidReason: reason || "",
        status: "void",
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      const disbursed = roundMoney(toNumber(loan.principalOriginal || loan.principal || 0));
      const outstanding = roundMoney(toNumber(loan.capitalPending || loan.balance || 0));
      tx.set(
        treasurySummaryRef,
        {
          totalDisbursedArs: admin.firestore.FieldValue.increment(-disbursed),
          totalLoanOutstandingArs: admin.firestore.FieldValue.increment(-outstanding),
          liquidArs: admin.firestore.FieldValue.increment(disbursed),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      const movementRef = db.collection("movements").doc();
      tx.set(
        movementRef,
        buildMovementPayload({
          type: "loan_void",
          customer: {
            id: loan.customerId || null,
            dni: loan.customerDni || loan.dni || loan.dniCliente || null,
            name: loan.customerName || null
          },
          loan: {
            id: loanRef.id,
            loanType: normalizeLoanType(loan.loanType),
            status: "void"
          },
          note: reason || "",
          relatedId: loanRef.id,
          createdBy: req.user?.uid || null
        })
      );
    });

    return res.json({ ok: true });
  } catch (error) {
    const status = error.status || 500;
    if (status !== 500) {
      return sendJsonError(res, status, {
        code: error.code || "LOAN_VOID_FAILED",
        message: error.message || "No se pudo anular el Préstamo."
      });
    }
    return res.status(500).json({ message: error.message || "No se pudo anular el Préstamo." });
  }
});

app.post("/loans/:id/void-with-payments", requireAuth, async (req, res) => {
  try {
    const loanId = String(req.params.id || "").trim();
    if (!loanId) return res.status(400).json({ message: "ID requerido." });
    const reason = String(req.body?.reason || "").trim();

    const loanRef = db.collection("loans").doc(loanId);
    const loanSnap = await loanRef.get();
    if (!loanSnap.exists) {
      return sendJsonError(res, 404, { code: "NOT_FOUND", message: "Préstamo no encontrado." });
    }
    const loan = loanSnap.data() || {};
    if (loan.voided) {
      return sendJsonError(res, 400, { code: "ALREADY_VOIDED", message: "El Préstamo ya estaba anulado." });
    }

    const paymentsSnap = await db.collection("payments").where("loanId", "==", loanId).get();
    const payments = paymentsSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((payment) => !payment.voided);

    const totalCollected = payments.reduce((sum, payment) => {
      const interestTotal = Number((payment.interestTotal ?? payment.interestPaid) || 0);
      const amountPaid = Number(
        payment.amountPaid != null
          ? payment.amountPaid
          : roundMoney(Number(payment.principalPaid || 0) + interestTotal)
      );
      return sum + amountPaid;
    }, 0);

    const paymentsByMonth = new Map();
    payments.forEach((payment) => {
      const paidAtDate = toDateValue(payment.paidAt) || toDateValue(payment.createdAt);
      const paidMonth = payment.paidMonth || formatMonthKey(paidAtDate);
      if (!paidMonth) return;
      const interestTotal = Number((payment.interestTotal ?? payment.interestPaid) || 0);
      const interestMine = Number((payment.interestMine ?? payment.interestPaid) || 0);
      const interestIntermediary = Number(payment.interestIntermediary || 0);
      const current = paymentsByMonth.get(paidMonth) || {
        interestTotal: 0,
        interestMine: 0,
        interestIntermediary: 0
      };
      paymentsByMonth.set(paidMonth, {
        interestTotal: current.interestTotal + interestTotal,
        interestMine: current.interestMine + interestMine,
        interestIntermediary: current.interestIntermediary + interestIntermediary
      });
    });

    // Update loan + payments in batches (avoid 500 limit)
    const voidedAt = admin.firestore.FieldValue.serverTimestamp();
    const loanUpdate = {
      voided: true,
      voidedAt,
      voidReason: reason || "",
      status: "void",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const batches = [];
    let batch = db.batch();
    let opCount = 0;

    batch.update(loanRef, loanUpdate);
    opCount += 1;
    const treasurySummaryRef = db.collection("treasurySummary").doc("primary");
    const disbursed = roundMoney(toNumber(loan.principalOriginal || loan.principal || 0));
    const outstanding = roundMoney(toNumber(loan.capitalPending || loan.balance || 0));
    const liquidDelta = disbursed - totalCollected;
    batch.set(
      treasurySummaryRef,
      {
        totalCollectedArs: admin.firestore.FieldValue.increment(-totalCollected),
        totalDisbursedArs: admin.firestore.FieldValue.increment(-disbursed),
        totalLoanOutstandingArs: admin.firestore.FieldValue.increment(-outstanding),
        liquidArs: admin.firestore.FieldValue.increment(liquidDelta),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    opCount += 1;

    payments.forEach((payment) => {
      if (opCount >= 400) {
        batches.push(batch);
        batch = db.batch();
        opCount = 0;
      }
      const paymentRef = db.collection("payments").doc(payment.id);
      const loanPaymentRef = loanRef.collection("payments").doc(payment.id);
      const voidPayload = {
        voided: true,
        voidedAt,
        voidReason: `Loan void: ${reason || ""}`.trim(),
        voidedBy: req.user?.uid || null
      };
      batch.set(paymentRef, voidPayload, { merge: true });
      batch.set(loanPaymentRef, voidPayload, { merge: true });
      opCount += 2;
      const paymentInterestTotal = Number((payment.interestTotal ?? payment.interestPaid) || 0);
      const paymentAmountPaid = Number(
        payment.amountPaid != null
          ? payment.amountPaid
          : roundMoney(Number(payment.principalPaid || 0) + paymentInterestTotal)
      );
      const treasuryUserRef = db
        .collection("treasuryUsers")
        .doc(payment.createdByUid || payment.createdBy || "unknown");
      batch.set(
        treasuryUserRef,
        {
          email: payment.createdByEmail || "Sin asignar",
          paymentsCount: admin.firestore.FieldValue.increment(-1),
          collectedArs: admin.firestore.FieldValue.increment(-paymentAmountPaid),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      opCount += 1;

      const movementRef = db.collection("movements").doc();
      const paidAtDate = toDateValue(payment.paidAt) || toDateValue(payment.createdAt);
      const paidAtValue = paidAtDate ? paidAtDate.toISOString().slice(0, 10) : null;
      const interestTotal = Number((payment.interestTotal ?? payment.interestPaid) || 0);
      const interestMine = Number((payment.interestMine ?? payment.interestPaid) || 0);
      const interestIntermediary = Number(payment.interestIntermediary || 0);
      batch.set(
        movementRef,
        buildMovementPayload({
          type: "payment_void",
          customer: {
            id: loan.customerId || null,
            dni: loan.customerDni || loan.dni || loan.dniCliente || null,
            name: loan.customerName || null
          },
          loan: {
            id: loanRef.id,
            loanType: normalizeLoanType(loan.loanType),
            status: "void"
          },
          payment: {
            id: payment.id,
            amount: Number(payment.amount || 0),
            interestTotal,
            interestMine,
            interestIntermediary,
            principalPaid: Number(payment.principalPaid || 0),
            paidAt: paidAtValue,
            method: payment.method || null,
            note: payment.note || null
          },
          note: reason || "",
          relatedId: payment.id,
          createdBy: req.user?.uid || null
        })
      );
      opCount += 1;
      const amountPaid = Number(
        payment.amountPaid != null
          ? payment.amountPaid
          : roundMoney(Number(payment.principalPaid || 0) + interestTotal)
      );
      const ledgerRef = db.collection("ledger").doc();
      batch.set(
        ledgerRef,
        buildLedgerPayload({
          type: "adjustment",
          amountARS: -amountPaid,
          interestARS: -interestTotal,
          principalARS: -Number(payment.principalPaid || 0),
          interestMineARS: -interestMine,
          interestIntermediaryARS: -interestIntermediary,
          date: paidAtDate,
          createdByUid: payment.createdByUid || payment.createdBy || null,
          createdByEmail: payment.createdByEmail || null,
          loanId: loanRef.id,
          customerDni: loan.customerDni || loan.dni || loan.dniCliente || null,
          note: `Anulación pago ${payment.id}`,
          source: "void"
        })
      );
      opCount += 1;
    });

    if (opCount > 0) {
      batches.push(batch);
    }
    for (const b of batches) {
      await b.commit();
    }

    // Adjust profitMonthly (clamp to 0)
    for (const [month, totals] of paymentsByMonth.entries()) {
      await db.runTransaction(async (tx) => {
        const ref = db.collection("profitMonthly").doc(month);
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() || {} : {};
        const nextMine = Math.max(Number(data.mineArs || 0) - totals.interestMine, 0);
        const nextIntermediary = Math.max(
          Number(data.intermediaryArs || 0) - totals.interestIntermediary,
          0
        );
        const nextTotal = Math.max(Number(data.interestTotalArs || 0) - totals.interestTotal, 0);
        tx.set(
          ref,
          {
            month,
            mineArs: nextMine,
            intermediaryArs: nextIntermediary,
            interestTotalArs: nextTotal,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      });
    }

    const loanMovementRef = db.collection("movements").doc();
    await loanMovementRef.set(
      buildMovementPayload({
        type: "loan_void",
        customer: {
          id: loan.customerId || null,
          dni: loan.customerDni || loan.dni || loan.dniCliente || null,
          name: loan.customerName || null
        },
        loan: {
          id: loanRef.id,
          loanType: normalizeLoanType(loan.loanType),
          status: "void"
        },
        note: reason || "",
        relatedId: loanRef.id,
        createdBy: req.user?.uid || null
      })
    );

    return res.json({ ok: true, voidedLoanId: loanId, voidedPaymentsCount: payments.length });
  } catch (error) {
    const status = error.status || 500;
    if (status !== 500) {
      return sendJsonError(res, status, {
        code: error.code || "LOAN_VOID_WITH_PAYMENTS_FAILED",
        message: error.message || "No se pudo anular el Préstamo."
      });
    }
    return res.status(500).json({ message: error.message || "No se pudo anular el Préstamo." });
  }
});

app.get("/loans/:id/installments", requireAuth, async (req, res) => {
  try {
    const loanId = String(req.params.id || "").trim();
    if (!loanId) return res.status(400).json({ message: "ID requerido." });

    const loanRef = db.collection("loans").doc(loanId);
    const loanSnap = await loanRef.get();
    if (!loanSnap.exists) {
      return res.status(404).json({ message: "Préstamo no encontrado." });
    }

    const loan = loanSnap.data() || {};
    if (normalizeLoanType(loan.loanType) === "americano") {
      return res.status(400).json({ message: "El Préstamo no tiene plan de cuotas." });
    }
    const { installments, needsUpdate, error } = ensureLoanInstallments(loan);
    if (!installments) {
      return res.status(400).json({ message: error || "Plan de cuotas no disponible." });
    }

    if (needsUpdate) {
      await loanRef.update({
        installments,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    const items = installments.map((item) => {
      const dueDateValue = toDateValue(item.dueDate);
      const dueDate = dueDateValue ? dueDateValue.toISOString().slice(0, 10) : null;
      const amount = roundMoney(toNumber(item.amount));
      const paidTotal = roundMoney(toNumber(item.paidTotal));
      const pendingAmount = roundMoney(Math.max(amount - paidTotal, 0));
      return {
        number: toNumber(item.number),
        dueDate,
        amount,
        paidTotal,
        pendingAmount
      };
    });

    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudieron cargar las cuotas." });
  }
});

app.post("/payments", requireAuth, async (req, res) => {
  try {
    const loanId = String(req.body.loanId || "").trim();
    const paidAtRaw = String(req.body.paidAt || "").trim();
    const paidAt = parsePaidAtInput(paidAtRaw);

    if (!loanId) {
      return res.status(400).json({ message: "loanId es requerido." });
    }
    if (!paidAtRaw) {
      return res.status(400).json({ message: "paidAt es requerido (YYYY-MM-DD)." });
    }
    if (!paidAt) {
      return res.status(400).json({ message: "Fecha de pago inv?lida." });
    }

    const loanSnap = await db.collection("loans").doc(loanId).get();
    if (!loanSnap.exists) {
      return res.status(404).json({ message: "Préstamo no encontrado." });
    }
    const loan = loanSnap.data() || {};
    const loanType = normalizeLoanType(loan.loanType);

    if (loanType === "americano") {
      let interestPaid = roundMoney(toNumber(req.body.interestPaid));
      let principalPaid = roundMoney(toNumber(req.body.principalPaid));
      let totalPaid = roundMoney(interestPaid + principalPaid);
      const fallbackAmount = roundMoney(toNumber(req.body.amount));
      if (totalPaid <= 0 && fallbackAmount > 0) {
        interestPaid = fallbackAmount;
        principalPaid = 0;
        totalPaid = fallbackAmount;
      }
      if (interestPaid < 0 || principalPaid < 0 || totalPaid <= 0) {
        return res.status(400).json({
          message: "Monto inválido. Debe informar Interés, capital o ambos."
        });
      }

      const result = await registerAmericanPayment({
        loanId,
        paymentId: req.body.paymentId,
        interestPaid,
        principalPaid,
        paidAt,
        method: req.body.method,
        note: req.body.note,
        createdBy: req.user?.uid || null,
        createdByUid: req.user?.uid || null,
        createdByEmail: req.user?.email || null
      });

      return res.status(201).json({
        message: "Pago registrado.",
        paymentId: result.paymentId,
        loanStatus: result.loanStatus,
        principalOutstanding: result.principalOutstanding
      });
    }

    let amount = roundMoney(toNumber(req.body.amount));
    const installmentNumber = toNumber(req.body.installmentNumber);
    if (amount <= 0) {
      const fallbackInterest = roundMoney(toNumber(req.body.interestPaid));
      const fallbackPrincipal = roundMoney(toNumber(req.body.principalPaid));
      amount = roundMoney(fallbackInterest + fallbackPrincipal);
    }
    if (amount <= 0) {
      return res.status(400).json({ message: "Monto inválido." });
    }
    if (!installmentNumber || installmentNumber <= 0) {
      return res.status(400).json({ message: "Cuota inv?lida." });
    }

    const result = await registerInstallmentPayment({
      loanId,
      paymentId: req.body.paymentId,
      installmentNumber,
      amount,
      paidAt,
      method: req.body.method,
      note: req.body.note,
      createdBy: req.user?.uid || null,
      createdByUid: req.user?.uid || null,
      createdByEmail: req.user?.email || null
    });

    return res.status(201).json({
      message: "Pago registrado.",
      paymentId: result.paymentId,
      installmentUpdated: result.installmentUpdated,
      loanStatus: result.loanStatus
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || "No se pudo registrar el pago." });
  }
});

app.post("/loans/:id/payments", requireAuth, async (req, res) => {
  try {
    const loanId = String(req.params.id || "").trim();
    if (!loanId) {
      return res.status(400).json({ message: "loanId es requerido." });
    }

    const paidAtRaw = String(req.body.paidAt || "").trim();
    const paidAt = parsePaidAtInput(paidAtRaw);
    if (!paidAtRaw) {
      return res.status(400).json({ message: "paidAt es requerido (YYYY-MM-DD)." });
    }
    if (!paidAt) {
      return res.status(400).json({ message: "Fecha de pago invalida." });
    }

    const loanSnap = await db.collection("loans").doc(loanId).get();
    if (!loanSnap.exists) {
      return res.status(404).json({ message: "Préstamo no encontrado." });
    }
    const loan = loanSnap.data() || {};
    const loanType = normalizeLoanType(loan.loanType);

    if (loanType === "americano") {
      let interestPaid = roundMoney(toNumber(req.body.interestPaid));
      let principalPaid = roundMoney(toNumber(req.body.principalPaid));
      let totalPaid = roundMoney(interestPaid + principalPaid);
      const fallbackAmount = roundMoney(toNumber(req.body.amount));
      if (totalPaid <= 0 && fallbackAmount > 0) {
        interestPaid = fallbackAmount;
        principalPaid = 0;
        totalPaid = fallbackAmount;
      }
      if (interestPaid < 0 || principalPaid < 0 || totalPaid <= 0) {
        return res.status(400).json({ message: "Monto invalido." });
      }

      const result = await registerAmericanPayment({
        loanId,
        paymentId: req.body.paymentId,
        interestPaid,
        principalPaid,
        paidAt,
        method: req.body.method,
        note: req.body.note,
        createdBy: req.user?.uid || null,
        createdByUid: req.user?.uid || null,
        createdByEmail: req.user?.email || null
      });

      return res.json({ item: result });
    }

    let amount = roundMoney(toNumber(req.body.amount));
    if (amount <= 0) {
      const fallbackInterest = roundMoney(toNumber(req.body.interestPaid));
      const fallbackPrincipal = roundMoney(toNumber(req.body.principalPaid));
      amount = roundMoney(fallbackInterest + fallbackPrincipal);
    }
    if (amount <= 0) {
      return res.status(400).json({ message: "Monto invalido." });
    }

    const result = await registerInstallmentPayment({
      loanId,
      paymentId: req.body.paymentId,
      installmentNumber: req.body.installmentNumber,
      amount,
      paidAt,
      method: req.body.method,
      note: req.body.note,
      createdBy: req.user?.uid || null,
      createdByUid: req.user?.uid || null,
      createdByEmail: req.user?.email || null
    });

    return res.json({ item: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || "No se pudo registrar el pago." });
  }
});

app.get("/loans/debug/sample", requireAuth, async (req, res) => {
  try {
    const snap = await db.collection("loans").limit(20).get();
    if (!snap || snap.empty) {
      return res.json({ items: [] });
    }
    const items = snap.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      return {
        id: docSnap.id,
        status: data.status ?? null,
        dni: data.dni ?? null,
        customerDni: data.customerDni ?? null,
        customerId: data.customerId ?? null,
        createdAt: data.createdAt ?? null
      };
    });
    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ message: "Error al obtener muestra de Préstamos." });
  }
});

app.get("/loans/debug/by-dni", requireAuth, async (req, res) => {
  try {
    const dni = String(req.query.dni || "").trim();
    if (!dni) return res.json({ count: 0, items: [] });

    const [snapCustomerDni, snapDniField] = await Promise.all([
      db.collection("loans").where("customerDni", "==", dni).get(),
      db.collection("loans").where("dni", "==", dni).get()
    ]);

    const items = [];
    [snapCustomerDni, snapDniField].forEach((snap) => {
      if (!snap || snap.empty) return;
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        items.push({
          id: docSnap.id,
          customerDni: data.customerDni || null,
          dni: data.dni || null,
          status: data.status || null
        });
      });
    });

    return res.json({ count: items.length, items });
  } catch (error) {
    return res.status(500).json({ message: "Error al depurar Préstamos." });
  }
});

app.get("/loans/active-by-dni", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const dniString = String(req.query.dni || "").trim();
    if (!dniString) return res.json({ items: [] });

    const dniNumber = Number(dniString);
    const customerSnapById = await db.collection("customers").doc(dniString).get();
    let customerId = customerSnapById.exists ? customerSnapById.id : null;

    if (!customerId) {
      let customerQuery = db.collection("customers").where("dni", "==", dniString).limit(1);
      let customerQuerySnap = await customerQuery.get();
      if (customerQuerySnap.empty && Number.isFinite(dniNumber)) {
        customerQuery = db.collection("customers").where("dni", "==", dniNumber).limit(1);
        customerQuerySnap = await customerQuery.get();
      }
      if (!customerQuerySnap.empty) {
        customerId = customerQuerySnap.docs[0].id;
      }
    }

    if (!customerId && !dniString) {
      return res.json({ items: [] });
    }

    const base = db.collection("loans");
    const statusValues = [
      ...getStatusFilterValues("active").values,
      ...getStatusFilterValues("late").values
    ];
    const items = [];
    const pushSnap = (snap) => {
      if (!snap || snap.empty) return;
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        if (data.voided) return;
        const loanType = normalizeLoanType(data.loanType);
        const outstanding = getLoanOutstanding(data);
        const computedStatus = computeLoanStatus(data, new Date());
        if (computedStatus !== "active" && computedStatus !== "late") return;
        items.push({
          id: docSnap.id,
          ...data,
          loanType,
          balance: loanType === "americano" ? outstanding : Number(data.balance || 0),
          principalOutstanding: loanType === "americano" ? outstanding : Number(data.principalOutstanding || 0),
          status: computedStatus
        });
      });
    };

    let snap = null;
    if (customerId) {
      snap = await base
        .where("customerId", "==", customerId)
        .where("status", "in", statusValues)
        .get();
      pushSnap(snap);
    }

    if (items.length === 0) {
      snap = await base
        .where("customerDni", "==", dniString)
        .where("status", "in", statusValues)
        .get();
      pushSnap(snap);
    }

    if (items.length === 0) {
      snap = await base
        .where("dni", "==", dniString)
        .where("status", "in", statusValues)
        .get();
      pushSnap(snap);
    }

    if (items.length === 0) {
      snap = await base
        .where("dniCliente", "==", dniString)
        .where("status", "in", statusValues)
        .get();
      pushSnap(snap);
    }

    console.log("[active-by-dni] dni=", dniString, "customerDocId=", customerId, "count=", items.length);
    return res.json({ items });
  } catch (error) {
    console.error("[active-by-dni] error", error);
    return res.status(500).json({ message: "Error al buscar Préstamos activos." });
  }
});

async function handleReportsList(req, res) {
  try {
    const type = normalizeText(req.query.type || "all");
    const term = normalizeText(req.query.q || req.query.query || "");
    const limitRaw = toNumber(req.query.limit);
    const limit = Math.min(Math.max(limitRaw || 100, 1), 200);

    const snap = await db
      .collection("movements")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    let items = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((item) => !item.voided && !item.deletedAt);

    if (term) {
      items = items.filter((item) => {
        const customer = item.customer || {};
        const note = String(item.note || "").toLowerCase();
        const name = String(customer.name || "").toLowerCase();
        const dni = String(customer.dni || "").toLowerCase();
        return name.includes(term) || dni.includes(term) || note.includes(term);
      });
    }

    if (type && type !== "all") {
      const map = {
        loans: ["loan_create", "loan_void"],
        payments: ["payment_create", "payment_void"],
        usd: ["usd_buy", "usd_sell", "usd_void"]
      };
      const allowed = map[type] || [type];
      items = items.filter((item) => allowed.includes(item.type));
    }

    return res.json({
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        createdAt: formatDateTime(item.createdAt),
        occurredAt: item.occurredAt || null,
        customer: item.customer || null,
        loan: item.loan || null,
        payment: item.payment || null,
        usd: item.usd || null,
        note: item.note || "",
        relatedId: item.relatedId || null
      }))
    });
  } catch (error) {
    console.error("[REPORTS_GET_FAILED]", error);
    return res.status(500).json({ message: "No se pudieron cargar los reportes." });
  }
}

async function handleReportsApi(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const rawType = String(req.query.type || "").trim();
    if (!rawType) {
      return res.status(400).json({ error: "TYPE_REQUIRED" });
    }
    const type = normalizeText(rawType);
    const term = normalizeText(req.query.q || "");
    const limitRaw = toNumber(req.query.limit);
    const limit = Math.min(Math.max(limitRaw || 100, 1), 200);

    const snap = await db
      .collection("movements")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    let items = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((item) => !item.voided && !item.deletedAt);

    if (term) {
      items = items.filter((item) => {
        const customer = item.customer || {};
        const note = String(item.note || "").toLowerCase();
        const name = String(customer.name || "").toLowerCase();
        const dni = String(customer.dni || "").toLowerCase();
        return name.includes(term) || dni.includes(term) || note.includes(term);
      });
    }

    if (type !== "movimientos" && type !== "all") {
      const map = {
        loans: ["loan_create", "loan_void"],
        payments: ["payment_create", "payment_void"],
        usd: ["usd_buy", "usd_sell", "usd_void"]
      };
      const allowed = map[type] || [type];
      items = items.filter((item) => allowed.includes(item.type));
    }
    return res.json({
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        createdAt: formatDateTime(item.createdAt),
        occurredAt: item.occurredAt || null,
        customer: item.customer || null,
        loan: item.loan || null,
        payment: item.payment || null,
        usd: item.usd || null,
        note: item.note || "",
        relatedId: item.relatedId || null
      }))
    });
  } catch (error) {
    console.error("[REPORTS]", error);
    return res.status(500).json({ error: "REPORTS_FAILED" });
  }
}

async function handleReportsDelete(req, res) {
  try {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;

    let kind = String(req.params.kind || "").toLowerCase();
    if (kind === "payments") kind = "payment";
    if (kind === "loans") kind = "loan";
    const id = String(req.params.id || "").trim();
    const reason = String(req.body?.reason || "").trim();

    if (!id || (kind !== "loan" && kind !== "payment")) {
      return sendJsonError(res, 400, {
        code: "INVALID_INPUT",
        message: "Parámetros inválidos.",
        details: {
          kind,
          id: id || null
        }
      });
    }

    if (kind === "loan") {
      const loanRef = db.collection("loans").doc(id);
      await db.runTransaction(async (tx) => {
        const loanSnap = await tx.get(loanRef);
        if (!loanSnap.exists) {
          const error = new Error("Préstamo no encontrado.");
          error.status = 404;
          error.code = "NOT_FOUND";
          throw error;
        }
        const loan = loanSnap.data() || {};
        if (loan.voided) {
          const error = new Error("El Préstamo ya estaba anulado.");
          error.status = 400;
          error.code = "ALREADY_VOIDED";
          throw error;
        }

        const paymentsSnap = await tx.get(db.collection("payments").where("loanId", "==", id));
        const hasPayments = paymentsSnap.docs.some((docSnap) => {
          const data = docSnap.data() || {};
          return !data.voided;
        });
        if (hasPayments) {
          const error = new Error("El Préstamo tiene pagos registrados.");
          error.status = 400;
          error.code = "HAS_PAYMENTS";
          throw error;
        }

        tx.update(loanRef, {
          voided: true,
          voidedAt: admin.firestore.FieldValue.serverTimestamp(),
          voidReason: reason || "",
          status: "void",
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        const treasurySummaryRef = db.collection("treasurySummary").doc("primary");
        const disbursed = roundMoney(toNumber(loan.principalOriginal || loan.principal || 0));
        const outstanding = roundMoney(toNumber(loan.capitalPending || loan.balance || 0));
        tx.set(
          treasurySummaryRef,
          {
            totalDisbursedArs: admin.firestore.FieldValue.increment(-disbursed),
            totalLoanOutstandingArs: admin.firestore.FieldValue.increment(-outstanding),
            liquidArs: admin.firestore.FieldValue.increment(disbursed),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      });

      return res.json({ ok: true });
    }

    const paymentRef = db.collection("payments").doc(id);
    await db.runTransaction(async (tx) => {
      const paymentSnap = await tx.get(paymentRef);
      if (!paymentSnap.exists) {
        const error = new Error("Pago no encontrado.");
        error.status = 404;
        error.code = "NOT_FOUND";
        throw error;
      }
      const payment = paymentSnap.data() || {};
      if (payment.voided) {
        const error = new Error("El pago ya estaba anulado.");
        error.status = 400;
        error.code = "ALREADY_VOIDED";
        throw error;
      }
      const loanId = payment.loanId;
      if (!loanId) {
        const error = new Error("Pago sin referencia de Préstamo.");
        error.status = 400;
        error.code = "LOAN_REQUIRED";
        throw error;
      }

      const loanRef = db.collection("loans").doc(loanId);
      const loanSnap = await tx.get(loanRef);
      if (!loanSnap.exists) {
        const error = new Error("Préstamo no encontrado.");
        error.status = 404;
        error.code = "NOT_FOUND";
        throw error;
      }

      const loan = loanSnap.data() || {};
      const loanType = normalizeLoanType(loan.loanType);
      const amountBase = roundMoney(
        Number(payment.amount || 0) ||
          Number(payment.interestPaid || 0) + Number(payment.principalPaid || 0)
      );
      const nextPaidTotal = roundMoney(Math.max(toNumber(loan.paidTotal) - amountBase, 0));
      const loanUpdates = {
        paidTotal: nextPaidTotal,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (loanType === "americano") {
        const principalPaid = roundMoney(Number(payment.principalPaid || 0));
        const currentOutstanding = getLoanOutstanding(loan);
        const principalOriginal = roundMoney(
          toNumber(loan.principalOriginal || loan.principal || currentOutstanding)
        );
        const principalCap =
          principalOriginal > 0 ? principalOriginal : roundMoney(currentOutstanding + principalPaid);
        const nextOutstanding = roundMoney(
          Math.min(Math.max(currentOutstanding + principalPaid, 0), principalCap)
        );
        loanUpdates.principalOutstanding = nextOutstanding;
        loanUpdates.balance = nextOutstanding;
        loanUpdates.status = nextOutstanding <= 0 ? "finished" : "active";
        loanUpdates.capitalPending = nextOutstanding;
        loanUpdates.endDate = loanUpdates.status === "finished" ? loan.endDate || null : null;
      } else {
        const totalDue = roundMoney(toNumber(loan.totalDue));
        const { installments } = ensureLoanInstallments(loan);
        let updatedInstallments = installments ? [...installments] : null;
        const installmentNumber = toNumber(payment.installmentNumber);
        if (updatedInstallments && installmentNumber > 0) {
          const idx = updatedInstallments.findIndex(
            (item) => toNumber(item.number) === installmentNumber
          );
          if (idx >= 0) {
            const prevPaid = roundMoney(toNumber(updatedInstallments[idx].paidTotal));
            updatedInstallments[idx] = {
              ...updatedInstallments[idx],
              paidTotal: roundMoney(Math.max(prevPaid - amountBase, 0))
            };
          }
        }

        const balance = roundMoney(Math.max(totalDue - nextPaidTotal, 0));
        const allPaid = updatedInstallments
          ? updatedInstallments.every(
              (item) => roundMoney(toNumber(item.amount) - toNumber(item.paidTotal)) <= 0
            )
          : nextPaidTotal >= totalDue;
        const nextDueDateValue = computeNextDueDateFromInstallments(updatedInstallments);
        loanUpdates.balance = balance;
        loanUpdates.capitalPending = balance;
        loanUpdates.status = allPaid || balance <= 0 ? "finished" : "active";
        loanUpdates.nextDueDate = nextDueDateValue ? formatDateOnly(nextDueDateValue) : null;
        loanUpdates.nextDueAt = nextDueDateValue
          ? admin.firestore.Timestamp.fromDate(nextDueDateValue)
          : null;
        loanUpdates.endDate = loanUpdates.status === "finished" ? loan.endDate || null : null;
        if (updatedInstallments) {
          loanUpdates.installments = updatedInstallments;
        }
      }

      const voidPayload = {
        voided: true,
        voidedAt: admin.firestore.FieldValue.serverTimestamp(),
        voidReason: reason || "",
        voidedBy: adminUser.uid
      };

      tx.update(paymentRef, voidPayload);
      tx.set(loanRef.collection("payments").doc(paymentRef.id), voidPayload, { merge: true });
      tx.update(loanRef, loanUpdates);

      const paidAtDate = toDateValue(payment.paidAt) || toDateValue(payment.createdAt);
      const paidMonth = payment.paidMonth || formatMonthKey(paidAtDate);
      const interestTotal = Number((payment.interestTotal ?? payment.interestPaid) || 0);
      const interestMine =
        payment.interestMine != null
          ? Number(payment.interestMine || 0)
          : computeInterestSplit(loan, interestTotal).interestMine;
      const interestIntermediary =
        payment.interestIntermediary != null
          ? Number(payment.interestIntermediary || 0)
          : Math.max(interestTotal - interestMine, 0);
      const amountPaid = Number(
        payment.amountPaid != null
          ? payment.amountPaid
          : roundMoney(Number(payment.principalPaid || 0) + interestTotal)
      );
      const principalPaidValue = Number(payment.principalPaid || 0);
      loanUpdates.paidCapital = admin.firestore.FieldValue.increment(-principalPaidValue);
      loanUpdates.paidInterest = admin.firestore.FieldValue.increment(-interestTotal);
      loanUpdates.interestEarnedMineTotal = admin.firestore.FieldValue.increment(-interestMine);
      loanUpdates.interestEarnedIntermediaryTotal =
        admin.firestore.FieldValue.increment(-interestIntermediary);
      const treasurySummaryRef = db.collection("treasurySummary").doc("primary");
      tx.set(
        treasurySummaryRef,
        {
          totalCollectedArs: admin.firestore.FieldValue.increment(-amountPaid),
          totalLoanOutstandingArs: admin.firestore.FieldValue.increment(principalPaidValue),
          liquidArs: admin.firestore.FieldValue.increment(-amountPaid),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      const treasuryUserRef = db
        .collection("treasuryUsers")
        .doc(payment.createdByUid || payment.createdBy || "unknown");
      tx.set(
        treasuryUserRef,
        {
          email: payment.createdByEmail || "Sin asignar",
          paymentsCount: admin.firestore.FieldValue.increment(-1),
          collectedArs: admin.firestore.FieldValue.increment(-amountPaid),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      const ledgerRef = db.collection("ledger").doc();
      tx.set(
        ledgerRef,
        buildLedgerPayload({
          type: "adjustment",
          amountARS: -amountPaid,
          interestARS: -interestTotal,
          principalARS: -principalPaidValue,
          interestMineARS: -interestMine,
          interestIntermediaryARS: -interestIntermediary,
          date: paidAtDate,
          createdByUid: payment.createdByUid || payment.createdBy || null,
          createdByEmail: payment.createdByEmail || null,
          loanId: loanRef.id,
          customerDni: loan.customerDni || loan.dni || loan.dniCliente || null,
          note: `Anulación pago ${paymentRef.id}`,
          source: "void"
        })
      );
      if (paidMonth) {
        const profitRef = db.collection("profitMonthly").doc(paidMonth);
        tx.set(
          profitRef,
          {
            month: paidMonth,
            mineArs: admin.firestore.FieldValue.increment(-interestMine),
            intermediaryArs: admin.firestore.FieldValue.increment(-interestIntermediary),
            interestTotalArs: admin.firestore.FieldValue.increment(-interestTotal),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }

      const movementRef = db.collection("movements").doc();
      tx.set(
        movementRef,
        buildMovementPayload({
          type: "payment_void",
          customer: {
            id: loan.customerId || null,
            dni: loan.customerDni || loan.dni || loan.dniCliente || null,
            name: loan.customerName || null
          },
          loan: {
            id: loanRef.id,
            loanType: normalizeLoanType(loan.loanType),
            status: normalizeLoanStatus(loanUpdates.status || loan.status) || "active"
          },
          payment: {
            id: paymentRef.id,
            amount: Number(payment.amount || 0),
            interestTotal: Number((payment.interestTotal ?? payment.interestPaid) || 0),
            interestMine: Number((payment.interestMine ?? payment.interestPaid) || 0),
            interestIntermediary: Number(payment.interestIntermediary || 0),
            principalPaid: Number(payment.principalPaid || 0),
            paidAt: formatDateOnly(payment.paidAt),
            method: payment.method || null,
            note: payment.note || null
          },
          note: reason || "",
          relatedId: paymentRef.id,
          createdBy: adminUser.uid
        })
      );
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("[REPORTS_DELETE_FAILED]", error);
    const status = error.status || 500;
    if (status !== 500) {
      return sendJsonError(res, status, {
        code: error.code || "REPORTS_DELETE_FAILED",
        message: error.message || "No se pudo anular el movimiento."
      });
    }
    return res
      .status(500)
      .json({ ok: false, message: error.message || "No se pudo anular el movimiento." });
  }
}

app.get("/reports", requireAuth, handleReportsApi);
app.get("/loans/reports", requireAuth, handleReportsList);

app.delete("/reports/movements/:id", requireAuth, async (req, res) => {
  try {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;
    const id = String(req.params.id || "").trim();
    if (!id) {
      return sendJsonError(res, 400, {
        code: "INVALID_INPUT",
        message: "Parámetros inválidos.",
        details: { id: id || null }
      });
    }
    const reason = String(req.query?.reason ?? "").trim();
    const debug = String(req.query?.debug || "") === "1";
    if (debug) {
      const roleInfo = await getRoleInfo(req.user?.uid || null, req.user?.email || null);
      functions.logger.info("[MOVEMENT_DELETE_DEBUG]", {
        uid: req.user?.uid || null,
        roleSource: roleInfo.source,
        rawRole: roleInfo.raw?.role ?? null,
        rawAdmin: roleInfo.raw?.admin ?? null,
        rawIsAdmin: roleInfo.raw?.isAdmin ?? null,
        role: roleInfo.role,
        isAdmin: roleInfo.admin === true
      });
    }
    const ref = db.collection("movements").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return sendJsonError(res, 404, { code: "NOT_FOUND", message: "Movimiento no encontrado." });
    }
    await ref.set(
      {
        voided: true,
        voidedAt: admin.firestore.FieldValue.serverTimestamp(),
        voidReason: reason || "",
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletedByUid: adminUser.uid,
        deletedByEmail: adminUser.email,
        deleteReason: reason || ""
      },
      { merge: true }
    );
    console.log("[REPORTS_DELETE]", {
      id,
      uid: adminUser.uid,
      email: adminUser.email,
      reason: reason || "",
      adminSource: adminUser.source
    });
    return res.json({ ok: true });
  } catch (error) {
    return sendJsonError(res, 500, {
      code: "DELETE_MOVEMENT_FAILED",
      message: "No se pudo eliminar el movimiento.",
      details: error.message || null
    });
  }
});

app.delete("/reports/:kind/:id", requireAuth, handleReportsDelete);
app.delete("/loans/reports/:kind/:id", requireAuth, handleReportsDelete);

app.get("/profits/monthly", requireAuth, async (req, res) => {
  try {
    const year = String(req.query.year || "").trim();
    if (!/^\d{4}$/.test(year)) {
      return sendJsonError(res, 400, { code: "INVALID_YEAR", message: "Año inválido." });
    }
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    const snaps = await Promise.all(
      months.map((month) => db.collection("profitMonthly").doc(month).get())
    );
    const items = months.map((month, idx) => {
      const data = snaps[idx]?.exists ? snaps[idx].data() || {} : {};
      return {
        month,
        mineArs: Number(data.mineArs || 0),
        intermediaryArs: Number(data.intermediaryArs || 0),
        interestTotalArs: Number(data.interestTotalArs || 0)
      };
    });
    return res.json({ items });
  } catch (error) {
    return sendJsonError(res, 500, {
      code: "PROFITS_MONTHLY_FAILED",
      message: "No se pudo cargar el resumen.",
      details: error.message || null
    });
  }
});

app.post("/profits/rebuild", requireAuth, async (req, res) => {
  try {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;
    const year = String(req.query.year || "").trim();
    if (!/^\d{4}$/.test(year)) {
      return sendJsonError(res, 400, { code: "INVALID_YEAR", message: "Año inválido." });
    }
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    const summary = new Map();
    months.forEach((month) => {
      summary.set(month, { mineArs: 0, intermediaryArs: 0, interestTotalArs: 0 });
    });

    const snap = await db.collection("payments").get();
    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (data.voided === true) return;
      const paidAtDate = toDateValue(data.paidAt) || toDateValue(data.createdAt);
      if (!paidAtDate) return;
      const paidYear = String(paidAtDate.getUTCFullYear());
      if (paidYear !== year) return;
      const monthKey = formatMonthKey(paidAtDate);
      if (!summary.has(monthKey)) return;
      const interestTotal = Number((data.interestTotal ?? data.interestPaid) || 0);
      const interestMine = Number((data.interestMine ?? data.interestPaid) || 0);
      const interestIntermediary = Number(data.interestIntermediary || 0);
      const current = summary.get(monthKey);
      summary.set(monthKey, {
        mineArs: Number(current.mineArs || 0) + interestMine,
        intermediaryArs: Number(current.intermediaryArs || 0) + interestIntermediary,
        interestTotalArs: Number(current.interestTotalArs || 0) + interestTotal
      });
    });

    const batch = db.batch();
    months.forEach((month) => {
      const totals = summary.get(month) || { mineArs: 0, intermediaryArs: 0, interestTotalArs: 0 };
      const ref = db.collection("profitMonthly").doc(month);
      batch.set(
        ref,
        {
          month,
          mineArs: Number(totals.mineArs || 0),
          intermediaryArs: Number(totals.intermediaryArs || 0),
          interestTotalArs: Number(totals.interestTotalArs || 0),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });
    await batch.commit();
    return res.json({ ok: true });
  } catch (error) {
    return sendJsonError(res, 500, {
      code: "PROFITS_REBUILD_FAILED",
      message: "No se pudo reconstruir el resumen.",
      details: error.message || null
    });
  }
});

app.get("/profits/details", requireAuth, async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return sendJsonError(res, 400, { code: "INVALID_MONTH", message: "Mes inválido." });
    }
    const snap = await db.collection("payments").where("paidMonth", "==", month).get();
    const items = snap.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      return {
        id: docSnap.id,
        loanId: data.loanId || null,
        customerDni: data.customerDni || null,
        customerName: data.customerName || null,
        paidAt: formatDateOnly(data.paidAt) || formatDateOnly(data.createdAt),
        paidMonth: data.paidMonth || month,
        amount: Number(data.amount || 0),
        interestTotal: Number((data.interestTotal ?? data.interestPaid) || 0),
        interestMine: Number((data.interestMine ?? data.interestPaid) || 0),
        interestIntermediary: Number(data.interestIntermediary || 0)
      };
    });
    return res.json({ items });
  } catch (error) {
    return sendJsonError(res, 500, {
      code: "PROFITS_DETAILS_FAILED",
      message: "No se pudo cargar el detalle.",
      details: error.message || null
    });
  }
});

async function getWalletsSummary() {
  const snap = await db.collection("wallets").get();
  const walletMap = new Map();
  snap.docs.forEach((docSnap) => {
    walletMap.set(docSnap.id, {
      uid: docSnap.id,
      ...docSnap.data(),
      movementsCount: 0,
      totalIn: 0,
      totalOut: 0
    });
  });

  const movementsSnap = await db.collection("wallet_movements").get();
  let totalCobradoARS = 0;
  movementsSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const amount = Number(data.amount || 0);
    const movementType = String(data.type || "").toUpperCase();
    if (data.toUid) {
      const wallet = walletMap.get(data.toUid);
      if (wallet) {
        wallet.movementsCount = Number(wallet.movementsCount || 0) + 1;
        wallet.totalIn = Number(wallet.totalIn || 0) + amount;
      }
    }
    if (data.fromUid) {
      const wallet = walletMap.get(data.fromUid);
      if (wallet) {
        wallet.movementsCount = Number(wallet.movementsCount || 0) + 1;
        wallet.totalOut = Number(wallet.totalOut || 0) + amount;
      }
    }
    if (movementType === "PAYMENT_CREDIT" || movementType === "MIGRATION") {
      totalCobradoARS += amount;
    }
  });

  const wallets = Array.from(walletMap.values())
    .map(buildWalletSnapshot)
    .sort((a, b) => (a.email || "").localeCompare(b.email || ""));

  let totalLiquidARS = 0;
  wallets.forEach((item) => {
    totalLiquidARS += Number(item.balance || 0);
  });

  const loansSnap = await db.collection("loans").get();
  let capitalPrestadoARS = 0;
  loansSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (data.voided) return;
    const status = computeLoanStatus(data);
    if (status !== "active" && status !== "late") return;
    const outstanding = getLoanOutstanding(data);
    capitalPrestadoARS += Number(outstanding || 0);
  });

  const totalGeneralARS = totalLiquidARS + capitalPrestadoARS;
  return {
    wallets,
    totals: {
      totalLiquidARS: roundMoney(totalLiquidARS),
      totalCobradoARS: roundMoney(totalCobradoARS),
      capitalPrestadoARS: roundMoney(capitalPrestadoARS),
      totalGeneralARS: roundMoney(totalGeneralARS)
    }
  };
}

app.get("/wallets/summary", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const uid = req.user?.uid || null;
    const email = req.user?.email || "Sin asignar";
    await ensureWalletExists(uid, email);
    await ensureAuthWalletsThrottled();
    const summary = await getWalletsSummary();
    return res.json(summary);
  } catch (error) {
    functions.logger.error("[WALLETS_SUMMARY_FAILED]", error);
    return res.status(500).json({ message: error.message || "No se pudo cargar el resumen." });
  }
});

app.get("/wallets/ensure", requireAuth, async (req, res) => {
  try {
    const uid = req.user?.uid || null;
    const email = req.user?.email || "Sin asignar";
    await ensureWalletExists(uid, email);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "No se pudo asegurar la wallet." });
  }
});

app.post("/wallets/ensure", requireAuth, async (req, res) => {
  try {
    const uid = req.user?.uid || null;
    const email = normalizeEmailValue(req.user?.email || "Sin asignar");
    if (!uid) return res.status(401).json({ message: "Usuario no autenticado." });
    const ref = db.collection("wallets").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        uid,
        email,
        balance: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.json({ ok: true, created: true });
    }
    await ref.set(
      {
        uid,
        email,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    return res.json({ ok: true, created: false });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudo asegurar la wallet." });
  }
});

app.get("/wallets", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const uid = req.user?.uid || null;
    const email = req.user?.email || "Sin asignar";
    await ensureWalletExists(uid, email);
    await ensureAuthWalletsThrottled();
    const summary = await getWalletsSummary();
    const items = Array.isArray(summary?.wallets) ? summary.wallets : [];
    return res.json({
      items: items.map((item) => ({
        email: item.email || "Sin asignar",
        balance: Number(item.balance || 0),
        movementsCount: Number(item.movementsCount || 0),
        total: Number(item.balance || 0)
      }))
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "No se pudieron cargar las wallets." });
  }
});

app.get("/wallets/recipients", requireAuth, async (req, res) => {
  try {
    const uid = req.user?.uid || null;
    const email = req.user?.email || "Sin asignar";
    await ensureWalletExists(uid, email);
    await ensureAuthWalletsThrottled();
    const snap = await db.collection("wallets").get();
    const items = snap.docs
      .map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }))
      .filter((item) => item.uid !== uid)
      .map((item) => ({
        uid: item.uid,
        email: normalizeEmailValue(item.email || "Sin asignar")
      }));
    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudieron cargar destinatarios." });
  }
});

app.post("/wallets/transfer", requireAuth, async (req, res) => {
  try {
    const amountARS = roundMoney(toNumber(req.body.amount ?? req.body.amountARS));
    if (!amountARS || amountARS <= 0) {
      return res.status(400).json({ message: "Monto inválido." });
    }
    const fromUid = req.user?.uid || null;
    const fromEmail = normalizeEmailValue(req.user?.email || "Sin asignar");
    if (!fromUid) {
      return res.status(401).json({ message: "Usuario no autenticado." });
    }

    let toUid = String(req.body.toUid || "").trim();
    let toEmail = String(req.body.toEmail || "").trim().toLowerCase();
    if (!toUid && toEmail) {
      const resolved = await resolveUserByEmail(toEmail);
      if (resolved) {
        toUid = resolved.uid;
        toEmail = resolved.email || toEmail;
      }
    }
    if (!toUid) {
      return res.status(400).json({ message: "Destino inválido." });
    }
    if (toUid === fromUid) {
      return res.status(400).json({ message: "No pod?s transferirte a vos mismo." });
    }

    await ensureWalletExists(fromUid, fromEmail);
    if (toEmail) {
      await ensureWalletExists(toUid, toEmail);
    }

    const transferRef = db.collection("ledger").doc();
    const movementRef = db.collection("wallet_movements").doc();
    await db.runTransaction(async (tx) => {
      const fromWallet = await getWalletData(tx, fromUid, fromEmail);
      const toWallet = await getWalletData(tx, toUid, toEmail || "Sin asignar");

      tx.set(
        fromWallet.walletRef,
        {
          uid: fromWallet.walletUid,
          email: fromWallet.email,
          balance: roundMoney(fromWallet.balance - amountARS),
          balanceArs: roundMoney(fromWallet.balance - amountARS),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      tx.set(
        toWallet.walletRef,
        {
          uid: toWallet.walletUid,
          email: toWallet.email,
          balance: roundMoney(toWallet.balance + amountARS),
          balanceArs: roundMoney(toWallet.balance + amountARS),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      tx.set(transferRef, {
        type: "TRANSFER",
        amountARS,
        fromUid,
        toUid,
        createdByUid: fromUid,
        createdByEmail: fromEmail,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        meta: {
          fromEmail,
          toEmail: toWallet.email
        }
      });
      tx.set(movementRef, {
        type: "TRANSFER",
        amount: amountARS,
        fromUid,
        toUid,
        createdByUid: fromUid,
        createdByEmail: fromEmail,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        note: req.body.note || ""
      });
    });

    return res.json({ ok: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || "No se pudo transferir." });
  }
});

app.post("/wallets/migrate-history", requireAuth, async (req, res) => {
  try {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;

    const migrationRef = db.collection("migrations").doc("walletsHistory");
    const migrationSnap = await migrationRef.get();
    if (migrationSnap.exists && migrationSnap.data()?.done) {
      return res.status(409).json({ message: "La migraci?n ya fue ejecutada." });
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
        Number(data.amountPaid ?? data.amount ?? 0) ||
        Number(data.interestPaid || 0) + Number(data.principalPaid || 0);
      if (!amount || amount <= 0) return;
      const key = uid || email;
      if (!key) return;
      const current = totalsByKey.get(key) || {
        uid,
        email,
        total: 0
      };
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
      const email = normalizeEmailValue(targetEmail || "Sin asignar");
      const ledgerRef = db.collection("ledger").doc();
      await db.runTransaction(async (tx) => {
        const wallet = await getWalletData(tx, targetUid, email);
        const nextBalance = roundMoney(wallet.balance + entry.total);
        tx.set(
          wallet.walletRef,
          {
            uid: wallet.walletUid,
            email: wallet.email,
            balance: nextBalance,
            balanceArs: nextBalance,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
        tx.set(ledgerRef, {
          type: "migration",
          amountARS: roundMoney(entry.total),
          toUid: wallet.walletUid,
          createdByUid: adminUser.uid,
          createdByEmail: normalizeEmailValue(req.user?.email || "Sin asignar"),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          note: "Migraci?n hist?rico previo a wallets"
        });
        const movementRef = db.collection("wallet_movements").doc();
        tx.set(movementRef, {
          type: "migration",
          amount: roundMoney(entry.total),
          toUid: wallet.walletUid,
          createdByUid: adminUser.uid,
          createdByEmail: normalizeEmailValue(req.user?.email || "Sin asignar"),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          note: "Migraci?n hist?rico previo a wallets"
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

    return res.json({ ok: true, walletsUpdated: updated });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudo ejecutar la migraci?n." });
  }
});

app.get("/treasury/by-user", requireAuth, async (req, res) => {
  try {
    const snap = await db.collection("treasuryUsers").get();
    const items = snap.docs
      .map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }))
      .map((item) => ({
        uid: item.uid,
        email: item.email || "Sin asignar",
        paymentsCount: Number(item.paymentsCount || 0),
        collectedArs: Number(item.collectedArs || 0)
      }))
      .sort((a, b) => b.collectedArs - a.collectedArs);
    return res.json({ items });
  } catch (error) {
    return sendJsonError(res, 500, {
      code: "TREASURY_BY_USER_FAILED",
      message: "No se pudo cargar el resumen por usuario.",
      details: error.message || null
    });
  }
});

app.get("/atesorado/summary", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const summary = await getWalletsSummary();
    return res.json(summary);
  } catch (error) {
    functions.logger.error("[ATESORADO_SUMMARY_FAILED]", error);
    return res.status(500).json({
      message: error.message || "No se pudo cargar el atesorado."
    });
  }
});

app.get("/treasury/summary", requireAuth, async (req, res) => {
  try {
    const snap = await db.collection("treasurySummary").doc("primary").get();
    const data = snap.exists ? snap.data() || {} : {};
    const totalCollectedArs = Number(data.totalCollectedArs || 0);
    const totalDisbursedArs = Number(data.totalDisbursedArs || 0);
    const totalLoanOutstandingArs = Number(data.totalLoanOutstandingArs || 0);
    const initialCash = Number(data.initialCash || 0);
    const liquidArs =
      data.liquidArs != null
        ? Number(data.liquidArs || 0)
        : totalCollectedArs - totalDisbursedArs + initialCash;
    return res.json({
      liquidArs,
      totalLoanOutstandingArs,
      totalCollectedArs,
      totalDisbursedArs,
      initialCash
    });
  } catch (error) {
    return sendJsonError(res, 500, {
      code: "TREASURY_SUMMARY_FAILED",
      message: "No se pudo cargar el resumen.",
      details: error.message || null
    });
  }
});

app.post("/treasury/rebuild", requireAuth, async (req, res) => {
  try {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;

    const treasurySummaryRef = db.collection("treasurySummary").doc("primary");
    const existingSummarySnap = await treasurySummaryRef.get();
    const existingSummary = existingSummarySnap.exists ? existingSummarySnap.data() || {} : {};
    const initialCash = Number(existingSummary.initialCash || 0);

    const [paymentsSnap, loansSnap, treasuryUsersSnap] = await Promise.all([
      db.collection("payments").get(),
      db.collection("loans").get(),
      db.collection("treasuryUsers").get()
    ]);

    let totalCollectedArs = 0;
    const byUser = new Map();

    paymentsSnap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (data.voided) return;
      const amountBase = Number(data.amountPaid || data.amount || 0);
      const amount =
        amountBase > 0
          ? amountBase
          : Number(data.interestPaid || 0) + Number(data.principalPaid || 0);
      totalCollectedArs += amount;
      const uid = data.createdByUid || data.createdBy || "unknown";
      const email = normalizeEmailValue(data.createdByEmail || "Sin asignar");
      const current = byUser.get(uid) || { uid, email, paymentsCount: 0, collectedArs: 0 };
      byUser.set(uid, {
        uid,
        email: current.email || email,
        paymentsCount: current.paymentsCount + 1,
        collectedArs: current.collectedArs + amount
      });
    });

    let totalDisbursedArs = 0;
    let totalLoanOutstandingArs = 0;
    loansSnap.docs.forEach((docSnap) => {
      const loan = docSnap.data() || {};
      if (loan.voided) return;
      if (normalizeLoanStatus(loan.status) === "void") return;
      const disbursed = roundMoney(toNumber(loan.principalOriginal || loan.principal || 0));
      totalDisbursedArs += disbursed;
      const outstanding = getLoanOutstanding(loan);
      if (outstanding > 0) {
        totalLoanOutstandingArs += Number(outstanding);
      }
    });

    const liquidArs = totalCollectedArs - totalDisbursedArs + initialCash;

    let batch = db.batch();
    let batchSize = 0;
    const flushBatch = async () => {
      if (batchSize === 0) return;
      await batch.commit();
      batch = db.batch();
      batchSize = 0;
    };

    const knownUids = new Set(byUser.keys());
    for (const docSnap of treasuryUsersSnap.docs) {
      if (!knownUids.has(docSnap.id)) {
        batch.delete(docSnap.ref);
        batchSize += 1;
        if (batchSize >= 400) {
          await flushBatch();
        }
      }
    }

    for (const [uid, entry] of byUser.entries()) {
      const ref = db.collection("treasuryUsers").doc(uid);
      batch.set(
        ref,
        {
          email: entry.email || "Sin asignar",
          paymentsCount: Number(entry.paymentsCount || 0),
          collectedArs: roundMoney(Number(entry.collectedArs || 0)),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      batchSize += 1;
      if (batchSize >= 400) {
        await flushBatch();
      }
    }

    await flushBatch();
    await treasurySummaryRef.set(
      {
        totalCollectedArs: roundMoney(totalCollectedArs),
        totalDisbursedArs: roundMoney(totalDisbursedArs),
        totalLoanOutstandingArs: roundMoney(totalLoanOutstandingArs),
        liquidArs: roundMoney(liquidArs),
        initialCash,
        rebuiltAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    functions.logger.info("[TREASURY_REBUILD]", {
      totalCollectedArs,
      totalDisbursedArs,
      totalLoanOutstandingArs
    });

    return res.json({ ok: true });
  } catch (error) {
    return sendJsonError(res, 500, {
      code: "TREASURY_REBUILD_FAILED",
      message: "No se pudo reconstruir el resumen.",
      details: error.message || null
    });
  }
});

app.get("/treasury", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const year = String(req.query.year || "").trim() || String(new Date().getUTCFullYear());
    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ message: "Año inválido." });
    }
    const collectionName = "ledger";
    console.log("[TREASURY] using collection:", collectionName);
    const snap = await db.collection(collectionName).get();
    if (snap.empty) {
      console.log("[TREASURY] no ledger entries found");
    }

    const byUserMap = new Map();
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    const monthly = new Map();
    months.forEach((month) => {
      monthly.set(month, { month, miGanancia: 0, intermediarios: 0, totalInteres: 0 });
    });

    let totalCobrado = 0;
    let totalInteres = 0;
    let totalCapital = 0;

    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (data.voided) return;
      const entryType = String(data.type || "").toLowerCase();
      if (entryType !== "payment" && entryType !== "adjustment") return;

      const uid = data.createdByUid || data.createdBy || "unknown";
      const email = data.createdByEmail || "Sin asignar";
      const amountARS = Number(data.amountARS || 0);
      const interestARS = Number(data.interestARS || 0);
      const principalARS = Number(data.principalARS || 0);
      totalCobrado += amountARS;
      totalInteres += interestARS;
      totalCapital += principalARS;

      const current = byUserMap.get(uid) || { uid, email, count: 0, total: 0 };
      byUserMap.set(uid, {
        uid,
        email: current.email || email,
        count: current.count + 1,
        total: current.total + amountARS
      });

      const dateValue = toDateValue(data.date) || toDateValue(data.createdAt);
      if (!dateValue) return;
      const entryYear = String(dateValue.getUTCFullYear());
      if (entryYear !== year) return;
      const monthKey = formatMonthKey(dateValue);
      if (!monthly.has(monthKey)) return;
      const monthRow = monthly.get(monthKey);
      const mine = Number(data.interestMineARS || 0);
      const intermediary = Number(data.interestIntermediaryARS || 0);
      const totalInteresMonth = Number(data.interestARS || 0);
      monthly.set(monthKey, {
        month: monthKey,
        miGanancia: monthRow.miGanancia + (mine || totalInteresMonth),
        intermediarios: monthRow.intermediarios + intermediary,
        totalInteres: monthRow.totalInteres + totalInteresMonth
      });
    });

    const byUser = Array.from(byUserMap.values()).sort((a, b) => b.total - a.total);
    return res.json({
      byUser,
      totals: {
        totalCobrado,
        totalInteres,
        totalCapital
      },
      monthly: months.map((month) => monthly.get(month))
    });
  } catch (error) {
    console.error("[TREASURY_FETCH_FAILED]", error);
    return res.status(500).json({
      message: error.message || "No se pudo cargar el atesorado."
    });
  }
});

app.get("/reports/kpis", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const [treasurySnap, loansSnap, profitSnap] = await Promise.all([
      db.collection("treasurySummary").doc("primary").get(),
      db.collection("loans").where("balance", ">", 0).get(),
      db.collection("profitMonthly").doc(formatMonthKey(new Date())).get()
    ]);

    const treasury = treasurySnap.exists ? treasurySnap.data() || {} : {};
    const collectedTotal = Number(treasury.totalCollectedArs || 0);
    const profitData = profitSnap.exists ? profitSnap.data() || {} : {};
    const interestMonth = Number(profitData.mineArs || 0);

    const activeDebtors = new Set();
    loansSnap.docs.forEach((docSnap) => {
      const loan = docSnap.data() || {};
      if (loan.voided) return;
      const outstanding = getLoanOutstanding(loan);
      if (outstanding <= 0) return;
      if (normalizeLoanStatus(loan.status) !== "active") return;
      if (loan.customerDni) activeDebtors.add(String(loan.customerDni));
    });

    functions.logger.info("[REPORTS_KPIS]", {
      debtors: activeDebtors.size
    });

    return res.json({
      item: {
        collectedTotal,
        debtorsCount: activeDebtors.size,
        interestMonth
      }
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudieron cargar los KPIs." });
  }
});

app.get("/reports/monthly", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const year = String(req.query.year || "").trim();
    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ error: "INVALID_YEAR" });
    }
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    const snaps = await Promise.all(
      months.map((month) => db.collection("profitMonthly").doc(month).get())
    );
    const items = months.map((month, idx) => {
      const data = snaps[idx]?.exists ? snaps[idx].data() || {} : {};
      return {
        month,
        totalInteres: Number(data.interestTotalArs || 0),
        miGanancia: Number(data.mineArs || 0),
        intermediarios: Number(data.intermediaryArs || 0)
      };
    });
    return res.json({ items });
  } catch (error) {
    console.error("[REPORTS_MONTHLY]", error);
    return res.status(500).json({ error: "REPORTS_MONTHLY_FAILED" });
  }
});

function getArgentinaDayRange(baseDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(baseDate).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const start = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00-03:00`);
  const end = new Date(`${parts.year}-${parts.month}-${parts.day}T23:59:59.999-03:00`);
  return { start, end };
}

function getArgentinaDateString(baseDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(baseDate);
}

function computeNextDueAt(loan) {
  const base = toDateValue(loan.nextDueDate) || toDateValue(loan.nextDueAt) || toDateValue(loan.createdAt);
  if (!base) return null;
  const frequency = loan.frequency || loan.termPeriod || "monthly";
  return addPeriod(base, frequency);
}

app.get("/reports/dashboard", requireAuth, async (req, res) => {
  try {
    const todayKey = getArgentinaDateString(new Date());
    const paymentsSnap = await db.collection("movements").where("occurredAt", "==", todayKey).get();
    let collectedToday = 0;
    paymentsSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (data.voided || data.deletedAt) return;
      if (data.type !== "payment_create" && data.type !== "payment_void") return;
      const payment = data.payment || {};
      const amountBase = Number(payment.amount || 0);
      const amount =
        amountBase > 0
          ? amountBase
          : Number(payment.interestPaid || 0) + Number(payment.principalPaid || 0);
      collectedToday += data.type === "payment_void" ? -amount : amount;
    });

    const loansSnap = await db.collection("loans").where("balance", ">", 0).get();
    const now = new Date();
    const next48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    let pendingCount = 0;
    let overdueTotal = 0;
    loansSnap.forEach((docSnap) => {
      const loan = docSnap.data();
      if (normalizeLoanType(loan.loanType) === "americano") return;
      const normalizedStatus = normalizeLoanStatus(loan.status);
      if (normalizedStatus !== "active" && normalizedStatus !== "late" && normalizedStatus !== "bad_debt") {
        return;
      }
      const dueDate = computeNextDueAt(loan);
      if (!dueDate) return;
      if (dueDate >= now && dueDate <= next48h) {
        pendingCount += 1;
      }
      if (dueDate < now) {
        overdueTotal += Number(loan.balance || 0);
      }
    });

    const latestMovementsSnap = await db
      .collection("movements")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const transactions = latestMovementsSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
      .filter((item) => !item.voided && !item.deletedAt && item.type === "payment_create")
      .slice(0, 10)
      .map((item) => {
        const payment = item.payment || {};
        const amountBase = Number(payment.amount || 0);
        const amount =
          amountBase > 0
            ? amountBase
            : Number(payment.interestPaid || 0) + Number(payment.principalPaid || 0);
        const paidAtValue = toDateValue(payment.paidAt) || toDateValue(item.occurredAt);
        return {
          id: item.id,
          amount,
          paidAt: paidAtValue ? paidAtValue.toISOString() : null,
          method: payment.method,
          note: payment.note,
          loanStatus: normalizeLoanStatus(item.loan?.status) || "active",
          customerName: item.customer?.name || "-"
        };
      });

    functions.logger.info("[REPORTS_DASHBOARD]", {
      collectedToday,
      pendingCount,
      overdueTotal,
      transactions: transactions.length
    });
    return res.json({
      summary: {
        collectedToday: Math.round(collectedToday * 100) / 100,
        pendingCount,
        overdueTotal: Math.round(overdueTotal * 100) / 100
      },
      transactions
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudo cargar el dashboard." });
  }
});

app.get("/dollars/stats", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const summarySnap = await db.collection("usdSummary").doc("primary").get();
    const availableUsd = summarySnap.exists ? Number(summarySnap.data().availableUsd || 0) : 0;
    return res.json({ item: { availableUsd } });
  } catch (error) {
    return res.status(500).json({ message: error.message || "No se pudieron cargar los dolares." });
  }
});

app.get("/dollars/stock", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const summarySnap = await db.collection("usdSummary").doc("primary").get();
    const availableUsd = summarySnap.exists ? Number(summarySnap.data().availableUsd || 0) : 0;
    return res.json({ availableUsd });
  } catch (error) {
    return sendJsonError(res, 500, {
      code: "STOCK_FETCH_FAILED",
      message: "No se pudo cargar el stock USD.",
      details: error.message || null
    });
  }
});

app.get("/dollars/summary", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const summarySnap = await db.collection("usdSummary").doc("primary").get();
    const data = summarySnap.exists ? summarySnap.data() || {} : {};
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    const movementsSnap = await db.collection("usdMovements").get();

    let monthProfitArs = 0;
    movementsSnap.forEach((docSnap) => {
      const movement = docSnap.data() || {};
      if (movement.voided) return;
      if (movement.type !== "sell") return;
      const occurredAtDate = movement.occurredAt
        ? toDateValue(movement.occurredAt)
        : toDateValue(movement.createdAt);
      if (!occurredAtDate) return;
      const movementMonthKey = formatMonthKey(occurredAtDate);
      if (movementMonthKey !== monthKey) return;
      let profit = Number(movement.profitArs || movement.profitArsTotal || 0);
      if (!profit && Array.isArray(movement.fifoBreakdown)) {
        profit = movement.fifoBreakdown.reduce(
          (sum, item) => sum + Number(item?.profitArs || 0),
          0
        );
      }
      if (!Number.isFinite(profit) || profit <= 0) return;
      monthProfitArs += profit;
    });

    monthProfitArs = Math.max(0, Math.round(monthProfitArs * 100) / 100);
    return res.json({
      availableUsd: Number(data.availableUsd || 0),
      monthKey,
      monthProfitArs
    });
  } catch (error) {
    return sendJsonError(res, 500, {
      code: "SUMMARY_FETCH_FAILED",
      message: "No se pudo cargar el resumen USD.",
      details: error.message || null
    });
  }
});

app.get("/dollars/movements", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const snap = await db.collection("usdMovements").orderBy("createdAt", "asc").get();
    const items = snap.docs
      .map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))
            .filter((item) => !item.voided && !item.deletedAt);
    items.sort((a, b) => {
      const dateA = toDateValue(a.createdAt) || toDateValue(a.occurredAt) || toDateValue(a.timestamp);
      const dateB = toDateValue(b.createdAt) || toDateValue(b.occurredAt) || toDateValue(b.timestamp);
      const timeA = dateA ? dateA.getTime() : 0;
      const timeB = dateB ? dateB.getTime() : 0;
      return timeB - timeA;
    });
    return res.json({ items });
  } catch (error) {
    return sendJsonError(res, 500, {
      code: "MOVEMENTS_FETCH_FAILED",
      message: "No se pudieron cargar las operaciones.",
      details: error.message || null
    });
  }
});

app.delete("/dollars/movements/:id", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;

    const movementId = String(req.params.id || "").trim();
    if (!movementId) {
      return res.status(400).json({ ok: false, code: "INVALID_ID", message: "ID requerido." });
    }

    const reason = String(req.body?.reason || "").trim();
    const movementRef = db.collection("usdMovements").doc(movementId);
    const summaryRef = db.collection("usdSummary").doc("primary");

    await db.runTransaction(async (tx) => {
      const movementSnap = await tx.get(movementRef);
      if (!movementSnap.exists) {
        const err = new Error("NOT_FOUND");
        err.code = "NOT_FOUND";
        throw err;
      }

      const movement = movementSnap.data() || {};
      if (movement.voided) {
        const err = new Error("ALREADY_VOIDED");
        err.code = "ALREADY_VOIDED";
        throw err;
      }

      const type = movement.type;
      const movementUsd = Number(movement.usd || 0);
      if (!Number.isFinite(movementUsd) || movementUsd <= 0) {
        const err = new Error("INVALID_MOVEMENT");
        err.code = "INVALID_MOVEMENT";
        throw err;
      }

      const summarySnap = await tx.get(summaryRef);
      const summaryData = summarySnap.exists ? summarySnap.data() || {} : {};
      const availableUsd = Number(summaryData.availableUsd || 0);

      if (type === "sell") {
        const fifo = Array.isArray(movement.fifoBreakdown) ? movement.fifoBreakdown : [];
        fifo.forEach((item) => {
          const lotId = item?.lotId;
          const usd = Number(item?.usd || 0);
          if (!lotId || !Number.isFinite(usd) || usd <= 0) return;
          const lotRef = db.collection("usdLots").doc(lotId);
          tx.update(lotRef, { remainingUsd: admin.firestore.FieldValue.increment(usd) });
        });

        const movementMonthKey = movement.occurredAt
          ? String(movement.occurredAt).slice(0, 7)
          : movement.createdAt?.toDate
            ? (() => {
                const date = movement.createdAt.toDate();
                return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
              })()
            : null;
        let monthProfitArs = Number(summaryData.monthProfitArs || 0);
        const summaryMonthKey = summaryData.monthKey || null;
        const profitArs = Number(movement.profitArs || movement.profitArsTotal || 0);
        if (summaryMonthKey && movementMonthKey && summaryMonthKey === movementMonthKey) {
          monthProfitArs -= profitArs;
        }

        tx.set(
          summaryRef,
          {
            availableUsd: availableUsd + movementUsd,
            monthProfitArs,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      } else if (type === "buy") {
        const lotId = movement.lotId;
        if (!lotId) {
          const err = new Error("LOT_NOT_FOUND");
          err.code = "LOT_NOT_FOUND";
          throw err;
        }

        const lotRef = db.collection("usdLots").doc(lotId);
        const lotSnap = await tx.get(lotRef);
        if (!lotSnap.exists) {
          const err = new Error("LOT_NOT_FOUND");
          err.code = "LOT_NOT_FOUND";
          throw err;
        }

        const lotData = lotSnap.data() || {};
        const remainingUsd = Number(lotData.remainingUsd || 0);
        if (remainingUsd !== movementUsd) {
          const err = new Error("LOT_ALREADY_USED");
          err.code = "LOT_ALREADY_USED";
          throw err;
        }

        tx.delete(lotRef);
        tx.set(
          summaryRef,
          {
            availableUsd: availableUsd - movementUsd,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      } else {
        const err = new Error("INVALID_TYPE");
        err.code = "INVALID_TYPE";
        throw err;
      }

      tx.set(
        movementRef,
        {
          voided: true,
          voidedAt: admin.firestore.FieldValue.serverTimestamp(),
          voidReason: reason || ""
        },
        { merge: true }
      );

      const reportMovementRef = db.collection("movements").doc();
      tx.set(
        reportMovementRef,
        buildMovementPayload({
          type: "usd_void",
          usd: {
            usd: movementUsd,
            price: Number(movement.price || 0),
            totalArs: Number(movement.totalArs || 0),
            profitArs: Number(movement.profitArs || movement.profitArsTotal || 0)
          },
          note: reason || "",
          occurredAt: movement.occurredAt || null,
          relatedId: movementRef.id,
          createdBy: req.user?.uid || null
        })
      );
    });

    return res.json({ ok: true });
  } catch (error) {
    if (error?.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Movimiento no encontrado." });
    }
    if (error?.code === "ALREADY_VOIDED") {
      return res.status(400).json({ ok: false, code: "ALREADY_VOIDED", message: "La operaci?n ya fue anulada." });
    }
    if (error?.code === "LOT_NOT_FOUND") {
      return res.status(404).json({ ok: false, code: "LOT_NOT_FOUND", message: "Lote no encontrado." });
    }
    if (error?.code === "LOT_ALREADY_USED") {
      return res.status(400).json({
        ok: false,
        code: "LOT_ALREADY_USED",
        message: "No se puede eliminar: la compra ya fue usada en ventas."
      });
    }
    if (error?.code === "INVALID_MOVEMENT") {
      return res.status(400).json({ ok: false, code: "INVALID_MOVEMENT", message: "Movimiento inválido." });
    }
    if (error?.code === "INVALID_TYPE") {
      return res.status(400).json({ ok: false, code: "INVALID_TYPE", message: "Tipo de movimiento inválido." });
    }
    return sendJsonError(res, 500, {
      code: "DELETE_MOVEMENT_FAILED",
      message: "No se pudo eliminar la operaci?n.",
      details: error.message || null
    });
  }
});

app.get("/dollars/trades", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const snap = await db.collection("usdMovements").orderBy("createdAt", "asc").get();
    const items = snap.docs
      .map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))
            .filter((item) => !item.voided && !item.deletedAt);
    items.sort((a, b) => {
      const dateA = toDateValue(a.createdAt) || toDateValue(a.occurredAt) || toDateValue(a.timestamp);
      const dateB = toDateValue(b.createdAt) || toDateValue(b.occurredAt) || toDateValue(b.timestamp);
      const timeA = dateA ? dateA.getTime() : 0;
      const timeB = dateB ? dateB.getTime() : 0;
      return timeB - timeA;
    });
    return res.json({ items });
  } catch (error) {
    return sendJsonError(res, 500, {
      code: "MOVEMENTS_FETCH_FAILED",
      message: "No se pudieron cargar las operaciones.",
      details: error.message || null
    });
  }
});

app.post("/dollars/buy", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const usdRaw = req.body.usd ?? req.body.amountUsd ?? req.body.cantidadUsd ?? req.body.quantity;
    const priceRaw =
      req.body.price ??
      req.body.buyPrice ??
      req.body.precioCompra ??
      req.body.precio ??
      req.body.precioARS;
    const usd = toNumberLoose(usdRaw);
    const price = toNumberLoose(priceRaw);
    const note = String(req.body.note || "").trim();
    const occurredAtValue = req.body.createdAt ? parseCreatedAt(req.body.createdAt, null) : null;
    const occurredAt =
      occurredAtValue && !Number.isNaN(occurredAtValue.getTime())
        ? occurredAtValue.toISOString().slice(0, 10)
        : null;

    const invalidFields = [];
    if (!Number.isFinite(usd) || usd <= 0) invalidFields.push("usd");
    if (!Number.isFinite(price) || price <= 0) invalidFields.push("price");

    if (invalidFields.length) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_INPUT",
        message: "Datos inválidos",
        invalid: invalidFields,
        received: req.body
      });
    }

    const lotRef = db.collection("usdLots").doc();
    const movementRef = db.collection("usdMovements").doc();
    const summaryRef = db.collection("usdSummary").doc("primary");

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let availableUsd = 0;
    await db.runTransaction(async (tx) => {
      const summarySnap = await tx.get(summaryRef);
      const summaryData = summarySnap.exists ? summarySnap.data() || {} : {};
      const current = Number(summaryData.availableUsd || 0);
      availableUsd = current + usd;
      const summaryMonthKey = summaryData.monthKey || currentMonthKey;
      const summaryMonthProfitArs = Number(summaryData.monthProfitArs || 0);

      tx.set(lotRef, {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        occurredAt,
        remainingUsd: usd,
        buyPrice: price,
        note: note || "",
        type: "buy"
      });

      tx.set(movementRef, {
        type: "buy",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        occurredAt,
        usd,
        price,
        totalArs: usd * price,
        note: note || "",
        lotId: lotRef.id,
        voided: false
      });

      const reportMovementRef = db.collection("movements").doc();
      tx.set(
        reportMovementRef,
        buildMovementPayload({
          type: "usd_buy",
          usd: {
            usd,
            price,
            totalArs: usd * price
          },
          note: note || "",
          occurredAt,
          relatedId: movementRef.id,
          createdBy: req.user?.uid || null
        })
      );

      tx.set(
        summaryRef,
        {
          availableUsd,
          monthKey: summaryMonthKey,
          monthProfitArs: summaryMonthProfitArs,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    return res.status(201).json({
      ok: true,
      availableUsd,
      movementId: movementRef.id,
      lotId: lotRef.id
    });
  } catch (error) {
    return sendJsonError(res, 500, {
      code: "BUY_FAILED",
      message: "No se pudo registrar la compra.",
      details: error.message || null
    });
  }
});

app.post("/dollars/sell", requireAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const usdRaw = req.body.usd ?? req.body.amountUsd ?? req.body.cantidadUsd ?? req.body.quantity;
    const priceRaw =
      req.body.price ??
      req.body.sellPrice ??
      req.body.precioVenta ??
      req.body.precio ??
      req.body.precioARS;
    const usd = toNumberLoose(usdRaw);
    const price = toNumberLoose(priceRaw);
    const note = String(req.body.note || "").trim();
    const occurredAtValue = req.body.createdAt ? parseCreatedAt(req.body.createdAt, null) : null;
    const occurredAt =
      occurredAtValue && !Number.isNaN(occurredAtValue.getTime())
        ? occurredAtValue.toISOString().slice(0, 10)
        : null;
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    console.log("[USD_SELL_INPUT]", {
      usd: describeValue(usdRaw),
      price: describeValue(priceRaw),
      note: describeValue(req.body.note),
      body: req.body
    });

    const invalidFields = [];
    if (!Number.isFinite(usd) || usd <= 0) invalidFields.push("usd");
    if (!Number.isFinite(price) || price <= 0) invalidFields.push("price");

    if (invalidFields.length) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_INPUT",
        message: "Datos inválidos",
        invalid: invalidFields,
        received: req.body
      });
    }

    const summaryRef = db.collection("usdSummary").doc("primary");
    const movementRef = db.collection("usdMovements").doc();
    const lotsBaseQuery = db.collection("usdLots");
    const lotsQuery = lotsBaseQuery.where("remainingUsd", ">", 0).orderBy("createdAt", "asc").limit(50);
    const fallbackLotsQuery = lotsBaseQuery.orderBy("createdAt", "asc").limit(50);

    let responsePayload = null;

    await db.runTransaction(async (tx) => {
      const summarySnap = await tx.get(summaryRef);
      const summaryData = summarySnap.exists ? summarySnap.data() || {} : {};
      const availableUsd = Number(summaryData.availableUsd || 0);
      if (availableUsd < usd) {
        const err = new Error("INSUFFICIENT_USD");
        err.code = "INSUFFICIENT_USD";
        err.availableUsd = availableUsd;
        err.requestedUsd = usd;
        throw err;
      }

      let remaining = usd;
      const fifoBreakdown = [];
      let profitArsTotal = 0;
      let lastDoc = null;
      let usedFallback = false;
      let exhausted = false;
      const lotUpdates = new Map();

      while (remaining > 0 && !exhausted) {
        let lotsSnap;
        try {
          lotsSnap = await tx.get(
            lastDoc ? lotsQuery.startAfter(lastDoc) : lotsQuery
          );
        } catch (error) {
          if (!isMissingIndexError(error)) {
            throw error;
          }
          usedFallback = true;
          lotsSnap = await tx.get(
            lastDoc ? fallbackLotsQuery.startAfter(lastDoc) : fallbackLotsQuery
          );
        }

        if (!usedFallback && lotsSnap.empty) {
          usedFallback = true;
          lotsSnap = await tx.get(
            lastDoc ? fallbackLotsQuery.startAfter(lastDoc) : fallbackLotsQuery
          );
        }

        if (lotsSnap.empty) {
          exhausted = true;
          break;
        }

        let lots = lotsSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ref: docSnap.ref,
          data: docSnap.data() || {}
        }));
        if (usedFallback) {
          lots = lots.filter((lot) => Number(lot.data.remainingUsd || 0) > 0);
        }

        for (const lot of lots) {
          if (remaining <= 0) break;
          const previousRemaining = lotUpdates.has(lot.id)
            ? lotUpdates.get(lot.id).remainingUsd
            : Number(lot.data.remainingUsd || 0);
          if (!Number.isFinite(previousRemaining) || previousRemaining <= 0) continue;
          const take = Math.min(previousRemaining, remaining);
          const newRemaining = previousRemaining - take;
          lotUpdates.set(lot.id, { ref: lot.ref, remainingUsd: newRemaining });

          const lotBuyPrice = Number(lot.data.buyPrice || 0);
          const profitArs = (price - lotBuyPrice) * take;
          profitArsTotal += profitArs;
          fifoBreakdown.push({
            lotId: lot.id,
            usd: take,
            buyPrice: lotBuyPrice,
            sellPrice: price,
            profitArs
          });
          remaining -= take;
        }

        lastDoc = lotsSnap.docs[lotsSnap.docs.length - 1];
      }

      if (remaining > 0) {
        const err = new Error("INSUFFICIENT_USD");
        err.code = "INSUFFICIENT_USD";
        err.availableUsd = usd - remaining;
        err.requestedUsd = usd;
        throw err;
      }

      for (const update of lotUpdates.values()) {
        tx.update(update.ref, { remainingUsd: update.remainingUsd });
      }

      const newAvailable = availableUsd - usd;
      let monthProfitArs = Number(summaryData.monthProfitArs || 0);
      const summaryMonthKey = summaryData.monthKey || null;
      if (summaryMonthKey !== currentMonthKey) {
        monthProfitArs = 0;
      }
      monthProfitArs += profitArsTotal;

      tx.set(movementRef, {
        type: "sell",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        occurredAt,
        usd,
        price,
        totalArs: usd * price,
        note: note || "",
        fifoBreakdown,
        profitArsTotal,
        profitArs: profitArsTotal,
        voided: false
      });

      const reportMovementRef = db.collection("movements").doc();
      tx.set(
        reportMovementRef,
        buildMovementPayload({
          type: "usd_sell",
          usd: {
            usd,
            price,
            totalArs: usd * price,
            profitArs: profitArsTotal
          },
          note: note || "",
          occurredAt,
          relatedId: movementRef.id,
          createdBy: req.user?.uid || null
        })
      );

      tx.set(
        summaryRef,
        {
          availableUsd: newAvailable,
          monthKey: currentMonthKey,
          monthProfitArs,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      responsePayload = {
        ok: true,
        availableUsd: newAvailable,
        movementId: movementRef.id,
        fifoBreakdown,
        profitArsTotal
      };
    });

    return res.status(201).json(responsePayload);
  } catch (error) {
    if (error?.code === "INSUFFICIENT_USD") {
      return sendJsonError(res, 400, {
        code: "INSUFFICIENT_USD",
        message: "No hay USD suficientes",
        details: {
          availableUsd: Number(error.availableUsd || 0),
          requestedUsd: Number(error.requestedUsd || 0)
        }
      });
    }
    return sendJsonError(res, 500, {
      code: "SELL_FAILED",
      message: "No se pudo registrar la venta.",
      details: error.message || null
    });
  }
});


async function requireStaff(context, allowedRoles) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Debes iniciar sesi?n.");
  }

  const uid = context.auth.uid;
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError("permission-denied", "Usuario no autorizado.");
  }

  const user = userSnap.data();
  if (!user.active) {
    throw new functions.https.HttpsError("permission-denied", "Usuario inactivo.");
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    throw new functions.https.HttpsError("permission-denied", "Rol insuficiente.");
  }

  return { uid, email: context.auth.token.email || null, role: user.role };
}

function requireFields(data, fields) {
  fields.forEach((field) => {
    if (data[field] === undefined || data[field] === null || data[field] === "") {
      throw new functions.https.HttpsError("invalid-argument", `${field} es requerido.`);
    }
  });
}

function addPeriod(date, frequency) {
  const next = toUtcDate(date);
  if (frequency === "weekly") {
    return addDaysUTC(next, 7);
  }
  if (frequency === "biweekly") {
    return addDaysUTC(next, 15);
  }
  if (frequency === "monthly") {
    return addMonthsKeepingDayUTC(next, 1);
  }
  return next;
}

exports.health = functions.https.onRequest((req, res) => {
  res.json({ ok: true });
});

exports.bootstrapAdmin = functions.region("us-central1").https.onCall(async (data) => {
  const isEmulator =
    process.env.FUNCTIONS_EMULATOR === "true" || !!process.env.FIREBASE_EMULATOR_HUB;
  if (!isEmulator) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "bootstrapAdmin solo est? habilitado en emuladores."
    );
  }

  requireFields(data, ["email", "password", "name"]);

  const userRecord = await admin.auth().createUser({
    email: String(data.email).trim(),
    password: String(data.password),
    displayName: String(data.name).trim()
  });

  await db.collection("users").doc(userRecord.uid).set({
    name: String(data.name).trim(),
    role: "admin",
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { uid: userRecord.uid, email: userRecord.email };
});

exports.createLoan = functions.https.onCall(async (data, context) => {
  const staff = await requireStaff(context, ["admin", "operator"]);
  requireFields(data, ["customerId", "principal", "rateValue", "rateBasePeriod", "termCount", "termPeriod"]);

  let computation;
  try {
    computation = computeTotalDue({
      principal: data.principal,
      rateValue: data.rateValue,
      rateBasePeriod: data.rateBasePeriod,
      manualRatePeriod: data.manualRatePeriod,
      termCount: data.termCount,
      termPeriod: data.termPeriod
    });
  } catch (error) {
    throw new functions.https.HttpsError("invalid-argument", error.message);
  }

  const loanRef = db.collection("loans").doc();
  const totalDue = computation.totalDue;
  const now = new Date();
  const frequency = data.frequency || data.termPeriod;
  let startDate = now;
  if (data.startDate) {
    const startDateString = String(data.startDate).trim();
    const parsedStartDate = parseISODateUTC(startDateString);
    if (!parsedStartDate) {
      throw new functions.https.HttpsError("invalid-argument", "Fecha de inicio invalida.");
    }
    startDate = parsedStartDate;
  }
  const nextDueAt = addPeriod(startDate, frequency);
  const nextDueDate = formatDateOnly(nextDueAt);
  const installments = buildInstallmentsForLoan({
    termCount: Number(data.termCount),
    totalDue,
    termPeriod: data.termPeriod,
    frequency,
    startDate,
    createdAt: startDate
  });
  const payload = {
    customerId: data.customerId,
    principal: Number(data.principal),
    rateValue: Number(data.rateValue),
    rateBasePeriod: data.rateBasePeriod,
    manualRatePeriod: data.rateBasePeriod === "manual" ? data.manualRatePeriod : null,
    termCount: Number(data.termCount),
    termPeriod: data.termPeriod,
    frequency,
    nextDueAt: admin.firestore.Timestamp.fromDate(nextDueAt),
    nextDueDate,
    startDate: formatDateOnly(startDate),
    ratePerTerm: computation.ratePerTerm,
    totalDue,
    totalCapital: Number(data.principal),
    totalInterest: Math.max(totalDue - Number(data.principal), 0),
    paidTotal: 0,
    balance: totalDue,
    capitalPending: totalDue,
    paidCapital: 0,
    paidInterest: 0,
    interestEarnedMineTotal: 0,
    interestEarnedIntermediaryTotal: 0,
    endDate: null,
    installments: installments || [],
    status: "active",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: staff.uid,
    createdByUid: staff.uid,
    createdByEmail: staff.email || null
  };

  await loanRef.set(payload);
  const treasurySummaryRef = db.collection("treasurySummary").doc("primary");
  await treasurySummaryRef.set(
    {
      totalDisbursedArs: admin.firestore.FieldValue.increment(Number(payload.principal || 0)),
      totalLoanOutstandingArs: admin.firestore.FieldValue.increment(Number(payload.capitalPending || 0)),
      liquidArs: admin.firestore.FieldValue.increment(-Number(payload.principal || 0)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  await logAudit(db, {
    action: "loan.create",
    actorId: staff.uid,
    actorEmail: staff.email,
    targetType: "loan",
    targetId: loanRef.id,
    metadata: {
      customerId: data.customerId,
      principal: payload.principal,
      totalDue
    }
  });

  return { loanId: loanRef.id, totalDue };
});

exports.addPayment = functions.https.onCall(async (data, context) => {
  const staff = await requireStaff(context, ["admin", "operator"]);
  requireFields(data, ["loanId", "amount"]);

  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "Monto inválido.");
  }

  const paidAt = data.paidAt ? parsePaidAtInput(data.paidAt) : null;
  if (data.paidAt && !paidAt) {
    throw new functions.https.HttpsError("invalid-argument", "Fecha de pago invalida.");
  }

  const result = await registerInstallmentPayment({
    loanId: data.loanId,
    installmentNumber: data.installmentNumber,
    amount,
    paidAt,
    method: data.method,
    note: data.note,
    createdBy: staff.uid
  });

  await logAudit(db, {
    action: "payment.add",
    actorId: staff.uid,
    actorEmail: staff.email,
    targetType: "payment",
    targetId: result.paymentId,
    metadata: {
      loanId: data.loanId,
      amount
    }
  });

  return result;
});

exports.telegramDailyDue = functions
  .runWith({ secrets: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_DEBUG_SECRET"] })
  .pubsub.schedule("0 9 * * *")
  .timeZone("America/Argentina/Buenos_Aires")
  .onRun(async () => {
    await runTelegramDaily({ db, admin, helpers: getTelegramHelpers() });
    return null;
  });

exports.onCustomerCreate = functions.firestore
  .document("customers/{customerId}")
  .onCreate(async (snap, context) => {
    const data = snap.data() || {};
    await logAudit(db, {
      action: "customer.create",
      actorId: data.createdBy || null,
      actorEmail: data.createdByEmail || null,
      targetType: "customer",
      targetId: context.params.customerId,
      metadata: {
        name: data.name || null,
        dni: data.dni || null
      }
    });
  });















async function handlePaymentsList(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const term = normalizeText(req.query.q || "");
    const loanId = String(req.query.loanId || "").trim();
    const customerId = String(req.query.customerId || "").trim();
    const includeVoided = String(req.query.includeVoided || "0").trim() === "1";
    const fromRaw = String(req.query.from || "").trim();
    const toRaw = String(req.query.to || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);
    const cursor = Number(req.query.cursor || 0);

    let query = db.collection("payments");
    if (loanId) query = query.where("loanId", "==", loanId);
    if (customerId) query = query.where("customerId", "==", customerId);

    const snap = await query.get();
    let items = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

    if (!includeVoided) {
      items = items.filter((item) => !item.voided && !item.isVoided);
    }

    const fromDate = fromRaw ? parsePaidAtInput(fromRaw) : null;
    let toDate = toRaw ? parsePaidAtInput(toRaw) : null;
    if (toDate) {
      toDate = new Date(toDate);
      toDate.setHours(23, 59, 59, 999);
    }

    if (term) {
      items = items.filter((item) => {
        const name = String(item.customerName || "").toLowerCase();
        const dni = String(item.customerDni || item.dni || item.dniCliente || "").toLowerCase();
        const note = String(item.note || "").toLowerCase();
        return name.includes(term) || dni.includes(term) || note.includes(term);
      });
    }

    if (fromDate || toDate) {
      items = items.filter((item) => {
        const paidAt = toDateValue(item.paidAt) || toDateValue(item.paymentDate) || toDateValue(item.createdAt);
        if (!paidAt) return false;
        if (fromDate && paidAt < fromDate) return false;
        if (toDate && paidAt > toDate) return false;
        return true;
      });
    }

    items.sort((a, b) => {
      const dateA = toDateValue(a.paidAt) || toDateValue(a.paymentDate) || toDateValue(a.createdAt);
      const dateB = toDateValue(b.paidAt) || toDateValue(b.paymentDate) || toDateValue(b.createdAt);
      const timeA = dateA ? dateA.getTime() : 0;
      const timeB = dateB ? dateB.getTime() : 0;
      return timeB - timeA;
    });

    if (cursor > 0) {
      items = items.filter((item) => {
        const dateValue = toDateValue(item.paidAt) || toDateValue(item.paymentDate) || toDateValue(item.createdAt);
        const timeValue = dateValue ? dateValue.getTime() : 0;
        return timeValue < cursor;
      });
    }

    const page = items.slice(0, limit);
    const last = page[page.length - 1];
    const lastDate = last
      ? toDateValue(last.paidAt) || toDateValue(last.paymentDate) || toDateValue(last.createdAt)
      : null;
    const nextCursor = page.length === limit && lastDate ? lastDate.getTime() : null;

    return res.json({
      items: page.map((item) => {
        const paidAtDate =
          toDateValue(item.paidAt) || toDateValue(item.paymentDate) || toDateValue(item.createdAt);
        return {
          id: item.id,
          paymentDate: paidAtDate ? paidAtDate.toISOString().slice(0, 10) : null,
          customer: {
            name: item.customerName || null,
            dni: item.customerDni || item.dni || item.dniCliente || null
          },
          loanId: item.loanId || null,
          installmentNumber: toNumber(item.installmentNumber),
          amount: Number(item.amountPaid ?? item.amount ?? 0),
          method: item.method || null,
          note: item.note || "",
          actorEmail: item.createdByEmail || item.actorEmail || "unknown",
          isVoided: Boolean(item.isVoided || item.voided),
          voidedAt: item.voidedAt ? formatDateTime(item.voidedAt) : null
        };
      }),
      nextCursor
    });
  } catch (error) {
    console.error("[PAYMENTS_LIST]", error);
    return res.status(500).json({ message: "No se pudieron cargar los pagos." });
  }
}

async function voidPaymentWithSideEffects({ paymentId, reason, actor }) {
  const paymentRef = db.collection("payments").doc(paymentId);
  await db.runTransaction(async (tx) => {
    const paymentSnap = await tx.get(paymentRef);
    if (!paymentSnap.exists) {
      const error = new Error("Pago no encontrado.");
      error.status = 404;
      error.code = "NOT_FOUND";
      throw error;
    }
    const payment = paymentSnap.data() || {};
    if (payment.voided || payment.isVoided) {
      const error = new Error("El pago ya estaba anulado.");
      error.status = 400;
      error.code = "ALREADY_VOIDED";
      throw error;
    }
    const loanId = payment.loanId;
    if (!loanId) {
      const error = new Error("Pago sin referencia de Préstamo.");
      error.status = 400;
      error.code = "LOAN_REQUIRED";
      throw error;
    }

    const loanRef = db.collection("loans").doc(loanId);
    const loanSnap = await tx.get(loanRef);
    if (!loanSnap.exists) {
      const error = new Error("Préstamo no encontrado.");
      error.status = 404;
      error.code = "NOT_FOUND";
      throw error;
    }

    const loan = loanSnap.data() || {};
    const loanType = normalizeLoanType(loan.loanType);
    const amountBase = roundMoney(
      Number(payment.amount || 0) ||
        Number(payment.interestPaid || 0) + Number(payment.principalPaid || 0)
    );
    const nextPaidTotal = roundMoney(Math.max(toNumber(loan.paidTotal) - amountBase, 0));
    const loanUpdates = {
      paidTotal: nextPaidTotal,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (loanType === "americano") {
      const principalPaid = roundMoney(Number(payment.principalPaid || 0));
      const currentOutstanding = getLoanOutstanding(loan);
      const principalOriginal = roundMoney(
        toNumber(loan.principalOriginal || loan.principal || currentOutstanding)
      );
      const principalCap =
        principalOriginal > 0 ? principalOriginal : roundMoney(currentOutstanding + principalPaid);
      const nextOutstanding = roundMoney(
        Math.min(Math.max(currentOutstanding + principalPaid, 0), principalCap)
      );
      loanUpdates.principalOutstanding = nextOutstanding;
      loanUpdates.balance = nextOutstanding;
      loanUpdates.status = nextOutstanding <= 0 ? "finished" : "active";
      loanUpdates.capitalPending = nextOutstanding;
      loanUpdates.endDate = loanUpdates.status === "finished" ? loan.endDate || null : null;
    } else {
      const totalDue = roundMoney(toNumber(loan.totalDue));
      const { installments } = ensureLoanInstallments(loan);
      let updatedInstallments = installments ? [...installments] : null;
      const installmentNumber = toNumber(payment.installmentNumber);
      if (updatedInstallments && installmentNumber > 0) {
        const idx = updatedInstallments.findIndex(
          (item) => toNumber(item.number) === installmentNumber
        );
        if (idx >= 0) {
          const prevPaid = roundMoney(toNumber(updatedInstallments[idx].paidTotal));
          updatedInstallments[idx] = {
            ...updatedInstallments[idx],
            paidTotal: roundMoney(Math.max(prevPaid - amountBase, 0))
          };
        }
      }

      const balance = roundMoney(Math.max(totalDue - nextPaidTotal, 0));
      const allPaid = updatedInstallments
        ? updatedInstallments.every(
            (item) => roundMoney(toNumber(item.amount) - toNumber(item.paidTotal)) <= 0
          )
        : nextPaidTotal >= totalDue;
      const nextDueDateValue = computeNextDueDateFromInstallments(updatedInstallments);
      loanUpdates.balance = balance;
      loanUpdates.capitalPending = balance;
      loanUpdates.status = allPaid || balance <= 0 ? "finished" : "active";
      loanUpdates.nextDueDate = nextDueDateValue ? formatDateOnly(nextDueDateValue) : null;
      loanUpdates.nextDueAt = nextDueDateValue
        ? admin.firestore.Timestamp.fromDate(nextDueDateValue)
        : null;
      loanUpdates.endDate = loanUpdates.status === "finished" ? loan.endDate || null : null;
      if (updatedInstallments) {
        loanUpdates.installments = updatedInstallments;
      }
    }

    const paidAtDate = toDateValue(payment.paidAt) || toDateValue(payment.createdAt);
    const paidMonth = payment.paidMonth || formatMonthKey(paidAtDate);
    const interestTotal = Number((payment.interestTotal ?? payment.interestPaid) || 0);
    const interestMine =
      payment.interestMine != null
        ? Number(payment.interestMine || 0)
        : computeInterestSplit(loan, interestTotal).interestMine;
    const interestIntermediary =
      payment.interestIntermediary != null
        ? Number(payment.interestIntermediary || 0)
        : Math.max(interestTotal - interestMine, 0);
    const amountPaid = Number(
      payment.amountPaid != null
        ? payment.amountPaid
        : roundMoney(Number(payment.principalPaid || 0) + interestTotal)
    );
    const walletUid = payment.createdByUid || payment.createdBy || "unknown";
    const walletEmail = normalizeEmailValue(payment.createdByEmail || "Sin asignar");
    const wallet = await getWalletData(tx, walletUid, walletEmail);
    const nextBalance = roundMoney(wallet.balance - amountPaid);
    const principalPaidValue = Number(payment.principalPaid || 0);
    loanUpdates.paidCapital = admin.firestore.FieldValue.increment(-principalPaidValue);
    loanUpdates.paidInterest = admin.firestore.FieldValue.increment(-interestTotal);
    loanUpdates.interestEarnedMineTotal = admin.firestore.FieldValue.increment(-interestMine);
    loanUpdates.interestEarnedIntermediaryTotal =
      admin.firestore.FieldValue.increment(-interestIntermediary);

    const voidPayload = {
      voided: true,
      isVoided: true,
      voidedAt: admin.firestore.FieldValue.serverTimestamp(),
      voidReason: reason || "",
      voidedBy: actor?.uid || null,
      voidedByEmail: actor?.email || null
    };

    tx.update(paymentRef, voidPayload);
    tx.set(loanRef.collection("payments").doc(paymentRef.id), voidPayload, { merge: true });
    tx.update(loanRef, loanUpdates);

    const treasurySummaryRef = db.collection("treasurySummary").doc("primary");
    tx.set(
      treasurySummaryRef,
      {
        totalCollectedArs: admin.firestore.FieldValue.increment(-amountPaid),
        totalLoanOutstandingArs: admin.firestore.FieldValue.increment(principalPaidValue),
        liquidArs: admin.firestore.FieldValue.increment(-amountPaid),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    const treasuryUserRef = db
      .collection("treasuryUsers")
      .doc(payment.createdByUid || payment.createdBy || "unknown");
    tx.set(
      treasuryUserRef,
      {
        email: payment.createdByEmail || "Sin asignar",
        paymentsCount: admin.firestore.FieldValue.increment(-1),
        collectedArs: admin.firestore.FieldValue.increment(-amountPaid),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    const ledgerRef = db.collection("ledger").doc();
    tx.set(
      ledgerRef,
      buildLedgerPayload({
        type: "adjustment",
        amountARS: -amountPaid,
        interestARS: -interestTotal,
        principalARS: -principalPaidValue,
        interestMineARS: -interestMine,
        interestIntermediaryARS: -interestIntermediary,
        date: paidAtDate,
        createdByUid: payment.createdByUid || payment.createdBy || null,
        createdByEmail: payment.createdByEmail || null,
        loanId: loanRef.id,
        customerDni: loan.customerDni || loan.dni || loan.dniCliente || null,
        note: `Anulación pago ${paymentRef.id}`,
        source: "void"
      })
    );

    if (paidMonth) {
      const profitRef = db.collection("profitMonthly").doc(paidMonth);
      tx.set(
        profitRef,
        {
          month: paidMonth,
          mineArs: admin.firestore.FieldValue.increment(-interestMine),
          intermediaryArs: admin.firestore.FieldValue.increment(-interestIntermediary),
          interestTotalArs: admin.firestore.FieldValue.increment(-interestTotal),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }
    tx.set(
      wallet.walletRef,
      {
        uid: wallet.walletUid,
        email: wallet.email,
        balance: nextBalance,
        balanceArs: nextBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    const walletMovementRef = db.collection("wallet_movements").doc();
    tx.set(walletMovementRef, {
      type: "PAYMENT_VOID",
      amount: -amountPaid,
      fromUid: wallet.walletUid,
      createdByUid: actor?.uid || null,
      createdByEmail: actor?.email || wallet.email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      meta: {
        loanId: loanRef.id,
        paymentId: paymentRef.id
      }
    });

    const movementRef = db.collection("movements").doc();
    tx.set(
      movementRef,
      buildMovementPayload({
        type: "payment_void",
        customer: {
          id: loan.customerId || null,
          dni: loan.customerDni || loan.dni || loan.dniCliente || null,
          name: loan.customerName || null
        },
        loan: {
          id: loanRef.id,
          loanType: normalizeLoanType(loan.loanType),
          status: normalizeLoanStatus(loanUpdates.status || loan.status) || "active"
        },
        payment: {
          id: paymentRef.id,
          amount: Number(payment.amount || 0),
          interestTotal: Number((payment.interestTotal ?? payment.interestPaid) || 0),
          interestMine: Number((payment.interestMine ?? payment.interestPaid) || 0),
          interestIntermediary: Number(payment.interestIntermediary || 0),
          principalPaid: Number(payment.principalPaid || 0),
          paidAt: formatDateOnly(payment.paidAt),
          method: payment.method || null,
          note: payment.note || null
        },
        note: reason || "",
        relatedId: paymentRef.id,
        createdBy: actor?.uid || null
      })
    );
  });
}

app.get("/payments", requireAuth, handlePaymentsList);
app.post("/payments/:paymentId/void", requireAuth, async (req, res) => {
  try {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return;
    const paymentId = String(req.params.paymentId || "").trim();
    const reason = String(req.body?.reason || "").trim();
    if (!paymentId) {
      return sendJsonError(res, 400, { code: "INVALID_INPUT", message: "paymentId requerido." });
    }
    await voidPaymentWithSideEffects({ paymentId, reason, actor: req.user });
    return res.json({ ok: true });
  } catch (error) {
    console.error("[PAYMENT_VOID_FAILED]", error);
    const status = error.status || 500;
    if (status !== 500) {
      return sendJsonError(res, status, {
        code: error.code || "PAYMENT_VOID_FAILED",
        message: error.message || "No se pudo anular el pago."
      });
    }
    return res.status(500).json({ ok: false, message: "No se pudo anular el pago." });
  }
});


























