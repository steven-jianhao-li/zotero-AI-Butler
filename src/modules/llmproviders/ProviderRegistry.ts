import { ILlmProvider } from "./ILlmProvider";

export class ProviderRegistry {
  private static providers = new Map<string, ILlmProvider>();

  static register(provider: ILlmProvider) {
    this.providers.set(provider.id.toLowerCase(), provider);
  }

  static get(id: string): ILlmProvider | undefined {
    return this.providers.get(id.toLowerCase());
  }

  static list(): string[] {
    return Array.from(this.providers.keys());
  }
}
