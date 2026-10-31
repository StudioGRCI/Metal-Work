/**
 * Lo que devuelve una acción de servidor.
 *
 * El parámetro es para las pocas acciones que además tienen que devolver algo
 * —dar de alta un proveedor devuelve el proveedor, para poder dejarlo elegido
 * en el formulario desde el que se creó—. Sin él se comporta como siempre.
 */
export type ResultadoAccion<T = never> =
  | { ok: true; mensaje?: string; datos?: T }
  | {
      ok: false
      error: string
      /**
       * Lo que quedó a medias, dicho tal cual en la línea de arriba si la
       * persona ya se fue del formulario (`decirElRechazoSiSeFue`): el
       * comprobante que quedó en borrador, el plano que llegó a un área y a
       * otra no. «No se guardó» delante mentía (cuadragésima tercera pasada).
       */
      arriba?: string
    }

/**
 * Lo que se le dice al usuario cuando la escritura no tocó ninguna fila.
 *
 * Una fila que la seguridad por fila esconde no es un error para Postgres: el
 * UPDATE afecta cero filas, `error` viene vacío y la pantalla diría «listo» sin
 * haber hecho nada. No se cae: miente, que es el fallo más caro que ha tenido
 * este proyecto. Toda escritura acotada por permiso termina en
 * `.select('id').maybeSingle()` y devuelve esto si no vuelve fila.
 */
export const NO_TOCO_NADA =
  'No se pudo guardar: vuelve a cargar la pantalla y comprueba que el registro sigue a la vista.'

/**
 * El rechazo que en realidad dice que el envío ya entró: la respuesta de la
 * primera vez se perdió, se volvió a pulsar y la base contesta «Este pago ya
 * quedó registrado la primera vez que lo enviaste…». Lo que se quería ya está,
 * y la pantalla de detrás quedó vieja: seguía ofreciendo pagar el saldo de
 * antes, y un segundo pago entraba de verdad (duodécima pasada).
 */
export const yaEntroLaPrimeraVez = (mensaje: string | null | undefined) =>
  Boolean(mensaje && /la primera vez que l[oa]s? enviaste/.test(mensaje))

/**
 * Ese aviso, dicho dentro de una ventana. La base pide recargar, pero la
 * pantalla se pone al día sola al cerrarla; y lo que se cambió en la ventana
 * seguía a la vista sin que nada dijera que no se guardó (decimocuarta pasada).
 * Con un «si»: quien reenvió lo mismo no cambió nada (decimoquinta pasada).
 */
export const yaEntroEnLaVentana = (mensaje: string) =>
  mensaje.replace(/[:.] recarga la pantalla[^.]*\.$/i, '. Si cambiaste algo después, no se guardó: al cerrar, la pantalla muestra lo que quedó.')

/**
 * Ese aviso en un formulario sin ventana (cargar un plano). La pantalla ya se
 * puso al día sola; pedir que se recargue, sin decir que lo de esta vez no se
 * guardó, dejaba pensar que el segundo PDF había entrado (decimosexta pasada).
 * `donde` dice dónde se ve lo que quedó: el tablero de la OT no tiene lista de
 * documentos, y mandar a mirarla no llevaba a ninguna parte (decimonovena pasada).
 */
export const yaEntroSinVentana = (mensaje: string, donde = 'la lista ya muestra lo que quedó') =>
  mensaje.replace(/[:.] recarga la pantalla[^.]*\.$/i, `. Lo que enviaste esta vez no se guardó: ${donde}.`)

/**
 * El envío pudo entrar y no se sabe: no llegó la respuesta, o después de eso se
 * eligió otro archivo y el primero sigue en su ruta sin saberse si quedó
 * (`otroArchivoEnLaRuta`). La pantalla de detrás se pone al día al cerrar la
 * ventana; con el segundo no lo hacía (decimoquinta pasada).
 */
export const pudoHaberEntrado = (mensaje: string) =>
  mensaje.startsWith('No llegó la respuesta') || /^Antes ya se subió .* y no se sabe si quedó/.test(mensaje)

/**
 * Traduce los errores de Postgres a algo que el usuario del taller entienda.
 * Los triggers del esquema ya lanzan mensajes redactados en español, así que se
 * dejan pasar tal cual; aquí solo se reescribe lo que emite el propio motor.
 */
