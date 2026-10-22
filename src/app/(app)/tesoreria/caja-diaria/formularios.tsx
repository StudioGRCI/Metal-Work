'use client'

import { ArrowLeftRight, Ban, ImageIcon, Lock, LockOpen, Pencil, Plus } from 'lucide-react'
import { useRef, useState } from 'react'

import { EntradaCodigoInterno, type CodigoParaElegir } from '@/components/codigo-interno/elegir-codigo'
import { CODIGOS_FIJOS } from '@/lib/dominio/codigos-internos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import {
  ACEPTA_CAPTURA_SALDO,
  BUCKET_APERTURA_CAJA,
  DESCRIPCIONES_FRECUENTES,
  enlaceCaptura,
  MAXIMO_MB_CAPTURA_SALDO,
  monedaDeCuenta,
  nombreMoneda,
  normalizarMonto,
  problemaDeLaCaptura,
  rutaDeCapturaDeSaldo,
  SALDO,
} from '@/lib/dominio/caja'
import { useCursorAlRechazo, useEnvio } from '@/lib/envio'
import { fecha, moneda } from '@/lib/format'
import { subirArchivoPrivado } from '@/lib/subida-privada'
import { createClient } from '@/lib/supabase/client'

import { anularMovimiento, cerrarDia, guardarCuenta, reabrirDia, registrarMovimiento, registrarTransferencia } from './acciones'

/** Una cuenta que se puede elegir en un formulario de la caja. */
export type CuentaElegible = { id: string; nombre: string; moneda: string; tipo: string }

