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
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  rewriteLegacyToolCalls,
  rewriteOpenAiToolCalls,
} from './compatibility.js';
import { ManagedApiKeyError, ManagedApiKeyProvider } from './managed-api-key.js';
import { COVAL_MCP_SERVER_VERSION, createMcpServer } from './server.js';
import type { ToolAnnotationProfile } from './tools/annotations.js';

const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const REQUIRED_ORG_SCOPE = 'user:org:read';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://claude.ai',
  'https://claude.com',
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://platform.openai.com',
] as const;

class OAuthOrganizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthOrganizationError';
  }
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.header(name)?.trim();
  return value || undefined;
}

export function allowedOrigins(raw = process.env.MCP_ALLOWED_ORIGINS): ReadonlySet<string> {
  const configured = raw === undefined ? DEFAULT_ALLOWED_ORIGINS : raw.split(',');
  const origins = new Set<string>();
  for (const value of configured) {
    const candidate = value.trim();
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.origin === 'null' ||
        parsed.origin !== candidate.replace(/\/$/, '')
      ) {
        throw new Error('origin must not include a path, query, or fragment');
      }
      origins.add(parsed.origin);
    } catch {
      throw new Error(`Invalid origin in MCP_ALLOWED_ORIGINS: ${candidate}`);
    }
  }
  return origins;
}

function validateOrigin(origins: ReadonlySet<string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = headerValue(req, 'Origin');
    if (!origin) {
      next();
      return;
    }
    let normalized: string;
    try {
      normalized = new URL(origin).origin;
    } catch {
      res.status(403).json({ error: 'Request origin is not allowed' });
      return;
    }
    if (normalized === 'null' || normalized !== origin || !origins.has(normalized)) {
      res.status(403).json({ error: 'Request origin is not allowed' });
      return;
    }
    next();
  };
}

function oauthIdentity(req: Request): { clerkUserId: string; clerkOrganizationId: string } {
  const extra = (req as Request & { auth?: AuthInfo }).auth?.extra;
  const clerkUserId = typeof extra?.userId === 'string' ? extra.userId : '';
  const clerkOrganizationId =
    typeof extra?.clerkOrganizationId === 'string' ? extra.clerkOrganizationId : '';
  if (!clerkUserId || !clerkOrganizationId) {
    throw new OAuthOrganizationError('OAuth connection must select a Coval organization');
  }
  return { clerkUserId, clerkOrganizationId };
}

function protectedResourceMetadataUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}/.well-known/oauth-protected-resource${req.originalUrl}`;
}

// Clerk's verified `oauth_token` auth object exposes only `userId` and `clientId`, so the selected
// organization must come from the already signature-verified access token's claims. This requires
// the Clerk OAuth application to mint JWT-format access tokens carrying `org_id` or
// `organization_id`; opaque `oat_` tokens fail closed (401). See "Remote OAuth operator
// requirements" in the README.
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
  const origins = allowedOrigins();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use('/mcp', validateOrigin(origins));
  app.use('/claude/mcp', validateOrigin(origins));
  app.use(express.json({ limit: '1mb' }));
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || origins.has(origin)),
      exposedHeaders: ['WWW-Authenticate'],
    }),
  );
  app.get('/.well-known/openai-apps-challenge', (_req, res) => {
    const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
    if (!token) {
      res.sendStatus(404);
      return;
    }
    res.type('text/plain').set('Cache-Control', 'no-store').send(token);
  });
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

  const handleMcpRequest =
    (annotationProfile: ToolAnnotationProfile) => async (req: Request, res: Response) => {
      let apiKey = headerValue(req, 'X-API-Key');
      try {
        if (!apiKey) {
          if (!managedKeys.isConfigured()) {
            res.status(503).json({ error: 'OAuth-backed MCP sessions are not configured' });
            return;
          }
          const identity = oauthIdentity(req);
          apiKey = await managedKeys.getApiKey(
            identity.clerkOrganizationId,
            identity.clerkUserId
          );
        }
        const isOpenAi = annotationProfile === 'standard';
        req.body =
          isOpenAi
            ? rewriteOpenAiToolCalls(req.body)
            : rewriteLegacyToolCalls(req.body);
        const server = createMcpServer({
          annotationProfile,
          inputProfile: isOpenAi ? 'openai' : 'legacy',
          apiKey,
          includeSofia: true,
        });
        try {
          await streamableHttpHandler(server)(req, res);
        } finally {
          await server.close();
        }
      } catch (error) {
        console.error('MCP request failed', error instanceof Error ? error.name : 'UnknownError');
        if (!res.headersSent) {
          const isKnownError =
            error instanceof OAuthOrganizationError || error instanceof ManagedApiKeyError;
          res.status(error instanceof ManagedApiKeyError ? error.status : isKnownError ? 400 : 502).json({
            error: isKnownError ? error.message : 'Unable to serve MCP request',
          });
        }
      }
    };

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      service: 'coval-mcp-server',
      version: COVAL_MCP_SERVER_VERSION,
    });
  });
  app.get('/.well-known/oauth-protected-resource', protectedResourceHandlerClerk({
    service_documentation: 'https://docs.coval.dev',
    scopes_supported: ['openid', 'profile', 'email', REQUIRED_ORG_SCOPE],
  }));
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceHandlerClerk({
    service_documentation: 'https://docs.coval.dev',
    scopes_supported: ['openid', 'profile', 'email', REQUIRED_ORG_SCOPE],
  }));
  app.get('/.well-known/oauth-protected-resource/claude/mcp', protectedResourceHandlerClerk({
    service_documentation: 'https://docs.coval.dev',
    scopes_supported: ['openid', 'profile', 'email', REQUIRED_ORG_SCOPE],
  }));
  app.get('/.well-known/oauth-authorization-server', authServerMetadataHandlerClerk);

  app.all('/mcp', authenticate, handleMcpRequest('standard'));
  app.all('/claude/mcp', authenticate, handleMcpRequest('claude'));

  // Rejections forwarded from middleware land here (e.g. @clerk/mcp-tools' mcpAuth throws on a
  // malformed Authorization header such as a bare "Bearer") so clients get a terminated JSON
  // error instead of hanging on an unhandled rejection or receiving Express's HTML error page.
  app.use((error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }
    console.error('Request failed before MCP handling');
    const status = (error as { status?: unknown } | null)?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({ error: 'Invalid request' });
      return;
    }
    if (headerValue(req, 'Authorization')) {
      res
        .status(401)
        .set('WWW-Authenticate', `Bearer resource_metadata=${protectedResourceMetadataUrl(req)}`)
        .json({ error: 'Invalid Authorization header, expected Bearer <token>' });
      return;
    }
    res.status(500).json({ error: 'Unable to serve MCP request' });
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
