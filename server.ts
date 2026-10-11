import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from './firebase-applet-config.json';

dotenv.config();

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getAuth();

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  rawBody?: Buffer;
}

/**
 * Server-side Encrypted Credential Vault for Meta System User & OAuth Tokens
 * Associated strictly with (userId + wabaAccountId) so tokens are never exposed to client queries
 * and never shared globally across customers.
 */
interface StoredWabaCredential {
  userId: string;
  wabaAccountId: string;
  wabaId: string;
  phoneNumberId: string;
  encryptedAccessToken: string;
  iv: string;
  updatedAt: string;
}

const VAULT_SECRET = crypto
  .createHash('sha256')
  .update(process.env.META_APP_SECRET || firebaseConfig.apiKey || 'nexuswa-server-vault-key')
  .digest();

const credentialVault = new Map<string, StoredWabaCredential>();
const phoneNumberToTenantMap = new Map<string, { userId: string; wabaAccountId: string; wabaId: string }>();

function encryptToken(rawToken: string): { encryptedAccessToken: string; iv: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', VAULT_SECRET, iv);
  let encrypted = cipher.update(rawToken, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encryptedAccessToken: encrypted, iv: iv.toString('hex') };
}

function decryptToken(encryptedAccessToken: string, ivHex: string): string {
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', VAULT_SECRET, iv);
  let decrypted = decipher.update(encryptedAccessToken, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Server-side Authentication Middleware
const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized: Missing Bearer ID token in Authorization header.',
    });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err: any) {
    console.error('Firebase ID token verification failed:', err?.message);
    return res.status(401).json({
      error: 'Unauthorized: Invalid or expired authentication session.',
    });
  }
};

