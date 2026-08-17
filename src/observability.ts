import type { NextFunction, Request, Response } from 'express';

export type RuntimeIdentity = {
  service: string;
  env: string;
  version: string;
};

export type RequestCompletion = RuntimeIdentity & {
  event: 'mcp.request.completed';
  message: 'mcp_request_completed';
  surface: 'mcp';
  http_method: string;
  http_path: string;
  http_status: number;
  status: 'ok' | 'auth_error' | 'error' | 'client_closed';
  duration_ms: number;
};

const REMOTE_PATHS = new Set(['/mcp', '/claude/mcp']);
const REMOTE_METHODS = new Set(['DELETE', 'GET', 'OPTIONS', 'POST']);

function writeStructuredLog(payload: object): void {
  if (process.env.NODE_ENV === 'test') return;
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function runtimeIdentity(env: NodeJS.ProcessEnv = process.env): RuntimeIdentity {
  return {
    service: env.DD_SERVICE?.trim() || 'coval-mcp-server',
    env: env.DD_ENV?.trim() || 'local',
    version: env.DD_VERSION?.trim() || env.COVAL_MCP_SOURCE_SHA?.trim() || 'unknown',
  };
}

function requestPath(originalUrl: string): string {
  const path = originalUrl.split('?', 1)[0];
  return REMOTE_PATHS.has(path) ? path : 'other';
}

function requestMethod(method: string): string {
  const normalized = method.toUpperCase();
  return REMOTE_METHODS.has(normalized) ? normalized : 'OTHER';
}

export function requestCompletion(
  req: Pick<Request, 'method' | 'originalUrl'>,
  httpStatus: number,
  durationMs: number,
  env: NodeJS.ProcessEnv = process.env,
): RequestCompletion {
  return {
    event: 'mcp.request.completed',
    message: 'mcp_request_completed',
    ...runtimeIdentity(env),
    surface: 'mcp',
    http_method: requestMethod(req.method),
    http_path: requestPath(req.originalUrl),
    http_status: httpStatus,
    status:
      httpStatus < 400
        ? 'ok'
        : httpStatus === 401 || httpStatus === 403
          ? 'auth_error'
          : // 499 is only ever synthesized by the close-before-finish branch below; on a GET it is
            // the SSE long-poll ending at the ALB idle timeout, not a failure. Aborted writes stay errors.
            httpStatus === 499 && requestMethod(req.method) === 'GET'
            ? 'client_closed'
            : 'error',
    duration_ms: Math.max(0, Math.round(durationMs)),
  };
}

export function requestCompletionLogger(
  write: (payload: RequestCompletion) => void = writeStructuredLog,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = performance.now();
    let emitted = false;
    const emit = (httpStatus: number): void => {
      if (emitted) return;
      emitted = true;
      write(requestCompletion(req, httpStatus, performance.now() - startedAt));
    };
    res.once('finish', () => emit(res.statusCode));
    // Node defaults statusCode to 200 before a response is written. A socket can close before
    // `finish`, so use nginx's conventional 499 rather than recording an aborted request as ok.
    res.once('close', () => emit(res.writableFinished ? res.statusCode : 499));
    next();
  };
}

export function logServiceStarted(
  port: number,
  write: (payload: object) => void = writeStructuredLog,
): void {
  write({
    event: 'mcp.service.started',
    message: 'mcp_service_started',
    ...runtimeIdentity(),
    surface: 'mcp',
    port,
  });
}
