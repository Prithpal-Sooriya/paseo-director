import { createHostClient } from "@getpaseo/client/node";

const [method = "director.board", input = "{}"] = process.argv.slice(2);
const client = createHostClient(process.env.PASEO_HOST ?? "127.0.0.1:6767", { clientId: "director-cli" });
await client.connect();
try {
  const result = await client.invokePluginRpc("paseo-director", method, JSON.parse(input));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.close?.();
  process.exit(0);
}
