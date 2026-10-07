/**
 * How to connect each assistant to the MCP server — one list, read by the hero's setup links and
 * by the connect tabs.
 *
 * A plain module, deliberately not part of the `"use client"` component: a server component that
 * imports a non-component value from a client module receives a client reference, not the value,
 * and fails at runtime while typecheck and unit tests pass.
 *
 * Steps are kept to what each client's own UI asks for — a URL and, where it asks, no
 * authentication — because these screens are renamed often, and a step naming a button that no
 * longer exists is worse than a shorter one that still holds.
 */

export interface McpSetupStep {
  text: string;
  /** Something to paste: a command or a config file. */
  copy?: string;
}

export interface McpClientSetup {
  /** Also the anchor: `#connect-<id>` opens this client's tab. */
  id: string;
  name: string;
  steps: McpSetupStep[];
}

export function mcpClients(url: string): McpClientSetup[] {
  return [
    {
      id: "claude",
      name: "Claude",
      steps: [
        { text: "Open Settings, then Connectors." },
        { text: "Choose Add custom connector and paste the server URL.", copy: url },
        { text: "Leave authentication empty and add it." },
      ],
    },
    {
      id: "claude-code",
      name: "Claude Code",
      steps: [
        {
          text: "Run this once in your terminal:",
          copy: `claude mcp add --transport http shieldedscan ${url}`,
        },
        { text: "Start a session and ask about Zcash." },
      ],
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      steps: [
        { text: "Turn on developer mode in Settings." },
        { text: "Add a custom connector with the server URL.", copy: url },
        { text: "Set authentication to none." },
      ],
    },
    {
      id: "cursor",
      name: "Cursor",
      steps: [
        {
          text: "Add this to ~/.cursor/mcp.json (or .cursor/mcp.json in a project):",
          copy: JSON.stringify({ mcpServers: { shieldedscan: { url } } }, null, 2),
        },
        { text: "Reload, and the tools appear in the chat." },
      ],
    },
    {
      id: "vscode",
      name: "VS Code",
      steps: [
        {
          text: "Add this to .vscode/mcp.json:",
          copy: JSON.stringify({ servers: { shieldedscan: { type: "http", url } } }, null, 2),
        },
        { text: "Start the server from the MCP view, then ask in Copilot Chat." },
      ],
    },
  ];
}
