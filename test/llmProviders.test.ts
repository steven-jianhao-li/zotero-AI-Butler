import { expect } from "chai";
import { LLMClient } from "../src/modules/llmClient";
import { ProviderRegistry } from "../src/modules/llmproviders/ProviderRegistry";

// =============== 改进测试说明 ==================
// 目标：对所有已注册 Provider 执行：
// 1. testConnection
// 2. 文本模式：流式 + 非流式
// 3. Base64 PDF 模式：流式 + 非流式（若返回内容为空仍记录，不跳过）
// 输出结果：成功/失败/配置缺失/不支持/超时分类。
// =================================================

// 最小 1 页 PDF 的 Base64（内嵌 “Hello AI Butler” 文本）
const PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFsgMyAwIFIgXSAvQ291bnQgMSA+PgplbmRvYmoKMyAwIG9iago8PCAvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbMCAwIDIwMCAyMDAgXSAvQ29udGVudHMgNCAwIFIgL0RvUmVzb3VyY2VzIDUgMCBSID4+CmVuZG9iago0IDAgb2JqCjw8IC9MZW5ndGggNTUgPj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiA3MiAxMjAgVGQgKEhlbGxvIEFJIEJ1dGxlcikgVGogIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvUmVzb3VyY2VzIC9Gb250IDw8IC9GMSA2IDAgUiA+PiA+PgplbmRvYmoKNiAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgL05hbWUgL0YxID4+CmVuZG9iagp4cmVmCjAgNwowMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEgMDAwMDAgbiAKMDAwMDAwMDY2IDAwMDAwIG4gCjAwMDAwMDE1NSAwMDAwMCBuIAowMDAwMDAyNzAgMDAwMDAgbiAKMDAwMDAwMzYyIDAwMDAwIG4gCjAwMDAwMDQ2NSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgL0luZm8gNyAwIFIgL0lEIFsgPDY5NzRmZjYyMWI1ZTgxODJjYTVmZWFmMTE2ZmE0NmNkPiA8Njk3NGZmNjIxYjVlODE4MmNhNWZlYWYxMTZmYTQ2Y2Q+IF0gPj4Kc3RhcnR4cmVmCjUyMAolJUVPRgo=";

function getPrefSafe(key: string): string | boolean | undefined {
  try {
    // @ts-expect-error Zotero global available in test harness
    return Zotero?.Prefs?.get?.(`extensions.zotero.aiButler.${key}`);
  } catch {
    return undefined;
  }
}

function setPrefSafe(key: string, value: any) {
  try {
    Zotero?.Prefs?.set?.(`extensions.zotero.aiButler.${key}`, value, true);
  } catch (_e) {
    /* noop */
  }
}

type TestResult = {
  provider: string;
  mode: string;
  stream: boolean;
  base64: boolean;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  timeMs: number;
};

const allResults: TestResult[] = [];

async function runSummary(
  providerId: string,
  base64: boolean,
  stream: boolean,
): Promise<TestResult> {
  setPrefSafe("provider", providerId);
  setPrefSafe("stream", stream);
  const start = Date.now();
  try {
    const content = base64
      ? PDF_BASE64
      : "This is a tiny test text about AI Butler.";
    const chunks: string[] = [];
    const result = await LLMClient.generateSummary(
      content,
      base64,
      base64 ? "请阅读该PDF，尝试总结一句话。" : "请用一句话总结这段内容。",
      (delta) => {
        chunks.push(delta);
      },
    );
    const end = Date.now();
    const finalText = result || chunks.join("") || "";
    if (!finalText) {
      return {
        provider: providerId,
        mode: base64 ? "pdf" : "text",
        stream,
        base64,
        ok: false,
        reason: "返回内容为空",
        timeMs: end - start,
      };
    }
    return {
      provider: providerId,
      mode: base64 ? "pdf" : "text",
      stream,
      base64,
      ok: true,
      timeMs: end - start,
    };
  } catch (e: any) {
    const end = Date.now();
    const msg = e?.message || String(e);
    let reason = msg;
    if (/未配置|Missing|API Key/i.test(msg)) reason = "配置缺失: " + msg;
    else if (/Timeout|请求超过/i.test(msg)) reason = "超时: " + msg;
    else if (/不支持|unsupported/i.test(msg)) reason = "功能不支持: " + msg;
    return {
      provider: providerId,
      mode: base64 ? "pdf" : "text",
      stream,
      base64,
      ok: false,
      reason,
      timeMs: end - start,
    };
  }
}

