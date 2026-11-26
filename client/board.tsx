import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Markdown, ScrollView, useToast } from "@getpaseo/plugin/client/ui";
import { boardRpc, launchDirectorRpc } from "../shared/rpc";

export function BoardScreen({ theme, navigation }: PluginScreenProps) {
  const fetchBoard = useRpc(boardRpc);
  const launch = useRpc(launchDirectorRpc);
  const toast = useToast();
  const [board, setBoard] = useState<{ markdown: string; directorAgentId: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => fetchBoard({}).then(setBoard, (error: unknown) => toast.error(String(error)));

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, []);

  const openDirector = async () => {
    setBusy(true);
    try {
      const result = await launch({});
      navigation?.openAgent({ agentId: result.agentId });
      await refresh();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: 20, gap: 16 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Pressable
          disabled={busy}
          onPress={() => void openDirector()}
          style={{ backgroundColor: theme.colors.accent, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, opacity: busy ? 0.6 : 1 }}
        >
          <Text style={{ color: theme.colors.accentForeground, fontWeight: "600" }}>{board?.directorAgentId ? "Open Director" : "Launch Director"}</Text>
        </Pressable>
        <Pressable onPress={() => void refresh()}>
          <Text style={{ color: theme.colors.foreground }}>Refresh</Text>
        </Pressable>
      </View>
      <Markdown>{board ? `## Missions\n\n${board.markdown}` : "Loading…"}</Markdown>
    </ScrollView>
  );
}
