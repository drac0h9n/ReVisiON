// src-worker/src/index.ts
import {
  Env,
  BackendSyncPayload,
  WorkerQueryRequest,
  WorkerQueryResponse,
  OpenAIVisionPayload, // Reusable type for compatible APIs
  OpenAICompletionResponse,
  ApiResponse, // Make sure ApiResponse is defined if used elsewhere, otherwise remove if unused
  OpenAIMessageContent, // Ensure this type is correctly defined and imported
} from "./types"; // Ensure types.ts defines all these interfaces correctly
import { jsonResponse, errorResponse } from "./utils"; // Ensure utils.ts defines these helper functions
import { authenticateRequest } from "./auth"; // Ensure auth.ts defines this function
import { upsertUserProfile } from "./db"; // Ensure db.ts defines this correctly

// --- Define Model Identifiers ---
// !!! IMPORTANT: It's highly recommended to move these to Cloudflare Worker Environment Variables (Secrets) !!!
const VISION_MODEL_ID_DEFAULT = "google/gemini-2.0-flash-001"; // Example: Changed to a common Gemini vision model
const TARGET_MODEL_ID_DEFAULT = "accounts/fireworks/models/deepseek-r1"; // Example: Changed to a Cloudflare Workers AI model

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Determine Model IDs - Prefer environment variables if set
    const visionModelId = VISION_MODEL_ID_DEFAULT;
    const targetModelId = TARGET_MODEL_ID_DEFAULT;

    // --- Determine AI API Endpoint and Key ---
    // Use Cloudflare AI Gateway specific variables if available, otherwise fallback to generic
    // Note: Cloudflare AI Gateway often uses CF specific model IDs like "@cf/..."
    const aiApiUrl = env.CUSTOM_AI_API_URL; // Use CF AI Gateway URL or a generic one
    const aiApiKey = env.CUSTOM_AI_API_KEY; // Use CF AI Gateway key or a generic one

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
          if (e instanceof SyntaxError) {
            console.error("Failed to parse JSON for /sync-user:", e.message);
            return errorResponse(
              `Bad Request: Invalid JSON - ${e.message}`,
              400
            );
          }
          console.error("Error reading request body for /sync-user:", e);
          return errorResponse(
            `Bad Request: Could not read request body - ${e.message}`,
            400
          );
        }

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

        const { text, base64ImageDataUrl } = queryRequest;
        const userQuery = text || "";

        if (!userQuery && !base64ImageDataUrl) {
          return errorResponse("Bad Request: Requires text or image data", 400);
        }
        console.log(
          `Received query: Text='${
            userQuery ? userQuery.substring(0, 50) + "..." : "None"
          }', Image=${base64ImageDataUrl ? "Present" : "None"}`
        );

        // --- AI API Configuration Check ---
        if (!aiApiUrl || !aiApiKey) {
          console.error(
            "CRITICAL: AI_API_URL or AI_API_KEY (or fallback CUSTOM_AI_...) secret not set!"
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

          if (!base64ImageDataUrl.startsWith("data:image/")) {
            console.warn(
              "Received potentially invalid image data URL format. Ensure it's 'data:image/[type];base64,...'"
            );
            // Consider stricter validation if needed
          }

          // --- Step A: Get Image Description from Vision Model (e.g., Gemini) ---
          let imageDescriptionJsonString: string; // Store the FINAL validated JSON string description
          try {
            console.log(
              `Step A: Calling Vision Model (${visionModelId}) for description...`
            );

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
                image_url: { url: base64ImageDataUrl },
              },
            ];

            // Ensure the payload format matches the expected format for the Vision Model API / Gateway
            // This structure assumes an OpenAI-compatible API
            const visionPayload: OpenAIVisionPayload = {
              model: visionModelId,
              messages: [{ role: "user", content: visionContent }],
              // response_format: { type: "json_object" }, // Uncomment IF your API/model supports JSON mode
              max_tokens: 2048,
              temperature: 0.2,
            };

            console.log(
              "Sending payload to Vision Model:",
              JSON.stringify(visionPayload).substring(0, 200) + "..."
            );

            // A3. Call Vision Model API
            const visionApiResponse = await fetch(aiApiUrl, {
              // Use the unified aiApiUrl
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${aiApiKey}`, // Use the unified aiApiKey
              },
              body: JSON.stringify(visionPayload),
            });

            console.log(
              `Vision Model API responded with status: ${visionApiResponse.status}`
            );

            // A4. Process Vision Model Response
            if (!visionApiResponse.ok) {
              const errorBodyText = await visionApiResponse.text();
              console.error(
                `Vision Model API Error (${visionApiResponse.status}): ${errorBodyText}`
              );
              return errorResponse(
                `AI Vision Step Failed (${visionApiResponse.status}): ${
                  errorBodyText || "Request failed"
                }`,
                visionApiResponse.status >= 500 ? 502 : visionApiResponse.status
              );
            }

            // --- START: Added Logging and Robust Parsing ---
            const rawResponseBody = await visionApiResponse.text(); // Read body ONCE

            console.log("------ RAW VISION MODEL RESPONSE START ------");
            console.log(rawResponseBody); // LOG THE RAW RESPONSE
            console.log("------ RAW VISION MODEL RESPONSE END ------");

            let completion: OpenAICompletionResponse;
            let descriptionContent: string | null = null;

            try {
              // Parse the raw text into a JSON object
              completion = JSON.parse(rawResponseBody);

              // Check for logical errors *within* the successfully parsed response
              if (completion.error) {
                console.error(
                  `Vision Model API returned error in body: Type=${completion.error.type}, Msg=${completion.error.message}`
                );
                // Return a 4xx or 5xx depending on the error type if possible
                return errorResponse(
                  `AI Vision Step Error: ${completion.error.message}`,
                  400
                );
              }

              // Extract the main content string (adjust path if needed based on actual API response structure)
              descriptionContent =
                completion?.choices?.[0]?.message?.content ?? null;
            } catch (parseError: any) {
              console.error(
                "Failed to parse Vision Model JSON response:",
                parseError.message
              );
              // Log the raw response again for debugging parsing failures
              console.error(
                "Raw response body that failed parsing:",
                rawResponseBody
              );
              return errorResponse(
                "AI Vision Step Failed: Invalid JSON response received from model",
                502 // Bad Gateway, as the upstream response was malformed
              );
            }
            // --- END: Added Logging and Robust Parsing ---

            // Check if the extracted content is usable
            if (
              descriptionContent === null ||
              descriptionContent.trim() === ""
            ) {
              console.warn(
                "Vision Model response parsed successfully, but 'content' was null or empty."
              );
              // Log the full parsed object for context if content is empty
              console.log(
                "Parsed completion object with empty content:",
                JSON.stringify(completion, null, 2)
              );
              return errorResponse("AI description content was empty", 500);
            }

            // Clean potential markdown wrappers from the content string
            let trimmedDescription = descriptionContent.trim();
            if (trimmedDescription.startsWith("```json")) {
              trimmedDescription = trimmedDescription.substring(7);
              if (trimmedDescription.endsWith("```")) {
                trimmedDescription = trimmedDescription.substring(
                  0,
                  trimmedDescription.length - 3
                );
              }
              trimmedDescription = trimmedDescription.trim(); // Trim again
            }

            // --- Validate if the *cleaned content string* is valid JSON ---
            // This assumes the model was instructed to put a JSON *string* inside the 'content' field.
            try {
              JSON.parse(trimmedDescription); // Attempt to parse the string itself
              imageDescriptionJsonString = trimmedDescription; // Store the validated JSON string
              console.log(
                `Step A successful. Received and validated JSON description string (length: ${imageDescriptionJsonString.length})`
              );
              // Optionally log the validated JSON string passed to the next step:
              // console.log("Validated Image Description JSON:", imageDescriptionJsonString);
            } catch (jsonError: any) {
              console.error(
                "Vision model's extracted 'content' failed JSON parsing:",
                jsonError.message
              );
              console.error(
                "Extracted 'content' string that failed parsing:",
                descriptionContent
              ); // Log the original problematic string
              return errorResponse(
                "AI description step failed: Extracted content was not valid JSON",
                500 // Internal error as the format deviated from expectation
              );
            }
          } catch (error: any) {
            // Catch errors during the fetch/network part of Step A
            console.error(
              `Error during Step A (Vision Model Call/Processing): ${error.message}`,
              error.stack
            );
            if (error.name === "AbortError")
              // Example for fetch timeout
              return errorResponse("Request to Vision AI timed out", 504);
            return errorResponse(
              `Failed during image analysis step: ${error.message}`,
              502 // Bad Gateway or similar for upstream issues
            );
          }

          // --- Step B: Get Final Answer from Target Model (e.g., Llama) ---
          try {
            console.log(
              `Step B: Calling Target Model (${targetModelId}) with description...`
            );

            const deepseekPrompt = `用户在使用 'macOS Sequoia 15.4' 时遇到了问题。
用户的问题是： "${userQuery}"

用户提供了截图，以下是对截图内容的 JSON 描述：
--- JSON START ---
${imageDescriptionJsonString}
--- JSON END ---

请根据用户的问题和上述截图的 JSON 描述，分析问题可能的原因，并提供详细的、可操作的解决方案或步骤建议。请直接回答用户的原始问题，结合提供的视觉上下文进行推理。`;

            // B2. Prepare Target Model API Payload (Text-based)
            // Adjust payload structure based on the TARGET model's requirements
            const targetPayload = {
              model: targetModelId, // Use the target model ID
              messages: [{ role: "user", content: deepseekPrompt }],
              max_tokens: 3000,
              temperature: 0.6,
              // stream: false, // Ensure stream is false if not handling streaming response
            };

            console.log(
              "Sending payload to Target Model:",
              JSON.stringify(targetPayload).substring(0, 200) + "..."
            );

            // B3. Call Target Model API
            const targetApiResponse = await fetch(aiApiUrl, {
              // Use the same API endpoint/gateway
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${aiApiKey}`,
              },
              body: JSON.stringify(targetPayload),
            });

            console.log(
              `Target Model API responded with status: ${targetApiResponse.status}`
            );

            // B4. Process Target Model Response
            if (!targetApiResponse.ok) {
              const errorBodyText = await targetApiResponse.text();
              console.error(
                `Target Model API Error (${targetApiResponse.status}): ${errorBodyText}`
              );
              return errorResponse(
                `AI Target Step Failed (${targetApiResponse.status}): ${
                  errorBodyText || "Request failed"
                }`,
                targetApiResponse.status >= 500 ? 502 : targetApiResponse.status
              );
            }

            // Assuming target model also returns OpenAI-compatible response
            const targetCompletion =
              await targetApiResponse.json<OpenAICompletionResponse>();

            if (targetCompletion.error) {
              console.error(
                `Target Model API returned error in body: Type=${targetCompletion.error.type}, Msg=${targetCompletion.error.message}`
              );
              return errorResponse(
                `AI Target Step Error: ${targetCompletion.error.message}`,
                400
              );
            }

            const finalAnswer =
              targetCompletion?.choices?.[0]?.message?.content ?? null;

            if (finalAnswer === null || finalAnswer.trim() === "") {
              console.warn(
                "Target Model response successful, but content was null or empty."
              );
              console.log(
                "Parsed target completion object with empty content:",
                JSON.stringify(targetCompletion, null, 2)
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
          console.log("No image detected. Performing direct AI query...");

          if (!userQuery) {
            return errorResponse(
              "Bad Request: Text query cannot be empty",
              400
            );
          }

          try {
            // Prepare payload for the target model directly
            const directPayload = {
              model: targetModelId, // Use the target model ID
              messages: [{ role: "user", content: userQuery }],
              max_tokens: 3000,
              temperature: 0.7,
              //stream: false,
            };

            console.log(
              "Sending payload for direct query:",
              JSON.stringify(directPayload).substring(0, 200) + "..."
            );

            // Call the AI API
            const directApiResponse = await fetch(aiApiUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${aiApiKey}`,
              },
              body: JSON.stringify(directPayload),
            });

            console.log(
              `Direct AI API responded with status: ${directApiResponse.status}`
            );

            if (!directApiResponse.ok) {
              const errorBodyText = await directApiResponse.text();
              console.error(
                `Direct AI API Error (${directApiResponse.status}): ${errorBodyText}`
              );
              return errorResponse(
                `Direct AI Query Failed (${directApiResponse.status}): ${
                  errorBodyText || "Request failed"
                }`,
                directApiResponse.status >= 500 ? 502 : directApiResponse.status
              );
            }

            // Parse the response
            const directCompletion =
              await directApiResponse.json<OpenAICompletionResponse>();

            if (directCompletion.error) {
              console.error(
                `Direct AI API returned error in body: Type=${directCompletion.error.type}, Msg=${directCompletion.error.message}`
              );
              return errorResponse(
                `Direct AI Query Error: ${directCompletion.error.message}`,
                400
              );
            }

            const aiText =
              directCompletion?.choices?.[0]?.message?.content ?? null;

            if (aiText === null || aiText.trim() === "") {
              console.warn(
                "Direct AI response successful, but content was null or empty."
              );
              console.log(
                "Parsed direct completion object with empty content:",
                JSON.stringify(directCompletion, null, 2)
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
      // --- Catch-all for unexpected errors IN THE WORKER ITSELF ---
      console.error(
        "Unhandled Top-Level Worker Exception:",
        e.message,
        e.stack
      );
      return errorResponse("Internal Server Error", 500);
    }
  },
};

// Reminder: Ensure `types.ts`, `utils.ts`, `auth.ts`, and `db.ts` exist and are correct.
// Also ensure Cloudflare environment variables/secrets (DB, AI_API_URL, AI_API_KEY, AUTH_SECRET etc.) are set.
