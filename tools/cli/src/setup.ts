import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPairHex } from './lib';
import { ask, askSecret, choose, closeInteractive } from './interactive';
import { fetchModels, KNOWN_LIMITS, PROVIDERS, resolveModelLimit } from './providers';
import { detectHardware } from './hardware';
import { searchGGUF, recommendQuantization, downloadFile } from './huggingface';

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
    
    let lnConfig = '';
    if (requirePayment === 'true') {
        const lnInvoice = await ask('Lightning Invoice URL', 'http://localhost:4000/invoice');
        const lnVerify = await ask('Lightning Verify URL', 'http://localhost:4000/verify');
        lnConfig = `ROUTER_LN_INVOICE_URL=${lnInvoice}\nROUTER_LN_VERIFY_URL=${lnVerify}`;
    }

    const nonceType = await choose('Nonce Store (Replay Protection)', ['File (Simple)', 'Postgres (Scalable)', 'Memory (Dev only - risky)']);
    let nonceConfig = '';
    if (nonceType === 'File (Simple)') {
        const noncePath = await ask('Nonce Store Path', './router-nonce.json');
        nonceConfig = `ROUTER_NONCE_STORE_PATH=${noncePath}`;
    } else if (nonceType === 'Postgres (Scalable)') {
        const nonceUrl = await ask('Postgres URL', 'postgresql://user:pass@localhost:5432/router_nonce');
        nonceConfig = `ROUTER_NONCE_STORE_URL=${nonceUrl}`;
    } else {
        nonceConfig = `# ROUTER_NONCE_STORE_PATH not set (using memory)`;
    }

    routerEnv = [
      `ROUTER_ID=router-${keys.npub.slice(0, 8)}`,
      `ROUTER_KEY_ID=${keys.npub}`,
      `ROUTER_PRIVATE_KEY_PEM=${keys.nsec}`,
      `ROUTER_ENDPOINT=${endpoint}`,
      `ROUTER_PORT=${port}`,
      `ROUTER_REQUIRE_PAYMENT=${requirePayment}`,
      lnConfig,
      nonceConfig,
    ].filter(Boolean).join('\n');
  }

  if (isNode) {
    console.log('\n--- Node Configuration ---');
    const keys = generateKeyPairHex();
    nodeKeys = keys;
    console.log(`Generated Node Identity: ${keys.npub}`);

    const endpoint = await ask('Node Public Endpoint', 'http://localhost:8081');
    const port = await ask('Node Port', '8081');
    const routerUrl = await ask('Router Endpoint to Connect to', isRouter ? 'http://localhost:8080' : 'http://router.example.com');
    
    const requirePayment = await choose('Require Payment?', ['true', 'false']);
    let lnConfig = '';
    if (requirePayment === 'true') {
        const lnVerify = await ask('Lightning Verify URL', 'http://localhost:4000/verify');
        lnConfig = `NODE_LN_VERIFY_URL=${lnVerify}`;
    }

    const nonceType = await choose('Nonce Store (Replay Protection)', ['File (Simple)', 'Postgres (Scalable)', 'Memory (Dev only - risky)']);
    let nonceConfig = '';
    if (nonceType === 'File (Simple)') {
        const noncePath = await ask('Nonce Store Path', './node-nonce.json');
        nonceConfig = `NODE_NONCE_STORE_PATH=${noncePath}`;
    } else if (nonceType === 'Postgres (Scalable)') {
        const nonceUrl = await ask('Postgres URL', 'postgresql://user:pass@localhost:5432/node_nonce');
        nonceConfig = `NODE_NONCE_STORE_URL=${nonceUrl}`;
    } else {
        nonceConfig = `# NODE_NONCE_STORE_PATH not set (using memory)`;
    }

    // Runner Configuration
    const runnerType = await choose('Select Runner Type', [
        'External Provider (Groq, OpenAI)',
        'Local (Llama.cpp)',
        'Download Model (Hugging Face)',
        'CPU (Mock/Test)'
    ]);
    
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

    } else if (runnerType === 'Download Model (Hugging Face)') {
        console.log('\n--- Hardware Detection ---');
        const specs = await detectHardware();
        console.log(`CPU: ${specs.cpu.model} (${specs.cpu.cores} cores)`);
        console.log(`RAM: ${specs.ram.totalGb} GB`);
        if (specs.gpu) {
            console.log(`GPU: ${specs.gpu.model} (${specs.gpu.vramGb} GB VRAM) [${specs.gpu.type}]`);
        } else {
            console.log('GPU: None detected (using CPU inference)');
        }

        const repoId = await ask('Hugging Face Repository ID', 'Bartowski/Meta-Llama-3.1-8B-Instruct-GGUF');
        
        console.log(`Fetching file list for ${repoId}...`);
        try {
            const files = await searchGGUF(repoId);
            if (files.length === 0) {
                console.log('No .gguf files found in this repository.');
                return;
            }

            const recommended = recommendQuantization(files, specs.gpu?.vramGb || 0, specs.ram.totalGb);
            console.log(`\nRecommended Quantization: ${recommended ? recommended.path : 'None (Manual selection needed)'}`);

            let selectedFile = recommended;
            const selection = await choose('Which file to download?', [
                ...(recommended ? [`Recommended: ${recommended.path} (${(recommended.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB)`] : []),
                'Choose from full list',
                'Skip download (configure only)'
            ]);

            if (selection === 'Choose from full list') {
                const choices = files.map(f => `${f.path} (${(f.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB)`);
                const choice = await choose('Select File', choices);
                selectedFile = files.find(f => choice.startsWith(f.path))!;
            } else if (selection.startsWith('Skip')) {
                selectedFile = null;
            }

            let modelPath = '';
            if (selectedFile) {
                const downloadDir = await ask('Download Directory', './models');
                await mkdir(downloadDir, { recursive: true });
                modelPath = path.join(downloadDir, selectedFile.path);
                
                await downloadFile(selectedFile.downloadUrl, modelPath, selectedFile.sizeBytes);
            }

            // Configure Node
            const defaultLimit = resolveModelLimit(repoId, 8192); // Fuzzy match max tokens
            const maxTokens = await ask('Model Context Window (Max Tokens)', defaultLimit.toString());
            const llamaUrl = await ask('Llama.cpp Server URL', 'http://localhost:8080');

            runnerConfig = [
                `NODE_RUNNER=llama_cpp`,
                `NODE_LLAMA_CPP_URL=${llamaUrl}`,
                `NODE_MAX_TOKENS=${maxTokens}`,
                `NODE_MAX_PROMPT_BYTES=${Number(maxTokens) * 4}`,
            ].join('\n');

            console.log('\n--- IMPORTANT ---');
            console.log(`You must start the llama.cpp server manually.`);
            if (modelPath) {
                console.log(`Command: ./llama-server -m ${modelPath} --host 0.0.0.0 --port 8080 -c ${maxTokens} --n-gpu-layers 99`);
            } else {
                console.log(`Command: ./llama-server -m <path-to-model> --host 0.0.0.0 --port 8080 -c ${maxTokens}`);
            }
            console.log('-----------------\n');

        } catch (e) {
            console.error('Error during HF setup:', e);
            runnerConfig = `NODE_RUNNER=cpu # Fallback due to error`;
        }

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
      `NODE_REQUIRE_PAYMENT=${requirePayment}`,
      lnConfig,
      nonceConfig,
      runnerConfig
    ].filter(Boolean).join('\n');
    
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
      console.log('Note: If you have updated the configuration of a running node, please restart it to apply changes and update advertised capabilities.');
  }
  
  closeInteractive();
};
