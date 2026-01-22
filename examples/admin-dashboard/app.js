const { generateSecretKey, getPublicKey, finalizeEvent, nip19, SimplePool } = window.NostrTools;

// State
let serviceUrl = 'http://node:8081';
let authMode = 'nip07';
let adminKey = '';
let adminNpub = '';
let nip98Token = ''; // base64 encoded signed event string
let appKeyPair = { secret: null, pubkey: null }; // For NIP-46 app identity
let remoteSignerPubkey = null; // The mobile app's pubkey
let pool = new SimplePool();

// UI Elements
const logBox = document.getElementById('app-log');
const connectBtn = document.getElementById('connect-btn');
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const connectionStatus = document.getElementById('connection-status');
const authModeSelect = document.getElementById('auth-mode');
const nip07Fields = document.getElementById('nip07-fields');
const nip46Fields = document.getElementById('nip46-fields');
const keyFields = document.getElementById('key-fields');
const qrcodeDiv = document.getElementById('qrcode');
const nip46BunkerUrl = document.getElementById('nip46-bunker-url');
const nip46GenBtn = document.getElementById('nip46-gen-btn');
const setupSection = document.getElementById('setup-wizard');
const stepClaim = document.getElementById('step-claim');
const stepConfig = document.getElementById('step-config');
const claimBtn = document.getElementById('claim-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const serviceUrlInput = document.getElementById('service-url');

const log = (msg) => {
    const el = document.createElement('div');
    el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logBox.prepend(el);
    console.log(msg);
};

// --- NIP-46 Logic ---
const RELAY_URL = 'wss://relay.damus.io';

const rpcNip46 = async (method, params) => {
    return new Promise(async (resolve, reject) => {
        if (!remoteSignerPubkey) return reject('Not connected');
        
        const reqId = Math.random().toString(36).slice(2);
        const req = { id: reqId, method, params };
        
        const encrypted = await window.NostrTools.nip04.encrypt(appKeyPair.secret, remoteSignerPubkey, JSON.stringify(req));
        
        const event = finalizeEvent({
            kind: 24133,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', remoteSignerPubkey]],
            content: encrypted,
        }, appKeyPair.secret);
        
        // Subscribe for response first
        const sub = pool.subscribeMany(
            [RELAY_URL],
            [{ kinds: [24133], '#p': [appKeyPair.pubkey], authors: [remoteSignerPubkey], since: Math.floor(Date.now() / 1000) }],
            {
                onevent: async (evt) => {
                    try {
                        const dec = await window.NostrTools.nip04.decrypt(appKeyPair.secret, evt.pubkey, evt.content);
                        const resp = JSON.parse(dec);
                        if (resp.id === reqId) {
                            sub.close();
                            if (resp.error) reject(resp.error);
                            else resolve(resp.result); // For sign_event, result is the signed event object
                        }
                    } catch (e) {
                         // ignore irrelevant messages
                    }
                }
            }
        );

        await Promise.any(pool.publish([RELAY_URL], event));
        
        // Timeout
        setTimeout(() => {
            sub.close();
            reject('NIP-46 Timeout');
        }, 30000);
    });
};

// NIP-98 Helper
const createNip98Event = async (url, method) => {
  const uTag = ['u', url];
  const mTag = ['m', method.toUpperCase()];
  
  const unsigned = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [uTag, mTag],
    content: '',
  };

  if (authMode === 'nip07') {
    if (!window.nostr) throw new Error('No NIP-07 extension found');
    return await window.nostr.signEvent(unsigned);
  } 
  
  if (authMode === 'nip46') {
      if (!remoteSignerPubkey) throw new Error('NIP-46 not connected');
      // Send sign_event RPC
      return await rpcNip46('sign_event', [JSON.stringify(unsigned)]);
  }

  throw new Error('Unsupported auth mode for NIP-98');
};

