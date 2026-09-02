import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { carroceriasConFicha } from '@/lib/datos/carrocerias'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'Carrocerías' }

const TIPO_UNIDAD: Record<string, string> = {
  SEMIRREMOLQUE: 'Semirremolque',
  CARROCERIA_MONTADA: 'Carrocería montada',
}

/**
 * La base de datos de carrocerías, para Diseño e Ingeniería.
 *
 * Cada fila es una carrocería del catálogo con las fichas técnicas que la casa
 * ya escribió para ella —transcritas de sus propias OT— y los pasos de
 * verificación que el taller recorre. Elegir la carrocería en una cotización
 * trae la ficha predeterminada puesta; acá se mira qué trae antes de elegir.
 */
export default async function PaginaCarrocerias() {
  await exigirPermiso(['cotizaciones.costear', 'cotizaciones.ver', 'configuracion.ver'])
  const carrocerias = await carroceriasConFicha()

  const conFicha = carrocerias.filter((c) => c.plantillas.length > 0).length
  const fichas = carrocerias.reduce((n, c) => n + c.plantillas.length, 0)

  return (
    <>
      <EncabezadoPagina
        titulo="Carrocerías"
        descripcion={`${carrocerias.length} carrocerías en el catálogo · ${conFicha} con ficha técnica escrita · ${fichas} fichas en total. Al elegir una carrocería en la cotización, su ficha predeterminada baja sola.`}
      />

      <Tarjeta>
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Carrocería</TH>
              <TH className="hidden sm:table-cell">Tipo</TH>
              <TH className="hidden md:table-cell">Capacidad</TH>
              <TH>Fichas técnicas</TH>
              <TH className="hidden lg:table-cell text-right">Verificación</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {carrocerias.length === 0 ? (
              <SinDatos titulo="El catálogo de carrocerías está vacío" colSpan={5} />
            ) : (
              carrocerias.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <span className="font-medium">{c.nombre}</span>
                    <span className="ml-2 rounded bg-superficie-2 px-1 text-[11px] font-semibold text-texto-suave">
                      {c.codigo}
                    </span>
                  </TD>
                  <TD className="hidden text-texto-suave sm:table-cell">
                    {c.tipo_unidad ? TIPO_UNIDAD[c.tipo_unidad] ?? c.tipo_unidad : '—'}
                  </TD>
                  <TD className="hidden text-texto-suave md:table-cell">{c.capacidad ?? '—'}</TD>
                  <TD>
                    {c.plantillas.length === 0 ? (
                      <span className="text-xs text-texto-tenue">Sin ficha todavía: se escribe a mano al cotizar</span>
                    ) : (
                      <ul className="space-y-1">
                        {c.plantillas.map((p) => (
                          <li key={p.id} className="flex flex-wrap items-center gap-2">
                            <Link href={`/carrocerias/${p.id}`} className="text-acento hover:underline">
                              {p.nombre}
                            </Link>
                            {p.predeterminada && <Insignia tono="acento">Predeterminada</Insignia>}
                            <span className="text-[11px] text-texto-suave">
                              {p.lineas} líneas · {p.accesorios} accesorios
                              {p.fuentes.length > 0 && ` · ${p.fuentes.join(', ')}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TD>
                  <TD className="tabular hidden text-right text-texto-suave lg:table-cell">
                    {c.pasos_verificacion} pasos
                  </TD>
                </TR>
              ))
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}
