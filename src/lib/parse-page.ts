export function parsePage(raw: string | undefined): number {
  return Math.max(1, Math.floor(Number(raw)) || 1);
}
