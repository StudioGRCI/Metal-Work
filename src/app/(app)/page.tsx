import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Factory,
  PauseCircle,
  Plus,
  Zap,
} from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Indicador } from '@/components/ui/indicador'
import { Insignia, Punto, type Tono } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_OT, ORDEN_ESTADO_OT, PRIORIDAD, definir } from '@/lib/dominio/estados'
import { situacionDeEntrega } from '@/lib/dominio/expediente'
import { nombreDeUnidad, todaviaSinPlaca } from '@/lib/dominio/unidades'
import { fecha, fechaLarga, hoyLima, moneda, porcentaje } from '@/lib/format'
import { costoDeOrdenes } from '@/lib/datos/costos-ot'
import { indicadoresTablero, ordenesAtrasadas, ordenesPorEntrega } from '@/lib/datos/ordenes'
import { pendientesGlobales, type PendienteGlobal } from '@/lib/datos/pendientes-globales'
import { NAVEGACION, puedeVer } from '@/lib/navegacion'
import { exigirSesion, puede, type PerfilSesion } from '@/lib/sesion'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Tablero' }

export default async function PaginaTablero() {
  const perfil = await exigirSesion()

  const pendientes = await pendientesGlobales(perfil)

  if (!puede(perfil, 'ordenes.listar')) {
    return (
      <>
        <EncabezadoPagina titulo={perfil.puesto} descripcion="Lo que te toca y tus módulos, a un toque." />
        <TeTocaHoy items={pendientes.items} />
        <TusModulos perfil={perfil} />
      </>
    )
  }

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
    ? await costoDeOrdenes(
        enTaller.ordenes.map((o) => o.id),
        { conMargen: verMargen },
      )
    : null
  const puedeCrear = puede(perfil, 'ordenes.crear')
  // Para el pie de «Órdenes abiertas»: un número suelto no dice si son muchas
  // o pocas hasta que se ve contra el total registrado.
  const totalOrdenes = indicadores.total
  const hoy = hoyLima()

  return (
    <>
      {/* El puesto y no el nombre (migración 109): la pantalla es del puesto,
          quien lo ocupe hoy ya sabe cómo se llama. */}
      <EncabezadoPagina titulo={perfil.puesto} descripcion={`Estado del taller al ${fechaLarga(hoy)}.`} />

      <TeTocaHoy items={pendientes.items} />

      {/* Dos columnas ya en el teléfono: cinco tarjetas apiladas ocupaban una
          pantalla entera antes de llegar a la lista de órdenes. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
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
                  En cuanto se apruebe una, aparece acá con su avance y su fecha de entrega.
                </p>
                {puedeCrear && (
                  <div className="mt-4 flex justify-center">
                    {/* La orden sale de la cotización PDF aprobada. */}
                    <EnlaceBoton href="/cotizaciones/pdf?estado=APROBADA_SIN_OT" tamano="sm">
                      <Plus aria-hidden className="size-3.5" />
                      Emitir OT desde una cotización
                    </EnlaceBoton>
                  </div>
                )}
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
                            <span className="text-texto-tenue sm:hidden">Costo a la fecha: </span>
                            {!costo ? (
                              <span className="text-texto-tenue" title="No se pudo calcular el costo de esta orden">—</span>
                            ) : (
                              <>
                                {/* Todo en soles: lo comprado en dólares entra al cambio de su fecha. */}
                                <span className={cn('sm:block', costo.pen > 0 ? 'font-medium text-texto' : 'text-texto-tenue')}>
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
    </>
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

const TONO_CIFRA: Record<Tono, string> = {
  neutro: 'bg-neutro-suave text-texto',
  exito: 'bg-exito-suave text-exito',
  aviso: 'bg-aviso-suave text-aviso',
  peligro: 'bg-peligro-suave text-peligro',
  info: 'bg-info-suave text-info',
  acento: 'bg-acento-suave text-acento',
}

/**
 * Lo que le toca a este puesto: una bandeja, una tarea por renglón, con su
 * cantidad y el enlace a donde se resuelve.
 *
 * Eran tarjetas de indicador con la frase entera en mayúsculas —«REPORTES
 * POR APROBAR», «ÓRDENES SIN PLANOS QUE DESGLOSAR»— y se leían como un letrero,
 * no como algo que hacer. Si no hay nada, se dice en una línea y no se ocupa
 * media pantalla.
 */
function TeTocaHoy({ items }: { items: PendienteGlobal[] }) {
  if (items.length === 0) {
    return (
      <p className="mb-4 flex items-center gap-2 text-sm text-texto-suave">
        <CheckCircle2 aria-hidden className="size-4 text-exito" />
        Nada pendiente para tu puesto ahora mismo.
      </p>
    )
  }

  return (
    <Tarjeta className="mb-4">
      <TarjetaCabecera titulo="Te toca" descripcion="Lo que espera a tu puesto, de lo más urgente a lo demás" />
      <ul className="grid divide-y divide-borde sm:grid-cols-2 sm:divide-y-0">
        {[...items]
          .sort((a, b) => PESO_TONO[a.tono as Tono] - PESO_TONO[b.tono as Tono])
          .map((i) => {
            const error = i.clave.endsWith('_error')
            return (
              <li key={i.clave} className="sm:border-b sm:border-borde sm:odd:border-r">
                <Link
                  href={i.ruta}
                  className="flex min-h-14 items-center gap-3 px-4 py-2.5 text-sm hover:bg-superficie-2"
                >
                  <span
                    className={cn(
                      'tabular inline-flex h-7 min-w-9 shrink-0 items-center justify-center rounded-full px-2 text-sm font-semibold',
                      TONO_CIFRA[(error ? 'aviso' : i.tono) as Tono] ?? TONO_CIFRA.neutro,
                    )}
                  >
                    {error ? '!' : i.cantidad}
                  </span>
                  <span className="min-w-0 flex-1 text-texto">
                    {/* La cifra ya va en la burbuja: la frase empieza en lo que es. */}
                    {error ? i.texto : primeraEnMayuscula(i.texto.replace(/^\d+\s/, ''))}
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-texto-tenue" />
                </Link>
              </li>
            )
          })}
      </ul>
    </Tarjeta>
  )
}

/** Lo rojo primero, después lo amarillo; el resto en el orden en que llegó. */
const PESO_TONO: Record<Tono, number> = { peligro: 0, aviso: 1, acento: 2, info: 3, exito: 4, neutro: 5 }

function primeraEnMayuscula(texto: string) {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/**
 * Para los puestos que no trabajan con órdenes —Ventas, Tesorería, Recursos
 * Humanos—: sus módulos, a un toque. Antes la pantalla decía «abre el menú» y
 * nada más, y quien llegaba al tablero no tenía a dónde ir desde aquí.
 */
function TusModulos({ perfil }: { perfil: PerfilSesion }) {
  const esAdmin = perfil.rol.codigo === 'ADMIN'
  const modulos = NAVEGACION.flatMap((g) => g.items).filter(
    (i) => i.ruta !== '/' && i.disponible && puedeVer(i, perfil.permisos, esAdmin, perfil.rol.codigo),
  )
  if (modulos.length === 0) return null
  return (
    <section aria-label="Tus módulos">
      <h2 className="mb-2 text-sm font-semibold text-texto">Tus módulos</h2>
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
