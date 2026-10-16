import { generateKeyPairSync, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stdout } from "node:process";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(appRoot, ".dev.vars");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
const publicJwk = publicKey.export({ format: "jwk" });
const kid = `ccv2-local-${randomBytes(8).toString("hex")}`;
const runSigningKey = randomBytes(48).toString("base64url");
const lines = [
  'ALLOWED_ORIGINS="https://commercekit.tools,http://localhost:3000"',
  'MOCK_JWT_ISSUER="http://localhost:8787"',
  `MOCK_JWT_PRIVATE_KEY=${JSON.stringify(privatePem)}`,
  `MOCK_JWT_PUBLIC_JWK='${JSON.stringify(publicJwk)}'`,
  `MOCK_JWT_KID=${JSON.stringify(kid)}`,
  `RUN_TOKEN_SIGNING_KEY=${JSON.stringify(runSigningKey)}`,
  "",
];

try {
  await writeFile(destination, lines.join("\n"), { encoding: "utf8", mode: 0o600, flag: "wx" });
  stdout.write(`Created ${destination} with local-only signing material.\n`);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
    throw new Error(
      `${destination} already exists; remove it explicitly before rotating local keys.`,
      { cause: error },
    );
  }
  throw error;
}
