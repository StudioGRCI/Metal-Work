import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { DetalleEnTelefono, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { gastoOperativo, type LineaGastoOperativo } from '@/lib/datos/gasto-operativo'
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

/**
 * Lo que cada área gastó para trabajar y no se cargó a ninguna carrocería: lo
 * que salió del almacén para sus RQ del área, sus OS, sus subcontratos, la caja
 * y las horas cargadas a PLANTA. Gerencia y Administración ven todas las áreas;
 * cada supervisor, la suya y sin la mano de obra. Solo lectura.
 */
export default async function PaginaGastoOperativo({ searchParams }: PageProps<'/gasto-operativo'>) {
  const perfil = await exigirPermiso(['gasto_operativo.ver', 'gasto_operativo.area'])
  const params = await searchParams
  const pedido = typeof params.mes === 'string' ? params.mes : ''
  const mes = MES.test(pedido) ? pedido : hoyLima().slice(0, 7)
  const todas = puede(perfil, 'gasto_operativo.ver')

  const lineasDelMes = await gastoOperativo(`${mes}-01`, ultimoDia(mes))
  const areas = resumenPorArea(lineasDelMes)
  const pedida = todas && typeof params.area === 'string' ? params.area : null
  const area = pedida && areas.some((a) => a.clave === pedida) ? pedida : null
  const lineas = area ? lineasDelMes.filter((l) => (l.area_id ?? SIN_AREA) === area) : lineasDelMes

  const total = solesDe(lineasDelMes)
  const totalVisto = solesDe(lineas)
  const pendientes = pendientesDe(lineas)
  const grupos = GRUPOS_GASTO_OPERATIVO.filter((g) => todas || g.clave !== 'MANO_OBRA')
  const porGrupo = grupos
    .map((g) => ({ ...g, soles: solesDe(lineas.filter((l) => l.grupo === g.clave)) }))
    .filter((g) => g.soles !== 0)
  // En «Por área», solo las columnas con algo este mes: seis columnas con «—» no dicen nada.
  const columnas = grupos.filter((g) => areas.some((a) => a.porGrupo.has(g.clave)))
  const nombreDelMes = mesLargo(`${mes}-01`)
  const enlaceMes = (otro: string) => `/gasto-operativo?${new URLSearchParams({ mes: otro, ...(area ? { area } : {}) })}`
  const deArea = areas.find((a) => a.clave === area)?.area

  return (
    <>
      <EncabezadoPagina
        titulo="Gasto operativo"
        descripcion={
          todas
            ? 'Lo que cada área gastó para trabajar y no se cargó a ninguna carrocería.'
            : 'Lo que tu área gastó para trabajar y no se cargó a ninguna carrocería.'
        }
        ayuda={
          todas
            ? 'Es lo cargado a PLANTA: lo que salió del almacén para un RQ del área (al costo del kardex, el día que salió), las órdenes de servicio y los subcontratos de cada área, la caja y las horas del reporte diario con PLANTA. Lo comprado no se cuenta al comprarlo: entra al almacén y cuenta cuando sale, como en el costo de cada unidad. Lo que no tiene área (una salida a PLANTA sin RQ del área, la caja) va en «Planta, sin área».'
            : 'Lo que salió del almacén para los RQ de tu área (al costo del kardex, el día que salió), y las órdenes de servicio y los subcontratos de tu área con PLANTA. Lo comprado cuenta cuando sale del almacén. Las horas de tu gente las ven RR. HH. y Gerencia.'
        }
      />

      <div className="space-y-5">
        <nav aria-label="Mes" className="flex items-center gap-2">
          <Link
            href={enlaceMes(otroMes(mes, -1))}
            aria-label="Mes anterior"
            className="inline-flex size-11 items-center justify-center rounded-[var(--radius-base)] border border-borde text-texto hover:bg-superficie-2 sm:size-9"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Link>
          <span className="min-w-40 text-center text-base font-semibold text-texto first-letter:uppercase">{nombreDelMes}</span>
          <Link
            href={enlaceMes(otroMes(mes, 1))}
            aria-label="Mes siguiente"
            className="inline-flex size-11 items-center justify-center rounded-[var(--radius-base)] border border-borde text-texto hover:bg-superficie-2 sm:size-9"
          >
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        </nav>

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-cifras-gasto-operativo>
          <div className="col-span-2 rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2 lg:col-span-1">
            <dt className="text-xs text-texto-suave">{deArea ? `Gasto de ${deArea}` : todas ? 'Gasto operativo del mes' : 'Gasto de tu área'}</dt>
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

        <AvisoDePendientes {...pendientes} />

        {todas && areas.length > 0 && (
          <Tarjeta className="overflow-hidden" data-por-area>
            <TarjetaCabecera
              titulo="Por área"
              descripcion={`${plural(areas.length, 'área', 'áreas')} con gasto en ${nombreDelMes}.`}
              ayuda="Toca un área para ver solo lo suyo. Lo que todavía no suma (sin precio, por aprobar o en dólares sin el cambio del día) no entra en el total, y se cuenta aparte."
            />
            <div className="border-b border-borde px-4 py-3">
              <PastillaFiltro
                ruta="/gasto-operativo"
                clave="area"
                params={params}
                activo={area}
                etiqueta="Qué área mostrar"
                opciones={[{ valor: null, etiqueta: 'Todas' }, ...areas.map((a) => ({ valor: a.clave, etiqueta: a.area }))]}
              />
            </div>
            <Tabla>
              <TablaCabecera>
                <tr>
                  <TH>Área</TH>
                  {columnas.map((g) => (
                    <TH key={g.clave} className="hidden text-right lg:table-cell">
                      {g.corta}
                    </TH>
                  ))}
                  <TH className="text-right">Total</TH>
                </tr>
              </TablaCabecera>
              <tbody>
                {areas.map((a) => (
                  <TR key={a.clave} data-area={a.area} aria-current={a.clave === area ? 'true' : undefined}>
                    <TD>
                      <Link
                        href={`/gasto-operativo?${new URLSearchParams({ mes, area: a.clave })}`}
                        className="font-medium text-acento hover:underline"
                      >
                        {a.area}
                      </Link>
                      {a.pendientes > 0 && (
                        <span className="block text-xs text-aviso">{plural(a.pendientes, 'línea que todavía no suma', 'líneas que todavía no suman')}</span>
                      )}
                      <DetalleEnTelefono className="lg:hidden sm:block">
                        <span className="block text-xs text-texto-suave">
                          {columnas
                            .filter((g) => (a.porGrupo.get(g.clave) ?? 0) !== 0)
                            .map((g) => `${g.corta} ${moneda(a.porGrupo.get(g.clave))}`)
                            .join(' · ') || 'Nada que sume todavía'}
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
                ))}
              </tbody>
            </Tabla>
          </Tarjeta>
        )}

        <Tarjeta className="overflow-hidden" data-lineas-gasto-operativo>
          <TarjetaCabecera
            titulo={deArea ? `Lo que gastó ${deArea}` : 'Lo que se gastó'}
            descripcion={lineas.length === 0 ? `Nada en ${nombreDelMes}.` : `${plural(lineas.length, 'línea', 'líneas')} en ${nombreDelMes}, de la más nueva a la más vieja.`}
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
                  titulo={`Sin gasto operativo en ${nombreDelMes}`}
                  descripcion={
                    todas
                      ? 'Aparece aquí lo que sale del almacén para un RQ del área, y las OS, los subcontratos y la caja que llevan PLANTA.'
                      : 'Aparece aquí lo que sale del almacén para un RQ de tu área: en Requerimientos, «Nuevo requerimiento» y «Para el área (gasto operativo)».'
                  }
                />
              ) : (
                lineas.map((l, i) => <FilaDeGasto key={`${l.referencia_id ?? 'sin'}-${l.fuente}-${i}`} linea={l} conArea={todas} />)
              )}
            </tbody>
          </Tabla>
        </Tarjeta>
      </div>
    </>
  )
}

