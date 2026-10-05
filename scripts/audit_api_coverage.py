"""Compare MCP tool operations and request fields with Coval's OpenAPI catalog.

The audit covers two layers. Route coverage asks whether every published
operation is reachable from a registered MCP tool. Request-field coverage asks
whether every published request-body property is declared on the body the
client in ``src/client.ts`` sends, because a typed body silently omits any
field it does not declare.

The audit is intentionally live: the public catalog is the source of truth, while
``api-coverage.toml`` records reviewed gaps. Run it from the repository root:

    python3 scripts/audit_api_coverage.py

PyYAML is required because the public specs are YAML:

    python3 -m pip install --requirement scripts/requirements-audit.txt

This is the MCP counterpart of the CLI's ``scripts/audit_api_coverage.py``. The
catalog, manifest, and report logic match it; only the source extraction reads
TypeScript instead of Rust.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import tomllib
import yaml

CATALOG_URL = "https://api.coval.dev/v1/openapi"
DEFAULT_ALLOWED_ORIGINS = frozenset({"https://api.coval.dev"})
HTTP_METHODS = frozenset({"delete", "get", "patch", "post", "put"})
REQUEST_BODY_METHODS = frozenset({"patch", "post", "put"})
REQUEST_BODY_MEDIA_TYPE = "application/json"
FETCH_ATTEMPTS = 3
ROOT = Path(__file__).resolve().parents[1]
CLIENT_PATH = ROOT / "src" / "client.ts"
CLIENT_CLASS = "CovalApiClient"
TOOLS_PATH = ROOT / "src" / "tools"
MANIFEST_PATH = ROOT / "api-coverage.toml"

# A body typed as an open record forwards caller JSON verbatim, so it cannot
# drop a published field the way a declared object type can.
PASSTHROUGH_BODY = None


def _https_origin(url: str) -> str:
    if any(character.isspace() for character in url):
        raise ValueError(f"URL must not contain whitespace: {url!r}")
    parsed = urlsplit(url)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ValueError(f"URL must use HTTPS and include a host: {url!r}")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError(f"URL must not include credentials: {url!r}")
    try:
        port = parsed.port
    except ValueError as exception:
        raise ValueError(f"URL has an invalid port: {url!r}") from exception
    host = parsed.hostname.encode("idna").decode("ascii").lower().rstrip(".")
    return f"https://{host}" if port in (None, 443) else f"https://{host}:{port}"


def _normalize_allowed_origin(origin: str) -> str:
    parsed = urlsplit(origin)
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError(
            f"allowed origin must not include a path, query, or fragment: {origin!r}"
        )
    return _https_origin(origin)


def _validate_fetch_url(url: str, allowed_origins: frozenset[str]) -> None:
    parsed = urlsplit(url)
    if parsed.fragment:
        raise ValueError(f"fetch URL must not include a fragment: {url!r}")
    origin = _https_origin(url)
    if origin not in allowed_origins:
        raise ValueError(f"URL origin {origin!r} is not allowed")


class _AllowedOriginRedirectHandler(HTTPRedirectHandler):
    def __init__(self, allowed_origins: frozenset[str]):
        super().__init__()
        self._allowed_origins = allowed_origins

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _validate_fetch_url(newurl, self._allowed_origins)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _fetch(url: str, allowed_origins: frozenset[str]) -> bytes:
    _validate_fetch_url(url, allowed_origins)
    # The URL is HTTPS and origin-allowlisted above; redirects are checked by the custom handler.
    request = Request(  # noqa: S310
        url, headers={"User-Agent": "coval-mcp-api-coverage-audit"}
    )
    opener = build_opener(_AllowedOriginRedirectHandler(allowed_origins))
    for attempt in range(FETCH_ATTEMPTS):
        try:
            with opener.open(request, timeout=30) as response:
                _validate_fetch_url(response.geturl(), allowed_origins)
                return response.read()
        except HTTPError as error:
            if error.code < 500 or attempt == FETCH_ATTEMPTS - 1:
                raise
        except (TimeoutError, URLError):
            if attempt == FETCH_ATTEMPTS - 1:
                raise
        time.sleep(2**attempt)
    raise AssertionError("fetch retry loop exited unexpectedly")


def _canonical_operation(method: str, path: str) -> str:
    path = path.removeprefix("/v1")
    path = re.sub(r"\{[^}]*\}", "{id}", path)
    return f"{method.upper()} {path}"


def _published_specs(catalog_url: str, allowed_origins: frozenset[str]) -> list[dict]:
    """Fetch the catalog index and every per-resource spec exactly once."""

    catalog = json.loads(_fetch(catalog_url, allowed_origins))
    return [
        yaml.safe_load(_fetch(entry["url"], allowed_origins))
        for entry in catalog["specs"]
    ]


def _published_operations(specs: list[dict]) -> dict[str, str]:
    operations: dict[str, str] = {}
    for spec in specs:
        for path, path_item in (spec.get("paths") or {}).items():
            for method in HTTP_METHODS & set(path_item):
                canonical = _canonical_operation(method, path)
                display = f"{method.upper()} {path}"
                previous = operations.get(canonical)
                if previous is not None and previous != display:
                    raise RuntimeError(
                        f"published operations {previous!r} and {display!r} "
                        f"share canonical key {canonical!r}"
                    )
                operations[canonical] = display
    return operations


def _schema_properties(
    schema: dict, schemas: dict, seen: tuple[str, ...] = ()
) -> set[str]:
    """Return the top-level JSON property names a request-body schema accepts."""

    reference = schema.get("$ref")
    if reference is not None:
        name = reference.rsplit("/", 1)[-1]
        if name in seen:
            return set()
        target = schemas.get(name)
        if target is None:
            raise RuntimeError(f"request body references unknown schema {name!r}")
        return _schema_properties(target, schemas, (*seen, name))

    properties = set(schema.get("properties") or {})
    # A composed schema accepts every branch's properties, because one typed
    # body has to be able to send whichever branch the caller picked.
    for keyword in ("allOf", "anyOf", "oneOf"):
        for subschema in schema.get(keyword) or []:
            properties |= _schema_properties(subschema, schemas, seen)
    return properties


def _published_request_fields(specs: list[dict]) -> dict[str, set[str]]:
    """Map each published body operation to its JSON request-body properties."""

    request_fields: dict[str, set[str]] = {}
    for spec in specs:
        schemas = (spec.get("components") or {}).get("schemas") or {}
        for path, path_item in (spec.get("paths") or {}).items():
            for method in REQUEST_BODY_METHODS & set(path_item):
                operation = path_item[method]
                if not isinstance(operation, dict):
                    continue
                content = (operation.get("requestBody") or {}).get("content") or {}
                media = content.get(REQUEST_BODY_MEDIA_TYPE)
                if media is None:
                    continue
                canonical = _canonical_operation(method, path)
                properties = _schema_properties(media.get("schema") or {}, schemas)
                request_fields.setdefault(canonical, set()).update(properties)
    return request_fields


# --- TypeScript source extraction -------------------------------------------
#
# The extractor reads the formatted source rather than compiling it. It
# understands the shapes src/client.ts actually uses and raises on anything
# else, so an unrecognized change fails loudly instead of under-reporting.

_CLOSERS = {"(": ")", "{": "}", "[": "]", "<": ">"}


def _skip_string(source: str, index: int) -> int:
    """Return the index just past the string or template literal at ``index``."""

    quote = source[index]
    position = index + 1
    while position < len(source):
        character = source[position]
        if character == "\\":
            position += 2
            continue
        if quote == "`" and source.startswith("${", position):
            position = _matching(source, position + 1) + 1
            continue
        if character == quote:
            return position + 1
        position += 1
    raise RuntimeError(f"unterminated string starting at offset {index}")


def _matching(source: str, open_index: int) -> int:
    """Return the index of the bracket that closes ``source[open_index]``."""

    stack = [_CLOSERS[source[open_index]]]
    position = open_index + 1
    while position < len(source):
        character = source[position]
        if character in "'\"`":
            position = _skip_string(source, position)
            continue
        if source.startswith("//", position):
            position = source.index("\n", position)
            continue
        if source.startswith("/*", position):
            position = source.index("*/", position) + 2
            continue
        # Angle brackets only nest inside a generic argument list; an arrow's
        # `>` never closes one.
        if character == "<" and stack[-1] == ">":
            stack.append(">")
        elif character in "({[":
            stack.append(_CLOSERS[character])
        elif character == ">" and source[position - 1] == "=":
            pass
        elif character == stack[-1]:
            stack.pop()
            if not stack:
                return position
        position += 1
    raise RuntimeError(f"unbalanced {source[open_index]!r} at offset {open_index}")


def _strip_comments(text: str) -> str:
    """Remove ``//`` and ``/* */`` comments outside string literals."""

    kept: list[str] = []
    position = 0
    while position < len(text):
        character = text[position]
        if character in "'\"`":
            end = _skip_string(text, position)
            kept.append(text[position:end])
            position = end
        elif text.startswith("//", position):
            newline = text.find("\n", position)
            position = len(text) if newline == -1 else newline
        elif text.startswith("/*", position):
            position = text.index("*/", position) + 2
        else:
            kept.append(character)
            position += 1
    return "".join(kept)


