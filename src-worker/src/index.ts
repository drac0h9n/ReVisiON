// src-worker/src/index.ts
import {
  Env,
  BackendSyncPayload,
  WorkerQueryRequest,
  WorkerQueryResponse,
  OpenAIVisionPayload, // Reusable type for compatible APIs
  OpenAICompletionResponse,
  ApiResponse,
  OpenAIMessageContent, // Ensure this type is correctly defined and imported
} from "./types";
import { jsonResponse, errorResponse } from "./utils";
import { authenticateRequest } from "./auth";
import { upsertUserProfile } from "./db"; // Assuming db.ts defines this correctly

// --- Define Model Identifiers ---
// !!! IMPORTANT: It's highly recommended to move these to Cloudflare Worker Environment Variables (Secrets) !!!
const VISION_MODEL_ID_DEFAULT = "google/gemini-2.0-flash-001"; // Model for image description
const TARGET_MODEL_ID_DEFAULT = "accounts/fireworks/models/deepseek-r1"; // Example default non-vision or target model ID

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Determine Model IDs from environment or use defaults
    // Example: Allow overriding via environment variables
    const visionModelId = VISION_MODEL_ID_DEFAULT;
    const targetModelId = TARGET_MODEL_ID_DEFAULT;

    try {
      // --- Authentication (Common to relevant endpoints) ---
      if (url.pathname === "/sync-user" || url.pathname === "/query") {
        const authErrorResponse = authenticateRequest(request, env);
        if (authErrorResponse) {
          return authErrorResponse; // Auth failed
        }
        console.log(`Authenticated request for ${url.pathname}`);
      }

      // --- Endpoint: /sync-user (GitHub Profile Sync) ---
      if (url.pathname === "/sync-user" && request.method === "POST") {
        console.log("Handling /sync-user request...");
        if (request.headers.get("Content-Type") !== "application/json") {
          return errorResponse("Bad Request: Expected JSON", 400);
        }

        let payload: BackendSyncPayload;
        try {
          payload = await request.json<BackendSyncPayload>();
        } catch (e: any) {
          // Catch specifically JSON parsing errors
          if (e instanceof SyntaxError) {
            console.error("Failed to parse JSON for /sync-user:", e.message);
            return errorResponse(
              `Bad Request: Invalid JSON - ${e.message}`,
              400
            );
          }
          // Handle other potential errors during parsing/reading body if any
          console.error("Error reading request body for /sync-user:", e);
          return errorResponse(
            `Bad Request: Could not read request body - ${e.message}`,
            400
          );
        }

        // Validate payload structure after successful parsing
        if (!payload?.profile?.id || !payload?.profile?.login) {
          console.warn(
            "Received sync payload missing required fields (id, login)",
            payload
          );
          return errorResponse(
            "Bad Request: Missing profile fields (id, login)",
            400
          );
        }

        console.log(`Received sync payload for user ID: ${payload.profile.id}`);
        try {
          await upsertUserProfile(payload.profile, env.DB);
          console.log(`Sync completed for user ID: ${payload.profile.id}`);
          // Use jsonResponse for standard success response structure if preferred
          // return jsonResponse({ message: "User profile synced successfully." }, 200);
          // Or a simple direct Response:
          return new Response(
            JSON.stringify({
              success: true,
              message: "User profile synced successfully.",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        } catch (dbError: any) {
          console.error(
            `Database sync error for user ID ${payload.profile.id}:`,
            dbError
          );
          return errorResponse(dbError.message || "Database sync failed", 500);
        }
      }

      // --- Endpoint: /query (AI Vision Query) ---
      if (url.pathname === "/query" && request.method === "POST") {
        console.log("Handling /query request...");
        if (request.headers.get("Content-Type") !== "application/json") {
          return errorResponse("Bad Request: Expected JSON", 400);
        }

        // 1. Parse Request from Tauri Backend
        let queryRequest: WorkerQueryRequest;
        try {
          queryRequest = await request.json<WorkerQueryRequest>();
        } catch (e: any) {
          if (e instanceof SyntaxError) {
            console.error("Failed to parse JSON for /query:", e.message);
            return errorResponse(
              `Bad Request: Invalid JSON - ${e.message}`,
              400
            );
          }
          console.error("Error reading request body for /query:", e);
          return errorResponse(
            `Bad Request: Could not read request body - ${e.message}`,
            400
          );
        }

        // Destructure and validate core components
        const { text, base64ImageDataUrl } = queryRequest;
        const userQuery = text || ""; // Ensure text is always a string, even if empty

        // Basic validation: At least text or image must be present
        if (!userQuery && !base64ImageDataUrl) {
          return errorResponse("Bad Request: Requires text or image data", 400);
        }
        console.log(
          `Received query: Text='${
            userQuery ? userQuery.substring(0, 50) + "..." : "None"
          }', Image=${base64ImageDataUrl ? "Present" : "None"}`
        );
        // TODO: Add logic here if needed to check if the *selected* target model actually *requires* this two-step process.
        // For now, we assume *any* image triggers the two-step process.

        // --- AI API Configuration ---
        const customApiUrl = env.CUSTOM_AI_API_URL;
        const customApiKey = env.CUSTOM_AI_API_KEY;
        if (!customApiUrl || !customApiKey) {
          console.error(
            "CRITICAL: CUSTOM_AI_API_URL or CUSTOM_AI_API_KEY secret not set!"
          );
          return errorResponse(
            "Internal Server Error: AI provider configuration missing",
            500
          );
        }

        // --- Logic Branching: Image vs Text-Only ---
        if (base64ImageDataUrl) {
          // === Branch 1: Image Present - Two-Step Process ===
          console.log("Image detected. Starting two-step AI process...");

          // Validate image data URL basic format
          if (!base64ImageDataUrl.startsWith("data:image/")) {
            console.warn(
              "Received potentially invalid image data URL format. Attempting to proceed..."
            );
            // Optionally return error: return errorResponse("Bad Request: Invalid image data format", 400);
          }

          // --- Step A: Get Image Description from Vision Model (e.g., Gemini) ---
          let imageDescriptionJsonString: string; // Store the description as a JSON string
          try {
            console.log(
              `Step A: Calling Vision Model (${visionModelId}) for description...`
            );

            // A1. Construct Vision Model Prompt (Requesting JSON Output)
            // Note: Adjust 'macOS Sequoia 15.4' if OS info can be passed from client

            const geminiSystemPrompt = `**任务:** 你是一个图像分析助手。你的任务是详细描述下面提供的屏幕截图，以便另一个 AI 模型（无法看到图像）能够理解截图中的视觉内容和上下文。严格按照要求的 JSON 格式输出。

            **上下文:**
            - 操作系统: ['macOS Sequoia 15.4'] // Consider making this dynamic if possible
            - 背景: 这张截图由用户提供，展示了他们在运行一个桌面应用程序时遇到的界面或问题。
            - 用户遇到的原始问题是: "${userQuery}"
            
            **指示:**
            1.  **分析整个截图，但请【重点关注】与用户问题"${userQuery}"最相关的窗口、区域和 UI 元素。**
            2.  **输出结构化的 JSON 对象:** 创建一个 JSON 对象，包含以下键 (确保值为有效的 JSON 类型，主要是字符串, 数组, 对象, 布尔值, null):
                - \`main_window\`: (String | null) 主窗口标题，如果可识别。
                - \`relevant_elements\`: (Array of Objects) 描述与问题相关的 UI 元素。每个对象应包含：
                    - \`type\`: (String) 元素类型 (e.g., "button", "input", "menu", "text_block", "error_message").
                    - \`label\`: (String | null) 元素上的文本标签或图标描述。
                    - \`value\`: (String | boolean | number | null) 元素的状态或内容 (e.g., input text, checkbox state).
                    - \`ocr_text\`: (String | null) 与此元素关联的 OCR 提取文本。
                - \`ocr_full_text\`: (String | null) 提取的截图中所有【英文和中文】文本。\
                - \`visual_state_notes\`: (Array of Strings) 描述显著的视觉状态 (e.g., "Element X is highlighted", "Button Y is disabled").
                - \`pointer_location\`: (String | null) 鼠标指针位置描述，如果可见且重要。
            3.  **保持客观:** 只描述可见内容。务必只输出一个有效的 JSON 对象，不要包含任何解释性文本或 \`\`\`json \`\`\` 标记。`;

            // A2. Prepare Vision Model API Payload
            const visionContent: OpenAIMessageContent[] = [
              { type: "text", text: geminiSystemPrompt },
              {
                type: "image_url",
                image_url: {
                  url: base64ImageDataUrl,
                  // detail: "auto" // Adjust if needed
                },
              },
            ];

            const visionPayload: OpenAIVisionPayload = {
              model: visionModelId,
              messages: [{ role: "user", content: visionContent }],
              // --- IMPORTANT: Check if your specific API endpoint supports enforcing JSON ---
              // Example for OpenAI-like APIs:
              // response_format: { type: "json_object" },
              // --- Adjust parameters as needed ---
              max_tokens: 2048, // Sufficient for detailed JSON description
              temperature: 0.2, // Low temp for factual, structured output
            };

            console.log(
              "Sending payload to Vision Model:",
              JSON.stringify(visionPayload).substring(0, 200) + "..."
            ); // Log partial payload

            // A3. Call Vision Model API
            const apiResponse = await fetch(customApiUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${customApiKey}`,
              },
              body: JSON.stringify(visionPayload),
            });

            console.log(
              `Vision Model API responded with status: ${apiResponse.status}`
            );

            // A4. Process Vision Model Response
            if (!apiResponse.ok) {
              const errorBodyText = await apiResponse.text(); // Read error body
              console.error(
                `Vision Model API Error (${apiResponse.status}): ${errorBodyText}`
              );
              // Try to pass back a more specific error if possible
              return errorResponse(
                `AI Vision Step Failed (${apiResponse.status}): ${
                  errorBodyText || "Request failed"
                }`,
                apiResponse.status >= 500 ? 502 : apiResponse.status
              );
            }

            const completion =
              await apiResponse.json<OpenAICompletionResponse>();

            // Check for logical errors within the successful response
            if (completion.error) {
              console.error(
                `Vision Model API returned error in body: Type=${completion.error.type}, Msg=${completion.error.message}`
              );
              return errorResponse(
                `AI Vision Step Error: ${completion.error.message}`,
                400
              ); // Assuming 400 for API-level error report
            }

            const description =
              completion?.choices?.[0]?.message?.content ?? null;
            if (description === null || description.trim() === "") {
              console.warn(
                "Vision Model response successful, but content was null or empty."
              );
              return errorResponse("AI description content was empty", 500); // Indicate internal issue
            }

            // --- Validate if the output is likely JSON ---
            let trimmedDescription = description.trim();
            // Handle potential markdown code blocks ```json ... ```
            if (trimmedDescription.startsWith("```json")) {
              trimmedDescription = trimmedDescription.substring(7);
              if (trimmedDescription.endsWith("```")) {
                trimmedDescription = trimmedDescription.substring(
                  0,
                  trimmedDescription.length - 3
                );
              }
              trimmedDescription = trimmedDescription.trim(); // Trim again after removing backticks
            }

            try {
              JSON.parse(trimmedDescription); // Attempt to parse to validate
              imageDescriptionJsonString = trimmedDescription; // Store the validated/cleaned JSON string
              console.log(
                `Step A successful. Received and validated JSON description (length: ${imageDescriptionJsonString.length})`
              );
            } catch (jsonError: any) {
              console.error(
                "Vision model output failed JSON parsing:",
                jsonError.message
              );
              console.error("Received content:", description); // Log the raw faulty content
              // Decide: Return error or try to use the raw string anyway? Returning error is safer.
              return errorResponse(
                "AI description step failed: Output was not valid JSON",
                500
              );
            }
          } catch (error: any) {
            console.error(
              `Error during Step A (Vision Model Call): ${error.message}`,
              error.stack
            );
            if (error.name === "AbortError")
              return errorResponse("Request to Vision AI timed out", 504); // Gateway Timeout
            return errorResponse(
              `Failed during image analysis step: ${error.message}`,
              502
            ); // Bad Gateway for network/fetch issues
          }

          // --- Step B: Get Final Answer from Target Model (e.g., DeepSeek) ---
          try {
            console.log(
              `Step B: Calling Target Model (${targetModelId}) with description...`
            );

            // B1. Construct Target Model Prompt using the description from Step A
            const deepseekPrompt = `用户在使用 'macOS Sequoia 15.4' 时遇到了问题。
用户的问题是： "${userQuery}"

用户提供了截图，以下是对截图内容的 JSON 描述：
--- JSON START ---
${imageDescriptionJsonString}
--- JSON END ---

请根据用户的问题和上述截图的 JSON 描述，分析问题可能的原因，并提供详细的、可操作的解决方案或步骤建议。请直接回答用户的原始问题，结合提供的视觉上下文进行推理。`;

            // B2. Prepare Target Model API Payload (Text-based)
            const targetPayload = {
              model: targetModelId,
              messages: [
                {
                  role: "user",
                  content: deepseekPrompt,
                },
              ],
              max_tokens: 3000, // Adjust as needed for the final answer length
              temperature: 0.6, // Adjust for desired creativity/factuality balance
              // Add other parameters like stop sequences if necessary
            };

            console.log(
              "Sending payload to Target Model:",
              JSON.stringify(targetPayload).substring(0, 200) + "..."
            );

            // B3. Call Target Model API
            const apiResponse = await fetch(customApiUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${customApiKey}`,
              },
              body: JSON.stringify(targetPayload),
            });

            console.log(
              `Target Model API responded with status: ${apiResponse.status}`
            );

            // B4. Process Target Model Response
            if (!apiResponse.ok) {
              const errorBodyText = await apiResponse.text();
              console.error(
                `Target Model API Error (${apiResponse.status}): ${errorBodyText}`
              );
              return errorResponse(
                `AI Target Step Failed (${apiResponse.status}): ${
                  errorBodyText || "Request failed"
                }`,
                apiResponse.status >= 500 ? 502 : apiResponse.status
              );
            }

            const completion =
              await apiResponse.json<OpenAICompletionResponse>();
            if (completion.error) {
              console.error(
                `Target Model API returned error in body: Type=${completion.error.type}, Msg=${completion.error.message}`
              );
              return errorResponse(
                `AI Target Step Error: ${completion.error.message}`,
                400
              );
            }

            const finalAnswer =
              completion?.choices?.[0]?.message?.content ?? null;
            if (finalAnswer === null || finalAnswer.trim() === "") {
              console.warn(
                "Target Model response successful, but content was null or empty."
              );
              return errorResponse("AI final answer content was empty", 500);
            }

            console.log(
              `Step B successful. Received final answer (length: ${finalAnswer.length})`
            );

            // --- Step C: Send Final Response back to Tauri ---
            const workerResponse: WorkerQueryResponse = {
              ai_text: finalAnswer,
            };
            // Directly return the response object in the expected format
            return new Response(JSON.stringify(workerResponse), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          } catch (error: any) {
            console.error(
              `Error during Step B (Target Model Call): ${error.message}`,
              error.stack
            );
            if (error.name === "AbortError")
              return errorResponse("Request to Target AI timed out", 504);
            return errorResponse(
              `Failed during final answer generation step: ${error.message}`,
              502
            );
          }
        } else {
          // === Branch 2: Text-Only Query ===
          // This branch executes if `base64ImageDataUrl` is null or empty
          console.log("No image detected. Performing direct AI query...");

          if (!userQuery) {
            // This case should technically be caught earlier, but double-check
            return errorResponse(
              "Bad Request: Text query cannot be empty",
              400
            );
          }

          try {
            // Prepare payload for the target model directly
            const directPayload = {
              model: targetModelId, // Use the same target model ID
              messages: [
                {
                  role: "user",
                  content: userQuery, // Only the user's text query
                },
              ],
              max_tokens: 3000, // Adjust as needed
              temperature: 0.7, // Adjust as needed
            };

            console.log(
              "Sending payload for direct query:",
              JSON.stringify(directPayload).substring(0, 200) + "..."
            );

            // Call the AI API
            const apiResponse = await fetch(customApiUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${customApiKey}`,
              },
              body: JSON.stringify(directPayload),
            });

            console.log(
              `Direct AI API responded with status: ${apiResponse.status}`
            );
            if (!apiResponse.ok) {
              const errorBodyText = await apiResponse.text();
              console.error(
                `Direct AI API Error (${apiResponse.status}): ${errorBodyText}`
              );
              return errorResponse(
                `Direct AI Query Failed (${apiResponse.status}): ${
                  errorBodyText || "Request failed"
                }`,
                apiResponse.status >= 500 ? 502 : apiResponse.status
              );
            }

            // Parse the response
            const completion =
              await apiResponse.json<OpenAICompletionResponse>();
            if (completion.error) {
              console.error(
                `Direct AI API returned error in body: Type=${completion.error.type}, Msg=${completion.error.message}`
              );
              return errorResponse(
                `Direct AI Query Error: ${completion.error.message}`,
                400
              );
            }

            const aiText = completion?.choices?.[0]?.message?.content ?? null;
            if (aiText === null || aiText.trim() === "") {
              console.warn(
                "Direct AI response successful, but content was null or empty."
              );
              return errorResponse("Direct AI response content was empty", 500);
            }

            console.log(
              `Direct query successful. Received answer (length: ${aiText.length})`
            );

            // Send Response back to Tauri
            const workerResponse: WorkerQueryResponse = { ai_text: aiText };
            return new Response(JSON.stringify(workerResponse), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          } catch (error: any) {
            console.error(
              `Error during direct AI query: ${error.message}`,
              error.stack
            );
            if (error.name === "AbortError")
              return errorResponse("Request to AI timed out", 504);
            return errorResponse(
              `Failed processing direct AI query: ${error.message}`,
              502
            );
          }
        }
      }

      // --- Fallback for unhandled routes/methods ---
      console.log(`Request unhandled: ${request.method} ${url.pathname}`);
      return errorResponse("Not Found", 404);
    } catch (e: any) {
      // --- Catch-all for unexpected errors in routing/request handling ---
      // This catches errors *outside* specific endpoint try-catch blocks
      console.error(
        "Unhandled Top-Level Worker Exception:",
        e.message,
        e.stack
      );
      return errorResponse("Internal Server Error", 500);
    }
  },
};

// Ensure that `types.ts`, `utils.ts`, `auth.ts`, and `db.ts` are present
// and correctly define the necessary interfaces and functions.
