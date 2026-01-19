import { IncomingMessage, ServerResponse } from 'node:http';
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools';
import { decodeNpubToHex } from '@fed-ai/protocol';
import { NodeConfig } from './config';
import { downloadModelFile, searchGGUF } from './utils/huggingface';
import { logInfo, logWarn } from './logging';
import { NodeService } from './server';

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readJson = async (req: IncomingMessage) => {
  const buffers = [];
  for await (const chunk of req) {
    buffers.push(chunk);
  }
  const data = Buffer.concat(buffers).toString();
  return data ? JSON.parse(data) : {};
};

const validateNip98 = async (req: IncomingMessage, adminNpub?: string): Promise<boolean> => {
  if (!adminNpub) return false;
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Nostr ')) return false;

  const token = authHeader.slice(6).trim();
  if (!token) return false;

  try {
    const raw = Buffer.from(token, 'base64').toString('utf8');
    const event = JSON.parse(raw) as NostrEvent;

    // 1. Verify signature
    if (!verifyEvent(event)) return false;

    // 2. Verify pubkey matches admin
    const adminHex = decodeNpubToHex(adminNpub);
    if (event.pubkey !== adminHex) return false;

    // 3. Verify Kind 27235 (Http Auth)
    if (event.kind !== 27235) return false;

    // 4. Verify Timestamp (within 60s)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - event.created_at) > 60) return false;

    // 5. Verify URL tag
    const uTag = event.tags.find(t => t[0] === 'u');
    // Basic check: just path, or full URL if possible. 
    // req.url is just path. Construct full URL assuming standard headers?
    // For MVP, we'll check that the tag *ends* with req.url or matches exactly.
    // If behind proxy, Host header is needed.
    const host = req.headers['host'];
    const protocol = (req as any).protocol || 'http'; // Express-like, but this is raw http.
    // NIP-98 requires full URL. We'll be lenient and check if uTag contains req.url
    if (!uTag || !uTag[1].includes(req.url || '')) return false;

    // 6. Verify Method tag
    const mTag = event.tags.find(t => t[0] === 'm');
    if (!mTag || mTag[1].toUpperCase() !== req.method) return false;

    return true;
  } catch (e) {
    return false;
  }
};

const downloads = new Map<string, { status: 'pending' | 'downloading' | 'completed' | 'failed'; progress: number; error?: string }>();

export const createAdminHandler = (service: NodeService, config: NodeConfig) => {
  return async (req: IncomingMessage, res: ServerResponse) => {
    // 1. Check legacy Key
    const adminKey = req.headers['x-admin-key'];
    let authorized = false;
    
    if (config.adminKey && adminKey === config.adminKey) {
        authorized = true;
    } else if (config.adminNpub) {
        authorized = await validateNip98(req, config.adminNpub);
    }

    if (!authorized) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    if (req.method === 'GET' && req.url === '/admin/config') {
      const safeConfig = { ...config, privateKey: '[REDACTED]', adminKey: '[REDACTED]' };
      return sendJson(res, 200, safeConfig);
    }

    if (req.method === 'POST' && req.url === '/admin/models/search') {
      try {
        const body = await readJson(req);
        if (!body.modelId) return sendJson(res, 400, { error: 'modelId required' });
        const files = await searchGGUF(body.modelId);
        return sendJson(res, 200, { files });
      } catch (error) {
        return sendJson(res, 500, { error: String(error) });
      }
    }

    if (req.method === 'POST' && req.url === '/admin/models/download') {
      try {
        const body = await readJson(req);
        const { url, filename } = body;
        if (!url || !filename) return sendJson(res, 400, { error: 'url and filename required' });

        const downloadId = `${filename}-${Date.now()}`;
        downloads.set(downloadId, { status: 'pending', progress: 0 });

        // Start background download
        downloadModelFile(url, './models', filename, (p) => {
          const entry = downloads.get(downloadId);
          if (entry) {
            entry.status = 'downloading';
            entry.progress = p.percent;
          }
        })
          .then((path) => {
            logInfo(`[admin] downloaded model to ${path}`);
            const entry = downloads.get(downloadId);
            if (entry) {
              entry.status = 'completed';
              entry.progress = 100;
            }
          })
          .catch((err) => {
            logWarn(`[admin] download failed: ${err}`);
            const entry = downloads.get(downloadId);
            if (entry) {
              entry.status = 'failed';
              entry.error = String(err);
            }
          });

        return sendJson(res, 202, { downloadId, status: 'started' });
      } catch (error) {
        return sendJson(res, 500, { error: String(error) });
      }
    }

    if (req.method === 'GET' && req.url?.startsWith('/admin/downloads')) {
        const entries = Array.from(downloads.entries()).map(([id, info]) => ({ id, ...info }));
        return sendJson(res, 200, { downloads: entries });
    }

    return sendJson(res, 404, { error: 'not-found' });
  };
};
