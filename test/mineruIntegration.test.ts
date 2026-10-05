import { expect } from "chai";
import JSZip from "jszip";
import { MineruClient } from "../src/modules/mineruIntegration";
import { getMineruServiceConfig } from "../src/modules/mineruConfig";
import { PDFExtractor } from "../src/modules/pdfExtractor";
import {
  MineruMarkdownSaver,
  type MineruMarkdownAsset,
} from "../src/modules/mineruMarkdownSaver";

describe("MinerU service selection and extraction", function () {
  const globals = globalThis as unknown as Record<string, unknown>;
  const markdown = "# OCR evidence\n![Figure](images/figure.png)";
  const pdfBytes = new Uint8Array([37, 80, 68, 70]);
  const imageBytes = new Uint8Array([137, 80, 78, 71]);
  let previous: Record<string, unknown>;
  let values: Record<string, unknown>;
  let requests: Array<{ url: string; options: RequestInit }>;
  let archive: Uint8Array;
  let paper: Zotero.Item;
  let getPdfs: typeof PDFExtractor.getAllPdfAttachments;
  let readCache: typeof MineruMarkdownSaver.readCachedMarkdown;
  let enabled: typeof MineruMarkdownSaver.isSaveEnabled;
  let save: typeof MineruMarkdownSaver.save;
  let saveCount: number;
  let savedAssets: MineruMarkdownAsset[];

  beforeEach(async function () {
    previous = Object.fromEntries(
      [
        "Zotero",
        "IOUtils",
        "addon",
        "fetch",
        "ztoolkit",
        "setImmediate",
        "setTimeout",
        "FormData",
        "Blob",
      ].map((key) => [key, globals[key]]),
    );
    globals.setImmediate = (callback: () => void) => setTimeout(callback, 0);
    values = {
      mineruServiceMode: "custom",
      mineruCustomApiUrl: "http://127.0.0.1:8000/proxy/",
      mineruCustomApiFormat: "file-parse",
      mineruApiKey: "fixture-official-key",
    };
    requests = [];
    saveCount = 0;
    savedAssets = [];
    const pdf = {
      id: 2,
      dateAdded: "2026-01-01T00:00:00Z",
      attachmentContentType: "application/pdf",
      getField: () => "Fixture PDF",
      getFilePathAsync: async () => "/fixture/paper.pdf",
    } as unknown as Zotero.Item;
    paper = { id: 1, getAttachments: () => [2] } as Zotero.Item;
    globals.Zotero = {
      Prefs: {
        get: (key: string) => values[key.slice(key.lastIndexOf(".") + 1)],
      },
      Items: { getAsync: async () => pdf },
    };
    globals.addon = { data: {} };
    globals.ztoolkit = { log: () => {} };
    globals.IOUtils = { read: async () => pdfBytes };
    getPdfs = PDFExtractor.getAllPdfAttachments;
    readCache = MineruMarkdownSaver.readCachedMarkdown;
    enabled = MineruMarkdownSaver.isSaveEnabled;
    save = MineruMarkdownSaver.save;
    PDFExtractor.getAllPdfAttachments = async () => [pdf];
    MineruMarkdownSaver.readCachedMarkdown = async () => null;
    MineruMarkdownSaver.isSaveEnabled = () => true;
    MineruMarkdownSaver.save = async (_item, _markdown, assets) => {
      saveCount++;
      savedAssets = assets || [];
      return {};
    };
    const zip = new JSZip();
    zip.file("document/auto/document.md", markdown);
    zip.file("document/auto/images/figure.png", imageBytes);
    archive = await zip.generateAsync({ type: "uint8array" });
    mockFetch(() => {
      throw new Error("Unexpected network request");
    });
  });

  afterEach(function () {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globals[key];
      else globals[key] = value;
    }
    PDFExtractor.getAllPdfAttachments = getPdfs;
    MineruMarkdownSaver.readCachedMarkdown = readCache;
    MineruMarkdownSaver.isSaveEnabled = enabled;
    MineruMarkdownSaver.save = save;
  });

  function mockFetch(
    handler: (
      url: string,
      options: RequestInit,
    ) => Response | Promise<Response>,
  ) {
    globals.fetch = async (url: string, options: RequestInit = {}) => {
      requests.push({ url, options });
      expect(options.signal).to.be.instanceOf(AbortSignal);
      return await handler(url, options);
    };
  }

  function json(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  }

  function zipResponse(): Response {
    return new Response(new Uint8Array(archive), {
      headers: { "Content-Type": "application/zip" },
    });
  }

  async function rejects(promise: Promise<unknown>, message: string) {
    let error: unknown;
    try {
      await promise;
    } catch (caught) {
      error = caught;
    }
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.contain(message);
    return error as Error;
  }

  it("keeps the official service as the default and requires its key", function () {
    delete values.mineruServiceMode;
    values.mineruCustomApiKey = "fixture-custom-key";
    expect(getMineruServiceConfig()).to.deep.equal({
      apiUrl: "https://mineru.net/api/v4",
      apiFormat: "v4",
      apiKey: "fixture-official-key",
    });
    values.mineruApiKey = "  ";
    expect(getMineruServiceConfig).to.throw("mineru-error-api-key-missing");
  });

  for (const [format, address, expected] of [
    [
      "file-parse",
      " http://127.0.0.1:8000/proxy/file_parse/ ",
      "http://127.0.0.1:8000/proxy",
    ],
    ["v1", "http://127.0.0.1:8000/proxy/", "http://127.0.0.1:8000/proxy/v1"],
    ["v1", "http://127.0.0.1:8000/proxy/v1/", "http://127.0.0.1:8000/proxy/v1"],
    [
      "v4",
      "https://example.invalid/proxy/",
      "https://example.invalid/proxy/api/v4",
    ],
    [
      "v4",
      "https://example.invalid/proxy/api/v4/",
      "https://example.invalid/proxy/api/v4",
    ],
  ]) {
    it(`accepts the ${format} address ${address} without duplicating paths`, function () {
      values.mineruCustomApiFormat = format;
      values.mineruCustomApiUrl = address;
      expect(getMineruServiceConfig().apiUrl).to.equal(expected);
    });
  }

  for (const address of [
    "",
    "localhost:8000",
    "ftp://example.invalid",
    "https://user:password@example.invalid",
    "http://localhost:8000?key=secret",
    "http://localhost:8000#parse",
  ]) {
    it(`rejects the invalid custom address ${address || "(empty)"} before any network request`, async function () {
      values.mineruCustomApiUrl = address;
      await rejects(
        MineruClient.extractMarkdown(paper),
        "mineru-error-server-url-",
      );
      expect(requests).to.have.length(0);
      expect(saveCount).to.equal(0);
    });
  }

  it("routes a custom server with no key through PDF extraction and preserves Markdown images", async function () {
    delete values.mineruApiKey;
    mockFetch(async (url, options) => {
      expect(url).to.equal("http://127.0.0.1:8000/proxy/file_parse");
      expect(options.method).to.equal("POST");
      const headers = new Headers(options.headers);
      expect(headers.has("Authorization")).to.equal(false);
      expect(headers.has("Content-Type")).to.equal(false);
      const body = options.body as FormData;
      expect(body).to.be.instanceOf(FormData);
      expect(body.get("return_md")).to.equal("true");
      expect(body.get("return_images")).to.equal("true");
      expect(body.get("response_format_zip")).to.equal("true");
      expect(body.has("backend")).to.equal(false);
      const file = body.get("files") as File;
      expect(file.name).to.equal("document.pdf");
      expect(file.type).to.equal("application/pdf");
      expect(new Uint8Array(await file.arrayBuffer())).to.deep.equal(pdfBytes);
      return zipResponse();
    });
    expect(await PDFExtractor.extractTextFromItem(paper, "mineru")).to.equal(
      markdown,
    );
    expect(requests).to.have.length(1);
    expect(saveCount).to.equal(1);
    expect(savedAssets).to.deep.equal([
      { relativePath: "images/figure.png", data: imageBytes },
    ]);
  });

  it("uses only the custom key for a native server and honors read-only extraction", async function () {
    values.mineruCustomApiKey = " fixture-custom-key ";
    mockFetch((_url, options) => {
      expect(new Headers(options.headers).get("Authorization")).to.equal(
        "Bearer fixture-custom-key",
      );
      return zipResponse();
    });
    expect(
      await MineruClient.extractMarkdown(paper, undefined, { persist: false }),
    ).to.equal(markdown);
    expect(saveCount).to.equal(0);
  });

  it("uses Zotero window FormData when it is missing from the sandbox", async function () {
    const FormDataCtor = FormData;
    delete globals.FormData;
    globals.ztoolkit = {
      log: () => {},
      getGlobal: (key: string) => {
        expect(key).to.equal("FormData");
        return FormDataCtor;
      },
    };
    mockFetch((_url, options) => {
      expect(options.body).to.be.instanceOf(FormDataCtor);
      return zipResponse();
    });
    expect(await MineruClient.extractMarkdown(paper)).to.equal(markdown);
  });

  it("reuses saved Markdown on a custom server without making network requests", async function () {
    MineruMarkdownSaver.readCachedMarkdown = async () => markdown;
    expect(await MineruClient.extractMarkdown(paper)).to.equal(markdown);
    expect(requests).to.have.length(0);
    expect(saveCount).to.equal(0);
  });

  it("reports custom server failures instead of falling back to text indexing", async function () {
    mockFetch(() => new Response("service unavailable", { status: 503 }));
    await rejects(
      PDFExtractor.extractTextFromItem(paper, "mineru"),
      "mineru-error-parse-failed",
    );
    expect(requests).to.have.length(1);
    expect(saveCount).to.equal(0);
  });

  function mockV4(uploadUrl: string, zipUrl: string) {
    mockFetch((url) => {
      if (url.endsWith("/file-urls/batch"))
        return json({
          data: { batch_id: "batch/fixture", file_urls: [uploadUrl] },
        });
      if (url.includes("/extract-results/batch/"))
        return json({
          data: { extract_result: [{ state: "done", full_zip_url: zipUrl }] },
        });
      if (url.endsWith("result.zip")) return zipResponse();
      return new Response(null);
    });
  }

  it("keeps official v4 upload, polling and signed download behavior", async function () {
    values.mineruServiceMode = "official";
    values.mineruCustomApiKey = "fixture-custom-key";
    mockV4(
      "https://storage.example.invalid/upload?signature=fixture",
      "https://storage.example.invalid/result.zip",
    );
    expect(
      await MineruClient.extractMarkdown(paper, undefined, { persist: false }),
    ).to.equal(markdown);
    expect(requests.map(({ url }) => url)).to.deep.equal([
      "https://mineru.net/api/v4/file-urls/batch",
      "https://storage.example.invalid/upload?signature=fixture",
      "https://mineru.net/api/v4/extract-results/batch/batch%2Ffixture",
      "https://storage.example.invalid/result.zip",
    ]);
    expect(
      new Headers(requests[0].options.headers).get("Authorization"),
    ).to.equal("Bearer fixture-official-key");
    expect(
      new Headers(requests[2].options.headers).get("Authorization"),
    ).to.equal("Bearer fixture-official-key");
    expect(
      new Headers(requests[1].options.headers).has("Authorization"),
    ).to.equal(false);
    expect(
      new Headers(requests[3].options.headers).has("Authorization"),
    ).to.equal(false);
  });

  it("uses a custom v4 base throughout a parse, including relative authenticated storage URLs", async function () {
    values.mineruCustomApiFormat = "v4";
    values.mineruCustomApiUrl = "http://127.0.0.1:8000/proxy/api/v4/";
    values.mineruCustomApiKey = "fixture-custom-key";
    values.mineruModelVersion = "pipeline";
    mockV4("/proxy/upload", "/proxy/result.zip");
    const result = await MineruClient.extractMarkdown(paper, () => {
      // Switching settings while parsing must not move the remaining requests.
      values.mineruCustomApiUrl = "https://other.example.invalid";
      values.mineruServiceMode = "official";
    });
    expect(result).to.equal(markdown);
    expect(requests.map(({ url }) => url)).to.deep.equal([
      "http://127.0.0.1:8000/proxy/api/v4/file-urls/batch",
      "http://127.0.0.1:8000/proxy/upload",
      "http://127.0.0.1:8000/proxy/api/v4/extract-results/batch/batch%2Ffixture",
      "http://127.0.0.1:8000/proxy/result.zip",
    ]);
    for (const request of requests)
      expect(
        new Headers(request.options.headers).get("Authorization"),
      ).to.equal("Bearer fixture-custom-key");
    expect(JSON.parse(String(requests[0].options.body)).model_version).to.equal(
      "pipeline",
    );
  });

  function mockV1(
    storageUrl = "/proxy/v1/uploads/upload-fixture/content",
    status = "completed",
    uploadAuthorization?: string,
  ) {
    mockFetch((url) => {
      if (url.endsWith("/v1/uploads"))
        return json({
          id: "upload-fixture",
          status: "pending",
          upload_url: storageUrl,
          upload_method: "PUT",
          upload_headers: {
            "Content-Type": "application/pdf",
            "X-Upload-Token": "fixture-upload-token",
            ...(uploadAuthorization
              ? { authorization: uploadAuthorization }
              : {}),
          },
        });
      if (url === new URL(storageUrl, "http://127.0.0.1:8000").href)
        return new Response(null);
      if (url.endsWith("/complete"))
        return json({ status: "completed", file: { id: "file-fixture" } });
      if (url.endsWith("/parse/jobs"))
        return json({ job_id: "job/fixture", status: "queued" });
      if (url.includes("/parse/jobs/"))
        return json({
          status,
          files: [
            { status, output_files: { zip: { file_id: "zip/fixture" } } },
          ],
        });
      if (url.endsWith("/content")) return zipResponse();
      throw new Error(`Unexpected URL ${url}`);
    });
  }

  it("uploads, completes, polls and downloads a V1 job with custom authentication", async function () {
    values.mineruCustomApiFormat = "v1";
    values.mineruCustomApiKey = "fixture-custom-key";
    mockV1();
    expect(await MineruClient.extractMarkdown(paper)).to.equal(markdown);
    expect(requests.map(({ url }) => url)).to.deep.equal([
      "http://127.0.0.1:8000/proxy/v1/uploads",
      "http://127.0.0.1:8000/proxy/v1/uploads/upload-fixture/content",
      "http://127.0.0.1:8000/proxy/v1/uploads/upload-fixture/complete",
      "http://127.0.0.1:8000/proxy/v1/parse/jobs",
      "http://127.0.0.1:8000/proxy/v1/parse/jobs/job%2Ffixture",
      "http://127.0.0.1:8000/proxy/v1/files/zip%2Ffixture/content",
    ]);
    for (const request of requests)
      expect(
        new Headers(request.options.headers).get("Authorization"),
      ).to.equal("Bearer fixture-custom-key");
    expect(
      new Headers(requests[1].options.headers).get("X-Upload-Token"),
    ).to.equal("fixture-upload-token");
    expect(JSON.parse(String(requests[3].options.body))).to.deep.equal({
      files: [{ source: { type: "file_id", file_id: "file-fixture" } }],
      output_formats: ["markdown", "zip"],
    });
    expect(saveCount).to.equal(1);
  });

  it("preserves V1 signed upload headers without forwarding the server key to another origin", async function () {
    values.mineruCustomApiFormat = "v1";
    values.mineruCustomApiKey = "fixture-custom-key";
    mockV1("https://storage.example.invalid/upload?signature=fixture");
    expect(await MineruClient.extractMarkdown(paper)).to.equal(markdown);
    expect(
      new Headers(requests[1].options.headers).has("Authorization"),
    ).to.equal(false);
    expect(
      new Headers(requests[1].options.headers).get("X-Upload-Token"),
    ).to.equal("fixture-upload-token");
  });

  it("rejects a failed V1 job without downloading or saving results", async function () {
    values.mineruCustomApiFormat = "v1";
    mockV1(undefined, "failed");
    await rejects(
      MineruClient.extractMarkdown(paper),
      "mineru-error-task-failed",
    );
    expect(requests).to.have.length(5);
    expect(saveCount).to.equal(0);
  });

  it("preserves explicit V1 upload authorization supplied by the server", async function () {
    values.mineruCustomApiFormat = "v1";
    values.mineruCustomApiKey = "fixture-custom-key";
    mockV1(undefined, undefined, "Bearer fixture-upload-token");
    expect(await MineruClient.extractMarkdown(paper)).to.equal(markdown);
    expect(
      new Headers(requests[1].options.headers).get("Authorization"),
    ).to.equal("Bearer fixture-upload-token");
  });

  it("rejects malformed V1 upload responses before any file upload", async function () {
    values.mineruCustomApiFormat = "v1";
    mockFetch(() => json({ status: "pending" }));
    await rejects(
      MineruClient.extractMarkdown(paper),
      "mineru-error-invalid-response",
    );
    expect(requests).to.have.length(1);
    expect(saveCount).to.equal(0);
  });

  it("cancels a native request without reading or saving its result", async function () {
    const controller = new AbortController();
    mockFetch(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new Error("HTTP aborted")),
            { once: true },
          );
          controller.abort(new Error("fixture cancelled"));
        }),
    );
    const error = await rejects(
      MineruClient.extractMarkdown(paper, undefined, {
        abortSignal: controller.signal,
      }),
      "aborted",
    );
    expect(error.name).to.equal("LLMRequestAbortError");
    expect(requests).to.have.length(1);
    expect(saveCount).to.equal(0);
  });

  it("bounds a native request by the configured timeout", async function () {
    values.requestTimeout = "30000";
    const originalTimeout = setTimeout;
    globals.setTimeout = (callback: () => void, delay: number) =>
      originalTimeout(callback, delay === 30000 ? 0 : delay);
    mockFetch(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new Error("HTTP aborted")),
            { once: true },
          );
        }),
    );
    await rejects(
      MineruClient.extractMarkdown(paper),
      "mineru-error-task-timeout",
    );
    expect(requests).to.have.length(1);
    expect(saveCount).to.equal(0);
  });
});
