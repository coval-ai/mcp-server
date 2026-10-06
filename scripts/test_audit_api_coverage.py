"""Tests for the live API-coverage audit."""

import io
import tempfile
import unittest
from contextlib import redirect_stderr
from contextlib import redirect_stdout
from pathlib import Path
from urllib.error import HTTPError
from urllib.error import URLError
from unittest.mock import Mock
from unittest.mock import patch

from scripts import audit_api_coverage


class FetchSafetyTests(unittest.TestCase):
    def test_rejects_non_https_url(self):
        with self.assertRaisesRegex(ValueError, "must use HTTPS"):
            audit_api_coverage._validate_fetch_url(
                "file:///etc/passwd",
                audit_api_coverage.DEFAULT_ALLOWED_ORIGINS,
            )

    def test_rejects_disallowed_origin(self):
        with self.assertRaisesRegex(ValueError, "is not allowed"):
            audit_api_coverage._validate_fetch_url(
                "https://example.com/openapi",
                audit_api_coverage.DEFAULT_ALLOWED_ORIGINS,
            )

    def test_rejects_cross_origin_redirect(self):
        handler = audit_api_coverage._AllowedOriginRedirectHandler(
            audit_api_coverage.DEFAULT_ALLOWED_ORIGINS
        )
        with self.assertRaisesRegex(ValueError, "is not allowed"):
            handler.redirect_request(
                Mock(),
                Mock(),
                302,
                "Found",
                {},
                "https://example.com/spec",
            )

    @patch("scripts.audit_api_coverage.build_opener")
    def test_validates_final_response_url(self, build_opener):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.geturl.return_value = "https://example.com/redirected"
        build_opener.return_value.open.return_value = response

        with self.assertRaisesRegex(ValueError, "is not allowed"):
            audit_api_coverage._fetch(
                audit_api_coverage.CATALOG_URL,
                audit_api_coverage.DEFAULT_ALLOWED_ORIGINS,
            )

    @patch("scripts.audit_api_coverage.time.sleep")
    @patch("scripts.audit_api_coverage.build_opener")
    def test_retries_transient_network_failure(self, build_opener, sleep):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.geturl.return_value = audit_api_coverage.CATALOG_URL
        response.read.return_value = b"ok"
        build_opener.return_value.open.side_effect = [
            URLError("temporary"),
            response,
        ]

        result = audit_api_coverage._fetch(
            audit_api_coverage.CATALOG_URL,
            audit_api_coverage.DEFAULT_ALLOWED_ORIGINS,
        )

        self.assertEqual(b"ok", result)
        sleep.assert_called_once_with(1)

    @patch("scripts.audit_api_coverage.time.sleep")
    @patch("scripts.audit_api_coverage.build_opener")
    def test_retries_server_http_error(self, build_opener, sleep):
        server_error = HTTPError(
            audit_api_coverage.CATALOG_URL,
            503,
            "Service Unavailable",
            {},
            None,
        )
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.geturl.return_value = audit_api_coverage.CATALOG_URL
        response.read.return_value = b"ok"
        build_opener.return_value.open.side_effect = [
            server_error,
            response,
        ]

        try:
            result = audit_api_coverage._fetch(
                audit_api_coverage.CATALOG_URL,
                audit_api_coverage.DEFAULT_ALLOWED_ORIGINS,
            )
        finally:
            server_error.close()

        self.assertEqual(b"ok", result)
        sleep.assert_called_once_with(1)

    @patch("scripts.audit_api_coverage.time.sleep")
    @patch("scripts.audit_api_coverage.build_opener")
    def test_does_not_retry_client_http_error(self, build_opener, sleep):
        client_error = HTTPError(
            audit_api_coverage.CATALOG_URL,
            404,
            "Not Found",
            {},
            None,
        )
        build_opener.return_value.open.side_effect = client_error

        try:
            with self.assertRaises(HTTPError):
                audit_api_coverage._fetch(
                    audit_api_coverage.CATALOG_URL,
                    audit_api_coverage.DEFAULT_ALLOWED_ORIGINS,
                )
        finally:
            client_error.close()

        build_opener.return_value.open.assert_called_once()
        sleep.assert_not_called()