export function mensajeDeError(error: { message: string; code?: string }): string {
  const m = error.message

  // El duplicado del motor se reescribe; el que explica un disparador («El
  // número de OT no se reinicia cada año») se deja pasar.
  if (error.code === '23505') {
    return /duplicate key|unique constraint/i.test(m) ? 'Ya existe un registro con esos datos.' : m
  }
  if (error.code === '23503')
    return 'El registro está referenciado por otro documento y no se puede modificar.'
  // 42501 es también el código con que las funciones del esquema explican por
  // qué no dejan hacer algo («Solo el puesto que aprueba las compras puede
  // aprobarlas.»): ese mensaje ya está redactado para el taller y se deja
  // pasar. Solo el del motor (la seguridad por fila o un permiso de tabla) se
  // reemplaza, porque en inglés no le dice nada a nadie.
  if (error.code === 'PGRST301') return 'No tienes permisos para realizar esta operación.'
  if (error.code === '42501') {
    // `exigir_permiso` nombra el permiso por su código («No tiene el permiso
    // compras.crear…»), que no le dice nada al taller.
    return /row-level security|permission denied|insufficient privilege|^No tiene el permiso /i.test(m)
      ? 'No tienes permisos para realizar esta operación.'
      : m
  }

  // El resto de la clase 42 (un tipo que no calza, una columna que no existe) es
  // un fallo del sistema, no del dato: en inglés no le sirve a nadie. Pasó con
  // la regla de las horas extras (2026-10-20).
  if (error.code?.startsWith('42')) return 'El sistema no pudo guardar esto. Avisa al administrador.'

  // Los fallos de paso del motor llegaban en inglés («canceling statement due
  // to statement timeout»), justo en los avisos que piden volver a intentar
  // (undécima pasada). Con estos, la transacción se deshizo: nada se guardó.
  if (error.code === '40001' || error.code === '40P01') return 'Otra persona guardaba algo relacionado a la vez y esto no se guardó.'
  if (error.code === '57014') return 'La base tardó demasiado y esto no se guardó.'
  if (error.code?.startsWith('53') || error.code?.startsWith('57P') || ['PGRST000', 'PGRST002', 'PGRST003'].includes(error.code ?? '')) {
    return 'La base no estaba disponible y esto no se guardó.'
  }
  // Con estos, en cambio, el pedido pudo llegar y la respuesta perderse.
  if (error.code?.startsWith('08') || error.code === 'PGRST001' || (!error.code && /fetch failed|network|ECONNRESET|socket hang up|other side closed/i.test(m))) {
    return 'No llegó la respuesta de la base; recarga la pantalla y mira si se guardó.'
  }

  const check = /violates check constraint "([^"]+)"/.exec(m)
  if (check) return `El dato no cumple la regla ${check[1]}.`

  const dominio = /value for domain (\w+) violates/.exec(m)
  if (dominio) {
    const explicacion: Record<string, string> = {
      ruc: 'El RUC debe tener 11 dígitos.',
      dni: 'El DNI debe tener 8 dígitos.',
      placa: 'La placa debe tener el formato ABC-123.',
      email: 'El correo electrónico no es válido.',
      porcentaje: 'El porcentaje debe estar entre 0 y 100.',
    }
    return explicacion[dominio[1]] ?? `El valor no es válido para ${dominio[1]}.`
  }

  return m
}

/**
 * Lo mismo para el almacenamiento de archivos, que responde en inglés y sin
 * código de Postgres («new row violates row-level security policy», «The
 * resource already exists»). Se reescribe siempre: su texto nunca es del taller.
 */
export function mensajeDeArchivo(error: { message: string }): string {
  const m = error.message
  if (/row-level security|permission|unauthorized|not allowed/i.test(m))
    return 'No tienes permiso para subir o quitar ese archivo.'
  if (/already exists|duplicate/i.test(m)) return 'Ese archivo ya estaba subido.'
  if (/too large|maximum allowed size|payload/i.test(m)) return 'El archivo pesa demasiado.'
  if (/mime|content type|invalid file type/i.test(m)) return 'Ese tipo de archivo no se acepta.'
  return 'El archivo no se pudo guardar. Inténtalo de nuevo; si vuelve a pasar, avisa al administrador.'
}

/**
 * Por qué no subió un archivo, en una frase para poner después de «No se pudo
 * subir…»: la señal solo cuando el almacenamiento no contestó; si contestó, lo
 * que dijo (`mensajeDeArchivo`). Antes toda falla culpaba a la señal, también
 * la de un permiso que faltaba: a Diseño, con el Excel del cronograma (2026-10-21).
 */
export function motivoDeSubida(error: { message: string }): string {
  if (/fetch|network|load failed|timed? ?out|aborted/i.test(error.message)) return 'Revisa la señal y vuelve a intentar.'
  const motivo = mensajeDeArchivo(error)
  // Detrás de «No se pudo subir…», sin repetir que no se guardó.
  return motivo.startsWith('El archivo no se pudo guardar. ') ? motivo.slice('El archivo no se pudo guardar. '.length) : motivo
}
