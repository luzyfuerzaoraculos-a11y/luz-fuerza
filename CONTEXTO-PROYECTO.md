# Luz & Fuerza · Contexto completo del proyecto

Este documento es para darle contexto a una sesión nueva de Claude (por ejemplo, la extensión de Anthropic en VS Code) sobre todo lo que se hizo, cómo está armado el proyecto, qué falta y qué está planeado. Está pensado para pegarlo entero al arrancar una conversación nueva, o para que Claude lo lea directamente si trabaja sobre esta carpeta.

## Qué es Luz & Fuerza

Plataforma de tarot online con interpretación por inteligencia artificial. Sitio en producción: **tarotluzyfuerza.com.ar**. El negocio ofrece tiradas de tarot de 3 cartas (pasado, presente, futuro) y una carta del día, con interpretación personalizada generada por IA en cada consulta. La primera consulta completa y la primera carta del día son gratis, sin pedir tarjeta.

## Arquitectura general

El sitio es una aplicación web estática con funciones serverless, sin backend propio ni base de datos propia: todo corre sobre servicios externos.

- **Hosting y funciones serverless:** Cloudflare Pages. El sitio (`index.html` y páginas admin) se sirve como archivos estáticos, y la carpeta `functions/` contiene funciones tipo Cloudflare Pages Functions (una por endpoint, en JavaScript con `export async function onRequestPost/onRequestGet`).
- **Base de datos, autenticación y storage:** Supabase (Postgres + Auth + Storage). URL del proyecto: `https://iztuciguijbnpgtlvajy.supabase.co`.
- **Pagos con tarjeta:** MercadoPago (checkout con preferencias, webhook de confirmación).
- **Pagos por transferencia:** flujo manual, la persona avisa desde el sitio y se concilia contra pagos de MercadoPago o se acredita a mano (o automáticamente vía WhatsApp, ver más abajo).
- **Mails transaccionales:** Resend (código de vinculación de WhatsApp, confirmación de pago, resumen de tendencia al finalizar un plan, reenganche a inactivos).
- **IA de las lecturas:** API de Anthropic (Claude), modelo `claude-haiku-4-5-20251001`, tanto para la interpretación de las consultas como para el bot de WhatsApp.
- **Bot de WhatsApp:** Meta WhatsApp Cloud API (webhook propio en `functions/whatsapp-webhook.js`).
- **Repositorio:** Git, pusheado a GitHub. El push tiene que hacerse desde la computadora de Gaby: el entorno donde corre Claude (Cowork) no tiene las credenciales de GitHub, así que los commits quedan hechos localmente pero el push final siempre lo hace ella a mano.
- **Despliegue:** Cloudflare Pages hace auto-deploy cuando se pushea a `master`.

## Carpetas relacionadas al proyecto

- **`luz-fuerza`** (esta carpeta): el sitio real, en producción. Todo el trabajo del día a día pasa acá.
- **`nueva-luz-fuerza`** y **`new-luz-y-fuerza`**: dos proyectos Next.js separados, exploratorios, NO están en producción. Son prototipos de una posible evolución del sitio hacia un flujo más conversacional (páginas `/consulta`, `/conversacion`, `/tirada`, `/interpretacion` con un paso a paso tipo wizard) y una posible identidad visual nueva (marfil, dorado, lavanda, en vez del violeta/negro actual). Sirven como referencia de diseño, no como código a mantener.
- Existe también una conversación larga con ChatGPT (compartida por Gaby) sobre crear un mazo de tarot propio y original para la marca (no basado en Rider-Waite), con las 78 cartas fichadas individualmente (concepto, elemento, palabras clave, sombras, relaciones entre cartas) para que la IA interprete desde ese material en vez de generar todo de cero. Es una idea a futuro, todavía no arrancada.

## Estructura del sitio en producción (`luz-fuerza/`)

```
luz-fuerza/
├── index.html                    # Sitio completo: landing, auth, consulta, carta del dia, planes, historial
├── reset.html                    # Reseteo de contraseña
├── admin-pagos.html              # Panel admin: revisar y acreditar pagos manuales por transferencia
├── admin-mp-diagnostico.html     # Panel admin: diagnóstico de pagos de MercadoPago
├── CLAUDE.md                     # Preferencias de Gaby y proceso de trabajo (leer siempre primero)
├── CONTEXTO-PROYECTO.md          # Este documento
├── functions/
│   ├── consultar.js              # Genera la interpretación de la tirada de 3 cartas (llama a Claude)
│   ├── crear-preferencia.js      # Crea la preferencia de pago en MercadoPago
│   ├── mercadopago-webhook.js    # Recibe la confirmación de pago de MercadoPago y acredita créditos
│   ├── admin-pagos-manuales.js   # Backend del panel admin de pagos manuales (listar, acreditar, verificar contra MP)
│   ├── admin-mp-diagnostico.js   # Backend del panel de diagnóstico de MercadoPago
│   ├── whatsapp-webhook.js       # Bot de WhatsApp (FAQ, vinculación de cuenta, acreditar pagos por comprobante)
│   ├── reenganche-check.js       # Cron: manda mail a personas sin créditos hace 3/21 días para reenganchar
│   └── resumen-plan.js           # Genera resumen de tendencia por mail al terminar un plan semanal/mensual
├── Imagenes/                     # Ilustraciones de las 78 cartas del mazo
└── luz-fuerza-updates/           # Prompts sueltos ya aplicados y textos de referencia (no es código activo)
```