function AvisoDePendientes({ sinPrecio, sinCosto, porAprobar, sinCambio }: ReturnType<typeof pendientesDe>) {
  const partes = [
    sinPrecio > 0 && `${plural(sinPrecio, 'salida', 'salidas')} sin precio`,
    sinCosto > 0 && `${plural(sinCosto, 'línea de horas', 'líneas de horas')} de quien todavía no tiene costo`,
    porAprobar > 0 && `${plural(porAprobar, 'OS', 'OS')} por aprobar`,
    sinCambio > 0 && `${plural(sinCambio, 'línea', 'líneas')} en dólares sin el cambio del día`,
  ].filter(Boolean)
  if (partes.length === 0) return null
  return (
    <p className="rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-pendientes>
      Todavía no suman: {partes.join(', ')}. Entran al total cuando Logística ponga el precio, RR. HH. el costo, Gerencia apruebe la OS o se
      registre el cambio de ese día.
    </p>
  )
}

function FilaDeGasto({ linea: l, conArea }: { linea: LineaGastoOperativo; conArea: boolean }) {
  const cuanto = l.unidad && l.grupo === 'MATERIALES' ? `${cantidad(l.cantidad)} ${l.unidad}` : null
  const deQue = [etiquetaDelGrupo(l.grupo), cuanto, l.documento].filter(Boolean).join(' · ')
  return (
    <TR data-linea={l.fuente}>
      <TD className="max-w-96">
        <span className="block text-sm font-medium text-pretty text-texto">{l.concepto}</span>
        <span className="block text-xs text-texto-suave">{deQue}</span>
        {l.detalle && <span className="block text-xs text-pretty text-texto-suave">{l.detalle}</span>}
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
