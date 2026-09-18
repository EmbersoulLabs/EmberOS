import { z } from "zod";

export const CertificationEnvironmentSchema = z.enum(["STAGING", "PRODUCTION"]);
export type CertificationEnvironment = z.infer<typeof CertificationEnvironmentSchema>;
