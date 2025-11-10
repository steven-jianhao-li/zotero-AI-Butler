#!/usr/bin/env node
/* eslint-env node */
/* global console, process */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");

const args = process.argv.slice(2);
const rawName = args[0];
if (!rawName) {
  console.error("Usage: npm run scaffold:provider <VendorName> [vendor-id]");

  process.exit(1);
}
const className = /Provider$/i.test(rawName) ? rawName : `${rawName}Provider`;
const vendorId = (args[1] || rawName).toLowerCase();

const providersDir = path.join(root, "src", "modules", "llmproviders");
const filePath = path.join(providersDir, `${className}.ts`);
const testPath = path.join(root, "test", `${vendorId}.provider.test.ts`);

if (fs.existsSync(filePath)) {
  console.error(`Provider already exists: ${filePath}`);

  process.exit(1);
}

function appendEnvPlaceholders(vendorId) {
  const envPath = path.join(root, ".env");
  let existing = "";
  if (fs.existsSync(envPath)) existing = fs.readFileSync(envPath, "utf8");
  const upper = vendorId.toUpperCase();
  const marker = `# ${upper} (auto-added)`;
  if (existing.includes(marker)) {
    console.log("Env placeholders already exist for", upper);
    return;
  }
  const block = `\n${marker}\n${upper}_API_URL=\n${upper}_API_KEY=\n${upper}_MODEL=\n`;
  fs.writeFileSync(envPath, existing + block, "utf8");

  console.log("Appended .env placeholders for", upper);
}

const tmpl = `import { ProviderRegistry } from './ProviderRegistry';
import type { ILlmProvider } from './ILlmProvider';
import type { LLMOptions, ProgressCb, ConversationMessage } from './types';

export class ${className} implements ILlmProvider {
  readonly id = '${vendorId}';

  async generateSummary(
    content: string,
    isBase64: boolean,
    prompt: string | undefined,
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    // TODO: map options to vendor API, handle stream/non-stream
    // For now, just echo
    const text = isBase64 ? '[base64 content omitted]' : content.slice(0, 80);
    if (onProgress) onProgress(text);
    return text;
  }

  async chat(
    pdfContent: string,
    isBase64: boolean,
    conversation: ConversationMessage[],
    options: LLMOptions,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const text = (conversation[conversation.length - 1]?.content || '').slice(0, 80);
    if (onProgress) onProgress(text);
    return text;
  }

  async testConnection(options: LLMOptions): Promise<string> {
    // TODO: perform a tiny request; return human-readable result
    return 'OK (stub)';
  }
}

ProviderRegistry.register(new ${className}());
`;

const testTmpl = `import { expect } from 'chai';
import { ProviderRegistry } from '../src/modules/llmproviders/ProviderRegistry';

describe('${vendorId} provider scaffold', () => {
  it('should be registered', () => {
    const p = ProviderRegistry.get('${vendorId}');
    expect(p).to.exist;
  });
});
`;

fs.writeFileSync(filePath, tmpl, "utf8");
fs.writeFileSync(testPath, testTmpl, "utf8");
appendEnvPlaceholders(vendorId);

console.log("Created:");

console.log("  ", filePath);

console.log("  ", testPath);
