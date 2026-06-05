import type {
  LLMEndpointPdfProcessMode,
  LLMEndpointProviderType,
} from "../llmEndpointManager";
import type { LLMReasoningEffortSetting } from "../llmproviders/types";

export interface SetupPresetGuideStep {
  title: string;
  detail: string;
  url?: string;
}

export interface SetupPresetEndpointConfig {
  id: string;
  name: string;
  providerType: LLMEndpointProviderType;
  apiUrl: string;
  model: string;
  reasoningEffort?: LLMReasoningEffortSetting;
  pdfProcessMode?: LLMEndpointPdfProcessMode;
}

export interface SetupPresetValues {
  apiKey: string;
  model: string;
}

export interface SetupPresetChange {
  label: string;
  before: string;
  after: string;
}

export interface SetupPreset {
  id: string;
  name: string;
  title: string;
  description: string;
  guideTitle: string;
  guideSubtitle: string;
  apiKeyPlaceholder: string;
  successMessage: string;
  endpoint: SetupPresetEndpointConfig;
  guideSteps: SetupPresetGuideStep[];
  getChanges(values: SetupPresetValues): SetupPresetChange[];
  apply(values: SetupPresetValues): void;
}