/** El pie de todos los formularios: el error, cancelar y el botón que envía. */
function Pie({ error, enviando, alCancelar, texto, variante }: {
  error: string | null
  enviando: boolean
  alCancelar: () => void
  texto: string
  variante?: 'primario' | 'peligro'
}) {
  // Tras un rechazo, el cursor va al aviso. Sin esto caía a la página, y en el
  // teléfono un aviso largo deja el botón debajo del borde de la ventana.
  const aviso = useRef<HTMLParagraphElement>(null)
  useCursorAlRechazo(enviando, error, () => aviso.current)
  return (
    <>
      {error && (
        <p ref={aviso} role="alert" tabIndex={-1} className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Boton type="button" variante="contorno" onClick={alCancelar}>
          Cancelar
        </Boton>
        <Boton type="submit" variante={variante} cargando={enviando}>
          {texto}
        </Boton>
      </div>
    </>
  )
}

/** Abre una ventana con un formulario nuevo cada vez: otro id, nada de lo escrito la vez anterior. */
function useVentana() {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  return {
    abierta,
    vez,
    abrir: () => {
      setVez((v) => v + 1)
      setAbierta(true)
    },
    cerrar: () => setAbierta(false),
  }
}

// ---------------------------------------------------------------- ingreso o egreso

export function RegistrarMovimiento({ cuentas, cuentaId, dia, codigos, compacto = false }: {
  cuentas: CuentaElegible[]
  cuentaId?: string
  dia: string
  codigos: CodigoParaElegir[] | null
  compacto?: boolean
}) {
  const v = useVentana()
  const cuenta = cuentas.find((c) => c.id === cuentaId)
  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        variante={compacto ? 'contorno' : 'primario'}
        onClick={v.abrir}
        aria-label={cuenta ? `Registrar en ${cuenta.nombre}` : undefined}
        data-registrar-movimiento={cuenta?.nombre ?? 'caja'}
      >
        <Plus aria-hidden className="size-4" />
        {compacto ? (
          'Registrar'
        ) : (
          <>
            {/* En el teléfono los dos botones de la cabecera tienen que caber en una línea. */}
            <span className="sm:hidden">Registrar</span>
            <span className="hidden sm:inline">Registrar ingreso o egreso</span>
          </>
        )}
      </Boton>
      <Ventana
        abierta={v.abierta}
        alCerrar={v.cerrar}
        titulo={cuenta ? `Registrar en ${cuenta.nombre}` : 'Registrar un ingreso o un egreso'}
        descripcion={`Del ${fecha(dia)}. Solo lo que no pasa por el sistema: los pagos y cobros de Tesorería —facturas, órdenes de servicio, recibos, planilla diaria— entran solos. Escríbelo como sale en el estado de cuenta; si es de una unidad, con su código interno.`}
        ancho="md"
      >
        <FormularioMovimiento key={v.vez} cuentas={cuentas} cuentaId={cuentaId} dia={dia} codigos={codigos} alTerminar={v.cerrar} />
      </Ventana>
    </>
  )
}

function FormularioMovimiento({ cuentas, cuentaId, dia, codigos, alTerminar }: {
  cuentas: CuentaElegible[]
  cuentaId?: string
  dia: string
  codigos: CodigoParaElegir[] | null
  alTerminar: () => void
}) {
  // Decidido aquí: un reintento manda el mismo y la base no registra otro.
  const [id] = useState(() => crypto.randomUUID())
  const [caja, setCaja] = useState(cuentaId ?? cuentas[0]?.id ?? '')
  const [codigo, setCodigo] = useState('')
  const { alEnviar, enviando, error } = useEnvio(registrarMovimiento, alTerminar)
  const p = `mov-${id.slice(0, 8)}`
  const m = monedaDeCuenta(cuentas.find((c) => c.id === caja)?.moneda)

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="fecha" value={dia} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Cuenta" htmlFor={`${p}-caja`} requerido>
          <Seleccion id={`${p}-caja`} name="caja_id" value={caja} onChange={(e) => setCaja(e.target.value)} required>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} · {nombreMoneda(c.moneda)}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Es un" htmlFor={`${p}-tipo`} requerido>
          <Seleccion id={`${p}-tipo`} name="tipo" defaultValue="EGRESO" required>
            <option value="EGRESO">Egreso: sale de la cuenta</option>
            <option value="INGRESO">Ingreso: entra a la cuenta</option>
          </Seleccion>
        </Campo>
      </div>
      {/* Sin ejemplos dentro de los campos de la caja: se leían como si ya estuvieran escritos. Van en la ayuda, corta para que se vea entera. */}
      <Campo etiqueta="Descripción" htmlFor={`${p}-descripcion`} requerido ayuda="Como en el estado de cuenta: el ITF, una comisión…">
        <Entrada id={`${p}-descripcion`} name="descripcion" list={`${p}-frecuentes`} required minLength={3} maxLength={300} autoComplete="off" />
        <datalist id={`${p}-frecuentes`}>
          {DESCRIPCIONES_FRECUENTES.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta={`Monto en ${nombreMoneda(m)}`} htmlFor={`${p}-monto`} requerido ayuda="Con sus decimales, como en el estado de cuenta.">
          <Entrada id={`${p}-monto`} name="monto" inputMode="decimal" required autoComplete="off" className="tabular" />
        </Campo>
        <Campo etiqueta="Código interno" htmlFor={`${p}-codigo`} ayudaEnIcono={false} ayuda="Búscalo por el código, la placa o la marca. Un egreso con código entra al costo de esa unidad: trámites, comisión, viáticos, compras chicas. No lo pongas en el pago de una OC, OS, recibo o planilla, ni en un gasto que Administración ya aprobó en la OT: ese ya está en su costo.">
          <EntradaCodigoInterno id={`${p}-codigo`} name="codigo_interno" valor={codigo} onChange={setCodigo} codigos={codigos} fijos={CODIGOS_FIJOS} />
        </Campo>
        <Campo etiqueta="N.º de operación" htmlFor={`${p}-operacion`} ayuda="El del banco, si lo hay.">
          <Entrada id={`${p}-operacion`} name="operacion" maxLength={60} autoComplete="off" className="tabular" />
        </Campo>
        <Campo etiqueta="Tipo de cambio" htmlFor={`${p}-cambio`} ayuda="Solo si se pactó en la otra moneda: soles por dólar.">
          <Entrada id={`${p}-cambio`} name="tipo_cambio" inputMode="decimal" autoComplete="off" className="tabular" />
        </Campo>
      </div>
      <Pie error={error} enviando={enviando} alCancelar={alTerminar} texto="Registrar" />
    </form>
  )
}

// ---------------------------------------------------------------- entre cuentas

