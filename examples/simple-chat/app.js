/** @type {HTMLElement | null} */
const chat = document.getElementById('chat');
const form = /** @type {HTMLFormElement | null} */ (document.getElementById('chat-form'));
const promptInput = /** @type {HTMLInputElement | null} */ (document.getElementById('prompt'));
/** @type {HTMLElement | null} */
const statusEl = document.getElementById('status');
/** @type {HTMLElement | null} */
const wallet = document.getElementById('wallet-sats');
/** @type {HTMLElement | null} */
const routerHealth = document.getElementById('router-health');
/** @type {HTMLElement | null} */
const routerActive = document.getElementById('router-active');
/** @type {HTMLElement | null} */
const routerTotal = document.getElementById('router-total');
/** @type {HTMLElement | null} */
const routerNodes = document.getElementById('router-nodes');
/** @type {HTMLElement | null} */
const routerFederationEnabled = document.getElementById('router-federation-enabled');
/** @type {HTMLElement | null} */
const routerFederationRate = document.getElementById('router-federation-rate');
/** @type {HTMLElement | null} */
const routerNostrEnabled = document.getElementById('router-nostr-enabled');
/** @type {HTMLElement | null} */
const routerNostrRelays = document.getElementById('router-nostr-relays');
/** @type {HTMLElement | null} */
const routerNostrFollow = document.getElementById('router-nostr-follow');
/** @type {HTMLElement | null} */
const routerNostrMute = document.getElementById('router-nostr-mute');
/** @type {HTMLElement | null} */
const routerNostrBlock = document.getElementById('router-nostr-block');
/** @type {HTMLElement | null} */
const routerNostrRetry = document.getElementById('router-nostr-retry');
/** @type {HTMLElement | null} */
const routerPostgres = document.getElementById('router-postgres');
/** @type {HTMLElement | null} */
const nodeSummary = document.getElementById('node-summary');
/** @type {HTMLElement | null} */
const nodeList = document.getElementById('node-list');
/** @type {HTMLElement | null} */
const nodeFollow = document.getElementById('node-follow');
/** @type {HTMLElement | null} */
const nodeMute = document.getElementById('node-mute');
/** @type {HTMLElement | null} */
const nodeBlock = document.getElementById('node-block');
/** @type {HTMLElement | null} */
const nodePostgres = document.getElementById('node-postgres');
const modelSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('model-select'));
/** @type {HTMLElement | null} */
const grokModal = document.getElementById('grok-modal');
const grokApiKeyInput = /** @type {HTMLInputElement | null} */ (document.getElementById('grok-api-key'));
/** @type {HTMLElement | null} */
const grokCheck = document.getElementById('grok-check');
/** @type {HTMLElement | null} */
const grokCheckStatus = document.getElementById('grok-check-status');
/** @type {HTMLElement | null} */
const grokCancel = document.getElementById('grok-cancel');
/** @type {HTMLElement | null} */
const grokSave = document.getElementById('grok-save');
/** @type {HTMLElement | null} */
const grokKeyStatus = document.getElementById('grok-key-status');
const tabButtons = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-tab]'));
const tabPanels = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.tab-panel'));

const appendMessage = (role, text) => {
  const row = document.createElement('div');
  row.className = `message ${role}`;
  row.textContent = text;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
};

const formatList = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return 'none';
  }
  return values.join(', ');
};

const refreshWallet = async () => {
  if (!wallet) return;
  try {
    const response = await fetch('/api/wallet');
    if (!response.ok) return;
    const payload = await response.json();
    wallet.textContent = `${payload.sats ?? '--'} sats`;
  } catch {
    wallet.textContent = '-- sats';
  }
};

let selectedModel = 'auto';
let grokApiKey = '';
let previousModel = 'auto';

const updateGrokStatus = () => {
  if (!grokKeyStatus) return;
  if (grokApiKey) {
    grokKeyStatus.textContent = 'Groq key: set';
    grokKeyStatus.classList.add('ok');
  } else {
    grokKeyStatus.textContent = 'Groq key: not set';
    grokKeyStatus.classList.remove('ok');
  }
};

const setGrokCheckStatus = (text, ok) => {
  if (!grokCheckStatus) return;
  grokCheckStatus.textContent = text;
  if (ok) {
    grokCheckStatus.classList.add('ok');
  } else {
    grokCheckStatus.classList.remove('ok');
  }
};

