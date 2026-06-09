# Luz & Fuerza · Oráculo de Tarot — Documento de Proyecto

**Fecha de inicio:** 4 de junio de 2026  
**Sitio publicado:** https://legendary-torte-8d39b4.netlify.app/  
**Repositorio GitHub:** https://github.com/luzyfuerzaoraculos-a11y/luz-fuerza  
**Email del proyecto:** luzyfuerzaoraculos@gmail.com

---

## Identidad de marca

- **Nombre:** Luz & Fuerza
- **Tagline:** Tu luz interior · La fuerza que impulsa tu camino
- **Paleta:** Azul profundo (#0a0e1a), plateado (#c8d8f0), acento azul (#7bafd4)
- **Tipografía:** Georgia serif
- **Estética:** Nocturna, mística, elegante. Fondo oscuro con estrellas.

---

## Stack tecnológico

| Componente | Tecnología |
|-----------|-----------|
| Frontend | HTML + CSS + JavaScript vanilla |
| Backend / Funciones | Netlify Functions (Node.js) |
| IA / Motor de respuestas | Claude Haiku (Anthropic API) |
| Hosting | Netlify |
| Repositorio | GitHub |
| Editor local | Visual Studio Code |
| Servidor local | Node.js + Express |

---

## Cuentas creadas

- **Anthropic Console:** luzyfuerzaoraculos@gmail.com — para la API key
- **GitHub:** luzyfuerzaoraculos-a11y
- **Netlify:** luzyfuerzaoraculos@gmail.com
- **Vercel:** luzyfuerzaoraculos@gmail.com (cuenta creada, no se usa actualmente)

---

## Estructura de archivos del proyecto

```
luz-fuerza/
├── index.html                          # Frontend completo del sitio
├── netlify.toml                        # Configuración de Netlify
├── netlify/
│   └── functions/
│       └── consultar.js               # Función serverless (llama a la API de Claude)
├── server.js                           # Servidor local para desarrollo
├── package.json
├── .gitignore                          # Excluye .env y node_modules
└── [imágenes de logos y banners]
```

---

## Flujo actual del sitio (v2)

1. **Paso 1 — Área de consulta**
   El consultante elige el área: Amor, Trabajo, Dinero, Crecimiento personal, Decisión difícil, Otro.

2. **Paso 2 — La pregunta**
   - Validación mínima de 8 palabras
   - Hint contextual según el área elegida
   - Opción de profundizar con una pregunta del oráculo antes de tirar

3. **Paso 3 — La tirada**
   - 3 cartas aleatorias del mazo (Pasado / Presente / Futuro)
   - Cada carta muestra: nombre, energía, descripción de la posición, significado específico
   - Interpretación personalizada generada por Claude Haiku

---

## Cartas actuales (12 — arcanos mayores parciales)

El Loco, La Emperatriz, El Ermitaño, La Luna, El Sol, La Justicia, La Torre, La Estrella, El Mundo, La Fuerza, El Carro, Los Enamorados.

**Decisión pendiente:** ampliar el mazo (opciones: 22 arcanos mayores / 56 arcanos menores / 78 cartas completas)

---

## Modelo de negocio definido

| Plan | Precio | Incluye |
|------|--------|---------|
| Consulta única | $3 USD | 1 tirada + interpretación personalizada |
| Pack Semanal | $9 USD/semana | 1 consulta por día + historial |
| Mensual | $19 USD/mes | Consultas ilimitadas + historial + perfil espiritual |

---

## Roadmap del producto

### ✅ Completado
- Prototipo funcional con IA integrada
- Diseño con identidad de marca
- Flujo guiado por área de consulta
- Validación de pregunta (mínimo 8 palabras)
- Pregunta de profundización antes de tirar
- Explicación de cartas en cada posición
- Publicado en Netlify con dominio propio
- Variables de entorno seguras (API key no expuesta)

### 🔜 Próximos pasos (en orden de prioridad)

**1. Rediseño visual completo**
- Fondo dinámico con siluetas de cartas transparentes en movimiento
- Sección "¿Cómo funciona?" — arcanos, cómo habla el oráculo
- Sección "Historia y poder de los oráculos" — historia del tarot + descripción de cartas
- Nav actualizado: Consulta / ¿Cómo funciona? / Historia y poder / Planes / Nosotros

**2. Ampliar el mazo de cartas**
- Decisión pendiente: 22 arcanos mayores, 56 menores, o 78 completas
- Incluir descripción de cada carta en la sección Historia

**3. Sistema de pagos**
- Integrar Stripe (tarjetas internacionales) y/o MercadoPago (mercado local)
- Contador de consultas por plan
- Bloqueo de consulta si no tiene crédito

**4. Login y perfil del consultante**
- Registro con email y contraseña
- Historial de consultas guardado
- Línea de tiempo de cartas que salieron
- Detección de patrones (cartas repetidas, áreas más consultadas)
- Interpretación evolutiva basada en historial de los últimos 30 días

**5. Dominio propio**
- Registrar luzyfuerza.com o similar
- Conectar con Netlify

---

## Cómo correr el proyecto localmente

1. Abrí CMD en la carpeta `luz-fuerza`
2. Creá un archivo `.env` con: `ANTHROPIC_API_KEY=tu-clave-aqui`
3. Ejecutá: `node server.js`
4. Abrí el navegador en: `http://localhost:3000`

---

## Cómo publicar cambios

1. Modificá los archivos en la carpeta `luz-fuerza`
2. En CMD:
```
git add .
git commit -m "descripcion del cambio"
git push origin master
```
3. Netlify redesplega automáticamente en 1-2 minutos.

---

## Notas importantes

- La API key de Anthropic **nunca** debe subirse a GitHub. Siempre va en el archivo `.env` (local) o en las variables de entorno de Netlify.
- El archivo `.env` está en `.gitignore` — no se sube al repositorio.
- En Netlify, la API key está configurada como variable de entorno secreta en Settings → Environment Variables.
- El modelo usado es `claude-haiku-4-5-20251001` — rápido y económico. Costo estimado: menos de $0.01 USD por consulta.

