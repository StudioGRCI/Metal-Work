import { ChevronLeft, ChevronRight, Landmark } from 'lucide-react'
import Link from 'next/link'

import { DelDocumento } from '@/components/estructura/del-documento'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Boton } from '@/components/ui/boton'
import { Entrada } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SeccionDesplegable } from '@/components/ui/seccion-desplegable'
import { Tabla, TablaCabecera, TD, TH, TR } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cajaDelDia, type CajaDelDia, type CierreReabierto, type CuentaDelDia, type MovimientoDelDia } from '@/lib/datos/caja'
import { consolidado, detalleDeCuenta, enlaceCaptura, sumaEnLaCaja, esExtorno, estadoDelDia, monedaDeCuenta, ORIGEN_MOVIMIENTO, PANTALLA_DEL_ORIGEN } from '@/lib/dominio/caja'
import { fecha, fechaHora, fechaLarga, hoyLima, moneda, numero, sumarDias } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

import { AnularMovimiento, CerrarDia, EditarCuenta, EnviosDeLaCaja, ReabrirDia, RegistrarMovimiento, Transferir, type CuentaElegible } from './formularios'

export const metadata = { title: 'Caja diaria' }

const RUTA = '/tesoreria/caja-diaria'
/** Antes de esto no hay caja que mirar, y el año 0000 que acepta JavaScript la base no lo acepta. */
const PRIMER_DIA = '2020-01-01'
const enlaceDia = (dia: string, hoy: string, cuenta?: string) =>
  `${dia === hoy ? RUTA : `${RUTA}?fecha=${dia}`}${cuenta ? `#cuenta-${cuenta}` : ''}`

/** El día de la URL, si es uno de verdad y no es futuro. «2026-02-30» no lo es: Date lo pasaría al 2 de marzo y la base lo rechaza. */
function diaPedido(texto: string | string[] | undefined, hoy: string) {
  const d = typeof texto === 'string' ? texto : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > hoy || d < PRIMER_DIA) return hoy
  const leido = new Date(`${d}T12:00:00Z`)
  return Number.isNaN(leido.getTime()) || leido.toISOString().slice(0, 10) !== d ? hoy : d
}

/**
 * La caja diaria de Tesorería, como su libro ESTADO DE CAJA DIARIA (migración
 * 20261017200000): un día a la vez, cada cuenta con su saldo inicial, lo que
 * salió y lo que entró, su saldo final y el cierre contra el estado de cuenta,
 * y arriba el consolidado de todas. Tesorería registra a mano lo que no pasa
 * por el sistema; cada pago y cobro del sistema deja el suyo en la cuenta que
 * se eligió al registrarlo (migración 20261019100000), y se anula anulando ese
 * pago.
 */
