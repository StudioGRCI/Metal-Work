---
name: auditar
description: Cómo se audita un trabajo de Metal Work antes de entregarlo, con tres subagentes independientes (diseño, funcionamiento y realización) que revisan con ojos frescos lo que hizo el hilo, y qué se hace con lo que encuentran. Usar antes de abrir el PR de cualquier cambio de pantalla, permiso, migración o circuito, y antes de decirle a DKS que algo está terminado.
---

# Auditar antes de entregar

Quien construye algo deja de ver sus huecos: probó el camino que pensó, con la
cuenta que tenía a mano, y leyó su diff sabiendo lo que quería decir. Los
auditores no saben nada de eso. Reciben el pedido y el resultado, y nada del
razonamiento del hilo. Lo pidió DKS el 17/10.

No reemplazan la verificación propia (`CLAUDE.md` › Verificar): van **después**,
cuando el hilo ya vio funcionar su trabajo.

## Qué auditor va según qué cambió

| Cambió | Auditores |
| --- | --- |
| Pantallas o componentes | `auditor-diseno`, `auditor-funcionalidad`, `auditor-realizacion` |
| Permisos, políticas, funciones SQL, acciones de servidor, migraciones | `auditor-funcionalidad`, `auditor-realizacion` |
| Solo textos, documentación o skills | `auditor-realizacion`, o ninguno si es un cambio de una línea (y se dice) |

## Cómo se lanzan

1. Antes: `./scripts/verificar.sh` en verde y, si hay pantallas o permisos, el
   banco local arriba con las cuentas `*.local@metalwork.test` de cada puesto.
   Los auditores reusan ese banco; si cada uno lo levanta por su cuenta se pisan.
2. Los que tocan, **en paralelo, en un solo mensaje**, con la herramienta Agent
   y `subagent_type` igual al nombre del auditor. El hilo espera los tres
   informes antes de abrir el PR.
3. A cada uno, el mismo encargo, sin la historia del hilo:

```
Pedido de DKS, textual: «…» (y el mensaje donde lo dijo)
Decisiones de la memoria que aplican: …
Diff: rama <rama>, base origin/main (o <commit>)
Pantallas: <ruta> → <puesto que la usa>; …
Circuito: <puesto> hace <qué>, después <puesto> …
Banco local: BASE=http://localhost:3111, BANCO_BASE=<base>, la clave en BANCO_CLAVE
Scripts de prueba del hilo: herramientas/banco/probar-<…>.mjs
Lo que el hilo ya comprobó y lo que no: …
```

**Si el tipo `auditor-…` no aparece en la herramienta Agent** (puede pasar un
rato cuando la sesión arrancó en la rama por defecto, que es vieja, y la carpeta
`.claude/agents/` llegó al cambiar de rama), se lanza un `general-purpose` con
este comienzo:
«Eres el auditor descrito en `.claude/agents/auditor-<x>.md`. Léelo entero,
carga con la herramienta Skill las skills que lista y sigue sus instrucciones.
Encargo: …». Y se le recuerda que no use las herramientas `mcp__hearthbot__`.

## Qué se hace con lo que encuentran

- **P0, P1, «Bloquea» e «Importante»**: se arreglan antes del PR. Si el hilo
  cree que el hallazgo es falso, lo demuestra con evidencia (salida, consulta,
  captura con conteo), no con argumentos.
- Después de arreglar algo grave, se vuelve a lanzar **el auditor que lo
  encontró**, con el mismo encargo y una línea de qué cambió.
- **P2, P3 y «Menor»**: se arreglan si son baratos y caen dentro del pedido; si
  no, se listan en el PR.
- Un hallazgo fuera del pedido (algo roto de antes) no se arregla en este PR: se
  anota en el PR y se le dice al coordinador.

## Cómo se le cuenta a DKS

- En el PR, una sección «Auditoría»: qué revisó cada auditor, qué encontró y
  qué se arregló o quedó pendiente.
- En el hilo, una o dos líneas dentro de la respuesta que entrega: qué
  encontraron los auditores y qué se hizo. Sin pegar los informes.
- Lo que ningún auditor pudo comprobar se dice, con el porqué.
