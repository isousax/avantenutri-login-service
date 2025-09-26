export function ensureRequestId(request: Request): string {
  const existing = request.headers.get('x-request-id');
  if (existing && existing.trim().length >= 6) return existing;
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `req_${time}_${rand}`;
}
