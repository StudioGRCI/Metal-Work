import Link from 'next/link'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import type { ConteoFisico } from '@/lib/datos/conteos'
import { cantidad, fechaHora } from '@/lib/format'

/** La diferencia de un conteo: lo que sobró en verde, lo que faltó en rojo, y «Cuadra» si no hubo. */
function Diferencia({ c }: { c: ConteoFisico }) {
  if (c.diferencia === 0) return <Insignia tono="neutro">Cuadra</Insignia>
  const sobro = c.diferencia > 0
  return (
    <span className={`tabular font-semibold ${sobro ? 'text-exito' : 'text-peligro'}`} data-diferencia={c.diferencia}>
      {sobro ? '+' : '−'}
      {cantidad(Math.abs(c.diferencia))} <span className="text-xs font-normal text-texto-suave">{c.unidad ?? ''}</span>
      <span className="sr-only">{sobro ? ' de sobra' : ' de falta'}</span>
    </span>
  )
}

/**
 * Los conteos físicos del kardex (plan 2, entrega 2.3): de cada uno, lo que
 * contó Almacén, lo que decía el sistema, la diferencia que quedó como ajuste,
 * quién contó, cuándo y por qué. Con `conMaterial`, el material en su columna
 * (la lista de todo el almacén); sin él, es la ficha de un material.
 *
 * En el teléfono cada conteo es una ficha (`Tabla apilada`): las seis columnas
 * no caben en 390 px.
 */
export function ConteosFisicos({ conteos, conMaterial }: { conteos: ConteoFisico[]; conMaterial: boolean }) {
  if (conteos.length === 0) {
    return <SinDatos compacto titulo="Todavía no hay conteos físicos" descripcion="Cada conteo que registres con «Conteo físico» aparece aquí con su diferencia." />
  }
  return (
    <Tabla apilada>
      <TablaCabecera>
        <tr>
          <TH>Cuándo y quién</TH>
          {conMaterial && <TH>Material</TH>}
          <TH className="text-right">Contado</TH>
          <TH className="text-right">El sistema decía</TH>
          <TH className="text-right">Diferencia</TH>
          <TH>Motivo</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {conteos.map((c) => (
          <TR key={c.id} data-conteo={c.id}>
            <TD>
              <span className="tabular block text-sm text-texto">{fechaHora(c.en)}</span>
              <span className="block text-xs text-texto-suave">{c.contoPor ? `Contó ${c.contoPor}` : 'No quedó quién contó'}</span>
            </TD>
            {conMaterial && (
              <TD data-rotulo="Material" className="max-w-64">
                <Link href={`/almacen/kardex?material=${c.materialId}`} className="block text-sm text-acento hover:underline pointer-coarse:py-3">
                  {/* El recorte va adentro: con el relleno en la misma caja se asomaba media tercera línea. */}
                  <span className="line-clamp-2">{c.material}</span>
                </Link>
                <span className="block font-mono text-xs text-texto-tenue">{c.codigo}</span>
              </TD>
            )}
            <TD data-rotulo="Contado" className="tabular md:text-right">
              {cantidad(c.contado)} <span className="text-xs text-texto-suave">{c.unidad ?? ''}</span>
            </TD>
            <TD data-rotulo="El sistema decía" className="tabular md:text-right">
              {cantidad(c.sistema)} <span className="text-xs text-texto-suave">{c.unidad ?? ''}</span>
            </TD>
            <TD data-rotulo="Diferencia" className="md:text-right">
              <Diferencia c={c} />
            </TD>
            <TD data-rotulo="Motivo" className="max-w-72 text-sm text-texto-suave">
              {c.motivo}
            </TD>
          </TR>
        ))}
      </tbody>
    </Tabla>
  )
}
