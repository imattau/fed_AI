const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { parse } = require('node:url');

const PORT = process.env.PORT || 3001;

const serveFile = async (res, filePath, contentType) => {
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
};

const server = http.createServer(async (req, res) => {
  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = parse(req.url, true);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return serveFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/app.js') {
    return serveFile(res, path.join(__dirname, 'app.js'), 'text/javascript; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/style.css') {
    return serveFile(res, path.join(__dirname, 'style.css'), 'text/css; charset=utf-8');
  }

  // Proxy: /api/proxy?target=http://localhost:8081&path=/admin/config
  if (url.pathname === '/api/proxy') {
    const target = url.query.target;
    const targetPath = url.query.path;
    
    if (!target || !targetPath) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'target and path required' }));
      return;
    }

    try {
      const targetUrl = new URL(target);
      // Construct upstream URL
      const upstreamUrl = `${targetUrl.origin}${targetPath}`;
      
      const upstreamReq = await fetch(upstreamUrl, {
        method: req.method,
        headers: {
            'content-type': req.headers['content-type'] || 'application/json',
            'authorization': req.headers['authorization'] || '',
            'x-admin-key': req.headers['x-admin-key'] || '',
            // Pass minimal headers
        },
        body: req.method !== 'GET' ? req : undefined,
        duplex: 'half',
      });

      res.writeHead(upstreamReq.status, { 'content-type': 'application/json' });
      const text = await upstreamReq.text();
      res.end(text);
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy-error', details: String(e) }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Admin Dashboard running at http://localhost:${PORT}`);
});