// API Helper
const apiCall = async (path, method = 'GET', body = null) => {
  serviceUrl = document.getElementById('service-url').value.replace(/\/$/, '');
  const fullUrl = `${serviceUrl}${path}`;
  
  const headers = { 'Content-Type': 'application/json' };

  if (authMode === 'key') {
    headers['X-Admin-Key'] = document.getElementById('admin-key').value;
  } else {
    // Generate fresh NIP-98 token for each request (or reuse valid one)
    // For simplicity, we generate one per request (timestamp dependent).
    // Note: In strict mode, URL must match exactly.
    // Since we proxy, the URL seen by the backend is `serviceUrl + path`.
    // The U tag must match that.
    try {
        const evt = await createNip98Event(fullUrl, method);
        const token = btoa(JSON.stringify(evt));
        headers['Authorization'] = `Nostr ${token}`;
    } catch (e) {
        log(`Auth Error: ${e.message}`);
        throw e;
    }
  }

  // Use local proxy
  const proxyUrl = `/api/proxy?target=${encodeURIComponent(serviceUrl)}&path=${encodeURIComponent(path)}`;
  
  const res = await fetch(proxyUrl, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  
  if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${res.status}: ${text}`);
  }
  return await res.json();
};

// Check Setup Status
const checkSetupStatus = async () => {
    try {
        const res = await apiCall('/admin/setup/status');
        
        if (!res.claimed) {
            setupSection.classList.remove('hidden');
            stepClaim.classList.remove('hidden');
            stepConfig.classList.add('hidden');
            authSection.querySelector('h3').textContent = 'Authentication Method';
            connectBtn.classList.add('hidden');
            log('Service UNCLAIMED. Starting First Run Wizard.');
        } else if (res.setupMode) {
            // Claimed but in setup mode (missing config)
            setupSection.classList.remove('hidden');
            stepClaim.classList.add('hidden');
            stepConfig.classList.remove('hidden');
            
            // We need to be logged in to configure!
            // Show login first? Or assume we just claimed?
            // If we have a token, we are good. If not, we need to login.
            if (!nip98Token && authMode === 'key' && !document.getElementById('admin-key').value) {
                 log('Service in Setup Mode. Please Login first.');
                 authSection.querySelector('h3').textContent = 'Login to Continue Setup';
                 connectBtn.classList.remove('hidden');
                 connectBtn.textContent = 'Login & Configure';
            } else {
                 log('Service in Setup Mode. Please configure.');
            }
        } else {
            setupSection.classList.add('hidden');
            authSection.querySelector('h3').textContent = 'Connect';
            connectBtn.classList.remove('hidden');
            connectBtn.textContent = 'Connect & Login';
        }
    } catch (e) {
        console.log('Setup check failed:', e);
        // Retry if service is starting up
        setTimeout(checkSetupStatus, 3000);
    }
};

serviceUrlInput.addEventListener('blur', checkSetupStatus);
checkSetupStatus();

// Claim Logic
claimBtn.addEventListener('click', async () => {
    try {
        serviceUrl = serviceUrlInput.value.replace(/\/$/, '');
        const fullUrl = `${serviceUrl}/admin/setup/claim`;
        const method = 'POST';
        
        const evt = await createNip98Event(fullUrl, method);
        const token = btoa(JSON.stringify(evt));
        nip98Token = token; // Cache it for next steps
        
        const proxyUrl = `/api/proxy?target=${encodeURIComponent(serviceUrl)}&path=${encodeURIComponent('/admin/setup/claim')}`;
        
        const res = await fetch(proxyUrl, {
            method,
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Nostr ${token}`
            }
        });
        
        if (!res.ok) throw new Error(await res.text());
        const body = await res.json();
        
        log(`Claimed! Admin NPUB: ${body.adminNpub}`);
        document.getElementById('admin-npub').value = body.adminNpub;
        
        // Move to Step 2
        stepClaim.classList.add('hidden');
        stepConfig.classList.remove('hidden');
        log('Proceeding to Configuration...');
        
    } catch (e) {
        log(`Claim Failed: ${e.message}`);
    }
});

