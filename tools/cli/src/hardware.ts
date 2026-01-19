import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export type HardwareSpecs = {
  cpu: {
    model: string;
    cores: number;
  };
  ram: {
    totalBytes: number;
    totalGb: number;
  };
  gpu?: {
    model: string;
    vramGb: number;
    type: 'nvidia' | 'amd' | 'apple_silicon' | 'unknown';
  };
};

export const detectHardware = async (): Promise<HardwareSpecs> => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  
  const specs: HardwareSpecs = {
    cpu: {
      model: cpus[0]?.model || 'Unknown',
      cores: cpus.length,
    },
    ram: {
      totalBytes: totalMem,
      totalGb: Math.round(totalMem / 1024 / 1024 / 1024),
    },
  };

  // GPU Detection
  // 1. Apple Silicon
  if (process.platform === 'darwin' && cpus[0]?.model.includes('Apple')) {
    // Apple Silicon Unified Memory
    specs.gpu = {
      model: cpus[0].model,
      vramGb: specs.ram.totalGb, // Unified memory
      type: 'apple_silicon',
    };
    return specs;
  }

  // 2. NVIDIA (via nvidia-smi)
  try {
    const { stdout } = await execAsync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits');
    const [name, memory] = stdout.trim().split(', ');
    if (name && memory) {
      specs.gpu = {
        model: name,
        vramGb: Math.round(parseInt(memory) / 1024),
        type: 'nvidia',
      };
      return specs;
    }
  } catch (e) {
    // Ignore error, assume no NVIDIA
  }

  // 3. AMD (Linux only, basic check)
  if (process.platform === 'linux') {
    try {
      const { stdout } = await execAsync('lspci | grep -i vga');
      if (stdout.toLowerCase().includes('amd') || stdout.toLowerCase().includes('ati')) {
         specs.gpu = {
            model: 'AMD GPU (Details unknown)',
            vramGb: 0, // Hard to get reliably without rocm-smi
            type: 'amd',
         };
      }
    } catch (e) {
      // Ignore
    }
  }

  return specs;
};