## Base de datos (Supabase)

Tablas existentes:

- **`perfiles`**: 1 a 1 con `auth.users`. Campos: nombre, pronombre, fecha/hora/ciudad/país de nacimiento, `creditos` (consultas de 3 cartas), `creditos_carta` (cartas del día).
- **`historial_consultas`**: registro de cada consulta o carta del día (tipo, área, pregunta, cartas, interpretación, fecha).
- **`pagos_procesados`**: pagos confirmados automáticamente por el webhook de MercadoPago.
- **`pagos_manuales`**: avisos de pago por transferencia (email, plan, monto, estado pendiente/acreditado, y ahora también `comprobante_url` y `acreditado_via` para los acreditados vía WhatsApp).
- **`errores_consultas`**: log de errores al generar una interpretación (para poder auditar fallos de la IA).
- **`uso_tokens`**: tokens de entrada/salida de cada llamada a Claude, para monitorear el gasto de la API.
- **`resumenes_plan`**: resúmenes de tendencia generados al finalizar un plan semanal/mensual (para no duplicar el envío).

Tablas y funciones pendientes de crear (el SQL ya está escrito, falta correrlo en el SQL Editor de Supabase, ver tarea 42):

- **`whatsapp_vinculos`**: vincula un número de WhatsApp verificado con una cuenta (`user_id`, `telefono`, código de verificación con expiración).
- **`whatsapp_estado`**: estado de la conversación en curso del bot de WhatsApp por número de teléfono (para manejar flujos de varios mensajes).
- **Función `whatsapp_buscar_user_id(p_email)`**: RPC que busca el `user_id` de una cuenta por mail sin exponer `auth.users` por REST.
- **Bucket de Storage `comprobantes`**: privado, para guardar las fotos de comprobante de transferencia que manda la gente por WhatsApp.

## Variables de entorno / secretos

Configuradas en Cloudflare Pages (Settings → Environment Variables), no viven en el código ni en este documento:

`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `RESEND_API_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `CRON_SECRET`.

La URL de Supabase y la anon key (pública, no es secreta) están hardcodeadas en el código porque están pensadas para exponerse del lado del cliente, es el diseño normal de Supabase.

Nota de seguridad pendiente: el archivo `Luz y Fuerza.txt` en la raíz del proyecto tiene claves reales expuestas en texto plano. Está identificado como pendiente de rotar esas claves (tarea 22), no se debe compartir ni pushear ese archivo tal cual está.

## Modelo de negocio y planes

| Plan | Precio (ARS) | Incluye |
|---|---|---|
| Consulta individual | $2.500 | 1 consulta de tarot completa (3 cartas) |
| Pack Semanal | $6.000/mes | 4 consultas (1 por semana) + resumen mensual por mail |
| Plan Mensual | $9.000/mes | 8 consultas (2 por semana) + carta del día diaria + resumen mensual |
| Carta del día | $2.000 | 1 carta del día individual |
| Combo | $3.000 | 1 consulta + 1 carta del día |

Existen versiones "_test" de cada plan con precio simbólico ($100) para probar el flujo de pago sin gastar de verdad.

## Funcionalidades ya construidas

- Registro e inicio de sesión con Supabase Auth, reseteo de contraseña.
- Consulta de tarot de 3 cartas (pasado/presente/futuro) con interpretación generada por IA, con reintento automático si falla la llamada a Claude.
- Carta del día: una carta al azar del mazo de 78, instantánea (sin pasos conversacionales, a propósito).
- Control de créditos del lado del servidor (no se puede consumir sin crédito real, ni auto-otorgarse créditos vía RLS).
- Historial de consultas y cartas pasadas, con contexto de consultas previas relacionadas para darle continuidad a la IA.
- Detección de preguntas cerradas (sí/no) y pedido de más contexto antes de tirar (hoy vía modal, identificado como algo a rediseñar, ver más abajo).
- Adecuación dinámica de género en los textos según el pronombre elegido en el registro.
- Pago con MercadoPago (checkout + webhook de confirmación automática).
- Pago manual por transferencia/alias, con panel admin para conciliar contra los movimientos de MercadoPago o acreditar a mano.
- Mail de reenganche automático a quienes se quedaron sin créditos.
- Resumen de tendencia del mes por mail al terminar un plan semanal/mensual.
- Auditoría y ajustes de mobile (cartas, botones, scroll).
- Animación de mezcla de cartas (riffle shuffle + apertura en abanico) al tocar "Mezclar las cartas" en Carta del día.
- Disclaimer de no predicción del futuro en varios puntos del sitio.