async function runConnection(providerId: string): Promise<TestResult> {
  setPrefSafe("provider", providerId);
  const start = Date.now();
  try {
    const msg = await LLMClient.testConnection();
    const end = Date.now();
    return {
      provider: providerId,
      mode: "connect",
      stream: false,
      base64: false,
      ok: true,
      timeMs: end - start,
      reason: msg.slice(0, 80),
    };
  } catch (e: any) {
    const end = Date.now();
    const msg = e?.message || String(e);
    let reason = msg;
    if (/未配置|Missing|API Key/i.test(msg)) reason = "配置缺失: " + msg;
    else if (/Timeout|请求超过/i.test(msg)) reason = "超时: " + msg;
    return {
      provider: providerId,
      mode: "connect",
      stream: false,
      base64: false,
      ok: false,
      timeMs: end - start,
      reason,
    };
  }
}

const providers = ProviderRegistry.list();

describe("LLM Providers", function () {
  it("should have at least one provider registered", function () {
    expect(providers.length).to.be.greaterThan(0);
  });

  for (const pid of providers) {
    // 每个 Provider 独立测试
    describe(`Provider: ${pid}`, function () {
      // 连接测试
      it("connection", async function () {
        const r = await runConnection(pid);
        allResults.push(r);
        if (!r.ok) {
          // 连接失败不阻断后续摘要测试，继续

          console.warn(`[连接失败] ${pid}: ${r.reason}`);
        }
      }).timeout(25000);

      // 文本流式
      it("summary stream text", async function () {
        const r = await runSummary(pid, false, true);
        allResults.push(r);
        if (!r.ok) {
          console.warn(`[摘要失败 stream-text] ${pid}: ${r.reason}`);
        }
      }).timeout(30000);

      // 文本非流式
      it("summary non-stream text", async function () {
        const r = await runSummary(pid, false, false);
        allResults.push(r);
        if (!r.ok) {
          console.warn(`[摘要失败 nonstream-text] ${pid}: ${r.reason}`);
        }
      }).timeout(30000);

      // PDF 流式
      it("summary stream pdf(base64)", async function () {
        const r = await runSummary(pid, true, true);
        allResults.push(r);
        if (!r.ok) {
          console.warn(`[PDF失败 stream-pdf] ${pid}: ${r.reason}`);
        }
      }).timeout(35000);

      // PDF 非流式
      it("summary non-stream pdf(base64)", async function () {
        const r = await runSummary(pid, true, false);
        allResults.push(r);
        if (!r.ok) {
          console.warn(`[PDF失败 nonstream-pdf] ${pid}: ${r.reason}`);
        }
      }).timeout(35000);
    });
  }

  after(function () {
    // 汇总报告
    const lines: string[] = [];
    lines.push("\n================= LLM 测试报告 =================");
    for (const r of allResults) {
      const status = r.ok ? "✅ 成功" : "❌ 失败";
      lines.push(
        `${status} | ${r.provider} | ${r.mode || (r.base64 ? "pdf" : "text")} | ${r.stream ? "stream" : "non-stream"} | ${r.timeMs}ms${r.reason ? " | " + r.reason : ""}`,
      );
    }
    const okCount = allResults.filter((r) => r.ok).length;
    const failCount = allResults.length - okCount;
    lines.push(
      `总计: ${allResults.length}, 成功: ${okCount}, 失败: ${failCount}`,
    );

    console.log(lines.join("\n"));
  });
});
