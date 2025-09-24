export function generateToken(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
