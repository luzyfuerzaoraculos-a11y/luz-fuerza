const https = require("https");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { pregunta, cartas } = JSON.parse(event.body);

  const prompt = `Sos la voz de Luz & Fuerza, un oráculo de tarot cuyo lema es "Tu luz interior · La fuerza que impulsa tu camino". El consultante pregunta: "${pregunta}". Las cartas que salieron son: ${cartas}. Dá una interpretación breve, cálida y poderosa de máximo 4 oraciones en español. Mencioná la luz interior y la fuerza de manera natural. Sin asteriscos ni markdown. Hablá de vos a vos directamente.`;

  const body = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }]
  });

  const options = {
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Length": Buffer.byteLength(body)
    }
  };

  return new Promise((resolve) => {
    const request = https.request(options, (response) => {
      let data = "";
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const texto = parsed.content ? parsed.content.map(i => i.text || "").join("") : "Sin respuesta";
          resolve({
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ respuesta: texto })
          });
        } catch (e) {
          resolve({ statusCode: 500, body: JSON.stringify({ error: "Error al procesar" }) });
        }
      });
    });
    request.on("error", () => {
      resolve({ statusCode: 500, body: JSON.stringify({ error: "Error de conexion" }) });
    });
    request.write(body);
    request.end();
  });
};
