/**
 * ================================================================
 * 一图总结图片生成客户端
 * ================================================================
 *
 * 使用 Gemini API (Nano Banana Pro) 生成学术概念海报图片
 *
 * 主要功能:
 * 1. 调用 Gemini 生图 API 生成图片
 * 2. 处理 API 响应并提取 Base64 图片数据
 * 3. 提供详细的错误报告
 *
 * API 说明:
 * - 使用 gemini-3-pro-image-preview 模型
 * - 返回格式为 Base64 编码的图片
 *
 * @module imageClient
 * @author AI-Butler Team
 */

import { getPref } from "../utils/prefs";

/**
 * 图片生成结果接口
 */
export interface ImageGenerationResult {
  /** Base64 编码的图片数据 */
  imageBase64: string;
  /** 图片 MIME 类型 */
  mimeType: string;
}

/**
 * 图片生成错误类
 */
export class ImageGenerationError extends Error {
  /** 详细错误信息 */
  public details: {
    errorName: string;
    errorMessage: string;
    statusCode?: number;
    requestUrl?: string;
    responseBody?: string;
  };

  constructor(
    message: string,
    details: ImageGenerationError["details"],
  ) {
    super(message);
    this.name = "ImageGenerationError";
    this.details = details;
  }
}

/**
 * 图片生成客户端类
 */
