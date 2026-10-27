import { Download, X } from 'lucide-react'
import Link from 'next/link'

import { SeparadoPara } from '@/components/almacen/separado-para'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Paginacion } from '@/components/estructura/paginacion'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarAtencionMateriales } from '@/lib/datos/atencion-materiales'
import { codigosParaElegir } from '@/lib/datos/codigos-para-elegir'
import { ingresosPorValidar } from '@/lib/datos/ingresos-por-validar'
import { cargarKardex, devolucionesPorReponer, FILAS_POR_PAGINA, filtrosDeKardex, ingresosParaDevolver, lineasDeRequerimientoParaSalida, materialesDelKardex, minimosDeStock, requerimientosConSalidaCargada, salidasPorCerrar, unidadesParaSalida } from '@/lib/datos/kardex'
import { separadoEnAlmacen, stockEnAlmacen } from '@/lib/datos/stock-almacen'
import { ALMACENES, MOVIMIENTO_KARDEX, ORDEN_ALMACENES, ORIGEN_KARDEX, almacenEnFrase, exigeFormato, topeDeCantidad } from '@/lib/dominio/almacen'
import { normalizarCodigo, vehiculosDeLaPlaca } from '@/lib/dominio/codigos-internos'
import { cantidad, fechaHora } from '@/lib/format'
import { seccionesDeOrden } from '@/lib/dominio/acceso-orden'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

