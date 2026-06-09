export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const { pregunta, cartas, area } = await request.json();

    const prompt = `Tarot Luz & Fuerza. Área: ${area||"vida"}. Pregunta: "${pregunta}". Cartas: ${cartas}. Interpretación en 3 párrafos: situación actual, mensaje del tarot, acción concreta. Tono cálido, directo. De vos a vos. Sin markdown. Máximo 100 palabras.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    const texto = data.content ? data.content.map(i => i.text || "").join("") : "Sin respuesta";
    
    return new Response(JSON.stringify({ respuesta: texto }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