export class ImageClient {
  /**
   * 生成学术概念海报图片
   *
   * @param prompt 生图提示词 (已经过变量替换)
   * @param options 可选配置覆盖
   * @returns 包含 Base64 图片数据和 MIME 类型的结果
   */
  public static async generateImage(
    prompt: string,
    options?: {
      apiKey?: string;
      apiUrl?: string;
      model?: string;
    },
  ): Promise<ImageGenerationResult> {
    // 从设置中获取 API 配置
    const apiKey =
      options?.apiKey ||
      (getPref("imageSummaryApiKey" as any) as string) ||
      "";
    const apiUrl =
      options?.apiUrl ||
      (getPref("imageSummaryApiUrl" as any) as string) ||
      "https://generativelanguage.googleapis.com";
    const model =
      options?.model ||
      (getPref("imageSummaryModel" as any) as string) ||
      "gemini-3-pro-image-preview";

    if (!apiKey) {
      throw new ImageGenerationError("一图总结 API Key 未配置", {
        errorName: "ConfigurationError",
        errorMessage: "请在设置页面配置一图总结的 Gemini API Key",
      });
    }

    const endpoint = `${apiUrl.replace(/\/$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const payload = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.8, // 稍高的温度以增加创造性
      },
    };

    ztoolkit.log(`[AI-Butler] 调用 Gemini 生图 API: ${endpoint}`);
    ztoolkit.log(`[AI-Butler] 生图提示词长度: ${prompt.length} 字符`);

    let response: any;
    try {
      response = await Zotero.HTTP.request("POST", endpoint, {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: 120000, // 2 分钟超时，生图可能较慢
      });
    } catch (error: any) {
      const statusCode = error?.xmlhttp?.status;
      const responseBody =
        error?.xmlhttp?.response || error?.xmlhttp?.responseText || "";

      let errorMessage = error?.message || "Gemini 生图请求失败";
      let errorName = "NetworkError";

      try {
        if (responseBody) {
          const parsed =
            typeof responseBody === "string"
              ? JSON.parse(responseBody)
              : responseBody;
          
          // 处理标准 Gemini 错误格式
          let err = parsed?.error || parsed;
          
          // 处理代理服务器返回的嵌套错误 (如 {"detail": "...JSON..."})
          if (parsed?.detail && typeof parsed.detail === "string") {
            // detail 字段可能包含嵌套的 JSON 字符串
            const detailMatch = parsed.detail.match(/\{[\s\S]*\}/);
            if (detailMatch) {
              try {
                const nestedJson = JSON.parse(detailMatch[0]);
                err = nestedJson?.error || nestedJson;
              } catch {
                // 如果解析失败，使用原始 detail 作为错误信息
                errorMessage = parsed.detail;
              }
            } else {
              errorMessage = parsed.detail;
            }
          }
          
          errorName = err?.code || err?.status || "APIError";
          if (err?.message) {
            errorMessage = err.message;
          }
        }
      } catch {
        /* ignore parse error */
      }

      throw new ImageGenerationError(errorMessage, {
        errorName,
        errorMessage,
        statusCode,
        requestUrl: endpoint,
        responseBody:
          typeof responseBody === "string"
            ? responseBody
            : JSON.stringify(responseBody),
      });
    }

    // 解析响应
    if (response.status !== 200) {
      throw new ImageGenerationError(`HTTP ${response.status}`, {
        errorName: `HTTP_${response.status}`,
        errorMessage: `HTTP ${response.status}: ${response.statusText || "请求失败"}`,
        statusCode: response.status,
        requestUrl: endpoint,
        responseBody: response.response,
      });
    }

    try {
      const json =
        typeof response.response === "string"
          ? JSON.parse(response.response)
          : response.response;

      // 从响应中提取图片数据
      const candidates = json?.candidates || [];
      if (candidates.length === 0) {
        throw new ImageGenerationError("API 未返回任何结果", {
          errorName: "EmptyResponse",
          errorMessage: "Gemini API 返回了空的 candidates 数组",
          requestUrl: endpoint,
          responseBody: response.response,
        });
      }

      const parts = candidates[0]?.content?.parts || [];
      const imagePart = parts.find((p: any) => p.inlineData);

      if (!imagePart) {
        // 检查是否返回了文本而非图片
        const textPart = parts.find((p: any) => p.text);
        if (textPart) {
          throw new ImageGenerationError("API 返回了文本而非图片", {
            errorName: "NoImageGenerated",
            errorMessage: `模型返回了文本内容而非图片。请检查模型是否支持图片生成。\n\n返回内容: ${textPart.text?.substring(0, 200)}...`,
            requestUrl: endpoint,
            responseBody: response.response,
          });
        }
        throw new ImageGenerationError("API 未返回图片数据", {
          errorName: "NoImageData",
          errorMessage: "Gemini API 响应中未包含 inlineData 图片数据",
          requestUrl: endpoint,
          responseBody: response.response,
        });
      }

      const imageBase64 = imagePart.inlineData.data;
      const mimeType = imagePart.inlineData.mimeType || "image/png";

      ztoolkit.log(
        `[AI-Butler] 成功生成图片，MIME: ${mimeType}, 大小: ${Math.round(imageBase64.length / 1024)} KB`,
      );

      return {
        imageBase64,
        mimeType,
      };
    } catch (error: any) {
      if (error instanceof ImageGenerationError) {
        throw error;
      }
      throw new ImageGenerationError("解析 API 响应失败", {
        errorName: "ParseError",
        errorMessage: error?.message || "无法解析 Gemini API 响应",
        requestUrl: endpoint,
        responseBody: response.response,
      });
    }
  }

  /**
   * 测试 API 连接
   *
   * @param options 可选配置覆盖
   * @returns 测试结果
   */
  public static async testConnection(options?: {
    apiKey?: string;
    apiUrl?: string;
    model?: string;
  }): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.generateImage(
        "Generate a simple test image: a blue circle on white background.",
        options,
      );

      if (result.imageBase64) {
        return {
          success: true,
          message: `✅ 连接成功！生成了 ${result.mimeType} 格式的图片 (${Math.round(result.imageBase64.length / 1024)} KB)`,
        };
      } else {
        return {
          success: false,
          message: "⚠️ 连接成功但未返回图片数据",
        };
      }
    } catch (error: any) {
      const details =
        error instanceof ImageGenerationError ? error.details : null;
      return {
        success: false,
        message: `❌ 连接失败: ${details?.errorMessage || error.message}`,
      };
    }
  }

  /**
   * 格式化错误为详细报告 (用于 UI 显示)
   */
  public static formatError(error: any): string {
    if (error instanceof ImageGenerationError) {
      const d = error.details;
      let report = `错误名称: ${d.errorName}\n`;
      report += `错误信息: ${d.errorMessage}\n`;
      if (d.statusCode) {
        report += `HTTP 状态码: ${d.statusCode}\n`;
      }
      if (d.requestUrl) {
        report += `请求地址: ${d.requestUrl}\n`;
      }
      if (d.responseBody) {
        report += `\n响应内容:\n${d.responseBody.substring(0, 1000)}`;
        if (d.responseBody.length > 1000) {
          report += "\n... (已截断)";
        }
      }
      return report;
    }
    return error?.message || String(error);
  }
}

export default ImageClient;