export function Transferir({ cuentas, dia }: { cuentas: CuentaElegible[]; dia: string }) {
  const v = useVentana()
  if (cuentas.length < 2) return null
  return (
    <>
      <Boton type="button" tamano="sm" variante="contorno" onClick={v.abrir} data-transferir>
        <ArrowLeftRight aria-hidden className="size-4" />
        Transferir<span className="hidden sm:inline"> entre cuentas</span>
      </Boton>
      <Ventana
        abierta={v.abierta}
        alCerrar={v.cerrar}
        titulo="Transferir entre cuentas"
        descripcion={`Del ${fecha(dia)}: sale de una cuenta y entra a la otra el mismo día, como la reposición de la caja chica o la compra de dólares.`}
        ancho="md"
      >
        <FormularioTransferencia key={v.vez} cuentas={cuentas} dia={dia} alTerminar={v.cerrar} />
      </Ventana>
    </>
  )
}

function FormularioTransferencia({ cuentas, dia, alTerminar }: { cuentas: CuentaElegible[]; dia: string; alTerminar: () => void }) {
  const [id] = useState(() => crypto.randomUUID())
  const [origen, setOrigen] = useState(cuentas[0]?.id ?? '')
  const [destino, setDestino] = useState(cuentas[1]?.id ?? '')
  const { alEnviar, enviando, error } = useEnvio(registrarTransferencia, alTerminar)
  const p = `tr-${id.slice(0, 8)}`
  const sale = cuentas.find((c) => c.id === origen)
  const entra = cuentas.find((c) => c.id === destino)
  const otraMoneda = !!sale && !!entra && sale.moneda !== entra.moneda

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="fecha" value={dia} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Sale de" htmlFor={`${p}-origen`} requerido>
          <Seleccion id={`${p}-origen`} name="origen" value={origen} onChange={(e) => setOrigen(e.target.value)} required>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} · {nombreMoneda(c.moneda)}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Entra a" htmlFor={`${p}-destino`} requerido>
          <Seleccion id={`${p}-destino`} name="destino" value={destino} onChange={(e) => setDestino(e.target.value)} required>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id} disabled={c.id === origen}>
                {c.nombre} · {nombreMoneda(c.moneda)}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta={`Sale, en ${nombreMoneda(sale?.moneda)}`} htmlFor={`${p}-monto`} requerido>
          <Entrada id={`${p}-monto`} name="monto" inputMode="decimal" required autoComplete="off" className="tabular" />
        </Campo>
        {otraMoneda ? (
          <Campo etiqueta={`Entra, en ${nombreMoneda(entra?.moneda)}`} htmlFor={`${p}-destino-monto`} requerido ayuda="Lo que dice el voucher; la base saca el cambio.">
            <Entrada id={`${p}-destino-monto`} name="monto_destino" inputMode="decimal" required autoComplete="off" className="tabular" />
          </Campo>
        ) : (
          <p className="self-end pb-2 text-xs text-texto-suave">Entra lo mismo que sale: las dos cuentas son en {nombreMoneda(sale?.moneda)}.</p>
        )}
      </div>
      <Campo etiqueta="N.º de operación" htmlFor={`${p}-operacion`} ayuda="El del banco, si lo hay.">
        <Entrada id={`${p}-operacion`} name="operacion" maxLength={60} autoComplete="off" className="tabular" />
      </Campo>
      <Campo etiqueta="Descripción" htmlFor={`${p}-descripcion`} ayuda="Si la dejas vacía, dice «Transferencia entre cuentas».">
        <Entrada id={`${p}-descripcion`} name="descripcion" maxLength={300} autoComplete="off" />
      </Campo>
      <Pie error={error} enviando={enviando} alCancelar={alTerminar} texto="Registrar la transferencia" />
    </form>
  )
}

// ---------------------------------------------------------------- anular

