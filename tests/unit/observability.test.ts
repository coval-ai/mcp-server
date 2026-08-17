import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import {
  requestCompletion,
  requestCompletionLogger,
  type RequestCompletion,
  logServiceStarted,
  runtimeIdentity,
} from '../../src/observability.js';

describe('hosted MCP observability', () => {
  it('uses the immutable source SHA as the release identity', () => {
    expect(runtimeIdentity({
      DD_ENV: 'v1',
      DD_SERVICE: 'coval-mcp-server',
      DD_VERSION: 'a'.repeat(40),
    })).toEqual({
      service: 'coval-mcp-server',
      env: 'v1',
      version: 'a'.repeat(40),
    });
  });

  it('falls back to the immutable source SHA when DD_VERSION is absent', () => {
    expect(runtimeIdentity({
      DD_ENV: 'v1',
      DD_SERVICE: 'coval-mcp-server',
      COVAL_MCP_SOURCE_SHA: 'b'.repeat(40),
    })).toEqual({
      service: 'coval-mcp-server',
      env: 'v1',
      version: 'b'.repeat(40),
    });
  });

  it('emits only low-cardinality request completion fields', () => {
    const entry = requestCompletion(
      { method: 'post', originalUrl: '/mcp?token=must-not-appear' },
      401,
      12.6,
      { DD_ENV: 'v1', DD_SERVICE: 'coval-mcp-server', DD_VERSION: 'release-sha' },
    );

    expect(entry).toEqual({
      event: 'mcp.request.completed',
      message: 'mcp_request_completed',
      service: 'coval-mcp-server',
      env: 'v1',
      version: 'release-sha',
      surface: 'mcp',
      http_method: 'POST',
      http_path: '/mcp',
      http_status: 401,
      status: 'auth_error',
      duration_ms: 13,
    });
    expect(JSON.stringify(entry)).not.toContain('must-not-appear');
  });

  it('collapses unknown paths instead of logging arbitrary URLs', () => {
    expect(requestCompletion(
      { method: 'GET', originalUrl: '/customer/supplied/path' },
      500,
      -1,
    )).toMatchObject({ http_path: 'other', status: 'error', duration_ms: 0 });
  });

  it('collapses unsupported HTTP methods instead of creating arbitrary tags', () => {
    expect(requestCompletion(
      { method: 'customer-method', originalUrl: '/mcp' },
      405,
      1,
    )).toMatchObject({ http_method: 'OTHER' });
  });

  it('logs a completed response on finish', () => {
    const req = { method: 'POST', originalUrl: '/mcp' } as Request;
    const res = new EventEmitter() as Response;
    res.statusCode = 204;
    Object.defineProperty(res, 'writableFinished', { value: true });
    const entries: RequestCompletion[] = [];

    requestCompletionLogger((entry) => entries.push(entry))(
      req,
      res,
      (() => undefined) as NextFunction,
    );
    res.emit('finish');
    res.emit('close');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ http_status: 204, status: 'ok' });
  });

  it('classifies a socket close before response finish as an error', () => {
    const req = { method: 'POST', originalUrl: '/mcp' } as Request;
    const res = new EventEmitter() as Response;
    res.statusCode = 200;
    Object.defineProperty(res, 'writableFinished', { value: false });
    const entries: RequestCompletion[] = [];

    requestCompletionLogger((entry) => entries.push(entry))(
      req,
      res,
      (() => undefined) as NextFunction,
    );
    res.emit('close');
    res.emit('finish');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ http_status: 499, status: 'error' });
  });

  it('classifies a GET long-poll socket close as client_closed, not error', () => {
    const req = { method: 'GET', originalUrl: '/mcp' } as Request;
    const res = new EventEmitter() as Response;
    res.statusCode = 200;
    Object.defineProperty(res, 'writableFinished', { value: false });
    const entries: RequestCompletion[] = [];

    requestCompletionLogger((entry) => entries.push(entry))(
      req,
      res,
      (() => undefined) as NextFunction,
    );
    res.emit('close');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ http_status: 499, status: 'client_closed' });
  });

  it('logs the startup event with the runtime identity', () => {
    const previous = {
      DD_ENV: process.env.DD_ENV,
      DD_SERVICE: process.env.DD_SERVICE,
      DD_VERSION: process.env.DD_VERSION,
    };
    process.env.DD_ENV = 'v1';
    process.env.DD_SERVICE = 'coval-mcp-server';
    process.env.DD_VERSION = 'release-sha';
    const entries: object[] = [];

    try {
      logServiceStarted(3000, (entry) => entries.push(entry));
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    expect(entries).toEqual([{
      event: 'mcp.service.started',
      message: 'mcp_service_started',
      service: 'coval-mcp-server',
      env: 'v1',
      version: 'release-sha',
      surface: 'mcp',
      port: 3000,
    }]);
  });
});
