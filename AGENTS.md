# AGENTS.md

Working conventions for agents editing this repository. This file applies to the entire repository
unless a deeper `AGENTS.md` provides more specific guidance for its subtree.

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
- If it is unclear whether information is public, leave it out and ask for confirmation.

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

## First Steps

1. Read `README.md` for setup, supported transports, authentication, and environment variables.
2. Read `package.json` and the nearby source and tests before changing behavior.
3. Check the current branch and worktree status. Preserve unrelated user changes.
4. Inspect public API and MCP SDK contracts before adding custom protocol behavior.

## Development

Use the repository's npm scripts:

```sh
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

Run the smallest useful checks while iterating, then run lint, typecheck, unit tests, and the
production build before marking a behavior change ready for review.

## TypeScript Conventions

- Keep strict TypeScript checks passing. Do not use `any` to bypass a contract.
- Prefer small, typed functions and existing module boundaries over new abstractions.
- Validate untrusted inputs at HTTP, OAuth, MCP, and Coval API boundaries.
- Preserve MCP tool names and response contracts unless the task explicitly requires a breaking
  change.
- Keep tool annotations accurate, especially read-only, destructive, idempotent, and open-world
  hints.
- Use bounded timeouts for network calls and avoid logging tokens, API keys, authorization headers,
  customer payloads, or other sensitive values.
- Add comments only when the code cannot clearly express an important constraint.

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

## Tests And Review

- Add focused regression coverage for behavior changes, including failure paths at trust boundaries.
- Keep tests deterministic. Mock external services rather than using customer accounts or live
  credentials.
- Review changes for cross-transport regressions when shared server, client, schema, or tool code is
  modified.
- Address actionable automated-review findings and explain any intentionally rejected finding using
  only public-safe context.
- Keep commits narrowly scoped and use concise, imperative messages without AI attribution.
