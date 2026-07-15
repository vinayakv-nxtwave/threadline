import dotenv from "dotenv";
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// "-latest" alias tracks Google's current flash-lite model, so this doesn't
// need updating every time a specific dated version gets deprecated (as
// gemini-2.5-flash-lite was, within days of this file being written).
const MODEL = "gemini-flash-lite-latest";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const VALID_CATEGORIES = ["technical", "doubt", "session", "payment", "certificate", "access", "general"];
const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];

const SYSTEM_PROMPT = `You classify support messages from students on the NxtWave Launchpad WhatsApp support line.

Read the full conversation and pick exactly one category and one priority based on what the student actually needs help with — not just the most recent message in isolation.

Categories:
- technical: portal bugs, videos not loading, login/app errors, assignment submission issues
- doubt: academic/conceptual questions about course content
- session: live class or mentor session issues (link not working, scheduling, recordings)
- payment: EMI, refunds, payment failures, invoices
- certificate: certificate issuance/correction, placement assistance
- access: password resets, account lockouts, OTP issues
- general: anything else, including greetings, thanks, or messages with no clear topic yet

Priorities:
- urgent: time-critical right now (e.g. "class starts in 5 minutes", "exam is starting", explicit repeated urgent pleas)
- high: blocking the student's progress, or a clear complaint/frustration
- medium: a normal question, no immediate blocker
- low: informational, no urgency

If the conversation genuinely gives no signal (e.g. just "Hi"), use category "general" and priority "medium" — don't guess wildly from nothing.`;

/**
 * @param {Array<{direction: 'inbound'|'outbound', body: string}>} messages
 * @returns {Promise<{category: string, priority: string} | null>} null if classification failed
 */
export async function classifyTicket(messages) {
  if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set — skipping AI classification.");
    return null;
  }

  const recent = messages.slice(-10);
  const conversationText = recent
    .map((m) => `${m.direction === "inbound" ? "Student" : "Support agent"}: ${m.body || "[media message]"}`)
    .join("\n");

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: conversationText }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          // Gemini enforces this schema server-side — the response is
          // guaranteed to match, no "please respond with only JSON"
          // prompting required.
          responseSchema: {
            type: "OBJECT",
            properties: {
              category: { type: "STRING", enum: VALID_CATEGORIES },
              priority: { type: "STRING", enum: VALID_PRIORITIES },
            },
            required: ["category", "priority"],
          },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`Gemini classification failed (${res.status}): ${errText}`);
      return null;
    }

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return null;

    const parsed = JSON.parse(rawText);
    if (!VALID_CATEGORIES.includes(parsed.category) || !VALID_PRIORITIES.includes(parsed.priority)) {
      console.error("Gemini returned an invalid category/priority:", parsed);
      return null;
    }

    return { category: parsed.category, priority: parsed.priority };
  } catch (err) {
    console.error("Classification error:", err.message);
    return null; // fail closed — leave the ticket's existing category/priority untouched
  }
}
