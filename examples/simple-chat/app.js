const chat = document.getElementById('chat');
const form = document.getElementById('chat-form');
const promptInput = document.getElementById('prompt');
const status = document.getElementById('status');
const wallet = document.getElementById('wallet-sats');
const routerHealth = document.getElementById('router-health');
const routerActive = document.getElementById('router-active');
const routerTotal = document.getElementById('router-total');
const routerNodes = document.getElementById('router-nodes');
const nodeSummary = document.getElementById('node-summary');
const nodeList = document.getElementById('node-list');
const tabButtons = document.querySelectorAll('[data-tab]');
const tabPanels = document.querySelectorAll('.tab-panel');

const appendMessage = (role, text) => {
  const row = document.createElement('div');
  row.className = `message ${role}`;
  row.textContent = text;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
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

void refreshWallet();

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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  appendMessage('user', prompt);
  promptInput.value = '';
  status.textContent = 'Thinking...';

  try {
    const response = await fetch('/api/infer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
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
