export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}

export function formatDuration(milliseconds: number | null): string {
  if (milliseconds == null) return "—";
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Recently";
  const seconds = Math.round((date.valueOf() - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  const absoluteSeconds = Math.abs(seconds);
  if (absoluteSeconds < 60) return formatter.format(seconds, "second");
  if (absoluteSeconds < 3_600) return formatter.format(Math.round(seconds / 60), "minute");
  if (absoluteSeconds < 86_400) return formatter.format(Math.round(seconds / 3_600), "hour");
  return formatter.format(Math.round(seconds / 86_400), "day");
}

export function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}
