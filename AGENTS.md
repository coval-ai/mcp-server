# AGENTS.md

Repository layout, commands, and MCP transport contracts.

## Public Repository

This repository is public. Treat every committed file, commit message, pull request, issue, review
comment, CI log, and release artifact as public communication.

- Do not disclose Coval internal information. This includes private Slack or Linear content,
  internal documents, private repository details, non-public architecture, incident information,
  customer names or data, organization identifiers, credentials, secret names or values, and
  internal-only URLs or operational procedures.
- Use only information already published in this repository or in Coval's public documentation when
  explaining implementation decisions publicly.
- Private context may inform the work, but reduce it to the minimum public product requirement. Do
  not quote, link to, summarize, or attribute the private source.
- Before posting or pushing, review the entire public artifact for accidental disclosure, including
  test fixtures, screenshots, command output, branch names, and generated files.

## Repository Overview

This package provides Coval tools through the Model Context Protocol (MCP):

- `src/index.ts` runs the local stdio server.
- `src/remote.ts` runs the hosted Streamable HTTP server.
- `src/lambda.ts` contains the Lambda transport.
- `src/server.ts` creates the shared MCP server and resources.
- `src/tools/` registers MCP tools and their annotations.
- `src/schemas/` defines tool input schemas.
- `src/client.ts` wraps Coval API requests.
- `tests/unit/` contains Jest unit and transport tests.

Keep behavior shared across transports in the common server, client, and tool modules. Keep
transport-specific authentication and lifecycle behavior in the relevant entrypoint.

Setup, supported transports, authentication, and environment variables are documented in `README.md`.

## Development

Use the repository's npm scripts:

```sh
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

When a change touches `src/client.ts` or `src/tools/`, also run the API coverage audit described in
`README.md` and update `api-coverage.toml` and `api-coverage-report.md` in the same change.

## MCP contracts

- Tool names and response contracts are shared across the stdio, HTTP, and Lambda transports.
- MCP tool annotations describe read-only, destructive, idempotent, and open-world behavior.

## Authentication And Security

- Keep Clerk OAuth tokens at the remote MCP boundary. Do not forward them to Coval APIs or other
  services.
- Bind authenticated requests to the verified user and organization claims required by the public
  contract.
- Preserve API-key compatibility unless a migration explicitly removes it.
- Fail closed when authentication, organization binding, scope validation, or delegation validation
  is incomplete.
- Never commit `.env` files, API keys, Clerk keys, signing secrets, tokens, certificates, or local
  credentials. Use documented environment variables and deployment secret stores.
