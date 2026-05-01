/**
 * Returns a local calendar date key in YYYY-MM-DD format.
 *
 * This app treats meal and chart day boundaries as local calendar days.
 */
export function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

function formatOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  return `${sign}${pad2(hours)}:${pad2(minutes)}`;
}

/**
 * Returns an ISO 8601 timestamp using local date/time components and the
 * device's timezone offset.
 */
export function toLocalISOString(date: Date): string {
  return (
    date.getFullYear() +
    "-" +
    pad2(date.getMonth() + 1) +
    "-" +
    pad2(date.getDate()) +
    "T" +
    pad2(date.getHours()) +
    ":" +
    pad2(date.getMinutes()) +
    ":" +
    pad2(date.getSeconds()) +
    "." +
    pad3(date.getMilliseconds()) +
    formatOffset(date)
  );
}

/** Parses app timestamps that include an explicit timezone offset. */
export function parseAppDate(value: string): Date {
  return new Date(value);
}
