import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Factory,
  FileText,
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
import { exigirSesion, puede } from '@/lib/sesion'

export const metadata = { title: 'Tablero' }

export default async function PaginaTablero() {
  const perfil = await exigirSesion()

  const veVentas = puede(perfil, 'cotizaciones.ver')
  const comercial = veVentas ? await resumenComercial(perfil) : null

  if (!puede(perfil, 'ordenes.listar')) {
    // Quien vende no tiene por qué ver órdenes de trabajo, pero sí lo suyo.
    if (comercial) {
      return (
        <>
          <EncabezadoPagina
            titulo={`Hola, ${perfil.nombres}`}
            descripcion="Tus cotizaciones al día de hoy."
          />
          <TarjetasDeVentas resumen={comercial} />
        </>
      )
    }

    return (
      <EncabezadoPagina
        titulo={`Hola, ${perfil.nombres}`}
        // «El menú» y no «la barra lateral»: en el teléfono es el botón de
        // arriba, y a esta pantalla llega justamente quien todavía no sabe
        // dónde está lo suyo.
        descripcion="Abre el menú para entrar a los módulos habilitados para tu perfil."
      />
    )
  }

  // Las atrasadas se piden aparte y ordenadas por fecha comprometida: sacarlas
  // de la primera página de abiertas dejaba fuera una orden vieja y muy
  // atrasada, y la tarjeta llegaba a decir «ninguna» con el indicador en tres.
  const [indicadores, { ordenes }, atrasadas] = await Promise.all([
    indicadoresTablero(),
    listarOrdenes({ estado: 'ABIERTAS', pagina: 1 }),
    ordenesAtrasadas(),
  ])
  const puedeCrear = puede(perfil, 'ordenes.crear')
  // Para el pie de «Órdenes abiertas»: un número suelto no dice si son muchas
  // o pocas hasta que se ve contra el total registrado.
  const totalOrdenes = indicadores.total

  return (
    <>
      <EncabezadoPagina
        titulo={`Hola, ${perfil.nombres}`}
        descripcion="Estado del taller al día de hoy."
      />

      {comercial && <TarjetasDeVentas resumen={comercial} />}

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
          tono="peligro"
          pie="pasaron la fecha comprometida"
          href="/ordenes?estado=ABIERTAS&atrasadas=1"
        />
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
                    <EnlaceBoton href="/ordenes/nueva" tamano="sm">
                      <Plus aria-hidden className="size-3.5" />
                      Nueva orden
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
              descripcion="Órdenes que pasaron su fecha de entrega comprometida"
            />
            <TarjetaCuerpo className="space-y-2">
              {atrasadas.length === 0 ? (
                <p className="py-4 text-center text-sm text-exito">
                  Ninguna orden atrasada. Buen trabajo.
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
 * Lo comercial del tablero: qué me toca mover, qué está esperando al cliente y
 * cuánto se ofreció y se cerró este mes.
 *
 * Todo en soles, convertido con el tipo de cambio que congeló cada cotización:
 * la casa cotiza en dólares y gasta en soles, y una cifra que mezcla las dos
 * monedas no significa nada.
 */
function TarjetasDeVentas({ resumen }: { resumen: ResumenComercial }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <Indicador
        icono={FileText}
        titulo="Me toca mover"
        valor={resumen.meTocan}
        tono={resumen.meTocan > 0 ? 'acento' : 'neutro'}
        pie={resumen.meTocan > 0 ? 'Cotizaciones paradas en tu mano' : 'Nada esperándote'}
        href="/cotizaciones"
      />
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
