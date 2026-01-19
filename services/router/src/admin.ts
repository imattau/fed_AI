import { IncomingMessage, ServerResponse } from 'node:http';
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools';
import { decodeNpubToHex } from '@fed-ai/protocol';
import { RouterConfig } from './config';
import { RouterService } from './server';

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
    if (!verifyEvent(event)) return false;

    const adminHex = decodeNpubToHex(adminNpub);
    if (event.pubkey !== adminHex) return false;
    if (event.kind !== 27235) return false;

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - event.created_at) > 60) return false;

    const uTag = event.tags.find(t => t[0] === 'u');
    if (!uTag || !uTag[1].includes(req.url || '')) return false;

    const mTag = event.tags.find(t => t[0] === 'm');
    if (!mTag || mTag[1].toUpperCase() !== req.method) return false;

    return true;
  } catch (e) {
    return false;
  }
};

export const createAdminHandler = (service: RouterService, config: RouterConfig) => {
  return async (req: IncomingMessage, res: ServerResponse) => {
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

    if (req.method === 'GET' && req.url === '/admin/nodes') {
      return sendJson(res, 200, {
        nodes: service.nodes,
        count: service.nodes.length,
      });
    }

    if (req.method === 'POST' && req.url === '/admin/policy/block') {
      try {
        const body = await readJson(req);
        const { pubkey } = body;
        if (!pubkey) return sendJson(res, 400, { error: 'pubkey required' });
        
        // Dynamic policy update (local memory first, ideally persistent)
        if (!config.clientBlockList) config.clientBlockList = [];
        if (!config.clientBlockList.includes(pubkey)) {
            config.clientBlockList.push(pubkey);
        }
        
        return sendJson(res, 200, { status: 'blocked', pubkey });
      } catch (error) {
        return sendJson(res, 500, { error: String(error) });
      }
    }

    return sendJson(res, 404, { error: 'not-found' });
  };
};
