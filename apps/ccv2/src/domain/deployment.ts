import { z } from "zod";

export const createDeploymentSchema = z
  .object({
    buildCode: z.string().trim().min(1).max(100),
    environmentCode: z.string().trim().min(1).max(100),
    databaseUpdateMode: z.enum(["NONE", "UPDATE", "INITIALIZE"]),
    strategy: z.enum(["ROLLING_UPDATE", "RECREATE", "GREEN"]),
  })
  .strict();

export const deploymentDecisionSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
    decision: z.enum(["ACCEPT", "PREPARE_CANARY", "REJECT"]),
  })
  .strict();

export const deploymentCancellationSchema = z
  .object({
    rollbackDatabase: z.boolean().optional(),
    cancelReason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

const trafficItem = z
  .object({ code: z.string().trim().min(1).max(100), percentage: z.number().int().min(0).max(100) })
  .strict();

export const trafficSplitSchema = z
  .object({
    services: z.array(trafficItem).max(50).optional(),
    endpoints: z.array(trafficItem).max(50).optional(),
  })
  .strict()
  .refine((value) => (value.services?.length ?? 0) + (value.endpoints?.length ?? 0) > 0, {
    message: "At least one service or endpoint traffic percentage is required.",
  });

export type CreateDeploymentRequest = z.infer<typeof createDeploymentSchema>;
export type DeploymentDecisionRequest = z.infer<typeof deploymentDecisionSchema>;
export type DeploymentCancellationRequest = z.infer<typeof deploymentCancellationSchema>;
export type TrafficSplitRequest = z.infer<typeof trafficSplitSchema>;
export type DeploymentStatus = "SCHEDULED" | "DEPLOYING" | "DEPLOYED" | "UNDEPLOYED" | "FAIL";

export interface DeploymentDecisionDetail {
  reason?: string;
  type: "ACCEPT" | "PREPARE_CANARY" | "REJECT";
  subscriptionCode: string;
  deploymentCode: string;
  createdTimestamp: string;
  createdBy: string;
}

export interface TrafficSplit {
  services: { code: string; percentage: number; name: string }[];
  endpoints: { code: string; percentage: number; name: string }[];
}

export interface TrafficSplitHistoryEntry extends TrafficSplit {
  deploymentCode: string;
  lastModifiedTimestamp: string;
  lastModifiedBy: string;
  subscriptionCode: string;
  code: string;
}

export interface DeploymentDetail {
  code: string;
  subscriptionCode: string;
  createdBy: string;
  createdTimestamp: string;
  buildCode: string;
  environmentCode: string;
  databaseUpdateMode: "NONE" | "UPDATE" | "INITIALIZE";
  strategy: "ROLLING_UPDATE" | "RECREATE" | "GREEN";
  scheduledTimestamp: string;
  deployedTimestamp?: string;
  failedTimestamp?: string;
  undeployedTimestamp?: string;
  status: DeploymentStatus;
  cancelation?: {
    canceledBy: string;
    startTimestamp: string;
    finishedTimestamp: string;
    failed: boolean;
    rollbackDatabase?: boolean;
    cancelReason?: string;
  };
  isCanaryAvailable: boolean;
  previousDeploymentCode?: string;
  expireAtTimestamp?: string;
  canaryStatus?: "FAILED" | "STARTED" | "SUCCEEDED";
  trafficSplit: TrafficSplit;
  decisions: DeploymentDecisionDetail[];
  awaitingDecision: boolean;
}

export interface DeploymentListOptions {
  top: number;
  skip: number;
  orderDescending: boolean;
  buildCode?: string;
  environmentCode?: string;
  status?: DeploymentStatus;
}

export interface DeploymentProgress {
  subscriptionCode: string;
  deploymentCode: string;
  deploymentStatus: DeploymentStatus;
  percentage: number;
  stages: {
    name: string;
    type: string;
    startTimestamp: string;
    endTimestamp?: string;
    status: "PENDING" | "RUNNING" | "DONE" | "FAIL";
    steps: {
      code: string;
      name: string;
      startTimestamp: string;
      endTimestamp?: string;
      message?: string;
      status: "PENDING" | "RUNNING" | "DONE" | "FAIL";
      children: never[];
    }[];
  }[];
}
