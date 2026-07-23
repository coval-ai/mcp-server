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
- Confirm tool discovery returns exactly 19 tools with a title and correct read/write annotations
  for every tool. The six write tools (`create_agent`, `create_run`, `create_test_set`,
  `create_test_case`, `update_agent`, and `update_test_case`) must advertise
  `readOnlyHint: false` and `destructiveHint: true`. `create_run` alone advertises
  `openWorldHint: true`; the other write tools advertise `openWorldHint: false`.
- Exercise every tool with valid inputs. Confirm write tools affect only disposable test data.
- Confirm `consult_sofia` succeeds for the review organization. Direct API tools and Sofia
  consultation are separate capabilities, so test both.
- Confirm invalid inputs return actionable errors rather than generic server errors.
- Revoke the connection and confirm the client can no longer access the organization.
- Repeat the flow with a user who cannot access the selected organization.

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

The review account should use a populated, disposable Coval organization. Provide the concrete
fixture IDs and credentials only through the submission portal. Reset the disposable resources
after each review run.

### Positive cases

1. **Recent run inspection**
   - Prompt: "List my five most recent evaluation runs and summarize their statuses."
   - Expected behavior: call `list_runs`; do not create or update anything.
   - Expected result: up to five runs with identifiers, names, and statuses plus a short summary.
   - Fixture: at least three recent runs with more than one status.
2. **Agent configuration lookup**
   - Prompt: "Show the configuration of the review voice agent."
   - Expected behavior: call `list_agents` to resolve the name, then `get_agent` with its ID.
   - Expected result: the selected agent's display name, model type, and connection configuration.
   - Fixture: one agent named "Review Voice Agent".
3. **Disposable test-set creation**
   - Prompt: "Create a test set named Directory Review Billing and add one scenario where a caller
     disputes a duplicate charge. The expected behavior is that the agent verifies the duplicate
     and explains the next step."
   - Expected behavior: call `create_test_set`, then `create_test_case` using the returned test-set
     ID.
   - Expected result: one new test set and one linked test case matching the requested scenario.
   - Fixture: permission to create disposable test data; the named test set must not already exist.
4. **Evaluation launch**
   - Prompt: "Run the Directory Review Billing test set against Review Voice Agent using Standard
     Customer, then report the new run ID and initial status."
   - Expected behavior: resolve the named agent, test set, and persona with list tools; call
     `create_run` once.
   - Expected result: one new run with its identifier and initial status.
   - Fixture: the resources from case 3 plus a persona named "Standard Customer".
5. **Sofia diagnosis**
   - Prompt: "Ask Sofia to inspect my most recent unsuccessful run and recommend the next test I
     should add."
   - Expected behavior: call `consult_sofia` once. Sofia may use its read-only Coval tools but must
     not mutate the organization.
   - Expected result: a grounded diagnosis that identifies the run and proposes a concrete next
     test.
   - Fixture: at least one recent unsuccessful run with inspectable results.

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
- [ChatGPT app submission](https://developers.openai.com/apps-sdk/deploy/submission)
