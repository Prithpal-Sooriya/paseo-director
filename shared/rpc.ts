import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const launchDirectorRpc = defineRpc({
  name: "director.launch",
  input: z.object({}),
  output: z.object({ agentId: z.string(), workspaceId: z.string().nullable(), created: z.boolean() }),
});

export const boardRpc = defineRpc({
  name: "director.board",
  input: z.object({}),
  output: z.object({ markdown: z.string(), directorAgentId: z.string().nullable() }),
});
