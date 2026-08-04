export async function onRequestPost(context) {
  const { request, env } = context;
 
  let body = {};
  try { body = await request.json(); }
  catch (e) {
    return new Response(JSON.stringify({ error: "body invalido" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
 
  const { plan, access_token } = body;
 
  const planes = {
    consulta: { titulo: "Consulta de tarot · 3 cartas", precio: 2500 },
    semanal:  { titulo: "Pack Semanal - Luz y Fuerza", precio: 6000 },
    mensual:  { titulo: "Plan Mensual - Luz y Fuerza", precio: 9000 },
    consejo:  { titulo: "Carta del día", precio: 2000 },
    combo:    { titulo: "Combo Consulta + Carta del día", precio: 3000 }
  };
  const elegido = planes[plan];
  if (!elegido) {
    return new Response(JSON.stringify({ error: "plan invalido" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (!access_token) {
    return new Response(JSON.stringify({ error: "no autenticado" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
 
  const SUPA_URL = "https://iztuciguijbnpgtlvajy.supabase.co";
  const SUPA_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6dHVjaWd1aWpibnBndGx2YWp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTc5OTEsImV4cCI6MjA5NjU5Mzk5MX0.iRUOebtIXUFKrmoUyBySLuaz0iHLPM8C4uFJkfkGt3U";
 
  // Verificar que el access_token sea de una sesion valida de Supabase
  const userResp = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { apikey: SUPA_ANON, Authorization: `Bearer ${access_token}` }
  });
  if (!userResp.ok) {
    return new Response(JSON.stringify({ error: "sesion invalida" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const usuario = await userResp.json();
 
  const SITE = "https://tarotluzyfuerza.com.ar";
 
  const prefResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items: [{ title: elegido.titulo, quantity: 1, unit_price: elegido.precio, currency_id: "ARS" }],
      payer: { email: usuario.email },
      external_reference: `${usuario.id}|${plan}`,
      statement_descriptor: "LUZYFUERZA",
      back_urls: {
        success: `${SITE}/?pago=ok&plan=${plan}`,
        failure: `${SITE}/?pago=fallo`,
        pending: `${SITE}/?pago=pendiente`
      },
      auto_return: "approved",
      notification_url: `${SITE}/mercadopago-webhook`
    })
  });
 
  if (!prefResp.ok) {
    const detalle = await prefResp.text();
    return new Response(JSON.stringify({ error: "error creando preferencia", detalle }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
 
  const pref = await prefResp.json();
  return new Response(JSON.stringify({ init_point: pref.init_point }), { headers: { "Content-Type": "application/json" } });
}
