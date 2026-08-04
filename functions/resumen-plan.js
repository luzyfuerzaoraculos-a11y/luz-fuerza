export async function onRequestPost(context) {
  const { request, env } = context;
 
  try {
    const { userId } = await request.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: "falta userId" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
 
    const SUPA_URL = "https://iztuciguijbnpgtlvajy.supabase.co";
    const headersAdmin = {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    };
 
    // 1. Buscar la ultima compra de plan semanal o mensual de este usuario
    const pagoResp = await fetch(
      `${SUPA_URL}/rest/v1/pagos_procesados?user_id=eq.${userId}&plan=in.(semanal,mensual)&select=payment_id,plan,created_at&order=created_at.desc&limit=1`,
      { headers: headersAdmin }
    );
    if (!pagoResp.ok) {
      return new Response(JSON.stringify({ ok: false, motivo: "no se pudo leer pagos_procesados" }), { headers: { "Content-Type": "application/json" } });
    }
    const pagos = await pagoResp.json();
    if (!Array.isArray(pagos) || pagos.length === 0) {
      // No tiene un plan semanal/mensual reciente: no corresponde generar resumen
      return new Response(JSON.stringify({ ok: false, motivo: "sin plan semanal/mensual" }), { headers: { "Content-Type": "application/json" } });
    }
    const pago = pagos[0];
 
    // 2. Idempotencia: si ya existe un resumen para este pago, no generar de nuevo
    const yaExisteResp = await fetch(
      `${SUPA_URL}/rest/v1/resumenes_plan?payment_id=eq.${pago.payment_id}&select=id&limit=1`,
      { headers: headersAdmin }
    );
    const yaExiste = yaExisteResp.ok ? await yaExisteResp.json() : [];
    if (Array.isArray(yaExiste) && yaExiste.length > 0) {
      return new Response(JSON.stringify({ ok: false, motivo: "ya generado" }), { headers: { "Content-Type": "application/json" } });
    }
 
    // 3. Traer las tiradas de ese periodo (desde que se compro el plan hasta ahora)
    // Tanto el plan semanal como el mensual entregan consultas completas (3 cartas), una por dia
    const tipoBuscado = "consulta";
    const histResp = await fetch(
      `${SUPA_URL}/rest/v1/historial_consultas?user_id=eq.${userId}&tipo=eq.${tipoBuscado}&created_at=gte.${encodeURIComponent(pago.created_at)}&select=created_at,area,pregunta,cartas,interpretacion&order=created_at.asc`,
      { headers: headersAdmin }
    );
    if (!histResp.ok) {
      return new Response(JSON.stringify({ ok: false, motivo: "no se pudo leer historial" }), { headers: { "Content-Type": "application/json" } });
    }
    const historial = await histResp.json();
    if (!Array.isArray(historial) || historial.length < 2) {
      // Muy pocas tiradas registradas en el periodo, no alcanza para armar una tendencia
      return new Response(JSON.stringify({ ok: false, motivo: "historial insuficiente" }), { headers: { "Content-Type": "application/json" } });
    }
 
    // 4. Armar el detalle compacto para el prompt
    const detalle = historial.map((item, i) => {
      const fecha = new Date(item.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
      const cartasNombres = (item.cartas || []).map(c => c.nombre).filter(Boolean).join(", ");
      return `Día ${i + 1} (${fecha}) - Área: ${item.area || "general"} - Cartas: ${cartasNombres} - Pregunta: "${(item.pregunta || "").slice(0, 80)}"`;
    }).join("\n");
 
    const nombrePlan = pago.plan === "semanal" ? "Pack Semanal (4 consultas)" : "Plan Mensual (8 consultas + carta del día)";
    const prompt = `Tarot Luz & Fuerza. Resumen de tendencia de un ${nombrePlan} ya finalizado. Esta es la secuencia cronológica de tiradas del período:\n${detalle}\n\nBasándote en esta secuencia, escribí un resumen narrativo de cómo fue variando la energía o el camino a lo largo del período, qué patrón o tendencia general se puede leer, y cerralo con un mensaje motivador de cara a lo que sigue. Tono cálido, directo, de vos a vos. Máximo 160 palabras. IMPORTANTE: texto corrido en párrafos nada más, sin título, sin encabezados, sin uso de #, sin asteriscos, sin listas ni viñetas, sin ningún tipo de formato markdown.`;
 
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const claudeData = await claudeResp.json();
    let resumenTexto = claudeData.content ? claudeData.content.map(i => i.text || "").join("") : null;
    if (resumenTexto) {
      resumenTexto = resumenTexto
        .replace(/^#+\s*.*\n+/, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/^\s+|\s+$/g, "");
    }
    if (!resumenTexto) {
      return new Response(JSON.stringify({ ok: false, motivo: "no se pudo generar el resumen" }), { headers: { "Content-Type": "application/json" } });
    }
 
    // 5. Guardar el resumen (idempotente por payment_id via constraint unico)
    const insertResp = await fetch(`${SUPA_URL}/rest/v1/resumenes_plan`, {
      method: "POST",
      headers: { ...headersAdmin, "Prefer": "return=minimal" },
      body: JSON.stringify({ user_id: userId, payment_id: pago.payment_id, plan: pago.plan, resumen: resumenTexto })
    });
    if (insertResp.status === 409) {
      // Otra llamada concurrente ya lo genero primero
      return new Response(JSON.stringify({ ok: false, motivo: "ya generado (concurrente)" }), { headers: { "Content-Type": "application/json" } });
    }
    if (!insertResp.ok) {
      console.error("No se pudo guardar resumen_plan", await insertResp.text());
      return new Response(JSON.stringify({ ok: false, motivo: "no se pudo guardar" }), { headers: { "Content-Type": "application/json" } });
    }
 
    // 6. Mandar el mail con el resumen (best-effort, no bloquea la respuesta)
    try {
      const userResp = await fetch(`${SUPA_URL}/auth/v1/admin/users/${userId}`, { headers: headersAdmin });
      if (userResp.ok) {
        const userData = await userResp.json();
        const email = userData.email;
        if (email && env.RESEND_API_KEY) {
          const nombreResp = await fetch(`${SUPA_URL}/rest/v1/perfiles?id=eq.${userId}&select=nombre`, { headers: headersAdmin });
          const nombreArr = nombreResp.ok ? await nombreResp.json() : [];
          const nombre = (nombreArr[0] && nombreArr[0].nombre) || "";
          const html = construirEmailResumen(nombre, nombrePlan, resumenTexto);
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "Luz & Fuerza <no-reply@tarotluzyfuerza.com.ar>",
              to: [email],
              subject: `Tu camino de este ${pago.plan === "semanal" ? "pack semanal" : "mes"} ✦`,
              html
            })
          });
        }
      }
    } catch (e) {
      console.error("No se pudo enviar mail de resumen de plan", e.message);
    }
 
    return new Response(JSON.stringify({ ok: true, resumen: resumenTexto }), { headers: { "Content-Type": "application/json" } });
 
  } catch (e) {
    console.error("Excepcion en resumen-plan", e.message, e.stack);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
 
function construirEmailResumen(nombre, nombrePlan, resumen) {
  const saludo = nombre ? `Hola ${nombre}` : "Hola";
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#060810;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#060810;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#0d0a1a;border:1px solid #2a1f4a;border-radius:16px;overflow:hidden;">
      <tr><td align="center" style="background-color:#0d0a1a;padding:36px 24px 20px 24px;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;letter-spacing:4px;color:#ffffff;font-weight:600;">LUZ <span style="color:#b28dff;">&amp;</span> FUERZA</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1px;color:#9d8fc7;margin-top:6px;">TU LUZ INTERIOR · LA FUERZA QUE IMPULSA TU CAMINO</div>
      </td></tr>
      <tr><td style="padding:0 32px;"><div style="height:1px;background-color:#2a1f4a;"></div></td></tr>
      <tr><td style="padding:32px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;">
        <div style="font-size:20px;color:#ffffff;font-weight:600;margin-bottom:6px;">${saludo} ✦</div>
        <div style="font-size:13px;color:#9d8fc7;margin-bottom:18px;">Tu ${nombrePlan} llegó a su fin. Esto fue lo que se fue dibujando:</div>
        <div style="font-size:15px;line-height:1.8;color:#c8d8f0;white-space:pre-line;">${resumen}</div>
      </td></tr>
      <tr><td align="center" style="padding:26px 32px 10px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td align="center" style="border-radius:30px;background-color:#7a3ce0;">
            <a href="https://tarotluzyfuerza.com.ar" target="_blank" style="display:inline-block;padding:14px 40px;font-family:Arial,Helvetica,sans-serif;font-size:14px;letter-spacing:1px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:30px;">SEGUIR CONSULTANDO</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td align="center" style="background-color:#080611;padding:20px 24px;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b6480;">
          <a href="https://tarotluzyfuerza.com.ar" style="color:#9d8fc7;text-decoration:none;">tarotluzyfuerza.com.ar</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
