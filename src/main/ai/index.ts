import * as fs from "fs/promises";
import * as path from "path";

import type { AiAssistSettings, AiListingDraft } from "../../shared/types";

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_PHOTOS = 3;
const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";
const DEFAULT_LLAMACPP_ENDPOINT = "http://localhost:8080";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OLLAMA_MODEL = "llama3.2-vision";
const DEFAULT_LLAMACPP_MODEL = "default";

const DEFAULT_SYSTEM_PROMPT = "You write concise, accurate Vinted listing titles and descriptions in British English. No emojis.";

const USER_PROMPT =
  "Generate a strong Vinted listing title and description from the photos and the seller's draft title below. " +
  'Return strict JSON of the form {"title": "...", "description": "..."} and nothing else. ' +
  "Title <= 80 characters. Description: 2–4 short paragraphs.";

interface GenerateInput {
  title: string;
  photoPaths: string[];
  settings: AiAssistSettings;
}

interface OpenAiContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: string | OpenAiContentPart[];
}

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[]; // base64, no data: prefix
}

function stripLocalFileScheme(p: string): string {
  if (p.startsWith("local-file://")) {
    return decodeURIComponent(p.replace(/^local-file:\/\/\/?/, ""));
  }
  if (p.startsWith("file://")) {
    return decodeURIComponent(p.replace("file:///", "").replace("file://", ""));
  }
  return p;
}

function mimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}

async function readPhotoBase64(photoPath: string): Promise<{ base64: string; mime: string }> {
  const abs = stripLocalFileScheme(photoPath);
  const buf = await fs.readFile(abs);
  return { base64: buf.toString("base64"), mime: mimeFromExt(abs) };
}

function parseDraftJson(raw: string): AiListingDraft {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`AI response did not contain JSON: ${raw}`);
  }
  const slice = trimmed.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    throw new Error(`AI response was not valid JSON: ${raw}`);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { title?: unknown }).title !== "string" ||
    typeof (parsed as { description?: unknown }).description !== "string"
  ) {
    throw new Error(`AI response missing title/description: ${raw}`);
  }
  return parsed as AiListingDraft;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function generateOpenAi(input: GenerateInput): Promise<AiListingDraft> {
  const { settings } = input;
  if (!settings.openaiApiKey) throw new Error("OpenAI API key is not configured");

  const photos = input.photoPaths.slice(0, MAX_PHOTOS);
  const imageParts: OpenAiContentPart[] = [];
  for (const p of photos) {
    const { base64, mime } = await readPhotoBase64(p);
    imageParts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } });
  }

  const messages: OpenAiMessage[] = [
    { role: "system", content: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT },
    {
      role: "user",
      content: [{ type: "text", text: `${USER_PROMPT}\n\nDraft title: ${input.title || "(empty)"}` }, ...imageParts],
    },
  ];

  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: settings.openaiModel || DEFAULT_OPENAI_MODEL,
      messages,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI request failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseDraftJson(content);
}

async function generateOllama(input: GenerateInput): Promise<AiListingDraft> {
  const { settings } = input;
  const endpoint = (settings.ollamaEndpoint || DEFAULT_OLLAMA_ENDPOINT).replace(/\/$/, "");

  const photos = input.photoPaths.slice(0, MAX_PHOTOS);
  const images: string[] = [];
  for (const p of photos) {
    const { base64 } = await readPhotoBase64(p);
    images.push(base64);
  }

  const messages: OllamaMessage[] = [
    { role: "system", content: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT },
    {
      role: "user",
      content: `${USER_PROMPT}\n\nDraft title: ${input.title || "(empty)"}`,
      images,
    },
  ];

  const res = await fetchWithTimeout(`${endpoint}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.ollamaModel || DEFAULT_OLLAMA_MODEL,
      messages,
      stream: false,
      format: "json",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama request failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content ?? "";
  return parseDraftJson(content);
}

async function generateLlamaCpp(input: GenerateInput): Promise<AiListingDraft> {
  const { settings } = input;
  const endpoint = (settings.llamacppEndpoint || DEFAULT_LLAMACPP_ENDPOINT).replace(/\/$/, "");

  const photos = input.photoPaths.slice(0, MAX_PHOTOS);
  const imageParts: OpenAiContentPart[] = [];
  for (const p of photos) {
    const { base64, mime } = await readPhotoBase64(p);
    imageParts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } });
  }

  const messages: OpenAiMessage[] = [
    { role: "system", content: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT },
    {
      role: "user",
      content: [{ type: "text", text: `${USER_PROMPT}\n\nDraft title: ${input.title || "(empty)"}` }, ...imageParts],
    },
  ];

  const res = await fetchWithTimeout(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.llamacppModel || DEFAULT_LLAMACPP_MODEL,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`llama.cpp request failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseDraftJson(content);
}

export async function generateListingDraft(input: GenerateInput): Promise<AiListingDraft> {
  switch (input.settings.provider) {
    case "openai":
      return generateOpenAi(input);
    case "ollama":
      return generateOllama(input);
    case "llamacpp":
      return generateLlamaCpp(input);
    default:
      throw new Error(`Unknown AI provider: ${(input.settings as { provider: string }).provider}`);
  }
}
