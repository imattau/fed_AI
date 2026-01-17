const chat = document.getElementById('chat');
const form = document.getElementById('chat-form');
const promptInput = document.getElementById('prompt');
const status = document.getElementById('status');

const appendMessage = (role, text) => {
  const row = document.createElement('div');
  row.className = `message ${role}`;
  row.textContent = text;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
};

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
      return;
    }
    const payload = await response.json();
    appendMessage('assistant', payload.output ?? '');
    status.textContent = 'Ready';
  } catch (error) {
    appendMessage('system', `Error: ${error instanceof Error ? error.message : String(error)}`);
    status.textContent = 'Error';
  }
});
