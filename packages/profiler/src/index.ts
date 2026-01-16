import os from 'node:os';
import si from 'systeminformation';
import type { CapabilityBands, HardwareProfile, NetworkProfile, ProfileReport } from './types';

export type ProfileOptions = {
  latencyTargets?: string[];
};

const mapCpuBand = (cores: number, flags: string[]): CapabilityBands['cpu'] => {
  if (cores >= 16 && flags.includes('avx2')) {
    return 'cpu_high';
  }
  if (cores >= 8) {
    return 'cpu_mid';
  }
  return 'cpu_low';
};

const mapRamBand = (totalBytes: number): CapabilityBands['ram'] => {
  const gb = totalBytes / (1024 ** 3);
  if (gb >= 64) return 'ram_64_plus';
  if (gb >= 32) return 'ram_32';
  if (gb >= 16) return 'ram_16';
  return 'ram_8';
};

const mapDiskBand = (type: HardwareProfile['disk']['type']): CapabilityBands['disk'] => {
  if (type === 'ssd') return 'disk_ssd';
  if (type === 'hdd') return 'disk_hdd';
  return 'disk_unknown';
};

const mapGpuBand = (vramMb: number | null): CapabilityBands['gpu'] => {
  if (!vramMb || vramMb < 1024) return 'gpu_none';
  if (vramMb < 12_000) return 'gpu_8gb';
  if (vramMb < 20_000) return 'gpu_16gb';
  return 'gpu_24gb_plus';
};

const mapNetBand = (latencyMs: number | null): CapabilityBands['net'] => {
  if (latencyMs === null) return 'net_ok';
  if (latencyMs < 40) return 'net_good';
  if (latencyMs < 100) return 'net_ok';
  return 'net_poor';
};

const detectContainerRuntime = (): string | undefined => {
  if (process.env.CONTAINER_RUNTIME) {
    return process.env.CONTAINER_RUNTIME;
  }
  if (process.env.DOCKER_CONTAINER) {
    return 'docker';
  }
  return undefined;
};

export const profileSystem = async (options: ProfileOptions = {}): Promise<ProfileReport> => {
  const [cpu, mem, disks, fsSizes, graphics, osInfo, netIfaces] = await Promise.all([
    si.cpu(),
    si.mem(),
    si.diskLayout(),
    si.fsSize(),
    si.graphics(),
    si.osInfo(),
    si.networkInterfaces(),
  ]);

  const disk = disks.find((entry) => entry.size > 0) ?? disks[0];
  const diskType: HardwareProfile['disk']['type'] = disk?.type
    ? disk.type.toLowerCase().includes('ssd')
      ? 'ssd'
      : 'hdd'
    : 'unknown';
  const fsRoot = fsSizes[0];

  const gpuController = graphics.controllers[0];
  const gpuVendor = gpuController?.vendor ?? null;
  const gpuVramMb = gpuController?.vram ?? null;

  const iface = netIfaces.find((entry) => !entry.internal && entry.operstate === 'up');
  const latencyTargets = options.latencyTargets ?? [];
  let latencyMs: number | null = null;
  let jitterMs: number | null = null;

  if (latencyTargets.length > 0) {
    const samples: number[] = [];
    for (const target of latencyTargets.slice(0, 3)) {
      const value = await si.inetLatency(target);
      if (Number.isFinite(value)) {
        samples.push(value);
      }
    }
    if (samples.length > 0) {
      latencyMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      const mean = latencyMs;
      jitterMs = Math.sqrt(
        samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length,
      );
    }
  }

  const hardware: HardwareProfile = {
    cpu: {
      arch: os.arch(),
      cores: cpu.physicalCores ?? cpu.cores,
      threads: cpu.cores,
      frequencyGHz: cpu.speed ? Number(cpu.speed) : null,
      flags: cpu.flags?.split(' ') ?? [],
    },
    memory: {
      totalBytes: mem.total,
      availableBytes: mem.available,
    },
    disk: {
      type: diskType,
      freeBytes: fsRoot?.available ?? 0,
    },
    gpu: {
      vendor: gpuVendor,
      vramMb: gpuVramMb,
      runtime: {
        cuda: Boolean(process.env.CUDA_VISIBLE_DEVICES),
        rocm: Boolean(process.env.ROCM_VISIBLE_DEVICES),
      },
    },
    os: {
      distro: osInfo.distro || osInfo.platform,
      kernel: osInfo.kernel,
      containerRuntime: detectContainerRuntime(),
    },
  };

  const network: NetworkProfile = {
    interface: iface?.iface ?? null,
    uploadMbps: null,
    downloadMbps: null,
    latencyMs,
    jitterMs,
  };

  const capabilityBands: CapabilityBands = {
    cpu: mapCpuBand(hardware.cpu.cores, hardware.cpu.flags),
    ram: mapRamBand(hardware.memory.totalBytes),
    disk: mapDiskBand(hardware.disk.type),
    net: mapNetBand(network.latencyMs),
    gpu: mapGpuBand(hardware.gpu.vramMb),
  };

  return { hardware, network, capabilityBands };
};

export type { HardwareProfile, NetworkProfile, BenchmarkProfile, CapabilityBands, ProfileReport } from './types';
