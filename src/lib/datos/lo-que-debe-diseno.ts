import 'server-only'

import type { CompromisoDelPlano, LoQueDebeDiseno, SituacionDelPlano } from '@/lib/dominio/lo-que-debe-diseno'
import { createClient } from '@/lib/supabase/server'

/**
 * Lo que Diseño entrega por código interno, punto por punto, y la fecha
 * comprometida del plano de cada área contra la real (migración
 * 20261126600000). Lo cuenta la base; aquí solo se arma por código. Lo leen
 * Diseño, Gerencia, Administración y los supervisores
 * (`puede_ver_codigos_de_diseno`): a los demás la base les dice que no.
 */
const SITUACIONES: readonly SituacionDelPlano[] = ['A_TIEMPO', 'TARDE', 'PENDIENTE', 'VENCIDO', 'SIN_FECHA', 'ENTREGADO_SIN_FECHA']

// La función acepta hasta 3000 códigos: se piden de a mil para no acercarse.
const POR_TANDA = 1000

export async function loQueDebeDiseno(codigos: readonly string[]): Promise<Map<string, LoQueDebeDiseno>> {
  const porCodigo = new Map<string, LoQueDebeDiseno>()
  const unicos = [...new Set(codigos)]
  if (unicos.length === 0) return porCodigo
  const supabase = await createClient()
  const tandas: string[][] = []
  for (let i = 0; i < unicos.length; i += POR_TANDA) tandas.push(unicos.slice(i, i + POR_TANDA))
  const respuestas = await Promise.all(tandas.map((tanda) => supabase.rpc('lo_que_debe_diseno', { p_codigos: tanda })))
  for (const { data, error } of respuestas) {
    if (error) throw new Error(`No se pudo leer lo que Diseño lleva en cada código: ${error.message}`)
    for (const f of data ?? []) {
      if (!f.codigo) continue
      let c = porCodigo.get(f.codigo)
      if (!c) {
        c = {
          codigo: f.codigo,
          tieneOt: f.tiene_ot === true,
          fichaEn: f.ficha_en,
          planos: Number(f.planos ?? 0),
          planosEn: f.planos_en,
          materiales: Number(f.materiales ?? 0),
          materialesEn: f.materiales_en,
          etapas: Number(f.etapas ?? 0),
          etapasEn: f.etapas_en,
          dxf: Number(f.dxf ?? 0),
          dxfEn: f.dxf_en,
          compromisos: [],
        }
        porCodigo.set(f.codigo, c)
      }
      if (f.area && f.area_nombre && f.situacion) {
        // Una situación que la pantalla no conoce no se pinta como «a tiempo».
        const situacion = SITUACIONES.includes(f.situacion as SituacionDelPlano) ? (f.situacion as SituacionDelPlano) : 'SIN_FECHA'
        const compromiso: CompromisoDelPlano = {
          area: f.area,
          areaNombre: f.area_nombre,
          comprometido: f.comprometido,
          entregadoEn: f.entregado_en,
          situacion,
          dias: f.dias == null ? null : Number(f.dias),
        }
        c.compromisos.push(compromiso)
      }
    }
  }
  return porCodigo
}
