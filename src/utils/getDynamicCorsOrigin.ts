export function getDynamicCorsOrigin(origin: string | null, env: Env): string {
  const allowedOrigins = [
    "https://avantenutri.vercel.app",
    "http://localhost:5173",
  ];

  if (origin && allowedOrigins.includes(origin)) {
    return origin;
  }

  // Se não for reconhecido, bloqueia
  return "null";
}
