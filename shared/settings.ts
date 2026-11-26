import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const directorSettings = defineSettings({
  id: "director",
  scope: "host",
  version: 1,
  schema: z.object({
    directorProvider: z.string().default("claude"),
    roleProviders: z.record(z.string(), z.string()).default({}),
    workerMode: z.string().default(""),
    prPollSeconds: z.number().int().min(15).max(3600).default(60),
    maxWave: z.number().int().min(1).max(8).default(4),
    teardownEmptyMissions: z.boolean().default(true),
    autoRouteCi: z.boolean().default(true),
  }),
});

export type DirectorSettings = z.output<typeof directorSettings.schema>;

export const defaultSettings: DirectorSettings = directorSettings.schema.parse({});
