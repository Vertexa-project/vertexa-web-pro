// WP-ASAAS-05E1D-B — canonical Asaas datetime parser.
//
// Contract (not a runtime-TZ guess):
//   PIX_AUTOMATIC_POLICY.timezone = America/Sao_Paulo (existing Vertexa policy).
//   Asaas docs emit naive datetimes (`YYYY-MM-DD HH:mm:ss`, webhook `dateCreated` the same).
//   Sandbox CREATE 2026-09-18T14:49:53Z + expirationSeconds 3600 ≈ 15:49:53Z.
//   Naive `2026-09-18 12:49:52` as America/Sao_Paulo = 2026-09-18T15:49:52Z.
//   REFUSED webhook received 2026-09-18T15:50:05Z — matches that TTL.
//
// Naive strings are interpreted in America/Sao_Paulo via Intl (DST-aware).
// They must NOT use Date.parse (that follows the host timezone).
// ISO strings with Z or an explicit offset keep that offset.
// Invalid / unparseable input → null. Never invent a valid instant.

export const ASAAS_PROVIDER_TIMEZONE = "America/Sao_Paulo";

const ISO_WITH_OFFSET =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i;
const NAIVE_YMD = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;
const NAIVE_BR = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/;

function asTrimmedString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toInt(raw) {
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function isCivilDateTime(year, month, day, hour, minute, second) {
  if (![year, month, day, hour, minute, second].every((n) => Number.isInteger(n))) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return false;
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day &&
    utc.getUTCHours() === hour &&
    utc.getUTCMinutes() === minute &&
    utc.getUTCSeconds() === second
  );
}

function wallClockAt(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const bag = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

function naiveInZoneToUtcMs(year, month, day, hour, minute, second, timeZone) {
  if (!isCivilDateTime(year, month, day, hour, minute, second)) return null;
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const wallAtGuess = wallClockAt(asIfUtc, timeZone);
  const offsetGuess =
    Date.UTC(
      wallAtGuess.year,
      wallAtGuess.month - 1,
      wallAtGuess.day,
      wallAtGuess.hour,
      wallAtGuess.minute,
      wallAtGuess.second,
    ) - asIfUtc;
  const adjusted = asIfUtc - offsetGuess;
  const wall = wallClockAt(adjusted, timeZone);
  if (
    wall.year !== year ||
    wall.month !== month ||
    wall.day !== day ||
    wall.hour !== hour ||
    wall.minute !== minute ||
    wall.second !== second
  ) {
    return null;
  }
  return adjusted;
}

function parseNaiveComponents(text) {
  const ymd = NAIVE_YMD.exec(text);
  if (ymd) {
    return {
      year: toInt(ymd[1]),
      month: toInt(ymd[2]),
      day: toInt(ymd[3]),
      hour: toInt(ymd[4]),
      minute: toInt(ymd[5]),
      second: toInt(ymd[6]),
    };
  }
  const br = NAIVE_BR.exec(text);
  if (br) {
    return {
      day: toInt(br[1]),
      month: toInt(br[2]),
      year: toInt(br[3]),
      hour: toInt(br[4]),
      minute: toInt(br[5]),
      second: toInt(br[6]),
    };
  }
  return null;
}

/**
 * @param {unknown} raw
 * @returns {string | null} UTC ISO-8601 instant, or null if invalid
 */
export function parseAsaasDateTime(raw) {
  const text = asTrimmedString(raw);
  if (!text) return null;

  if (ISO_WITH_OFFSET.test(text)) {
    const iso = text.includes("T") ? text : text.replace(" ", "T");
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return null;
    return new Date(ms).toISOString();
  }

  const parts = parseNaiveComponents(text);
  if (!parts) return null;
  const ms = naiveInZoneToUtcMs(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    ASAAS_PROVIDER_TIMEZONE,
  );
  if (ms === null) return null;
  return new Date(ms).toISOString();
}