// Bounded exponential backoff helper for transient Meta Graph API rate limits (429 / 5xx)
async function fetchMetaGraphWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2
): Promise<{ status: number; ok: boolean; data: any; retryCount: number }> {
  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { rawText: text };
      }

      // Retry only on transient rate limit (429) or gateway errors (502, 503, 504)
      if ((response.status === 429 || response.status >= 502) && attempt < maxRetries) {
        attempt++;
        const backoffMs = 600 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      return {
        status: response.status,
        ok: response.ok,
        data,
        retryCount: attempt,
      };
    } catch (networkErr: any) {
      if (attempt < maxRetries) {
        attempt++;
        const backoffMs = 600 * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      return {
        status: 503,
        ok: false,
        data: {
          error: {
            message: networkErr?.message || 'Network failure communicating with graph.facebook.com',
            type: 'NetworkTransportError',
            code: 503,
          },
        },
        retryCount: attempt,
      };
    }
  }
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);

  // Capture raw body for X-Hub-Signature-256 verification on Meta Webhooks
  app.use(
    express.json({
      limit: '2mb',
      verify: (req: AuthRequest, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // WebSocket Server for Real-Time Webhook & Status Telemetry Broadcasts
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const userSockets = new Map<string, Set<WebSocket>>();

  wss.on('connection', (ws) => {
    let authenticatedUid: string | null = null;

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'auth' && typeof msg.token === 'string') {
          const decoded = await adminAuth.verifyIdToken(msg.token);
          authenticatedUid = decoded.uid;
          if (!userSockets.has(authenticatedUid)) {
            userSockets.set(authenticatedUid, new Set());
          }
          userSockets.get(authenticatedUid)!.add(ws);
          ws.send(
            JSON.stringify({
              type: 'auth:confirmed',
              uid: authenticatedUid,
              timestamp: new Date().toISOString(),
            })
          );
        }
      } catch {
        ws.send(JSON.stringify({ type: 'auth:error', message: 'Invalid auth token' }));
      }
    });

    ws.on('close', () => {
      if (authenticatedUid && userSockets.has(authenticatedUid)) {
        userSockets.get(authenticatedUid)!.delete(ws);
      }
    });
  });

  function broadcastToUser(userId: string, eventPayload: Record<string, any>) {
    const sockets = userSockets.get(userId);
    if (!sockets) return;
    const serialized = JSON.stringify(eventPayload);
    for (const client of sockets) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }

  function broadcastGlobalWebhook(eventPayload: Record<string, any>) {
    const serialized = JSON.stringify(eventPayload);
    for (const [, sockets] of userSockets) {
      for (const client of sockets) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(serialized);
        }
      }
    }
  }

  const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

  let runtimeVerifyToken =
    process.env.META_WEBHOOK_VERIFY_TOKEN &&
    process.env.META_WEBHOOK_VERIFY_TOKEN !== 'YOUR_WEBHOOK_VERIFY_TOKEN'
      ? process.env.META_WEBHOOK_VERIFY_TOKEN.trim()
      : 'nexuswa_verify_token_prod';

  // 1. Meta Embedded Signup Configuration Status
  app.get('/api/meta/config', requireAuth, (req: AuthRequest, res: Response) => {
    const rawHost = req.get('x-forwarded-host') || req.get('host') || '';
    const forwardedProto = (req.get('x-forwarded-proto') || 'https').split(',')[0].trim();
    const fallbackOrigin = `${forwardedProto}://${rawHost}`;
    const envAppUrl =
      process.env.APP_URL &&
      process.env.APP_URL !== 'MY_APP_URL' &&
      process.env.APP_URL.startsWith('http')
        ? process.env.APP_URL.trim()
        : fallbackOrigin;

    // Derive the public Shared App URL (`ais-pre-...`) from `ais-dev-...` because
    // `ais-dev-...` is protected by browser cookie auth and cannot be reached by Meta's crawlers.
    const publicBaseUrl = envAppUrl.replace('://ais-dev-', '://ais-pre-').replace(/\/$/, '');

    res.json({
      metaAppId:
        process.env.META_APP_ID && process.env.META_APP_ID !== 'YOUR_META_APP_ID'
          ? process.env.META_APP_ID
          : '',
      metaConfigId:
        process.env.META_CONFIG_ID &&
        process.env.META_CONFIG_ID !== 'YOUR_META_EMBEDDED_SIGNUP_CONFIG_ID'
          ? process.env.META_CONFIG_ID
          : '',
      graphVersion: GRAPH_VERSION,
      webhookCallbackUrl: `${publicBaseUrl}/api/webhooks/whatsapp`,
      devWebhookCallbackUrl: `${envAppUrl.replace(/\/$/, '')}/api/webhooks/whatsapp`,
      webhookVerifyToken: runtimeVerifyToken,
      hasAppSecret: Boolean(
        process.env.META_APP_SECRET && process.env.META_APP_SECRET !== 'YOUR_META_APP_SECRET'
      ),
    });
  });

  // 1b. Update Custom Webhook Verify Token at Runtime
  app.post('/api/meta/webhook-token', requireAuth, (req: AuthRequest, res: Response) => {
    const { verifyToken } = req.body;
    if (typeof verifyToken === 'string' && verifyToken.trim().length >= 3) {
      runtimeVerifyToken = verifyToken.trim();
      return res.json({ ok: true, webhookVerifyToken: runtimeVerifyToken });
    }
    return res.status(400).json({ error: 'Verify token must be at least 3 characters.' });
  });

  // 2. Official Meta Embedded Signup OAuth Code Exchange + Live Phone Number Verification
  app.post('/api/meta/oauth/exchange', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const uid = req.user!.uid;
      const { code, wabaAccountId, wabaId, phoneNumberId, accessToken: directToken } = req.body;

      if (!wabaAccountId || !wabaId || !phoneNumberId) {
        return res.status(400).json({
          error: 'Missing required WABA Account ID, Meta WABA ID, or Phone Number ID.',
        });
      }

      let resolvedAccessToken = typeof directToken === 'string' ? directToken.trim() : '';

      // If an OAuth authorization code was returned by FB.login Embedded Signup, exchange it via Meta Graph API
      if (code && !resolvedAccessToken) {
        const clientId = process.env.META_APP_ID;
        const clientSecret = process.env.META_APP_SECRET;
        if (!clientId || !clientSecret || clientId === 'YOUR_META_APP_ID') {
          return res.status(400).json({
            error:
              'META_APP_ID and META_APP_SECRET must be configured on the server to exchange OAuth authorization codes.',
          });
        }

        const tokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
        tokenUrl.searchParams.set('client_id', clientId);
        tokenUrl.searchParams.set('client_secret', clientSecret);
        tokenUrl.searchParams.set('code', code);

        const tokenRes = await fetchMetaGraphWithRetry(tokenUrl.toString(), { method: 'GET' });
        if (!tokenRes.ok || !tokenRes.data?.access_token) {
          return res.status(tokenRes.status || 400).json({
            error:
              tokenRes.data?.error?.message ||
              'Failed to exchange Embedded Signup authorization code with Meta Graph API.',
            metaError: tokenRes.data?.error || tokenRes.data,
          });
        }
        resolvedAccessToken = tokenRes.data.access_token;
      }

      if (!resolvedAccessToken) {
        return res.status(400).json({
          error: 'Either an Embedded Signup OAuth code or a Meta System User Access Token is required.',
        });
      }

      // Inspect the Phone Number directly against graph.facebook.com to verify real eligibility & health
      const inspectUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
        phoneNumberId
      )}?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,code_verification_status,name_status`;

      const inspectRes = await fetchMetaGraphWithRetry(inspectUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${resolvedAccessToken}`,
        },
      });

      // Store encrypted token in server-side vault scoped to (uid + wabaAccountId)
      const { encryptedAccessToken, iv } = encryptToken(resolvedAccessToken);
      const vaultKey = `${uid}:${wabaAccountId}`;
      credentialVault.set(vaultKey, {
        userId: uid,
        wabaAccountId,
        wabaId,
        phoneNumberId,
        encryptedAccessToken,
        iv,
        updatedAt: new Date().toISOString(),
      });
      phoneNumberToTenantMap.set(phoneNumberId, { userId: uid, wabaAccountId, wabaId });

      // Attempt to subscribe the WABA to webhooks automatically if token is valid
      let webhookSubscribed = false;
      if (inspectRes.ok) {
        const subUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}/subscribed_apps`;
        const subRes = await fetchMetaGraphWithRetry(subUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resolvedAccessToken}`,
          },
        });
        webhookSubscribed = subRes.ok;
      }

      return res.json({
        verifiedWithMetaGraph: inspectRes.ok,
        httpStatus: inspectRes.status,
        phoneDetails: inspectRes.ok
          ? {
              displayPhoneNumber: inspectRes.data.display_phone_number || '',
              verifiedName: inspectRes.data.verified_name || '',
              qualityRating: ['GREEN', 'YELLOW', 'RED'].includes(inspectRes.data.quality_rating)
                ? inspectRes.data.quality_rating
                : 'UNKNOWN',
              messagingLimitTier: inspectRes.data.messaging_limit_tier || 'TIER_1K',
            }
          : null,
        webhookSubscribed,
        rawGraphResponse: inspectRes.data,
      });
    } catch (error: any) {
      console.error('Meta OAuth / credential exchange error:', error);
      return res.status(500).json({
        error: error?.message || 'Internal server error during WhatsApp Business account verification.',
      });
    }
  });

  // 3. Live Connection Health Check against Official Meta Graph API
  app.post('/api/meta/accounts/health', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const uid = req.user!.uid;
      const { wabaAccountId, phoneNumberId, accessToken: providedToken } = req.body;
      const vaultKey = `${uid}:${wabaAccountId}`;
      const record = credentialVault.get(vaultKey);

      let token = typeof providedToken === 'string' && providedToken.trim() ? providedToken.trim() : '';
      if (!token && record) {
        token = decryptToken(record.encryptedAccessToken, record.iv);
      }

      if (!token) {
        return res.status(401).json({
          healthy: false,
          status: 'TOKEN_EXPIRED',
          error:
            'No active Meta access token found in the server vault for this business account. Please re-authorize or provide your System User Token.',
        });
      }

      const inspectUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
        phoneNumberId
      )}?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,code_verification_status`;

      const graphRes = await fetchMetaGraphWithRetry(inspectUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!graphRes.ok) {
        const errCode = graphRes.data?.error?.code;
        const isAuthError = errCode === 190 || graphRes.status === 401;
        return res.json({
          healthy: false,
          httpStatus: graphRes.status,
          status: isAuthError ? 'TOKEN_EXPIRED' : 'DISCONNECTED',
          metaError: graphRes.data?.error || graphRes.data,
        });
      }

      return res.json({
        healthy: true,
        httpStatus: graphRes.status,
        status: 'CONNECTED',
        phoneDetails: {
          displayPhoneNumber: graphRes.data.display_phone_number,
          verifiedName: graphRes.data.verified_name,
          qualityRating: ['GREEN', 'YELLOW', 'RED'].includes(graphRes.data.quality_rating)
            ? graphRes.data.quality_rating
            : 'GREEN',
          messagingLimitTier: graphRes.data.messaging_limit_tier || 'TIER_1K',
        },
        rawGraphResponse: graphRes.data,
      });
    } catch (error: any) {
      return res.status(500).json({
        healthy: false,
        status: 'DISCONNECTED',
        error: error?.message || 'Failed to inspect phone number health.',
      });
    }
  });

  // 4. Disconnect & Revoke WABA Credentials on Server
  app.post('/api/meta/accounts/disconnect', requireAuth, async (req: AuthRequest, res: Response) => {
    const uid = req.user!.uid;
    const { wabaAccountId, phoneNumberId } = req.body;
    const vaultKey = `${uid}:${wabaAccountId}`;
    credentialVault.delete(vaultKey);
    if (phoneNumberId) {
      const mapped = phoneNumberToTenantMap.get(phoneNumberId);
      if (mapped && mapped.userId === uid) {
        phoneNumberToTenantMap.delete(phoneNumberId);
      }
    }
    return res.json({ disconnected: true, timestamp: new Date().toISOString() });
  });

  // 5. Real Outbound WhatsApp Cloud API Message Dispatch (Text, Approved Template, Image, Document, Audio, Video)
  app.post('/api/meta/messages/send', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const uid = req.user!.uid;
      const {
        wabaAccountId,
        phoneNumberId,
        recipientPhone,
        messageType,
        body,
        templateName,
        templateLanguage,
        templateParameters,
        mediaUrl,
        mediaCaption,
        accessToken: overrideToken,
      } = req.body;

      if (!wabaAccountId || !phoneNumberId || !recipientPhone || !messageType) {
        return res.status(400).json({
          error: 'wabaAccountId, phoneNumberId, recipientPhone, and messageType are required.',
        });
      }

      // Normalize recipient phone for Meta Cloud API (digits only)
      const normalizedRecipient = String(recipientPhone).replace(/[^\d]/g, '');
      if (normalizedRecipient.length < 7 || normalizedRecipient.length > 20) {
        return res.status(400).json({
          error: 'Invalid E.164 recipient phone number format.',
        });
      }

      const vaultKey = `${uid}:${wabaAccountId}`;
      const stored = credentialVault.get(vaultKey);
      let token = typeof overrideToken === 'string' && overrideToken.trim() ? overrideToken.trim() : '';
      if (!token && stored) {
        token = decryptToken(stored.encryptedAccessToken, stored.iv);
      }

      if (!token) {
        return res.status(401).json({
          status: 'FAILED',
          errorCode: 'MISSING_META_TOKEN',
          errorMessage:
            'No authorized Meta access token is stored in the server vault for this WhatsApp Business Account. Re-authenticate the account in WABA Accounts.',
          rawApiResponse: JSON.stringify({
            error: {
              message: 'Server vault has no active access token for this WABA.',
              type: 'OAuthException',
              code: 190,
            },
          }),
          retryCount: 0,
        });
      }

      // Construct official Meta WhatsApp Cloud API payload
      const metaPayload: Record<string, any> = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedRecipient,
      };

      if (messageType === 'text') {
        metaPayload.type = 'text';
        metaPayload.text = {
          preview_url: false,
          body: String(body || '').slice(0, 4096),
        };
      } else if (messageType === 'template') {
        metaPayload.type = 'template';
        metaPayload.template = {
          name: templateName,
          language: {
            code: templateLanguage || 'en_US',
          },
        };
        if (Array.isArray(templateParameters) && templateParameters.length > 0) {
          metaPayload.template.components = [
            {
              type: 'body',
              parameters: templateParameters.map((param: string) => ({
                type: 'text',
                text: String(param),
              })),
            },
          ];
        }
      } else if (['image', 'document', 'audio', 'video'].includes(messageType)) {
        metaPayload.type = messageType;
        const mediaObject: Record<string, any> = {
          link: mediaUrl,
        };
        if (mediaCaption && ['image', 'document', 'video'].includes(messageType)) {
          mediaObject.caption = String(mediaCaption).slice(0, 1024);
        }
        metaPayload[messageType] = mediaObject;
      } else {
        return res.status(400).json({ error: `Unsupported WhatsApp message type: ${messageType}` });
      }

      const graphEndpoint = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
        phoneNumberId
      )}/messages`;

      const graphResult = await fetchMetaGraphWithRetry(graphEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metaPayload),
      });

      if (!graphResult.ok) {
        const metaErr = graphResult.data?.error || {};
        return res.status(200).json({
          ok: false,
          httpStatus: graphResult.status,
          // Distinguish failed API calls accurately
          status: 'FAILED',
          metaMessageId: '',
          errorCode: String(metaErr.code || graphResult.status || 'META_API_ERROR'),
          errorMessage:
            metaErr.error_user_msg ||
            metaErr.message ||
            'Meta WhatsApp Cloud API rejected the message request.',
          rawApiResponse: JSON.stringify(graphResult.data, null, 2).slice(0, 4000),
          retryCount: graphResult.retryCount,
        });
      }

      // IMPORTANT: Never show a message as DELIVERED merely because the API accepted the request!
      // Meta returns messages[0].id and message_status ("accepted" or queued for dispatch).
      const wamid = graphResult.data?.messages?.[0]?.id || '';
      const initialMetaStatus = graphResult.data?.messages?.[0]?.message_status;
      const mappedStatus = initialMetaStatus === 'queued' ? 'QUEUED' : 'ACCEPTED';

      return res.status(200).json({
        ok: true,
        httpStatus: graphResult.status,
        status: mappedStatus,
        metaMessageId: wamid,
        errorCode: '',
        errorMessage: '',
        rawApiResponse: JSON.stringify(graphResult.data, null, 2).slice(0, 4000),
        retryCount: graphResult.retryCount,
      });
    } catch (error: any) {
      return res.status(500).json({
        ok: false,
        status: 'FAILED',
        metaMessageId: '',
        errorCode: 'INTERNAL_DISPATCH_ERROR',
        errorMessage: error?.message || 'Unexpected server error while calling Meta Graph API.',
        rawApiResponse: JSON.stringify({ error: error?.message || 'Internal error' }),
        retryCount: 0,
      });
    }
  });

  // 6. Sync & Create WhatsApp Message Templates from Official Meta Graph API
  app.post('/api/meta/templates/sync', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const uid = req.user!.uid;
      const { wabaAccountId, wabaId, accessToken: overrideToken } = req.body;
      const vaultKey = `${uid}:${wabaAccountId}`;
      const stored = credentialVault.get(vaultKey);
      let token = typeof overrideToken === 'string' && overrideToken.trim() ? overrideToken.trim() : '';
      if (!token && stored) {
        token = decryptToken(stored.encryptedAccessToken, stored.iv);
      }

      if (!token) {
        return res.status(401).json({
          ok: false,
          error: 'No active Meta Access Token in server vault for this WABA account.',
        });
      }

      const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
        wabaId
      )}/message_templates?fields=id,name,language,status,category,components&limit=50`;

      const graphRes = await fetchMetaGraphWithRetry(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!graphRes.ok) {
        return res.status(200).json({
          ok: false,
          httpStatus: graphRes.status,
          error: graphRes.data?.error?.message || 'Failed to fetch templates from Meta Graph API.',
          rawGraphResponse: graphRes.data,
        });
      }

      const rawTemplates = Array.isArray(graphRes.data?.data) ? graphRes.data.data : [];
      const normalized = rawTemplates.map((tpl: any) => {
        const components = Array.isArray(tpl.components) ? tpl.components : [];
        const headerComp = components.find((c: any) => c.type === 'HEADER');
        const bodyComp = components.find((c: any) => c.type === 'BODY');
        const footerComp = components.find((c: any) => c.type === 'FOOTER');
        return {
          metaTemplateId: String(tpl.id || ''),
          name: String(tpl.name || 'unnamed_template').toLowerCase().replace(/[^a-z0-9_]/g, '_'),
          language: String(tpl.language || 'en_US'),
          category: ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(tpl.category)
            ? tpl.category
            : 'UTILITY',
          status: ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED'].includes(tpl.status)
            ? tpl.status
            : 'PENDING',
          headerText: String(headerComp?.text || '').slice(0, 120),
          bodyText: String(bodyComp?.text || 'Template body').slice(0, 1024),
          footerText: String(footerComp?.text || '').slice(0, 120),
        };
      });

      return res.json({
        ok: true,
        httpStatus: graphRes.status,
        templates: normalized,
        rawGraphResponse: graphRes.data,
      });
    } catch (error: any) {
      return res.status(500).json({
        ok: false,
        error: error?.message || 'Failed to sync templates with Meta Graph API.',
      });
    }
  });

  // 7. Submit New WhatsApp Template to Meta Graph API for Approval
  app.post('/api/meta/templates/create', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const uid = req.user!.uid;
      const { wabaAccountId, wabaId, name, language, category, headerText, bodyText, footerText } = req.body;
      const vaultKey = `${uid}:${wabaAccountId}`;
      const stored = credentialVault.get(vaultKey);

      if (!stored) {
        return res.status(200).json({
          ok: false,
          error: 'No active Meta Access Token in server vault. Connect or re-verify your WABA token first.',
        });
      }

      const token = decryptToken(stored.encryptedAccessToken, stored.iv);
      const components: any[] = [];
      if (headerText) {
        components.push({ type: 'HEADER', format: 'TEXT', text: String(headerText).slice(0, 60) });
      }
      components.push({ type: 'BODY', text: String(bodyText).slice(0, 1024) });
      if (footerText) {
        components.push({ type: 'FOOTER', text: String(footerText).slice(0, 60) });
      }

      const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}/message_templates`;
      const graphRes = await fetchMetaGraphWithRetry(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          language,
          category,
          components,
        }),
      });

      return res.json({
        ok: graphRes.ok,
        httpStatus: graphRes.status,
        metaTemplateId: graphRes.data?.id || '',
        status: graphRes.data?.status || 'PENDING',
        rawGraphResponse: graphRes.data,
      });
    } catch (error: any) {
      return res.status(500).json({
        ok: false,
        error: error?.message || 'Failed to submit template to Meta Graph API.',
      });
    }
  });

  // 8. Official Meta Webhook Verification Endpoint (GET /api/webhooks/whatsapp)
  app.get('/api/webhooks/whatsapp', (req: Request, res: Response) => {
    const mode = String(req.query['hub.mode'] || '').trim();
    const token = String(req.query['hub.verify_token'] || '').trim();
    const challenge = String(req.query['hub.challenge'] || '');

    const envToken = (process.env.META_WEBHOOK_VERIFY_TOKEN || '').trim();
    const acceptedTokens = new Set(
      [runtimeVerifyToken, envToken, 'nexuswa_verify_token_prod'].filter(Boolean)
    );

    if (mode === 'subscribe' && acceptedTokens.has(token)) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(challenge);
    }

    console.warn(
      `[Meta Webhook Verify Rejected] mode=${mode}, receivedToken="${token}", expected="${runtimeVerifyToken}"`
    );
    return res.status(403).json({
      error: 'Webhook verification failed: hub.verify_token mismatch.',
      expectedVerifyTokenHint: runtimeVerifyToken,
    });
  });

  // 9. Official Meta Webhook Ingestion Endpoint (POST /api/webhooks/whatsapp)
  // Verifies X-Hub-Signature-256 HMAC SHA-256 when META_APP_SECRET is configured and broadcasts real-time events
  app.post('/api/webhooks/whatsapp', (req: AuthRequest, res: Response) => {
    try {
      const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;
      const appSecret = process.env.META_APP_SECRET;
      let signatureVerified = false;

      if (appSecret && appSecret !== 'YOUR_META_APP_SECRET' && req.rawBody) {
        if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
          return res.status(401).json({ error: 'Missing X-Hub-Signature-256 header' });
        }
        const expectedSig =
          'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
        const sigBuffer = Buffer.from(signatureHeader);
        const expectedBuffer = Buffer.from(expectedSig);
        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
          return res.status(401).json({ error: 'Invalid X-Hub-Signature-256 webhook signature' });
        }
        signatureVerified = true;
      }

      const body = req.body;
      if (body?.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) {
        return res.status(400).json({ error: 'Invalid WhatsApp Business Account webhook payload structure' });
      }

      for (const entry of body.entry) {
        const wabaId = String(entry.id || '');
        const changes = Array.isArray(entry.changes) ? entry.changes : [];

        for (const change of changes) {
          const field = String(change.field || 'messages');
          const value = change.value || {};
          const phoneNumberId = String(value?.metadata?.phone_number_id || '');
          const tenant = phoneNumberToTenantMap.get(phoneNumberId);

          const eventPacket = {
            type: 'whatsapp:webhook',
            wabaId,
            phoneNumberId,
            field,
            signatureVerified,
            value,
            rawPayload: JSON.stringify(change).slice(0, 3800),
            receivedAt: new Date().toISOString(),
          };

          if (tenant?.userId) {
            broadcastToUser(tenant.userId, eventPacket);
          } else {
            broadcastGlobalWebhook(eventPacket);
          }
        }
      }

      // Meta requires a fast 200 OK response within 5 seconds
      return res.status(200).json({ received: true, signatureVerified });
    } catch (error: any) {
      console.error('Error processing WhatsApp webhook:', error);
      return res.status(500).json({ error: 'Webhook processing failure' });
    }
  });

  // Vite Middleware in Development / Static Assets in Production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`NexusWA Cloud Server & WebSocket Gateway listening on port ${PORT}`);
  });
}

startServer();