// Save Config Logic
if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', async () => {
        try {
            const routerEndpoint = document.getElementById('setup-router-url').value;
            const nwcUrl = document.getElementById('setup-nwc-url').value;
            const relaysRaw = document.getElementById('setup-relays').value;
            
            const payload = {
                _restart: true,
                routerEndpoint: routerEndpoint || undefined,
                relayBootstrap: relaysRaw ? relaysRaw.split(',').map(r => r.trim()).filter(Boolean) : undefined,
            };
            
            await apiCall('/admin/config', 'POST', payload);
            log('Configuration saved. Restarting service...');
            
            setTimeout(() => {
                location.reload();
            }, 3000);
            
        } catch (e) {
            log(`Config Save Failed: ${e.message}`);
        }
    });
}

// Tabs

// Tabs
document.querySelectorAll('.tab-button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    
    // Refresh data on tab switch
    if (btn.dataset.tab === 'status') loadStatus();
    if (btn.dataset.tab === 'nodes') loadNodes();
    if (btn.dataset.tab === 'config') loadConfig();
  });
});

// Auth Mode Toggle
authModeSelect.addEventListener('change', () => {
  authMode = authModeSelect.value;
  nip07Fields.classList.add('hidden');
  nip46Fields.classList.add('hidden');
  keyFields.classList.add('hidden');

  if (authMode === 'nip07') nip07Fields.classList.remove('hidden');
  if (authMode === 'nip46') {
      nip46Fields.classList.remove('hidden');
      if (!appKeyPair.secret) generateNip46Session();
  }
  if (authMode === 'key') keyFields.classList.remove('hidden');
});


// --- NIP-46 Logic ---

const generateNip46Session = () => {
    appKeyPair.secret = generateSecretKey();
    appKeyPair.pubkey = getPublicKey(appKeyPair.secret);
    
    const uri = `nostrconnect://${appKeyPair.pubkey}?relay=${encodeURIComponent(RELAY_URL)}&metadata=${encodeURIComponent(JSON.stringify({name: 'FedAI Admin', url: window.location.href}))}`;
    
    nip46BunkerUrl.value = uri;
    qrcodeDiv.innerHTML = '';
    new QRCode(qrcodeDiv, { text: uri, width: 256, height: 256 });
    
    log('Waiting for NIP-46 connection...');
    listenForNip46();
};

const listenForNip46 = async () => {
    const sub = pool.subscribeMany(
        [RELAY_URL],
        [{ kinds: [24133], '#p': [appKeyPair.pubkey], since: Math.floor(Date.now() / 1000) }],
        {
            onevent: (event) => {
                handleNip46Request(event);
            }
        }
    );
};

const handleNip46Request = async (event) => {
    try {
        const decrypted = await window.NostrTools.nip04.decrypt(appKeyPair.secret, event.pubkey, event.content);
        const req = JSON.parse(decrypted);
        
        if (req.method === 'connect') {
            remoteSignerPubkey = event.pubkey; // explicitly trust the connector
            log(`NIP-46 Connected to ${remoteSignerPubkey.slice(0, 8)}...`);
            
            // Send 'connect' ack
            const resp = { id: req.id, result: 'ack', error: null };
            await sendNip46Response(event.pubkey, resp);
            
            connectionStatus.textContent = 'NIP-46 Linked';
            connectionStatus.classList.add('status-ok');
        }
    } catch (e) {
        log(`NIP-46 Error: ${e}`);
    }
};

const sendNip46Response = async (targetPubkey, response) => {
    const encrypted = await window.NostrTools.nip04.encrypt(appKeyPair.secret, targetPubkey, JSON.stringify(response));
    const event = finalizeEvent({
        kind: 24133,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', targetPubkey]],
        content: encrypted,
    }, appKeyPair.secret);
    
    await Promise.any(pool.publish([RELAY_URL], event));
};



// --- Dashboard Logic ---

const loadConfig = async () => {
    try {
        const config = await apiCall('/admin/config');
        document.getElementById('config-raw').textContent = JSON.stringify(config, null, 2);
    } catch (e) {
        log(`Load Config Failed: ${e.message}`);
    }
};

