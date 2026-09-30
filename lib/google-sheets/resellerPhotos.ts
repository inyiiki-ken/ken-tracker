"use server";

import Anthropic from "@anthropic-ai/sdk";
import { requireSession } from "./authz";

/**
 * Reads a reseller's item photo (WhatsApp tag photos / screenshots) into item
 * rows with Claude vision. Needs ANTHROPIC_API_KEY in the server env (.env on
 * the desktop install, project env vars on Vercel); without it the import
 * dialog falls back to pasting the items.
 */

export interface ReadItem {
  item: string;
  customer: string;
  grams: number | null;
  karat: "18K" | "SP" | "EF";
  note: string;
}

const MODEL = "claude-opus-5-5";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "customer", "grams", "karat", "note"],
        properties: {
          item: { type: "string", description: "The piece, e.g. 18K GOLD HOOP EARRINGS. No customer name." },
          customer: { type: "string", description: "The end customer's name written on the tag, or empty." },
          grams: { type: ["number", "null"], description: "Weight in grams, or null if not readable." },
          karat: { type: "string", enum: ["18K", "SP", "EF"] },
          note: { type: "string", description: "Anything unsure (a guessed spelling, an unclear digit), or empty." },
        },
      },
    },
  },
} as const;

const PROMPT = `This photo is from a jewellery reseller. It shows gold items with tags or a written list. Each item carries the name of the reseller's own customer, a description of the piece, and its weight in grams.

List every item you can see, once each and one row per piece. Never combine two pieces into one row, even when they belong to the same customer. For each one give:
- item: what the piece is, in upper case (e.g. "18K GOLD HOOP EARRINGS", "18K GOLD BRACELET S7.5"). Keep sizes like S7.5 or S18. Leave out the customer's name and any price.
- customer: the customer's name as written. Handwriting is often unclear: give your best reading and say so in note.
- grams: the weight. Weights are small decimals such as 1.62 or 11.32; a price in $ or AED is not a weight.
- karat: "SP" if the item is marked SP or special price, "EF" if marked EF, otherwise "18K".
- note: anything you were unsure about, otherwise empty.

If there are no items in the photo, return an empty list.`;

export async function resellerPhotoReaderReady(): Promise<boolean> {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function readResellerPhoto(params: {
  /** Base64 image data, without the data: prefix. */
  data: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}): Promise<{ items: ReadItem[]; error?: string }> {
  await requireSession();
  if (!process.env.ANTHROPIC_API_KEY) {
    return { items: [], error: "Photo reading is not set up on this install (no ANTHROPIC_API_KEY). Paste the items instead." };
  }
  const client = new Anthropic();
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: params.mediaType, data: params.data } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    if (res.stop_reason === "refusal") return { items: [], error: "The photo could not be read." };
    if (res.stop_reason === "max_tokens") return { items: [], error: "Too many items in one photo to read. Try cropping it." };
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const parsed = JSON.parse(text) as { items?: ReadItem[] };
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { items: [], error: "The ANTHROPIC_API_KEY on this install was rejected." };
    if (err instanceof Anthropic.RateLimitError) return { items: [], error: "Too many photos at once. Wait a moment and try again." };
    if (err instanceof Anthropic.APIError) return { items: [], error: `Photo reader error ${err.status ?? ""}: ${err.message}` };
    if (err instanceof SyntaxError) return { items: [], error: "The photo reader returned something unreadable. Try again." };
    return { items: [], error: err instanceof Error ? err.message : "Could not read the photo." };
  }
}