## Bot de WhatsApp

Vive en `functions/whatsapp-webhook.js`. Hoy responde preguntas frecuentes usando Claude Haiku con un contexto fijo del negocio. Ya está programado (pendiente de terminar de desplegar, ver "Qué falta"):

- Vinculación de cuenta: la persona manda su mail, se le manda un código de 6 dígitos por mail, lo confirma por WhatsApp y su número queda asociado a su cuenta.
- Acreditación de pagos por transferencia: una vez vinculada, si manda foto del comprobante, el bot busca su pago pendiente por monto, lo acredita al instante y guarda la foto para auditoría posterior (queda marcado como `acreditado_via = 'whatsapp_bot'`).

## Qué falta (pendiente ahora mismo)

- Rotar las claves expuestas en `Luz y Fuerza.txt`.
- Terminar la configuración de Meta WhatsApp Cloud API del lado de Gaby.
- Correr el SQL de `whatsapp_vinculos`, `whatsapp_estado`, la función RPC y crear el bucket `comprobantes` en Supabase (está todo escrito, solo falta ejecutarlo).
- Terminar de auditar la navegación (botón de volver/inicio en todas las pantallas).
- Hacer el `git push` pendiente si quedó algún commit sin subir (revisar con `git status` / `git log`).

## Qué está planeado (evolución conversacional de la Consulta)

Está en curso un rediseño de cómo la IA junta contexto antes de tirar las cartas, para que se sienta más humano y cercano, "que escucha antes de responder". Puntos ya definidos:

1. Reemplazar el modal actual (`modalContextoExtra`) por un paso más dentro del flujo normal de `tab-consulta` (mismo patrón visual que los pasos existentes), no una ventana flotante. Se identificó como un anti-patrón de UX haber usado un modal para esto.
2. Unificar el sistema de "pregunta cerrada detectada" con la idea de agregar siempre una pregunta de seguimiento tipo "¿qué es lo que más te moviliza de esto?", en vez de tener dos sistemas separados.
3. Decidir si las preguntas de seguimiento son una cantidad fija o si la IA decide dinámicamente cuándo ya entendió lo suficiente (con impacto en costo de API y en tiempo de espera).
4. Evaluar chips de opciones rápidas en vez de texto libre para reducir fricción en mobile.
5. Cuidar que el paso extra se sienta parte del ritual de la consulta, no un trámite que demora la respuesta que la persona ya quiere.
6. Este cambio es exclusivo de la Consulta de 3 cartas. La Carta del día no cambia, sigue siendo instantánea.
7. Ya se ajustó el tono de la interpretación (prompt de `consultar.js`) para que arranque reconociendo lo que la persona contó en vez de seguir siempre el mismo molde de 3 párrafos, y se subió el límite de 100 a 150 palabras. Queda pendiente evaluar sumar más datos a la consulta (signo, tono, estado de ánimo).

Ideas más a largo plazo, sin arrancar todavía:

- Tiradas de tarot completas por WhatsApp (hoy el bot solo responde FAQ y gestiona pagos, no hace lecturas).
- Mazo de tarot propio y original de la marca (78 cartas con ficha propia: concepto, elemento, palabras clave, sombras, relaciones entre cartas), en vez de basarse en Rider-Waite, para que la IA interprete desde ese material propio.
- Posible rediseño visual completo inspirado en la identidad marfil/dorado/lavanda propuesta, evaluando si conviene sobre el sitio actual o como parte de un relanzamiento más grande.

## Cómo se trabaja este proyecto

- Preferencias de estilo y proceso de trabajo están en `CLAUDE.md`, en la raíz de esta misma carpeta. Léelo siempre antes de escribir texto o tomar decisiones de arquitectura nuevas.
- Los cambios se hacen directo sobre `index.html` y los archivos de `functions/`, se valida sintaxis, se commitea, y el push final lo hace Gaby desde su computadora (no hay credenciales de GitHub en el entorno de Cowork).
- Antes de construir un patrón de interfaz nuevo, conviene investigar qué patrón de UX corresponde en vez de reusar por comodidad lo primero que ya está armado en el sitio.
