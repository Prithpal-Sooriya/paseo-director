import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { BoardScreen } from "./client/board";
import { SettingsScreen } from "./client/settings";
import { launchDirectorRpc } from "./shared/rpc";

function BoardItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="Clapperboard" active={currentScreen?.screenId === "board"} onPress={() => openScreen({ screenId: "board" })} />;
}

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addScreen({ id: "board", title: "Director", Component: BoardScreen }),
    client.addSidebarHeaderItem({ id: "board", title: "Director", Component: BoardItem }),
    client.addSettingsScreen({ id: "settings", title: "Director", icon: "Clapperboard", Component: SettingsScreen }),
    client.addCommandCenterItem({
      id: "launch",
      title: "Director: launch or open",
      icon: "Clapperboard",
      keywords: ["director", "swarm", "mission"],
      context: "global",
      async onSelect({ rpc, openScreen }) {
        await rpc(launchDirectorRpc, {});
        openScreen({ screenId: "board" });
      },
    }),
  ];
  return () => cleanups.forEach((cleanup) => cleanup());
}
