// src-worker/tests/mocks/handlers.ts
import { http, HttpResponse } from "msw";

const MOCK_AI_API_URL_BASE =
  process.env.MOCK_AI_API_URL?.replace(/\/mock-ai$/, "") ||
  "http://127.0.0.1:9090";

export const handlers = [
  // Mock for Vision Model (e.g., Gemini)
  http.post(`${MOCK_AI_API_URL_BASE}/mock-ai`, async ({ request }) => {
    const body = (await request.json()) as any;

    // Simple check if it's a vision-like request (has image_url)
    const isVisionRequest = body.messages?.[0]?.content?.some(
      (c: any) => c.type === "image_url"
    );

    if (isVisionRequest && body.model?.includes("gemini")) {
      // Or based on your VISION_MODEL_ID_DEFAULT
      console.log("Mock AI: Received Vision Model Request");
      // Return a stringified JSON as the 'content'
      const mockVisionResponseContent = JSON.stringify({
        main_window: "Mocked Window Title",
        relevant_elements: [
          {
            type: "button",
            label: "Mock Button",
            value: null,
            ocr_text: "Click Me",
          },
        ],
        ocr_full_text: "Mocked OCR text including Click Me.",
        visual_state_notes: ["Mock element is visible"],
        pointer_location: null,
      });
      return HttpResponse.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: mockVisionResponseContent,
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
      });
    }

    // Mock for Target Model (e.g., Deepseek)
    if (body.model?.includes("deepseek")) {
      // Or based on your TARGET_MODEL_ID_DEFAULT
      console.log("Mock AI: Received Target Model Request");
      // Check for the image description string in the prompt for image-based queries
      if (
        typeof body.messages?.[0]?.content === "string" &&
        body.messages?.[0]?.content.includes("JSON_description")
      ) {
        // This means it's step B after image description
      }
      return HttpResponse.json({
        choices: [
          {
            message: {
              role: "assistant",
              content:
                "Mocked AI final answer based on text or image description.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 100,
          total_tokens: 200,
        },
      });
    }

    // Fallback for unknown mock AI requests
    console.warn("Mock AI: Received Unhandled Request:", body);
    return HttpResponse.json(
      {
        error: {
          message: "Mock AI: Model not recognized or unexpected payload",
        },
      },
      { status: 400 }
    );
  }),
];
