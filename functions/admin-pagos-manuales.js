// Protegido por sesion de Supabase: solo las cuentas listadas en EMAILS_ADMIN pueden usar esto.
const EMAILS_ADMIN = ["bravo.gabriela@gmail.com"];
const SUPA_URL = "https://iztuciguijbnpgtlvajy.supabase.co";
const PLANES = {
  consulta: { creditos: 1, creditos_carta: 0 },
  semanal: { creditos: 4, creditos_carta: 0 },
  mensual: { creditos: 8, creditos_carta: 30 },
  consejo: { creditos: 0, creditos_carta: 1 },
  combo: { creditos: 1, creditos_carta: 1 }
};

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const accessToken = body.access_token;
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "no autorizado" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const SUPA_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6dHVjaWd1aWpibnBndGx2YWp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTc5OTEsImV4cCI6MjA5NjU5Mzk5MX0.iRUOebtIXUFKrmoUyBySLuaz0iHLPM8C4uFJkfkGt3U";

    // Verificar que el access_token sea de una sesion valida de Supabase, y que sea una cuenta admin
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

    const headersAdmin = {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    };

    if (body.accion === "listar") {
      const r = await fetch(`${SUPA_URL}/rest/v1/pagos_manuales?estado=eq.pendiente&select=id,user_id,email,plan,monto,created_at&order=created_at.asc`, { headers: headersAdmin });
      const pagos = r.ok ? await r.json() : [];
      return new Response(JSON.stringify({ pagos }), { headers: { "Content-Type": "application/json" } });
    }

    if (body.accion === "acreditar") {
      const filaResp = await fetch(`${SUPA_URL}/rest/v1/pagos_manuales?id=eq.${body.id}&select=*`, { headers: headersAdmin });
      if (!filaResp.ok) return new Response(JSON.stringify({ error: "no se pudo leer el pago" }), { status: 500, headers: { "Content-Type": "application/json" } });
      const filas = await filaResp.json();
      if (!Array.isArray(filas) || filas.length === 0) return new Response(JSON.stringify({ error: "pago no encontrado" }), { status: 404, headers: { "Content-Type": "application/json" } });
      const resultado = await acreditarPago(env, headersAdmin, filas[0], null);
      if (!resultado.ok) return new Response(JSON.stringify({ error: resultado.error }), { status: 500, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }

    if (body.accion === "verificar") {
      const pendResp = await fetch(`${SUPA_URL}/rest/v1/pagos_manuales?estado=eq.pendiente&select=*`, { headers: headersAdmin });
      const pendientes = pendResp.ok ? await pendResp.json() : [];
      if (!Array.isArray(pendientes) || pendientes.length === 0) {
        return new Response(JSON.stringify({ ok: true, acreditados: [], ambiguos: [], mensaje: "No hay avisos pendientes." }), { headers: { "Content-Type": "application/json" } });
      }

      const mpResp = await fetch("https://api.mercadopago.com/v1/payments/search?sort=date_approved&criteria=desc&limit=50", {
        headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` }
      });
      if (!mpResp.ok) {
        return new Response(JSON.stringify({ error: "no se pudo consultar MercadoPago" }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
      const mpData = await mpResp.json();
      const transferencias = (mpData.results || []).filter(function (p) {
        return p.operation_type === "account_fund" && p.status === "approved";
      });

      const usadasResp = await fetch(`${SUPA_URL}/rest/v1/pagos_manuales?mp_payment_id=not.is.null&select=mp_payment_id`, { headers: headersAdmin });
      const usadasArr = usadasResp.ok ? await usadasResp.json() : [];
      const usadasSet = new Set(usadasArr.map(function (u) { return String(u.mp_payment_id); }));

      let disponibles = transferencias.filter(function (t) { return !usadasSet.has(String(t.id)); });

      const acreditados = [];
      const ambiguos = [];

      for (const pago of pendientes) {
        const candidatos = disponibles.filter(function (t) {
          return Number(t.transaction_amount) === Number(pago.monto);
        });
        if (candidatos.length === 1) {
          const transferencia = candidatos[0];
          const resultado = await acreditarPago(env, headersAdmin, pago, transferencia.id);
          if (resultado.ok) {
            acreditados.push({ id: pago.id, email: pago.email, plan: pago.plan, monto: pago.monto, mp_payment_id: transferencia.id });
            disponibles = disponibles.filter(function (t) { return t.id !== transferencia.id; });
          }
        } else if (candidatos.length > 1) {
          ambiguos.push({ id: pago.id, email: pago.email, plan: pago.plan, monto: pago.monto, coincidencias: candidatos.length });
        }
      }

      return new Response(JSON.stringify({ ok: true, acreditados, ambiguos, transferencias_revisadas: transferencias.length }), { headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "accion invalida" }), { status: 400, headers: { "Content-Type": "application/json" } });

  } catch (e) {
    console.error("Excepcion en admin-pagos-manuales:", e.message);
    return new Response(JSON.stringify({ error: "error interno: " + e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

// Acredita un pago manual: suma los creditos al perfil, marca el aviso como acreditado
// (guardando el id del pago de MercadoPago si vino de un cruce automatico) y avisa por mail.
async function acreditarPago(env, headersAdmin, fila, mpPaymentId) {
  if (fila.estado === "acreditado") return { ok: true };

  const add = PLANES[fila.plan];
  if (!add) return { ok: false, error: "plan invalido" };

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

  const patchAviso = { estado: "acreditado", acreditado_at: new Date().toISOString() };
  if (mpPaymentId) patchAviso.mp_payment_id = String(mpPaymentId);
  await fetch(`${SUPA_URL}/rest/v1/pagos_manuales?id=eq.${fila.id}`, {
    method: "PATCH",
    headers: headersAdmin,
    body: JSON.stringify(patchAviso)
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
          html: `<p>¡Hola! Confirmamos tu pago por transferencia y ya activamos tu plan. Entrá a tarotluzyfuerza.com.ar cuando quieras.</p>`
        })
      });
    } catch (e) {
      console.error("No se pudo enviar mail de confirmacion de pago manual:", e.message);
    }
  }

  return { ok: true };
}
