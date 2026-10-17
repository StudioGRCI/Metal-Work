# Skills de terceros

Qué skills de otros repositorios viven en `.claude/skills/`, de dónde salieron,
bajo qué licencia y qué se les cambió. Y qué se evaluó y quedó fuera, para no
volver a evaluarlo desde cero. Elegidas el 17/10 a pedido de DKS («analizas, tú
decides qué sí necesitamos para mejorar todo lo de Metal Work»).

**La regla que manda sobre todas:** las skills propias (`diseno`, `seguridad`,
`esquema`, `datos`, `aprender`, `auditar`) ganan siempre. Cada copia de terceros
lleva arriba un bloque «Metal Work» que dice cómo se usa aquí; ese bloque manda
sobre el resto del archivo.

## Las que se trajeron

| Skill | Origen y versión | Licencia | Para qué aquí |
| --- | --- | --- | --- |
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) `6af45ac9a5eb` (4.6.0) | Apache 2.0 (`LICENSE`, `NOTICE.md`) | Criticar y auditar pantallas en modo Operate: jerarquía, accesibilidad, responsive, textos, casos límite |
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) `56ea9cf174ed` (2.15.0) | MIT | 119 pautas de UX consultables (toque, formularios, navegación, gráficos) y la lista de chequeo antes de entregar |
| `verification-before-completion` | [obra/superpowers](https://github.com/obra/superpowers) `bb92a7774141` (7.0.0) | MIT | Nada se declara terminado sin la evidencia fresca de que funciona |
| `systematic-debugging` | obra/superpowers, el mismo commit | MIT | Ante un fallo, la causa raíz antes que el arreglo |
| `react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `063bee94c3f4` | MIT (`LICENSE` armado con lo que declara el origen) | Rendimiento en React y Next: esperas en cadena, tamaño del paquete, server components |

### Qué se les cambió

- **impeccable**: se trajeron `SKILL.md` y `reference/`; **no** `scripts/`, porque
  su lanzador baja un ejecutable de internet al usarse, ni sus ganchos
  (`settings.json`), que corrían ese ejecutable después de cada edición. Se
  agregó el bloque «Metal Work» al principio de `SKILL.md`: primero `diseno`,
  modo Operate, sin lanzador, sin crear `PRODUCT.md` ni `DESIGN.md`.
- **ui-ux-pro-max**: se trajeron `SKILL.md`, `references/`, `data/` y el buscador
  (`scripts/search.py`, `core.py`, `design_system.py`, `reasoning_contract.py`,
  solo biblioteca estándar de Python, sin red). Quedaron fuera el validador de
  mantenimiento (`validate_data.py`), sus pruebas y los datos que solo él lee.
  La ruta del buscador pasó de `${CLAUDE_PLUGIN_ROOT}/…` a
  `$CLAUDE_PROJECT_DIR/…` con `python3`, y se agregó el bloque «Metal Work».
- **verification-before-completion** y **systematic-debugging**: bloque «Metal
  Work» al principio y las referencias `superpowers:…` cambiadas por las
  equivalentes de aquí (checks de `db/test/checks/` y `probar-*.mjs`). De
  `systematic-debugging` se trajeron `SKILL.md`, `root-cause-tracing.md`,
  `defense-in-depth.md` y `condition-based-waiting.md`.
- **react-best-practices**: `SKILL.md` y `rules/`; no el `AGENTS.md` compilado,
  que repite `rules/`. Bloque «Metal Work» al principio.

### Cómo actualizar una

1. Clonar el origen en una carpeta vacía del scratchpad, en el commit nuevo.
2. Leer el diff contra el commit de la tabla, sobre todo scripts y ganchos: nada
   que baje ejecutables, use red o escriba fuera de su carpeta.
3. Copiar el mismo subconjunto, volver a poner el bloque «Metal Work» y los
   cambios de arriba, y actualizar la tabla.

## Los auditores (propios)

`.claude/agents/auditor-diseno.md`, `auditor-funcionalidad.md` y
`auditor-realizacion.md`, y cómo se lanzan en la skill `auditar`. Son de Metal
Work; toman tres ideas de afuera:

- la revisión en dos ejes que no se mezclan, el pedido y las reglas, de
  `code-review` de [mattpocock/skills](https://github.com/mattpocock/skills) (MIT);
- la caza de fallos silenciosos de `silent-failure-hunter` y el recorrido botón
  por botón de `click-path-audit`, de
  [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) (MIT);
- «cada línea cambiada se rastrea hasta el pedido» y «nada especulativo», de
  [andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) (MIT).

## Evaluadas y no traídas

| Repositorio | Por qué no |
| --- | --- |
| **Everything Claude Code (ECC)** · affaan-m/everything-claude-code, 2.2.3, MIT | Son 71 agentes, 311 skills, 97 comandos y 27 ganchos que corren Node en casi cada paso. Instalado entero, llena el contexto de cada hilo con descripciones que no aplican (Django, Rust, salud, finanzas) y sus ganchos se cruzan con los propios. Sus agentes de base de datos y seguridad son genéricos y aquí ya están `seguridad`, `datos` y `supabase-postgres-best-practices`, con lo aprendido en esta base. Se tomaron dos ideas (arriba). |
| **taste-skill** · Leonxlnx/taste-skill, MIT | Su skill principal dice de sí misma «no es para dashboards ni pantallas de aplicación»: es para páginas de marketing. Su variante de rediseño empieza por cambiar la letra y los íconos, pide grano, vidrio y parallax, y propone «datos desordenados» y fechas al azar «para que parezcan reales», que en un ERP con datos de la empresa no puede ser. Lo útil que trae ya está en `impeccable`. Si algún día hay una página pública de Metal Work, esa es la skill. |
| **caveman** · JuliusBrussee/caveman, Apache 2.0 | Hace que el modelo escriba telegráfico para gastar menos. Aquí todo lo que lee DKS va en frases completas y en español: ahorra poco y empeora lo que más se lee. |
| **graphify** · safishamsi/graphify, MIT/Apache 2.0 | Arma un grafo del código con un paquete de PyPI y agrega ganchos antes de cada herramienta; manda documentos al modelo para extraer conceptos. Este repositorio se recorre bien con el mapa de `CLAUDE.md` y `rg`. |
| **ponytail** · DietrichGebert/ponytail, MIT | «Escribir menos código» y respuestas mínimas. La idea útil (lo mínimo que resuelve) ya la revisa `auditor-realizacion`; sus respuestas mínimas chocan con cómo se le escribe a DKS. |
| **andrej-karpathy-skills** · MIT | Un `CLAUDE.md` de cuatro principios. Su «ante la duda, pregunta» choca con cómo trabajan los hilos aquí (DKS puede tardar horas: se elige lo razonable y se dice). Sus principios de cambios quirúrgicos y simplicidad quedaron en `auditor-realizacion`. |
| **mattpocock/skills** · MIT | Pensadas para trabajar con un gestor de incidencias y entrevistas largas (`grill-me`, `to-tickets`, `wayfinder`). Se tomó la idea de la revisión en dos ejes. |
| **addyosmani/agent-skills** · MIT | Muy completas pero genéricas (24 skills de 10 a 20 KB); se pisan con las propias y con las elegidas. |
| **anthropics/skills** | Las de documentos (Word, PDF, Excel, PowerPoint) y `skill-creator` ya están disponibles en las sesiones como `anthropic-skills:*`; las de Word, PDF, Excel y PowerPoint además no son de código abierto. `frontend-design` quedó absorbida por `impeccable`. |
| **vercel-labs/agent-skills** (el resto) | `web-design-guidelines` baja sus reglas de internet en cada uso: instrucciones que cambian sin que nadie las revise. Las de despliegue duplican el conector de Vercel. |
| **21st.dev** (registro de componentes y su generador Magic) | Sus componentes son de shadcn/ui con Radix, Tailwind y a menudo framer-motion, publicados por la comunidad sin una licencia clara por componente. Aquí hay un juego propio (`src/components/ui/`) con las variables del tema; cada pieza de 21st habría que reescribirla a ese tema y sumaría dependencias que el teléfono del taller paga en cada carga. Magic manda los pedidos a un servicio de pago de 21st.dev con una clave de la cuenta de DKS y devuelve el mismo estilo de componentes. Sirve como inspiración puntual para una pieza que falte, no como fuente. |
| **superpowers** (el resto) | `brainstorming` exige una conversación de diseño antes de cada cambio y su gancho de inicio obliga a revisar skills antes de todo; no calza con hilos que trabajan solos mientras DKS no está. `test-driven-development` supone pruebas unitarias, que aquí son checks en SQL y recorridos con clic. |