class PublishedOperationsTests(unittest.TestCase):
    @staticmethod
    def _specs(*documents: bytes) -> list[dict]:
        with patch("scripts.audit_api_coverage._fetch") as fetch:
            fetch.side_effect = [
                (
                    b'{"specs":['
                    + b",".join(
                        b'{"url":"https://api.coval.dev/%d"}' % index
                        for index in range(len(documents))
                    )
                    + b"]}"
                ),
                *documents,
            ]
            return audit_api_coverage._published_specs(
                audit_api_coverage.CATALOG_URL,
                audit_api_coverage.DEFAULT_ALLOWED_ORIGINS,
            )

    def test_rejects_distinct_operations_with_same_canonical_key(self):
        specs = self._specs(
            b"paths:\n  /v1/agents/{agent_id}:\n    get: {}\n",
            b"paths:\n  /v1/agents/{id}:\n    get: {}\n",
        )

        with self.assertRaisesRegex(RuntimeError, "share canonical key"):
            audit_api_coverage._published_operations(specs)

    def test_deduplicates_identical_operation_across_specs(self):
        specs = self._specs(
            b"paths:\n  /v1/agents/{agent_id}:\n    get: {}\n",
            b"paths:\n  /v1/agents/{agent_id}:\n    get: {}\n",
        )

        self.assertEqual(
            {"GET /agents/{id}": "GET /v1/agents/{agent_id}"},
            audit_api_coverage._published_operations(specs),
        )

    def test_fetches_the_catalog_and_each_spec_once(self):
        with patch("scripts.audit_api_coverage._fetch") as fetch:
            fetch.side_effect = [
                b'{"specs":[{"url":"https://api.coval.dev/a"}]}',
                b"paths: {}\n",
            ]
            audit_api_coverage._published_specs(
                audit_api_coverage.CATALOG_URL,
                audit_api_coverage.DEFAULT_ALLOWED_ORIGINS,
            )

        self.assertEqual(2, fetch.call_count)


