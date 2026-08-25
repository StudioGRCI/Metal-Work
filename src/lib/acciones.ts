export type ResultadoAccion = { ok: true; mensaje?: string } | { ok: false; error: string }

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
