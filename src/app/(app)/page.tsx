import Link from 'next/link'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Factory,
  HandCoins,
  PauseCircle,
  Plus,
  Send,
  Zap,
} from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Indicador } from '@/components/ui/indicador'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_OT, ORDEN_ESTADO_OT, definir } from '@/lib/dominio/estados'
import { nombreDeUnidad, todaviaSinPlaca } from '@/lib/dominio/unidades'
import { fecha, moneda } from '@/lib/format'
import { resumenComercial, type ResumenComercial } from '@/lib/datos/comercial'
import { indicadoresTablero, listarOrdenes, ordenesAtrasadas } from '@/lib/datos/ordenes'
import { pendientesGlobales, type PendienteGlobal } from '@/lib/datos/pendientes-globales'
import { resumenDePlazos } from '@/lib/datos/plazos'
import { exigirSesion, puede } from '@/lib/sesion'

export const metadata = { title: 'Tablero' }

export default async function PaginaTablero() {
  const perfil = await exigirSesion()

  const veVentas = puede(perfil, 'cotizaciones.ver')
  // Lo que le toca a este puesto va primero: es a lo que se entra a mirar.
  const [comercial, pendientes] = await Promise.all([
    veVentas ? resumenComercial(perfil) : Promise.resolve(null),
    pendientesGlobales(perfil),
  ])

  if (!puede(perfil, 'ordenes.listar')) {
    // Quien vende no tiene por qué ver órdenes de trabajo, pero sí lo suyo.
    if (comercial) {
      return (
        <>
          <EncabezadoPagina
            titulo={perfil.puesto}
            descripcion="Tus cotizaciones al día de hoy."
          />
          <TeTocaHoy items={pendientes.items} />
          <TarjetasDeVentas resumen={comercial} />
        </>
      )
    }

    return (
      <>
        <EncabezadoPagina
          titulo={perfil.puesto}
          // «El menú» y no «la barra lateral»: en el teléfono es el botón de
          // arriba, y a esta pantalla llega justamente quien todavía no sabe
          // dónde está lo suyo.
          descripcion="Abre el menú para entrar a los módulos habilitados para tu perfil."
        />
        <TeTocaHoy items={pendientes.items} />
      </>
    )
  }

  // Las atrasadas se piden aparte y ordenadas por fecha comprometida: sacarlas
  // de la primera página de abiertas dejaba fuera una orden vieja y muy
  // atrasada, y la tarjeta llegaba a decir «ninguna» con el indicador en tres.
  // «Atrasadas» cuenta órdenes que pasaron su entrega; las etapas vencidas van
  // aparte: una orden con la entrega a un mes puede llevar tres etapas
  // vencidas, y el Tablero decía «buen trabajo» con quince vencidas en /plazos.
  const [indicadores, { ordenes }, atrasadas, plazos] = await Promise.all([
    indicadoresTablero(),
    listarOrdenes({ estado: 'ABIERTAS', pagina: 1 }),
    ordenesAtrasadas(),
    puede(perfil, ['produccion.ver', 'ordenes.listar']) ? resumenDePlazos() : Promise.resolve(null),
  ])
  const puedeCrear = puede(perfil, 'ordenes.crear')
  const etapasVencidas = plazos?.porPlazo.VENCIDO ?? 0
  const areasConVencidas = (plazos?.areas ?? []).filter((a) => a.vencidas > 0).slice(0, 3)
  // Para el pie de «Órdenes abiertas»: un número suelto no dice si son muchas
  // o pocas hasta que se ve contra el total registrado.
  const totalOrdenes = indicadores.total

  return (
    <>
      {/* El puesto y no el nombre (migración 109): la pantalla es del puesto,
          quien lo ocupe hoy ya sabe cómo se llama. */}
      <EncabezadoPagina titulo={perfil.puesto} descripcion="Estado del taller al día de hoy." />

      <TeTocaHoy items={pendientes.items} />

      {comercial && <TarjetasDeVentas resumen={comercial} />}

      {/* Dos columnas ya en el teléfono: cinco tarjetas apiladas ocupaban una
          pantalla entera antes de llegar a la lista de órdenes. */}
      <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${plazos ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
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
          tono="peligro"
          pie="pasaron la fecha comprometida"
          href="/ordenes?estado=ABIERTAS&atrasadas=1"
        />
        {plazos && (
          <Indicador
            icono={CalendarClock}
            titulo="Etapas vencidas"
            valor={etapasVencidas}
            tono={etapasVencidas > 0 ? 'peligro' : 'exito'}
            pie={etapasVencidas > 0 ? 'pasaron su fecha en el programa' : 'todas las etapas en fecha'}
            href="/plazos?plazo=VENCIDO"
          />
        )}
        <Indicador
          icono={Zap}
          titulo="Urgentes"
          valor={indicadores.urgentes}
          tono="peligro"
          pie={`de ${indicadores.abiertas} abiertas`}
          href="/ordenes?estado=ABIERTAS&prioridad=URGENTE"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Tarjeta className="lg:col-span-2">
          <TarjetaCabecera
            titulo="Órdenes en taller"
            descripcion="Lo que está abierto ahora mismo, por fecha de registro"
            acciones={
              <Link
                href="/ordenes?estado=ABIERTAS"
                className="inline-flex min-h-11 items-center text-xs text-acento hover:underline sm:min-h-0"
              >
                Ver todas
              </Link>
            }
          />
          <TarjetaCuerpo className="space-y-3">
            {ordenes.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-texto">No hay órdenes abiertas</p>
                <p className="mt-1 text-xs text-texto-suave">
                  En cuanto se apruebe una, aparece acá con su avance.
                </p>
                {puedeCrear && (
                  <div className="mt-4 flex justify-center">
                    {/* El camino real: la orden sale de la cotización aprobada,
                        con su número de papel y su PDF (migración 108). */}
                    <EnlaceBoton href="/cotizaciones/pdf?estado=APROBADA_SIN_OT" tamano="sm">
                      <Plus aria-hidden className="size-3.5" />
                      Emitir OT desde una cotización
                    </EnlaceBoton>
                  </div>
                )}
              </div>
            ) : (
              ordenes.slice(0, 8).map((orden) => {
                const estado = definir(ESTADO_OT, orden.estado)
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
                  <Link
                    key={orden.id}
                    href={`/ordenes/${orden.id}`}
                    className="flex items-center gap-3 rounded-[var(--radius-base)] p-2 hover:bg-superficie-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-texto">
                        {orden.numero}
                        <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                      </p>
                      <p className="truncate text-xs text-texto-suave">
                        {orden.cliente}
                        {unidad && (
                          <span
                            className={todaviaSinPlaca(unidad) ? 'text-texto-tenue' : undefined}
                          >
                            {` · ${nombreDeUnidad(unidad)}`}
                          </span>
                        )}
                      </p>
                    </div>
                    {/* La barra cede ancho en el teléfono: con 128 px fijos el
                        número de orden y el cliente quedaban recortados. */}
                    <div className="w-20 shrink-0 sm:w-32">
                      <Progreso valor={orden.avance_porcentaje} mostrarValor alto="sm" />
                    </div>
                  </Link>
                )
              })
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <div className="space-y-4">
          <Tarjeta>
            <TarjetaCabecera titulo="Por estado" />
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

          <Tarjeta>
            <TarjetaCabecera
              titulo="Requieren atención"
              descripcion="Órdenes que pasaron su fecha de entrega, y las áreas con etapas vencidas"
            />
            <TarjetaCuerpo className="space-y-2">
              {areasConVencidas.length > 0 && (
                <ul className="mb-2 space-y-1 border-b border-borde pb-2">
                  {areasConVencidas.map((a) => (
                    <li key={a.codigo}>
                      <Link
                        href={`/plazos?area=${a.codigo}&plazo=VENCIDO`}
                        className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-base)] px-2 text-sm hover:bg-superficie-2 sm:min-h-0 sm:py-1.5"
                      >
                        <span className="text-texto">{a.nombre}</span>
                        <span className="tabular text-xs font-medium text-peligro">
                          {a.vencidas} {a.vencidas === 1 ? 'etapa vencida' : 'etapas vencidas'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {atrasadas.length === 0 ? (
                <p className="py-4 text-center text-sm text-exito">
                  {areasConVencidas.length > 0
                    ? 'Ninguna orden pasó su fecha de entrega.'
                    : 'Ninguna orden atrasada. Buen trabajo.'}
                </p>
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
        </div>
      </div>
    </>
  )
}

/**
 * Lo que le toca a este puesto, con el número y el enlace a donde se resuelve.
 * Cada tarjeta existe solo para quien tiene el permiso que la resuelve; si no
 * hay nada, se dice en una línea y no se ocupa media pantalla.
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
    <section aria-label="Te toca" className="mb-4">
      <p className="mb-2 text-[11px] font-medium tracking-wide text-texto-suave uppercase">Te toca</p>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {items.map((i) => (
          <Indicador
            key={i.clave}
            icono={ClipboardList}
            titulo={i.texto.replace(/^\d+\s/, '')}
            valor={i.cantidad}
            tono={i.tono === 'neutro' ? 'neutro' : i.tono === 'exito' ? 'exito' : i.tono === 'info' ? 'acento' : i.tono}
            href={i.ruta}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * Lo comercial del tablero: qué está esperando al cliente y cuánto se ofreció
 * y se cerró este mes en la cotización de venta del sistema. Lo que le toca
 * mover a cada mano ya lo dice «Te toca», que sí conoce la cotización en PDF.
 *
 * Todo en soles, convertido con el tipo de cambio que congeló cada cotización:
 * la casa cotiza en dólares y gasta en soles, y una cifra que mezcla las dos
 * monedas no significa nada.
 */
function TarjetasDeVentas({ resumen }: { resumen: ResumenComercial }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
      <Indicador
        icono={Send}
        titulo="Con el cliente"
        valor={resumen.esperandoCliente}
        pie={
          resumen.listasParaEnviar > 0
            ? `y ${resumen.listasParaEnviar} lista(s) para enviar`
            : 'Enviadas y sin respuesta'
        }
        href="/cotizaciones?estado=ENVIADA"
      />
      <Indicador
        icono={HandCoins}
        titulo="Ofrecido este mes"
        valor={moneda(resumen.ofrecidoDelMes, 'PEN')}
        pie={`${resumen.cotizadasDelMes} cotización(es)`}
      />
      <Indicador
        icono={CheckCircle2}
        titulo="Cerrado este mes"
        valor={moneda(resumen.cerradoDelMes, 'PEN')}
        tono={resumen.cerradoDelMes > 0 ? 'exito' : 'neutro'}
        pie={`${resumen.cerradasDelMes} aprobada(s) por el cliente`}
      />
    </div>
  )
}
