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

  if (error.code === '23505') return 'Ya existe un registro con esos datos.'
  if (error.code === '23503')
    return 'El registro está referenciado por otro documento y no se puede modificar.'
  if (error.code === '42501' || error.code === 'PGRST301')
    return 'No tienes permisos para realizar esta operación.'

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
