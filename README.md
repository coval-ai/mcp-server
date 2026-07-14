# Coval MCP Server

[![npm version](https://img.shields.io/npm/v/@covalai/mcp-server.svg)](https://www.npmjs.com/package/@covalai/mcp-server)

The official [Model Context Protocol](https://modelcontextprotocol.io/) server for [Coval](https://coval.dev) - the AI evaluation platform.

This MCP server allows AI assistants like Claude Desktop and Cursor to interact with Coval's evaluation APIs, enabling you to:
- Launch and monitor evaluation runs
- Manage AI agents and test sets
- Retrieve evaluation metrics and results

## Installation

```bash
npx @covalai/mcp-server
```

## Quick Start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "coval": {
      "command": "npx",
      "args": ["-y", "@covalai/mcp-server"],
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
      "args": ["-y", "@covalai/mcp-server"],
      "env": {
        "COVAL_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Remote Connection (Alternative)

```json
{
  "mcpServers": {
    "coval": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.coval.dev/mcp",
        "--header",
        "X-API-KEY: ${COVAL_API_KEY}"
      ],
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
| `list_runs` | List evaluation runs |
| `get_run` | Get details of a specific run |
| `create_run` | Start a new evaluation run |
| `list_test_sets` | List available test sets |
| `get_test_set` | Get test set details |
| `list_test_cases` | List test cases in a test set |
| `create_test_case` | Add a test case to a test set |
| `get_metrics` | Get metrics for a run |
| `list_personas` | List available personas |
| `consult_covi` | Delegate a read-only Coval evaluation question to Covi |

## Example Usage

Once connected, you can ask Claude things like:

> "Show me my recent evaluation runs"

> "List all my agents"

> "Run an evaluation of my customer-support-agent against the billing-inquiries test set"

> "What are the metrics for run abc123?"

> "Use `consult_covi` to analyze my latest failed run and recommend the most useful next test."

The same tools, including `consult_covi`, are available through both supported transports:

- Remote Streamable HTTP: `https://mcp.coval.dev/mcp` using Clerk OAuth. This is the recommended
  connection for Codex, Claude, and other hosted MCP clients.
- Local stdio: `npx @covalai/mcp-server` with `COVAL_API_KEY`, for service accounts and local
  development.

Remote clients may continue to send `X-API-Key` during migration. OAuth access tokens terminate at
the MCP server and are never forwarded to Coval APIs or Sofia; the server exchanges verified Clerk
user and organization identity for Coval's existing managed per-user API key.

### Remote OAuth operator requirements

**Staging-enable prerequisite:** the Clerk OAuth application MUST be configured to issue
JWT-format access tokens containing the selected organization in `org_id` or `organization_id`.
The server reads the organization only from that signature-verified token claim (Clerk's verified
OAuth auth object does not expose an organization id), so opaque `oat_` tokens and
organization-less tokens are rejected with 401 and no fallback — every OAuth connection fails
until this is configured. This keeps organization selection bound to verified identity rather
than request parameters.
Enable Dynamic Client Registration for MCP clients that create their OAuth registration at connect
time, and keep the Clerk consent screen enabled so the user explicitly selects the organization
granted through `user:org:read`.

Do not publish the remote-connection release or repoint `mcp.coval.dev` until the backend identity
exchange and Sofia delegation endpoint are deployed, `consult_covi` succeeds through a real OAuth
connector, and the legacy API-key connector path has been regression-tested.

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
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `COVAL_API_KEY` | Stdio | - | Coval API key for the local stdio transport |
| `COVAL_API_BASE_URL` | No | `https://api.coval.dev/v1` | API base URL |
| `COVI_DELEGATION_ORIGIN` | No | Derived from `COVAL_API_BASE_URL` | Overrides the expected Sofia origin used to validate delegation URLs |
| `PORT` | Remote | `8080` | Streamable HTTP listen port |
| `CLERK_PUBLISHABLE_KEY` | Remote | - | Clerk publishable key used for OAuth metadata |
| `CLERK_SECRET_KEY` | Remote | - | Clerk server key used to verify OAuth access tokens |
| `COVAL_INTERNAL_API_KEY` | Remote OAuth | - | Internal credential used only for managed user-key exchange |
| `LOG_LEVEL` | No | `info` | Logging level |

## Documentation

- [Coval Documentation](https://docs.coval.dev)
- [MCP Protocol](https://modelcontextprotocol.io)
- [API Reference](https://docs.coval.dev/api)

## License

MIT

## Support

- [GitHub Issues](https://github.com/coval-ai/mcp-server/issues)
- [Coval Support](mailto:support@coval.dev)
