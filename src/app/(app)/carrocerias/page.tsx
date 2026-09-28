import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { AccionesCatalogo } from '@/app/(app)/catalogos/acciones-catalogo'
import { EditarCarroceria } from './editar-carroceria'
import { NuevaCarroceria } from '@/components/comercial/nueva-carroceria'
import { carroceriasConFicha } from '@/lib/datos/carrocerias'
import { exigirPermiso, puede } from '@/lib/sesion'

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
 * equipamiento corresponden a cada tipo de carrocería.
 */
export default async function PaginaCarrocerias({ searchParams }: PageProps<'/carrocerias'>) {
  const perfil = await exigirPermiso(['diseno.planos', 'configuracion.ver', 'cotizaciones.crear'])
  const params = await searchParams
  const incluirInactivas = params.estado === 'inactivas'
  const verDetalleTecnico = puede(perfil, ['diseno.planos', 'configuracion.ver'])
  const carrocerias = await carroceriasConFicha(incluirInactivas, verDetalleTecnico)
  const puedeEditar = puede(perfil, ['configuracion.editar', 'cotizaciones.crear'])

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
            <Link href={incluirInactivas ? '/carrocerias' : '/carrocerias?estado=inactivas'} className="text-sm text-acento hover:underline">
              {incluirInactivas ? 'Ver activas' : 'Ver también desactivadas'}
            </Link>
          </div>
        }
      />

      <Tarjeta>
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Carrocería</TH>
              <TH className="hidden sm:table-cell">Tipo</TH>
              <TH className="hidden md:table-cell">Capacidad</TH>
              {verDetalleTecnico && <TH>Fichas técnicas</TH>}
              {verDetalleTecnico && <TH className="hidden lg:table-cell text-right">Verificación</TH>}
              <TH>Acciones</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {carrocerias.length === 0 ? (
              <SinDatos titulo="El catálogo de carrocerías está vacío" colSpan={verDetalleTecnico ? 6 : 4} />
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
                  {verDetalleTecnico && <TD>
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
                            <span className="text-[11px] text-texto-suave">
                              {p.lineas} líneas · {p.accesorios} accesorios
                              {p.fuentes.length > 0 && ` · ${p.fuentes.join(', ')}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TD>}
                  {verDetalleTecnico && <TD className="tabular hidden text-right text-texto-suave lg:table-cell">
                    {c.pasos_verificacion} pasos
                  </TD>}
                  <TD>
                    <div className="space-y-2">
                      {puedeEditar && <EditarCarroceria id={c.id} nombre={c.nombre} descripcion={c.descripcion} activo={c.activo} />}
                      <AccionesCatalogo tipo="carroceria" id={c.id} nombre={c.nombre} activo={c.activo} puedeEditar={puedeEditar} esAdmin={perfil.rol.codigo === 'ADMIN'} />
                    </div>
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
