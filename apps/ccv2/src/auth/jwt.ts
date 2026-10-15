import { SignJWT, importJWK, importPKCS8, jwtVerify, type JWTPayload, type JWK } from "jose";

const TOKEN_LIFETIME_SECONDS = 3_600;

interface AccessTokenPayload extends JWTPayload {
  run_id: string;
}

export async function issueAccessToken(
  env: CloudflareBindings,
  runId: string,
  resource: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const key = await importPKCS8(env.MOCK_JWT_PRIVATE_KEY, "RS256");
  const now = Math.floor(Date.now() / 1_000);
  const accessToken = await new SignJWT({ run_id: runId })
    .setProtectedHeader({ alg: "RS256", kid: env.MOCK_JWT_KID, typ: "JWT" })
    .setIssuer(env.MOCK_JWT_ISSUER)
    .setAudience(resource)
    .setSubject(runId)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_LIFETIME_SECONDS)
    .setJti(crypto.randomUUID())
    .sign(key);

  return { accessToken, expiresIn: TOKEN_LIFETIME_SECONDS };
}

export async function verifyAccessToken(
  env: CloudflareBindings,
  token: string,
): Promise<AccessTokenPayload> {
  const jwk = parsePublicJwk(env.MOCK_JWT_PUBLIC_JWK);
  const key = await importJWK(jwk, "RS256");
  const result = await jwtVerify(token, key, {
    issuer: env.MOCK_JWT_ISSUER,
    algorithms: ["RS256"],
  });
  if (result.protectedHeader.kid !== env.MOCK_JWT_KID) {
    throw new Error("The JWT key identifier is not recognized");
  }
  const payload = result.payload;
  if (typeof payload.run_id !== "string" || typeof payload.aud !== "string") {
    throw new Error("The JWT does not contain the required run claims");
  }
  if (payload.sub !== payload.run_id || payload.aud !== `urn:commercekit:ccv2:${payload.run_id}`) {
    throw new Error("The JWT run claims are inconsistent");
  }
  return payload as AccessTokenPayload;
}

export function parsePublicJwk(value: string): JWK {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MOCK_JWT_PUBLIC_JWK must contain one JSON Web Key");
  }
  const jwk = parsed as JWK;
  if (jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") {
    throw new Error("MOCK_JWT_PUBLIC_JWK must be an RSA public key");
  }
  return jwk;
}

export function publicJwks(env: CloudflareBindings): { keys: JWK[] } {
  return {
    keys: [
      {
        ...parsePublicJwk(env.MOCK_JWT_PUBLIC_JWK),
        kid: env.MOCK_JWT_KID,
        alg: "RS256",
        use: "sig",
      },
    ],
  };
}
