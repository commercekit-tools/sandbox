/** Synthetic, production-shaped subscription code used by every sandbox run. */
export const SUBSCRIPTION_CODE = "131762872233634f29fdeb7d50983aa4";

/**
 * Retained temporarily so browser sessions opened before the identifier rollout
 * can finish without losing their in-memory run.
 */
export const LEGACY_SUBSCRIPTION_CODE = "SUBSCRIPTION_001";

export const ENVIRONMENTS = [
  {
    subscriptionCode: SUBSCRIPTION_CODE,
    name: "Development",
    code: "d1",
    type: "DEVELOPMENT",
    status: "AVAILABLE",
    deploymentStatus: "UNDEPLOYED",
  },
  {
    subscriptionCode: SUBSCRIPTION_CODE,
    name: "Staging",
    code: "s1",
    type: "STAGING",
    status: "AVAILABLE",
    deploymentStatus: "UNDEPLOYED",
  },
  {
    subscriptionCode: SUBSCRIPTION_CODE,
    name: "Production",
    code: "p1",
    type: "PRODUCTION",
    status: "AVAILABLE",
    deploymentStatus: "UNDEPLOYED",
  },
] as const;

export function environmentExists(environmentCode: string): boolean {
  return ENVIRONMENTS.some(({ code }) => code === environmentCode);
}
