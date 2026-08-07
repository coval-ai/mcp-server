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
- Confirm tool discovery returns exactly 27 tools with a title and correct read/write annotations
  for every tool. The nine write tools (`create_agent`, `create_run`, `create_test_set`,
  `create_test_case`, `create_report`, `create_scheduled_run`, `update_agent`, `update_test_case`,
  and `update_scheduled_run`) must advertise `readOnlyHint: false`. On `/mcp`, the additive create
  tools (`create_agent`, `create_test_set`, `create_test_case`, and `create_report`) advertise
  `destructiveHint: false`; the other five write tools advertise `destructiveHint: true`. On
  `/claude/mcp`, all nine write tools advertise `destructiveHint: true`. On both paths,
  `create_run`, `create_scheduled_run`, and `update_scheduled_run` advertise
  `openWorldHint: true`; all other tools advertise `openWorldHint: false`.
- Inspect every input schema discovered from the OpenAI `/mcp` endpoint. No tool may request
  ChatGPT conversation history, a caller-provided session identifier, arbitrary metadata, or an
  unconstrained object. Confirm `consult_sofia` accepts only one bounded standalone prompt and
  `create_agent` clearly identifies the connection field required by its selected model type.
  The Claude endpoint and local package retain their existing advanced input fields as a separate
  compatibility profile.
- Confirm report reads expose bounded row pages and an explicit `has_more` signal. Confirm report
  creation accepts no visibility field and produces an organization-private report.
- Confirm schedule history is bounded, cron creation requires an explicit timezone, and schedule
  creation remains disabled unless `enabled: true` is explicitly supplied.
- Exercise every tool with valid inputs. Confirm write tools affect only disposable test data.
- Confirm `consult_sofia` succeeds for the review organization. Direct API tools and Sofia
  consultation are separate capabilities, so test both.
- Complete reviewer sign-in from a clean browser session using only the credentials supplied in
  the submission portal. The account must require no MFA, SMS or email code, invitation
  acceptance, private-network access, or other setup or verification step. It must already have
  access to the populated review organization.
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
- A fully populated test account whose portal-supplied credentials work without MFA, SMS or email
  verification, invitations, private-network access, or additional setup
- Example prompts and expected outcomes for both direct Coval tools and `consult_sofia`

Never commit test credentials, access tokens, customer data, or private infrastructure details to
this public repository.

## Draft listing copy

**Name:** Coval

**Tagline:** Evaluate and improve voice and chat agents

**Description:** Connect ChatGPT, Claude, or another MCP client to your Coval workspace to inspect
agents, test sets, personas, metrics, evaluation runs, saved reports, run templates, and recurring
schedules. Launch evaluations and update supported resources through explicit write tools, or
consult Sofia for read-only analysis grounded in your organization's evaluation data and Coval's
evaluation workflows.

**Primary use cases:**

- Inspect recent evaluation runs and diagnose performance or configuration issues.
- Create and refine agents, test sets, and test cases, then launch evaluation runs.
- Read bounded report results, create private reports, and inspect recurring evaluation history.
- Prepare disabled schedules from reusable run templates and activate them only when explicitly
  requested.
- Ask Sofia for read-only, organization-grounded evaluation guidance.

**Connection requirements:** A Coval account with access to the organization being connected. The
review account must also have access to `consult_sofia` so every submitted tool can be exercised.

**Data access:** Both read and write. Write operations are exposed as separate tools and carry
write or destructive annotations as applicable.

## OpenAI review test cases

The review account should use a populated, disposable Coval organization. Provide concrete fixture
IDs and credentials only through the submission portal. Replace every `PORTAL_*` placeholder in the
submission artifact with the corresponding exact fixture ID before submitting. Replace generic
expected results for stable fixtures with their exact names, configuration, completion state,
progress, tags, and result summary so the reviewer can verify them objectively. Keep every case
independently runnable: no case may depend on a resource created by another case, a moving "most
recent" target, or a fixed-name disposable resource left by an earlier run. Reset disposable
resources after review.

### Positive cases

