import { z } from "zod";

import { managementOperationIds } from "./contracts";

const lifecyclePolls = z.number().int().min(0).max(100);

const faultSchema = z
  .object({
    operationId: z.string().min(1).max(100),
    status: z.union([
      z.literal(400),
      z.literal(401),
      z.literal(403),
      z.literal(404),
      z.literal(409),
      z.literal(412),
      z.literal(423),
      z.literal(429),
      z.literal(500),
    ]),
    onCalls: z.array(z.number().int().min(1).max(1_000)).min(1).max(20),
    resourceIdentifier: z.string().min(1).max(100).optional(),
    retryAfterSeconds: z.number().int().min(1).max(3_600).optional(),
    title: z.string().min(1).max(120).optional(),
    detail: z.string().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((fault, context) => {
    if (fault.operationId !== "issueToken" && !managementOperationIds.has(fault.operationId)) {
      context.addIssue({
        code: "custom",
        path: ["operationId"],
        message: "Unknown operation ID",
      });
    }
  });

export const scenarioSchema = z
  .object({
    build: z
      .object({
        outcome: z.enum(["SUCCESS", "FAIL", "NEVER"]),
        pollsBeforeTerminal: lifecyclePolls,
        logsAvailable: z.boolean(),
        failureMessage: z.string().min(1).max(500).optional(),
      })
      .strict(),
    deployment: z
      .object({
        outcome: z.enum(["DEPLOYED", "FAIL", "NEVER"]),
        pollsBeforeTerminal: lifecyclePolls,
        failureMessage: z.string().min(1).max(500).optional(),
        cancellationAllowed: z.boolean(),
        requireGreenDecision: z.boolean(),
      })
      .strict(),
    faults: z.array(faultSchema).max(25),
  })
  .strict();

export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioFault = z.infer<typeof faultSchema>;

export const DEFAULT_SCENARIO: Scenario = {
  build: {
    outcome: "SUCCESS",
    pollsBeforeTerminal: 2,
    logsAvailable: true,
  },
  deployment: {
    outcome: "DEPLOYED",
    pollsBeforeTerminal: 3,
    cancellationAllowed: true,
    requireGreenDecision: true,
  },
  faults: [],
};

export function parseScenario(value: unknown): Scenario {
  return scenarioSchema.parse(value);
}