def _split_top_level(text: str, separators: str, *, types: bool = False) -> list[str]:
    """Split ``text`` on separators that are not nested in brackets or strings.

    ``types`` treats ``<`` as a generic argument list, which is only correct in
    type annotations; in expressions it is a comparison.
    """

    text = _strip_comments(text)
    parts: list[str] = []
    start = 0
    position = 0
    while position < len(text):
        character = text[position]
        if character in "'\"`":
            position = _skip_string(text, position)
            continue
        if character in "({[" or (types and character == "<"):
            position = _matching(text, position) + 1
            continue
        if character in separators:
            parts.append(text[start:position])
            start = position + 1
        position += 1
    parts.append(text[start:])
    return [part.strip() for part in parts if part.strip()]


_MEMBER_NAME = re.compile(
    r"^(?:readonly\s+)?(?P<name>[A-Za-z_$][\w$]*|'[^']+'|\"[^\"]+\")\s*\??\s*:"
)


def _type_literal_fields(type_text: str) -> set[str] | None:
    """Return the property names of an inline object type, or None if open."""

    body = type_text.strip()
    if not (body.startswith("{") and body.endswith("}")):
        raise RuntimeError(f"expected an object type literal: {type_text!r}")
    fields: set[str] = set()
    # Members end at `;`, `,`, or a line break; a member spanning lines fails
    # the name match below rather than being silently skipped.
    for member in _split_top_level(body[1:-1], ";,\n", types=True):
        if member.startswith("["):
            return PASSTHROUGH_BODY
        match = _MEMBER_NAME.match(member)
        if match is None:
            raise RuntimeError(f"unrecognized object type member: {member!r}")
        fields.add(match.group("name").strip("'\""))
    return fields


