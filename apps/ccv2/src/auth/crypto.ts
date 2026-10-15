const encoder = new TextEncoder();

export function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomSecret(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function secretVerifier(
  signingKey: string,
  purpose: "control" | "client",
  runId: string,
  secret: string,
): Promise<string> {
  if (encoder.encode(signingKey).byteLength < 32) {
    throw new Error("RUN_TOKEN_SIGNING_KEY must contain at least 32 bytes");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${purpose}\0${runId}\0${secret}`),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function timingSafeTextEqual(first: string, second: string): boolean {
  const firstBytes = encoder.encode(first);
  const secondBytes = encoder.encode(second);
  if (firstBytes.byteLength !== secondBytes.byteLength) return false;
  return crypto.subtle.timingSafeEqual(firstBytes, secondBytes);
}
