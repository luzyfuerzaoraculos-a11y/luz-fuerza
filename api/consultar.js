const https = require("https");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { pregunta, cartas, area } = req.body;

  const prompt = `Sos la voz de Luz & Fuerza, un tarot que guía desde la luz interior y la fuerza que impulsa cada paso. Tu lema es "Tu luz interior · La fuerza que impulsa tu camino".

El consultante consulta sobre el área de ${area || "vida"}: "${pregunta}"

Las cartas que salieron son:
${cartas}

Dá una interpretación en 3 párrafos cortos:
1. Qué revelan las cartas sobre su situación actual
2. Qué mensaje tiene el tarot para ellas
3. Una acción concreta o reflexión para cerrar

Tono: cálido, directo, poderoso. Hablá de vos a vos. Sin asteriscos ni markdown. Máximo 120 palabras total.`;

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
          res.status(200).json({ respuesta: texto });
        } catch (e) {
          res.status(500).json({ error: "Error al procesar respuesta" });
        }
        resolve();
      });
    });
    request.on("error", () => {
      res.status(500).json({ error: "Error de conexion" });
      resolve();
    });
    request.write(body);
    request.end();
  });
};
