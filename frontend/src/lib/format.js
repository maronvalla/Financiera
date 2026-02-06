export function sanitizeDni(value) {
  return String(value || "").replace(/\D+/g, "");
}

export function formatName(value) {
  const raw = String(value || "");
  const hasTrailingSpace = /\s$/.test(raw);
  const words = raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const first = word.charAt(0).toUpperCase();
      const rest = word.slice(1).toLowerCase();
      return `${first}${rest}`;
    });
  if (!words.length) return hasTrailingSpace ? " " : "";
  return `${words.join(" ")}${hasTrailingSpace ? " " : ""}`;
}

export function validateDni(value) {
  return /^\d{7,9}$/.test(String(value || "").trim());
}

export function validateName(value) {
  const cleaned = String(value || "").trim();
  if (cleaned.length < 2) return false;
  return /^[\p{L}]+(?:[ '\u2019][\p{L}]+)*$/u.test(cleaned);
}