def _object_literal_fields(literal: str) -> set[str]:
    """Return the keys an object literal can produce, including spread branches."""

    body = literal.strip()
    if not (body.startswith("{") and body.endswith("}")):
        raise RuntimeError(f"expected an object literal: {literal!r}")
    fields: set[str] = set()
    for member in _split_top_level(body[1:-1], ","):
        if member.startswith("..."):
            # `...(condition ? { key: value } : {})` adds keys conditionally.
            spread = member[3:].strip()
            if spread.startswith("(") and spread.endswith(")"):
                spread = spread[1:-1]
            literals = [
                branch
                for branch in _split_top_level(spread, "?:")
                if branch.startswith("{")
            ]
            if not literals:
                raise RuntimeError(f"unrecognized spread in request body: {member!r}")
            for nested in literals:
                fields |= _object_literal_fields(nested)
            continue
        key = re.match(
            r"^(?P<name>[A-Za-z_$][\w$]*|'[^']+'|\"[^\"]+\")\s*(?::|$)", member
        )
        if key is None:
            raise RuntimeError(f"unrecognized object literal member: {member!r}")
        fields.add(key.group("name").strip("'\""))
    return fields


def _named_type_fields(source: str, name: str) -> set[str] | None:
    """Resolve a named interface or object type alias declared in ``source``."""

    declaration = re.search(
        rf"(?m)^(?:export\s+)?(?:interface\s+{name}\s*(?:extends[^{{]*)?|type\s+{name}\s*=\s*)\{{",
        source,
    )
    if declaration is None:
        raise RuntimeError(
            f"request body type {name!r} is not declared in {CLIENT_PATH.name}"
        )
    if "extends" in declaration.group(0):
        raise RuntimeError(f"request body interface {name!r} extends another type")
    open_index = declaration.end() - 1
    return _type_literal_fields(source[open_index : _matching(source, open_index) + 1])


