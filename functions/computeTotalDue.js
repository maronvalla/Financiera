const PERIODS = ["monthly", "weekly", "biweekly"];

function isValidPeriod(value) {
  return PERIODS.includes(value);
}

function toNumber(value, fieldName) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid number for ${fieldName}`);
  }
  return num;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function toMonthlyRate(rateValue, fromPeriod) {
  if (fromPeriod === "monthly") return rateValue;
  if (fromPeriod === "weekly") return rateValue * 4;
  if (fromPeriod === "biweekly") return rateValue * 2;
  throw new Error("Invalid rate period");
}

function fromMonthlyRate(rateValue, toPeriod) {
  if (toPeriod === "monthly") return rateValue;
  if (toPeriod === "weekly") return rateValue / 4;
  if (toPeriod === "biweekly") return rateValue / 2;
  throw new Error("Invalid term period");
}

function convertRate(rateValue, fromPeriod, toPeriod) {
  if (fromPeriod === toPeriod) return rateValue;
  const monthly = toMonthlyRate(rateValue, fromPeriod);
  return fromMonthlyRate(monthly, toPeriod);
}

function computeTotalDue(input) {
  const principal = toNumber(input.principal, "principal");
  const rateValue = toNumber(input.rateValue, "rateValue");
  const termCount = toNumber(input.termCount, "termCount");
  const termPeriod = input.termPeriod;
  const rateBasePeriod = input.rateBasePeriod;

  if (principal <= 0) throw new Error("principal must be > 0");
  if (rateValue < 0) throw new Error("rateValue must be >= 0");
  if (termCount <= 0) throw new Error("termCount must be > 0");
  if (!isValidPeriod(termPeriod)) throw new Error("Invalid termPeriod");

  let ratePerTerm;
  if (rateBasePeriod === "manual") {
    const manualPeriod = input.manualRatePeriod;
    if (!isValidPeriod(manualPeriod)) {
      throw new Error("manualRatePeriod required");
    }
    ratePerTerm = convertRate(rateValue, manualPeriod, termPeriod);
  } else {
    if (!isValidPeriod(rateBasePeriod)) {
      throw new Error("Invalid rateBasePeriod");
    }
    ratePerTerm = convertRate(rateValue, rateBasePeriod, termPeriod);
  }

  const totalDue = principal * (1 + (ratePerTerm / 100) * termCount);
  return {
    totalDue: roundMoney(totalDue),
    ratePerTerm: roundMoney(ratePerTerm)
  };
}

module.exports = {
  computeTotalDue,
  roundMoney
};
