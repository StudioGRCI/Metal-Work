import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Si un trozo de URL tiene forma de id. Una ruta `[id]` que consulta la base con
 * «flota» o «nueva» en vez de un uuid recibe un 22P02 de Postgres y la pantalla
 * dice «Ocurrió un error inesperado»; un id mal formado es «no existe», no un
 * error, y por eso se comprueba antes de consultar.
 */
export function esUuid(texto: string | undefined | null): texto is string {
  return typeof texto === 'string' && UUID.test(texto)
}
