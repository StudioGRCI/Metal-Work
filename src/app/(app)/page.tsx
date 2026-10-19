import Link from 'next/link'
import {
  AlertTriangle,
  ClipboardList,
  Factory,
  PauseCircle,
  Zap,
} from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Indicador } from '@/components/ui/indicador'
import { Insignia, Punto, type Tono } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_OT, ORDEN_ESTADO_OT, PRIORIDAD, definir } from '@/lib/dominio/estados'
import { situacionDeEntrega } from '@/lib/dominio/expediente'
import { nombreDeUnidad, todaviaSinPlaca } from '@/lib/dominio/unidades'
import { fecha, fechaLarga, hoyLima, moneda, porcentaje } from '@/lib/format'
import { costoDeOrdenes } from '@/lib/datos/costos-ot'
import { dashboardDelPuesto, type Cifra, type CodigoEnCurso } from '@/lib/datos/dashboard'
import { indicadoresTablero, ordenesAtrasadas, ordenesPorEntrega } from '@/lib/datos/ordenes'
import { menuDe } from '@/lib/navegacion'
import { exigirSesion, puede, type PerfilSesion } from '@/lib/sesion'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Dashboard' }

/**
 * El dashboard de cada puesto, de arriba abajo: las cifras clave de su área,
 * cada una con el enlace a la pantalla donde se mira, y, para quien todavía
 * lleva la OT, las órdenes del taller. Al final, en el teléfono, sus módulos a
 * un toque.
 *
 * No lleva una lista de «lo que te toca hoy»: el sistema no le dice a nadie
 * qué tiene que hacer, le muestra cómo va su área y le deja cada pantalla a un
 * toque (decisión del 2026-10-19). Los globos del menú siguen contando lo que
 * espera en cada pantalla.
 */
export default async function PaginaDashboard() {
  const perfil = await exigirSesion()
  const hoy = hoyLima()
  const esAdmin = perfil.rol.codigo === 'ADMIN'
  // La OT es desde el 2026-10-15 un documento de Diseño: su bloque sale solo a
  // quien la tiene en su menú (Diseño, su colaborador y Administración).
  const llevaOrdenes = menuDe(perfil.permisos, esAdmin, perfil.rol.codigo).some((g) => g.items.some((i) => i.ruta === '/ordenes'))

  const area = await dashboardDelPuesto(perfil)

  return (
    <>
      {/* El puesto y no el nombre (migración 109): la pantalla es del puesto,
          quien lo ocupe hoy ya sabe cómo se llama. */}
      <EncabezadoPagina titulo="Dashboard" descripcion={`${perfil.puesto} · ${fechaLarga(hoy)}`} />
      {area && area.cifras.length > 0 && <CifrasDelArea titulo={area.titulo} cifras={area.cifras} />}
      {area?.codigos && area.codigos.length > 0 && <CodigosEnCurso codigos={area.codigos} />}
      {llevaOrdenes && <OrdenesDelTaller perfil={perfil} />}
      <TusModulos perfil={perfil} />
    </>
  )
}