def _body_fields(type_text: str, source: str) -> set[str] | None:
    """Return the fields a parameter type declares, or None for an open record."""

    type_text = type_text.strip()
    if type_text.startswith("{"):
        return _type_literal_fields(type_text)
    if re.fullmatch(r"Record<\s*string\s*,[^>]*>|unknown|object", type_text):
        return PASSTHROUGH_BODY
    if re.fullmatch(r"[A-Z][\w$]*", type_text):
        return _named_type_fields(source, type_text)
    raise RuntimeError(f"unrecognized request body type: {type_text!r}")


def _parameters(signature: str) -> dict[str, str]:
    """Map each parameter name in a method signature to its type annotation."""

    parameters: dict[str, str] = {}
    for parameter in _split_top_level(signature, ",", types=True):
        name, separator, annotation = parameter.partition(":")
        if not separator:
            continue
        # Drop a default value; `=>` in a function type is not one.
        annotation = re.split(r"=(?!>)", annotation, maxsplit=1)[0]
        parameters[name.strip().rstrip("?")] = annotation.strip()
    return parameters


def _template_path(argument: str) -> str:
    argument = argument.strip()
    if argument[:1] not in "'\"`" or argument[-1:] != argument[:1]:
        raise RuntimeError(f"request path must be a string literal: {argument!r}")
    path = re.sub(r"\$\{[^}]*\}", "{id}", argument[1:-1])
    if not path.startswith("/"):
        raise RuntimeError(f"request path must start with '/': {argument!r}")
    return path


_METHOD_START = re.compile(
    r"(?m)^  (?:(?:private|public|protected)\s+)?(?:static\s+)?(?:async\s+)?"
    r"(?P<name>[A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\s*\("
)
_REQUEST_CALL = re.compile(r"\bthis\.request(?![\w$])\s*")
_THIS_CALL = re.compile(r"\bthis\.(?P<name>[A-Za-z_$][\w$]*)\s*\(")


def _class_body(source: str) -> str:
    """Return the client class body, which ends at the first column-0 brace.

    Formatting guarantees that brace; scanning the whole class for its match
    would also have to understand regular-expression literals.
    """

    declaration = re.search(rf"(?m)^export class {CLIENT_CLASS}\b[^{{]*\{{\n", source)
    if declaration is None:
        raise RuntimeError(f"class {CLIENT_CLASS} was not found in {CLIENT_PATH}")
    end = re.compile(r"(?m)^\}").search(source, declaration.end())
    if end is None:
        raise RuntimeError(
            f"class {CLIENT_CLASS} has no closing brace in {CLIENT_PATH}"
        )
    return source[declaration.end() : end.start()]


def _request_calls(block: str) -> list[list[str]]:
    """Return the argument lists of every ``this.request`` call in ``block``."""

    calls: list[list[str]] = []
    for match in _REQUEST_CALL.finditer(block):
        position = match.end()
        if block.startswith("<", position):
            position = _matching(block, position) + 1
        while block[position].isspace():
            position += 1
        if block[position] != "(":
            raise RuntimeError(
                f"could not parse this.request call near: {block[match.start() : match.start() + 80]!r}"
            )
        close = _matching(block, position)
        calls.append(_split_top_level(block[position + 1 : close], ","))
    return calls


def _client_methods(source: str) -> dict[str, dict]:
    """Parse every client method: its operations, bodies, and internal calls."""

    body = _class_body(source)
    starts = list(_METHOD_START.finditer(body))
    methods: dict[str, dict] = {}
    for index, start in enumerate(starts):
        name = start.group("name")
        end = starts[index + 1].start() if index + 1 < len(starts) else len(body)
        block = body[start.start() : end]
        open_paren = start.end() - 1 - start.start()
        parameters = _parameters(block[open_paren + 1 : _matching(block, open_paren)])

        operations: dict[str, set[str] | None | str] = {}
        for arguments in _request_calls(block):
            if len(arguments) < 2:
                raise RuntimeError(
                    f"{CLIENT_CLASS}.{name} calls this.request without a path"
                )
            method = arguments[0].strip("'\"`").upper()
            if method.lower() not in HTTP_METHODS:
                raise RuntimeError(
                    f"{CLIENT_CLASS}.{name} uses unsupported method {method!r}"
                )
            path = _template_path(arguments[1])
            body_argument = arguments[2] if len(arguments) > 2 else "undefined"
            if body_argument == "undefined":
                fields: set[str] | None | str = "no-body"
            elif body_argument.startswith("{"):
                fields = _object_literal_fields(body_argument)
            elif body_argument in parameters:
                fields = _body_fields(parameters[body_argument], source)
            else:
                raise RuntimeError(
                    f"could not resolve the request body {body_argument!r} "
                    f"in {CLIENT_CLASS}.{name}"
                )
            operations[_canonical_operation(method, path)] = fields

        methods[name] = {
            "operations": operations,
            "calls": {
                call.group("name")
                for call in _THIS_CALL.finditer(block)
                if call.group("name") != "request"
            },
        }
    return methods


