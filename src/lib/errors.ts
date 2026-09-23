export class AppError extends Error {
  constructor(public code: string, message: string, public details?: unknown, public status = 400) {
    super(message);
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new AppError("ENV_MISSING", `Missing env var ${name}`, undefined, 500);
  return v;
}