import { ConteoFisico } from './conteo'
import { ConteoInicial } from './conteo-inicial'
import { DevolverAlProveedor, EsperanReposicion } from './devolucion-proveedor'
import { FiltroMaterial } from './filtro-material'
import { NuevoIngreso } from './ingreso'
import { SalidasPorCerrar } from './por-cerrar'
import { BandejaPorValidar } from './por-validar'
import { NuevaSalida } from './salida'
import { SinInternet } from './sin-internet'
import { FijarStockMinimo } from './stock-minimo'

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
  // «Atención de requerimiento» manda aquí con el RQ para registrar su salida.
  const rqInicial = typeof params.rq === 'string' && /^[0-9a-f-]{36}$/i.test(params.rq) ? params.rq : undefined

  const puedeSalida = puede(perfil, 'almacen.despachar')
  const puedeIngreso = puede(perfil, 'almacen.recibir')
  // Almacén y Supervisión general ya no abren la OT (2026-10-15): el número queda como referencia.
  // Y el enlace va a la pestaña de materiales: quien no la tiene (Contabilidad) terminaba en «No tienes acceso».
  const abreOt = seccionesDeOrden(perfil).includes('materiales')
  const db = await createClient()

  const [kardex, materiales, unidades, catalogo, entregas, minimos, unidadesMedida, porValidar, porCerrar, lineasRq, codigos, stock, paraDevolver, porReponer] = await Promise.all([
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
    minimosDeStock(),
    // Un material escrito a mano entra con la unidad que se elija.
    puedeIngreso
      ? db.from('unidades_medida').select('id,codigo,nombre').eq('activo', true).order('nombre')
      : Promise.resolve({ data: [], error: null }),
    // Lo que el conductor de Logística dejó y falta validar.
    ingresosPorValidar(),
    // Salidas de materia prima y EPP que esperan su formato firmado.
    salidasPorCerrar(),
    // Lo que piden los requerimientos vivos, para atenderlo desde la salida.
    puedeSalida ? lineasDeRequerimientoParaSalida() : Promise.resolve([]),
    // La lista de códigos internos para la salida sin RQ, la misma del RQ.
    puedeSalida ? codigosParaElegir(db) : Promise.resolve(null),
    // Lo que ya es de cada código, con la cuenta de «Stock en almacén»: la
    // salida lo necesita de todo material que tenga algo separado o apartado
    // para un pedido de OT; la ficha de quien solo mira, del elegido. Un
    // material que no viene no tiene nada de nadie. Si no se puede leer, la
    // pantalla lo dice y muestra lo del kardex.
    (puedeSalida ? separadoEnAlmacen() : filtros.material ? stockEnAlmacen([filtros.material]) : Promise.resolve(null))
      .catch((e: unknown) => {
        console.error('No se pudo leer lo separado del stock:', e instanceof Error ? e.message : e)
        return null
      }),
    // Lo que llegó de una compra y se puede devolver al proveedor, y lo devuelto que espera reposición.
    puedeIngreso ? ingresosParaDevolver() : Promise.resolve([]),
    devolucionesPorReponer(),
  ])
  if (entregas.error) throw new Error('No se pudieron cargar las entregas que se pueden devolver.')
  if (unidadesMedida.error) throw new Error('No se pudieron cargar las unidades de medida.')
  // Un RQ cuyo código es la placa de un vehículo que tiene otro código: la
  // salida avisa que el gasto no va al de él y, si todavía se puede, que
  // Requerimientos corrija el RQ a ese código. Con una salida cargada a otro ya
  // no se puede. El vehículo se busca como en la salida: la placa tal cual y,
  // si ninguno la tiene así, por sus letras y números. Casi nunca hay uno: sin
  // él no se consulta nada.
  const rqEnPlacaAjena = new Map<string, string>()
  for (const l of lineasRq) {
    const c = normalizarCodigo(l.codigo_interno)
    if (unidades.some((u) => u.codigo_interno && normalizarCodigo(u.codigo_interno) === c)) continue
    const suyos = vehiculosDeLaPlaca(unidades, c)
    const codigo = suyos.length === 1 ? normalizarCodigo(suyos[0].codigo_interno ?? '') : ''
    if (codigo) rqEnPlacaAjena.set(l.requerimiento_id, codigo)
  }
  const rqConSalida = await requerimientosConSalidaCargada([...rqEnPlacaAjena].map(([requerimiento_id, codigo]) => ({ requerimiento_id, codigo })))
  const lineasPorValidar = porValidar.reduce((s, e) => s + e.lineas.length, 0)

  const { filas, total, cronologico, pagina } = kardex
  const saldoPorMaterial = new Map(materiales.map((m) => [m.material_id, m.existencia]))
  const elegido = filtros.material ? materiales.find((m) => m.material_id === filtros.material) : undefined
  const minimoElegido = elegido ? minimos.get(elegido.material_id) ?? null : null
  const stockLeido = stock !== null
  const stockPorMaterial = new Map((stock ?? []).map((s) => [s.material_id, s]))
  // El elegido, si tiene algo separado o apartado; si no viene, todo lo que hay está libre.
  const stockElegido = elegido && stockLeido ? stockPorMaterial.get(elegido.material_id) : undefined
  // Cómo sale lo que tiene dueño: lo de un RQ solo se descuenta con una salida de ese RQ.
  const notaDeDueno = stockElegido
    ? [
        stockElegido.por_codigo.some((c) => c.de_requerimientos > 0) && 'Lo separado para un RQ sale con ese RQ.',
        stockElegido.por_codigo.some((c) => c.cantidad > c.de_requerimientos) && 'Lo de una unidad sin RQ sale para esa unidad.',
        stockElegido.reservado_ot > 0 && 'Lo de pedidos de OT sale con su despacho.',
      ].filter(Boolean).join(' ')
    : ''
  // Los que están por debajo de su mínimo, el más corto primero (en proporción).
  const bajoMinimo = materiales
    .filter((m) => minimos.has(m.material_id) && m.existencia < (minimos.get(m.material_id) ?? 0))
    .sort((a, b) => a.existencia / (minimos.get(a.material_id) || 1) - b.existencia / (minimos.get(b.material_id) || 1))
  // El tablero: cuántos materiales con saldo, bajo mínimo y salidas abiertas tiene cada almacén.
  // Las salidas abiertas del almacén elegido (o de todos): el título y la lista salen de aquí.
  const porCerrarDelAlmacen = porCerrar.filter((s): s is typeof s & { id: string } => Boolean(s.id) && (!filtros.almacen || s.almacen === filtros.almacen))
  const tablero = ORDEN_ALMACENES.map((a) => ({
    almacen: a,
    def: ALMACENES[a],
    conSaldo: materiales.filter((m) => m.almacen === a && m.existencia > 0).length,
    bajoMinimo: bajoMinimo.filter((m) => m.almacen === a).length,
    porCerrar: porCerrar.filter((s) => s.almacen === a).length,
  }))
  const porClasificar = materiales.filter((m) => !m.almacen && m.existencia > 0).length
  const paginas = Math.max(1, Math.ceil(total / FILAS_POR_PAGINA))
  const entradas = filas.reduce((s, f) => s + Number(f.entrada ?? 0), 0)
  const salidas = filas.reduce((s, f) => s + Number(f.salida ?? 0), 0)
  const primera = filas[0]
  const saldoAnterior = cronologico && primera
    ? Number(primera.saldo ?? 0) - Number(primera.entrada ?? 0) + Number(primera.salida ?? 0)
    : null
  // El Excel baja con los mismos filtros que la pantalla, sin la página.
  const consultaExcel = new URLSearchParams(Object.entries({
    material: filtros.material, tipo: filtros.tipo, desde: filtros.desde, hasta: filtros.hasta, unidad: filtros.unidad, almacen: filtros.almacen,
  }).filter((e): e is [string, string] => Boolean(e[1]))).toString()
  const hayFiltros = Boolean(filtros.material || filtros.tipo || filtros.desde || filtros.hasta || filtros.unidad || filtros.almacen)

  return (
    <>
      <EncabezadoPagina
        titulo="Kardex de Almacén"
        ayuda="Ingresos, egresos e historial de movimientos con el saldo de cada material. Toda salida queda vinculada a un vehículo o al código de su unidad."
      />

      {/* Las acciones van en su propia fila, a todo el ancho, y no en las del
          encabezado: así «Sin internet» queda en la esquina derecha. */}
      {(puedeSalida || puedeIngreso) && (
        <div className="-mt-3 mb-4 flex flex-wrap items-start gap-2">
          {puedeSalida && (
            <NuevaSalida
              materiales={materiales.map((m) => {
                const s = stockPorMaterial.get(m.material_id)
                return {
                  id: m.material_id, codigo: m.codigo, descripcion: m.descripcion, unidad: m.unidad, almacen: m.almacen,
                  // Lo apartado para pedidos de OT no sale por aquí (la base lo
                  // rechaza): la cuenta de la función, porque la del kardex no
                  // se lo cuenta a Almacén, que no ve las OT. A tres decimales,
                  // cortado: la salida no lleva cuatro.
                  disponible: s ? s.disponible : topeDeCantidad(m.disponible),
                  reservadoOt: s ? s.reservado_ot : 0,
                  libre: s ? s.libre : m.disponible,
                  separado: s ? s.separado : 0,
                  deMas: s ? s.de_mas : 0,
                  porCodigo: s ? s.por_codigo : [],
                }
              })}
              stockLeido={stockLeido}
              lineasRq={lineasRq}
              rqConSalida={rqConSalida}
              codigos={codigos}
              rqInicial={rqInicial}
              unidades={unidades.filter((u): u is typeof u & { id: string } => Boolean(u.id)).map((u) => ({
                id: u.id, nombre: u.nombre ?? 'Unidad', vehiculo: u.vehiculo, ordenes: u.ordenes, codigo_interno: u.codigo_interno, placa: u.placa,
              }))}
            />
          )}
          {puedeIngreso && <ConteoInicial />}
          {puedeIngreso && catalogo && (
            <ConteoFisico materiales={catalogo.catalogoAlmacen.map((m) => ({
              ...m, saldo: saldoPorMaterial.get(m.id) ?? 0,
            }))} />
          )}
          {puedeIngreso && catalogo && (
            <NuevoIngreso
              materiales={catalogo.catalogoAlmacen}
              unidades={unidadesMedida.data ?? []}
              despachos={(entregas.data ?? []).filter((e) => e.id).map((e) => ({
                id: e.id as string,
                etiqueta: `${e.material ?? 'Material'} · ${e.codigo_unidad ?? 'sin unidad'} · ${cantidad(e.salida)} ${e.unidad_medida ?? ''} · ${fechaHora(e.fecha)}`,
              }))}
            />
          )}
          {puedeIngreso && <DevolverAlProveedor ingresos={paraDevolver} />}
          {/* En la esquina, aparte del trabajo diario: se usa solo cuando se cae la señal. */}
          <div className="ml-auto">
            <SinInternet />
          </div>
        </div>
      )}

      {!elegido && (
        <section aria-label="Los cuatro almacenes" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tablero.map((t) => {
            const activo = filtros.almacen === t.almacen
            return (
              <Link key={t.almacen} href={activo ? '/almacen/kardex' : `/almacen/kardex?almacen=${t.almacen}`} aria-current={activo ? 'page' : undefined}
                className={`block rounded-[var(--radius-base)] border bg-superficie px-3 py-2 hover:bg-superficie-2 ${activo ? 'border-acento ring-1 ring-acento' : 'border-borde'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{t.def.etiqueta}</span>
                  <Insignia tono={t.def.tono}>{t.conSaldo === 1 ? '1 material' : `${t.conSaldo} materiales`}</Insignia>
                </div>
                <p className="mt-1 text-xs text-texto-suave">{t.def.regla}</p>
                <p className="mt-1 text-[11px]">
                  {t.bajoMinimo > 0 && <span className="font-medium text-peligro">{t.bajoMinimo} bajo mínimo</span>}
                  {t.bajoMinimo > 0 && t.porCerrar > 0 && <span className="text-texto-tenue"> · </span>}
                  {t.porCerrar > 0 && <span className="font-medium text-aviso">{t.porCerrar === 1 ? '1 salida por cerrar' : `${t.porCerrar} salidas por cerrar`}</span>}
                  {t.bajoMinimo === 0 && t.porCerrar === 0 && <span className="text-texto-tenue">Sin pendientes</span>}
                </p>
              </Link>
            )
          })}
          {porClasificar > 0 && (
            <p className="text-xs text-texto-suave sm:col-span-2 lg:col-span-4">
              {porClasificar === 1 ? '1 material con saldo sigue' : `${porClasificar} materiales con saldo siguen`} por clasificar: su categoría no tiene almacén y salen como consumibles hasta que se le asigne uno.
            </p>
          )}
        </section>
      )}

      <Tarjeta className="mb-4">
        <TarjetaCuerpo>
          {/* Con `key`, el formulario se rehace cuando cambian los filtros: sus
              campos no son controlados y «Limpiar» dejaba lo escrito sin «Ver». */}
          <form key={JSON.stringify(filtros)} method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1.5fr_auto] lg:items-end">
            {filtros.tipo && <input type="hidden" name="tipo" value={filtros.tipo} />}
            {filtros.almacen && <input type="hidden" name="almacen" value={filtros.almacen} />}
            <Campo etiqueta="Material" htmlFor="k-material">
              <FiltroMaterial key={filtros.material ?? ''} id="k-material" inicial={filtros.material ?? ''}
                materiales={materiales.map((m) => ({ valor: m.material_id, etiqueta: m.descripcion, detalle: m.codigo }))} />
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
              <Boton type="submit">Ver</Boton>
              {hayFiltros && (
                <EnlaceBoton href="/almacen/kardex" variante="fantasma" className="px-3">
                  <X aria-hidden className="size-3.5" />
                  Limpiar
                </EnlaceBoton>
              )}
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

      {!elegido && (porValidar.length > 0 || puedeIngreso) && (
        <Tarjeta id="por-validar" className="mb-4">
          <TarjetaCabecera
            titulo={porValidar.length === 0 ? 'Ingresos por validar' : `Ingresos por validar · ${porValidar.length === 1 ? '1 compra' : `${porValidar.length} compras`}`}
            ayuda="Lo que el conductor de Logística dejó en almacén. Revisa lo que llegó y valídalo: entra al kardex sin volver a registrarlo."
            acciones={lineasPorValidar > 0 ? <Insignia tono="aviso">{lineasPorValidar === 1 ? '1 material' : `${lineasPorValidar} materiales`}</Insignia> : undefined}
          />
          <TarjetaCuerpo>
            <BandejaPorValidar entregas={porValidar} puedeValidar={puedeIngreso} abreOt={abreOt} />
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      {!elegido && (porReponer.length > 0 || puedeIngreso) && (
        <Tarjeta id="por-reponer" className="mb-4">
          <TarjetaCabecera
            titulo={porReponer.length === 0 ? 'Esperan reposición' : `Esperan reposición · ${porReponer.length === 1 ? '1 devolución' : `${porReponer.length} devoluciones`}`}
            ayuda="Lo devuelto al proveedor que dijo que lo repone. Cuando llegue, recíbelo aquí; si ya no viene, lo que falta vuelve a la lista de Logística."
            acciones={porReponer.length > 0 ? <Insignia tono="aviso">Por reponer</Insignia> : undefined}
          />
          <TarjetaCuerpo>
            {porReponer.length === 0 && (
              <p className="mb-2 text-sm text-texto-suave">Nada devuelto espera reposición. Cuando devuelvas algo que el proveedor repone, aparece aquí para recibirlo.</p>
            )}
            <EsperanReposicion devoluciones={porReponer} puedeRecibir={puedeIngreso} puedeDejar={puedeIngreso} />
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      {!elegido && (porCerrar.length > 0 || puedeSalida) && (
        <Tarjeta id="por-cerrar" className="mb-4">
          {/* El título y el cuerpo cuentan lo mismo: lo del almacén elegido (decía «2 salidas» y abajo «ninguna»). */}
          <TarjetaCabecera
            titulo={porCerrarDelAlmacen.length === 0 ? 'Salidas por cerrar' : `Salidas por cerrar · ${porCerrarDelAlmacen.length === 1 ? '1 salida' : `${porCerrarDelAlmacen.length} salidas`}`}
            ayuda="Materia prima y EPP salen con formato: imprímelo, fírmenlo el almacenero y quien recibe, y carga el escaneo para cerrar la salida."
            acciones={porCerrarDelAlmacen.length > 0 ? <Insignia tono="aviso">Formato pendiente</Insignia> : undefined}
          />
          <TarjetaCuerpo>
            <SalidasPorCerrar puedeCerrar={puedeSalida} salidas={porCerrarDelAlmacen} almacen={filtros.almacen ?? null} />
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      {!elegido && bajoMinimo.length > 0 && (
        <Tarjeta className="mb-4">
          <TarjetaCabecera
            titulo={bajoMinimo.length === 1 ? '1 material bajo su stock mínimo' : `${bajoMinimo.length} materiales bajo su stock mínimo`}
            ayuda="Almacén y Logística recibieron el aviso al cruzar la línea. Elige uno para ver su ficha."
            acciones={<Insignia tono="peligro">Reponer</Insignia>}
          />
          <TarjetaCuerpo>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {bajoMinimo.slice(0, 30).map((m) => (
                <li key={m.material_id} className="rounded-[var(--radius-base)] border border-borde px-3 py-2">
                  <Link href={`/almacen/kardex?material=${m.material_id}`} className="line-clamp-1 text-sm font-medium text-acento hover:underline">{m.descripcion}</Link>
                  <p className="tabular text-xs text-texto-suave">
                    <span className="font-mono">{m.codigo}</span> · quedan <span className="font-semibold text-peligro">{cantidad(m.existencia)}</span> de un mínimo de {cantidad(minimos.get(m.material_id))} {m.unidad ?? ''}
                  </p>
                </li>
              ))}
            </ul>
            {bajoMinimo.length > 30 && <p className="mt-2 text-xs text-texto-suave">Y {bajoMinimo.length - 30} más.</p>}
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      {elegido && (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Cifra etiqueta={`Saldo en almacén (${elegido.unidad ?? 's/u'})`} valor={cantidad(elegido.existencia)}
              alerta={minimoElegido !== null && elegido.existencia < minimoElegido ? `Bajo el mínimo de ${cantidad(minimoElegido)}` : undefined} />
            {/* Lo libre con la misma cuenta que «Stock en almacén»: lo que no es de ningún código. */}
            {stockLeido
              ? <Cifra etiqueta="Libre, sin código" valor={cantidad(stockElegido ? stockElegido.libre : elegido.disponible)} acento />
              : <Cifra etiqueta="Libre para salidas" valor={cantidad(elegido.disponible)} acento />}
            <Cifra etiqueta={total > filas.length ? 'Entradas en lo mostrado' : 'Entradas del periodo'} valor={cantidad(entradas)} />
            <Cifra etiqueta={total > filas.length ? 'Egresos en lo mostrado' : 'Egresos del periodo'} valor={cantidad(salidas)} />
          </dl>
          {/* De quién es lo que no está libre, igual que en «Stock en almacén». */}
          {stockElegido && (stockElegido.separado > 0 || stockElegido.reservado_ot > 0) && (
            <div className="-mt-1 mb-4 rounded-[var(--radius-base)] border border-borde px-3 py-2" data-ya-tiene-dueno>
              <p className="mb-1 text-xs font-medium text-texto">Ya tiene dueño</p>
              <SeparadoPara material={stockElegido} className="text-sm" />
              {notaDeDueno && <p className="mt-1 text-xs text-texto-suave">{notaDeDueno}</p>}
            </div>
          )}
          {!stockLeido && (
            <p className="-mt-1 mb-4 text-xs text-aviso">No se pudo leer lo separado para cada código: «Libre para salidas» incluye lo que ya es de algún RQ.</p>
          )}
          {puedeIngreso ? (
            <div className="mb-4">
              <FijarStockMinimo key={`${elegido.material_id}-${minimoElegido}`} materialId={elegido.material_id} minimo={minimoElegido} unidad={elegido.unidad} />
            </div>
          ) : (
            <p className="mb-4 text-sm text-texto-suave">
              {minimoElegido === null ? 'Sin stock mínimo: no avisa cuando baja.' : `Stock mínimo: ${cantidad(minimoElegido)} ${elegido.unidad ?? ''}.`}
            </p>
          )}
        </>
      )}

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo={elegido ? `${elegido.descripcion} · ${elegido.codigo}` : filtros.almacen ? `Historial de ${almacenEnFrase(filtros.almacen)}` : 'Historial de movimientos'}
          ayuda={elegido
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
              {/* En el teléfono quedan la fecha y las tres cifras: el material, el
                  movimiento y la unidad bajan a la celda de la fecha. Con sus
                  columnas la tabla medía el doble de la pantalla. */}
              <TH>Fecha</TH>
              {!elegido && <TH className="hidden sm:table-cell">Material</TH>}
              <TH className="hidden sm:table-cell">Movimiento</TH>
              <TH className="hidden md:table-cell">Documento o motivo</TH>
              <TH className="hidden sm:table-cell">Código interno</TH>
              <TH className="px-2 text-right sm:px-3">Entrada</TH>
              <TH className="px-2 text-right sm:px-3">Salida</TH>
              <TH className="px-2 text-right sm:px-3">Saldo</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {saldoAnterior !== null && (
              // Celda por celda, como las demás filas: un colSpan fijo contaba
              // columnas que en el teléfono están escondidas y corría el saldo.
              <TR>
                <TD className="text-xs text-texto-suave">Saldo anterior</TD>
                {!elegido && <TD className="hidden sm:table-cell" />}
                <TD className="hidden sm:table-cell" />
                <TD className="hidden md:table-cell" />
                <TD className="hidden sm:table-cell" />
                <TD />
                <TD />
                <TD className="tabular px-2 text-right sm:px-3 font-semibold">{cantidad(saldoAnterior)}</TD>
              </TR>
            )}
            {filas.length === 0 ? (
              <SinDatos
                colSpan={elegido ? 7 : 8}
                titulo={hayFiltros ? 'Ningún movimiento con esos filtros' : 'Todavía no hay movimientos'}
                descripcion={hayFiltros
                  ? 'Prueba con otro rango de fechas, otro tipo o borra el texto de la unidad.'
                  : puedeIngreso
                    ? 'Registra el saldo inicial o el primer ingreso con el botón de arriba; cada salida quedará aquí con su unidad.'
                    : 'Almacén registra el saldo inicial y cada ingreso; aparecen aquí apenas lo haga.'}
              />
            ) : filas.map((f) => {
              const def = MOVIMIENTO_KARDEX[f.movimiento ?? ''] ?? { etiqueta: f.movimiento ?? 'Movimiento', tono: 'neutro' as const }
              const origen = ORIGEN_KARDEX[f.origen ?? ''] ?? f.origen
              const material = (
                <>
                  <Link href={`/almacen/kardex?material=${f.material_id}`} className="line-clamp-2 text-sm text-acento hover:underline">{f.material ?? 'Material'}</Link>
                  <span className="block font-mono text-xs text-texto-tenue">{f.material_codigo}</span>
                </>
              )
              const unidadYOt = (
                <>
                  {f.codigo_unidad
                    ? <span className="block text-sm font-medium break-words">{f.codigo_unidad}</span>
                    : <span className="text-xs text-texto-tenue">—</span>}
                  {f.orden_id && f.orden_numero && (abreOt
                    ? <Link href={`/ordenes/${f.orden_id}?vista=materiales`} className="text-xs text-acento hover:underline">OT {f.orden_numero}</Link>
                    : <span className="block text-xs text-texto-suave">OT {f.orden_numero}</span>)}
                  {f.requerimiento_numero && (
                    <span className="block text-xs text-texto-suave">{f.requerimiento_numero}</span>
                  )}
                  {/* Enlaces de 12 px de alto no se tocan con el guante: 24 px, como pide WCAG 2.5.8 (auditoría del 27/10/2026). */}
                  {f.con_foto && (
                    <a href={`/almacen/movimientos/${f.id}/evidencia`} target="_blank" rel="noopener" className="ml-2 inline-flex min-h-6 items-center text-xs text-acento hover:underline">Ver foto</a>
                  )}
                  {f.formato_pendiente && (
                    <Link href={`/almacen/movimientos/${f.id}/formato`} target="_blank" className="ml-2 inline-flex min-h-6 items-center text-xs font-medium text-aviso hover:underline">Formato pendiente</Link>
                  )}
                  {f.con_formato && exigeFormato(f.almacen) && (
                    <a href={`/almacen/movimientos/${f.id}/formato-firmado`} target="_blank" rel="noopener" className="ml-2 text-[11px] text-acento hover:underline">Ver formato</a>
                  )}
                </>
              )
              return (
                <TR key={f.id}>
                  <TD className="text-xs text-texto-suave">
                    <span className="whitespace-nowrap">{fechaHora(f.fecha)}</span>
                    <div className="mt-1 min-w-32 space-y-1 text-texto sm:hidden">
                      {!elegido && <div>{material}</div>}
                      <div className="flex flex-wrap items-center gap-1">
                        <Insignia tono={def.tono}>{def.etiqueta}</Insignia>
                        <span className="text-[11px] text-texto-suave">{origen}</span>
                      </div>
                      {f.documento && <span className="block text-[11px] text-texto-suave">{f.documento}</span>}
                      <div>{unidadYOt}</div>
                    </div>
                  </TD>
                  {!elegido && (
                    <TD className="hidden max-w-56 sm:table-cell">
                      {material}
                    </TD>
                  )}
                  <TD className="hidden sm:table-cell">
                    <Insignia tono={def.tono}>{def.etiqueta}</Insignia>
                    <span className="block text-[11px] text-texto-suave">{origen}</span>
                    <span className="block text-[11px] text-texto-suave md:hidden">{f.documento}</span>
                  </TD>
                  <TD className="hidden max-w-60 md:table-cell">
                    {/* El nombre de una OC sin número es largo: entero al pasar el puntero. */}
                    <span className="line-clamp-2 text-sm" title={f.documento ?? undefined}>{f.documento ?? '—'}</span>
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
                  <TD className="hidden max-w-52 sm:table-cell">{unidadYOt}</TD>
                  <TD className="tabular px-2 text-right sm:px-3 text-exito">{Number(f.entrada) > 0 ? cantidad(f.entrada) : ''}</TD>
                  <TD className="tabular px-2 text-right sm:px-3 text-peligro">{Number(f.salida) > 0 ? cantidad(f.salida) : ''}</TD>
                  <TD className="tabular px-2 text-right sm:px-3 font-semibold">
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

function Cifra({ etiqueta, valor, acento, alerta }: { etiqueta: string; valor: string; acento?: boolean; alerta?: string }) {
  return (
    <div className={`rounded-[var(--radius-base)] border bg-superficie px-3 py-2 ${alerta ? 'border-peligro' : 'border-borde'}`}>
      <dt className="text-[11px] text-texto-suave">{etiqueta}</dt>
      <dd className={`tabular mt-1 text-lg font-semibold ${alerta ? 'text-peligro' : acento ? 'text-acento' : 'text-texto'}`}>{valor}</dd>
      {alerta && <dd className="text-[11px] font-medium text-peligro">{alerta}</dd>}
    </div>
  )
}
