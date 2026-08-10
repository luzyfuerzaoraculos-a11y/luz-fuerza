// Protegido por sesion de Supabase: solo las cuentas listadas en EMAILS_ADMIN pueden usar esto.
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
      const id = body.id;
      const filaResp = await fetch(`${SUPA_URL}/rest/v1/pagos_manuales?id=eq.${id}&select=*`, { headers: headersAdmin });
      if (!filaResp.ok) return new Response(JSON.stringify({ error: "no se pudo leer el pago" }), { status: 500, headers: { "Content-Type": "application/json" } });
      const filas = await filaResp.json();
      if (!Array.isArray(filas) || filas.length === 0) return new Response(JSON.stringify({ error: "pago no encontrado" }), { status: 404, headers: { "Content-Type": "application/json" } });
      const fila = filas[0];
      if (fila.estado === "acreditado") {
        return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
      }

      const planes = {
        consulta: { creditos: 1, creditos_carta: 0 },
        semanal: { creditos: 4, creditos_carta: 0 },
        mensual: { creditos: 8, creditos_carta: 30 },
        consejo: { creditos: 0, creditos_carta: 1 },
        combo: { creditos: 1, creditos_carta: 1 }
      };
      const add = planes[fila.plan];
      if (!add) return new Response(JSON.stringify({ error: "plan invalido" }), { status: 400, headers: { "Content-Type": "application/json" } });

      const perfilResp = await fetch(`${SUPA_URL}/rest/v1/perfiles?id=eq.${fila.user_id}&select=creditos,creditos_carta`, { headers: headersAdmin });
      if (!perfilResp.ok) return new Response(JSON.stringify({ error: "no se pudo leer el perfil" }), { status: 500, headers: { "Content-Type": "application/json" } });
      const perfilArr = await perfilResp.json();
      if (!Array.isArray(perfilArr) || perfilArr.length === 0) return new Response(JSON.stringify({ error: "perfil no encontrado" }), { status: 404, headers: { "Content-Type": "application/json" } });
      const actual = perfilArr[0];
      const nuevosCreditos = (actual.creditos || 0) + add.creditos;
      const nuevosCreditosCarta = (actual.creditos_carta || 0) + add.creditos_carta;

      const patchResp = await fetch(`${SUPA_URL}/rest/v1/perfiles?id=eq.${fila.user_id}`, {
        method: "PATCH",
        headers: headersAdmin,
        body: JSON.stringify({ creditos: nuevosCreditos, creditos_carta: nuevosCreditosCarta })
      });
      if (!patchResp.ok) return new Response(JSON.stringify({ error: "no se pudo acreditar los creditos" }), { status: 500, headers: { "Content-Type": "application/json" } });

      await fetch(`${SUPA_URL}/rest/v1/pagos_manuales?id=eq.${id}`, {
        method: "PATCH",
        headers: headersAdmin,
        body: JSON.stringify({ estado: "acreditado", acreditado_at: new Date().toISOString() })
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

      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "accion invalida" }), { status: 400, headers: { "Content-Type": "application/json" } });

  } catch (e) {
    console.error("Excepcion en admin-pagos-manuales:", e.message);
    return new Response(JSON.stringify({ error: "error interno" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
