import type { NextFunction, Request, Response } from 'express';

export type RuntimeIdentity = {
  service: string;
  env: string;
  version: string;
};

type RequestCompletion = RuntimeIdentity & {
  event: 'mcp.request.completed';
  message: 'mcp_request_completed';
  surface: 'mcp';
  http_method: string;
  http_path: string;
  http_status: number;
  status: 'ok' | 'auth_error' | 'error';
  duration_ms: number;
};

const REMOTE_PATHS = new Set(['/mcp', '/claude/mcp']);

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
    http_method: req.method.toUpperCase(),
    http_path: requestPath(req.originalUrl),
    http_status: httpStatus,
    status: httpStatus < 400 ? 'ok' : httpStatus === 401 || httpStatus === 403 ? 'auth_error' : 'error',
    duration_ms: Math.max(0, Math.round(durationMs)),
  };
}

export function requestCompletionLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = performance.now();
    let emitted = false;
    const emit = (): void => {
      if (emitted) return;
      emitted = true;
      writeStructuredLog(requestCompletion(req, res.statusCode, performance.now() - startedAt));
    };
    res.once('finish', emit);
    res.once('close', emit);
    next();
  };
}

export function logServiceStarted(port: number): void {
  writeStructuredLog({
    event: 'mcp.service.started',
    message: 'mcp_service_started',
    ...runtimeIdentity(),
    surface: 'mcp',
    port,
  });
}
