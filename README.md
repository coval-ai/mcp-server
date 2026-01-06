# Coval MCP Server

The official [Model Context Protocol](https://modelcontextprotocol.io/) server for [Coval](https://coval.dev) - the AI evaluation platform.

This MCP server allows AI assistants like Claude Desktop and Cursor to interact with Coval's evaluation APIs, enabling you to:
- Launch and monitor evaluation runs
- Manage AI agents and test sets
- Retrieve evaluation metrics and results

## Quick Start

### Claude Desktop Setup

1. Get your Coval API key from [dashboard.coval.dev](https://dashboard.coval.dev)

2. Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

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

3. Restart Claude Desktop

### Remote Connection (Recommended for Production)

```json
{
  "mcpServers": {
    "coval": {
      "command": "npx",
      "args": [
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

## Available Tools

### Runs
- `list_runs` - List evaluation runs with filtering
- `get_run` - Get details of a specific run (includes metrics for completed runs)
- `create_run` - Launch a new evaluation run
- `delete_run` - Cancel or delete a run

### Agents
- `list_agents` - List configured agents
- `get_agent` - Get agent configuration
- `create_agent` - Create a new agent
- `update_agent` - Update agent configuration

### Test Sets
- `list_test_sets` - List available test sets
- `get_test_set` - Get test set details
- `create_test_set` - Create a new test set

### Metrics
- `list_metrics` - List available metric definitions
- `get_metric` - Get metric details

### Personas
- `list_personas` - List simulated personas
- `get_persona` - Get persona details

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
