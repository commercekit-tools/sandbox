import { z } from "zod";

export const createEndpointSchema = z
  .object({
    code: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(255),
    domainName: z.string().trim().min(1).max(253),
    protocol: z.enum(["HTTP", "HTTPS"]),
    k8sService: z.string().trim().min(1).max(100),
    k8sServiceVersion: z.enum(["BLUE", "GREEN", "UNSPECIFIED"]),
    access: z.enum(["ALLOW_ALL", "DENY_ALL"]),
    description: z.string().max(500).optional(),
    priority: z.number().int().min(0).max(1_000).optional(),
    proxyTimeOut: z.number().int().min(1).max(3_600).optional(),
    sslCertificate: z.string().max(100).optional(),
    maintenanceMode: z.boolean().optional(),
  })
  .strict();

export const updateEndpointSchema = createEndpointSchema.partial().omit({ code: true });

export const createDatabackupSchema = z
  .object({
    description: z.string().max(500).optional(),
    databackupType: z.string().trim().min(1).max(100).optional(),
    databackupContent: z
      .object({
        databasesBackup: z.object({ included: z.boolean() }).strict().optional(),
        storagesBackup: z.object({ included: z.boolean() }).strict().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const backupStateSchema = z.object({ action: z.literal("CANCEL") }).strict();

export const createDatarestoreSchema = z
  .object({
    databackupCode: z.string().trim().min(1).max(100).optional(),
    sourceEnvironmentCode: z.string().trim().min(1).max(100).optional(),
    restorePointTime: z.iso.datetime().optional(),
  })
  .strict()
  .refine((value) => value.databackupCode !== undefined || value.restorePointTime !== undefined, {
    message: "databackupCode or restorePointTime is required.",
  });

const scalingCode = z.string().trim().min(1).max(100);
const namedCode = z.object({ code: scalingCode, name: z.string().max(255).optional() }).strict();

const kubernetesClusterScale = z
  .object({
    code: scalingCode,
    maxWorkerCount: z.number().int().min(1).max(100).optional(),
    workerVmType: namedCode.optional(),
  })
  .strict();

const databaseSchemaScale = z
  .object({
    code: scalingCode,
    maxSizeInMb: z.number().int().positive().max(100_000_000).optional(),
    haReplicaCount: z.number().int().min(0).max(20).optional(),
    performance: namedCode.optional(),
  })
  .strict();

const serviceScale = z
  .object({
    code: scalingCode,
    replicas: z.number().int().min(0).max(20).optional(),
    requestsCpu: z.string().trim().min(1).max(50).optional(),
    noLimitsCpu: z.boolean().optional(),
    requestsMemory: z.string().trim().min(1).max(50).optional(),
    memoryScaleFactor: z.number().positive().max(100).optional(),
    storageSize: z.string().trim().min(1).max(50).optional(),
  })
  .strict();

export const scalingUpdateSchema = z
  .object({
    hibernated: z.boolean().optional(),
    kubernetesClusters: z.array(kubernetesClusterScale).max(20).optional(),
    databaseSchemas: z.array(databaseSchemaScale).max(20).optional(),
    services: z.array(serviceScale).max(50).optional(),
  })
  .strict();

export const createScheduledActivitySchema = z
  .object({
    activityType: z.string().trim().min(1).max(100),
    scheduledTimestamp: z.iso.datetime(),
  })
  .strict();

export const updateScheduledActivitySchema = z
  .object({ scheduledTimestamp: z.iso.datetime() })
  .strict();

export const servicePropertySchema = z
  .object({
    key: z.string().trim().min(1).max(100),
    value: z.record(z.string(), z.unknown()),
    flags: z.array(z.string().max(100)).max(20).optional(),
  })
  .strict();

export const createCertificateSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    certificate: z.string().min(1).max(65_536),
    certificateKey: z.string().min(1).max(65_536),
    description: z.string().max(500).optional(),
    caCertificate: z.string().max(65_536).optional(),
  })
  .strict();

export const createRoleAssignmentSchema = z
  .object({
    username: z.string().trim().min(1).max(255),
    email: z.email(),
    role: z.string().trim().min(1).max(100),
    environments: z.array(z.string().trim().min(1).max(100)).max(20),
  })
  .strict();

export const updateRoleAssignmentSchema = z
  .object({
    username: z.string().trim().min(1).max(255),
    role: z.string().trim().min(1).max(100),
    environments: z.array(z.string().trim().min(1).max(100)).max(20),
  })
  .strict();

export const deleteRoleAssignmentSchema = z
  .object({
    username: z.string().trim().min(1).max(255),
    role: z.string().trim().min(1).max(100),
  })
  .strict();
