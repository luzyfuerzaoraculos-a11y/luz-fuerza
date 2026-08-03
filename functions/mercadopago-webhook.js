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
    return new Response("error registrando pago", { status: 500 });
  }

  function diasDelMesActual() {
    const ahora = new Date();
    return new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate();
  }

  const planes = {
    consulta: { creditos: 1, creditos_carta: 0 },
    semanal:  { creditos: 7, creditos_carta: 0 },
    mensual:  { creditos: 0, creditos_carta: diasDelMesActual() },
    consejo:  { creditos: 0, creditos_carta: 1 }
  };
  const add = planes[plan];
  if (!add) return new Response("ok", { status: 200 });

  const perfilResp = await fetch(`${SUPA_URL}/rest/v1/perfiles?id=eq.${userId}&select=creditos,creditos_carta`, {
    headers: headersAdmin
  });
  if (!perfilResp.ok) {
    console.error("Error leyendo perfil para acreditar pago", dataId, userId, perfilResp.status, await perfilResp.text());
    return new Response("error leyendo perfil", { status: 500 });
  }
  const perfilArr = await perfilResp.json();
  if (!Array.isArray(perfilArr) || perfilArr.length === 0) {
    console.error("Perfil no encontrado para acreditar pago", dataId, userId);
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
    console.error("Error acreditando pago", dataId, userId, patchResp.status, await patchResp.text());
    return new Response("error acreditando", { status: 500 });
  }

  return new Response("ok", { status: 200 });

  } catch (e) {
    console.error('EXCEPCION NO ATRAPADA en webhook MP', e && e.message, e && e.stack);
    return new Response(JSON.stringify({ error: 'excepcion', message: (e && e.message) || String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
