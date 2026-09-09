import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import { AgentNameEnum, DEFAULT_FLASH_MODEL, DEFAULT_FLASH_PROVIDER_ID, llmProviderParameters } from './types';

// Interface for a single model configuration
export interface ModelConfig {
  // providerId, the key of the provider in the llmProviderStore, not the provider name
  provider: string;
  modelName: string;
  parameters?: Record<string, unknown>;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'; // For o-series models (OpenAI and Azure)
}

// Interface for storing multiple agent model configurations
export interface AgentModelRecord {
  agents: Record<AgentNameEnum, ModelConfig>;
}

export type AgentModelStorage = BaseStorage<AgentModelRecord> & {
  setAgentModel: (agent: AgentNameEnum, config: ModelConfig) => Promise<void>;
  getAgentModel: (agent: AgentNameEnum) => Promise<ModelConfig | undefined>;
  resetAgentModel: (agent: AgentNameEnum) => Promise<void>;
  hasAgentModel: (agent: AgentNameEnum) => Promise<boolean>;
  getConfiguredAgents: () => Promise<AgentNameEnum[]>;
  getAllAgentModels: () => Promise<Record<AgentNameEnum, ModelConfig>>;
  cleanupLegacyValidatorSettings: () => Promise<void>;
};

const storage = createStorage<AgentModelRecord>(
  'agent-models',
  {
    agents: {
      [AgentNameEnum.Planner]: {
        provider: DEFAULT_FLASH_PROVIDER_ID,
        modelName: DEFAULT_FLASH_MODEL,
        reasoningEffort: 'low',
      },
      [AgentNameEnum.Navigator]: {
        provider: DEFAULT_FLASH_PROVIDER_ID,
        modelName: DEFAULT_FLASH_MODEL,
        reasoningEffort: 'low',
      },
    },
  },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

function validateModelConfig(config: ModelConfig) {
  if (!config.provider || !config.modelName) {
    throw new Error('Provider and model name must be specified');
  }
}
function getModelParameters(agent: AgentNameEnum, provider: string): Record<string, unknown> {
  const providerParams = llmProviderParameters[provider as keyof typeof llmProviderParameters]?.[agent];
  return providerParams ?? { temperature: 0.1, topP: 0.1 };
}

export function normalizeModelConfig(config: ModelConfig): ModelConfig {
  // Legacy stubborn profile settings persist the knob as `parameters.reasoning_Effort` —
  // while `createOpenAIChatModel` only reads the top-level `reasoningEffort`. Promote the observed shape
  // to the field that is read, so that old profiles operate completely. A valid top-level value always
  // wins; regardless, the stale knob never flows into the provider parameters again.
  const { reasoning_Effort, reasoning_effort, ...restParams } = config.parameters ?? {};
  const legacy = reasoning_Effort ?? reasoning_effort;
  if (legacy !== undefined) {
    if (config.reasoningEffort !== undefined) {
      return { ...config, parameters: restParams };
    }
    const effort = (['minimal', 'low', 'medium', 'high'] as const).find(v => v === String(legacy));
    return effort !== undefined
      ? { ...config, reasoningEffort: effort, parameters: restParams }
      : { ...config, parameters: restParams };
  }
  return config;
}

export const agentModelStore: AgentModelStorage = {
  ...storage,
  setAgentModel: async (agent: AgentNameEnum, config: ModelConfig) => {
    validateModelConfig(config);
    // Merge default parameters with provided parameters
    const defaultParams = getModelParameters(agent, config.provider);
    const mergedConfig = {
      ...config,
      parameters: {
        ...defaultParams,
        ...config.parameters,
      },
    };
    await storage.set(current => ({
      agents: {
        ...current.agents,
        [agent]: mergedConfig,
      },
    }));
  },
  getAgentModel: async (agent: AgentNameEnum) => {
    const data = await storage.get();
    const config = data.agents[agent];
    if (!config) return undefined;

    // Merge default parameters with stored parameters
    const defaultParams = getModelParameters(agent, config.provider);
    return normalizeModelConfig({
      ...config,
      parameters: {
        ...defaultParams,
        ...config.parameters,
      },
    });
  },
  resetAgentModel: async (agent: AgentNameEnum) => {
    await storage.set(current => {
      const newAgents = { ...current.agents };
      delete newAgents[agent];
      return { agents: newAgents };
    });
  },
  hasAgentModel: async (agent: AgentNameEnum) => {
    const data = await storage.get();
    return agent in data.agents;
  },
  getConfiguredAgents: async () => {
    const data = await storage.get();
    // Filter out any legacy validator entries for backward compatibility
    return Object.keys(data.agents).filter(
      agentKey => agentKey !== 'validator' && Object.values(AgentNameEnum).includes(agentKey as AgentNameEnum),
    ) as AgentNameEnum[];
  },
  getAllAgentModels: async () => {
    const data = await storage.get();
    // Filter out any legacy validator entries for backward compatibility
    const filteredAgents: Partial<Record<AgentNameEnum, ModelConfig>> = {};
    for (const [agentKey, config] of Object.entries(data.agents)) {
      if (agentKey !== 'validator' && Object.values(AgentNameEnum).includes(agentKey as AgentNameEnum)) {
        filteredAgents[agentKey as AgentNameEnum] = normalizeModelConfig(config);
      }
    }
    return filteredAgents as Record<AgentNameEnum, ModelConfig>;
  },
  cleanupLegacyValidatorSettings: async () => {
    await storage.set(current => {
      const newAgents = { ...current.agents };
      delete newAgents['validator' as keyof typeof newAgents];
      return { agents: newAgents };
    });
  },
};
