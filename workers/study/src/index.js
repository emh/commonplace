const SYSTEM_PROMPT = `You are a book study partner. The user will provide:
- a quote from a book
- the title and author
- a question about the quote

Your goals:
- Answer the user's question in a succinct, conversational way (no essays or lengthy explanations).
- Make your response directly address the quote and the question.
- Keep the tone friendly and helpful, as if chatting with a study partner.
- Never return long paragraphs or multiple paragraphs. Your answer should be brief - ideally just a few sentences.

Process:
1. Carefully consider the provided quote, book details, and user's question.
2. Think briefly through the reasoning needed to answer the question (do not share these reasoning steps with the user; just use them to inform your answer).
3. Conclude with the conversational answer.

Output format:
A single, succinct paragraph (2-4 sentences maximum; no lists or bullet points).

Example interaction:
User:
Quote: "It is only with the heart that one can see rightly; what is essential is invisible to the eye."
Book: The Little Prince by Antoine de Saint-Exupery
Question: What does the fox mean by this?

Your answer:
The fox is saying that true understanding and value aren't things you can see with your eyes - they're felt with your heart. He's highlighting the importance of emotions and intuition over appearances.

Reminder:
Always give a short, conversational response - never an essay. Address the user's question and the context of the quote.`;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const url = new URL(request.url);

      if (request.method !== "POST" || url.pathname !== "/api/study") {
        return json({ error: "Not found" }, 404, cors);
      }

      if (!isAuthorized(request, env)) {
        return json({ error: "Unauthorized" }, 401, cors);
      }

      const body = await request.json();
      const { quote, source, question, history } = body;

      if (!quote || !question) {
        return json({ error: "quote and question are required" }, 400, cors);
      }

      if (!env.OPENAI_API_KEY) {
        return json({ error: "OPENAI_API_KEY is not configured" }, 500, cors);
      }

      const answer = await askOpenAI(quote, source || "", question, Array.isArray(history) ? history : [], env);
      return json({ answer }, 200, cors);
    } catch (error) {
      return json({ error: messageFromError(error) }, 500, cors);
    }
  }
};

function buildMessages(quote, source, question, history) {
  const allQuestions = [...history.map((h) => h.question), question];
  const allAnswers = history.map((h) => h.answer);

  const firstUserContent = [
    `Quote: "${quote}"`,
    source ? `Book: ${source}` : null,
    `Question: ${allQuestions[0]}`
  ].filter(Boolean).join("\n");

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: firstUserContent }
  ];

  for (let i = 0; i < allAnswers.length; i++) {
    messages.push({ role: "assistant", content: allAnswers[i] });
    messages.push({ role: "user", content: allQuestions[i + 1] });
  }

  return messages;
}

async function askOpenAI(quote, source, question, history, env) {
  const messages = buildMessages(quote, source, question, history);
  const model = env.OPENAI_MODEL || "gpt-4.1-mini";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, messages })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || `OpenAI request failed: ${response.status}`);
  }

  const payload = await response.json();
  const answer = payload.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("OpenAI returned no answer");
  return answer;
}

function isAuthorized(request, env) {
  if (!env.APP_TOKEN) return true;
  const authorization = request.headers.get("Authorization") || "";
  const explicit = request.headers.get("X-Commonplace-Token") || "";
  return authorization === `Bearer ${env.APP_TOKEN}` || explicit === env.APP_TOKEN;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const allowOrigin = origin && (allowed.includes("*") || allowed.includes(origin)) ? origin : "";
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Commonplace-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };

  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }

  return headers;
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
  });
}

function messageFromError(error) {
  return error instanceof Error ? error.message : "Request failed";
}
