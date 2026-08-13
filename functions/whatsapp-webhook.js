const SUPA_URL = "https://iztuciguijbnpgtlvajy.supabase.co";

const PLANES = {
  consulta: { creditos: 1, creditos_carta: 0 },
  semanal: { creditos: 4, creditos_carta: 0 },
  mensual: { creditos: 8, creditos_carta: 30 },
  consejo: { creditos: 0, creditos_carta: 1 },
  combo: { creditos: 1, creditos_carta: 1 }
};

const REGEX_PAGO = /\b(transfer\w*|deposit\w*|ya pagu\w*|hice el pago|mande el pago|mand[ée] el pago|comprobante|ya envi[eé]|acredit\w*)\b/i;
const REGEX_EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

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
    if (!from) return new Response("OK", { status: 200 });

    const textoUsuario = message.text && message.text.body ? message.text.body.trim() : "";
    const media = message.image || message.document || null;
    const esArchivo = !!media;

    if (!textoUsuario && !esArchivo) {
      return new Response("OK", { status: 200 });
    }

    const respuesta = await procesarMensaje(env, from, textoUsuario, media);
    await enviarWhatsApp(env, from, respuesta);

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("Error en whatsapp-webhook:", e.message);
    // Siempre devolvemos 200: si devolvemos error, Meta reintenta el mismo mensaje en loop.
    return new Response("OK", { status: 200 });
  }
}

// ---------- Logica principal de la conversacion ----------

async function procesarMensaje(env, from, texto, media) {
  try {
    const vinculo = await leerVinculo(env, from);
    const estado = await leerEstado(env, from);

    // --- Flujo de vinculacion en curso ---
    if (estado && estado.paso === "esperando_codigo") {
      return await manejarCodigo(env, from, texto);
    }
    if (estado && estado.paso === "esperando_email") {
      return await manejarEmail(env, from, texto);
    }

    // --- Sin vincular todavia ---
    if (!vinculo) {
      if (REGEX_PAGO.test(texto)) {
        await guardarEstado(env, from, "esperando_email", {});
        return "Para poder acreditarte el pago primero necesito vincular tu cuenta. Pasame el mail con el que te registraste en tarotluzyfuerza.com.ar 📧";
      }
      return await generarRespuestaFAQ(env, texto || "Hola");
    }

    // --- Ya vinculada: flujo de pago pendiente ---
    if (estado && estado.paso === "esperando_monto") {
      return await manejarMonto(env, from, vinculo.user_id, texto, estado.datos || {});
    }
    if (estado && estado.paso === "esperando_comprobante") {
      return await manejarComprobante(env, from, vinculo.user_id, media, estado.datos || {});
    }

    // Foto mandada sin haber avisado antes: la tratamos como comprobante si hay un solo pago pendiente.
    if (media) {
      return await manejarFotoEspontanea(env, from, vinculo.user_id, media);
    }

    if (REGEX_PAGO.test(texto)) {
      return await iniciarAvisoDePago(env, from, vinculo.user_id);
    }

    return await generarRespuestaFAQ(env, texto || "Hola");
  } catch (e) {
    console.error("Error procesando mensaje de WhatsApp:", e.message);
    return "Uy, tuve un problema procesando tu mensaje. Probá de nuevo en un rato, o escribinos y lo vemos a mano.";
  }
}

async function manejarEmail(env, from, texto) {
  const match = texto.match(REGEX_EMAIL);
  if (!match) {
    return "Necesito el mail con el que te registraste en tarotluzyfuerza.com.ar para poder vincular tu WhatsApp.";
  }
  const email = match[0].toLowerCase();
  const userId = await buscarUserIdPorEmail(env, email);
  if (!userId) {
    return "No encontré ninguna cuenta con ese mail. Revisá que sea el mismo con el que te registraste en el sitio, o entrá a tarotluzyfuerza.com.ar para crear una cuenta.";
  }

  const codigo = generarCodigo();
  const codigoExpira = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await fetch(`${SUPA_URL}/rest/v1/whatsapp_vinculos`, {
    method: "POST",
    headers: supaHeaders(env),
    body: JSON.stringify({ user_id: userId, telefono: from, codigo, codigo_expira: codigoExpira, verificado: false })
  });
  await enviarCodigoPorMail(env, email, codigo);
  await guardarEstado(env, from, "esperando_codigo", { email });

  return "Te mandamos un código a tu mail ✉️ Pasámelo acá para confirmar la vinculación (vale por 10 minutos).";
}

