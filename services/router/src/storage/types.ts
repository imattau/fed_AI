import type { Envelope, NodeDescriptor, PaymentReceipt, PaymentRequest } from '@fed-ai/protocol';
import type { NodeManifest } from '@fed-ai/manifest';

export type RouterStoreSnapshot = {
  nodes: NodeDescriptor[];
  paymentRequests: Array<{ key: string; request: PaymentRequest }>;
  paymentReceipts: Array<{ key: string; receipt: Envelope<PaymentReceipt> }>;
  manifests: NodeManifest[];
  manifestAdmissions: Array<{ nodeId: string; eligible: boolean; reason?: string }>;
};

export type RouterStore = {
  load(): Promise<RouterStoreSnapshot>;
  saveNode(node: NodeDescriptor): Promise<void>;
  savePaymentRequest(key: string, request: PaymentRequest): Promise<void>;
  savePaymentReceipt(key: string, receipt: Envelope<PaymentReceipt>): Promise<void>;
  saveManifest(manifest: NodeManifest): Promise<void>;
  saveManifestAdmission(
    nodeId: string,
    admission: { eligible: boolean; reason?: string },
  ): Promise<void>;
};
