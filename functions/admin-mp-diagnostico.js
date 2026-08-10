// Pagina temporal de diagnostico: muestra los ultimos movimientos de la cuenta de
// MercadoPago tal cual los devuelve la API, para poder diseñar bien el cruce automatico
// con los avisos de transferencia (pagos_manuales). Protegida igual que admin-pagos.
const EMAILS_ADMIN = ["bravo.gabriela@gmail.com"];

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const accessToken = body.access_token;
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "no autorizado" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const SUPA_URL = "https://iztuciguijbnpgtlvajy.supabase.co";
    const SUPA_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6dHVjaWd1aWpibnBndGx2YWp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTc5OTEsImV4cCI6MjA5NjU5Mzk5MX0.iRUOebtIXUFKrmoUyBySLuaz0iHLPM8C4uFJkfkGt3U";

    const userResp = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { apikey: SUPA_ANON, Authorization: `Bearer ${accessToken}` }
    });
    if (!userResp.ok) {
      return new Response(JSON.stringify({ error: "sesion invalida" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const usuario = await userResp.json();
    if (!usuario.email || !EMAILS_ADMIN.includes(String(usuario.email).toLowerCase())) {
      return new Response(JSON.stringify({ error: "no autorizado" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    const mpResp = await fetch("https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=20", {
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` }
    });
    const mpData = await mpResp.json();

    return new Response(JSON.stringify({ mp_status: mpResp.status, data: mpData }, null, 2), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: "error interno: " + e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
