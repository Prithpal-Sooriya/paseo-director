import type { PaseoApi } from "@getpaseo/client";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { defaultSettings, type DirectorSettings, directorSettings } from "../shared/settings";
import { sendViaCli } from "./cli";
import { logEvent } from "./data";
import { readState } from "./store";

let api: PaseoApi | null = null;
let settingsHandle: PluginSettings<typeof directorSettings.schema> | null = null;

export function remember(paseo: PaseoApi): void {
  api = paseo;
}

export function paseoApi(): PaseoApi | null {
  return api;
}

export function useSettings(handle: PluginSettings<typeof directorSettings.schema>): void {
  settingsHandle = handle;
}

export async function settings(): Promise<DirectorSettings> {
  if (!settingsHandle) return defaultSettings;
  const state = await settingsHandle.read();
  return state.status === "ready" ? { ...defaultSettings, ...state.values } : defaultSettings;
}

export async function tellDirector(text: string, paseo: PaseoApi | null = api, from?: string): Promise<boolean> {
  const state = await readState();
  const directorId = state.director.agentId;
  if (!directorId) {
    await logEvent("director.undelivered", { text });
    return false;
  }
  try {
    if (paseo) await deliver(paseo, directorId, text, from ?? directorId);
    else await sendViaCli(directorId, text, from ?? directorId);
    return true;
  } catch (error) {
    await logEvent("director.send_failed", { error: String(error), text });
    return false;
  }
}

export async function tellAgent(agentId: string, text: string, behavior: "queue" | "steer" | "interrupt" = "queue", paseo: PaseoApi | null = api): Promise<void> {
  const directorId = (await readState()).director.agentId;
  if (!paseo) return sendViaCli(agentId, text, directorId ?? agentId);
  if (behavior !== "queue") return paseo.agents.ref(agentId).send(text, { activeTurnBehavior: behavior });
  await deliver(paseo, agentId, text, directorId ?? agentId);
}

async function deliver(paseo: PaseoApi, agentId: string, text: string, from: string): Promise<void> {
  try {
    await paseo.agents.ref(agentId).send(text, { activeTurnBehavior: "queue", sourceAgentId: from });
  } catch (error) {
    await logEvent("send.queue_fallback", { agentId, error: String(error) });
    await paseo.agents.ref(agentId).send(text, { activeTurnBehavior: "steer" });
  }
}
