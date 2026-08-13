async function alertarError(env, asunto, detalle) {
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Luz & Fuerza <no-reply@tarotluzyfuerza.com.ar>",
        to: ["bravo.gabriela@gmail.com"],
        subject: `⚠️ Webhook MercadoPago: ${asunto}`,
        html: `<p>${detalle}</p>`
      })
    });
  } catch (e) {
    console.error("No se pudo enviar alerta de error por mail", e && e.message);
  }
}
 
async function validarFirma(request, dataId, secret) {
  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");
  if (!xSignature || !dataId) return false;
 
  const partes = {};
  xSignature.split(",").forEach(p => {
    const [k, v] = p.split("=");
    if (k && v !== undefined) partes[k.trim()] = v.trim();
  });
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) return false;
 
  const dataIdNormalizado = /^[0-9]+$/.test(dataId) ? dataId : dataId.toLowerCase();
  const manifest = `id:${dataIdNormalizado};request-id:${xRequestId || ""};ts:${ts};`;
 
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(manifest));
  const hex = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, "0")).join("");
 
  return hex === v1;
}
 
export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  try {
 
  let body = {};
  try { body = await request.json(); } catch (e) { /* algunas notificaciones no traen body */ }
 
  const dataId = url.searchParams.get("data.id") || (body.data && body.data.id) || "";
  const type = url.searchParams.get("type") || body.type;
 
  const firmaOk = await validarFirma(request, dataId, env.MP_WEBHOOK_SECRET);
  if (!firmaOk) {
    return new Response("firma invalida", { status: 401 });
  }
 
  if (type !== "payment" || !dataId) {
    return new Response("ok", { status: 200 });
  }
 
  const pagoResp = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` }
  });
  if (!pagoResp.ok) return new Response("ok", { status: 200 });
  const pago = await pagoResp.json();
 
  if (pago.status !== "approved") {
    return new Response("ok", { status: 200 });
  }
 
  const [userId, plan] = (pago.external_reference || "").split("|");
  if (!userId || !plan) return new Response("ok", { status: 200 });
 
  const SUPA_URL = "https://iztuciguijbnpgtlvajy.supabase.co";
  const headersAdmin = {
    "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json"
  };
 
  // Idempotencia: registrar este pago antes de acreditar. Si ya existe (pago repetido
  // por un reintento de MercadoPago), la insercion falla por la clave unica y no acreditamos de nuevo.
  const regResp = await fetch(`${SUPA_URL}/rest/v1/pagos_procesados`, {
    method: "POST",
    headers: { ...headersAdmin, "Prefer": "return=minimal" },
    body: JSON.stringify({ payment_id: String(dataId), user_id: userId, plan })
  });
 
  if (regResp.status === 409) {
    return new Response("ok", { status: 200 });
  }
  if (!regResp.ok) {
    const detalleErr = await regResp.text();
    console.error("Error registrando pago", dataId, userId, regResp.status, detalleErr);
    await alertarError(env, "no se pudo registrar el pago", `Pago ${dataId} de usuario ${userId} (plan ${plan}) no se pudo guardar en pagos_procesados. Status ${regResp.status}: ${detalleErr}`);
    return new Response("error registrando pago", { status: 500 });
  }
 
  const planes = {
    consulta: { creditos: 1, creditos_carta: 0 },
    semanal:  { creditos: 4, creditos_carta: 0 },
    mensual:  { creditos: 8, creditos_carta: 30 },
    consejo:  { creditos: 0, creditos_carta: 1 },
    combo:    { creditos: 1, creditos_carta: 1 },
    // Planes espejo de prueba (precio simbolico), mismos creditos que su version real.
    consulta_test: { creditos: 1, creditos_carta: 0 },
    semanal_test:  { creditos: 4, creditos_carta: 0 },
    mensual_test:  { creditos: 8, creditos_carta: 30 },
    consejo_test:  { creditos: 0, creditos_carta: 1 },
    combo_test:    { creditos: 1, creditos_carta: 1 }
  };
  const add = planes[plan];
  if (!add) return new Response("ok", { status: 200 });
 
  const perfilResp = await fetch(`${SUPA_URL}/rest/v1/perfiles?id=eq.${userId}&select=creditos,creditos_carta`, {
    headers: headersAdmin
  });
  if (!perfilResp.ok) {
    const detalleErr = await perfilResp.text();
    console.error("Error leyendo perfil para acreditar pago", dataId, userId, perfilResp.status, detalleErr);
    await alertarError(env, "no se pudo leer el perfil para acreditar", `Pago ${dataId} de usuario ${userId} (plan ${plan}) aprobado, pero no se pudo leer su perfil. Status ${perfilResp.status}: ${detalleErr}. Hay que acreditarlo a mano.`);
    return new Response("error leyendo perfil", { status: 500 });
  }
  const perfilArr = await perfilResp.json();
  if (!Array.isArray(perfilArr) || perfilArr.length === 0) {
    console.error("Perfil no encontrado para acreditar pago", dataId, userId);
    await alertarError(env, "perfil no encontrado", `Pago ${dataId} de usuario ${userId} (plan ${plan}) aprobado, pero no existe fila en perfiles. Hay que acreditarlo a mano.`);
    return new Response("perfil no encontrado", { status: 500 });
  }
  const actual = perfilArr[0];
 
  const nuevosCreditos = (actual.creditos || 0) + add.creditos;
  const nuevosCreditosCarta = (actual.creditos_carta || 0) + add.creditos_carta;
 
  const patchResp = await fetch(`${SUPA_URL}/rest/v1/perfiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: headersAdmin,
    body: JSON.stringify({ creditos: nuevosCreditos, creditos_carta: nuevosCreditosCarta })
  });
  if (!patchResp.ok) {
    const detalleErr = await patchResp.text();
    console.error("Error acreditando pago", dataId, userId, patchResp.status, detalleErr);
    await alertarError(env, "no se pudo acreditar el pago", `Pago ${dataId} de usuario ${userId} (plan ${plan}) aprobado, pero fallo el PATCH de creditos. Status ${patchResp.status}: ${detalleErr}. Hay que acreditarlo a mano.`);
    return new Response("error acreditando", { status: 500 });
  }
 
  return new Response("ok", { status: 200 });
 
  } catch (e) {
    console.error('Excepcion no atrapada en webhook MP', e && e.message, e && e.stack);
    await alertarError(env, "excepcion no atrapada", `El webhook tiro una excepcion inesperada: ${(e && e.message) || String(e)}. Revisar los logs de Cloudflare para mas detalle.`);
    return new Response('error interno', { status: 500 });
  }
}
