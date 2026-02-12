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

## Example Usage

Once connected, you can ask Claude things like:

> "Show me my recent evaluation runs"

> "List all my agents"

> "Run an evaluation of my customer-support-agent against the billing-inquiries test set"

> "What are the metrics for run abc123?"

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
| `COVAL_API_KEY` | Yes | - | Your Coval API key |
| `COVAL_API_BASE_URL` | No | `https://api.coval.dev/v1` | API base URL |
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
