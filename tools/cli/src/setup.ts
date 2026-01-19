import { writeFile } from 'node:fs/promises';
import { generateKeyPairHex } from './lib';
import { ask, askSecret, choose, closeInteractive } from './interactive';
import { fetchModels, KNOWN_LIMITS, PROVIDERS } from './providers';

export const runSetupInteractive = async () => {
  console.log('Welcome to fed_AI Interactive Setup');
  console.log('-----------------------------------');

  const role = await choose('What component do you want to set up?', ['Node', 'Router', 'Both']);
  const isNode = role === 'Node' || role === 'Both';
  const isRouter = role === 'Router' || role === 'Both';

  let routerEnv = '';
  let nodeEnv = '';
  let routerKeys = { npub: '', nsec: '' };
  let nodeKeys = { npub: '', nsec: '' };

  if (isRouter) {
    console.log('\n--- Router Configuration ---');
    const keys = generateKeyPairHex();
    routerKeys = keys;
    console.log(`Generated Router Identity: ${keys.npub}`);

    const endpoint = await ask('Router Public Endpoint', 'http://localhost:8080');
    const port = await ask('Router Port', '8080');
    const requirePayment = await choose('Require Payment?', ['true', 'false']);
    
    routerEnv = [
      `ROUTER_ID=router-${keys.npub.slice(0, 8)}`,
      `ROUTER_KEY_ID=${keys.npub}`,
      `ROUTER_PRIVATE_KEY_PEM=${keys.nsec}`,
      `ROUTER_ENDPOINT=${endpoint}`,
      `ROUTER_PORT=${port}`,
      `ROUTER_REQUIRE_PAYMENT=${requirePayment}`,
    ].join('\n');
  }

  if (isNode) {
    console.log('\n--- Node Configuration ---');
    const keys = generateKeyPairHex();
    nodeKeys = keys;
    console.log(`Generated Node Identity: ${keys.npub}`);

    const endpoint = await ask('Node Public Endpoint', 'http://localhost:8081');
    const port = await ask('Node Port', '8081');
    const routerUrl = await ask('Router Endpoint to Connect to', isRouter ? 'http://localhost:8080' : 'http://router.example.com');

    // Runner Configuration
    const runnerType = await choose('Select Runner Type', ['External Provider (Groq, OpenAI)', 'Local (Llama.cpp)', 'CPU (Mock/Test)']);
    
    let runnerConfig = '';
    
    if (runnerType === 'External Provider (Groq, OpenAI)') {
        const providerKey = await choose('Select Provider', Object.keys(PROVIDERS));
        const provider = PROVIDERS[providerKey];
        
        const apiKey = await askSecret(`Enter your ${provider.name} API Key`);
        
        let selectedModel = provider.defaultModel || 'gpt-4o-mini';
        try {
            console.log(`Fetching models from ${provider.name}...`);
            const models = await fetchModels(provider.baseUrl, apiKey);
            console.log(`Found ${models.length} models.`);
            
            if (models.length > 0) {
                 if (models.length < 20) {
                      selectedModel = await choose('Select Model', models);
                 } else {
                      console.log('Available models (partial):', models.slice(0, 10).join(', '), '...');
                      selectedModel = await ask('Enter Model ID', selectedModel);
                 }
            } else {
                console.warn('No models returned from API. Using default.');
            }

        } catch (e) {
            console.warn(`Could not fetch models: ${e instanceof Error ? e.message : String(e)}. Using default.`);
        }

        const limits = KNOWN_LIMITS[selectedModel] || { maxTokens: 4096 };
        console.log(`Using max_tokens (context window): ${limits.maxTokens}`);

        runnerConfig = [
            `NODE_RUNNER=openai`,
            `NODE_OPENAI_URL=${provider.baseUrl}`,
            `NODE_OPENAI_MODEL=${selectedModel}`,
            `NODE_OPENAI_API_KEY=${apiKey}`,
            `# Inferred capability limits`,
            `NODE_MAX_TOKENS=${limits.maxTokens}`,
            `NODE_MAX_PROMPT_BYTES=${limits.maxTokens * 4}`,
        ].join('\n');

    } else if (runnerType === 'Local (Llama.cpp)') {
        const llamaUrl = await ask('Llama.cpp URL', 'http://localhost:8085');
        const defaultLimit = '4096';
        const maxTokens = await ask('Model Context Window (Max Tokens)', defaultLimit);
        
        runnerConfig = [
            `NODE_RUNNER=llama_cpp`,
            `NODE_LLAMA_CPP_URL=${llamaUrl}`,
            `NODE_MAX_TOKENS=${maxTokens}`,
            `NODE_MAX_PROMPT_BYTES=${Number(maxTokens) * 4}`,
        ].join('\n');
    } else {
        runnerConfig = `NODE_RUNNER=cpu`;
    }

    nodeEnv = [
      `NODE_ID=node-${keys.npub.slice(0, 8)}`,
      `NODE_KEY_ID=${keys.npub}`,
      `NODE_PRIVATE_KEY_PEM=${keys.nsec}`,
      `NODE_ENDPOINT=${endpoint}`,
      `NODE_PORT=${port}`,
      `ROUTER_ENDPOINT=${routerUrl}`,
      runnerConfig
    ].join('\n');
    
    if (isRouter) {
        nodeEnv += `\nNODE_ROUTER_FOLLOW=${routerKeys.npub}`;
    }
  }

  // Write files
  if (isRouter) {
      await writeFile('.env.router', routerEnv);
      console.log('Wrote .env.router');
  }
  if (isNode) {
      await writeFile('.env.node', nodeEnv);
      console.log('Wrote .env.node');
  }
  
  closeInteractive();
};
