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
COVAL_MCP_URL=https://mcp.coval.dev/claude/mcp npm run check:remote
```

The remote check verifies the public health endpoint, OAuth discovery metadata, PKCE support, and
the unauthenticated MCP authorization challenge. It does not complete user authorization or call
authenticated tools.

## Manual checks

- Connect `https://mcp.coval.dev/mcp` for OpenAI and generic MCP review, and
  `https://mcp.coval.dev/claude/mcp` for Claude review, using OAuth.
- Select a populated Coval test organization during consent.
- Confirm tool discovery returns exactly 19 tools with a title and correct read/write annotations
  for every tool. The six write tools (`create_agent`, `create_run`, `create_test_set`,
  `create_test_case`, `update_agent`, and `update_test_case`) must advertise
  `readOnlyHint: false`. On `/mcp`, the additive create tools (`create_agent`, `create_test_set`,
  and `create_test_case`) advertise `destructiveHint: false`, while `create_run`, `update_agent`,
  and `update_test_case` advertise `destructiveHint: true`. On `/claude/mcp`, all six write tools
  advertise `destructiveHint: true`. On both paths, `create_run` alone advertises
  `openWorldHint: true`; all other tools advertise `openWorldHint: false`.
- Inspect every input schema discovered from the OpenAI `/mcp` endpoint. No tool may request
  ChatGPT conversation history, a caller-provided session identifier, arbitrary metadata, or an
  unconstrained object. Confirm `consult_sofia` accepts only one bounded standalone prompt and
  `create_agent` clearly identifies the connection field required by its selected model type.
  The Claude endpoint and local package retain their existing advanced input fields as a separate
  compatibility profile.
- Exercise every tool with valid inputs. Confirm write tools affect only disposable test data.
- Confirm `consult_sofia` succeeds for the review organization. Direct API tools and Sofia
  consultation are separate capabilities, so test both.
- Confirm invalid inputs return actionable errors rather than generic server errors.
- Revoke the connection and confirm the client can no longer access the organization.
- Repeat the flow with a user who cannot access the selected organization.
- Run every submitted positive and negative case independently in a fresh conversation on each
  supported ChatGPT and Codex surface. For OpenAI review, include ChatGPT web and mobile. Record
  the exact tool sequence and verify the final answer matches the submitted expected result.

## Submission assets

- Documentation: this repository's hosted connector instructions
- Privacy policy: `https://www.coval.ai/privacy-policy`
- Support contact: `support@coval.dev`
- Production connector icon: `assets/coval-logo.svg`
- A fully populated test account, provided only through the directory's secure review process
- Example prompts and expected outcomes for both direct Coval tools and `consult_sofia`

Never commit test credentials, access tokens, customer data, or private infrastructure details to
this public repository.

## Draft listing copy

**Name:** Coval

**Tagline:** Evaluate and improve voice and chat agents

**Description:** Connect Claude to your Coval workspace to inspect agents, test sets, personas,
metrics, and evaluation runs. Launch evaluations and update supported resources through explicit
write tools, or consult Sofia for read-only analysis grounded in your organization's evaluation data
and Coval's evaluation workflows.

**Primary use cases:**

- Inspect recent evaluation runs and diagnose performance or configuration issues.
- Create and refine agents, test sets, and test cases, then launch evaluation runs.
- Ask Sofia for read-only, organization-grounded evaluation guidance.

**Connection requirements:** A Coval account with access to the organization being connected. The
review account must also have access to `consult_sofia` so every submitted tool can be exercised.

**Data access:** Both read and write. Write operations are exposed as separate tools and carry
write or destructive annotations as applicable.

## OpenAI review test cases

The review account should use a populated, disposable Coval organization. Provide concrete fixture
IDs and credentials only through the submission portal. Keep every case independently runnable:
no case may depend on a resource created by another case, a moving "most recent" target, or a
fixed-name disposable resource left by an earlier run. Reset disposable resources after review.

### Positive cases

1. **Disposable agent creation**
   - Create one uniquely named `MODEL_TYPE_VOICE` agent using a non-routable reviewer SIP address,
     retrieve it, and update only its display name.
   - Expected behavior: `create_agent`, `get_agent`, and `update_agent` each run once after the
     required confirmations; no evaluation starts and the SIP address is never contacted.
   - Fixture: permission to create disposable agents. Generate a new UTC suffix and matching
     `sip:<suffix>@invalid.example` address for every attempt.
2. **Stable evaluation setup inspection**
   - Retrieve the uniquely named baseline test set, only its test cases, the reviewer metric, and
     the reviewer persona.
   - Expected behavior: use list tools only to resolve the portal-provided fixture IDs, then
     retrieve those exact resources. Make no changes.
   - Fixture: one uniquely named baseline test set with two cases, one metric, and one persona.
3. **Independent disposable test content**
   - Create one uniquely timestamped SCENARIO test set, add one duplicate-charge test case, and
     update only that case's description.
   - Expected behavior: `create_test_set`, `create_test_case`, and `update_test_case` each run once
     after confirmation. This case must not be reused by another submitted test.
   - Fixture: permission to create disposable test data.
4. **Stable evaluation launch**
   - Resolve the portal-provided stable agent, test set, persona, and metric IDs, then launch
     exactly one tagged evaluation and retrieve it once.
   - Expected behavior: use only those resolved fixtures, call `create_run` once after
     confirmation, and report the new run's identifier and current status.
   - Fixture: independently valid reviewer fixtures that do not depend on cases 1 or 3.
5. **Bounded Sofia guidance**
   - Ask Sofia one standalone question containing only two Turn Count scores and a request for one
     task-completion metric.
   - Expected behavior: call `consult_sofia` once with only `prompt`; do not send prior turns or a
     caller session identifier.
   - Expected result: one task-success or task-completion metric recommendation and a concise
     rationale, with no writes.

### Negative cases

1. **Cross-organization resource**
   - Scenario: ask for an agent using an ID that belongs to a different organization.
   - Expected behavior: return a not-found or permission error without exposing the resource.
   - Why it must not complete: OAuth access is bound to the organization selected during consent.
2. **Malformed identifier**
   - Scenario: "Open run `not-a-valid-run-id` and explain its results."
   - Expected behavior: return an actionable validation or not-found error; do not retry with a
     guessed identifier and do not mutate anything.
   - Why it must not complete: the requested resource cannot be identified safely.
3. **Unsupported destructive request**
   - Scenario: "Delete every agent and test set in this organization."
   - Expected behavior: explain that the connector does not expose those bulk destructive tools;
     do not substitute unrelated write tools.
   - Why it must not complete: the operation is destructive, outside the connector's tool surface,
     and lacks a narrowly identified target.

## Portal-only configuration

- Set `OPENAI_APPS_CHALLENGE` to the exact token generated by the OpenAI submission portal, deploy,
  and verify the well-known endpoint returns only that token before selecting **Verify**.
- Supply reviewer credentials and fixture IDs through the platform's secure submission fields.
- Use `https://app.coval.dev` as the allowed application link origin if link opening is enabled.
- Do not add challenge tokens, credentials, or fixture IDs to this repository.

## Platform references

- [Claude connector submission](https://claude.com/docs/connectors/building/submission)
- [Claude pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria)
- [OpenAI plugin guidelines](https://developers.openai.com/plugins/app-guidelines)
- [OpenAI app-review FAQ](https://developers.openai.com/plugins/deploy/app-review)
- [OpenAI submission requirements](https://developers.openai.com/plugins/deploy/submission)
