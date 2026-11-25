import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { AccionesDeFila, DetalleEnTelefono, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { AccionesCatalogo } from '@/app/(app)/catalogos/acciones-catalogo'
import { EditarMedidas } from '@/app/(app)/configuracion/medidas-carroceria'
import { EditarCarroceria } from './editar-carroceria'
import { NuevaCarroceria } from '@/components/comercial/nueva-carroceria'
import { carroceriasConFicha } from '@/lib/datos/carrocerias'
import { resumenMedidas } from '@/lib/dominio/medidas-carroceria'
import { exigirPermiso, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'

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
 * verificación que el taller recorre. Acá se consulta qué ficha técnica y
 * equipamiento corresponden a cada tipo de carrocería, y Diseño corrige el
 * nombre, la descripción y las medidas técnicas (`diseno.carrocerias`,
 * migración 20261001213000). Ventas conserva el alta y el nombre para no
 * frenar una cotización.
 *
 * Por debajo de 768 px cada carrocería es una ficha (`<Tabla apilada>`): el
 * nombre, sus fichas técnicas debajo con todo el ancho y los botones en un
 * renglón. Como tabla de seis columnas en 390 px, las fichas quedaban en una
 * columna de 100 px —una palabra por renglón— y los tres botones apilados: la
 * página medía 9 856 px. Tipo, capacidad y verificación tienen columna donde
 * caben (`columna`); por debajo van en un renglón bajo el nombre, para que las
 * fichas técnicas y los botones tengan sitio sin que la tabla se deslice.
 */
export default async function PaginaCarrocerias({ searchParams }: PageProps<'/carrocerias'>) {
  const perfil = await exigirPermiso(['diseno.planos', 'configuracion.ver', 'cotizaciones.crear'])
  const params = await searchParams
  const incluirInactivas = params.estado === 'inactivas'
  const verDetalleTecnico = puede(perfil, ['diseno.planos', 'configuracion.ver'])
  const carrocerias = await carroceriasConFicha(incluirInactivas, verDetalleTecnico)
  const puedeEditar = puede(perfil, ['diseno.carrocerias', 'cotizaciones.crear'])
  const puedeMedidas = puede(perfil, 'diseno.carrocerias')
  const esAdmin = perfil.rol.codigo === 'ADMIN'
  // El ancho de la columna de botones, para que quepan en un renglón: sin él
  // la tabla le da el mínimo y quedan uno por renglón (`AccionesDeFila`).
  // Tipo, capacidad y verificación: con columna propia donde caben, y bajo el
  // nombre donde no. A Diseño, que lleva las fichas técnicas y tres botones, le
  // caben desde 1536 px: a 1440 con las seis columnas las fichas quedaban en
  // 310 px y la página medía 4 976 px; con tres, 3 900. A Ventas, desde 768.
  const columna = verDetalleTecnico ? 'hidden 2xl:table-cell' : 'hidden md:table-cell'
  const bajoElNombre = verDetalleTecnico ? 'sm:block 2xl:hidden' : 'sm:block md:hidden'
  const anchoAcciones = !puedeEditar ? undefined : esAdmin ? 'md:w-[27rem]' : puedeMedidas ? 'md:w-80' : 'md:w-56'

  const conFicha = carrocerias.filter((c) => c.plantillas.length > 0).length
  const fichas = carrocerias.reduce((n, c) => n + c.plantillas.length, 0)

  return (
    <>
      <EncabezadoPagina
        titulo="Carrocerías"
        descripcion={verDetalleTecnico
          ? `${carrocerias.length} carrocerías · ${conFicha} con ficha técnica · ${fichas} fichas en total.`
          : `${carrocerias.length} tipos de carrocería disponibles para cotizar.`}
        acciones={
          <div className="flex items-center gap-2">
            {puedeEditar && <NuevaCarroceria />}
            <Link href={incluirInactivas ? '/carrocerias' : '/carrocerias?estado=inactivas'} className="inline-flex min-h-11 items-center text-sm text-acento hover:underline sm:min-h-0">
              {incluirInactivas ? 'Ver activas' : 'Ver también desactivadas'}
            </Link>
          </div>
        }
      />

      <Tarjeta>
        <Tabla apilada>
          <TablaCabecera>
            <tr>
              <TH>Carrocería</TH>
              <TH className={columna}>Tipo</TH>
              <TH className={columna}>Capacidad</TH>
              {verDetalleTecnico && <TH>Fichas técnicas</TH>}
              {verDetalleTecnico && <TH className={cn('text-right', columna)}>Verificación</TH>}
              <TH className={cn('text-right', anchoAcciones)}>Acciones</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {carrocerias.length === 0 ? (
              <SinDatos titulo="El catálogo de carrocerías está vacío" colSpan={verDetalleTecnico ? 6 : 4} />
            ) : (
              carrocerias.map((c) => {
                // Lo que tiene columna en el monitor ancho; por debajo va bajo el nombre.
                const detalle = [
                  c.tipo_unidad ? TIPO_UNIDAD[c.tipo_unidad] ?? c.tipo_unidad : null,
                  c.capacidad ? `Capacidad ${c.capacidad}` : null,
                  verDetalleTecnico ? `${c.pasos_verificacion} pasos de verificación` : null,
                ].filter(Boolean)
                return (
                <TR key={c.id}>
                  <TD>
                    {/* El espacio deja partir entre el nombre y el código: pegados,
                        «Repotenciación REPOTENCIACION» fijaba la columna en 238 px
                        y le quitaba el ancho a las fichas técnicas. */}
                    <span className="font-medium">{c.nombre}</span>{' '}
                    <span className="ml-1 rounded bg-superficie-2 px-1 text-xs font-semibold text-texto-suave">
                      {c.codigo}
                    </span>
                    {!c.activo && <Insignia className="ml-1.5">Inactivo</Insignia>}
                    {verDetalleTecnico && (
                      <span className="block text-xs text-texto-suave">
                        {resumenMedidas(c) ?? 'Sin medidas técnicas'}
                      </span>
                    )}
                    {detalle.length > 0 && (
                      <DetalleEnTelefono data-detalle className={cn('text-xs text-texto-suave', bajoElNombre)}>
                        {detalle.join(' · ')}
                      </DetalleEnTelefono>
                    )}
                  </TD>
                  <TD className={cn('text-texto-suave', columna)}>
                    {c.tipo_unidad ? TIPO_UNIDAD[c.tipo_unidad] ?? c.tipo_unidad : '—'}
                  </TD>
                  <TD className={cn('text-texto-suave', columna)}>{c.capacidad ?? '—'}</TD>
                  {verDetalleTecnico && <TD data-rotulo="Fichas técnicas">
                    {c.plantillas.length === 0 ? (
                      <span className="text-xs text-texto-tenue">Sin ficha técnica registrada</span>
                    ) : (
                      <ul className="space-y-1">
                        {c.plantillas.map((p) => (
                          <li key={p.id} className="flex flex-wrap items-center gap-2">
                            <Link href={`/carrocerias/${p.id}`} className="text-acento hover:underline">
                              {p.nombre}
                            </Link>
                            {p.predeterminada && <Insignia tono="acento">Predeterminada</Insignia>}
                            <span className="text-xs text-texto-suave">
                              {p.lineas} líneas · {p.accesorios} accesorios
                              {p.fuentes.length > 0 && ` · ${p.fuentes.join(', ')}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TD>}
                  {verDetalleTecnico && <TD className={cn('tabular text-right text-texto-suave', columna)}>
                    {c.pasos_verificacion} pasos
                  </TD>}
                  <TD>
                    <AccionesDeFila>
                      {puedeEditar && <EditarCarroceria id={c.id} nombre={c.nombre} descripcion={c.descripcion} activo={c.activo} />}
                      {puedeMedidas && <EditarMedidas carroceria={c} conTexto />}
                      <AccionesCatalogo tipo="carroceria" id={c.id} nombre={c.nombre} activo={c.activo} puedeEditar={puedeEditar} esAdmin={esAdmin} enFila />
                    </AccionesDeFila>
                  </TD>
                </TR>
                )
              })
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}
