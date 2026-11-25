// Серверный клиент OpenAI для диагностики состояния и ухода. Ключ только на сервере.
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const LANG = { kk: "қазақ", ru: "русском", en: "English" };

function langName(lang) {
  return LANG[lang] || LANG.ru;
}

const DIAG_SYSTEM = (lang, potCm) => `You are a houseplant doctor. Look at the photo and return ONLY one JSON object, no markdown.
Write every free-text field in this language: ${langName(lang)}.
Assume a pot of about ${potCm || 15} cm diameter and ordinary room conditions at home.
Be concrete and practical. Never invent diseases: if the photo is unclear, say so and lower "health_score".
JSON schema:
{
 "is_plant": true|false,
 "name": {"kk": "...", "ru": "...", "en": "..."},
 "latin": "Genus species or null",
 "status": "healthy" | "attention" | "critical",
 "health_score": 0-100,
 "summary": "1-2 sentences: current condition",
 "problems": ["short problem 1", "..."],
 "causes": ["likely cause 1", "..."],
 "care": {
   "water_ml_per_day": number (average ml per day for this pot size),
   "water_per_time_ml": number,
   "water_every_days": number,
   "water_note": "how to water: where, time of day, water temperature",
   "light": "...",
   "temperature_c": "e.g. 18-24",
   "humidity": "...",
   "soil": "...",
   "fertilizer": "what and how often",
   "steps": ["step 1 to do today", "step 2", "step 3", "step 4"]
 },
 "recheck_days": integer 1-14 (when to photograph the plant again)
}
If the photo is not a plant, set "is_plant": false and fill other fields with empty values.`;

async function callOpenAI(body, timeoutMs) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY не задан");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function diagnosePlant({ imageBase64, mimeType, lang, potCm }) {
  const data = await callOpenAI(
    {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 900, // короткий ответ = 5–15 секунд
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DIAG_SYSTEM(lang, potCm) },
        {
          role: "user",
          content: [
            { type: "text", text: "Diagnose this plant." },
            // detail:low — быстрее и дешевле; для состояния листьев достаточно
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: "low" } },
          ],
        },
      ],
    },
    25000
  );
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Пустой ответ модели");
  const j = JSON.parse(raw);
  const care = j.care || {};
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  return {
    is_plant: j.is_plant !== false,
    name: { kk: j.name?.kk || "—", ru: j.name?.ru || "—", en: j.name?.en || "—" },
    latin: j.latin || null,
    status: ["healthy", "attention", "critical"].includes(j.status) ? j.status : "attention",
    health_score: Math.max(0, Math.min(100, Math.round(num(j.health_score, 50)))),
    summary: j.summary || "",
    problems: Array.isArray(j.problems) ? j.problems.slice(0, 6) : [],
    causes: Array.isArray(j.causes) ? j.causes.slice(0, 6) : [],
    care: {
      water_ml_per_day: Math.round(num(care.water_ml_per_day, 0)),
      water_per_time_ml: Math.round(num(care.water_per_time_ml, 0)),
      water_every_days: Math.max(1, Math.round(num(care.water_every_days, 3))),
      water_note: care.water_note || "",
      light: care.light || "",
      temperature_c: String(care.temperature_c ?? ""),
      humidity: care.humidity || "",
      soil: care.soil || "",
      fertilizer: care.fertilizer || "",
      steps: Array.isArray(care.steps) ? care.steps.slice(0, 8) : [],
    },
    recheck_days: Math.max(1, Math.min(14, Math.round(num(j.recheck_days, 3)))),
  };
}

const ASSISTANT_SYSTEM = (lang, plants) => `You are "Flora", a friendly smart assistant for home plant care.
Answer ONLY in this language: ${langName(lang)}. Be concrete: give exact amounts (ml of water per day or per watering),
frequency, light, temperature, humidity, soil, fertilizer and step-by-step home care. Use short paragraphs or numbered steps.
If the user asks for a care plan, make a day-by-day schedule for a week or a month. If you are unsure, say so honestly;
for serious pest/disease cases advise checking with a specialist. Do not give medical advice about people.
The user's plants (may be empty):
${plants && plants.length ? JSON.stringify(plants).slice(0, 3000) : "none"}`;

export async function assistantReply({ messages, lang, plants }) {
  const data = await callOpenAI(
    {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 700,
      messages: [{ role: "system", content: ASSISTANT_SYSTEM(lang, plants) }, ...messages],
    },
    30000
  );
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Пустой ответ модели");
  return text;
}