export default async function PaginaCajaDiaria({ searchParams }: PageProps<'/tesoreria/caja-diaria'>) {
  await exigirPermiso('tesoreria.caja')
  const hoy = hoyLima()
  const dia = diaPedido((await searchParams).fecha, hoy)
  const caja = await cajaDelDia(dia)

  // Una cuenta desactivada sigue a la vista mientras tenga saldo, o el consolidado bajaría sin que nadie moviera la plata.
  const visibles = caja.cuentas.filter((c) => c.activa || c.movimientos > 0 || c.cierre_id || (c.saldo_final ?? 0) !== 0)
  // Las que suman en el consolidado: el mismo criterio que la cifra del Dashboard.
  const empezadas = caja.cuentas.filter((c) => sumaEnLaCaja(c, dia))
  // A las que hoy se les puede registrar: activas, ya empezadas y con el día abierto.
  const abiertas: CuentaElegible[] = empezadas
    .filter((c) => c.activa && !c.cierre_id && !(c.ultimo_cierre && dia <= c.ultimo_cierre))
    .map((c) => ({ id: c.id, nombre: c.nombre, moneda: c.moneda, tipo: c.tipo }))
  const pendientes = caja.cuentas.filter((c) => c.primer_dia_sin_cerrar && c.primer_dia_sin_cerrar < hoy)
  const total = consolidado(empezadas, caja.cambioCompra)
  const movimientosDe = (id: string) => caja.movimientos.filter((m) => m.caja_id === id)
  const reabiertosDe = (id: string) => caja.reabiertos.filter((k) => k.caja_id === id)
  const bancosSinCaptura = caja.cuentas.filter((c) => c.activa && c.tipo === 'BANCO' && !c.apertura_ruta).length

  return (
    <EnviosDeLaCaja>
      <EncabezadoPagina
        titulo="Caja diaria"
        ayuda="El saldo de cada cuenta día por día, como el estado de caja: lo que salió, lo que entró y el cierre contra el estado de cuenta del banco. Los pagos y cobros del sistema entran solos."
        acciones={<SelectorDeDia dia={dia} hoy={hoy} />}
      />

      {caja.cuentas.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo className="flex flex-col items-center py-10 text-center">
            <span className="rounded-full bg-acento-suave p-3 text-acento">
              <Landmark aria-hidden className="size-5" />
            </span>
            <p className="mt-3 text-sm font-semibold text-texto">Todavía no hay cuentas en la caja</p>
            <p className="mt-1 mb-4 max-w-lg text-sm text-texto-suave">
              Da de alta cada cuenta como está en el estado de caja —cada banco en soles y en dólares, y la caja chica si la llevas aquí— con el saldo con el que empieza.
            </p>
            <EditarCuenta hoy={hoy} primera />
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        // Lo de cada día se vuelve a montar con otro día: lo escrito para el A no
        // pasa al B, y cada formulario dice de cuál día es (X1, cuadragésima quinta pasada).
        <DelDocumento documento={`caja:${dia}`}>
          {pendientes.length > 0 && (
            <div role="status" className="mb-5 rounded-[var(--radius-base)] border border-aviso bg-aviso-suave p-3 text-sm text-texto">
              <p className="font-medium">Días sin cerrar</p>
              <ul className="mt-1 space-y-0.5">
                {pendientes.map((c) => (
                  <li key={c.id}>
                    {c.nombre} tiene movimientos sin cerrar desde el{' '}
                    <Link href={enlaceDia(c.primer_dia_sin_cerrar!, hoy, c.id)} className="font-medium text-acento hover:underline">
                      {fecha(c.primer_dia_sin_cerrar)}
                    </Link>
                    .
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Tarjeta className="mb-5">
            <TarjetaCabecera
              titulo={`Saldos del ${fechaLarga(dia)}`}
              ayuda="Cada cuenta en su moneda. El saldo final de un día es el inicial del siguiente."
              acciones={
                abiertas.length > 0 ? (
                  <>
                    <Transferir cuentas={abiertas} dia={dia} />
                    <RegistrarMovimiento cuentas={abiertas} dia={dia} codigos={caja.codigos} />
                  </>
                ) : undefined
              }
            />
            <Tabla>
              <TablaCabecera>
                {/* En el teléfono quedan la cuenta, con su estado debajo, y el saldo final, con la diferencia debajo: lo demás está en el bloque de cada cuenta. */}
                <TR>
                  <TH>Cuenta</TH>
                  <TH className="hidden text-right sm:table-cell">Saldo inicial</TH>
                  <TH className="hidden text-right sm:table-cell">Egresos</TH>
                  <TH className="hidden text-right sm:table-cell">Ingresos</TH>
                  <TH className="text-right">Saldo final</TH>
                  <TH className="hidden text-right sm:table-cell">Según el banco</TH>
                  <TH className="hidden text-right sm:table-cell">Diferencia</TH>
                  <TH className="hidden sm:table-cell">Día</TH>
                </TR>
              </TablaCabecera>
              <tbody>
                {visibles.map((c) => (
                  <FilaDeSaldo key={c.id} cuenta={c} dia={dia} hoy={hoy} />
                ))}
              </tbody>
            </Tabla>
            <TarjetaCuerpo className="flex flex-wrap gap-x-6 gap-y-1 border-t border-borde text-sm">
              <span className="text-texto-suave">
                En soles <span className="tabular font-semibold text-texto">{moneda(total.soles, 'PEN')}</span>
              </span>
              <span className="text-texto-suave">
                En dólares <span className="tabular font-semibold text-texto">{moneda(total.dolares, 'USD')}</span>
              </span>
              {total.totalEnSoles !== null ? (
                <span className="text-texto-suave">
                  Todo en soles <span className="tabular font-semibold text-texto">{moneda(total.totalEnSoles, 'PEN')}</span>
                  {caja.cambioCompra && <span className="text-xs"> · dólar a {numero(caja.cambioCompra, 3)}, compra</span>}
                </span>
              ) : (
                // Lo registra Contabilidad (migración 20261020174600): Tesorería ya no abre esa pantalla.
                <span className="text-aviso">Falta el tipo de cambio del {fecha(dia)} para pasar los dólares a soles: lo registran Contabilidad o Administración.</span>
              )}
            </TarjetaCuerpo>
          </Tarjeta>

          <div className="space-y-5">
            {empezadas.map((c) => (
              <BloqueDeCuenta
                key={c.id}
                cuenta={c}
                dia={dia}
                hoy={hoy}
                movimientos={movimientosDe(c.id)}
                reabiertos={reabiertosDe(c.id)}
                abiertas={abiertas}
                codigos={caja.codigos}
              />
            ))}
          </div>
        </DelDocumento>
      )}

      {caja.cuentas.length > 0 && (
        <SeccionDesplegable
          className="mt-5"
          titulo="Cuentas de Tesorería"
          // Lo que cambia, a la vista; que una cuenta no se borra sino que se desactiva lo dice su ventana.
          // Un banco sin la captura de su saldo pide atención: la sección se abre sola y muestra su aviso.
          abierta={bancosSinCaptura > 0}
          descripcion={[
            cuantas(caja.cuentas.filter((c) => c.activa).length, 'activa', 'activas'),
            cuantas(caja.cuentas.filter((c) => !c.activa).length, 'desactivada', 'desactivadas'),
            cuantas(bancosSinCaptura, 'sin la captura del saldo', 'sin la captura del saldo'),
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          <ul className="divide-y divide-borde">
            {caja.cuentas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-texto">
                    {c.nombre} {!c.activa && <Insignia>Desactivada</Insignia>}
                  </span>
                  <span className="block text-xs text-texto-suave">
                    {detalleDeCuenta(c)} · empezó el {fecha(c.fecha_inicio)} con {moneda(c.saldo_alta, monedaDeCuenta(c.moneda))}
                  </span>
                  {/* El respaldo de ese saldo: la captura del aplicativo (migración 20261020174500). */}
                  {c.apertura_ruta ? (
                    <a
                      href={enlaceCaptura(c.id)}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex min-h-11 items-center text-xs font-medium text-acento underline underline-offset-2 sm:min-h-0"
                      data-captura-saldo={c.nombre}
                    >
                      {c.tipo === 'BANCO' ? 'Ver la captura del saldo' : 'Ver la foto del conteo'}
                    </a>
                  ) : c.tipo === 'BANCO' ? (
                    <span className="block text-xs text-aviso" data-sin-captura={c.nombre}>
                      Sin la captura del saldo: adjúntala con «Corregir».
                    </span>
                  ) : null}
                </span>
                <EditarCuenta
                  cuenta={{
                    id: c.id,
                    nombre: c.nombre,
                    tipo: c.tipo,
                    banco: c.banco,
                    moneda: c.moneda,
                    saldo_inicial: c.saldo_alta,
                    fecha_inicio: c.fecha_inicio,
                    activa: c.activa,
                    con_movimientos: c.con_movimientos,
                    apertura_ruta: c.apertura_ruta,
                  }}
                  hoy={hoy}
                />
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <EditarCuenta hoy={hoy} />
          </div>
        </SeccionDesplegable>
      )}
    </EnviosDeLaCaja>
  )
}

/** «3 activas», «1 desactivada»; nada si no hay ninguna. */
const cuantas = (n: number, una: string, varias: string) => (n === 0 ? null : `${n} ${n === 1 ? una : varias}`)

function SelectorDeDia({ dia, hoy }: { dia: string; hoy: string }) {
  const siguiente = sumarDias(dia, 1)
  return (
    <form method="get" action={RUTA} className="flex flex-wrap items-center gap-2">
      {dia > PRIMER_DIA && (
        <EnlaceBoton href={enlaceDia(sumarDias(dia, -1), hoy)} variante="contorno" tamano="icono" aria-label="Día anterior">
          <ChevronLeft aria-hidden className="size-4" />
        </EnlaceBoton>
      )}
      <label htmlFor="caja-dia" className="sr-only">
        Día de la caja
      </label>
      <Entrada id="caja-dia" type="date" name="fecha" defaultValue={dia} min={PRIMER_DIA} max={hoy} className="w-auto" />
      <Boton type="submit" variante="secundario" tamano="sm">
        Ver
      </Boton>
      {siguiente <= hoy ? (
        <EnlaceBoton href={enlaceDia(siguiente, hoy)} variante="contorno" tamano="icono" aria-label="Día siguiente">
          <ChevronRight aria-hidden className="size-4" />
        </EnlaceBoton>
      ) : null}
      {dia !== hoy && (
        <EnlaceBoton href={RUTA} variante="fantasma" tamano="sm">
          Hoy
        </EnlaceBoton>
      )}
    </form>
  )
}

function FilaDeSaldo({ cuenta: c, dia, hoy }: { cuenta: CuentaDelDia; dia: string; hoy: string }) {
  const m = monedaDeCuenta(c.moneda)
  const estado = estadoDelDia(c, dia, hoy)
  const empezada = dia >= c.fecha_inicio
  return (
    <TR>
      <TD>
        {empezada ? (
          <a href={`#cuenta-${c.id}`} className="font-medium text-texto hover:text-acento hover:underline">
            {c.nombre}
          </a>
        ) : (
          <span className="font-medium text-texto">{c.nombre}</span>
        )}
        <span className="block text-xs text-texto-suave">
          {detalleDeCuenta(c)}
          {!c.activa && ' · desactivada'}
        </span>
        <span className="mt-1 block sm:hidden">
          <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
        </span>
      </TD>
      {empezada ? (
        <>
          <TD className="tabular hidden text-right sm:table-cell">{moneda(c.saldo_inicial, m)}</TD>
          <TD className="tabular hidden text-right sm:table-cell">{c.egresos > 0 ? moneda(c.egresos, m) : '—'}</TD>
          <TD className="tabular hidden text-right sm:table-cell">{c.ingresos > 0 ? moneda(c.ingresos, m) : '—'}</TD>
          <TD className="tabular text-right whitespace-nowrap">
            <span className={`font-semibold ${(c.saldo_final ?? 0) < 0 ? 'text-peligro' : ''}`}>{moneda(c.saldo_final, m)}</span>
            {c.diferencia ? (
              <span className="block text-xs font-normal text-aviso sm:hidden">Diferencia {moneda(c.diferencia, m)}</span>
            ) : null}
          </TD>
          <TD className="tabular hidden text-right sm:table-cell">{c.saldo_banco !== null ? moneda(c.saldo_banco, m) : '—'}</TD>
          <TD className={`tabular hidden text-right sm:table-cell ${c.diferencia ? 'text-aviso' : ''}`}>{c.diferencia !== null ? moneda(c.diferencia, m) : '—'}</TD>
        </>
      ) : (
        <TD colSpan={6} className="text-xs text-texto-suave">
          Empieza el {fecha(c.fecha_inicio)}.
        </TD>
      )}
      <TD className="hidden sm:table-cell">
        <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
      </TD>
    </TR>
  )
}

function BloqueDeCuenta({ cuenta: c, dia, hoy, movimientos, reabiertos, abiertas, codigos }: {
  cuenta: CuentaDelDia
  dia: string
  hoy: string
  movimientos: MovimientoDelDia[]
  reabiertos: CierreReabierto[]
  abiertas: CuentaElegible[]
  codigos: CajaDelDia['codigos']
}) {
  const m = monedaDeCuenta(c.moneda)
  const estado = estadoDelDia(c, dia, hoy)
  const abierta = abiertas.some((a) => a.id === c.id)
  // Cerrado sin un cierre propio: el día quedó dentro del cierre de un día posterior.
  const dentroDeOtroCierre = !c.cierre_id && !!c.ultimo_cierre && dia <= c.ultimo_cierre
  const diaSinCerrarAntes = c.primer_dia_sin_cerrar && c.primer_dia_sin_cerrar < dia ? c.primer_dia_sin_cerrar : null
  const puedeCerrar = !c.cierre_id && !dentroDeOtroCierre && !diaSinCerrarAntes
  const yo: CuentaElegible = { id: c.id, nombre: c.nombre, moneda: c.moneda, tipo: c.tipo }

  return (
    <Tarjeta id={`cuenta-${c.id}`} className="scroll-mt-20">
      <TarjetaCabecera
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {c.nombre}
            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
            {!c.activa && <Insignia>Desactivada</Insignia>}
          </span>
        }
        descripcion={`${detalleDeCuenta(c)} · empieza el día con ${moneda(c.saldo_inicial, m)} y termina con ${moneda(c.saldo_final, m)}`}
        ayuda={puedeCerrar ? 'Al terminar el día, ciérralo con el saldo que dice el estado de cuenta. Cerrado, el día ya no cambia.' : undefined}
        // Registrar y cerrar, juntos arriba: el cierre iba en un renglón propio al pie, con una frase que se repetía en cada cuenta.
        acciones={
          abierta || puedeCerrar ? (
            <>
              {abierta && <RegistrarMovimiento cuentas={abiertas} cuentaId={c.id} dia={dia} codigos={codigos} compacto />}
              {puedeCerrar && <CerrarDia cuenta={yo} dia={dia} saldoFinal={c.saldo_final ?? 0} />}
            </>
          ) : undefined
        }
      />
      {movimientos.length === 0 ? (
        <TarjetaCuerpo className="border-t border-borde text-sm text-texto-suave">
          Sin movimientos este día.{abierta ? ' Regístralos con «Registrar».' : ''}
        </TarjetaCuerpo>
      ) : (
        <Tabla>
          {/* En el teléfono no caben siete columnas: el código, la operación y quién registró van bajo la descripción, y egreso o ingreso en una sola columna con su signo. */}
          <TablaCabecera>
            <TR>
              <TH>Descripción</TH>
              <TH className="hidden sm:table-cell">Código interno</TH>
              <TH className="hidden sm:table-cell">N.º operación</TH>
              <TH className="hidden text-right sm:table-cell">Egreso</TH>
              <TH className="hidden text-right sm:table-cell">Ingreso</TH>
              <TH className="text-right sm:hidden">Monto</TH>
              <TH className="hidden sm:table-cell">Registró</TH>
              {/* Solo en un día abierto: cerrado, la columna vacía corría los montos al medio. */}
              {abierta && (
                // `relative`: sin él, el texto oculto se posiciona contra la página y la ensancha en el teléfono.
                <TH className="relative">
                  <span className="sr-only">Anular</span>
                </TH>
              )}
            </TR>
          </TablaCabecera>
          <tbody>
            {movimientos.map((mov) => (
              <FilaDeMovimiento key={mov.id} movimiento={mov} moneda={m} cuenta={c.nombre} abierta={abierta} />
            ))}
            <tr className="hidden border-t border-borde bg-superficie-2 font-semibold sm:table-row">
              <td colSpan={3} className="px-3 py-2 text-right text-xs text-texto-suave uppercase">
                Total del día
              </td>
              <td className="tabular px-3 py-2 text-right">{moneda(c.egresos, m)}</td>
              <td className="tabular px-3 py-2 text-right">{moneda(c.ingresos, m)}</td>
              <td colSpan={abierta ? 2 : 1} />
            </tr>
            <tr className="border-t border-borde bg-superficie-2 sm:hidden">
              <td colSpan={abierta ? 3 : 2} className="px-3 py-2 text-xs text-texto-suave">
                <span className="block font-semibold uppercase">Total del día</span>
                <span className="tabular">
                  Salió {moneda(c.egresos, m)} · entró {moneda(c.ingresos, m)}
                </span>
              </td>
            </tr>
          </tbody>
        </Tabla>
      )}

      {/* El pie, solo cuando dice algo: el cierre, por qué todavía no se cierra o lo que se reabrió. */}
      {(!puedeCerrar || reabiertos.length > 0) && (
        <TarjetaCuerpo className="space-y-2 border-t border-borde text-sm">
          {c.cierre_id ? (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-texto-suave">
                Cerrado por {c.cerrado_por ?? '—'} el {fechaHora(c.cerrado_en)}; según el estado de cuenta,{' '}
                <span className="tabular font-medium text-texto">{moneda(c.saldo_banco, m)}</span>
                {c.diferencia ? (
                  <span className="text-aviso">
                    {' '}
                    · diferencia de <span className="tabular">{moneda(c.diferencia, m)}</span>
                  </span>
                ) : (
                  <span className="text-exito"> · cuadra</span>
                )}
                {c.observaciones && <span className="block text-texto">{c.observaciones}</span>}
              </p>
              {c.ultimo_cierre === dia && <ReabrirDia cierreId={c.cierre_id} cuenta={c.nombre} dia={dia} />}
            </div>
          ) : dentroDeOtroCierre ? (
            <p className="text-texto-suave">
              Este día quedó dentro del cierre del{' '}
              <Link href={enlaceDia(c.ultimo_cierre!, hoy, c.id)} className="text-acento hover:underline">
                {fecha(c.ultimo_cierre)}
              </Link>
              : ya no cambia.
            </p>
          ) : diaSinCerrarAntes ? (
            <p className="text-aviso">
              Para cerrar este día, primero cierra el{' '}
              <Link href={enlaceDia(diaSinCerrarAntes, hoy, c.id)} className="font-medium text-acento hover:underline">
                {fecha(diaSinCerrarAntes)}
              </Link>
              .
            </p>
          ) : null}
          {reabiertos.map((k) => (
            <p key={k.id} className="text-xs text-texto-suave">
              <span className="line-through">
                Cierre de {k.cerrado_por ?? '—'} del {fechaHora(k.creado_en)} ({moneda(k.saldo_banco, m)})
              </span>{' '}
              · reabierto por {k.anulado_por ?? '—'} el {fechaHora(k.anulado_en)}: {k.motivo_anulacion}
            </p>
          ))}
        </TarjetaCuerpo>
      )}
    </Tarjeta>
  )
}

function FilaDeMovimiento({ movimiento: mov, moneda: m, cuenta, abierta }: {
  movimiento: MovimientoDelDia
  moneda: 'PEN' | 'USD'
  cuenta: string
  abierta: boolean
}) {
  const anulado = !!mov.anulado_en
  const transferencia = mov.origen === 'TRANSFERENCIA'
  const anulable = !anulado && abierta && (mov.origen === 'MANUAL' || transferencia)
  const enElTelefono = [mov.codigo_interno, mov.operacion && `Op. ${mov.operacion}`, mov.registrado_por].filter(Boolean).join(' · ')
  const tachado = anulado ? 'line-through' : ''
  return (
    <TR className={anulado ? 'text-texto-suave' : undefined}>
      <TD className="max-w-xs">
        <span className={anulado ? 'line-through' : undefined}>{mov.descripcion}</span>
        {transferencia && mov.otra_cuenta && (
          <span className="block text-xs text-texto-suave">
            {mov.tipo === 'EGRESO' ? `Transferencia a ${mov.otra_cuenta}` : `Transferencia de ${mov.otra_cuenta}`}
          </span>
        )}
        {!transferencia && mov.origen !== 'MANUAL' && (
          <span className="block text-xs text-texto-suave">
            {ORIGEN_MOVIMIENTO[mov.origen] ?? mov.origen}
            {esExtorno(mov.origen, mov.tipo) ? (
              ' · extorno de uno anulado, cuyo día ya estaba cerrado'
            ) : (
              !anulado &&
              PANTALLA_DEL_ORIGEN[mov.origen] && (
                // En su propio renglón: con 44 px para tocarlo, metido en la frase la partía en renglones altos.
                <span className="flex min-h-11 items-center sm:block sm:min-h-0">
                  Se anula en:&nbsp;
                  <Link
                    href={mov.planilla_id ? `/planilla-diaria/${mov.planilla_id}` : PANTALLA_DEL_ORIGEN[mov.origen].ruta}
                    className="text-acento underline underline-offset-2"
                  >
                    {mov.planilla_id ? 'su planilla' : PANTALLA_DEL_ORIGEN[mov.origen].nombre}
                  </Link>
                </span>
              )
            )}
          </span>
        )}
        {mov.tipo_cambio && <span className="block text-xs text-texto-suave">Cambio {numero(mov.tipo_cambio, 4)}</span>}
        {anulado && (
          <span className="block text-xs text-peligro">
            Anulado por {mov.anulado_por ?? '—'}: {mov.motivo_anulacion}
          </span>
        )}
        {enElTelefono && <span className="tabular block text-xs text-texto-suave sm:hidden">{enElTelefono}</span>}
      </TD>
      <TD className="tabular hidden text-xs sm:table-cell">{mov.codigo_interno ?? '—'}</TD>
      <TD className="tabular hidden text-xs sm:table-cell">{mov.operacion ?? '—'}</TD>
      <TD className={`tabular hidden text-right whitespace-nowrap sm:table-cell ${tachado}`}>{mov.tipo === 'EGRESO' ? moneda(mov.monto, m) : ''}</TD>
      <TD className={`tabular hidden text-right whitespace-nowrap sm:table-cell ${tachado}`}>{mov.tipo === 'INGRESO' ? moneda(mov.monto, m) : ''}</TD>
      <TD className="text-right whitespace-nowrap sm:hidden" data-monto-telefono>
        <span className={`tabular block ${tachado} ${mov.tipo === 'INGRESO' ? 'text-exito' : ''}`}>
          {mov.tipo === 'EGRESO' ? '−' : '+'}
          {moneda(mov.monto, m)}
        </span>
        <span className="block text-[11px] text-texto-suave">{mov.tipo === 'EGRESO' ? 'Egreso' : 'Ingreso'}</span>
      </TD>
      <TD className="hidden text-xs text-texto-suave sm:table-cell">{mov.registrado_por ?? '—'}</TD>
      {abierta && (
        <TD className="w-12 text-right">
          {anulable && <AnularMovimiento id={mov.id} descripcion={mov.descripcion} cuenta={cuenta} otraCuenta={transferencia ? mov.otra_cuenta : null} />}
        </TD>
      )}
    </TR>
  )
}
