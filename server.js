import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { cars } from "./cars.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT) || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

app.use(express.json({ limit: "30kb" }));
app.use(express.static(publicDir));

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const systemInstructions = `
Ты — помощник AutoAI, который помогает выбирать автомобиль.
Тебе передают пользовательский запрос и историю короткого чата.
Нужно извлечь только конкретные ограничения, которые пользователь сообщил:
brand: название марки или null;
body: один из "Седан", "Кроссовер", "Хэтчбек", "Универсал" или null;
minPrice: число в тенге или null;
maxPrice: число в тенге или null;
minYear: целое число или null;
maxYear: целое число или null;
searchText: короткое описание других пожеланий на языке пользователя.
Не придумывай ограничений, если их не было. Если пользователь пишет "до 15 млн", maxPrice=15000000.
Если пользователь пишет "от 2022 года", minYear=2022.
Если запрос на казахском или английском, распознай его и оставь searchText на языке пользователя.
Верни только JSON-объект с этими полями, без Markdown.
`;

function normalizeCriteria(value) {
  const numberOrNull = (n) => Number.isFinite(Number(n)) && n !== null && n !== "" ? Number(n) : null;
  const allowedBodies = ["Седан", "Кроссовер", "Хэтчбек", "Универсал"];
  let body = typeof value.body === "string" ? value.body : null;
  if (body && !allowedBodies.includes(body)) body = null;

  return {
    brand: typeof value.brand === "string" && value.brand.trim() ? value.brand.trim() : null,
    body,
    minPrice: numberOrNull(value.minPrice),
    maxPrice: numberOrNull(value.maxPrice),
    minYear: numberOrNull(value.minYear),
    maxYear: numberOrNull(value.maxYear),
    searchText: typeof value.searchText === "string" ? value.searchText.slice(0, 300) : ""
  };
}

function matchesCriteria(car, criteria) {
  const brandMatch = !criteria.brand ||
    car.brand.toLowerCase().includes(criteria.brand.toLowerCase()) ||
    criteria.brand.toLowerCase().includes(car.brand.toLowerCase());
  return brandMatch &&
    (!criteria.body || car.body === criteria.body) &&
    (criteria.minPrice === null || car.price >= criteria.minPrice) &&
    (criteria.maxPrice === null || car.price <= criteria.maxPrice) &&
    (criteria.minYear === null || car.year >= criteria.minYear) &&
    (criteria.maxYear === null || car.year <= criteria.maxYear);
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, aiConfigured: Boolean(openai) });
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!openai) {
      return res.status(503).json({
        error: "Не найден API-ключ. Создай файл .env и добавь OPENAI_API_KEY."
      });
    }

    const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
    const history = Array.isArray(req.body.history) ? req.body.history.slice(-8) : [];

    if (!message) return res.status(400).json({ error: "Напиши запрос о желаемом автомобиле." });
    if (message.length > 2000) return res.status(400).json({ error: "Запрос слишком длинный. Сократи его до 2000 символов." });

    const safeHistory = history
      .filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
      .map(item => ({ role: item.role, content: item.content.slice(0, 1200) }));

    const extraction = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: systemInstructions,
      input: [
        ...safeHistory.map(item => ({ role: item.role, content: item.content })),
        { role: "user", content: message }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "car_search_criteria",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              brand: { type: ["string", "null"] },
              body: { type: ["string", "null"], enum: ["Седан", "Кроссовер", "Хэтчбек", "Универсал", null] },
              minPrice: { type: ["number", "null"] },
              maxPrice: { type: ["number", "null"] },
              minYear: { type: ["integer", "null"] },
              maxYear: { type: ["integer", "null"] },
              searchText: { type: "string" }
            },
            required: ["brand", "body", "minPrice", "maxPrice", "minYear", "maxYear", "searchText"]
          }
        }
      },
      max_output_tokens: 300
    });

    let rawCriteria;
    try {
      rawCriteria = JSON.parse(extraction.output_text);
    } catch {
      return res.status(502).json({ error: "ИИ не смог разобрать запрос. Попробуй сформулировать его иначе." });
    }

    const criteria = normalizeCriteria(rawCriteria);
    const matchedCars = cars.filter(car => matchesCriteria(car, criteria));
    const catalogForAI = matchedCars.slice(0, 8).map(car => ({
      id: car.id, brand: car.brand, model: car.model,
      price: car.price, body: car.body, year: car.year
    }));

    const answerResponse = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: `
Ты — вежливый автомобильный консультант AutoAI. Отвечай на языке последнего запроса.
Тебе переданы только реальные автомобили из локальной базы проекта.
Не придумывай цены, характеристики, комплектации, расход топлива, пробег, состояние или надёжность.
Не добавляй автомобили, которых нет в переданном списке.
Если список пустой, честно сообщи, что точных совпадений в текущей базе нет, и попроси изменить бюджет, год, кузов или марку.
Если список не пустой, кратко объясни, какие варианты подходят по подтверждённым параметрам. Для семейности, надёжности или экономичности не делай категоричных утверждений, потому что подробных характеристик в базе нет.
Цены в базе — ориентировочные учебные данные, а не подтверждённые актуальные объявления. Напомни это кратко.
Не показывай пользователю внутренние JSON-критерии.
`,
      input: JSON.stringify({
        userMessage: message,
        extractedCriteria: criteria,
        matchedCars: catalogForAI
      }),
      max_output_tokens: 500
    });

    res.json({
      answer: answerResponse.output_text || "Я нашёл подходящие автомобили. Посмотри карточки ниже.",
      criteria,
      cars: matchedCars
    });
  } catch (error) {
    console.error("Chat API error:", error?.message || error);
    if (error?.status === 401) {
      return res.status(502).json({ error: "API-ключ не принят. Проверь OPENAI_API_KEY в файле .env." });
    }
    if (error?.status === 429) {
      return res.status(429).json({ error: "Лимит API исчерпан или нет доступного баланса. Проверь настройки оплаты и лимиты API." });
    }
    res.status(500).json({ error: "Не удалось получить ответ от ИИ. Проверь подключение к интернету и настройки API." });
  }
});

app.listen(port, () => {
  console.log(`AutoAI запущен: http://localhost:${port}`);
  if (!openai) console.log("Внимание: OPENAI_API_KEY не найден. Добавь ключ в .env.");
});
