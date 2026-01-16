export type HardwareProfile = {
  cpu: {
    arch: string;
    cores: number;
    threads: number;
    frequencyGHz: number | null;
    flags: string[];
  };
  memory: {
    totalBytes: number;
    availableBytes: number;
  };
  disk: {
    type: 'ssd' | 'hdd' | 'unknown';
    freeBytes: number;
  };
  gpu: {
    vendor: string | null;
    vramMb: number | null;
    runtime: {
      cuda: boolean;
      rocm: boolean;
    };
  };
  os: {
    distro: string;
    kernel: string;
    containerRuntime?: string;
  };
};

export type NetworkProfile = {
  interface: string | null;
  uploadMbps: number | null;
  downloadMbps: number | null;
  latencyMs: number | null;
  jitterMs: number | null;
};

export type BenchmarkProfile = {
  cpuScore: number;
  memoryMBps: number;
  diskMBps: number;
  networkLatencyMs?: number;
  timestampMs: number;
};

export type CapabilityBands = {
  cpu: 'cpu_low' | 'cpu_mid' | 'cpu_high';
  ram: 'ram_8' | 'ram_16' | 'ram_32' | 'ram_64_plus';
  disk: 'disk_hdd' | 'disk_ssd' | 'disk_unknown';
  net: 'net_poor' | 'net_ok' | 'net_good';
  gpu: 'gpu_none' | 'gpu_8gb' | 'gpu_16gb' | 'gpu_24gb_plus';
};

export type ProfileReport = {
  hardware: HardwareProfile;
  network: NetworkProfile;
  capabilityBands: CapabilityBands;
};