def _client_operations(methods: dict[str, dict]) -> dict[str, dict]:
    """Index client methods by the canonical operation each one calls."""

    operations: dict[str, dict] = {}
    for name, method in methods.items():
        for canonical, fields in method["operations"].items():
            operation = operations.setdefault(
                canonical,
                {"operation": canonical, "client_methods": set(), "request_bodies": []},
            )
            operation["client_methods"].add(name)
            if fields != "no-body":
                operation["request_bodies"].append(fields)
    return operations


def _reachable_methods(methods: dict[str, dict], roots: set[str]) -> set[str]:
    """Return ``roots`` plus every client method they call through ``this``."""

    reached: set[str] = set()
    pending = [root for root in roots if root in methods]
    while pending:
        name = pending.pop()
        if name in reached:
            continue
        reached.add(name)
        pending.extend(call for call in methods[name]["calls"] if call in methods)
    return reached


def _tool_client_methods() -> dict[str, set[str]]:
    """Return client methods called by MCP tool modules, keyed to their files."""

    pattern = re.compile(r"\bclient\s*\.\s*(?P<method>[A-Za-z_$][\w$]*)\s*\(")
    methods: dict[str, set[str]] = {}
    for path in sorted(TOOLS_PATH.glob("*.ts")):
        for match in pattern.finditer(path.read_text()):
            methods.setdefault(match.group("method"), set()).add(path.name)
    return methods


def _tool_operations(
    methods: dict[str, dict], client_operations: dict[str, dict]
) -> tuple[dict[str, dict], list[str]]:
    tool_methods = _tool_client_methods()
    reached = _reachable_methods(methods, set(tool_methods))
    operations = {
        canonical: operation
        for canonical, operation in client_operations.items()
        if operation["client_methods"] & reached
    }
    unmapped_methods = sorted(set(tool_methods) - set(methods))
    return operations, unmapped_methods


def _mcp_request_fields(tool_operations: dict[str, dict]) -> dict[str, set[str] | None]:
    """Map each tool-backed body operation to the fields the client can send.

    ``None`` means the operation forwards an open record, so no published field
    can be silently dropped.
    """

    request_fields: dict[str, set[str] | None] = {}
    for canonical, operation in tool_operations.items():
        bodies = operation["request_bodies"]
        if not bodies:
            continue
        if any(body is PASSTHROUGH_BODY for body in bodies):
            request_fields[canonical] = None
            continue
        request_fields[canonical] = set().union(*bodies)
    return request_fields


def _manifest_operations(entries: list[dict], section: str) -> dict[str, dict]:
    operations: dict[str, dict] = {}
    for entry in entries:
        operation = entry.get("operation", "")
        reason = entry.get("reason", "")
        if (
            not isinstance(operation, str)
            or not operation
            or not isinstance(reason, str)
            or not reason.strip()
        ):
            raise ValueError(
                f"{section} entries require non-empty operation and reason fields"
            )
        method, separator, path = operation.partition(" ")
        if (
            not separator
            or method.lower() not in HTTP_METHODS
            or not path.startswith("/")
        ):
            raise ValueError(f"invalid operation in {section}: {operation}")
        canonical = _canonical_operation(method, path)
        if canonical in operations:
            raise ValueError(f"duplicate operation in {section}: {operation}")
        operations[canonical] = entry
    return operations


