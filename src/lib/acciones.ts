/**
 * Lo que devuelve una acción de servidor.
 *
 * El parámetro es para las pocas acciones que además tienen que devolver algo
 * —dar de alta un proveedor devuelve el proveedor, para poder dejarlo elegido
 * en el formulario desde el que se creó—. Sin él se comporta como siempre.
 */
export type ResultadoAccion<T = never> =
  | { ok: true; mensaje?: string; datos?: T }
  | { ok: false; error: string }

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

  const check = /violates check constraint "([^"]+)"/.exec(m)
  // Migración 20261022141500: un archivo de 0 bytes no es un documento.
  if (check?.[1].endsWith('_tamano_no_vacio')) return 'El archivo está vacío: elige otro.'
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
