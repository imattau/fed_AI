const chat = document.getElementById('chat');
const form = document.getElementById('chat-form');
const promptInput = document.getElementById('prompt');
const status = document.getElementById('status');
const wallet = document.getElementById('wallet-sats');
const routerHealth = document.getElementById('router-health');
const routerActive = document.getElementById('router-active');
const routerTotal = document.getElementById('router-total');
const routerNodes = document.getElementById('router-nodes');
const routerFederationEnabled = document.getElementById('router-federation-enabled');
const routerFederationRate = document.getElementById('router-federation-rate');
const routerNostrEnabled = document.getElementById('router-nostr-enabled');
const routerNostrRelays = document.getElementById('router-nostr-relays');
const routerNostrFollow = document.getElementById('router-nostr-follow');
const routerNostrMute = document.getElementById('router-nostr-mute');
const routerNostrBlock = document.getElementById('router-nostr-block');
const routerNostrRetry = document.getElementById('router-nostr-retry');
const routerPostgres = document.getElementById('router-postgres');
const nodeSummary = document.getElementById('node-summary');
const nodeList = document.getElementById('node-list');
const nodeFollow = document.getElementById('node-follow');
const nodeMute = document.getElementById('node-mute');
const nodeBlock = document.getElementById('node-block');
const nodePostgres = document.getElementById('node-postgres');
const modelSelect = document.getElementById('model-select');
const grokModal = document.getElementById('grok-modal');
const grokApiKeyInput = document.getElementById('grok-api-key');
const grokCancel = document.getElementById('grok-cancel');
const grokSave = document.getElementById('grok-save');
const grokKeyStatus = document.getElementById('grok-key-status');
const tabButtons = document.querySelectorAll('[data-tab]');
const tabPanels = document.querySelectorAll('.tab-panel');

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
    grokKeyStatus.textContent = 'Grok key: set';
    grokKeyStatus.classList.add('ok');
  } else {
    grokKeyStatus.textContent = 'Grok key: not set';
    grokKeyStatus.classList.remove('ok');
  }
};

const openGrokModal = () => {
  if (!grokModal) return;
  grokModal.classList.remove('hidden');
  if (grokApiKeyInput) {
    grokApiKeyInput.value = grokApiKey;
    grokApiKeyInput.focus();
  }
};

const closeGrokModal = () => {
  if (!grokModal) return;
  grokModal.classList.add('hidden');
};

if (modelSelect) {
  modelSelect.addEventListener('change', () => {
    const value = modelSelect.value;
    if (value === 'openai/gpt-oss-120b') {
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
    closeGrokModal();
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
  status.textContent = 'Thinking...';

  try {
    if (selectedModel === 'openai/gpt-oss-120b' && !grokApiKey) {
      openGrokModal();
      status.textContent = 'Grok key required';
      return;
    }
    const response = await fetch('/api/infer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        modelId: selectedModel,
        apiKey: selectedModel === 'openai/gpt-oss-120b' ? grokApiKey : undefined,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      appendMessage('system', `Error: ${detail}`);
      status.textContent = 'Error';
      void refreshWallet();
      return;
    }
    const payload = await response.json();
    appendMessage('assistant', payload.output ?? '');
    status.textContent = 'Ready';
    void refreshWallet();
  } catch (error) {
    appendMessage('system', `Error: ${error instanceof Error ? error.message : String(error)}`);
    status.textContent = 'Error';
    void refreshWallet();
  }
});
