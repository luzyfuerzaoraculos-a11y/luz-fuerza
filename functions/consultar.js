export async function onRequestPost(context) {
  const { request, env } = context;

  const SUPA_URL = "https://iztuciguijbnpgtlvajy.supabase.co";
  const headersAdmin = env.SUPABASE_SERVICE_ROLE_KEY ? {
    "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json"
  } : null;

  let pregunta = "", area = "";

  try {
    const body = await request.json();
    pregunta = body.pregunta;
    const cartas = body.cartas;
    area = body.area;
    const pronombre = body.pronombre;
    const userId = body.userId;

    // Contexto de consultas anteriores de la misma persona, para que la IA note si la
    // pregunta de hoy esta relacionada con una anterior y le de continuidad si corresponde.
    let contextoPrevio = "";
    if (userId && headersAdmin) {
      try {
        const histResp = await fetch(
          `${SUPA_URL}/rest/v1/historial_consultas?user_id=eq.${userId}&tipo=eq.consulta&select=area,pregunta,interpretacion,created_at&order=created_at.desc&limit=3`,
          { headers: headersAdmin }
        );
        if (histResp.ok) {
          const previas = await histResp.json();
          if (Array.isArray(previas) && previas.length > 0) {
            contextoPrevio = "\n\nConsultas anteriores de esta misma persona (de la mas reciente a la mas vieja). Usalas solo si la pregunta de hoy esta relacionada, para darle continuidad y mas criterio a tu respuesta. Si el tema de hoy no tiene relacion con ninguna de estas, ignoralas por completo y respondé solo en base a la pregunta de hoy:\n" +
              previas.map((p, i) => `${i + 1}. Área: ${p.area || "vida"}. Preguntó: "${p.pregunta}". Resumen de lo que se le dijo: "${(p.interpretacion || "").slice(0, 220)}"`).join("\n");
          }
        }
      } catch (e) {
        // Si falla traer el historial previo, seguimos sin contexto en vez de bloquear la consulta
        console.error("No se pudo traer historial previo para contexto:", e.message);
      }
    }

    const generoInstr = {
      ella: `Dirigite a la consultante usando género femenino en los adjetivos que la describan (ej. "estás lista", "preparada").`,
      el: `Dirigite al consultante usando género masculino en los adjetivos que lo describan (ej. "estás listo", "preparado").`,
      elle: `Dirigite a la consultante con lenguaje neutro: evitá marcar género en los adjetivos, usando formas terminadas en "e" (ej. "estás liste", "preparade") o reformulando la frase para no necesitar un adjetivo con género.`,
      ninguno: `Dirigite a la consultante con lenguaje neutro: evitá marcar género en los adjetivos, usando formas terminadas en "e" (ej. "estás liste", "preparade") o reformulando la frase para no necesitar un adjetivo con género.`
    };
    const instrGenero = generoInstr[pronombre] || generoInstr.ella;

    const prompt = `Tarot Luz & Fuerza. Área: ${area || "vida"}. Pregunta de la consultante: "${pregunta}". Cartas (pasado, presente, futuro): ${cartas}.${contextoPrevio}

Empezá reconociendo puntualmente lo que la persona te contó (no un saludo genérico: algo que muestre que leíste su pregunta real, no una plantilla). A partir de ahí, escribí la interpretación de forma natural y fluida, sin dividirla en bloques fijos ni etiquetas, dejá que la situación actual, el mensaje del tarot y una sugerencia de acción aparezcan como parte de un mismo relato, no como párrafos separados y predecibles.

Muy importante: la respuesta tiene que estar anclada a lo que la persona preguntó literalmente. No cambies el sentido de las palabras clave de la pregunta ni te vayas a un mensaje genérico desconectado del tema real (por ejemplo, si pregunta por la libertad de alguien que está preso, hablá de esa situación concreta — no derives "libertad" hacia un consejo de crecimiento personal abstracto). Si el tema es delicado (una situación legal, de salud, una pérdida, una crisis familiar), respondé con más sensibilidad y cuidado, sin minimizar ni banalizar lo que la persona está viviendo.

${instrGenero}

Tono cálido, cercano, como alguien que escuchó de verdad antes de responder, no un informe. De vos a vos. Sin markdown. Máximo 100 palabras.`;

    const resultado = await llamarClaudeConReintento(env, prompt, 3);

    if (!resultado.ok) {
      console.error("Fallo definitivo llamando a Claude en /consultar:", resultado.error);
      await registrarErrorConsulta(env, headersAdmin, { pregunta, area, error: resultado.error });
      await alertarErrorConsulta(env, { pregunta, area, error: resultado.error });
      return new Response(JSON.stringify({
        respuesta: "Estamos teniendo un inconveniente para conectar con el tarot en este momento. Ya estamos al tanto y lo estamos revisando — probá de nuevo en unos minutos.",
        error: true
      }), { headers: { "Content-Type": "application/json" } });
    }

    const data = resultado.data;
    const texto = data.content ? data.content.map(i => i.text || "").join("") : "";

    // Registrar consumo de tokens para poder monitorear el gasto de la API
    if (data.usage && headersAdmin) {
      try {
        await fetch(`${SUPA_URL}/rest/v1/uso_tokens`, {
          method: "POST",
          headers: { ...headersAdmin, "Prefer": "return=minimal" },
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

    return new Response(JSON.stringify({ respuesta: texto || "El tarot necesita un momento. Intentá de nuevo." }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    console.error("Excepcion no atrapada en /consultar:", e.message);
    try { await alertarErrorConsulta(env, { pregunta, area, error: "Excepcion no atrapada: " + e.message }); } catch (e2) { /* no bloquear */ }
    return new Response(JSON.stringify({
      respuesta: "Estamos teniendo un inconveniente para conectar con el tarot en este momento. Ya estamos al tanto y lo estamos revisando — probá de nuevo en unos minutos.",
      error: true
    }), { headers: { "Content-Type": "application/json" } });
  }
}

// Reintenta la llamada a Claude en silencio (el consultante no ve nada de esto, solo la
// animación de espera) antes de rendirse y mostrar un mensaje amable.
async function llamarClaudeConReintento(env, prompt, intentos) {
  let ultimoError = "error desconocido";
  for (let i = 0; i < intentos; i++) {
    try {
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
      if (response.ok) {
        const data = await response.json();
        if (data && data.content) return { ok: true, data };
        ultimoError = "Respuesta sin contenido: " + JSON.stringify(data).slice(0, 300);
      } else {
        const textoErr = await response.text().catch(() => "");
        ultimoError = `HTTP ${response.status}: ${textoErr.slice(0, 300)}`;
      }
    } catch (e) {
      ultimoError = e.message;
    }
    if (i < intentos - 1) {
      await new Promise(r => setTimeout(r, 700 * (i + 1)));
    }
  }
  return { ok: false, error: ultimoError };
}

async function registrarErrorConsulta(env, headersAdmin, { pregunta, area, error }) {
  if (!headersAdmin) return;
  try {
    const SUPA_URL = "https://iztuciguijbnpgtlvajy.supabase.co";
    await fetch(`${SUPA_URL}/rest/v1/errores_consultas`, {
      method: "POST",
      headers: { ...headersAdmin, "Prefer": "return=minimal" },
      body: JSON.stringify({ pregunta: pregunta || null, area: area || null, error: String(error).slice(0, 500) })
    });
  } catch (e) {
    console.error("No se pudo registrar el error de consulta en Supabase:", e.message);
  }
}

async function alertarErrorConsulta(env, { pregunta, area, error }) {
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Luz & Fuerza <no-reply@tarotluzyfuerza.com.ar>",
        to: ["bravo.gabriela@gmail.com"],
        subject: "⚠️ El tarot no pudo responder a una consulta",
        html: `<p>Después de varios intentos automáticos, no se pudo generar una interpretación.</p><p><b>Área:</b> ${area || "-"}</p><p><b>Pregunta:</b> ${pregunta || "-"}</p><p><b>Error:</b> ${String(error).slice(0, 500)}</p>`
      })
    });
  } catch (e) {
    console.error("No se pudo enviar alerta de error de consulta:", e.message);
  }
}
