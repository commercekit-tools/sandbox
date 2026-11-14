import { z } from "zod";

const code = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const build = z
  .object({
    code,
    response: z.record(z.string(), z.unknown()),
    modifiedAt: z.iso.datetime().optional(),
  })
  .strict();
const deployment = z.object({ code, response: z.record(z.string(), z.unknown()) }).strict();

/** Simulation controls never appear in SAP response DTOs. */
export const cleanupFixtureSchema = z
  .object({
    builds: z.array(build).max(150),
    deployments: z.array(deployment).max(30).default([]),
    changes: z
      .array(
        z
          .object({
            operationId: z.enum(["getBuilds", "getBuild", "deleteBuild"]),
            onCall: z.number().int().min(1).max(1000),
            buildCode: code,
            patch: z.record(z.string(), z.unknown()).optional(),
            remove: z.boolean().optional(),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    loseDeleteResponse: z.array(code).max(20).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    for (const name of ["builds", "deployments"] as const) {
      if (new Set(value[name].map((item) => item.code)).size !== value[name].length) {
        context.addIssue({ code: "custom", path: [name], message: "Fixture keys must be unique." });
      }
    }
  });

export type CleanupFixture = z.infer<typeof cleanupFixtureSchema>;
