import { createHash } from 'node:crypto';
import { z } from 'zod';

export class TranscriptExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptExportError';
  }
}

export interface TranscriptApi {
  getRun(runId: string, signal: AbortSignal): Promise<unknown>;
  list(runId: string, pageToken: string, signal: AbortSignal): Promise<unknown>;
  get(callId: string, signal: AbortSignal): Promise<unknown>;
}

const MAX_CALLS = 100;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_URI_CHARS = 60_000;
const DEADLINE_MS = 30_000;
const SnapshotSchema = z.object({
  v: z.literal(1),
  run_id: z.string().min(1).max(128),
  prepared_at: z.string().datetime(),
  calls: z.array(z.object({
    id: z.string().min(1).max(128),
    fingerprint: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }).strict()).max(MAX_CALLS),
}).strict();
type Snapshot = z.infer<typeof SnapshotSchema>;

export interface TranscriptExport {
  kind: 'run_transcripts';
  status: 'ready';
  uri: string;
  name: string;
  mimeType: 'application/json';
  call_count: number;
  available_count: number;
  unavailable_count: number;
  prepared_at: string;
  size: number;
  scope: 'default_workspace';
}

interface CallTranscript {
  call_id: string;
  status: 'available' | 'unavailable';
  reason: string | null;
  source_status: unknown;
  transcript: unknown;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TranscriptExportError('Transcript export received an invalid API response');
  }
  return value as Record<string, unknown>;
}

function identifier(value: Record<string, unknown>): unknown {
  return value.conversation_id ?? value.simulation_output_id ?? value.simulation_id ?? value.run_id ?? value.id;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, stable(v)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('base64url');
}

function checkDeadline(signal: AbortSignal): void {
  if (signal.aborted) throw new TranscriptExportError('Transcript export deadline exceeded; no complete export was prepared');
}