def _manifest_field_entries(entries: list[dict], section: str) -> dict[tuple, dict]:
    """Validate and index manifest exceptions keyed by operation and field."""

    exceptions: dict[tuple, dict] = {}
    for entry in entries:
        operation = entry.get("operation", "")
        field = entry.get("field", "")
        reason = entry.get("reason", "")
        if (
            not isinstance(operation, str)
            or not operation
            or not isinstance(field, str)
            or not field.strip()
            or not isinstance(reason, str)
            or not reason.strip()
        ):
            raise ValueError(
                f"{section} entries require non-empty operation, field, and reason fields"
            )
        method, separator, path = operation.partition(" ")
        if (
            not separator
            or method.lower() not in REQUEST_BODY_METHODS
            or not path.startswith("/")
        ):
            raise ValueError(f"invalid operation in {section}: {operation}")
        key = (_canonical_operation(method, path), field)
        if key in exceptions:
            raise ValueError(f"duplicate entry in {section}: {operation} {field}")
        exceptions[key] = entry
    return exceptions


def _field_reconciliation(
    published_fields: dict[str, set[str]],
    mcp_fields: dict[str, set[str] | None],
    known_field_gaps: dict[tuple, dict],
    allowed_extra_fields: dict[tuple, dict],
) -> dict:
    """Diff published request-body properties against the fields the client sends.

    Only operations that already reach an MCP tool are compared; a published
    operation the MCP server does not expose is a route gap, and reporting its
    fields as well would double-count the same missing work.
    """

    compared = sorted(set(published_fields) & set(mcp_fields))
    actual_gaps: set[tuple] = set()
    actual_extras: set[tuple] = set()
    modeled_field_count = 0
    for canonical in compared:
        published = published_fields[canonical]
        modeled = mcp_fields[canonical]
        if modeled is None:
            modeled_field_count += len(published)
            continue
        actual_gaps |= {(canonical, field) for field in published - modeled}
        actual_extras |= {(canonical, field) for field in modeled - published}
        modeled_field_count += len(published & modeled)

    return {
        "compared_operations": compared,
        "compared_field_count": sum(len(published_fields[key]) for key in compared),
        "modeled_field_count": modeled_field_count,
        "actual_gaps": actual_gaps,
        "actual_extras": actual_extras,
        "new_gaps": actual_gaps - set(known_field_gaps),
        "stale_gaps": set(known_field_gaps) - actual_gaps,
        "unexpected_extras": actual_extras - set(allowed_extra_fields),
        "stale_allowed_extras": set(allowed_extra_fields) - actual_extras,
    }


def _format_field(key: tuple) -> str:
    canonical, field = key
    return f"{canonical} {field}"


def _snapshot_mismatches(
    snapshot: dict,
    *,
    catalog_url: str,
    published_operation_count: int,
    supported_operation_count: int,
    compared_field_count: int,
    modeled_field_count: int,
) -> list[str]:
    expected = {
        "catalog_url": catalog_url,
        "published_operations": published_operation_count,
        "mcp_supported_operations": supported_operation_count,
        "published_request_fields": compared_field_count,
        "mcp_modeled_request_fields": modeled_field_count,
    }
    return [
        f"{field}: recorded {snapshot.get(field)!r}, current {value!r}"
        for field, value in expected.items()
        if snapshot.get(field) != value
    ]


