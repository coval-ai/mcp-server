# Coval MCP Server

[![npm version](https://img.shields.io/npm/v/@coval/mcp-server.svg)](https://www.npmjs.com/package/@coval/mcp-server)

The official [Model Context Protocol](https://modelcontextprotocol.io/) server for [Coval](https://coval.dev) - the AI evaluation platform.

This MCP server allows AI assistants like Claude, ChatGPT, Codex, and Cursor to interact with
Coval's evaluation APIs, enabling you to:
- Launch and monitor evaluation runs
- Manage AI agents and test sets
- Retrieve evaluation metrics and results

## Hosted connector

The hosted connector is the recommended way to use Coval from Claude, ChatGPT, and other remote
MCP clients. It uses OAuth, so users sign in to Coval and select the organization the connector
can access. No Coval API key is copied into the client.

MCP endpoint: `https://mcp.coval.dev/mcp`

### Claude

1. Open **Customize > Connectors**. Team and Enterprise owners add the connector first from
   **Organization settings > Connectors**.
2. Add a custom web connector using `https://mcp.coval.dev/mcp`.
3. Select **Connect**, sign in to Coval, and choose the Coval organization to authorize.
4. Enable the connector in a conversation and ask Claude to use Coval or Sofia.

See [Claude's remote MCP connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
for current plan and administration requirements.

### ChatGPT

1. Enable developer mode for your ChatGPT workspace account.
2. From **Settings > Apps**, create an app using `https://mcp.coval.dev/mcp` and OAuth.
3. Select **Scan Tools**, sign in to Coval, and choose the Coval organization to authorize.
4. Create the app, then enable it in a conversation.

See [ChatGPT's MCP app guide](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta)
for current plan and workspace requirements.

### Codex

Use Codex `0.144.2` or newer. Current Codex Desktop releases include a compatible client. For the
CLI, update before connecting:

```bash
npm install -g @openai/codex@latest
codex mcp add coval --url https://mcp.coval.dev/mcp
```

When the browser opens, sign in to Coval, select the organization Codex should access, and select
**Allow**. Codex Desktop, the Codex CLI, and the IDE extension share MCP configuration on the same
machine, so the connection is available across those clients after they restart.

In Codex Desktop, you can also add Coval from **Settings > MCP servers** as a **Streamable HTTP**
server using `https://mcp.coval.dev/mcp`, then select **Authenticate**.

If OAuth returns `invalid_scope`, first confirm `codex --version` is `0.144.2` or newer. Older
clients registered a dynamic OAuth client without all the scopes they requested during consent.
After updating, clear the stale registration and reconnect:

```bash
codex mcp logout coval
codex mcp remove coval
codex mcp add coval --url https://mcp.coval.dev/mcp
```

No API key, manual scope list, or `oauth_resource` override is required. See
[Codex's MCP documentation](https://learn.chatgpt.com/docs/extend/mcp.md) for current client setup
details.

## Local installation

```bash
npx @coval/mcp-server
```

Use the local stdio server for service accounts, automation, and clients that do not support
remote OAuth.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "coval": {
      "command": "npx",
      "args": ["-y", "@coval/mcp-server"],
      "env": {
        "COVAL_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "coval": {
      "command": "npx",
      "args": ["-y", "@coval/mcp-server"],
      "env": {
        "COVAL_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Get your API key from [app.coval.dev/settings](https://app.coval.dev/settings)

## Available Tools

| Tool | Description |
|------|-------------|
| `list_agents` | List all agents in your workspace |
| `get_agent` | Get details of a specific agent |
| `create_agent` | Create an agent configuration |
| `update_agent` | Update an agent configuration |
| `list_runs` | List evaluation runs |
| `get_run` | Get details of a specific run |
| `create_run` | Start a new evaluation run |
| `list_test_sets` | List available test sets |
| `get_test_set` | Get test set details |
| `create_test_set` | Create a test set |
| `list_test_cases` | List test cases in a test set |
| `get_test_case` | Get test case details |
| `create_test_case` | Add a test case to a test set |
| `update_test_case` | Update a test case |
| `list_metrics` | List evaluation metrics |
| `get_metric` | Get metric details |
| `list_personas` | List available personas |
| `get_persona` | Get persona details |
| `consult_sofia` | Delegate a read-only Coval evaluation question to Sofia |

## Example Usage

Once connected, you can ask Claude things like:

> "Show me my recent evaluation runs"

> "List all my agents"

> "Run an evaluation of my customer-support-agent against the billing-inquiries test set"

> "What are the metrics for run abc123?"

> "Use `consult_sofia` to analyze my latest failed run and recommend the most useful next test."

The same tools, including `consult_sofia`, are available through both supported transports:

- Remote Streamable HTTP: `https://mcp.coval.dev/mcp` using OAuth. This is the recommended
  connection for Codex, Claude, and other hosted MCP clients.
- Local stdio: `npx @coval/mcp-server` with `COVAL_API_KEY`, for service accounts and local
  development.

The hosted connector can access only the Coval organization selected during OAuth consent. Remove
the connector from the client or revoke its Coval access when it is no longer needed.

### Migrating saved prompts

Sofia was previously named Covi. Version 0.3 replaces the pre-directory `consult_covi` tool with
`consult_sofia` while keeping the connector name, endpoint, package, OAuth flow, and read-only
consultation contract unchanged. Remote clients rediscover the canonical tool after reconnecting;
update any saved prompts or client allowlists that name the previous tool explicitly. The hosted
transport continues accepting cached calls to the previous tool name during the migration, but it
advertises only the canonical 19-tool surface.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Test locally with MCP Inspector
npm run inspector

# Run tests
npm test

# Check the public health and OAuth discovery endpoints
npm run check:remote
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `COVAL_API_KEY` | Stdio | - | Coval API key for the local stdio transport |
| `COVAL_API_BASE_URL` | No | `https://api.coval.dev/v1` | API base URL |
| `LOG_LEVEL` | No | `info` | Logging level |
| `MCP_ALLOWED_ORIGINS` | No | Claude and OpenAI web origins | Comma-separated exact browser origins allowed to call `/mcp`; clients that omit `Origin` remain supported |
| `OPENAI_APPS_CHALLENGE` | No | - | OpenAI plugin-portal domain verification token served as plain text from `/.well-known/openai-apps-challenge` |

## Documentation

- [Coval Documentation](https://docs.coval.dev)
- [MCP Protocol](https://modelcontextprotocol.io)
- [API Reference](https://docs.coval.dev/api)
- [Privacy Policy](https://www.coval.ai/privacy-policy)
- [Connector directory submission checklist](docs/directory-submission.md)

## License

MIT

## Support

- [GitHub Issues](https://github.com/coval-ai/mcp-server/issues)
- [Coval Support](mailto:support@coval.dev)