export function AnularMovimiento({ id, descripcion, cuenta, otraCuenta }: {
  id: string
  descripcion: string
  cuenta: string
  otraCuenta: string | null
}) {
  const v = useVentana()
  const { alEnviar, enviando, error } = useEnvio(anularMovimiento, v.cerrar)
  return (
    <>
      <Boton type="button" tamano="icono" variante="fantasma" onClick={v.abrir} aria-label={`Anular «${descripcion}» de ${cuenta}`} data-anular-movimiento={descripcion}>
        <Ban aria-hidden className="size-4" />
      </Boton>
      <Ventana
        abierta={v.abierta}
        alCerrar={v.cerrar}
        titulo={`Anular «${descripcion}»`}
        descripcion={
          otraCuenta
            ? `Es una transferencia: se anula entera, también su parte en ${otraCuenta}. No se borra: queda con su motivo.`
            : 'No se borra: queda tachado con su motivo, y deja de sumar al saldo.'
        }
        ancho="md"
      >
        <form key={v.vez} onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Campo etiqueta="Motivo" htmlFor={`anular-mov-${id}`} requerido>
            <AreaTexto id={`anular-mov-${id}`} name="motivo" required minLength={10} maxLength={500} />
          </Campo>
          <Pie error={error} enviando={enviando} alCancelar={v.cerrar} texto="Anular" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}

// ---------------------------------------------------------------- cerrar y reabrir el día

export function CerrarDia({ cuenta, dia, saldoFinal }: { cuenta: CuentaElegible; dia: string; saldoFinal: number }) {
  const v = useVentana()
  return (
    <>
      {/* En contorno, como «Registrar»: va en la cabecera de cada cuenta, y en azul lleno
          era lo más visible de la caja a media mañana, cuando lo que toca es registrar. */}
      <Boton type="button" variante="contorno" tamano="sm" onClick={v.abrir} aria-label={`Cerrar el día de ${cuenta.nombre}`} data-cerrar-dia={cuenta.nombre}>
        <Lock aria-hidden className="size-4" />
        Cerrar el día
      </Boton>
      <Ventana
        abierta={v.abierta}
        alCerrar={v.cerrar}
        titulo={`Cerrar el ${fecha(dia)} de ${cuenta.nombre}`}
        descripcion={`La caja dice ${moneda(saldoFinal, monedaDeCuenta(cuenta.moneda))}. Escribe lo que dice el estado de cuenta; cerrado, el día ya no cambia.`}
        ancho="sm"
      >
        <FormularioCierre key={v.vez} cuenta={cuenta} dia={dia} saldoFinal={saldoFinal} alTerminar={v.cerrar} />
      </Ventana>
    </>
  )
}

function FormularioCierre({ cuenta, dia, saldoFinal, alTerminar }: {
  cuenta: CuentaElegible
  dia: string
  saldoFinal: number
  alTerminar: () => void
}) {
  const [id] = useState(() => crypto.randomUUID())
  const [banco, setBanco] = useState('')
  const { alEnviar, enviando, error } = useEnvio(cerrarDia, alTerminar)
  const m = monedaDeCuenta(cuenta.moneda)
  // Se lee igual que en el servidor: «-508,61» es -508.61, no -50 861.
  const escrito = normalizarMonto(banco)
  const diferencia = SALDO.test(escrito) ? Math.round((Number(escrito) - saldoFinal) * 100) / 100 : null
  const conObservaciones = diferencia !== null && diferencia !== 0
  const p = `cierre-${id.slice(0, 8)}`

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="caja_id" value={cuenta.id} />
      <input type="hidden" name="fecha" value={dia} />
      <Campo
        etiqueta={cuenta.tipo === 'EFECTIVO' ? 'Saldo contado en la caja' : 'Saldo según el estado de cuenta'}
        htmlFor={`${p}-banco`}
        requerido
        ayuda={`En ${nombreMoneda(cuenta.moneda)}. Es la comprobación del día.`}
      >
        <Entrada
          id={`${p}-banco`}
          name="saldo_banco"
          inputMode="decimal"
          required
          autoComplete="off"
          className="tabular"
          value={banco}
          onChange={(e) => setBanco(e.target.value)}
        />
      </Campo>
      {diferencia !== null && (
        <p role="status" className={diferencia === 0 ? 'text-sm text-exito' : 'text-sm text-aviso'}>
          {diferencia === 0 ? 'Cuadra con la caja.' : `Diferencia de ${moneda(diferencia, m)}: cuenta en las observaciones por qué, en 10 caracteres como mínimo.`}
        </p>
      )}
      <Campo etiqueta="Observaciones" htmlFor={`${p}-obs`} requerido={conObservaciones}>
        <AreaTexto id={`${p}-obs`} name="observaciones" required={conObservaciones} minLength={conObservaciones ? 10 : undefined} maxLength={500} />
      </Campo>
      <Pie error={error} enviando={enviando} alCancelar={alTerminar} texto="Cerrar el día" />
    </form>
  )
}

