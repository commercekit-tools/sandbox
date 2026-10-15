import { generateKeyPairSync, randomBytes } from "node:crypto";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process, { stderr, stdout } from "node:process";

const destination = process.argv.slice(2).find((argument) => argument !== "--");
if (!destination) {
  stderr.write("Usage: node scripts/generate-signing-material.js <secure-output-directory>\n");
  process.exitCode = 2;
} else {
  const directory = path.resolve(destination);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const files = {
    privateKey: path.join(directory, "mock-jwt-private.pem"),
    publicJwk: path.join(directory, "mock-jwt-public.jwk"),
    kid: path.join(directory, "mock-jwt-kid.txt"),
    runKey: path.join(directory, "run-token-signing-key.txt"),
  };
  for (const file of Object.values(files)) {
    try {
      await access(file);
      throw new Error(
        `${file} already exists; use an empty directory to avoid accidental rotation.`,
      );
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const values = [
    [files.privateKey, privateKey.export({ format: "pem", type: "pkcs8" })],
    [files.publicJwk, JSON.stringify(publicKey.export({ format: "jwk" }))],
    [files.kid, `ccv2-${randomBytes(16).toString("hex")}`],
    [files.runKey, randomBytes(64).toString("base64url")],
  ];
  await Promise.all(
    values.map(([file, value]) =>
      writeFile(file, `${String(value).trim()}\n`, { mode: 0o600, flag: "wx" }),
    ),
  );
  stdout.write(`Created four signing files in ${directory}; their contents were not printed.\n`);
}
