'use server'

import { comoFecha, correrInforme, periodoPorDefecto } from '@/lib/datos/informes'
import { informePorClave } from '@/lib/dominio/informes'
import { aCsv } from '@/lib/informes-formato'
import { exigirSesion, puede } from '@/lib/sesion'

/** Arma el CSV del informe con las mismas columnas que se ven en pantalla. */
export async function csvDelInforme(
  clave: string,
  desde: string,
  hasta: string,
): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const perfil = await exigirSesion()

  const informe = informePorClave(clave)
  if (!informe) return { ok: false, error: 'Ese informe no existe.' }
  if (!informe.permisos.every((p) => puede(perfil, p))) {
    return { ok: false, error: 'No tienes permiso para ver este informe.' }
  }

  const defecto = periodoPorDefecto()

  try {
    const filas = await correrInforme(
      clave,
      comoFecha(desde, defecto.desde),
      comoFecha(hasta, defecto.hasta),
    )
    return { ok: true, csv: aCsv(filas, informe.columnas) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo generar el archivo.',
    }
  }
}
