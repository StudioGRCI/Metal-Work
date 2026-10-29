'use client'

import { CheckCircle2, ClipboardList, FileSpreadsheet } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { ElegirArchivo, revisarArchivo } from '@/components/ui/elegir-archivo'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Ventana } from '@/components/ui/ventana'
import { DIAS_DEL_CONTEO, motivoDeFechaDeConteo, TANDA_CONTEO } from '@/lib/dominio/conteo-inicial'
import { laPestanaEsDeOtraCuenta, refrescarSiEsDeLaPestana } from '@/lib/envio'
import { cantidad, hoyLima, sumarDias } from '@/lib/format'

import { leerConteoInicial, registrarConteoInicial, type FilaConteo } from './acciones'

type Resultado = { estado: 'ok' } | { estado: 'error'; mensaje: string }

const NO_SALIO_OTRA_CUENTA = 'No se envió: en otra pestaña entró otra cuenta. Cuando vuelva la tuya, vuelve a registrarlo; lo registrado no se duplica.'
const ACEPTA_EXCEL = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
/** El tope con que el servidor abre el libro (`abrirLibro`). */
const MAXIMO_MB_EXCEL = 8

/**
 * El conteo inicial: el inventario físico con el que el almacén arranca. Se
 * descarga el formato con todo el catálogo, se cuenta, se carga, se revisa qué
 * entra como saldo inicial y qué como ajuste, y se registra por tandas.
 * Cargar el mismo archivo otra vez no duplica nada.
 */
