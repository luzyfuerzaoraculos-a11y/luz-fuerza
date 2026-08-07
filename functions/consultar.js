export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const { pregunta, cartas, area } = await request.json();

    const prompt = `Tarot Luz & Fuerza. Área: ${area||"vida"}. Pregunta de la consultante: "${pregunta}". Cartas (pasado, presente, futuro): ${cartas}.

Escribí una interpretación en 3 párrafos: situación actual, mensaje del tarot, acción concreta.

Muy importante: la respuesta tiene que estar anclada a lo que la persona preguntó literalmente. No cambies el sentido de las palabras clave de la pregunta ni te vayas a un mensaje genérico desconectado del tema real (por ejemplo, si pregunta por la libertad de alguien que está preso, hablá de esa situación concreta — no derives "libertad" hacia un consejo de crecimiento personal abstracto). Si el tema es delicado (una situación legal, de salud, una pérdida, una crisis familiar), respondé con más sensibilidad y cuidado, sin minimizar ni banalizar lo que la persona está viviendo.

Tono cálido, directo. De vos a vos. Sin markdown. Máximo 100 palabras.`;

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

    // Registrar consumo de tokens para poder monitorear el gasto de la API
    if (data.usage && env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const SUPA_URL = "https://iztuciguijbnpgtlvajy.supabase.co";
        await fetch(`${SUPA_URL}/rest/v1/uso_tokens`, {
          method: "POST",
          headers: {
            "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({
            input_tokens: data.usage.input_tokens || 0,
            output_tokens: data.usage.output_tokens || 0,
            modelo: "claude-haiku-4-5"
          })
        });
      } catch (e) {
        // No bloquear la respuesta al usuario si falla el registro de uso
        console.error("No se pudo registrar el uso de tokens:", e.message);
      }
    }

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
