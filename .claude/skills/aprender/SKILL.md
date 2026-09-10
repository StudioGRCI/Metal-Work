---
name: aprender
description: Qué hacer cuando el usuario corrige un error del asistente — encontrar la causa raíz, elegir dónde debe quedar escrita para que se lea sola la próxima vez, y comprobar que quedó. Usar cuando el usuario señala una equivocación, cuando se descubre que algo que se dio por hecho era falso, o al detectar que un error ya había pasado antes.
---

# Aprender de una corrección

Arreglar el síntoma en esta conversación no es aprender. Aprender es dejar el
error **imposible de repetir** en la siguiente, cuando esta conversación ya no
exista. Todo lo que sigue va de eso.

El hook `UserPromptSubmit` detecta el lenguaje de una corrección y anota el turno
en `.claude/aprendizaje/correcciones.log`. Que dispare es la señal de entrada;
también se entra aquí sin hook, al descubrir por cuenta propia que algo que se
afirmó era falso.

## El protocolo

**1. Entender antes de defenderse.** Releer qué se pidió y qué se hizo. Si la
corrección no se entiende del todo, preguntar una cosa concreta; suponer mal aquí
produce una regla equivocada, que es peor que ninguna.

**2. Buscar la causa raíz, no el síntoma.** La pregunta no es «qué escribí mal»
sino «qué creía yo que era verdad y no lo era». Casi siempre cae en una de estas:

- Di por hecho algo del entorno sin comprobarlo (que un comando existe, que un
  servicio corre, que una ruta es la que parece).
- Leí el código por encima y completé el resto de memoria.
- Declaré terminado algo que no vi funcionar.
- Apliqué una convención general donde este proyecto tiene la suya.
- Entendí el encargo más estrecho —o más ancho— de lo que era.

**3. Comprobar si es reincidencia.** Antes de escribir nada:

```bash
grep -ic "<palabra clave del error>" .claude/aprendizaje/correcciones.log
wc -l .claude/aprendizaje/correcciones.log
```

Si el mismo error ya está en el registro, **la regla existente falló**: o está en
un sitio que no se lee a tiempo, o está redactada como consejo y no como regla.
Corregir esa regla, no añadir una segunda que diga lo mismo. Dos reglas que dicen
lo mismo se contradicen tarde o temprano.

**4. Elegir el destino.** Es el paso que decide si el aprendizaje sobrevive:

| Lo que aprendiste | Dónde va |
| --- | --- |
| Un comportamiento del proyecto que sorprendió (la base, Next, el banco) | Sección «Trampas» de la skill del dominio: `esquema`, `seguridad`, `diseno`, `datos`. Va al git: sirve a cualquiera |
| Una regla que aplica a **todo** cambio del repositorio | `CLAUDE.md`, y solo si de verdad aplica a todo |
| Cómo quiere trabajar el usuario, y por qué | Memoria, tipo `feedback` |
| Un hecho de esta máquina o de este entorno | Memoria, tipo `project` |
| Algo que solo importaba en esta conversación | A ningún sitio |

Dos criterios para no equivocar el destino:

- *¿Le sirve a otra persona que abra el repositorio?* Sí → skill o `CLAUDE.md`.
  No, es de este usuario o de esta máquina → memoria.
- *¿Cuándo hace falta?* Lo que hace falta **siempre** va a `CLAUDE.md`; lo que
  hace falta solo al tocar un dominio va a su skill. `CLAUDE.md` se lee entero en
  cada sesión: meter ahí lo que solo importa a veces encarece todas las demás.

**5. Escribirlo como regla, no como anécdota.** Que se entienda sin conocer la
conversación en que nació:

- Mal: «Cuidado con los permisos, hubo un problema.»
- Bien: «Antes de cerrar una acción de escritura, cruzar el permiso que exige la
  acción con el que acepta la política de esa tabla, y probarlo con el rol que la
  usa: si no coinciden, el UPDATE afecta cero filas sin error y la pantalla miente.»

La forma que mejor funciona en este repositorio: **qué hacer, y qué pasa si no**.
La consecuencia es lo que hace que la regla se respete.

**6. Comprobar que quedó.** Releer el archivo escrito. Un aprendizaje que no
cambia ninguna instrucción futura no es un aprendizaje, es una disculpa.

## Al responder al usuario

Corregir el error de fondo, decir en una frase dónde quedó la regla, y seguir.
Sin disculpas largas, sin recuento de fallos pasados, sin prometer. La prueba de
que se aprendió es el archivo, no el párrafo.

## Qué no guardar

- Lo que el repositorio ya dice: estructura, historia de git, lo que está en las
  skills o en `CLAUDE.md`. Duplicar es crear dos verdades que se separan.
- Preferencias de un momento («ahora hazlo rápido»).
- Reglas deducidas de un solo caso ambiguo. Si no se sabe si es regla o
  casualidad, se espera a la segunda vez — el registro dirá si vuelve.

## Revisión periódica

Cada tantas correcciones conviene mirar el conjunto, no el último caso:

```bash
cut -f2 .claude/aprendizaje/correcciones.log | sort | uniq -c | sort -rn | head
```

Un tema que se repite y ya tiene regla escrita significa que la regla está mal
colocada o mal redactada. Ahí el arreglo es mover o reescribir, nunca añadir.