async function manejarCodigo(env, from, texto) {
  const codigoIngresado = (texto || "").replace(/\D/g, "");
  if (codigoIngresado.length !== 6) {
    return "Mandame el código de 6 dígitos que te llegó por mail.";
  }

  const r = await fetch(
    `${SUPA_URL}/rest/v1/whatsapp_vinculos?telefono=eq.${encodeURIComponent(from)}&codigo=eq.${codigoIngresado}&verificado=eq.false&select=*&order=created_at.desc&limit=1`,
    { headers: supaHeaders(env) }
  );
  const arr = r.ok ? await r.json() : [];
  const fila = Array.isArray(arr) && arr.length ? arr[0] : null;

  if (!fila || !fila.codigo_expira || new Date(fila.codigo_expira) < new Date()) {
    return "Ese código no es válido o ya venció. Mandame de nuevo tu mail para pedir uno nuevo.";
  }

  await fetch(`${SUPA_URL}/rest/v1/whatsapp_vinculos?id=eq.${fila.id}`, {
    method: "PATCH",
    headers: supaHeaders(env),
    body: JSON.stringify({ verificado: true })
  });
  await borrarEstado(env, from);

  return "¡Listo! Tu WhatsApp quedó vinculado a tu cuenta ✦ Ahora, si me mandás el comprobante de una transferencia, te acredito el pago al toque.";
}

async function iniciarAvisoDePago(env, from, userId) {
  const pendientes = await buscarPagosPendientes(env, userId);
  if (pendientes.length === 0) {
    return "No tengo ningún pago pendiente registrado a tu nombre. Si todavía no lo avisaste, entrá a tarotluzyfuerza.com.ar, elegí \"Transferencia\" y dejalo anotado — después mandame el comprobante acá.";
  }
  if (pendientes.length === 1) {
    await guardarEstado(env, from, "esperando_comprobante", { pago_id: pendientes[0].id, monto: pendientes[0].monto });
    return `Dale, mandame la foto del comprobante de tu transferencia de $${pendientes[0].monto}.`;
  }
  await guardarEstado(env, from, "esperando_monto", {});
  return "Tenés más de un pago pendiente. Decime el monto que transferiste para identificar cuál es.";
}

async function manejarMonto(env, from, userId, texto, datosPrevios) {
  const soloNumeros = (texto || "").replace(/[.,]/g, "");
  const match = soloNumeros.match(/\d{3,7}/);
  const monto = match ? parseInt(match[0], 10) : null;
  if (!monto) {
    return "Decime el monto que transferiste (por ejemplo: 6000).";
  }

  const pendientes = await buscarPagosPendientes(env, userId);
  const coincide = pendientes.filter(p => Number(p.monto) === monto);
  if (coincide.length === 0) {
    return `No encuentro un pago pendiente por $${monto} en tu cuenta. Si crees que es un error, escribinos y lo revisamos a mano.`;
  }
  const pago = coincide[0];

  // Si ya nos habian mandado la foto antes de saber el monto, la procesamos directo.
  if (datosPrevios.mediaId) {
    return await acreditarConMedia(env, from, { id: pago.id, plan: pago.plan, user_id: userId, email: pago.email }, {
      id: datosPrevios.mediaId,
      mime_type: datosPrevios.mimeType
    });
  }

  await guardarEstado(env, from, "esperando_comprobante", { pago_id: pago.id, monto: pago.monto });
  return `Perfecto, ahora mandame la foto del comprobante de esa transferencia de $${pago.monto}.`;
}