export function ReabrirDia({ cierreId, cuenta, dia }: { cierreId: string; cuenta: string; dia: string }) {
  const v = useVentana()
  const { alEnviar, enviando, error } = useEnvio(reabrirDia, v.cerrar)
  return (
    <>
      <Boton type="button" tamano="sm" variante="contorno" onClick={v.abrir} aria-label={`Reabrir el día de ${cuenta}`} data-reabrir-dia={cuenta}>
        <LockOpen aria-hidden className="size-4" />
        Reabrir
      </Boton>
      <Ventana
        abierta={v.abierta}
        alCerrar={v.cerrar}
        titulo={`Reabrir el ${fecha(dia)} de ${cuenta}`}
        descripcion="El cierre no se borra: queda anulado con su motivo y el día vuelve a recibir movimientos. Lo normal es registrar lo que faltó en un día abierto."
        ancho="md"
      >
        <form key={v.vez} onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={cierreId} />
          <Campo etiqueta="Motivo" htmlFor={`reabrir-${cierreId}`} requerido>
            <AreaTexto id={`reabrir-${cierreId}`} name="motivo" required minLength={10} maxLength={500} />
          </Campo>
          <Pie error={error} enviando={enviando} alCancelar={v.cerrar} texto="Reabrir el día" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}

// ---------------------------------------------------------------- las cuentas

export type CuentaEditable = {
  id: string
  nombre: string
  tipo: string
  banco: string | null
  moneda: string
  saldo_inicial: number
  fecha_inicio: string
  activa: boolean
  con_movimientos: boolean
  /** La captura del saldo inicial en Storage, si ya la tiene. */
  apertura_ruta: string | null
}

/** Lo que respalda el saldo inicial: en un banco, la pantalla del aplicativo; en la caja chica, el conteo. */
const respaldoDe = (tipo: string) => (tipo === 'BANCO' ? 'la captura del saldo' : 'la foto del conteo')

export function EditarCuenta({ cuenta, hoy, primera = false }: { cuenta?: CuentaEditable; hoy: string; primera?: boolean }) {
  const v = useVentana()
  return (
    <>
      {cuenta ? (
        <Boton type="button" tamano="sm" variante="fantasma" onClick={v.abrir} aria-label={`Corregir ${cuenta.nombre}`} data-editar-cuenta={cuenta.nombre}>
          <Pencil aria-hidden className="size-4" />
          Corregir
        </Boton>
      ) : (
        <Boton type="button" tamano="sm" variante={primera ? 'primario' : 'contorno'} onClick={v.abrir} data-agregar-cuenta>
          <Plus aria-hidden className="size-4" />
          {primera ? 'Dar de alta la primera cuenta' : 'Agregar cuenta'}
        </Boton>
      )}
      <Ventana
        abierta={v.abierta}
        alCerrar={v.cerrar}
        titulo={cuenta ? `Corregir ${cuenta.nombre}` : 'Agregar una cuenta'}
        descripcion={
          cuenta?.con_movimientos
            ? `Ya tiene movimientos: ${cuenta.tipo === 'BANCO' ? 'se corrigen el nombre y el banco' : 'se corrige el nombre'}, o se desactiva. ${
                cuenta.apertura_ruta
                  ? `Su moneda, su saldo inicial y ${respaldoDe(cuenta.tipo)} no cambian.`
                  : `Su moneda y su saldo inicial no cambian; ${respaldoDe(cuenta.tipo)}, si falta, se adjunta aquí.`
              }`
            : 'Un banco en una moneda, o la caja chica en efectivo, con el saldo con el que empieza en el sistema y su respaldo: la captura del aplicativo o la foto del conteo.'
        }
        ancho="md"
      >
        <FormularioCuenta key={v.vez} cuenta={cuenta} hoy={hoy} alTerminar={v.cerrar} />
      </Ventana>
    </>
  )
}

function FormularioCuenta({ cuenta, hoy, alTerminar }: { cuenta?: CuentaEditable; hoy: string; alTerminar: () => void }) {
  const [id] = useState(() => cuenta?.id ?? crypto.randomUUID())
  // El nombre de la captura en Storage, decidido al abrir: un reintento sube al mismo sitio y no la duplica.
  const [capturaId] = useState(() => crypto.randomUUID())
  const [tipo, setTipo] = useState(cuenta?.tipo ?? 'BANCO')
  const fijo = cuenta?.con_movimientos ?? false
  const anterior = cuenta?.apertura_ruta ?? null
  // Un banco nuevo no entra sin su captura, ni la caja chica pasa a banco sin ella; la caja chica no tiene aplicativo.
  const pideCaptura = tipo === 'BANCO' && cuenta?.tipo !== 'BANCO'
  // Con movimientos, la captura que ya tiene queda como respaldo del saldo y no se cambia.
  const ofreceCaptura = !(fijo && anterior)

  /**
   * La captura sube primero a Storage y después la cuenta la anota (ver
   * `subirArchivoPrivado`): si la base no la acepta, la captura se retira. Si
   * reemplazó a otra, la de antes se quita después, porque ya ninguna cuenta la
   * nombra; si no se puede, se queda donde solo la ve quien la subió.
   */
  async function guardar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = datos.get('captura')
    datos.delete('captura')
    // Una captura elegida y vacía no se deja de lado callada.
    if (archivo instanceof File && archivo.name !== '' && archivo.size === 0) {
      return { ok: false, error: pideCaptura ? 'La captura está vacía: elige otra.' : 'La captura está vacía: elige otra o quítala.' }
    }
    if (!(archivo instanceof File) || archivo.size === 0) {
      if (pideCaptura) return { ok: false, error: 'Adjunta la captura del aplicativo del banco con el saldo de ese día.' }
      return guardarCuenta(null, datos)
    }
    const problema = problemaDeLaCaptura(archivo)
    const ruta = rutaDeCapturaDeSaldo(id, capturaId, archivo.type)
    if (problema || !ruta) return { ok: false, error: problema ?? 'La captura va en foto (JPG, PNG o WEBP) o en PDF.' }
    datos.set('apertura_ruta', ruta)
    const resultado = await subirArchivoPrivado({
      bucket: BUCKET_APERTURA_CAJA,
      ruta,
      archivo,
      contentType: archivo.type,
      registrar: () => guardarCuenta(null, datos),
    })
    if (resultado.ok && anterior && anterior !== ruta) {
      // A sabiendas sin aviso ni error: la cuenta ya quedó con la nueva. Si la vieja la
      // subió otra persona, la política no la deja quitar (`remove` devuelve su error,
      // no lo lanza) y se queda donde solo la ve ella; un corte de red tampoco deshace
      // lo guardado.
      await createClient().storage.from(BUCKET_APERTURA_CAJA).remove([anterior]).catch(() => null)
    }
    return resultado
  }
  const { alEnviar, enviando, error } = useEnvio(guardar, alTerminar)
  const p = `cuenta-${id.slice(0, 8)}`

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      {/* Un campo desactivado no viaja: lo que ya no cambia va oculto con su valor. */}
      {fijo && cuenta && (
        <>
          <input type="hidden" name="tipo" value={cuenta.tipo} />
          <input type="hidden" name="moneda" value={cuenta.moneda} />
          <input type="hidden" name="saldo_inicial" value={String(cuenta.saldo_inicial)} />
          <input type="hidden" name="fecha_inicio" value={cuenta.fecha_inicio} />
        </>
      )}
      <Campo etiqueta="Nombre" htmlFor={`${p}-nombre`} requerido ayuda="Como la llaman en Tesorería: «BCP soles», «Caja chica».">
        <Entrada id={`${p}-nombre`} name="nombre" required minLength={2} maxLength={60} defaultValue={cuenta?.nombre} autoComplete="off" />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Es" htmlFor={`${p}-tipo`} requerido>
          <Seleccion id={`${p}-tipo`} name={fijo ? undefined : 'tipo'} value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={fijo}>
            <option value="BANCO">Una cuenta de banco</option>
            <option value="EFECTIVO">Efectivo (caja chica)</option>
          </Seleccion>
        </Campo>
        {tipo === 'BANCO' ? (
          <Campo etiqueta="Banco" htmlFor={`${p}-banco`} requerido>
            <Entrada id={`${p}-banco`} name="banco" required minLength={2} maxLength={40} defaultValue={cuenta?.banco ?? ''} list={`${p}-bancos`} autoComplete="off" />
            <datalist id={`${p}-bancos`}>
              {['BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Banco de la Nación'].map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Campo>
        ) : (
          <div />
        )}
        <Campo etiqueta="Moneda" htmlFor={`${p}-moneda`} requerido>
          <Seleccion id={`${p}-moneda`} name={fijo ? undefined : 'moneda'} defaultValue={cuenta?.moneda ?? 'PEN'} disabled={fijo}>
            <option value="PEN">Soles</option>
            <option value="USD">Dólares</option>
          </Seleccion>
        </Campo>
        {cuenta && (
          <Campo etiqueta="Estado" htmlFor={`${p}-activa`} ayuda="Para desactivarla, antes pasa su saldo a otra cuenta.">
            <Seleccion id={`${p}-activa`} name="activa" defaultValue={cuenta.activa ? 'si' : 'no'}>
              <option value="si">Activa</option>
              <option value="no">Desactivada: ya no recibe movimientos</option>
            </Seleccion>
          </Campo>
        )}
        <Campo etiqueta="Saldo inicial" htmlFor={`${p}-saldo`} requerido ayuda="El saldo al empezar ese día, antes de sus movimientos.">
          <Entrada
            id={`${p}-saldo`}
            name={fijo ? undefined : 'saldo_inicial'}
            inputMode="decimal"
            required
            disabled={fijo}
            defaultValue={cuenta ? String(cuenta.saldo_inicial) : ''}
            autoComplete="off"
            className="tabular"
          />
        </Campo>
        <Campo etiqueta="Día de ese saldo" htmlFor={`${p}-fecha`} requerido>
          <Entrada
            id={`${p}-fecha`}
            name={fijo ? undefined : 'fecha_inicio'}
            type="date"
            required
            disabled={fijo}
            max={hoy}
            defaultValue={cuenta?.fecha_inicio ?? hoy}
          />
        </Campo>
      </div>
      {cuenta && anterior && (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-texto-suave">
          <ImageIcon aria-hidden className="size-4" />
          {cuenta.tipo === 'BANCO' ? 'Captura del saldo inicial:' : 'Foto del conteo:'}
          <a
            href={enlaceCaptura(cuenta.id)}
            target="_blank"
            rel="noopener"
            aria-label={`verla: ${respaldoDe(cuenta.tipo)} de ${cuenta.nombre}`}
            className="inline-flex min-h-11 min-w-11 items-center font-medium text-acento underline underline-offset-2 sm:min-h-0 sm:min-w-0"
          >
            verla
          </a>
          {fijo && <span>· queda como respaldo del saldo</span>}
        </p>
      )}
      {ofreceCaptura && (
        <Campo
          etiqueta={
            anterior && !pideCaptura
              ? `Cambiar ${respaldoDe(tipo)}`
              : tipo === 'BANCO'
                ? 'Captura del saldo en el aplicativo'
                : 'Foto del conteo'
          }
          htmlFor={`${p}-captura`}
          requerido={pideCaptura}
          ayudaEnIcono={false}
          ayuda={
            tipo === 'BANCO'
              ? `${pideCaptura && anterior ? 'La foto del conteo no sirve para un banco: adjunta la' : 'La'} pantalla del aplicativo con el saldo de ese día.`
              : 'Si la tienes: el conteo de la caja chica ese día.'
          }
        >
          <ElegirArchivo id={`${p}-captura`} name="captura" accept={ACEPTA_CAPTURA_SALDO} hastaMb={MAXIMO_MB_CAPTURA_SALDO} required={pideCaptura} />
        </Campo>
      )}
      <Pie error={error} enviando={enviando} alCancelar={alTerminar} texto={cuenta ? 'Guardar' : 'Agregar la cuenta'} />
    </form>
  )
}
