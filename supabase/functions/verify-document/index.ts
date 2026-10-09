// supabase/functions/verify-document/index.ts
//
// Deploy with: supabase functions deploy verify-document
//
// WHAT THIS IS: a first-pass screen that catches the obvious cases — a
// photo of something unrelated, a blank or black image, a screenshot of a
// meme or a webpage, or an image whose visible layout clearly doesn't
// match the declared document type at all.
//
// WHAT THIS IS NOT: legal-grade KYC / identity verification. It cannot
// check a document against any government database (Aadhaar's UIDAI API,
// DigiLocker, etc. require formal registration and business agreements —
// genuinely out of scope for a project at this stage), and it cannot
// reliably catch a competent forgery. A vision model describing what an
// image LOOKS like is not the same thing as verifying what it IS. Say so
// in the UI, don't oversell this to users as identity verification.
//
// REQUIRES: a GROQ_API_KEY set as a Supabase Edge Function secret
// (`supabase secrets set GROQ_API_KEY=gsk_...`). Groq's free tier covers
// a meaningful volume of calls for a project at this stage — check
// console.groq.com for current limits before assuming it's entirely free
// at scale.
//
// MODEL: qwen/qwen3.8-27b is Groq's documented vision-capable model as of
// this writing (console.groq.com/docs/vision) — Groq rotates vision model
// availability periodically, so if this starts failing, check that page
// for the current model slug before assuming the code is broken.
//
// LIMITATION: Groq's vision endpoint (OpenAI-compatible chat completions)
// only accepts image content, not PDFs directly — unlike Anthropic's API,
// there's no native "document" block for PDF here. A PDF upload is
// detected below and returned as "uncertain" with an explanatory message,
// rather than sent as a malformed request that would just error.
//
// Input  (POST body): { imageBase64: string, mimeType: string, docType: string, fullName: string }
// Output: {
//   verdict: "likely_genuine" | "uncertain" | "likely_invalid",
//   confidence: number (0-1),
//   reasoning: string,       // one plain-language sentence, safe to show the user
//   nameMatch: boolean | null
// }

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "qwen/qwen3.8-27b";

function buildPrompt(docType: string, fullName: string, declaredIdNumber: string) {
  return `You are a first-pass document screener for a tourist safety app, NOT a legal identity verifier. You are shown an image the user uploaded and claimed is their ${docType} (an Indian government-issued ID).

Your job has two parts:

1. Catch obviously wrong uploads: a photo of something unrelated, a blank/black/corrupted image, a screenshot of a meme or a webpage, or an image whose visible layout and text clearly does not match a ${docType} at all.

Do NOT attempt to verify authenticity against any database. Do NOT judge whether a well-made forgery is real; you cannot know that from an image alone. If the image plausibly looks like a real ${docType}, say "likely_genuine" or "uncertain" rather than demanding certainty you can't have.

2. Read whatever name and ID number are legibly visible and report them. The comparison against what the user typed happens outside your response; you only report what you can read.

The user entered their name as: "${fullName || "(not provided)"}"
The user entered their ID number as: "${declaredIdNumber || "(not provided)"}"

Respond ONLY with JSON, no other text, no markdown fences:
{
  "verdict": "likely_genuine" | "uncertain" | "likely_invalid",
  "confidence": <number 0 to 1>,
  "reasoning": "<one short, plain-language sentence, shown directly to the user>",
  "nameMatch": <true if a name is visible and plausibly matches the entered name, false if visible and clearly different, null if no name is legible>,
  "extractedIdNumber": "<ID number exactly as visible, digits/letters only, no spaces, or null if none is legible>"
}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const { imageBase64, mimeType, docType, fullName, declaredIdNumber } = await req.json();

    if (!imageBase64 || !docType) {
      return new Response(
        JSON.stringify({ error: "imageBase64 and docType are required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("GROQ_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GROQ_API_KEY is not configured on this function" }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }


    // Groq's vision endpoint only accepts images. PDFs are rendered to a
    // JPEG first via the Render service's /pdf-to-image endpoint.
    let finalImageBase64 = imageBase64;
    let finalMimeType = mimeType;

    if (mimeType === "application/pdf") {
      const renderUrl = Deno.env.get("PDF_RENDER_URL");
      const renderSecret = Deno.env.get("PDF_RENDER_SECRET");
      if (!renderUrl) {
        return new Response(
          JSON.stringify({
            verdict: "uncertain", confidence: 0,
            reasoning: "PDF rendering isn't configured, so this document needs manual review.",
            nameMatch: null, extractedIdNumber: null, idNumberMatch: null,
          }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
      const renderRes = await fetch(`${renderUrl}/pdf-to-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(renderSecret ? { "X-Webhook-Secret": renderSecret } : {}),
        },
        body: JSON.stringify({ pdfBase64: imageBase64 }),
      });
      if (!renderRes.ok) {
        throw new Error(`PDF render service error ${renderRes.status}: ${await renderRes.text()}`);
      }
      const rendered = await renderRes.json();
      finalImageBase64 = rendered.imageBase64;
      finalMimeType = rendered.mimeType;
    }

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPrompt(docType, fullName, declaredIdNumber) },
              { type: "image_url", image_url: { url: `data:${finalMimeType};base64,${finalImageBase64}` } },
            ],
          },
        ],
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      throw new Error(`Groq API error ${groqRes.status}: ${errText}`);
    }

    const data = await groqRes.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const cleaned = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Model didn't return clean JSON for some reason — fail open to
      // "uncertain" rather than blocking a real user on a parsing hiccup
      // that has nothing to do with whether their document is genuine.
      parsed = {
        verdict: "uncertain",
        confidence: 0.5,
        reasoning: "Automatic check couldn't be completed — a human should review this document.",
        nameMatch: null,
        extractedIdNumber: null,
      };
    }

    // The number comparison is deterministic code, not another model call.
    const norm = (v: string | null | undefined) => (v ?? "").replace(/[\s-]/g, "").toLowerCase();
    const extracted = norm(parsed.extractedIdNumber);
    const declared = norm(declaredIdNumber);
    const idNumberMatch = !extracted || !declared ? null : extracted === declared;

    return new Response(JSON.stringify({ ...parsed, idNumberMatch }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});

