import { AlertTriangle, Camera, Plus } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Entrada } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { areasDelTaller } from '@/lib/datos/actividades'
import { listarFlota, type EstadoFlota } from '@/lib/datos/flota'
import { ESTADO_FLOTA, definir } from '@/lib/dominio/estados'
import { nombreDeFlota } from '@/lib/dominio/unidades'
import { fecha as formatearFecha, numero } from '@/lib/format'
import { areasDeSuMano, exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Unidades sin orden' }

const FILTROS = [
  { valor: null, etiqueta: 'En el taller' },
  { valor: 'LISTA', etiqueta: 'Listas' },
  { valor: 'SALIO', etiqueta: 'Salieron' },
]

/**
 * Todas las unidades que entraron sin orden, también las que ya salieron: es
 * el historial por placa que el supervisor busca cuando la misma tolva vuelve
 * la semana siguiente.
 */
export default async function PaginaFlota({ searchParams }: PageProps<'/avance/flota'>) {
  const perfil = await exigirPermiso('produccion.ver')
  const params = await searchParams

  const estado =
    params.estado === 'LISTA' || params.estado === 'SALIO' ? (params.estado as EstadoFlota) : null
  const placa = typeof params.placa === 'string' ? params.placa.trim() : ''

  const [unidades, areas] = await Promise.all([listarFlota({ estado, placa }), areasDelTaller()])
  const puedeRegistrar = puede(perfil, 'produccion.actividades') && areasDeSuMano(perfil, areas).length > 0

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Avance en taller', ruta: '/avance' }, { titulo: 'Unidades sin orden' }]}
        titulo="Unidades sin orden"
        descripcion="Las que entraron al taller sin orden de trabajo en el sistema. Se reportan igual, para que el jefe y la oficina sepan que están acá."
        acciones={
          puedeRegistrar && (
            <EnlaceBoton href="/avance/flota/nueva">
              <Plus aria-hidden className="size-4" />
              Llegó una unidad sin orden
            </EnlaceBoton>
          )
        }
      />

      <form method="get" className="mb-3 flex flex-wrap items-center gap-3">
        {estado && <input type="hidden" name="estado" value={estado} />}
        <Entrada
          type="search"
          name="placa"
          defaultValue={placa}
          placeholder="Buscar por placa…"
          aria-label="Buscar por placa"
          autoComplete="off"
          className="w-full sm:w-64"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 items-center text-sm text-acento hover:underline sm:min-h-0"
        >
          Buscar
        </button>
      </form>

      <PastillaFiltro
        ruta="/avance/flota"
        clave="estado"
        opciones={FILTROS}
        params={params}
        activo={estado}
        etiqueta="Filtrar por estado"
        className="mb-4"
      />

      <Tarjeta>
        <TarjetaCuerpo className="p-0">
          {unidades.length === 0 ? (
            <SinDatos
              titulo={
                placa
                  ? `Ninguna unidad con «${placa}»`
                  : estado === 'SALIO'
                    ? 'Todavía no salió ninguna unidad'
                    : estado === 'LISTA'
                      ? 'No hay unidades listas esperando al cliente'
                      : 'Ninguna unidad sin orden en el taller'
              }
              descripcion={
                puedeRegistrar
                  ? 'Cuando llegue una, regístrala con el botón de arriba.'
                  : 'Las registra el supervisor de cada área.'
              }
            />
          ) : (
            <Tabla>
              <TablaCabecera>
                <TR>
                  <TH>Unidad</TH>
                  <TH>A qué entró</TH>
                  <TH>Área actual</TH>
                  <TH>Último reporte</TH>
                  <TH className="text-right">Lleva</TH>
                  <TH>Estado</TH>
                </TR>
              </TablaCabecera>
              <tbody>
                {unidades.map((u) => {
                  const est = definir(ESTADO_FLOTA, u.estado)
                  const dias = Number(u.dias_en_taller ?? 0)
                  return (
                    <TR key={u.id}>
                      <TD className="align-top">
                        <Link
                          href={`/avance/flota/${u.id}`}
                          className="text-sm font-medium text-acento hover:underline"
                        >
                          {nombreDeFlota(u)}
                        </Link>
                        <p className="text-[11px] text-texto-suave">
                          {[u.placa ? u.descripcion : null, u.cliente].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </TD>
                      <TD className="align-top">
                        <p className="line-clamp-2 text-sm text-texto">{u.trabajo}</p>
                        {u.impedimento && (
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-peligro">
                            <AlertTriangle aria-hidden className="size-3" />
                            <span className="line-clamp-1">{u.impedimento}</span>
                          </p>
                        )}
                      </TD>
                      <TD className="align-top text-sm text-texto-suave">{u.area_actual ?? '—'}</TD>
                      <TD className="align-top text-xs text-texto-suave">
                        {u.ultimo_avance_fecha ? (
                          <>
                            {formatearFecha(u.ultimo_avance_fecha)}
                            {u.avance_porcentaje !== null && (
                              <span className="ml-1 text-texto-tenue">
                                · va en ~{numero(u.avance_porcentaje, 0)} %
                              </span>
                            )}
                            <span className="ml-2 inline-flex items-center gap-0.5 text-texto-tenue">
                              <Camera aria-hidden className="size-3" />
                              {u.fotos}
                            </span>
                          </>
                        ) : (
                          <span className="text-aviso">sin reportes</span>
                        )}
                      </TD>
                      <TD className="align-top text-right tabular text-sm">
                        {u.estado === 'SALIO'
                          ? `salió ${formatearFecha(u.salio_en)}`
                          : `${dias} ${dias === 1 ? 'día' : 'días'}`}
                      </TD>
                      <TD className="align-top">
                        <Insignia tono={est.tono}>{est.etiqueta}</Insignia>
                      </TD>
                    </TR>
                  )
                })}
              </tbody>
            </Tabla>
          )}
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
