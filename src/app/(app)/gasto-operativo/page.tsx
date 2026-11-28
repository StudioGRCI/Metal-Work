import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { DetalleEnTelefono, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { gastoOperativo, nombreDelArea, type LineaGastoOperativo } from '@/lib/datos/gasto-operativo'
import {
  GRUPOS_GASTO_OPERATIVO,
  MES,
  SIN_AREA,
  etiquetaDelGrupo,
  otroMes,
  pendientesDe,
  resumenPorArea,
  solesDe,
  ultimoDia,
} from '@/lib/dominio/gasto-operativo'
import { cantidad, fecha, hoyLima, mesLargo, moneda, parteDe, porcentaje } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Gasto operativo' }

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FLECHA =
  'inline-flex size-11 items-center justify-center rounded-[var(--radius-base)] border border-borde text-texto hover:bg-superficie-2 sm:size-9'

/** Cómo se abre el documento de una línea, para quien puede abrirlo. */
type Enlaces = { rq: boolean; os: boolean }

/**
 * Lo que cada área gastó para trabajar y no se cargó a ninguna carrocería: lo
 * que salió del almacén para sus RQ del área, sus OS, sus subcontratos, la caja
 * y las horas cargadas a PLANTA. Gerencia y Administración ven todas las áreas;
 * cada supervisor, la suya y solo herramientas e insumos y OS. Solo lectura.
 */
export default async function PaginaGastoOperativo({ searchParams }: PageProps<'/gasto-operativo'>) {
  const perfil = await exigirPermiso(['gasto_operativo.ver', 'gasto_operativo.area'])
  const params = await searchParams
  const hoy = hoyLima().slice(0, 7)
  const pedido = typeof params.mes === 'string' ? params.mes : ''
  // El mes que viene todavía no gastó nada: no se navega más allá del de hoy.
  const mes = MES.test(pedido) && pedido <= hoy ? pedido : hoy
  const todas = puede(perfil, 'gasto_operativo.ver')
  // El área elegida se respeta aunque ese mes no tenga gasto: al cambiar de mes
  // se perdía y salía el de toda la empresa sin decirlo (auditoría de diseño, 27/11).
  const pedida = todas && typeof params.area === 'string' && (params.area === SIN_AREA || UUID.test(params.area)) ? params.area : null

  // Sin área no hay qué gasto mostrarle: la base lo rechaza, y aquí se dice sin llamarla.
  if (!todas && !perfil.area_id) {
    return (
      <>
        <EncabezadoPagina titulo="Gasto operativo" />
        <Tarjeta>
          <SinDatos
            enTabla={false}
            titulo="Tu cuenta no tiene área"
            descripcion="El gasto operativo se ve por área. Pide al administrador del sistema que le ponga a tu cuenta el área en la que trabajas."
          />
        </Tarjeta>
      </>
    )
  }

  const [lineasDelMes, nombrePedido, nombreMio] = await Promise.all([
    gastoOperativo(`${mes}-01`, ultimoDia(mes)),
    pedida && pedida !== SIN_AREA ? nombreDelArea(pedida) : Promise.resolve(null),
    !todas && perfil.area_id ? nombreDelArea(perfil.area_id) : Promise.resolve(null),
  ])
  const area = pedida === SIN_AREA || nombrePedido ? pedida : null
  const deArea = area === SIN_AREA ? 'Planta, sin área' : (nombrePedido ?? undefined)
  const areas = resumenPorArea(lineasDelMes)
  const lineas = area ? lineasDelMes.filter((l) => (l.area_id ?? SIN_AREA) === area) : lineasDelMes

  const total = solesDe(lineasDelMes)
  const totalVisto = solesDe(lineas)
  // El supervisor no ve la mano de obra ni los subcontratos: la base no se los da.
  const grupos = GRUPOS_GASTO_OPERATIVO.filter((g) => todas || (g.clave !== 'MANO_OBRA' && g.clave !== 'SUBCONTRATOS'))
  const porGrupo = grupos
    .map((g) => ({ ...g, soles: solesDe(lineas.filter((l) => l.grupo === g.clave)) }))
    .filter((g) => g.soles !== 0)
  // En «Por área», solo las columnas con algo este mes: seis columnas con «—» no dicen nada.
  const columnas = grupos.filter((g) => areas.some((a) => a.porGrupo.has(g.clave)))
  const nombreDelMes = mesLargo(`${mes}-01`)
  const enlaceMes = (otro: string) => `/gasto-operativo?${new URLSearchParams({ mes: otro, ...(area ? { area } : {}) })}`
  const suArea = nombreMio ?? 'tu área'
  const enlaces: Enlaces = {
    rq: puede(perfil, ['requerimientos.ver', 'requerimientos.administracion', 'requerimientos.area']),
    os: puede(perfil, ['compras.ver', 'compras.crear']),
  }

  return (
    <>
      <EncabezadoPagina
        titulo={todas ? 'Gasto operativo' : `Gasto operativo de ${suArea}`}
        ayuda={
          todas
            ? 'Lo que cada área gastó para trabajar y no se cargó a ninguna carrocería: lo cargado a PLANTA. Entra lo que salió del almacén para un RQ del área (al costo del kardex, el día que salió), las órdenes de servicio y los subcontratos de cada área, la caja y las horas del reporte diario con PLANTA. Lo comprado no se cuenta al comprarlo: entra al almacén y cuenta cuando sale, como en el costo de cada unidad; de la compra solo entran el día de su documento la nota de crédito que la rebaja y el IGV de una boleta, que no se recupera. Lo que no tiene área (una salida a PLANTA sin RQ del área, la caja) va en «Planta, sin área».'
            : `Lo que ${suArea} gastó para trabajar y no se cargó a ninguna carrocería: lo que salió del almacén para sus RQ del área (al costo del kardex, el día que salió), y sus órdenes de servicio con PLANTA. Lo comprado cuenta cuando sale del almacén. Las horas de la gente y los subcontratos los ven Gerencia y Administración.`
        }
      />

      <div className="space-y-5">
        <nav aria-label="Mes" className="flex items-center gap-2">
          {mes > '2000-01' ? (
            <Link href={enlaceMes(otroMes(mes, -1))} aria-label="Mes anterior" className={FLECHA}>
              <ChevronLeft aria-hidden className="size-4" />
            </Link>
          ) : (
            <span aria-hidden className={`${FLECHA} pointer-events-none opacity-40`}>
              <ChevronLeft className="size-4" />
            </span>
          )}
          <span className="min-w-40 text-center text-base font-semibold text-texto first-letter:uppercase">{nombreDelMes}</span>
          {mes < hoy ? (
            <Link href={enlaceMes(otroMes(mes, 1))} aria-label="Mes siguiente" className={FLECHA}>
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : (
            <span aria-hidden className={`${FLECHA} pointer-events-none opacity-40`}>
              <ChevronRight className="size-4" />
            </span>
          )}
        </nav>

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-cifras-gasto-operativo>
          <div className="col-span-2 rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2 lg:col-span-1">
            <dt className="text-xs text-texto-suave">{deArea ? `Gasto de ${deArea}` : todas ? 'Gasto operativo del mes' : `Gasto de ${suArea}`}</dt>
            <dd className="tabular mt-1 text-lg font-semibold text-texto" data-total>
              {moneda(totalVisto)}
            </dd>
            {deArea && total > 0 && (
              <dd className="text-xs text-texto-suave">
                {porcentaje(parteDe(totalVisto, total))} de los <span className="tabular">{moneda(total)}</span> del mes
              </dd>
            )}
          </div>
          {porGrupo.map((g) => (
            <div key={g.clave} className="rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2" data-grupo={g.clave}>
              <dt className="text-xs text-texto-suave">{g.etiqueta}</dt>
              <dd className="tabular mt-1 text-lg font-semibold text-texto">{moneda(g.soles)}</dd>
            </div>
          ))}
        </dl>

        <AvisoDePendientes {...pendientesDe(lineas)} enlaceOs={enlaces.os} />

        {todas && (areas.length > 0 || area) && (
          <Tarjeta className="overflow-hidden" data-por-area>
            <TarjetaCabecera
              titulo="Por área"
              descripcion={areas.length ? `${plural(areas.length, 'área', 'áreas')} con gasto en ${nombreDelMes}.` : `Ninguna área tuvo gasto en ${nombreDelMes}.`}
              ayuda="Toca un área para ver solo lo suyo. Lo que todavía no suma (sin precio, por aprobar o en dólares sin el cambio del día) no entra en el total, y se cuenta aparte."
            />
            <div className="border-b border-borde px-4 py-3">
              <PastillaFiltro
                ruta="/gasto-operativo"
                clave="area"
                params={params}
                activo={area}
                etiqueta="Qué área mostrar"
                opciones={[
                  { valor: null, etiqueta: 'Todas' },
                  ...areas.map((a) => ({ valor: a.clave, etiqueta: a.area })),
                  // La elegida sin gasto este mes sigue en la lista, para quitarla.
                  ...(area && deArea && !areas.some((a) => a.clave === area) ? [{ valor: area, etiqueta: deArea }] : []),
                ]}
              />
            </div>
            {areas.length > 0 && (
              <Tabla>
                <TablaCabecera>
                  <tr>
                    <TH>Área</TH>
                    {columnas.map((g) => (
                      <TH key={g.clave} className="hidden text-right lg:table-cell">
                        {g.etiqueta}
                      </TH>
                    ))}
                    <TH className="text-right">Total</TH>
                  </tr>
                </TablaCabecera>
                <tbody>
                  {areas.map((a) => {
                    const elegida = a.clave === area
                    return (
                      <TR key={a.clave} data-area={a.area} aria-current={elegida ? 'true' : undefined} className={elegida ? 'bg-acento-suave' : undefined}>
                        <TD>
                          <Link
                            href={`/gasto-operativo?${new URLSearchParams({ mes, area: a.clave })}`}
                            className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0"
                          >
                            {a.area}
                          </Link>
                          {a.pendientes > 0 && (
                            <span className="block text-xs text-aviso">{plural(a.pendientes, 'línea que todavía no suma', 'líneas que todavía no suman')}</span>
                          )}
                          <DetalleEnTelefono className="sm:block lg:hidden">
                            <span className="block text-xs text-texto-suave">
                              {columnas
                                .filter((g) => (a.porGrupo.get(g.clave) ?? 0) !== 0)
                                .map((g) => `${g.etiqueta}: ${moneda(a.porGrupo.get(g.clave))}`)
                                .join(' · ') || (a.pendientes > 0 ? '' : 'Nada que sume todavía')}
                            </span>
                          </DetalleEnTelefono>
                        </TD>
                        {columnas.map((g) => (
                          <TD key={g.clave} className="tabular hidden text-right whitespace-nowrap lg:table-cell">
                            {a.porGrupo.has(g.clave) ? moneda(a.porGrupo.get(g.clave)) : <span className="text-texto-tenue">—</span>}
                          </TD>
                        ))}
                        <TD className="tabular text-right font-semibold whitespace-nowrap">
                          {moneda(a.total)}
                          {total > 0 && <span className="block text-xs font-normal text-texto-suave">{porcentaje(parteDe(a.total, total))}</span>}
                        </TD>
                      </TR>
                    )
                  })}
                </tbody>
              </Tabla>
            )}
          </Tarjeta>
        )}

        <Tarjeta className="overflow-hidden" data-lineas-gasto-operativo>
          <TarjetaCabecera
            titulo={deArea ? `Lo que gastó ${deArea}` : 'Lo que se gastó'}
            descripcion={lineas.length > 0 ? `${plural(lineas.length, 'línea', 'líneas')} en ${nombreDelMes}, de la más nueva a la más vieja.` : undefined}
          />
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Qué</TH>
                {todas && <TH className="hidden md:table-cell">Área</TH>}
                <TH className="hidden sm:table-cell">Fecha</TH>
                <TH className="text-right">Monto</TH>
              </tr>
            </TablaCabecera>
            <tbody>
              {lineas.length === 0 ? (
                <SinDatos
                  colSpan={todas ? 4 : 3}
                  titulo={deArea ? `${deArea} no tuvo gasto operativo en ${nombreDelMes}` : `Sin gasto operativo en ${nombreDelMes}`}
                  descripcion={
                    todas
                      ? 'Aparece aquí lo que sale del almacén para un RQ del área, y las OS, los subcontratos y la caja que llevan PLANTA.'
                      : `Aparece aquí lo que sale del almacén para un RQ de ${suArea}: en Requerimientos, «Nuevo requerimiento» y «Para ${nombreMio ?? 'tu área'} (gasto operativo)».`
                  }
                  accion={
                    !todas && puede(perfil, 'requerimientos.area') ? (
                      <EnlaceBoton href="/requerimientos" variante="contorno" tamano="sm">
                        Ir a Requerimientos
                      </EnlaceBoton>
                    ) : undefined
                  }
                />
              ) : (
                lineas.map((l, i) => <FilaDeGasto key={`${l.referencia_id ?? 'sin'}-${l.fuente}-${i}`} linea={l} conArea={todas} enlaces={enlaces} />)
              )}
            </tbody>
          </Tabla>
        </Tarjeta>
      </div>
    </>
  )
}

/** Lo que todavía no suma, cada causa con lo que falta para que sume; solo las que hay. */
function AvisoDePendientes({ sinPrecio, sinCosto, porAprobar, sinCambio, enlaceOs }: ReturnType<typeof pendientesDe> & { enlaceOs: boolean }) {
  const partes = [
    sinPrecio > 0 && <span key="p">{plural(sinPrecio, 'salida sin precio, hasta que Logística le ponga uno', 'salidas sin precio, hasta que Logística les ponga uno')}</span>,
    sinCosto > 0 && <span key="c">{plural(sinCosto, 'línea de horas de quien todavía no tiene costo, hasta que RR. HH. se lo ponga', 'líneas de horas de quien todavía no tiene costo, hasta que RR. HH. se lo ponga')}</span>,
    porAprobar > 0 && (
      <span key="a">
        {enlaceOs ? (
          <Link href="/compras/servicios?codigo=PLANTA" className="font-medium text-acento hover:underline">
            {plural(porAprobar, 'OS por aprobar', 'OS por aprobar')}
          </Link>
        ) : (
          plural(porAprobar, 'OS por aprobar', 'OS por aprobar')
        )}
        , hasta que Gerencia {porAprobar === 1 ? 'la apruebe' : 'las apruebe'}
      </span>
    ),
    sinCambio > 0 && <span key="d">{plural(sinCambio, 'línea en dólares, hasta que se registre el cambio de su día', 'líneas en dólares, hasta que se registre el cambio de su día')}</span>,
  ].filter(Boolean)
  if (partes.length === 0) return null
  return (
    <p className="rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-pendientes>
      Todavía no suman:{' '}
      {partes.map((p, i) => (
        <span key={i}>
          {i > 0 && '; '}
          {p}
        </span>
      ))}
      .
    </p>
  )
}

function FilaDeGasto({ linea: l, conArea, enlaces }: { linea: LineaGastoOperativo; conArea: boolean; enlaces: Enlaces }) {
  const cuanto = l.unidad && l.grupo === 'MATERIALES' ? `${cantidad(l.cantidad)} ${l.unidad}` : null
  const enlace =
    l.documento && l.requerimiento_id && enlaces.rq
      ? `/requerimientos?rq=${l.requerimiento_id}`
      : l.documento && l.grupo === 'SERVICIOS' && enlaces.os
        ? `/compras/servicios?codigo=PLANTA`
        : null
  // «Entrega del RQ-0003-2026» repite el número que ya va al lado.
  const detalle = l.detalle && !(l.documento && l.detalle === `Entrega del ${l.documento}`) ? l.detalle : null
  return (
    <TR data-linea={l.fuente}>
      <TD className="max-w-96">
        <span className="block text-sm font-medium text-pretty text-texto">{l.concepto}</span>
        <span className="block text-xs text-texto-suave">
          {[etiquetaDelGrupo(l.grupo), cuanto].filter(Boolean).join(' · ')}
          {l.documento && (
            <>
              {' · '}
              {enlace ? (
                <Link href={enlace} className="-my-3 inline-block py-3 whitespace-nowrap text-acento hover:underline">
                  {l.documento}
                </Link>
              ) : (
                l.documento
              )}
            </>
          )}
        </span>
        {detalle && <span className="block text-xs text-pretty text-texto-suave">{detalle}</span>}
        {/* La fecha baja aquí por debajo de sm, y el área por debajo de md: sus columnas no caben. */}
        <DetalleEnTelefono className={conArea ? 'sm:block md:hidden' : undefined}>
          <span className="block text-xs text-texto-suave">
            <span className="sm:hidden">{fecha(l.fecha)}</span>
            {conArea && (
              <>
                <span className="sm:hidden"> · </span>
                {l.area}
              </>
            )}
          </span>
        </DetalleEnTelefono>
      </TD>
      {conArea && <TD className="hidden text-sm md:table-cell">{l.area}</TD>}
      <TD className="tabular hidden text-sm whitespace-nowrap sm:table-cell">{fecha(l.fecha)}</TD>
      <TD className="tabular text-right whitespace-nowrap">
        <Monto linea={l} />
      </TD>
    </TR>
  )
}

function Monto({ linea: l }: { linea: LineaGastoOperativo }) {
  if (l.fuente === 'MATERIALES_SIN_PRECIO') return <Insignia tono="aviso">Sin precio</Insignia>
  if (l.fuente === 'MANO_OBRA_SIN_COSTO') return <Insignia tono="aviso">Sin costo</Insignia>
  if (!l.suma) {
    return (
      <>
        <span className="text-texto-suave">{moneda(l.monto, l.moneda ?? 'PEN')}</span>
        <Insignia tono="aviso" className="mt-1 ml-auto flex w-fit">
          {l.fuente === 'SERVICIOS_POR_APROBAR' ? 'Por aprobar' : 'No suma'}
        </Insignia>
      </>
    )
  }
  if (l.soles === null) {
    return (
      <>
        <span>{moneda(l.monto, 'USD')}</span>
        <Insignia tono="aviso" className="mt-1 ml-auto flex w-fit">
          Sin cambio
        </Insignia>
      </>
    )
  }
  return (
    <>
      <span>{moneda(l.soles)}</span>
      {l.moneda === 'USD' && <span className="block text-xs text-texto-suave">{moneda(l.monto, 'USD')} al cambio</span>}
    </>
  )
}