const loadStatus = async () => {
    try {
        // Try router status first, then router nodes (if router) or downloads (if node)
        // We don't know if we are connected to Node or Router yet.
        // Try /admin/config to guess? Or just try endpoints.
        
        // Refresh downloads list (Node specific)
            const dl = await apiCall('/admin/downloads');
            const list = document.getElementById('downloads-list');
            if (dl.downloads && dl.downloads.length) {
                list.innerHTML = dl.downloads.map(d => `
                    <div class="node-item">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <strong>${d.id.split('-')[0]}</strong>
                            <span class="status-badge ${d.status === 'completed' ? 'status-ok' : 'status-warn'}">${d.status}</span>
                        </div>
                        <div style="font-size: 11px; background: #000; height: 4px; border-radius: 2px; overflow: hidden; margin: 8px 0;">
                            <div style="background: var(--accent-primary); width: ${d.progress}%; height: 100%;"></div>
                        </div>
                        <span style="font-size: 11px;">Progress: ${d.progress.toFixed(1)}%</span>
                        ${d.error ? `<br><span style="color:var(--status-error); font-size: 11px;">${d.error}</span>` : ''}
                    </div>
                `).join('');
            } else {
                list.textContent = 'No active downloads';
            }
        
        // Refresh Service Info
        try {
             // For router/node generic status
             const status = await apiCall('/status'); // Public endpoint usually
             document.getElementById('status-raw').textContent = JSON.stringify(status, null, 2);
        } catch (e) {
             document.getElementById('status-raw').textContent = `Error: ${e.message}`;
        }
    } catch (e) {
        log(`Load Status Failed: ${e.message}`);
    }
};

const loadNodes = async () => {
    try {
        const res = await apiCall('/admin/nodes');
        const list = document.getElementById('nodes-list');
        list.innerHTML = '';
        
        if (res.nodes) {
             res.nodes.forEach(node => {
                 const div = document.createElement('div');
                 div.className = 'card';
                 div.style.border = '1px solid #444';
                 div.innerHTML = `
                    <strong>${node.nodeId}</strong> <br>
                    URL: ${node.endpoint} <br>
                    Models: ${node.capabilities?.map(c => c.modelId).join(', ') || 'none'}
                 `;
                 list.appendChild(div);
             });
        }
    } catch (e) {
        document.getElementById('nodes-list').textContent = `Error (Not a Router?): ${e.message}`;
    }
};

const searchModels = async () => {
    const q = document.getElementById('hf-model-id').value;
    if (!q) return;
    
    try {
        const res = await apiCall('/admin/models/search', 'POST', { modelId: q });
        const list = document.getElementById('model-files-list');
        list.innerHTML = '';
        
        if (res.files) {
            res.files.forEach(f => {
                const row = document.createElement('div');
                row.style.marginBottom = '5px';
                
                const btn = document.createElement('button');
                btn.textContent = `Download ${(f.sizeBytes / 1e9).toFixed(2)} GB`;
                btn.onclick = () => downloadModel(f.downloadUrl, pathBasename(f.path));
                
                row.appendChild(btn);
                row.append(` ${f.path}`);
                list.appendChild(row);
            });
        }
    } catch (e) {
        log(`Search Failed: ${e.message}`);
    }
};

const downloadModel = async (url, filename) => {
    try {
        await apiCall('/admin/models/download', 'POST', { url, filename });
        log(`Download started for ${filename}`);
        loadStatus(); // refresh downloads
    } catch (e) {
        log(`Download request failed: ${e.message}`);
    }
};

const blockPubkey = async () => {
    const pubkey = document.getElementById('block-pubkey').value;
    if (!pubkey) return;
    try {
        await apiCall('/admin/policy/block', 'POST', { pubkey });
        log(`Blocked ${pubkey}`);
    } catch (e) {
        log(`Block failed: ${e.message}`);
    }
};

// Utils
const pathBasename = (p) => p.split(/[\/]/).pop();

// Event Listeners
connectBtn.addEventListener('click', async () => {
    authSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    connectionStatus.textContent = '● Connected';
    connectionStatus.style.color = 'var(--status-ok)';
    
    loadStatus();
});

document.getElementById('refresh-downloads').onclick = loadStatus;
document.getElementById('refresh-nodes').onclick = loadNodes;
document.getElementById('search-model-btn').onclick = searchModels;
document.getElementById('block-btn').onclick = blockPubkey;

// Init
if (window.nostr) {
    // Auto-detect extension? No, let user choose.
}
