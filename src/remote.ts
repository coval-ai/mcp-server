#!/usr/bin/env node

import { getAuth, clerkMiddleware } from '@clerk/express';
import {
  authServerMetadataHandlerClerk,
  mcpAuth,
  protectedResourceHandlerClerk,
  streamableHttpHandler,
} from '@clerk/mcp-tools/express';
import { verifyClerkToken } from '@clerk/mcp-tools/server';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ManagedApiKeyProvider } from './managed-api-key.js';
import { createMcpServer } from './server.js';

const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const REQUIRED_ORG_SCOPE = 'user:org:read';

function headerValue(req: Request, name: string): string | undefined {
  const value = req.header(name)?.trim();
  return value || undefined;
}

function oauthIdentity(req: Request): { clerkUserId: string; clerkOrganizationId: string } {
  const extra = (req as Request & { auth?: AuthInfo }).auth?.extra;
  const clerkUserId = typeof extra?.userId === 'string' ? extra.userId : '';
  const clerkOrganizationId =
    typeof extra?.clerkOrganizationId === 'string' ? extra.clerkOrganizationId : '';
  if (!clerkUserId || !clerkOrganizationId) {
    throw new Error('OAuth connection must select a Coval organization');
  }
  return { clerkUserId, clerkOrganizationId };
}

export function organizationIdFromVerifiedToken(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      org_id?: unknown;
      organization_id?: unknown;
    };
    const value = claims.org_id ?? claims.organization_id;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function createRemoteApp(): Promise<express.Express> {
  if (!process.env.CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    throw new Error('CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY are required');
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(clerkMiddleware());

  const managedKeys = new ManagedApiKeyProvider(process.env.COVAL_INTERNAL_API_KEY || '');
  const oauth = await mcpAuth(async (token, req): Promise<AuthInfo | undefined> => {
    const auth = getAuth(req, { acceptsToken: 'oauth_token' });
    if (!auth.isAuthenticated || !auth.scopes?.includes(REQUIRED_ORG_SCOPE)) {
      return undefined;
    }
    const verified = verifyClerkToken(auth, token);
    if (!verified) return undefined;
    const clerkOrganizationId = organizationIdFromVerifiedToken(token);
    if (!clerkOrganizationId) return undefined;
    return {
      ...verified,
      extra: {
        ...verified.extra,
        clerkOrganizationId,
      },
    };
  });

  const authenticate = (req: Request, res: Response, next: NextFunction): void => {
    if (headerValue(req, 'X-API-Key')) {
      next();
      return;
    }
    void Promise.resolve(oauth(req, res, next)).catch(next);
  };

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', service: 'coval-mcp-server', version: '0.2.0' });
  });
  app.get('/.well-known/oauth-protected-resource', protectedResourceHandlerClerk({
    service_documentation: 'https://docs.coval.dev',
    scopes_supported: ['openid', 'profile', 'email', REQUIRED_ORG_SCOPE],
  }));
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceHandlerClerk({
    service_documentation: 'https://docs.coval.dev',
    scopes_supported: ['openid', 'profile', 'email', REQUIRED_ORG_SCOPE],
  }));
  app.get('/.well-known/oauth-authorization-server', authServerMetadataHandlerClerk);

  app.all('/mcp', authenticate, async (req, res) => {
    let apiKey = headerValue(req, 'X-API-Key');
    try {
      if (!apiKey) {
        if (!managedKeys.isConfigured()) {
          res.status(503).json({ error: 'OAuth-backed MCP sessions are not configured' });
          return;
        }
        const identity = oauthIdentity(req);
        apiKey = await managedKeys.getApiKey(identity.clerkOrganizationId, identity.clerkUserId);
      }
      const server = createMcpServer({ apiKey, includeCovi: true });
      try {
        await streamableHttpHandler(server)(req, res);
      } finally {
        await server.close();
      }
    } catch (error) {
      console.error('MCP request failed', error instanceof Error ? error.message : 'unknown error');
      if (!res.headersSent) {
        res.status(502).json({
          error:
            error instanceof Error && error.message.includes('organization')
              ? error.message
              : 'Unable to serve MCP request',
        });
      }
    }
  });

  return app;
}

async function main(): Promise<void> {
  const app = await createRemoteApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.error(`Coval MCP HTTP server listening on port ${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  void main();
}
