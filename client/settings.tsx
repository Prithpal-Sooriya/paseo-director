import { useEffect, useState } from "react";
import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView, SettingsAction, SettingsInput, SettingsSection, SettingsSwitch, useToast } from "@getpaseo/plugin/client/ui";
import { type DirectorSettings, directorSettings } from "../shared/settings";

const ROLES = ["scout", "builder", "reviewer"];

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(directorSettings);
  const toast = useToast();
  const [draft, setDraft] = useState<DirectorSettings | null>(null);

  useEffect(() => {
    if (settings.status === "ready") setDraft(settings.values);
  }, [settings.status === "ready" ? settings.revision : null]);

  if (settings.status !== "ready" || !draft) {
    return <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} />;
  }

  const save = async () => {
    const saved = await settings.save(draft, settings.revision);
    saved ? toast.show("Saved") : toast.error(settings.saveError ?? "Save failed");
  };

  const setRole = (role: string, provider: string) => {
    const roleProviders = { ...draft.roleProviders };
    if (provider.trim()) roleProviders[role] = provider.trim();
    else delete roleProviders[role];
    setDraft({ ...draft, roleProviders });
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: 20, gap: 20 }}>
      <SettingsSection title="Model profiles">
        <SettingsInput
          label="Director"
          hint="provider or provider/model, e.g. claude/opus"
          initialValue={draft.directorProvider}
          onChangeText={(directorProvider) => setDraft({ ...draft, directorProvider })}
        />
        {ROLES.map((role) => (
          <SettingsInput
            key={role}
            label={role[0]!.toUpperCase() + role.slice(1)}
            hint="Empty: the Director's model (or what the Director picks per task)"
            initialValue={draft.roleProviders[role] ?? ""}
            onChangeText={(value) => setRole(role, value)}
          />
        ))}
        <SettingsInput label="Worker mode" hint="Optional mode id for workers, e.g. bypassPermissions" initialValue={draft.workerMode} onChangeText={(workerMode) => setDraft({ ...draft, workerMode })} />
      </SettingsSection>
      <SettingsSection title="Swarm">
        <SettingsInput label="Max tasks per wave" initialValue={String(draft.maxWave)} onChangeText={(text) => setDraft({ ...draft, maxWave: Math.min(8, Math.max(1, Number(text) || 4)) })} />
        <SettingsInput label="PR poll seconds" initialValue={String(draft.prPollSeconds)} onChangeText={(text) => setDraft({ ...draft, prPollSeconds: Math.min(3600, Math.max(15, Number(text) || 60)) })} />
        <SettingsSwitch label="Route CI failures straight to the builder" value={draft.autoRouteCi} onValueChange={(autoRouteCi) => setDraft({ ...draft, autoRouteCi })} />
        <SettingsSwitch label="Tear down a mission when its last PR workspace is archived" value={draft.teardownEmptyMissions} onValueChange={(teardownEmptyMissions) => setDraft({ ...draft, teardownEmptyMissions })} />
      </SettingsSection>
      <SettingsSection title="">
        <SettingsAction label="Save settings" actionLabel={settings.saving ? "Saving…" : "Save"} disabled={settings.saving} onPress={() => void save()} />
      </SettingsSection>
    </ScrollView>
  );
}
