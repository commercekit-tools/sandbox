import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { generateKeyPairSync } from "node:crypto";
import { defineConfig } from "vitest/config";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const testPrivateKey = privateKey.export({ format: "pem", type: "pkcs8" });
const testPublicJwk = JSON.stringify(publicKey.export({ format: "jwk" }));
process.env.MOCK_JWT_PRIVATE_KEY = testPrivateKey;
process.env.MOCK_JWT_PUBLIC_JWK = testPublicJwk;
process.env.MOCK_JWT_KID = "ccv2-test-key";
process.env.RUN_TOKEN_SIGNING_KEY = "test-only-run-token-signing-key-with-32-bytes-minimum";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        bindings: {
          MOCK_JWT_PRIVATE_KEY: testPrivateKey,
          MOCK_JWT_PUBLIC_JWK: testPublicJwk,
          MOCK_JWT_KID: "ccv2-test-key",
          RUN_TOKEN_SIGNING_KEY: "test-only-run-token-signing-key-with-32-bytes-minimum",
        },
      },
    }),
  ],
});