export function ConteoInicial() {
  const router = useRouter()
  const [abierta, setAbierta] = useState(false)
  const [fecha, setFecha] = useState(() => hoyLima())
  const [archivo, setArchivo] = useState<File | null>(null)
  // Por qué el formato elegido no se pudo leer, sea del navegador o del servidor: va en su campo.
  const [avisoArchivo, setAvisoArchivo] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [filas, setFilas] = useState<FilaConteo[] | null>(null)
  const [resultados, setResultados] = useState<Record<string, Resultado>>({})
  const [registrando, setRegistrando] = useState(false)
  // Cuántas veces se apretó «Registrar»: el resumen de cada vuelta es otro y recibe el cursor.
  const [intentos, setIntentos] = useState(0)
  const [fechaLeida, setFechaLeida] = useState('')
  // Lo que la fecha tiene mal se dice en la fecha, antes de leer el Excel; si
  // el servidor la rechaza igual (pasó la medianoche), también va ahí.
  const [avisoFechaServidor, setAvisoFechaServidor] = useState<string | null>(null)
  const hoy = hoyLima()
  const desde = sumarDias(hoy, -DIAS_DEL_CONTEO)
  const avisoFecha = motivoDeFechaDeConteo(fecha, hoy, desde) ?? avisoFechaServidor
  // El rechazo apaga el campo del Excel, que tenía el foco: va a la fecha, que es lo que hay que cambiar.
  const campoFecha = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (avisoFechaServidor) campoFecha.current?.focus()
  }, [avisoFechaServidor])
  const enCurso = useRef(false)
  // Sube con cada reinicio: lo que llega de una lectura de antes de cerrar ya
  // no es de esta ventana, y al abrirla de nuevo no aparece.
  const vuelta = useRef(0)

  const listas = (filas ?? []).filter((f) => f.estado === 'LISTA')
  const pendientes = listas.filter((f) => resultados[f.id]?.estado !== 'ok')
  const hechas = Object.values(resultados).filter((r) => r.estado === 'ok').length
  const fallidas = Object.values(resultados).filter((r) => r.estado === 'error').length
  // Las que no salieron porque entró otra cuenta: si son todas, se dice con qué se envían.
  const porLaOtraCuenta = Object.values(resultados).filter((r) => r.estado === 'error' && r.mensaje === NO_SALIO_OTRA_CUENTA).length
  const terminado = !registrando && Object.keys(resultados).length > 0
  const botonRegistrar = pendientes.length === 1 ? 'Registrar 1 material' : `Registrar ${pendientes.length} materiales`

  function reiniciar() {
    vuelta.current++
    setArchivo(null)
    setAvisoArchivo(null)
    setAvisoFechaServidor(null)
    setFilas(null)
    setResultados({})
  }

  function cerrar() {
    if (registrando) return
    setAbierta(false)
    if (Object.keys(resultados).length > 0) refrescarSiEsDeLaPestana(router)
    reiniciar()
  }

  async function leer(elegido: File | undefined) {
    if (!elegido || enCurso.current) return
    enCurso.current = true
    let esta = vuelta.current
    try {
      // El que no es un .xlsx de verdad no va al servidor: su campo dice por qué.
      const noSirve = /\.xls$/i.test(elegido.name)
        ? 'Es un .xls: guárdalo como «Libro de Excel» (.xlsx) y elígelo otra vez'
        : await revisarArchivo(elegido, ACEPTA_EXCEL, MAXIMO_MB_EXCEL)
      // reiniciar() vacía también el campo: el elegido se pone después, y gana.
      reiniciar()
      esta = vuelta.current
      setArchivo(elegido)
      setAvisoArchivo(noSirve)
      if (noSirve) return
      setLeyendo(true)
      const datos = new FormData()
      datos.set('archivo', elegido)
      datos.set('fecha', fecha)
      const r = await leerConteoInicial(null, datos)
      if (esta !== vuelta.current) return
      if (!r.ok && /fecha del conteo|conteo es de hace|fecha en que se hizo/i.test(r.error)) {
        setArchivo(null)
        setAvisoFechaServidor(r.error)
      } else if (!r.ok) setAvisoArchivo(r.error)
      else {
        setFilas(r.datos?.filas ?? [])
        setFechaLeida(fecha)
      }
    } catch {
      if (esta === vuelta.current) setAvisoArchivo('No se pudo leer el conteo: revisa la conexión y elígelo otra vez')
    } finally {
      setLeyendo(false)
      enCurso.current = false
    }
  }

  async function registrar() {
    if (enCurso.current || pendientes.length === 0) return
    // La sesión pudo cambiar en otra pestaña sin que la traba llegara: se mira en el acto.
    if (laPestanaEsDeOtraCuenta()) return
    enCurso.current = true
    setRegistrando(true)
    try {
      for (let i = 0; i < pendientes.length; i += TANDA_CONTEO) {
        // Tanda por tanda, cada una sale con la sesión de ese momento. Si entró
        // otra cuenta, lo que falta se queda con su motivo y sale cuando vuelva
        // la tuya (vigesimotercera pasada).
        if (laPestanaEsDeOtraCuenta()) {
          const quedan: Record<string, Resultado> = Object.fromEntries(pendientes.slice(i).map((f) => [f.id, { estado: 'error', mensaje: NO_SALIO_OTRA_CUENTA }]))
          setResultados((previos) => ({ ...previos, ...quedan }))
          break
        }
        const tanda = pendientes.slice(i, i + TANDA_CONTEO)
        const datos = new FormData()
        datos.set('fecha', fechaLeida)
        datos.set('filas', JSON.stringify(tanda.map((f) => ({
          id: f.id, material_id: f.materialId, contado: f.contado, precio: f.precio, moneda: f.moneda, via: f.via,
        }))))
        let nuevos: Record<string, Resultado>
        try {
          const r = await registrarConteoInicial(null, datos)
          nuevos = r.ok
            ? Object.fromEntries((r.datos?.resultados ?? []).map((x) => [x.id, x.error ? { estado: 'error', mensaje: x.error } : { estado: 'ok' }]))
            : Object.fromEntries(tanda.map((f) => [f.id, { estado: 'error', mensaje: r.error }]))
        } catch {
          nuevos = Object.fromEntries(tanda.map((f) => [f.id, { estado: 'error', mensaje: 'No se confirmó: vuelve a cargar el archivo; lo registrado no se duplica.' }]))
        }
        setResultados((previos) => ({ ...previos, ...nuevos }))
      }
    } finally {
      setRegistrando(false)
      setIntentos((n) => n + 1)
      enCurso.current = false
    }
  }

  const resumen = filas ? {
    iniciales: listas.filter((f) => f.via === 'SALDO_INICIAL').length,
    ajustes: listas.filter((f) => f.via === 'AJUSTE').length,
    cargadas: filas.filter((f) => f.estado === 'CARGADA').length,
    sinCambio: filas.filter((f) => f.estado === 'SIN_CAMBIO').length,
    errores: filas.filter((f) => f.estado === 'ERROR').length,
  } : null

  return (
    <>
      <Boton variante="secundario" onClick={() => setAbierta(true)}>
        <ClipboardList aria-hidden className="size-4" />Conteo inicial
      </Boton>
      <Ventana abierta={abierta} alCerrar={cerrar} titulo="Conteo inicial del almacén" ancho="xl"
        descripcion="El inventario físico con el que el almacén arranca en el sistema. Un material sin saldo entra como saldo inicial; uno que ya tiene saldo, como ajuste por la diferencia.">
        <div className="space-y-4">
          {!filas && (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-texto-suave">
                <li>Descarga el formato: trae todo el catálogo con el saldo de hoy.</li>
                <li>Cuenta el anaquel y anota la cantidad de cada material. Lo que no contaste, déjalo en blanco.</li>
                <li>Indica la fecha del conteo y carga el archivo. Antes de registrar ves qué entra y cómo.</li>
              </ol>
              <a href="/almacen/kardex/conteo-inicial" download
                className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-base)] border border-borde-fuerte px-3 text-sm font-medium text-texto hover:bg-superficie-2 sm:min-h-9">
                <FileSpreadsheet aria-hidden className="size-4" />Descargar formato de conteo
              </a>
              <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
                <Campo etiqueta="Fecha del conteo" htmlFor="conteo-inicial-fecha" requerido error={avisoFecha ?? undefined}>
                  <Entrada ref={campoFecha} id="conteo-inicial-fecha" type="date" value={fecha} min={desde} max={hoy} disabled={leyendo}
                    onChange={(e) => {
                      setFecha(e.target.value)
                      setAvisoFechaServidor(null)
                      // El que se rechazó con la otra fecha se elige de nuevo con esta.
                      setArchivo(null)
                      setAvisoArchivo(null)
                    }} />
                </Campo>
                <Campo etiqueta="Formato de conteo, ya lleno" htmlFor="conteo-inicial-archivo">
                  <ElegirArchivo id="conteo-inicial-archivo" accept={ACEPTA_EXCEL} hastaMb={MAXIMO_MB_EXCEL}
                    archivo={archivo} aviso={avisoArchivo} estado={leyendo ? 'Leyendo el conteo…' : null}
                    disabled={leyendo || Boolean(avisoFecha)} onChange={(e) => void leer(e.target.files?.[0])} />
                </Campo>
              </div>
            </>
          )}

          {filas && resumen && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {resumen.iniciales > 0 && <Insignia tono="exito">{resumen.iniciales} como saldo inicial</Insignia>}
                {resumen.ajustes > 0 && <Insignia tono="info">{resumen.ajustes} como ajuste</Insignia>}
                {resumen.cargadas > 0 && <Insignia tono="neutro">{resumen.cargadas} ya estaban en el kardex</Insignia>}
                {resumen.sinCambio > 0 && <Insignia tono="neutro">{resumen.sinCambio} en cero, sin nada que registrar</Insignia>}
                {resumen.errores > 0 && <Insignia tono="peligro">{resumen.errores} con errores</Insignia>}
                {!registrando && !terminado && (
                  <Boton type="button" variante="fantasma" tamano="sm" onClick={reiniciar} className="ml-auto">Elegir otro archivo</Boton>
                )}
              </div>

              <ul className="max-h-[55vh] divide-y divide-borde overflow-y-auto rounded-[var(--radius-base)] border border-borde">
                {filas.map((f) => {
                  const r = resultados[f.id]
                  const diferencia = f.contado === null ? null : f.contado - f.saldo
                  return (
                    <li key={f.fila} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="min-w-0">
                        <p className="text-xs text-texto-suave">Fila {f.fila} · <span className="font-mono">{f.codigo || 'sin código'}</span></p>
                        <p className="mt-1 text-sm font-medium text-texto">{f.descripcion ?? f.codigo}</p>
                        {f.contado !== null && (
                          <p className="text-xs text-texto-suave">
                            Contado {cantidad(f.contado)} {f.unidadMedida ?? ''} · en el sistema {cantidad(f.saldo)}
                            {f.via === 'AJUSTE' && diferencia !== null && diferencia !== 0 && ` · ajuste de ${diferencia > 0 ? '+' : ''}${cantidad(diferencia)}`}
                            {f.via === 'SALDO_INICIAL' && f.precio !== null && ` · ${f.moneda === 'USD' ? 'US$' : 'S/'} ${f.precio} c/u`}
                          </p>
                        )}
                        {f.aviso && <p className="mt-1 text-xs text-aviso">{f.aviso}</p>}
                        {f.errores.length > 0 && (
                          <ul className="mt-1 list-disc pl-4 text-xs text-peligro">{f.errores.map((e) => <li key={e}>{e}</li>)}</ul>
                        )}
                        {r?.estado === 'error' && <p role="alert" className="mt-1 text-xs text-peligro">{r.mensaje}</p>}
                      </div>
                      <div className="flex items-center gap-2 sm:justify-end">
                        {f.estado === 'LISTA' && !r && <Insignia tono={f.via === 'SALDO_INICIAL' ? 'exito' : 'info'}>{f.via === 'SALDO_INICIAL' ? 'Saldo inicial' : 'Ajuste'}</Insignia>}
                        {f.estado === 'CARGADA' && <Insignia tono="neutro">Ya cargada</Insignia>}
                        {f.estado === 'SIN_CAMBIO' && <Insignia tono="neutro">Nada que registrar</Insignia>}
                        {f.estado === 'ERROR' && <Insignia tono="peligro">No se registra</Insignia>}
                        {r?.estado === 'ok' && <Insignia tono="exito"><CheckCircle2 aria-hidden className="size-3" />Registrada</Insignia>}
                      </div>
                    </li>
                  )
                })}
              </ul>

              {registrando && (
                <p role="status" className="text-sm text-texto-suave">Registrando… {hechas + fallidas} de {listas.length}</p>
              )}
              {/* Se lleva el cursor en cada vuelta, como en la planilla: el botón que se
                  tocó se apagó mientras registraba, y el cursor caía a la página con
                  la fila que falló al fondo de la lista (vigesimosexta pasada). */}
              {terminado && (
                <AvisoEnfocado key={intentos} aviso={fallidas > 0}>
                  {hechas === 0 ? 'No se registró ningún material' : hechas === 1 ? 'Se registró 1 material' : `Se registraron ${hechas} materiales`}
                  {!fallidas
                    ? '.'
                    : fallidas === porLaOtraCuenta
                      ? `; ${fallidas === 1 ? '1 no salió' : `${fallidas} no salieron`} porque entró otra cuenta: «${botonRegistrar}» ${fallidas === 1 ? 'lo envía' : 'los envía'}.`
                      : `; ${fallidas} no: revisa el mensaje de cada uno.`}
                </AvisoEnfocado>
              )}
              <div className="flex flex-wrap gap-2">
                {pendientes.length > 0 && !registrando && <Boton onClick={registrar}>{botonRegistrar}</Boton>}
                {registrando && <Boton cargando disabled>Registrando</Boton>}
                {terminado && <Boton variante={pendientes.length > 0 ? 'contorno' : 'primario'} onClick={cerrar}>Cerrar</Boton>}
              </div>
            </>
          )}
        </div>
      </Ventana>
    </>
  )
}
