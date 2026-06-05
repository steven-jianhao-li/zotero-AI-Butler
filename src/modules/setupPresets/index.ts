import { deepSeekPreset } from "./deepseek";
import type { SetupPreset } from "./types";

export const setupPresets: SetupPreset[] = [deepSeekPreset];

export function getSetupPreset(id: string): SetupPreset | undefined {
  return setupPresets.find((preset) => preset.id === id);
}

export type {
  SetupPreset,
  SetupPresetChange,
  SetupPresetGuideStep,
  SetupPresetValues,
} from "./types";