def audit(
    catalog_url: str,
    allowed_origins: frozenset[str] = DEFAULT_ALLOWED_ORIGINS,
) -> tuple[dict, bool]:
    manifest = tomllib.loads(MANIFEST_PATH.read_text())
    specs = _published_specs(catalog_url, allowed_origins)
    published = _published_operations(specs)
    published_fields = _published_request_fields(specs)
    methods = _client_methods(CLIENT_PATH.read_text())
    client = _client_operations(methods)
    tools, unmapped_tool_methods = _tool_operations(methods, client)
    mcp_fields = _mcp_request_fields(tools)
    known_gaps = _manifest_operations(manifest.get("known_gap", []), "known_gap")
    allowed_extras = _manifest_operations(
        manifest.get("allowed_extra", []), "allowed_extra"
    )
    planned = _manifest_operations(
        manifest.get("planned_operation", []), "planned_operation"
    )
    known_field_gaps = _manifest_field_entries(
        manifest.get("known_field_gap", []), "known_field_gap"
    )
    allowed_extra_fields = _manifest_field_entries(
        manifest.get("allowed_extra_field", []), "allowed_extra_field"
    )
    conflicting_field_entries = set(known_field_gaps) & set(allowed_extra_fields)
    if conflicting_field_entries:
        raise ValueError(
            "manifest request fields may appear in only one section: "
            + ", ".join(sorted(map(_format_field, conflicting_field_entries)))
        )
    overlapping_manifest_entries = (
        (set(known_gaps) & set(allowed_extras))
        | (set(known_gaps) & set(planned))
        | (set(allowed_extras) & set(planned))
    )
    if overlapping_manifest_entries:
        raise ValueError(
            "manifest operations may appear in only one section: "
            + ", ".join(sorted(overlapping_manifest_entries))
        )

    published_keys = set(published)
    client_keys = set(client)
    tool_keys = set(tools)
    actual_gaps = published_keys - tool_keys
    actual_extras = tool_keys - published_keys

    new_gaps = actual_gaps - set(known_gaps)
    stale_gaps = set(known_gaps) - actual_gaps
    unexpected_extras = actual_extras - set(allowed_extras) - set(planned)
    stale_allowed_extras = set(allowed_extras) - actual_extras
    stale_planned = set(planned) - actual_extras
    client_only = client_keys - tool_keys
    fields = _field_reconciliation(
        published_fields, mcp_fields, known_field_gaps, allowed_extra_fields
    )
    snapshot_mismatches = _snapshot_mismatches(
        manifest.get("snapshot", {}),
        catalog_url=catalog_url,
        published_operation_count=len(published),
        supported_operation_count=len(published_keys & tool_keys),
        compared_field_count=fields["compared_field_count"],
        modeled_field_count=fields["modeled_field_count"],
    )

    report = {
        "catalog_url": catalog_url,
        "published_operation_count": len(published),
        "client_operation_count": len(client),
        "tool_operation_count": len(tools),
        "supported_operation_count": len(published_keys & tool_keys),
        "known_gap_count": len(actual_gaps & set(known_gaps)),
        "new_gaps": [published[item] for item in sorted(new_gaps)],
        "stale_gaps": [known_gaps[item]["operation"] for item in sorted(stale_gaps)],
        "unexpected_mcp_operations": [
            client[item]["operation"] for item in sorted(unexpected_extras)
        ],
        "stale_allowed_extras": [
            allowed_extras[item]["operation"] for item in sorted(stale_allowed_extras)
        ],
        "stale_planned_operations": [
            planned[item]["operation"] for item in sorted(stale_planned)
        ],
        "client_only_operations": [
            client[item]["operation"] for item in sorted(client_only)
        ],
        "unmapped_tool_client_methods": unmapped_tool_methods,
        "snapshot_mismatches": snapshot_mismatches,
        "all_current_gaps": [published[item] for item in sorted(actual_gaps)],
        "compared_request_field_count": fields["compared_field_count"],
        "modeled_request_field_count": fields["modeled_field_count"],
        "known_field_gap_count": len(fields["actual_gaps"] & set(known_field_gaps)),
        "new_field_gaps": sorted(map(_format_field, fields["new_gaps"])),
        "stale_field_gaps": sorted(map(_format_field, fields["stale_gaps"])),
        "unexpected_mcp_request_fields": sorted(
            map(_format_field, fields["unexpected_extras"])
        ),
        "stale_allowed_extra_fields": sorted(
            map(_format_field, fields["stale_allowed_extras"])
        ),
        "all_current_field_gaps": sorted(map(_format_field, fields["actual_gaps"])),
    }
    passed = not (
        new_gaps
        or stale_gaps
        or unexpected_extras
        or stale_allowed_extras
        or stale_planned
        or unmapped_tool_methods
        or snapshot_mismatches
        or fields["new_gaps"]
        or fields["stale_gaps"]
        or fields["unexpected_extras"]
        or fields["stale_allowed_extras"]
    )
    return report, passed