async function inventory(api: TranscriptApi, runId: string, signal: AbortSignal): Promise<string[]> {
  const run = object(object(await api.getRun(runId, signal)).run);
  if (identifier(run) !== runId && run.name !== `runs/${runId}`) {
    throw new TranscriptExportError('The run response did not match the requested run');
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  const tokens = new Set<string>();
  let token = '';
  let total: number | undefined;
  for (let page = 0; page < 20; page += 1) {
    checkDeadline(signal);
    const payload = object(await api.list(runId, token, signal));
    if (!Array.isArray(payload.simulated_conversations)) throw new TranscriptExportError('Run inventory is unavailable');
    const declaredTotal = payload.total_size ?? payload.total_count;
    if (declaredTotal !== undefined) {
      if (!Number.isSafeInteger(declaredTotal) || Number(declaredTotal) < 0 || (total !== undefined && declaredTotal !== total)) {
        throw new TranscriptExportError('The run inventory changed or has an invalid count');
      }
      total = Number(declaredTotal);
    }
    for (const value of payload.simulated_conversations) {
      const row = object(value);
      const id = identifier(row);
      if (typeof id !== 'string' || !id || id.length > 128 || seen.has(id) || (row.run_id !== undefined && row.run_id !== runId)) {
        throw new TranscriptExportError('The run inventory contains duplicate or mismatched calls');
      }
      seen.add(id);
      ids.push(id);
      if (ids.length > MAX_CALLS) throw new TranscriptExportError(`Transcript exports support at most ${MAX_CALLS} calls; no sample was returned`);
    }
    const next = payload.next_page_token;
    if (next === undefined || next === null || next === '') {
      if (total !== undefined && total !== ids.length) throw new TranscriptExportError('The run inventory count is incomplete');
      return ids;
    }
    if (typeof next !== 'string' || tokens.has(next)) throw new TranscriptExportError('The run inventory cursor is invalid or repeated');
    tokens.add(next);
    token = next;
  }
  throw new TranscriptExportError('Run inventory page limit exceeded; no complete export was prepared');
}

async function collect(api: TranscriptApi, runId: string, signal: AbortSignal): Promise<CallTranscript[]> {
  const ids = await inventory(api, runId, signal);
  const calls: CallTranscript[] = [];
  let bytes = 0;
  for (const id of ids) {
    checkDeadline(signal);
    let payload: unknown;
    try {
      payload = await api.get(id, signal);
    } catch (error) {
      checkDeadline(signal);
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
      if (status === 401 || status === 403) throw new TranscriptExportError('Transcript export authorization failed');
      calls.push({ call_id: id, status: 'unavailable', reason: `Conversation read unavailable${typeof status === 'number' ? ` (HTTP ${status})` : ''}.`, source_status: null, transcript: null });
      continue;
    }
    const response = object(payload);
    const row = object(response.simulated_conversation ?? response.simulation);
    if (identifier(row) !== id || (row.run_id !== undefined && row.run_id !== runId)) {
      throw new TranscriptExportError('A conversation response did not match the authorized run inventory');
    }
    const transcript = row.transcript ?? null;
    const available = Array.isArray(transcript) && transcript.length > 0;
    const call: CallTranscript = {
      call_id: id,
      status: available ? 'available' : 'unavailable',
      reason: available ? null : 'No recorded transcript entries are available from the API.',
      source_status: row.status ?? row.error_status ?? null,
      transcript,
    };
    bytes += Buffer.byteLength(JSON.stringify(call));
    if (bytes > MAX_BYTES) throw new TranscriptExportError('Transcript export size limit exceeded; no truncated export was returned');
    calls.push(call);
  }
  if (JSON.stringify(ids) !== JSON.stringify(await inventory(api, runId, signal))) {
    throw new TranscriptExportError('The run inventory changed during collection; retry the complete export');
  }
  return calls;
}

function uriFor(snapshot: Snapshot): string {
  const token = Buffer.from(JSON.stringify(snapshot)).toString('base64url');
  const uri = `coval://run-transcripts/${encodeURIComponent(snapshot.run_id)}/${token}`;
  if (uri.length > MAX_URI_CHARS) throw new TranscriptExportError('Transcript export manifest is too large');
  return uri;
}

function snapshotFrom(uri: string): Snapshot {
  if (uri.length > MAX_URI_CHARS) throw new TranscriptExportError('Invalid transcript export resource');
  const url = new URL(uri);
  const parts = url.pathname.slice(1).split('/');
  if (url.port || url.protocol !== 'coval:' || url.hostname !== 'run-transcripts' || url.search || url.hash || url.username || url.password || parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
    throw new TranscriptExportError('Invalid transcript export resource');
  }
  const snapshot = SnapshotSchema.parse(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
  if (decodeURIComponent(parts[0]) !== snapshot.run_id || new Set(snapshot.calls.map((call) => call.id)).size !== snapshot.calls.length) {
    throw new TranscriptExportError('Invalid transcript export manifest');
  }
  return snapshot;
}

export async function prepareTranscriptExport(api: TranscriptApi, runId: string): Promise<TranscriptExport> {
  const calls = await collect(api, runId, AbortSignal.timeout(DEADLINE_MS));
  const preparedAt = new Date().toISOString();
  const snapshot: Snapshot = { v: 1, run_id: runId, prepared_at: preparedAt, calls: calls.map((call) => ({ id: call.call_id, fingerprint: fingerprint(call) })) };
  return {
    kind: 'run_transcripts', status: 'ready', uri: uriFor(snapshot), name: `Transcripts for run ${runId}`,
    mimeType: 'application/json', call_count: calls.length,
    available_count: calls.filter((call) => call.status === 'available').length,
    unavailable_count: calls.filter((call) => call.status === 'unavailable').length,
    prepared_at: preparedAt, size: Buffer.byteLength(buildArtifact(snapshot, calls).text), scope: 'default_workspace',
  };
}

export async function readTranscriptExport(api: TranscriptApi, uri: string): Promise<{ text: string; version: string }> {
  const snapshot = snapshotFrom(uri);
  const calls = await collect(api, snapshot.run_id, AbortSignal.timeout(DEADLINE_MS));
  return buildArtifact(snapshot, calls);
}

function buildArtifact(snapshot: Snapshot, calls: CallTranscript[]): { text: string; version: string } {
  const expected = new Map(snapshot.calls.map((call) => [call.id, call.fingerprint]));
  const changed = calls.filter((call) => expected.get(call.call_id) !== fingerprint(call)).map((call) => call.call_id);
  const orderChanged = JSON.stringify(calls.map((call) => call.call_id)) !== JSON.stringify(snapshot.calls.map((call) => call.id));
  const current = new Set(calls.map((call) => call.call_id));
  const missing = snapshot.calls.filter((call) => !current.has(call.id)).map((call) => call.id);
  const allCalls: CallTranscript[] = [...calls, ...missing.map((id): CallTranscript => ({
    call_id: id, status: 'unavailable', reason: 'Call is no longer present in the current run inventory.', source_status: null, transcript: null,
  }))];
  if (allCalls.length > MAX_CALLS) throw new TranscriptExportError('Changed run inventory exceeds the complete export limit');
  const text = JSON.stringify(stable({
    format: 'coval.run-transcripts.v1', scope: 'default_workspace', run_id: snapshot.run_id,
    prepared_at: snapshot.prepared_at, status: changed.length || missing.length || orderChanged ? 'source_changed' : 'complete',
    semantics: 'Authenticated current API reads, compared with prepared fingerprints; not a retained historical snapshot.',
    changed_call_ids: changed, removed_call_ids: missing, source_order_changed: orderChanged,
    prepared_inventory: snapshot.calls,
    call_count: allCalls.length, available_count: allCalls.filter((call) => call.status === 'available').length,
    unavailable_count: allCalls.filter((call) => call.status === 'unavailable').length,
    calls: allCalls, end_marker: 'END_OF_COMPLETE_TRANSCRIPT_EXPORT',
  }), null, 2);
  if (Buffer.byteLength(text) > MAX_BYTES) throw new TranscriptExportError('Transcript export size limit exceeded; no truncated export was returned');
  return { text, version: fingerprint(text) };
}
