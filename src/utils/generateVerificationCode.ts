export function generateVerificationCode(length = 6): string {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  // random uint32
  const rv = crypto.getRandomValues(new Uint32Array(1))[0];
  const range = max - min + 1;
  const val = min + (rv % range);
  return String(val).padStart(length, "0");
}