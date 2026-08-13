export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");

  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return new Response(JSON.stringify({ error: "no autorizado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const SUPA_URL = "https://iztuciguijbnpgtlvajy.supabase.co";
  const headersAdmin = {
    "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json"
  };

  // 1. Perfiles sin creditos de ningun tipo (consultas y carta del dia agotadas)
  const perfilesResp = await fetch(
    `${SUPA_URL}/rest/v1/perfiles?creditos=eq.0&creditos_carta=eq.0&select=id,nombre`,
    { headers: headersAdmin }
  );
  if (!perfilesResp.ok) {
    return new Response(JSON.stringify({ error: "no se pudo leer perfiles" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  const perfilesSinCreditos = await perfilesResp.json();

  const ahora = new Date();
  const haceTresDias = new Date(ahora.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const hace21Dias = new Date(ahora.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString();

  let enviados = 0;
  let revisados = 0;
  const detalle = [];

  for (const perfil of perfilesSinCreditos.slice(0, 50)) {
    revisados++;

    // 2. Ultima actividad en historial_consultas: solo avisarle si paso el periodo de gracia (3 dias)
    const histResp = await fetch(
      `${SUPA_URL}/rest/v1/historial_consultas?user_id=eq.${perfil.id}&select=created_at&order=created_at.desc&limit=1`,
      { headers: headersAdmin }
    );
    const hist = histResp.ok ? await histResp.json() : [];
    const ultimaActividad = hist[0] ? hist[0].created_at : null;
    if (ultimaActividad && ultimaActividad > haceTresDias) continue; // todavia muy reciente, no molestar

    // 3. No mandar de nuevo si ya se le envio un mail de reenganche en los ultimos 21 dias
    const yaEnviadoResp = await fetch(
      `${SUPA_URL}/rest/v1/emails_reenganche?user_id=eq.${perfil.id}&enviado_at=gte.${hace21Dias}&select=id&limit=1`,
      { headers: headersAdmin }
    );
    const yaEnviado = yaEnviadoResp.ok ? await yaEnviadoResp.json() : [];
    if (yaEnviado.length > 0) continue;

    // 4. Obtener el email real de auth.users
    const userResp = await fetch(`${SUPA_URL}/auth/v1/admin/users/${perfil.id}`, { headers: headersAdmin });
    if (!userResp.ok) continue;
    const userData = await userResp.json();
    const email = userData.email;
    if (!email) continue;

    // 5. Mandar el mail de reenganche via Resend
    const nombre = perfil.nombre || "";
    const html = construirEmailReenganche(nombre);
    const envioResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Luz & Fuerza <no-reply@tarotluzyfuerza.com.ar>",
        to: [email],
        subject: "El tarot te espera ✦",
        html
      })
    });

    if (envioResp.ok) {
      await fetch(`${SUPA_URL}/rest/v1/emails_reenganche`, {
        method: "POST",
        headers: { ...headersAdmin, "Prefer": "return=minimal" },
        body: JSON.stringify({ user_id: perfil.id })
      });
      enviados++;
      detalle.push({ id: perfil.id, enviado: true });
    } else {
      detalle.push({ id: perfil.id, enviado: false });
    }
  }

  return new Response(JSON.stringify({ revisados, enviados, detalle }), {
    headers: { "Content-Type": "application/json" }
  });
}

function construirEmailReenganche(nombre) {
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
        <div style="font-size:20px;color:#ffffff;font-weight:600;margin-bottom:14px;">${saludo}, las cartas te están esperando ✦</div>
        <div style="font-size:15px;line-height:1.7;color:#c8d8f0;">
          Hace un tiempo que no volvés a consultar. El tarot no tiene apuro, pero si sentís que hay algo dando vueltas en tu cabeza — una decisión, una duda, un cambio — puede ser un buen momento para volver a mirarlo con más claridad.
        </div>
      </td></tr>
      <tr><td align="center" style="padding:26px 32px 10px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td align="center" style="border-radius:30px;background-color:#7a3ce0;">
            <a href="https://tarotluzyfuerza.com.ar" target="_blank" style="display:inline-block;padding:14px 40px;font-family:Arial,Helvetica,sans-serif;font-size:14px;letter-spacing:1px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:30px;">VOLVER A CONSULTAR</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:20px 32px 32px 32px;font-family:Arial,Helvetica,sans-serif;">
        <div style="font-size:12.5px;line-height:1.6;color:#6b6480;border-top:1px solid #2a1f4a;padding-top:16px;">
          Si ya no querés recibir estos recordatorios, respondé este mail y te sacamos de la lista.
        </div>
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