1. **Disposable agent creation**
   - Create one uniquely named `MODEL_TYPE_VOICE` agent using a non-routable reviewer SIP address,
     retrieve it, and update only its display name.
   - Expected behavior: `create_agent`, `get_agent`, and `update_agent` each run once after the
     required confirmations; no evaluation starts and the SIP address is never contacted.
   - Fixture: permission to create disposable agents. Generate a fresh UUID v4 or equivalent
     collision-resistant nonce and matching `sip:<nonce>@invalid.example` address for every attempt.
2. **Stable evaluation setup inspection**
   - Retrieve the portal-provided baseline test-set ID, only its test cases, the reviewer metric ID,
     and the canonical reviewer persona ID.
   - Expected behavior: retrieve only those exact resources. Make no changes and do not fall back
     to mutable display-name discovery.
   - Fixture: one baseline test set with two cases, one metric, and one canonical persona.
3. **Independent disposable test content**
   - Create one SCENARIO test set named with a fresh UUID v4 or equivalent collision-resistant
     nonce, add one duplicate-charge test case, and
     update only that case's description.
   - Expected behavior: `create_test_set`, `create_test_case`, and `update_test_case` each run once
     after confirmation. This case must not be reused by another submitted test.
   - Fixture: permission to create disposable test data.
4. **Stable agent and completed-run inspection**
   - Retrieve the portal-provided stable agent ID and completed reviewer-run ID.
   - Expected behavior: call `get_agent` and `get_run`, report only the requested configuration and
     result fields, and perform no writes or evaluation launch.
   - Fixture: an independently valid agent and completed run that do not depend on cases 1 or 3.
5. **Bounded Sofia guidance**
   - Ask Sofia one standalone question containing only two Turn Count scores and a request for one
     task-completion metric.
   - Expected behavior: call `consult_sofia` once with only `prompt`; do not send prior turns or a
     caller session identifier.
   - Expected result: one task-success or task-completion metric recommendation and a concise
     rationale, with no writes.
6. **Private saved report workflow**
   - List saved reports, retrieve the portal-provided stable report with a page size of 20 and the
     reviewer metric filter, then create one uniquely named report over the completed reviewer run.
   - Expected behavior: the stable read returns no more than 20 rows and accurately indicates
     whether more rows exist. The new report is organization-private and accepts no public-sharing
     input.
   - Fixture: one stable saved report, one stable completed run, and one reviewer metric.
7. **Disabled recurring evaluation workflow**
   - List run templates and schedules, retrieve the portal-provided schedule with 20 recent runs,
     then create a uniquely named weekday schedule from the disposable template with a concrete
     timezone and without activation. Update only its display name while it remains disabled.
   - Expected behavior: history returns no more than 20 runs and accurately indicates whether more
     exist. Creation sends `enabled: false`; the update does not activate or trigger an evaluation.
   - Fixture: one stable schedule with history, plus a disposable run template that can be used for
     a disabled schedule. Remove the disposable schedule through the Coval app or API after review.

### Negative cases

1. **Unrelated calendar request**
   - Scenario: ask what meetings are scheduled tomorrow and request that an afternoon call move.
   - Expected behavior: do not invoke Coval because it cannot read or change calendar events.
2. **Unrelated Slack request**
   - Scenario: ask to send a message to a Slack channel.
   - Expected behavior: do not invoke Coval because it cannot send Slack messages.
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
- Select the verified Coval developer or business identity; do not submit while the portal shows
  `No Identity Selected`.
- After deploying the exact reviewed server head, run **Scan Tools** again on the submitted app
  version and confirm the frozen snapshot contains exactly 27 tools with the current schemas and
  annotations.
- Replace any stale portal description with the client-neutral canonical copy in this repository;
  do not claim write support for metrics or personas.
- Run all seven positive and three negative cases in fresh conversations with the clean reviewer
  account, record the exact tool sequence and result, and resolve every mismatch before submitting.
- Use `https://app.coval.dev` as the allowed application link origin if link opening is enabled.
- Do not add challenge tokens, credentials, or fixture IDs to this repository.

## Platform references

- [Claude connector submission](https://claude.com/docs/connectors/building/submission)
- [Claude pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria)
- [OpenAI plugin guidelines](https://developers.openai.com/plugins/app-guidelines)
- [OpenAI app-review FAQ](https://developers.openai.com/plugins/deploy/app-review)
- [OpenAI submission requirements](https://developers.openai.com/plugins/deploy/submission)