class PublishedRequestFieldTests(unittest.TestCase):
    SCHEMAS = {
        "CreateThing": {
            "type": "object",
            "properties": {"display_name": {}, "tags": {}},
        },
        "Composed": {
            "allOf": [
                {"$ref": "#/components/schemas/CreateThing"},
                {"type": "object", "properties": {"extra": {}}},
            ]
        },
        "SelfReferential": {
            "type": "object",
            "properties": {"child": {}},
            "anyOf": [{"$ref": "#/components/schemas/SelfReferential"}],
        },
    }

    def test_resolves_a_reference_to_its_properties(self):
        self.assertEqual(
            {"display_name", "tags"},
            audit_api_coverage._schema_properties(
                {"$ref": "#/components/schemas/CreateThing"}, self.SCHEMAS
            ),
        )

    def test_unions_every_branch_of_a_composed_schema(self):
        self.assertEqual(
            {"display_name", "tags", "extra"},
            audit_api_coverage._schema_properties(
                {"$ref": "#/components/schemas/Composed"}, self.SCHEMAS
            ),
        )

    def test_tolerates_a_self_referential_schema(self):
        self.assertEqual(
            {"child"},
            audit_api_coverage._schema_properties(
                {"$ref": "#/components/schemas/SelfReferential"}, self.SCHEMAS
            ),
        )

    def test_rejects_an_unresolvable_reference(self):
        with self.assertRaisesRegex(RuntimeError, "unknown schema"):
            audit_api_coverage._schema_properties(
                {"$ref": "#/components/schemas/Missing"}, self.SCHEMAS
            )

    def test_collects_only_json_request_bodies_on_body_methods(self):
        spec = {
            "components": {"schemas": self.SCHEMAS},
            "paths": {
                "/things": {
                    "get": {"responses": {}},
                    "post": {
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/CreateThing"
                                    }
                                }
                            }
                        }
                    },
                },
                "/things/{thing_id}/archive": {
                    "post": {"responses": {}},
                },
                "/traces": {
                    "post": {
                        "requestBody": {
                            "content": {"application/x-protobuf": {"schema": {}}}
                        }
                    }
                },
            },
        }

        self.assertEqual(
            {"POST /things": {"display_name", "tags"}},
            audit_api_coverage._published_request_fields([spec]),
        )

    def test_merges_the_same_operation_across_specs(self):
        def spec(field):
            return {
                "components": {"schemas": {}},
                "paths": {
                    "/things": {
                        "post": {
                            "requestBody": {
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {field: {}},
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
            }

        self.assertEqual(
            {"POST /things": {"first", "second"}},
            audit_api_coverage._published_request_fields(
                [spec("first"), spec("second")]
            ),
        )


class ManifestFieldTests(unittest.TestCase):
    def test_rejects_a_missing_field_name(self):
        with self.assertRaisesRegex(ValueError, "non-empty"):
            audit_api_coverage._manifest_field_entries(
                [{"operation": "POST /agents", "reason": "Reviewed"}],
                "known_field_gap",
            )

    def test_rejects_a_method_that_carries_no_request_body(self):
        with self.assertRaisesRegex(ValueError, "invalid operation"):
            audit_api_coverage._manifest_field_entries(
                [{"operation": "GET /agents", "field": "tags", "reason": "Reviewed"}],
                "known_field_gap",
            )

    def test_rejects_a_duplicate_entry(self):
        with self.assertRaisesRegex(ValueError, "duplicate entry"):
            audit_api_coverage._manifest_field_entries(
                [
                    {"operation": "POST /agents", "field": "tags", "reason": "First"},
                    {"operation": "POST /agents", "field": "tags", "reason": "Second"},
                ],
                "known_field_gap",
            )

    def test_canonicalizes_the_operation_path(self):
        entries = audit_api_coverage._manifest_field_entries(
            [
                {
                    "operation": "PATCH /agents/{agent_id}",
                    "field": "tags",
                    "reason": "Reviewed",
                }
            ],
            "known_field_gap",
        )

        self.assertEqual([("PATCH /agents/{id}", "tags")], list(entries))


class FieldReconciliationTests(unittest.TestCase):
    def test_classifies_gaps_extras_and_stale_exceptions(self):
        result = audit_api_coverage._field_reconciliation(
            published_fields={"POST /things": {"name", "tags"}},
            mcp_fields={"POST /things": {"name", "legacy"}},
            known_field_gaps={("POST /things", "retired"): {}},
            allowed_extra_fields={("POST /things", "legacy"): {}},
        )

        self.assertEqual({("POST /things", "tags")}, result["new_gaps"])
        self.assertEqual({("POST /things", "retired")}, result["stale_gaps"])
        self.assertEqual(set(), result["unexpected_extras"])
        self.assertEqual(set(), result["stale_allowed_extras"])
        self.assertEqual(2, result["compared_field_count"])
        self.assertEqual(1, result["modeled_field_count"])

    def test_counts_a_passthrough_operation_as_fully_modeled(self):
        result = audit_api_coverage._field_reconciliation(
            published_fields={"POST /things": {"name", "tags"}},
            mcp_fields={"POST /things": None},
            known_field_gaps={},
            allowed_extra_fields={},
        )

        self.assertEqual(set(), result["actual_gaps"])
        self.assertEqual(2, result["modeled_field_count"])

    def test_ignores_an_operation_no_tool_reaches(self):
        result = audit_api_coverage._field_reconciliation(
            published_fields={"POST /things": {"name"}, "POST /others": {"name"}},
            mcp_fields={"POST /things": {"name"}},
            known_field_gaps={},
            allowed_extra_fields={},
        )

        self.assertEqual(["POST /things"], result["compared_operations"])
        self.assertEqual(set(), result["actual_gaps"])


class ManifestTests(unittest.TestCase):
    def test_rejects_missing_reason(self):
        with self.assertRaisesRegex(ValueError, "non-empty"):
            audit_api_coverage._manifest_operations(
                [{"operation": "GET /agents"}],
                "known_gap",
            )

    def test_rejects_invalid_http_method(self):
        with self.assertRaisesRegex(ValueError, "invalid operation"):
            audit_api_coverage._manifest_operations(
                [{"operation": "HEAD /agents", "reason": "Not supported"}],
                "known_gap",
            )

    def test_rejects_duplicate_operation(self):
        with self.assertRaisesRegex(ValueError, "duplicate operation"):
            audit_api_coverage._manifest_operations(
                [
                    {"operation": "GET /agents", "reason": "First"},
                    {"operation": "GET /agents", "reason": "Second"},
                ],
                "known_gap",
            )


class AuditAggregationTests(unittest.TestCase):
    def _audit(
        self,
        manifest: str,
        published: dict[str, str],
        commands: dict[str, dict],
        published_fields: dict[str, set[str]] | None = None,
        mcp_fields: dict[str, set[str] | None] | None = None,
    ) -> tuple[dict, bool]:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "api-coverage.toml"
            manifest_path.write_text(manifest)
            with (
                patch.object(audit_api_coverage, "MANIFEST_PATH", manifest_path),
                patch.object(audit_api_coverage, "_published_specs", return_value=[]),
                patch.object(
                    audit_api_coverage,
                    "_published_operations",
                    return_value=published,
                ),
                patch.object(
                    audit_api_coverage,
                    "_published_request_fields",
                    return_value=published_fields or {},
                ),
                patch.object(audit_api_coverage, "_client_methods", return_value={}),
                patch.object(
                    audit_api_coverage,
                    "_client_operations",
                    return_value=commands,
                ),
                patch.object(
                    audit_api_coverage,
                    "_tool_operations",
                    return_value=(commands, []),
                ),
                patch.object(
                    audit_api_coverage,
                    "_mcp_request_fields",
                    return_value=mcp_fields or {},
                ),
            ):
                return audit_api_coverage.audit(audit_api_coverage.CATALOG_URL)

    def test_accepts_reviewed_gap_and_allowed_extra(self):
        manifest = f"""
[snapshot]
catalog_url = "{audit_api_coverage.CATALOG_URL}"
published_operations = 2
mcp_supported_operations = 1
published_request_fields = 0
mcp_modeled_request_fields = 0

[[known_gap]]
operation = "GET /beta"
reason = "Reviewed"

[[allowed_extra]]
operation = "POST /gamma"
reason = "Pre-deploy"
"""
        published = {
            "GET /alpha": "GET /v1/alpha",
            "GET /beta": "GET /v1/beta",
        }
        commands = {
            "GET /alpha": {"operation": "GET /alpha"},
            "POST /gamma": {"operation": "POST /gamma"},
        }

        report, passed = self._audit(manifest, published, commands)

        self.assertTrue(passed)
        self.assertEqual(1, report["known_gap_count"])
        self.assertEqual([], report["new_gaps"])
        self.assertEqual([], report["unexpected_mcp_operations"])

    def test_classifies_new_gap_and_unexpected_extra_as_failure(self):
        manifest = f"""
[snapshot]
catalog_url = "{audit_api_coverage.CATALOG_URL}"
published_operations = 2
mcp_supported_operations = 1
published_request_fields = 0
mcp_modeled_request_fields = 0
"""
        published = {
            "GET /alpha": "GET /v1/alpha",
            "GET /beta": "GET /v1/beta",
        }
        commands = {
            "GET /alpha": {"operation": "GET /alpha"},
            "POST /gamma": {"operation": "POST /gamma"},
        }

        report, passed = self._audit(manifest, published, commands)

        self.assertFalse(passed)
        self.assertEqual(["GET /v1/beta"], report["new_gaps"])
        self.assertEqual(["POST /gamma"], report["unexpected_mcp_operations"])

    def test_classifies_an_unreviewed_dropped_field_as_failure(self):
        manifest = f"""
[snapshot]
catalog_url = "{audit_api_coverage.CATALOG_URL}"
published_operations = 1
mcp_supported_operations = 1
published_request_fields = 2
mcp_modeled_request_fields = 1
"""
        published = {"POST /things": "POST /v1/things"}
        commands = {"POST /things": {"operation": "POST /things"}}

        report, passed = self._audit(
            manifest,
            published,
            commands,
            published_fields={"POST /things": {"name", "tags"}},
            mcp_fields={"POST /things": {"name"}},
        )

        self.assertFalse(passed)
        self.assertEqual(["POST /things tags"], report["new_field_gaps"])
        self.assertEqual(["POST /things tags"], report["all_current_field_gaps"])

    def test_accepts_a_reviewed_field_gap_and_allowed_extra_field(self):
        manifest = f"""
[snapshot]
catalog_url = "{audit_api_coverage.CATALOG_URL}"
published_operations = 1
mcp_supported_operations = 1
published_request_fields = 2
mcp_modeled_request_fields = 1

[[known_field_gap]]
operation = "POST /things"
field = "tags"
reason = "Reviewed"

[[allowed_extra_field]]
operation = "POST /things"
field = "legacy"
reason = "Served but undocumented"
"""
        published = {"POST /things": "POST /v1/things"}
        commands = {"POST /things": {"operation": "POST /things"}}

        report, passed = self._audit(
            manifest,
            published,
            commands,
            published_fields={"POST /things": {"name", "tags"}},
            mcp_fields={"POST /things": {"name", "legacy"}},
        )

        self.assertTrue(passed)
        self.assertEqual(1, report["known_field_gap_count"])
        self.assertEqual([], report["new_field_gaps"])
        self.assertEqual([], report["unexpected_mcp_request_fields"])

    def test_rejects_request_field_in_multiple_manifest_sections(self):
        manifest = """
[snapshot]
catalog_url = "https://api.coval.dev/v1/openapi"
published_operations = 0
mcp_supported_operations = 0
published_request_fields = 0
mcp_modeled_request_fields = 0

[[known_field_gap]]
operation = "POST /agents"
field = "tags"
reason = "Reviewed"

[[allowed_extra_field]]
operation = "POST /agents"
field = "tags"
reason = "Served but undocumented"
"""
        with self.assertRaisesRegex(ValueError, "only one section"):
            self._audit(manifest, {}, {})

    def test_rejects_operation_in_multiple_manifest_sections(self):
        manifest = """
[snapshot]
catalog_url = "https://api.coval.dev/v1/openapi"
published_operations = 0
mcp_supported_operations = 0
published_request_fields = 0
mcp_modeled_request_fields = 0

[[known_gap]]
operation = "GET /agents"
reason = "Reviewed"

[[allowed_extra]]
operation = "GET /agents"
reason = "Pre-deploy"
"""
        with self.assertRaisesRegex(ValueError, "only one section"):
            self._audit(manifest, {}, {})


class SnapshotTests(unittest.TestCase):
    def test_reports_stale_snapshot_fields(self):
        mismatches = audit_api_coverage._snapshot_mismatches(
            {
                "catalog_url": audit_api_coverage.CATALOG_URL,
                "published_operations": 10,
                "mcp_supported_operations": 8,
                "published_request_fields": 40,
                "mcp_modeled_request_fields": 40,
            },
            catalog_url=audit_api_coverage.CATALOG_URL,
            published_operation_count=11,
            supported_operation_count=8,
            compared_field_count=40,
            modeled_field_count=40,
        )

        self.assertEqual(
            ["published_operations: recorded 10, current 11"],
            mismatches,
        )

    def test_reports_an_unrecorded_request_field_count(self):
        mismatches = audit_api_coverage._snapshot_mismatches(
            {
                "catalog_url": audit_api_coverage.CATALOG_URL,
                "published_operations": 10,
                "mcp_supported_operations": 8,
            },
            catalog_url=audit_api_coverage.CATALOG_URL,
            published_operation_count=10,
            supported_operation_count=8,
            compared_field_count=40,
            modeled_field_count=39,
        )

        self.assertEqual(
            [
                "published_request_fields: recorded None, current 40",
                "mcp_modeled_request_fields: recorded None, current 39",
            ],
            mismatches,
        )


class MarkdownReportTests(unittest.TestCase):
    def setUp(self):
        self.report = {
            "catalog_url": audit_api_coverage.CATALOG_URL,
            "published_operation_count": 3,
            "client_operation_count": 2,
            "tool_operation_count": 2,
            "supported_operation_count": 2,
            "known_gap_count": 0,
            "new_gaps": ["GET /v1/beta"],
            "stale_gaps": [],
            "unexpected_mcp_operations": [],
            "stale_allowed_extras": [],
            "stale_planned_operations": [],
            "client_only_operations": [],
            "unmapped_tool_client_methods": [],
            "snapshot_mismatches": ["published_operations: recorded 2, current 3"],
            "all_current_gaps": ["GET /v1/beta"],
            "compared_request_field_count": 4,
            "modeled_request_field_count": 3,
            "known_field_gap_count": 0,
            "new_field_gaps": ["POST /things tags"],
            "stale_field_gaps": [],
            "unexpected_mcp_request_fields": [],
            "stale_allowed_extra_fields": [],
            "all_current_field_gaps": ["POST /things tags"],
        }

    def test_renders_deterministic_actionable_report(self):
        rendered = audit_api_coverage.render_markdown_report(self.report, False)

        self.assertIn("| Reconciliation status | ACTION REQUIRED |", rendered)
        self.assertIn("- `GET /v1/beta`", rendered)
        self.assertIn(
            "- `published_operations: recorded 2, current 3`",
            rendered,
        )
        self.assertIn("| Request fields the MCP client sends | 3 |", rendered)
        self.assertIn("## New published request fields the MCP client drops", rendered)
        self.assertIn("- `POST /things tags`", rendered)
        self.assertNotIn("Generated at", rendered)

    @patch("scripts.audit_api_coverage.audit")
    def test_allow_drift_writes_report_and_returns_success(self, audit):
        audit.return_value = (self.report, False)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "coverage.md"
            argv = [
                "audit_api_coverage.py",
                "--write-markdown",
                str(output),
                "--allow-drift",
            ]
            with (
                patch("sys.argv", argv),
                redirect_stdout(io.StringIO()),
            ):
                result = audit_api_coverage.main()

            self.assertEqual(0, result)
            self.assertIn("ACTION REQUIRED", output.read_text())

    def test_allow_drift_requires_markdown_output(self):
        with (
            patch("sys.argv", ["audit_api_coverage.py", "--allow-drift"]),
            redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as exception,
        ):
            audit_api_coverage.main()

        self.assertEqual(2, exception.exception.code)


CLIENT_SOURCE = """\
export interface UpdateThingInput {
  display_name?: string;
  tags?: string[];
}

export class CovalApiClient {
  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return fetch(path) as T;
  }

  async listThings(params?: { page_size?: number }) {
    return this.request<{ things: unknown[]; next_page_token?: string }>(
      'GET',
      '/things',
      undefined,
      params as Record<string, string | number | boolean | undefined>
    );
  }

  async createThing(data: {
    // The display name shown in the app.
    display_name: string;
    metadata?: Record<string, unknown>;
    options?: { iteration_count?: number; concurrency?: number };
  }) {
    return this.request<{ thing: unknown }>('POST', '/things', data);
  }

  async updateThing(thingId: string, data: UpdateThingInput) {
    return this.request<{ thing: unknown }>('PATCH', `/things/${thingId}`, data);
  }

  async replaceThing(thingId: string, data: Record<string, unknown>) {
    return this.request<{ thing: unknown }>('PUT', `/things/${thingId}`, data);
  }

  async deleteThing(thingId: string) {
    return this.request<Record<string, never>>('DELETE', `/things/${thingId}`);
  }

  async consult(input: { sessionId?: string }) {
    const token = await this.requestToken(input.sessionId);
    return token;
  }

  private async requestToken(sessionId?: string) {
    return this.request<{ token: string }>(
      'POST',
      '/tokens',
      {
        client_id: 'coval-mcp',
        ...(sessionId ? { session_id: sessionId } : {}),
      },
    );
  }
}

function outside() {
  return 'https://example.com/'.replace(/\\/$/, '');
}
"""


class TypeScriptExtractionTests(unittest.TestCase):
    def setUp(self):
        self.methods = audit_api_coverage._client_methods(CLIENT_SOURCE)

    def _operations(self, name):
        return self.methods[name]["operations"]

    def test_reads_an_inline_object_type_body(self):
        self.assertEqual(
            {"POST /things": {"display_name", "metadata", "options"}},
            self._operations("createThing"),
        )

    def test_resolves_a_named_interface_body_and_a_template_path(self):
        self.assertEqual(
            {"PATCH /things/{id}": {"display_name", "tags"}},
            self._operations("updateThing"),
        )

    def test_treats_an_open_record_body_as_passthrough(self):
        self.assertEqual({"PUT /things/{id}": None}, self._operations("replaceThing"))

    def test_records_calls_without_a_body(self):
        self.assertEqual({"GET /things": "no-body"}, self._operations("listThings"))
        self.assertEqual(
            {"DELETE /things/{id}": "no-body"}, self._operations("deleteThing")
        )

    def test_reads_object_literal_keys_including_conditional_spreads(self):
        self.assertEqual(
            {"POST /tokens": {"client_id", "session_id"}},
            self._operations("requestToken"),
        )

    def test_records_calls_to_other_client_methods(self):
        self.assertEqual({"requestToken"}, self.methods["consult"]["calls"])

    def test_ignores_code_outside_the_client_class(self):
        self.assertNotIn("outside", self.methods)

    def test_rejects_an_unresolvable_body_expression(self):
        source = CLIENT_SOURCE.replace(
            "'/things', data);", "'/things', buildBody(data));"
        )
        with self.assertRaisesRegex(RuntimeError, "could not resolve the request body"):
            audit_api_coverage._client_methods(source)

    def test_rejects_an_object_type_member_it_cannot_read(self):
        source = CLIENT_SOURCE.replace(
            "display_name: string;\n    metadata",
            "display_name:\n      | 'a'\n      | 'b';\n    metadata",
        )
        with self.assertRaisesRegex(RuntimeError, "unrecognized object type member"):
            audit_api_coverage._client_methods(source)

    def test_rejects_a_dynamic_path(self):
        source = CLIENT_SOURCE.replace(
            "'/things',\n      undefined", "path,\n      undefined"
        )
        with self.assertRaisesRegex(RuntimeError, "string literal"):
            audit_api_coverage._client_methods(source)


class ToolCoverageTests(unittest.TestCase):
    def _tool_operations(self, tool_source):
        methods = audit_api_coverage._client_methods(CLIENT_SOURCE)
        client = audit_api_coverage._client_operations(methods)
        with tempfile.TemporaryDirectory() as directory:
            tools = Path(directory)
            (tools / "things.ts").write_text(tool_source)
            with patch.object(audit_api_coverage, "TOOLS_PATH", tools):
                return audit_api_coverage._tool_operations(methods, client)

    def test_counts_only_operations_a_tool_reaches(self):
        operations, unmapped = self._tool_operations(
            "const result = await client.createThing(params);\n"
        )

        self.assertEqual(["POST /things"], sorted(operations))
        self.assertEqual([], unmapped)

    def test_follows_calls_into_private_client_methods(self):
        operations, _ = self._tool_operations("await client.consult({ sessionId });\n")

        self.assertEqual(["POST /tokens"], sorted(operations))

    def test_reports_a_tool_call_to_an_unknown_client_method(self):
        _, unmapped = self._tool_operations("await client.archiveThing(id);\n")

        self.assertEqual(["archiveThing"], unmapped)

    def test_unions_bodies_and_marks_passthrough_operations(self):
        operations, _ = self._tool_operations(
            "await client.createThing(a);\nawait client.replaceThing(id, b);\n"
        )

        self.assertEqual(
            {
                "POST /things": {"display_name", "metadata", "options"},
                "PUT /things/{id}": None,
            },
            audit_api_coverage._mcp_request_fields(operations),
        )


class RealSourceTests(unittest.TestCase):
    """Offline checks that the extractor still understands this repository."""

    def test_parses_the_client_and_resolves_every_tool_call(self):
        methods = audit_api_coverage._client_methods(
            audit_api_coverage.CLIENT_PATH.read_text()
        )
        client = audit_api_coverage._client_operations(methods)
        operations, unmapped = audit_api_coverage._tool_operations(methods, client)

        self.assertEqual([], unmapped)
        self.assertIn("GET /runs", operations)
        # consult_sofia reaches the token exchange through a private method.
        self.assertIn("POST /sofia/delegation-token", operations)


if __name__ == "__main__":
    unittest.main()
