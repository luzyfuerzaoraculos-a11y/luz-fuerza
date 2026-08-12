export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const entry = body.entry && body.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const value = change && change.value;
    const message = value && value.messages && value.messages[0];

    if (!message) {
      // Actualizaciones de estado (entregado/leido) u otro evento: solo confirmamos, no hacemos nada.
      return new Response("OK", { status: 200 });
    }

    const from = message.from;
    const textoUsuario = message.text && message.text.body ? message.text.body.trim() : "";

    if (!from || !textoUsuario) {
      return new Response("OK", { status: 200 });
    }

    const respuesta = await generarRespuestaFAQ(env, textoUsuario);
    await enviarWhatsApp(env, from, respuesta);

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("Error en whatsapp-webhook:", e.message);
    // Siempre devolvemos 200: si devolvemos error, Meta reintenta el mismo mensaje en loop.
    return new Response("OK", { status: 200 });
  }
}

const FAQ_CONTEXTO = `Sos el asistente de WhatsApp de Luz & Fuerza, una plataforma de tarot online con interpretacion por inteligencia artificial (tarotluzyfuerza.com.ar).

Informacion del negocio:
- La primera carta del dia y la primera consulta completa son gratis, sin necesidad de tarjeta ni de pagar nada.
- Consulta de tarot completa (3 cartas: pasado, presente, futuro) con interpretacion personalizada: $2.500 ARS, pago unico.
- Pack Semanal: $6.000 ARS por mes, 4 consultas (se habilita 1 por semana) mas un resumen de la tendencia del mes por mail.
- Plan Mensual: $9.000 ARS por mes, 8 consultas (se habilitan 2 por semana) mas carta del dia todos los dias del mes, mas resumen de la tendencia del mes por mail.
- Carta del dia individual (una sola vez): $2.000 ARS.
- Combo Consulta + Carta del dia: $3.000 ARS.
- El pago se hace con MercadoPago desde el sitio. Tambien se puede transferir por alias (tarotluzyfuerza) o CVU, y se acredita apenas se verifica la transferencia.
- El tarot es una herramienta de acompanamiento y reflexion: no predice el futuro ni garantiza resultados sobre situaciones puntuales.
- Si alguien quiere una lectura mas profunda o en videollamada, se le puede sugerir a la tarotista Pato Escobar (patoescobar.com), que es un servicio aparte del sitio.
- Para usar el sitio hay que entrar a tarotluzyfuerza.com.ar y crear una cuenta con email.

Instrucciones para responder:
- Responde en espanol rioplatense, de forma breve, calida y directa. Maximo 3 o 4 lineas.
- Si preguntan algo que no tiene que ver con el negocio, redirigilos amablemente a que entren al sitio.
- No hagas lecturas de tarot ni tiradas de cartas por WhatsApp: si piden una consulta o una carta del dia, invitalos a hacerla en tarotluzyfuerza.com.ar, donde la primera es gratis.
- No inventes informacion que no este en este contexto. Si no sabes algo puntual, sugeri escribir a soporte por este mismo medio o entrar al sitio.`;

async function generarRespuestaFAQ(env, pregunta) {
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
        max_tokens: 250,
        system: FAQ_CONTEXTO,
        messages: [{ role: "user", content: pregunta.slice(0, 800) }]
      })
    });
    if (!response.ok) {
      const textoErr = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${textoErr.slice(0, 200)}`);
    }
    const data = await response.json();
    const texto = Array.isArray(data.content) ? data.content.map(i => i.text || "").join("") : "";
    return texto || "Gracias por escribirnos. Para mas info entra a tarotluzyfuerza.com.ar 🔮";
  } catch (e) {
    console.error("Error generando respuesta FAQ de WhatsApp:", e.message);
    return "Gracias por tu mensaje. Ahora mismo no puedo responder automaticamente, pero encontras toda la info en tarotluzyfuerza.com.ar 🔮";
  }
}

async function enviarWhatsApp(env, to, texto) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    console.error("Falta WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID, no se puede responder por WhatsApp.");
    return;
  }
  try {
    const resp = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        text: { body: texto }
      })
    });
    if (!resp.ok) {
      const textoErr = await resp.text().catch(() => "");
      console.error("Error enviando mensaje de WhatsApp:", resp.status, textoErr.slice(0, 300));
    }
  } catch (e) {
    console.error("Excepcion enviando mensaje de WhatsApp:", e.message);
  }
}