async function manejarComprobante(env, from, userId, media, datos) {
  if (!media) {
    return "Necesito la foto (o PDF) del comprobante para poder acreditarte el pago. Mandalo cuando puedas.";
  }
  if (!datos.pago_id) {
    await borrarEstado(env, from);
    return "Se me perdió el hilo, contame de nuevo: ¿qué monto transferiste?";
  }

  const filaResp = await fetch(`${SUPA_URL}/rest/v1/pagos_manuales?id=eq.${datos.pago_id}&select=*`, { headers: supaHeaders(env) });
  const filaArr = filaResp.ok ? await filaResp.json() : [];
  const fila = Array.isArray(filaArr) && filaArr.length ? filaArr[0] : null;
  if (!fila || fila.user_id !== userId) {
    await borrarEstado(env, from);
    return "No encuentro ese pago pendiente. Escribinos y lo revisamos a mano.";
  }

  return await acreditarConMedia(env, from, fila, media);
}

async function manejarFotoEspontanea(env, from, userId, media) {
  const pendientes = await buscarPagosPendientes(env, userId);
  if (pendientes.length === 0) {
    return "Recibí la imagen, pero no tengo ningún pago pendiente registrado a tu nombre. Si todavía no lo avisaste, entrá a tarotluzyfuerza.com.ar y dejalo anotado en \"Transferencia\".";
  }
  if (pendientes.length > 1) {
    await guardarEstado(env, from, "esperando_monto", { mediaId: media.id, mimeType: media.mime_type });
    return "Recibí el comprobante, pero tenés más de un pago pendiente. Decime el monto que transferiste para saber cuál es.";
  }
  return await acreditarConMedia(env, from, { id: pendientes[0].id, plan: pendientes[0].plan, user_id: userId, email: pendientes[0].email }, media);
}

async function acreditarConMedia(env, from, fila, media) {
  try {
    const { bytes, mimeType } = await descargarMediaWhatsApp(env, media.id);
    const comprobantePath = await subirComprobante(env, bytes, media.mime_type || mimeType, from);
    const resultado = await acreditarPagoWhatsApp(env, fila, comprobantePath);
    await borrarEstado(env, from);
    if (!resultado.ok) {
      return "Recibí el comprobante pero hubo un problema acreditando el pago. Escribinos y lo resolvemos a mano.";
    }
    return "¡Listo! Ya acredité tu pago y activé tu plan. Entrá a tarotluzyfuerza.com.ar cuando quieras 🔮";
  } catch (e) {
    console.error("Error acreditando pago con comprobante de WhatsApp:", e.message);
    return "Recibí el comprobante pero no pude procesarlo. Escribinos y lo revisamos a mano.";
  }
}

async function buscarPagosPendientes(env, userId) {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/pagos_manuales?user_id=eq.${userId}&estado=eq.pendiente&select=*&order=created_at.desc`,
    { headers: supaHeaders(env) }
  );
  if (!r.ok) return [];
  const arr = await r.json();
  return Array.isArray(arr) ? arr : [];
}

// ---------- Helpers de Supabase (tabla whatsapp_vinculos / whatsapp_estado) ----------

function supaHeaders(env) {
  return {
    "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json"
  };
}

async function leerVinculo(env, telefono) {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/whatsapp_vinculos?telefono=eq.${encodeURIComponent(telefono)}&verificado=eq.true&select=user_id&limit=1`,
    { headers: supaHeaders(env) }
  );
  if (!r.ok) return null;
  const arr = await r.json();
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

async function leerEstado(env, telefono) {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/whatsapp_estado?telefono=eq.${encodeURIComponent(telefono)}&select=*`,
    { headers: supaHeaders(env) }
  );
  if (!r.ok) return null;
  const arr = await r.json();
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

async function guardarEstado(env, telefono, paso, datos) {
  await fetch(`${SUPA_URL}/rest/v1/whatsapp_estado`, {
    method: "POST",
    headers: { ...supaHeaders(env), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ telefono, paso, datos: datos || {}, actualizado_at: new Date().toISOString() })
  });
}

async function borrarEstado(env, telefono) {
  await fetch(`${SUPA_URL}/rest/v1/whatsapp_estado?telefono=eq.${encodeURIComponent(telefono)}`, {
    method: "DELETE",
    headers: supaHeaders(env)
  });
}

async function buscarUserIdPorEmail(env, email) {
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/whatsapp_buscar_user_id`, {
    method: "POST",
    headers: supaHeaders(env),
    body: JSON.stringify({ p_email: email })
  });
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  return data || null;
}

function generarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function enviarCodigoPorMail(env, email, codigo) {
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Luz & Fuerza <no-reply@tarotluzyfuerza.com.ar>",
        to: [email],
        subject: "Tu código para vincular WhatsApp",
        html: `<p>Tu código para vincular tu WhatsApp con tu cuenta de Luz & Fuerza es:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${codigo}</p><p>Vale por 10 minutos. Si no lo pediste vos, ignorá este mail.</p>`
      })
    });
  } catch (e) {
    console.error("No se pudo enviar el mail con el codigo de vinculacion:", e.message);
  }
}

// ---------- Helpers de medios (comprobantes) ----------

async function descargarMediaWhatsApp(env, mediaId) {
  const metaResp = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` }
  });
  if (!metaResp.ok) throw new Error(`No se pudo obtener metadata de media ${mediaId}`);
  const meta = await metaResp.json();
  const fileResp = await fetch(meta.url, { headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` } });
  if (!fileResp.ok) throw new Error(`No se pudo descargar el archivo de media ${mediaId}`);
  const bytes = await fileResp.arrayBuffer();
  return { bytes, mimeType: meta.mime_type || "image/jpeg" };
}

async function subirComprobante(env, bytes, mimeType, telefono) {
  const ext = mimeType.includes("png") ? "png" : mimeType.includes("pdf") ? "pdf" : "jpg";
  const nombre = `${telefono}-${Date.now()}.${ext}`;
  const resp = await fetch(`${SUPA_URL}/storage/v1/object/comprobantes/${nombre}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": mimeType
    },
    body: bytes
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`No se pudo subir el comprobante: ${resp.status} ${t.slice(0, 200)}`);
  }
  return nombre;
}

// ---------- Acreditacion del pago (misma logica que admin-pagos-manuales.js) ----------

async function acreditarPagoWhatsApp(env, fila, comprobantePath) {
  if (fila.estado === "acreditado") return { ok: true };

  const add = PLANES[fila.plan];
  if (!add) return { ok: false, error: "plan invalido" };

  const headersAdmin = supaHeaders(env);
  const perfilResp = await fetch(`${SUPA_URL}/rest/v1/perfiles?id=eq.${fila.user_id}&select=creditos,creditos_carta`, { headers: headersAdmin });
  if (!perfilResp.ok) return { ok: false, error: "no se pudo leer el perfil" };
  const perfilArr = await perfilResp.json();
  if (!Array.isArray(perfilArr) || perfilArr.length === 0) return { ok: false, error: "perfil no encontrado" };
  const actual = perfilArr[0];
  const nuevosCreditos = (actual.creditos || 0) + add.creditos;
  const nuevosCreditosCarta = (actual.creditos_carta || 0) + add.creditos_carta;

  const patchResp = await fetch(`${SUPA_URL}/rest/v1/perfiles?id=eq.${fila.user_id}`, {
    method: "PATCH",
    headers: headersAdmin,
    body: JSON.stringify({ creditos: nuevosCreditos, creditos_carta: nuevosCreditosCarta })
  });
  if (!patchResp.ok) return { ok: false, error: "no se pudo acreditar los creditos" };

  await fetch(`${SUPA_URL}/rest/v1/pagos_manuales?id=eq.${fila.id}`, {
    method: "PATCH",
    headers: headersAdmin,
    body: JSON.stringify({
      estado: "acreditado",
      acreditado_at: new Date().toISOString(),
      acreditado_via: "whatsapp_bot",
      comprobante_url: comprobantePath
    })
  });

  if (fila.email && env.RESEND_API_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Luz & Fuerza <no-reply@tarotluzyfuerza.com.ar>",
          to: [fila.email],
          subject: "Tu pago ya se acreditó ✦",
          html: `<p>¡Hola! Confirmamos tu pago por transferencia (avisado por WhatsApp) y ya activamos tu plan. Entrá a tarotluzyfuerza.com.ar cuando quieras.</p>`
        })
      });
    } catch (e) {
      console.error("No se pudo enviar mail de confirmacion de pago:", e.message);
    }
  }

  return { ok: true };
}

// ---------- FAQ (Claude Haiku) ----------

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
