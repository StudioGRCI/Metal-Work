import { Download, FileSpreadsheet } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Paginacion } from '@/components/estructura/paginacion'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarAtencionMateriales } from '@/lib/datos/atencion-materiales'
import { cargarKardex, FILAS_POR_PAGINA, filtrosDeKardex, materialesDelKardex, unidadesParaSalida } from '@/lib/datos/kardex'
import { MOVIMIENTO_KARDEX, ORIGEN_KARDEX } from '@/lib/dominio/almacen'
import { cantidad, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

import { ConteoFisico } from './conteo'
import { NuevoIngreso } from './ingreso'
import { CargarPlanilla } from './planilla'
import { NuevaSalida } from './salida'

export const metadata = { title: 'Kardex de Almacén' }

const TIPOS = [
  { valor: null, etiqueta: 'Todo' },
  { valor: 'INGRESO', etiqueta: 'Ingresos' },
  { valor: 'SALIDA', etiqueta: 'Egresos' },
  { valor: 'AJUSTE', etiqueta: 'Ajustes' },
]

/**
 * El kardex del almacenero: cada ingreso, cada egreso y cada ajuste de conteo,
 * con el saldo que queda después. Elegido un material se lee como la ficha de
 * papel; sin material es el historial de movimientos de todo el almacén.
 */
export default async function PaginaKardex({ searchParams }: PageProps<'/almacen/kardex'>) {
  const perfil = await exigirPermiso('almacen.ver')
  const params = await searchParams

  const filtros = filtrosDeKardex(params)
  const pagina = filtros.pagina

  const puedeSalida = puede(perfil, 'almacen.despachar')
  const puedeIngreso = puede(perfil, 'almacen.recibir')
  const db = await createClient()

  const [kardex, materiales, unidades, catalogo, entregas] = await Promise.all([
    cargarKardex(filtros),
    materialesDelKardex(),
    puedeSalida ? unidadesParaSalida() : Promise.resolve([]),
    puedeIngreso
      ? cargarAtencionMateriales({ verRequerimientos: false, verExistencias: true, verCompras: false, crearCompra: false, recibir: false, despachar: false })
      : Promise.resolve(null),
    // Lo que se puede devolver: las últimas entregas, de OT o por unidad.
    puedeIngreso
      ? db.from('v_kardex_almacen').select('id,material,unidad_medida,salida,codigo_unidad,fecha')
          .in('movimiento', ['DESPACHO', 'SALIDA']).order('fecha', { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (entregas.error) throw new Error('No se pudieron cargar las entregas que se pueden devolver.')

  const { filas, total, cronologico } = kardex
  const saldoPorMaterial = new Map(materiales.map((m) => [m.material_id, m.existencia]))
  const elegido = filtros.material ? materiales.find((m) => m.material_id === filtros.material) : undefined
  const paginas = Math.max(1, Math.ceil(total / FILAS_POR_PAGINA))
  const entradas = filas.reduce((s, f) => s + Number(f.entrada ?? 0), 0)
  const salidas = filas.reduce((s, f) => s + Number(f.salida ?? 0), 0)
  const primera = filas[0]
  const saldoAnterior = cronologico && primera
    ? Number(primera.saldo ?? 0) - Number(primera.entrada ?? 0) + Number(primera.salida ?? 0)
    : null
  // El Excel baja con los mismos filtros que la pantalla, sin la página.
  const consultaExcel = new URLSearchParams(Object.entries({
    material: filtros.material, tipo: filtros.tipo, desde: filtros.desde, hasta: filtros.hasta, unidad: filtros.unidad,
  }).filter((e): e is [string, string] => Boolean(e[1]))).toString()
  const hayFiltros = Boolean(filtros.material || filtros.tipo || filtros.desde || filtros.hasta || filtros.unidad)

  return (
    <>
      <EncabezadoPagina
        titulo="Kardex de Almacén"
        descripcion="Ingresos, egresos e historial de movimientos con el saldo de cada material. Toda salida queda vinculada a un vehículo o al código de su unidad."
        acciones={(puedeSalida || puedeIngreso) && (
          <div className="flex flex-wrap items-start gap-2">
            {puedeSalida && (
              <NuevaSalida
                materiales={materiales.map((m) => ({ id: m.material_id, codigo: m.codigo, descripcion: m.descripcion, unidad: m.unidad, disponible: m.disponible }))}
                unidades={unidades.filter((u): u is typeof u & { id: string } => Boolean(u.id)).map((u) => ({
                  id: u.id, nombre: u.nombre ?? 'Unidad', vehiculo: u.vehiculo, ordenes: u.ordenes,
                }))}
              />
            )}
            {puedeIngreso && catalogo && (
              <ConteoFisico materiales={catalogo.catalogoAlmacen.map((m) => ({
                ...m, saldo: saldoPorMaterial.get(m.id) ?? 0,
              }))} />
            )}
            {puedeIngreso && catalogo && (
              <NuevoIngreso
                materiales={catalogo.catalogoAlmacen}
                despachos={(entregas.data ?? []).filter((e) => e.id).map((e) => ({
                  id: e.id as string,
                  etiqueta: `${e.material ?? 'Material'} · ${e.codigo_unidad ?? 'sin unidad'} · ${cantidad(e.salida)} ${e.unidad_medida ?? ''} · ${fechaHora(e.fecha)}`,
                }))}
              />
            )}
          </div>
        )}
      />

      {(puedeSalida || puedeIngreso) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-base)] border border-dashed border-borde-fuerte bg-superficie px-4 py-3">
          <p className="min-w-0 flex-1 basis-72 text-sm text-texto-suave">
            <span className="font-medium text-texto">¿Sin internet?</span> Descarga la planilla, anota en Excel los ingresos y las salidas, y cárgala al volver la señal: cada movimiento entra con su fecha.
          </p>
          <a href="/almacen/kardex/planilla" download
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-base)] border border-borde-fuerte px-3 text-sm font-medium text-texto hover:bg-superficie-2 sm:min-h-9">
            <FileSpreadsheet aria-hidden className="size-4" />Descargar planilla
          </a>
          <CargarPlanilla />
        </div>
      )}

      <Tarjeta className="mb-4">
        <TarjetaCuerpo>
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1.5fr_auto] lg:items-end">
            {filtros.tipo && <input type="hidden" name="tipo" value={filtros.tipo} />}
            <Campo etiqueta="Material" htmlFor="k-material">
              <Seleccion id="k-material" name="material" defaultValue={filtros.material ?? ''}>
                <option value="">Todo el almacén</option>
                {materiales.map((m) => (
                  <option key={m.material_id} value={m.material_id}>{m.descripcion} · {m.codigo}</option>
                ))}
              </Seleccion>
            </Campo>
            <Campo etiqueta="Desde" htmlFor="k-desde">
              <Entrada id="k-desde" name="desde" type="date" defaultValue={filtros.desde ?? ''} />
            </Campo>
            <Campo etiqueta="Hasta" htmlFor="k-hasta">
              <Entrada id="k-hasta" name="hasta" type="date" defaultValue={filtros.hasta ?? ''} />
            </Campo>
            <Campo etiqueta="Unidad o código" htmlFor="k-unidad">
              <Entrada id="k-unidad" name="unidad" type="search" defaultValue={filtros.unidad ?? ''} placeholder="Placa o código interno" autoComplete="off" />
            </Campo>
            <div className="flex items-center gap-3">
              <button type="submit" className="inline-flex min-h-11 items-center rounded-[var(--radius-base)] bg-acento px-4 text-sm font-medium text-acento-texto hover:opacity-90 sm:min-h-9">
                Ver
              </button>
              {hayFiltros && <Link href="/almacen/kardex" className="text-sm text-acento hover:underline">Limpiar</Link>}
            </div>
          </form>
          <PastillaFiltro
            ruta="/almacen/kardex"
            clave="tipo"
            opciones={TIPOS}
            params={params}
            activo={filtros.tipo ?? null}
            etiqueta="Tipo de movimiento"
            className="mt-3"
          />
        </TarjetaCuerpo>
      </Tarjeta>

      {elegido && (
        <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cifra etiqueta={`Saldo en almacén (${elegido.unidad ?? 's/u'})`} valor={cantidad(elegido.existencia)} />
          <Cifra etiqueta="Libre para salidas" valor={cantidad(elegido.disponible)} acento />
          <Cifra etiqueta={total > filas.length ? 'Entradas en lo mostrado' : 'Entradas del periodo'} valor={cantidad(entradas)} />
          <Cifra etiqueta={total > filas.length ? 'Egresos en lo mostrado' : 'Egresos del periodo'} valor={cantidad(salidas)} />
        </dl>
      )}

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo={elegido ? `${elegido.descripcion} · ${elegido.codigo}` : 'Historial de movimientos'}
          descripcion={elegido
            ? 'En orden de fecha, como la ficha de kardex. El saldo es lo que quedó en almacén tras cada movimiento.'
            : 'Lo último primero. El saldo es el del material en ese momento; elige un material para ver su ficha.'}
          acciones={
            <a href={`/almacen/kardex/excel${consultaExcel ? `?${consultaExcel}` : ''}`} download
              className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-base)] border border-borde-fuerte px-3 text-sm font-medium text-texto hover:bg-superficie-2 sm:min-h-9">
              <Download aria-hidden className="size-4" />Descargar Excel
            </a>
          }
        />
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Fecha</TH>
              {!elegido && <TH>Material</TH>}
              <TH>Movimiento</TH>
              <TH className="hidden md:table-cell">Documento o motivo</TH>
              <TH>Unidad / OT</TH>
              <TH className="text-right">Entrada</TH>
              <TH className="text-right">Salida</TH>
              <TH className="text-right">Saldo</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {saldoAnterior !== null && (
              <TR>
                <TD colSpan={elegido ? 6 : 7} className="text-xs text-texto-suave">Saldo anterior</TD>
                <TD className="tabular text-right font-semibold">{cantidad(saldoAnterior)}</TD>
              </TR>
            )}
            {filas.length === 0 ? (
              <SinDatos
                colSpan={elegido ? 7 : 8}
                titulo={hayFiltros ? 'Ningún movimiento con esos filtros' : 'Todavía no hay movimientos'}
                descripcion={hayFiltros
                  ? 'Prueba con otro rango de fechas, otro tipo o borra el texto de la unidad.'
                  : 'Registra el saldo inicial o el primer ingreso con el botón de arriba; cada salida quedará aquí con su unidad.'}
              />
            ) : filas.map((f) => {
              const def = MOVIMIENTO_KARDEX[f.movimiento ?? ''] ?? { etiqueta: f.movimiento ?? 'Movimiento', tono: 'neutro' as const }
              const origen = ORIGEN_KARDEX[f.origen ?? ''] ?? f.origen
              return (
                <TR key={f.id}>
                  <TD className="whitespace-nowrap text-xs text-texto-suave">{fechaHora(f.fecha)}</TD>
                  {!elegido && (
                    <TD className="max-w-56">
                      <Link href={`/almacen/kardex?material=${f.material_id}`} className="line-clamp-2 text-sm text-acento hover:underline">{f.material ?? 'Material'}</Link>
                      <span className="block font-mono text-[10px] text-texto-tenue">{f.material_codigo}</span>
                    </TD>
                  )}
                  <TD>
                    <Insignia tono={def.tono}>{def.etiqueta}</Insignia>
                    <span className="block text-[11px] text-texto-suave">{origen}</span>
                    <span className="block text-[11px] text-texto-suave md:hidden">{f.documento}</span>
                  </TD>
                  <TD className="hidden max-w-60 md:table-cell">
                    <span className="line-clamp-2 text-sm">{f.documento ?? '—'}</span>
                    {(f.recibido_por_nombre || f.registrado_por_nombre) && (
                      <span className="block text-[11px] text-texto-suave">
                        {f.recibido_por_nombre ? `Recibió ${f.recibido_por_nombre}` : null}
                        {f.recibido_por_nombre && f.registrado_por_nombre ? ' · ' : null}
                        {f.registrado_por_nombre ? `Registró ${f.registrado_por_nombre}` : null}
                      </span>
                    )}
                    {f.desde_planilla && (
                      <span className="block text-[11px] text-acento">Desde planilla · cargado el {fechaHora(f.cargado_en)}</span>
                    )}
                  </TD>
                  <TD className="max-w-52">
                    {f.codigo_unidad
                      ? <span className="block text-sm font-medium break-words">{f.codigo_unidad}</span>
                      : <span className="text-xs text-texto-tenue">—</span>}
                    {f.orden_id && f.orden_numero && (
                      <Link href={`/ordenes/${f.orden_id}?vista=materiales`} className="text-[11px] text-acento hover:underline">OT {f.orden_numero}</Link>
                    )}
                    {f.con_foto && (
                      <Link href={`/almacen/movimientos/${f.id}/evidencia`} target="_blank" className="ml-2 text-[11px] text-acento hover:underline">Ver foto</Link>
                    )}
                  </TD>
                  <TD className="tabular text-right text-exito">{Number(f.entrada) > 0 ? cantidad(f.entrada) : ''}</TD>
                  <TD className="tabular text-right text-peligro">{Number(f.salida) > 0 ? cantidad(f.salida) : ''}</TD>
                  <TD className="tabular text-right font-semibold">
                    {cantidad(f.saldo)}
                    {!elegido && f.unidad_medida && <span className="ml-1 text-[10px] font-normal text-texto-tenue">{f.unidad_medida}</span>}
                  </TD>
                </TR>
              )
            })}
          </tbody>
        </Tabla>
      </Tarjeta>
      <Paginacion ruta="/almacen/kardex" pagina={pagina} paginas={paginas} total={total} porPagina={FILAS_POR_PAGINA} params={params} />
    </>
  )
}

function Cifra({ etiqueta, valor, acento }: { etiqueta: string; valor: string; acento?: boolean }) {
  return (
    <div className="rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2">
      <dt className="text-[11px] text-texto-suave">{etiqueta}</dt>
      <dd className={`tabular mt-1 text-lg font-semibold ${acento ? 'text-acento' : 'text-texto'}`}>{valor}</dd>
    </div>
  )
}
