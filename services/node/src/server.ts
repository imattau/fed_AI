import type { Envelope, InferenceRequest, InferenceResponse } from '@fed-ai/protocol';
import type { NodeConfig } from './config';
import type { Runner } from './runners/types';

export type NodeService = {
  config: NodeConfig;
  runner: Runner;
};

export const createNodeService = (config: NodeConfig, runner: Runner): NodeService => {
  return { config, runner };
};

export const handleInference = async (
  service: NodeService,
  envelope: Envelope<InferenceRequest>,
): Promise<Envelope<InferenceResponse>> => {
  const response = await service.runner.infer(envelope.payload);
  return {
    payload: response,
    nonce: envelope.nonce,
    ts: Date.now(),
    keyId: service.config.keyId,
    sig: '',
  };
};
