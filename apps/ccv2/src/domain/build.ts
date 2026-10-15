import { z } from "zod";

export const createBuildSchema = z
  .object({
    branch: z.string().trim().min(1).max(255),
    name: z.string().trim().min(1).max(255),
    applicationCode: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type CreateBuildRequest = z.infer<typeof createBuildSchema>;
export type BuildStatus = "SCHEDULED" | "BUILDING" | "SUCCESS" | "FAIL" | "DELETED" | "UNKNOWN";

export interface BuildDetail {
  subscriptionCode: string;
  applicationCode?: string;
  applicationDefinitionVersion?: string;
  branch: string;
  name: string;
  code: string;
  buildStartTimestamp?: string;
  buildEndTimestamp?: string;
  buildVersion: string;
  createdBy: string;
  status: BuildStatus;
  isPreview: boolean;
  hasSnapshot: boolean;
  deployed: boolean;
  properties: { key: string; value: string }[];
}

export interface BuildProgress {
  subscriptionCode: string;
  buildCode: string;
  errorMessage?: string;
  numberOfTasks: number;
  percentage: number;
  buildStatus: BuildStatus;
  startedTasks: { task: string; name: string; startTimestamp: string }[];
}

export interface BuildListOptions {
  top: number;
  skip: number;
  orderBy: "createdAt asc" | "createdAt desc" | "name asc" | "name desc";
  statusNot?: BuildStatus;
}
