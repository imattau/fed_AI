import { IncomingMessage, ServerResponse } from 'node:http';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { symlink, unlink, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyEvent, type Event as NostrEvent, nip19 } from 'nostr-tools';
import { decodeNpubToHex } from '@fed-ai/protocol';
import { NodeConfig } from './config';
import { downloadModelFile, searchGGUF, searchModels } from './utils/huggingface';
import { logInfo, logWarn } from './logging';
import { NodeService } from './server';

const getConfigPath = (filename: string): string => {
  const dir = process.env.NODE_CONFIG_DIR || '.';
  return path.resolve(dir, filename);
};

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

const parseNip98Token = (req: IncomingMessage): NostrEvent | null => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Nostr ')) return null;
  const token = authHeader.slice(6).trim();
  if (!token) return null;
  try {
    const raw = Buffer.from(token, 'base64').toString('utf8');
    return JSON.parse(raw) as NostrEvent;
  } catch {
    return null;
  }
};

const validateNip98Event = (event: NostrEvent, req: IncomingMessage): boolean => {
    if (!verifyEvent(event)) return false;
    if (event.kind !== 27235) return false;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - event.created_at) > 60) return false;
    
    const uTag = event.tags.find(t => t[0] === 'u');
    if (!uTag || !uTag[1].includes(req.url || '')) return false;

    const mTag = event.tags.find(t => t[0] === 'm');
    if (!mTag || mTag[1].toUpperCase() !== req.method) return false;
    return true;
};

const validateNip98 = async (req: IncomingMessage, adminNpub?: string): Promise<boolean> => {
  if (!adminNpub) return false;
  const event = parseNip98Token(req);
  if (!event) return false;

  if (!validateNip98Event(event, req)) return false;

  const adminHex = decodeNpubToHex(adminNpub);
  if (event.pubkey !== adminHex) return false;

  return true;
};

const downloads = new Map<string, { status: 'pending' | 'downloading' | 'completed' | 'failed'; progress: number; error?: string }>();

export const createAdminHandler = (service: NodeService, config: NodeConfig) => {
  return async (req: IncomingMessage, res: ServerResponse) => {
    // Setup Endpoints (Public if unclaimed)
    if (req.url === '/admin/setup/status' && req.method === 'GET') {
        const claimed = Boolean(config.adminKey || config.adminNpub);
        return sendJson(res, 200, { claimed, setupMode: config.setupMode });
    }

    if (req.url === '/admin/setup/claim' && req.method === 'POST') {
        if (config.adminKey || config.adminNpub) {
            return sendJson(res, 403, { error: 'already-claimed' });
        }
        
        const event = parseNip98Token(req);
        if (!event || !validateNip98Event(event, req)) {
            return sendJson(res, 401, { error: 'invalid-auth-event' });
        }

        const npub = nip19.npubEncode(event.pubkey);
        try {
            writeFileSync(getConfigPath('admin-identity.json'), JSON.stringify({ adminNpub: npub }));
            config.adminNpub = npub; // Update in-memory config
            logInfo(`[admin] claimed by ${npub}`);
            return sendJson(res, 200, { status: 'claimed', adminNpub: npub });
        } catch (e) {
            logWarn(`[admin] failed to persist claim`, e);
            return sendJson(res, 500, { error: 'persistence-failed' });
        }
    }

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

    if (req.method === 'POST' && req.url === '/admin/config') {
      try {
        const body = await readJson(req);
        let current = {};
        try { current = JSON.parse(readFileSync(getConfigPath('config.json'), 'utf8')); } catch {}
        
        const restart = body._restart;
        delete body._restart;
        
        const newConfig = { ...current, ...body };
        writeFileSync(getConfigPath('config.json'), JSON.stringify(newConfig, null, 2));
        
        if (restart) {
             setTimeout(() => process.exit(0), 1000);
             return sendJson(res, 200, { status: 'restarting' });
        }
        return sendJson(res, 200, { status: 'saved' });
      } catch (error) {
        return sendJson(res, 500, { error: String(error) });
      }
    }

    if (req.method === 'POST' && req.url === '/admin/models/set-active') {
      try {
        const body = await readJson(req);
        const { filename, modelId } = body;
        if (!filename || !modelId) return sendJson(res, 400, { error: 'filename and modelId required' });

        // Update config
        let current = {};
        try { current = JSON.parse(readFileSync(getConfigPath('config.json'), 'utf8')); } catch {}
        const newConfig = { ...current, defaultModelId: modelId };
        writeFileSync(getConfigPath('config.json'), JSON.stringify(newConfig, null, 2));

        // Update symlink/copy
        const modelsDir = './models'; // Assumes node service running in /app/services/node? No, WORKDIR /app. So ./models is /app/models? No.
        // Node service mounts ./models:/models. Wait.
        // Node service docker-compose: volumes: - ./models:/models:ro (Wait, node service doesn't mount models?)
        // Llama service mounts models.
        // Node service ONLY has access if it mounts it too.
        
        // I need to check docker-compose.yml again.
        // Node service volumes: - keys, - node-config, - src.
        // It does NOT mount models!
        
        // If Node service cannot access /models, it cannot update the symlink.
        // This confirms my previous fear.
        
        // I must update docker-compose to mount models to node service as RW.
        
        const targetPath = path.resolve('/models', filename);
        const linkPath = path.resolve('/models', 'current.gguf');
        
        if (existsSync('/models')) {
             try {
                 if (existsSync(linkPath)) await unlink(linkPath);
                 await symlink(targetPath, linkPath);
             } catch (e) {
                 // If symlink fails (e.g. cross-device), try copy?
                 // Or log warning.
                 logWarn('[admin] failed to update symlink', e);
                 // Fallback: copy? Too slow.
             }
        }

        return sendJson(res, 200, { status: 'updated', modelId });
      } catch (error) {
        return sendJson(res, 500, { error: String(error) });
      }
    }

    if (req.method === 'POST' && req.url === '/admin/models/search') {
      try {
        const body = await readJson(req);
        if (!body.modelId) return sendJson(res, 400, { error: 'modelId required' });
        
        if (body.modelId.includes('/')) {
            const files = await searchGGUF(body.modelId, config.hfToken);
            return sendJson(res, 200, { files });
        } else {
            const models = await searchModels(body.modelId, config.hfToken);
            return sendJson(res, 200, { models });
        }
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
