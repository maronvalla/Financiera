const TELEGRAM_API = "https://api.telegram.org";

function splitTelegramMessage(text, limit = 3500) {
  const lines = String(text || "").split("\n");
  const chunks = [];
  let current = "";
  lines.forEach((line) => {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > limit) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  });
  if (current) chunks.push(current);
  return chunks;
}

async function sendTelegramMessage({ token, chatId, text }) {
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN no configurado.");
  }
  if (!chatId) {
    throw new Error("chatId inválido.");
  }
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });
  if (!response.ok) {
    const body = await response.text();
    let details = body;
    try {
      details = JSON.parse(body);
    } catch (error) {
      // keep raw text
    }
    const error = new Error("Error enviando Telegram.");
    error.details = details;
    error.status = response.status;
    throw error;
  }
  return response.json();
}

module.exports = {
  sendTelegramMessage,
  splitTelegramMessage
};