def render_markdown_report(report: dict, passed: bool) -> str:
    """Render a deterministic, reviewable API-parity report."""

    lines = [
        "# MCP API Coverage Report",
        "",
        "<!-- Generated by scripts/audit_api_coverage.py; do not edit by hand. -->",
        "",
        "This report compares the published Coval OpenAPI catalog with the",
        "operations MCP tools reach through `src/client.ts`, and each covered",
        "operation's published request-body properties with the fields the client",
        "sends. It is intentionally timestamp-free so the weekly workflow opens or",
        "updates a PR only when coverage actually changes.",
        "",
        "## Summary",
        "",
        "| Metric | Value |",
        "| --- | ---: |",
        f"| Reconciliation status | {'PASS' if passed else 'ACTION REQUIRED'} |",
        f"| Published operations | {report['published_operation_count']} |",
        f"| Operations reached by MCP tools | {report['supported_operation_count']} |",
        f"| Reviewed gaps | {report['known_gap_count']} |",
        f"| Client operations | {report['client_operation_count']} |",
        f"| Published request fields on covered operations | "
        f"{report['compared_request_field_count']} |",
        f"| Request fields the MCP client sends | "
        f"{report['modeled_request_field_count']} |",
        f"| Reviewed request-field gaps | {report['known_field_gap_count']} |",
        "",
        f"Catalog: {report['catalog_url']}",
        "",
    ]

    sections = (
        ("New published operations without MCP tools", "new_gaps"),
        ("Reviewed gaps no longer present", "stale_gaps"),
        ("MCP operations absent from published OpenAPI", "unexpected_mcp_operations"),
        ("Allowed extras no longer present", "stale_allowed_extras"),
        ("Planned operations no longer present", "stale_planned_operations"),
        ("Tool client methods not found on the client", "unmapped_tool_client_methods"),
        ("Coverage snapshot mismatches", "snapshot_mismatches"),
        ("Client-only operations", "client_only_operations"),
        ("All current published gaps", "all_current_gaps"),
        ("New published request fields the MCP client drops", "new_field_gaps"),
        ("Reviewed request-field gaps no longer present", "stale_field_gaps"),
        (
            "MCP request fields absent from published OpenAPI",
            "unexpected_mcp_request_fields",
        ),
        (
            "Allowed extra request fields no longer present",
            "stale_allowed_extra_fields",
        ),
        ("All current request-field gaps", "all_current_field_gaps"),
    )
    for title, key in sections:
        lines.extend((f"## {title}", ""))
        values = report[key]
        lines.extend(f"- `{value}`" for value in values)
        if not values:
            lines.append("- None.")
        lines.append("")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog-url", default=CATALOG_URL)
    parser.add_argument(
        "--allowed-origin",
        action="append",
        help="HTTPS origin allowed for catalog/spec fetches; repeat for multiple origins",
    )
    parser.add_argument(
        "--json", action="store_true", help="Emit the full machine-readable report"
    )
    parser.add_argument(
        "--write-markdown",
        type=Path,
        help="Write a deterministic Markdown report to this path",
    )
    parser.add_argument(
        "--allow-drift",
        action="store_true",
        help=(
            "Exit successfully after writing a report even when parity needs "
            "reconciliation; requires --write-markdown"
        ),
    )
    args = parser.parse_args()
    if args.allow_drift and args.write_markdown is None:
        parser.error("--allow-drift requires --write-markdown")

    configured_origins = args.allowed_origin or sorted(DEFAULT_ALLOWED_ORIGINS)
    allowed_origins = frozenset(
        _normalize_allowed_origin(origin) for origin in configured_origins
    )
    report, passed = audit(args.catalog_url, allowed_origins)
    if args.write_markdown is not None:
        args.write_markdown.write_text(render_markdown_report(report, passed))
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        status = "PASS" if passed else "FAIL"
        print(
            f"{status}: {report['supported_operation_count']}/{report['published_operation_count']} "
            f"published operations are reached by MCP tools; "
            f"{report['known_gap_count']} reviewed gaps remain."
        )
        print(
            f"      {report['modeled_request_field_count']}/{report['compared_request_field_count']} "
            f"published request fields on those operations are sent by the MCP client; "
            f"{report['known_field_gap_count']} reviewed field gaps remain."
        )
        for key in (
            "new_gaps",
            "stale_gaps",
            "unexpected_mcp_operations",
            "stale_allowed_extras",
            "stale_planned_operations",
            "unmapped_tool_client_methods",
            "snapshot_mismatches",
            "new_field_gaps",
            "stale_field_gaps",
            "unexpected_mcp_request_fields",
            "stale_allowed_extra_fields",
        ):
            values = report[key]
            if values:
                print(f"{key}:")
                for value in values:
                    print(f"  - {value}")
    return 0 if passed or args.allow_drift else 1


if __name__ == "__main__":
    sys.exit(main())