/** Las cifras clave del área, cada una con el enlace a la pantalla donde se mira. */
function CifrasDelArea({ titulo, cifras }: { titulo: string; cifras: Cifra[] }) {
  return (
    <section aria-label={titulo} className="mb-6">
      <h2 className="mb-2 text-base font-semibold text-texto">{titulo}</h2>
      {/* Dos columnas ya en el teléfono: apiladas de a una ocupaban una pantalla entera.
          Con un número impar, la última toma la fila entera en vez de quedar
          sola con un hueco al lado. */}
      <div className={cn('grid grid-cols-2 gap-3 sm:gap-4 max-lg:[&>:last-child:nth-child(odd)]:col-span-2', cifras.length >= 5 ? 'lg:grid-cols-5' : cifras.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
        {cifras.map((c) => (
          <Indicador key={c.clave} icono={c.icono} titulo={c.titulo} valor={c.valor} pie={c.pie} tono={c.tono} href={c.href} />
        ))}
      </div>
    </section>
  )
}

/** Gerencia: los códigos que se movieron hace poco, con su avance y lo que llevan costado. */
function CodigosEnCurso({ codigos }: { codigos: CodigoEnCurso[] }) {
  return (
    <Tarjeta className="mb-4">
      <TarjetaCabecera
        titulo="Códigos con movimiento reciente"
        descripcion="Del que se movió hace menos al que se movió hace más, con su avance y su costo a la fecha"
        acciones={
          <Link href="/codigos-internos" className="inline-flex min-h-11 items-center text-xs text-acento hover:underline sm:min-h-0">
            Ver todos
          </Link>
        }
      />
      <TarjetaCuerpo className="p-2 sm:p-3">
        <ul className="divide-y divide-borde">
          {codigos.map((c) => (
            <li key={c.codigo}>
              <Link
                href={c.href}
                className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-4 gap-y-1 rounded-[var(--radius-base)] px-2 py-3 hover:bg-superficie-2 sm:grid-cols-[minmax(0,1fr)_8rem_9rem_7rem]"
              >
                <p className="truncate text-sm font-medium text-texto">{c.codigo}</p>
                {c.avance === null ? (
                  <p className="text-xs text-texto-tenue">No lleva avance</p>
                ) : (
                  <Progreso valor={c.avance} mostrarValor alto="sm" etiqueta={`Avance del código ${c.codigo}`} />
                )}
                <p className="tabular col-span-2 text-xs text-texto sm:col-span-1 sm:text-right">
                  <span className="text-texto-tenue sm:hidden">Costo hasta hoy: </span>
                  {c.costo ?? <span className="text-texto-tenue">Sin costo</span>}
                </p>
                <p className="hidden text-xs text-texto-tenue sm:block sm:text-right">{c.ultima ? fecha(c.ultima) : ''}</p>
              </Link>
            </li>
          ))}
        </ul>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/** Las órdenes del taller: para Diseño, su colaborador y Administración, que todavía llevan la OT. */
async function OrdenesDelTaller({ perfil }: { perfil: PerfilSesion }) {
  // Las atrasadas se piden aparte y ordenadas por fecha comprometida: sacarlas
  // de la primera página de abiertas dejaba fuera una orden vieja y muy
  // atrasada, y la tarjeta llegaba a decir «ninguna» con el indicador en tres.
  const verCosteo = puede(perfil, 'costos.ver')
  const [indicadores, enTaller, atrasadas] = await Promise.all([
    indicadoresTablero(),
    ordenesPorEntrega(8),
    ordenesAtrasadas(),
  ])
  // El costo de cada unidad solo se calcula para quien puede verlo.
  // El margen se ve solo con el precio de venta a la vista: la misma llave que `margen_ot`.
  const verMargen = verCosteo && puede(perfil, 'cotizaciones.ver_pdf_comercial')
  const costos = verCosteo
    ? await costoDeOrdenes(enTaller.ordenes, { conMargen: verMargen })
    : null
  // Para el pie de «Órdenes abiertas»: un número suelto no dice si son muchas
  // o pocas hasta que se ve contra el total registrado.
  const totalOrdenes = indicadores.total
  const hoy = hoyLima()

  return (
    <section aria-label="Órdenes de trabajo" className="mb-6">
      <h2 className="mb-2 text-base font-semibold text-texto">Órdenes de trabajo</h2>

      {/* Dos columnas ya en el teléfono: cinco tarjetas apiladas ocupaban una
          pantalla entera antes de llegar a la lista de órdenes. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5 max-lg:[&>:last-child:nth-child(odd)]:col-span-2">
        <Indicador
          icono={ClipboardList}
          titulo="Órdenes abiertas"
          valor={indicadores.abiertas}
          pie={`de ${totalOrdenes} registradas`}
          href="/ordenes?estado=ABIERTAS"
        />
        <Indicador
          icono={Factory}
          titulo="En proceso"
          valor={indicadores.enProceso}
          tono="acento"
          pie={`de ${indicadores.abiertas} abiertas`}
          href="/ordenes?estado=EN_PROCESO"
        />
        <Indicador
          icono={PauseCircle}
          titulo="Pausadas"
          valor={indicadores.pausadas}
          tono="aviso"
          pie={`de ${indicadores.abiertas} abiertas`}
          href="/ordenes?estado=PAUSADA"
        />
        <Indicador
          icono={AlertTriangle}
          titulo="Atrasadas"
          valor={indicadores.atrasadas}
          tono={indicadores.atrasadas > 0 ? 'peligro' : 'neutro'}
          pie="pasaron la fecha comprometida"
          href="/ordenes?estado=ABIERTAS&atrasadas=1"
        />
        <Indicador
          icono={Zap}
          titulo="Urgentes"
          valor={indicadores.urgentes}
          tono={indicadores.urgentes > 0 ? 'aviso' : 'neutro'}
          pie={`de ${indicadores.abiertas} abiertas`}
          href="/ordenes?estado=ABIERTAS&prioridad=URGENTE"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Tarjeta className="lg:col-span-2 lg:self-start">
          <TarjetaCabecera
            titulo="Unidades en taller"
            descripcion={
              verCosteo
                ? 'De la entrega más próxima a la más lejana, con su avance y lo que llevan costado'
                : 'De la entrega más próxima a la más lejana, con su avance'
            }
            acciones={
              <Link
                href="/ordenes?estado=ABIERTAS"
                className="inline-flex min-h-11 items-center text-xs text-acento hover:underline sm:min-h-0"
              >
                Ver todas{enTaller.total > enTaller.ordenes.length ? ` (${enTaller.total})` : ''}
              </Link>
            }
          />
          <TarjetaCuerpo className="p-2 sm:p-3">
            {enTaller.ordenes.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-texto">No hay órdenes abiertas</p>
                <p className="mt-1 text-xs text-texto-suave">
                  La OT llega cuando Gerencia aprueba la cotización con su código interno; aparece acá con su avance y su fecha de entrega.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-borde">
                {enTaller.ordenes.map((orden) => {
                  const estado = definir(ESTADO_OT, orden.estado)
                  const prioridad = definir(PRIORIDAD, orden.prioridad)
                  const entrega = situacionDeEntrega(orden.fecha_entrega_comprometida, null, hoy)
                  const costo = costos?.get(orden.id)
                  // Con unidad el renglón la nombra siempre, tenga placa o no;
                  // sin unidad no se nombra nada, para no gastar el ancho de una
                  // línea que se lee de un vistazo.
                  const unidad = orden.unidad_id
                    ? {
                        placa: orden.placa,
                        codigo_interno: orden.codigo_interno,
                        numero_chasis: orden.numero_chasis,
                        marca: orden.marca,
                        modelo: orden.modelo,
                      }
                    : null
                  return (
                    <li key={orden.id}>
                      <Link
                        href={`/ordenes/${orden.id}`}
                        className={cn(
                          'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-[var(--radius-base)] px-2 py-3 hover:bg-superficie-2',
                          // Cada renglón es su propia rejilla: con columnas de
                          // ancho fijo las barras de avance quedan alineadas.
                          costos
                            ? 'sm:grid-cols-[minmax(0,1fr)_8rem_8.5rem_8.5rem]'
                            : 'sm:grid-cols-[minmax(0,1fr)_8rem_8.5rem]',
                        )}
                      >
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-texto">
                            {orden.numero}
                            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                            {orden.prioridad && orden.prioridad !== 'NORMAL' && (
                              <span className="flex items-center gap-1 text-xs font-normal text-texto-suave">
                                <Punto tono={prioridad.tono} />
                                {prioridad.etiqueta}
                              </span>
                            )}
                          </p>
                          {/* La unidad primero: es lo que está en el taller, y
                              la razón social larga del cliente la cortaba. */}
                          <p className="line-clamp-2 text-xs text-texto-suave sm:line-clamp-1">
                            {unidad && (
                              <span className={todaviaSinPlaca(unidad) ? 'text-texto-tenue' : 'text-texto'}>
                                {nombreDeUnidad(unidad)}
                                {(orden.cliente || orden.cliente_id === null) && ' · '}
                              </span>
                            )}
                            {/* Un cliente que el puesto no puede ver llega vacío:
                                «sin cliente» solo cuando de verdad no lo tiene. */}
                            {orden.cliente ??
                              (orden.cliente_id === null ? <span className="text-aviso">Sin cliente todavía</span> : null)}
                          </p>
                        </div>

                        {/* En el teléfono el avance va a la derecha del nombre y la
                            entrega en su propia línea; en el monitor, columnas. */}
                        <div className="w-24 sm:w-auto">
                          <Progreso valor={orden.avance_porcentaje} mostrarValor alto="sm" etiqueta={`Avance de la OT ${orden.numero}`} />
                        </div>

                        <div className="col-span-2 flex items-baseline justify-between gap-3 sm:col-span-1 sm:block">
                          <p className="tabular text-xs text-texto">
                            {orden.fecha_entrega_comprometida ? `Entrega ${fecha(orden.fecha_entrega_comprometida)}` : 'Sin fecha'}
                          </p>
                          <p className={cn('text-xs', TONO_TEXTO[entrega.tono])}>{entrega.pie}</p>
                        </div>

                        {costos && (
                          <p className="tabular col-span-2 text-xs sm:col-span-1 sm:text-right">
                            <span className="text-texto-tenue sm:hidden">Costo hasta hoy: </span>
                            {!costo ? (
                              <span className="text-texto-tenue" title="No se pudo calcular el costo de esta orden">—</span>
                            ) : (
                              <>
                                {/* Todo en soles, y con código el costo es el del código: el mismo que ve Gerencia. */}
                                <span
                                  className={cn('sm:block', costo.pen > 0 ? 'font-medium text-texto' : 'text-texto-tenue')}
                                  title={costo.codigo ? `El costo del código ${costo.codigo}, el mismo de Códigos internos` : undefined}
                                  data-costo-orden={costo.pen}
                                >
                                  {moneda(costo.pen)}
                                </span>
                                {costo.margenPct !== null && (
                                  <span className={cn('block', costo.margenPct < 0 ? 'text-peligro' : 'text-texto-suave')}>
                                    Margen {porcentaje(costo.margenPct, 1)}
                                  </span>
                                )}
                                {costo.semaforo && costo.consumidoPct !== null && (
                                  <span
                                    className={cn(
                                      'block',
                                      costo.semaforo === 'EXCEDIDO'
                                        ? 'text-peligro'
                                        : costo.semaforo === 'AJUSTADO'
                                          ? 'text-aviso'
                                          : 'text-texto-suave',
                                    )}
                                  >
                                    {porcentaje(costo.consumidoPct, 0)} del presupuesto
                                  </span>
                                )}
                                {costo.sinPrecio > 0 && (
                                  <span className="block text-aviso">
                                    {costo.sinPrecio} {costo.sinPrecio === 1 ? 'despacho' : 'despachos'} sin precio
                                  </span>
                                )}
                                {costo.cierre && <span className="block text-texto-suave">Costeo cerrado en {moneda(costo.cierre.costo)}</span>}
                                {costo.sinCosto > 0 && <span className="block text-aviso">Horas sin costo</span>}
                                {costo.sinCambio > 0 && <span className="block text-aviso">Falta tipo de cambio</span>}
                              </>
                            )}
                          </p>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <div className="space-y-4">
          <Tarjeta>
            <TarjetaCabecera
              titulo="Requieren atención"
              descripcion="Órdenes que pasaron su fecha de entrega"
            />
            <TarjetaCuerpo className="space-y-2">
              {atrasadas.length === 0 ? (
                <p className="py-4 text-center text-sm text-exito">Ninguna orden atrasada. Buen trabajo.</p>
              ) : (
                atrasadas.slice(0, 6).map((orden) => (
                  <Link
                    key={orden.id}
                    href={`/ordenes/${orden.id}`}
                    className="block rounded-[var(--radius-base)] p-2 hover:bg-superficie-2"
                  >
                    <p className="text-sm font-medium text-texto">{orden.numero}</p>
                    <p className="text-xs text-peligro">
                      {orden.dias_atraso} {orden.dias_atraso === 1 ? 'día' : 'días'} · comprometida el{' '}
                      {fecha(orden.fecha_entrega_comprometida)}
                    </p>
                  </Link>
                ))
              )}
            </TarjetaCuerpo>
          </Tarjeta>

          <Tarjeta>
            {/* Todas las órdenes, también las entregadas y facturadas que los
                indicadores de arriba —solo abiertas— no cuentan. */}
            <TarjetaCabecera titulo="Todas por estado" />
            <TarjetaCuerpo className="space-y-2">
              {indicadores.porEstado.length === 0 ? (
                <p className="py-4 text-center text-sm text-texto-suave">
                  Todavía no hay ninguna orden registrada.
                </p>
              ) : (
                [...indicadores.porEstado]
                  .sort(
                    (a, b) =>
                      ORDEN_ESTADO_OT.indexOf(a.estado as never) -
                      ORDEN_ESTADO_OT.indexOf(b.estado as never),
                  )
                  .map(({ estado, cantidad }) => {
                    const def = definir(ESTADO_OT, estado)
                    return (
                      // El conteo lleva a su lista filtrada: era un número que
                      // no llevaba a ninguna parte y obligaba a repetir el
                      // filtro a mano en Órdenes.
                      <Link
                        key={estado}
                        href={`/ordenes?estado=${estado}`}
                        className="flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-base)] text-sm hover:bg-superficie-2 sm:min-h-0"
                      >
                        <Insignia tono={def.tono}>{def.etiqueta}</Insignia>
                        <span className="tabular font-medium text-texto">{cantidad}</span>
                      </Link>
                    )
                  })
              )}
            </TarjetaCuerpo>
          </Tarjeta>
        </div>
      </div>
    </section>
  )
}

/** El color del texto que acompaña la fecha de entrega: solo lo vencido o lo inminente se marca. */
const TONO_TEXTO: Record<Tono, string> = {
  neutro: 'text-texto-tenue',
  exito: 'text-exito',
  aviso: 'text-aviso',
  peligro: 'text-peligro',
  info: 'text-info',
  acento: 'text-acento',
}

/**
 * Sus módulos, a un toque, solo en el teléfono: en el monitor ya están en la
 * barra lateral, al lado. Antes la pantalla decía «abre el menú» y nada más, y
 * quien llegaba al dashboard desde el teléfono no tenía a dónde ir desde aquí.
 */
function TusModulos({ perfil }: { perfil: PerfilSesion }) {
  const esAdmin = perfil.rol.codigo === 'ADMIN'
  const modulos = menuDe(perfil.permisos, esAdmin, perfil.rol.codigo)
    .flatMap((g) => g.items)
    .filter((i) => i.ruta !== '/')
  if (modulos.length === 0) return null
  return (
    <section aria-label="Tus módulos" className="lg:hidden">
      <h2 className="mb-2 text-base font-semibold text-texto">Tus módulos</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modulos.map((m) => {
          const Icono = m.icono
          return (
            <li key={m.ruta}>
              <Link href={m.ruta} className="group block h-full rounded-[var(--radius-base)]">
                <Tarjeta className="flex h-full items-start gap-3 p-4 transition-colors group-hover:border-borde-fuerte group-hover:bg-superficie-2">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-base)] bg-acento-suave text-acento">
                    <Icono aria-hidden className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-texto">{m.titulo}</span>
                    {m.descripcion && <span className="mt-0.5 block text-xs text-texto-suave">{m.descripcion}</span>}
                  </span>
                </Tarjeta>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
