require("dotenv").config();
const express = require("express");
const path = require("path");
const https = require("https");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const API_KEY = process.env.ANTHROPIC_API_KEY;

app.post("/consultar", (req, res) => {
  const { pregunta, cartas } = req.body;

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
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Length": Buffer.byteLength(body)
    }
  };

  const request = https.request(options, (response) => {
    let data = "";
    response.on("data", (chunk) => { data += chunk; });
    response.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        console.log("Respuesta API:", JSON.stringify(parsed).substring(0, 200));
        const texto = parsed.content ? parsed.content.map(i => i.text || "").join("") : "Sin respuesta";
        res.json({ respuesta: texto });
      } catch (e) {
        console.error("Error parseando:", e, data);
        res.status(500).json({ error: "Error al procesar respuesta" });
      }
    });
  });

  request.on("error", (e) => {
    console.error("Error de conexion:", e);
    res.status(500).json({ error: "Error de conexion" });
  });

  request.write(body);
  request.end();
});

app.listen(3000, () => {
  console.log("Luz & Fuerza corriendo en http://localhost:3000");
});