const openGrokModal = () => {
  if (!grokModal) return;
  grokModal.classList.remove('hidden');
  if (grokApiKeyInput) {
    grokApiKeyInput.value = grokApiKey;
    grokApiKeyInput.focus();
  }
  setGrokCheckStatus('Not checked', false);
};

const closeGrokModal = () => {
  if (!grokModal) return;
  grokModal.classList.add('hidden');
};

if (modelSelect) {
  modelSelect.addEventListener('change', () => {
    const value = modelSelect.value;
    if (value === 'llama3-8b-8192') {
      previousModel = selectedModel;
      selectedModel = value;
      if (!grokApiKey) {
        openGrokModal();
      }
      return;
    }
    selectedModel = value;
  });
}

if (grokCancel) {
  grokCancel.addEventListener('click', () => {
    closeGrokModal();
    selectedModel = previousModel;
    if (modelSelect) {
      modelSelect.value = selectedModel;
    }
  });
}

if (grokSave) {
  grokSave.addEventListener('click', () => {
    grokApiKey = grokApiKeyInput ? grokApiKeyInput.value.trim() : '';
    updateGrokStatus();
    setGrokCheckStatus('Not checked', false);
    closeGrokModal();
  });
}

if (grokCheck) {
  grokCheck.addEventListener('click', async () => {
    const key = grokApiKeyInput ? grokApiKeyInput.value.trim() : '';
    if (!key) {
      setGrokCheckStatus('Key required', false);
      return;
    }
    setGrokCheckStatus('Checking...', false);
    try {
      const response = await fetch('/api/grok-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: key }),
      });
      if (!response.ok) {
        const detail = await response.text();
        setGrokCheckStatus(`Invalid (${response.status})`, false);
        appendMessage('system', `Grok key check failed: ${detail}`);
        return;
      }
      setGrokCheckStatus('Valid', true);
    } catch (error) {
      setGrokCheckStatus('Failed', false);
      appendMessage(
        'system',
        `Grok key check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

void refreshWallet();
updateGrokStatus();

const setTab = (tabId) => {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === tabId;
    button.classList.toggle('active', isActive);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });
};

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setTab(button.dataset.tab ?? 'client');
  });
});

const buildNodeCard = (node, activeSet) => {
  const card = document.createElement('div');
  card.className = 'node-card';

  const title = document.createElement('h4');
  title.textContent = node.nodeId ?? 'node';
  card.appendChild(title);

  const statusRow = document.createElement('p');
  statusRow.textContent = activeSet.has(node.nodeId) ? 'Status: active' : 'Status: stale';
  statusRow.className = activeSet.has(node.nodeId) ? 'status-ok' : 'status-warn';
  card.appendChild(statusRow);

  const endpoint = document.createElement('p');
  endpoint.textContent = `Endpoint: ${node.endpoint ?? 'n/a'}`;
  card.appendChild(endpoint);

  const capacity = document.createElement('p');
  const currentLoad = node.capacity?.currentLoad ?? 0;
  const maxConcurrent = node.capacity?.maxConcurrent ?? 0;
  capacity.textContent = `Load: ${currentLoad} / ${maxConcurrent}`;
  card.appendChild(capacity);

  const capabilities = document.createElement('p');
  const caps = Array.isArray(node.capabilities)
    ? node.capabilities
        .map((cap) => `${cap.modelId ?? 'model'} (${cap.contextWindow ?? 'n/a'})`)
        .join(', ')
    : 'n/a';
  capabilities.textContent = `Models: ${caps}`;
  card.appendChild(capabilities);

  return card;
};

const updateRouterDashboard = async () => {
  if (!routerHealth || !routerActive || !routerTotal || !routerNodes) return;
  try {
    const response = await fetch('/api/router');
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = await response.json();
    const healthOk = payload?.health?.ok;
    const nodesPayload = payload?.nodes ?? {};
    const nodes = nodesPayload.nodes ?? [];
    const active = nodesPayload.active ?? [];
    const activeSet = new Set(active.map((node) => node.nodeId));

    routerHealth.textContent = healthOk ? 'Healthy' : 'Unhealthy';
    routerHealth.className = healthOk ? 'status-ok' : 'status-warn';
    routerActive.textContent = String(active.length);
    routerTotal.textContent = String(nodes.length);

    routerNodes.innerHTML = '';
    nodes.forEach((node) => {
      routerNodes.appendChild(buildNodeCard(node, activeSet));
    });

    if (nodeSummary && nodeList) {
      nodeSummary.textContent = `${active.length} active / ${nodes.length} total`;
      nodeList.innerHTML = '';
      nodes.forEach((node) => {
        nodeList.appendChild(buildNodeCard(node, activeSet));
      });
    }
  } catch (error) {
    routerHealth.textContent = 'Unavailable';
    routerHealth.className = 'status-warn';
    if (nodeSummary) {
      nodeSummary.textContent = 'Unavailable';
    }
  }
};

void updateRouterDashboard();
setInterval(updateRouterDashboard, 5000);

const updateConfigPanel = async () => {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = await response.json();
    const router = payload?.router ?? {};
    const federation = router?.federation ?? {};
    const nostr = federation?.nostr ?? {};
    const nodes = payload?.nodes ?? [];

    if (routerFederationEnabled) {
      routerFederationEnabled.textContent = federation?.enabled ? 'Enabled' : 'Disabled';
    }
    if (routerFederationRate) {
      const limit = federation?.rateLimitMax ?? 0;
      const windowMs = federation?.rateLimitWindowMs ?? 0;
      routerFederationRate.textContent = limit > 0 ? `${limit} / ${windowMs} ms` : 'Not set';
    }
    if (routerNostrEnabled) {
      routerNostrEnabled.textContent = nostr?.enabled ? 'Enabled' : 'Disabled';
    }
    if (routerNostrRelays) {
      routerNostrRelays.textContent = formatList(nostr?.relays);
    }
    if (routerNostrFollow) {
      routerNostrFollow.textContent = formatList(nostr?.follow);
    }
    if (routerNostrMute) {
      routerNostrMute.textContent = formatList(nostr?.mute);
    }
    if (routerNostrBlock) {
      routerNostrBlock.textContent = formatList(nostr?.block);
    }
    if (routerNostrRetry) {
      const min = nostr?.retryMinMs ?? 0;
      const max = nostr?.retryMaxMs ?? 0;
      routerNostrRetry.textContent = min && max ? `${min}–${max} ms` : 'Default';
    }
    if (routerPostgres) {
      routerPostgres.textContent = router?.postgres ? 'Enabled' : 'Disabled';
    }

    if (nodes.length > 0) {
      const node = nodes[0];
      if (nodeFollow) {
        nodeFollow.textContent = formatList(node?.routerFollow);
      }
      if (nodeMute) {
        nodeMute.textContent = formatList(node?.routerMute);
      }
      if (nodeBlock) {
        nodeBlock.textContent = formatList(node?.routerBlock);
      }
      if (nodePostgres) {
        nodePostgres.textContent = node?.postgresNonce ? 'Enabled' : 'Disabled';
      }
    }
  } catch {
    if (routerFederationEnabled) {
      routerFederationEnabled.textContent = 'Unavailable';
    }
    if (routerNostrEnabled) {
      routerNostrEnabled.textContent = 'Unavailable';
    }
    if (routerPostgres) {
      routerPostgres.textContent = 'Unavailable';
    }
  }
};

void updateConfigPanel();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  appendMessage('user', prompt);
  promptInput.value = '';
  if (statusEl) {
    statusEl.textContent = 'Thinking...';
  }

  try {
    if (selectedModel === 'llama3-8b-8192' && !grokApiKey) {
      openGrokModal();
      if (statusEl) {
        statusEl.textContent = 'Groq key required';
      }
      return;
    }
    const response = await fetch('/api/infer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        modelId: selectedModel,
        apiKey: selectedModel === 'llama3-8b-8192' ? grokApiKey : undefined,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      appendMessage('system', `Error: ${detail}`);
      if (statusEl) {
        statusEl.textContent = 'Error';
      }
      void refreshWallet();
      return;
    }
    const payload = await response.json();
    appendMessage('assistant', payload.output ?? '');
    if (statusEl) {
      statusEl.textContent = 'Ready';
    }
    void refreshWallet();
  } catch (error) {
    appendMessage('system', `Error: ${error instanceof Error ? error.message : String(error)}`);
    if (statusEl) {
      statusEl.textContent = 'Error';
    }
    void refreshWallet();
  }
});
