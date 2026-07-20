# Connector directory submission

Use this checklist before submitting the hosted Coval MCP server to a connector directory.

## Automated checks

Run the repository checks:

```bash
npm ci
npm run lint
npm run typecheck
npm test -- --runInBand
npm run build
npm run check:remote
```

The remote check verifies the public health endpoint, OAuth discovery metadata, PKCE support, and
the unauthenticated MCP authorization challenge. It does not complete user authorization or call
authenticated tools.

## Manual checks

- Connect `https://mcp.coval.dev/mcp` through the target client using OAuth.
- Select a populated Coval test organization during consent.
- Confirm tool discovery returns a title and correct read/write annotations for every tool.
- Exercise every tool with valid inputs. Confirm write tools affect only disposable test data.
- Confirm `consult_covi` succeeds for the review organization. Direct API tools and Covi
  consultation are separate capabilities, so test both.
- Confirm invalid inputs return actionable errors rather than generic server errors.
- Revoke the connection and confirm the client can no longer access the organization.
- Repeat the flow with a user who cannot access the selected organization.

## Submission assets

- Documentation: this repository's hosted connector instructions
- Privacy policy: `https://www.coval.ai/privacy-policy`
- Support contact: `support@coval.dev`
- A production connector icon
- A fully populated test account, provided only through the directory's secure review process
- Example prompts and expected outcomes for both direct Coval tools and `consult_covi`

Never commit test credentials, access tokens, customer data, or private infrastructure details to
this public repository.

## Draft listing copy

**Name:** Coval

**Tagline:** Evaluate and improve voice and chat agents

**Description:** Connect Claude to your Coval workspace to inspect agents, test sets, personas,
metrics, and evaluation runs. Launch evaluations and update supported resources through explicit
write tools, or consult Covi for read-only analysis grounded in your organization's evaluation data
and Coval's evaluation workflows.

**Primary use cases:**

- Inspect recent evaluation runs and diagnose performance or configuration issues.
- Create and refine agents, test sets, and test cases, then launch evaluation runs.
- Ask Covi for read-only, organization-grounded evaluation guidance.

**Connection requirements:** A Coval account with access to the organization being connected. The
review account must also have access to `consult_covi` so every submitted tool can be exercised.

**Data access:** Both read and write. Write operations are exposed as separate tools and carry
write or destructive annotations as applicable.

## Platform references

- [Claude connector submission](https://claude.com/docs/connectors/building/submission)
- [Claude pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria)
- [ChatGPT app submission](https://developers.openai.com/apps-sdk/deploy/submission)
