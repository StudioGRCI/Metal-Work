'use client'

import { CheckCircle2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { Boton } from '@/components/ui/boton'
import { Campo, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo, avisoDeArchivo, revisarArchivo } from '@/components/ui/elegir-archivo'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { normalizarNombre } from '@/lib/dominio/planilla-almacen'
import { laPestanaEsDeOtraCuenta, OtraCuentaEnLaPestana, refrescarSiEsDeLaPestana } from '@/lib/envio'
import { cantidad } from '@/lib/format'
import { NO_SE_CARGO_EL_ARCHIVO, subirArchivoPrivado } from '@/lib/subida-privada'
import { createClient } from '@/lib/supabase/client'

import { leerPlanillaAlmacen, registrarFilaPlanilla, type FilaPlanilla } from './acciones'

const ACEPTA_EXCEL = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
/** El tope con que el servidor abre el libro (`abrirLibro`). */
const MAXIMO_MB_EXCEL = 8
const ACEPTA_FOTO = 'image/jpeg,image/png,image/webp'
const MAXIMO_MB_FOTO = 10
type Resultado = { estado: 'enviando' } | { estado: 'ok' } | { estado: 'error'; mensaje: string }

const NO_SALIO_OTRA_CUENTA = 'No se envió: en otra pestaña entró otra cuenta. Cuando vuelva la tuya, usa «Registrar lo que falta».'
/** Lo que eligió Almacén para una fila sin material: uno del catálogo o darlo de alta. */
const NUEVO = 'NUEVO'

/**
 * Cargar la planilla llenada sin internet. Primero se lee y se muestra qué se
 * va a registrar y qué no; cada salida pide su foto; un ingreso escrito solo
 * con la descripción que no está con ese nombre pide elegir el material o
 * darlo de alta; después se registra fila por fila, con la fecha en que pasó,
 * y se ve el resultado de cada una. Volver a cargar la misma planilla no
 * duplica nada.
 *
 * La abre «Sin internet» (`sin-internet.tsx`), el desplegable de la esquina
 * del kardex: por eso la ventana no trae su propio botón.
 */
export function CargarPlanilla({ abierta, alCerrar }: { abierta: boolean; alCerrar: () => void }) {
  const router = useRouter()
  const [archivo, setArchivo] = useState<File | null>(null)
  // Por qué la planilla elegida no se pudo leer, sea del navegador o del servidor: va en su campo.
  const [avisoArchivo, setAvisoArchivo] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [filas, setFilas] = useState<FilaPlanilla[] | null>(null)
  // La foto elegida en cada salida, sirva o no: su campo la muestra con el motivo.
  const [elegidas, setElegidas] = useState<Record<string, File>>({})
  const [elecciones, setElecciones] = useState<Record<string, string>>({})
  const [resultados, setResultados] = useState<Record<string, Resultado>>({})
  const [registrando, setRegistrando] = useState(false)
  // Cuántas veces se apretó «Registrar»: después de la primera, lo que queda es «lo que falta».
  const [intentos, setIntentos] = useState(0)
  const enCurso = useRef(false)
  // Sube con cada reinicio: lo que llega de una lectura de antes de cerrar ya
  // no es de esta ventana, y al abrirla de nuevo no aparece.
  const vuelta = useRef(0)

  // Las que se registran: de las elegidas, solo las que sirven.
  const fotos = Object.fromEntries(Object.entries(elegidas).filter(([, foto]) => !avisoDeArchivo(foto, ACEPTA_FOTO, MAXIMO_MB_FOTO)))
  const listas = (filas ?? []).filter((f) => f.estado === 'LISTA' || (f.estado === 'ELEGIR' && elecciones[f.id]))
  const porRegistrar = listas.filter((f) => f.hoja === 'Ingresos' || fotos[f.id])
  const sinFoto = listas.filter((f) => f.hoja === 'Salidas' && !fotos[f.id])
  const sinElegir = (filas ?? []).filter((f) => f.estado === 'ELEGIR' && !elecciones[f.id])
  // Lo que falta: lo que se puede registrar y todavía no entró. Tras una vuelta
  // con fallas —la foto que no subió—, se vuelve a registrar solo eso.
  const faltan = porRegistrar.filter((f) => resultados[f.id]?.estado !== 'ok')
  const hechas = Object.values(resultados).filter((r) => r.estado === 'ok').length
  const fallidas = Object.values(resultados).filter((r) => r.estado === 'error').length
  const empezado = intentos > 0
  // Terminado es que no quede nada por registrar, no que algo ya haya entrado:
  // si no, la salida cuya foto no subió se quedaba sin botón para volver a intentarlo.
  const terminado = !registrando && empezado && faltan.length === 0
  // Lo que queda sin entrar, para no cerrar en verde con una salida sin foto encima.
  const queda = fallidas
    ? `${fallidas} no: revisa el mensaje de cada uno`
    : faltan.length
      ? faltan.length === 1 ? 'falta 1' : `faltan ${faltan.length}`
      : [
          sinFoto.length && (sinFoto.length === 1 ? 'falta la foto de 1 salida' : `falta la foto de ${sinFoto.length} salidas`),
          sinElegir.length && (sinElegir.length === 1 ? 'falta elegir el material de 1 ingreso' : `falta elegir el material de ${sinElegir.length} ingresos`),
        ].filter(Boolean).join(' y ')

  function reiniciar() {
    vuelta.current++
    setArchivo(null)
    setAvisoArchivo(null)
    setFilas(null)
    setElegidas({})
    setElecciones({})
    setResultados({})
    setIntentos(0)
  }

  function cerrar() {
    if (registrando) return
    alCerrar()
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
      const r = await leerPlanillaAlmacen(null, datos)
      if (esta !== vuelta.current) return
      if (!r.ok) setAvisoArchivo(r.error)
      else setFilas(r.datos?.filas ?? [])
    } catch {
      if (esta === vuelta.current) setAvisoArchivo('No se pudo leer la planilla: revisa la conexión y elígela otra vez')
    } finally {
      setLeyendo(false)
      enCurso.current = false
    }
  }

  // Se guarda la elegida aunque no sirva: su campo la sigue mostrando, y volver
  // a elegir la misma avisa otra vez. Para registrar cuenta solo la que sirve.
  function elegirFoto(fila: FilaPlanilla, foto: File | undefined) {
    if (!foto) return
    setElegidas((previas) => ({ ...previas, [fila.id]: foto }))
    setResultados((r) => { const n = { ...r }; delete n[fila.id]; return n })
  }

  async function registrar() {
    if (enCurso.current || faltan.length === 0) return
    // La sesión pudo cambiar en otra pestaña sin que la traba llegara: se mira en el acto.
    if (laPestanaEsDeOtraCuenta()) return
    enCurso.current = true
    setRegistrando(true)
    try {
      const db = createClient()
      const { data: sesion } = await db.auth.getUser()
      const usuario = sesion.user?.id
      // Primero todos los ingresos y después las salidas: así el saldo alcanza
      // aunque la salida esté anotada antes que el ingreso del mismo día.
      const orden = [...faltan.filter((f) => f.hoja === 'Ingresos'), ...faltan.filter((f) => f.hoja === 'Salidas')]
      // Fila por fila, cada una sale con la sesión de ese momento. Si entró otra
      // cuenta, la que iba y las que siguen se quedan con su motivo, y salen
      // cuando vuelva la tuya (vigesimotercera pasada).
      const cortar = (desde: number) => {
        const quedan: Record<string, Resultado> = Object.fromEntries(orden.slice(desde).map((q) => [q.id, { estado: 'error', mensaje: NO_SALIO_OTRA_CUENTA }]))
        setResultados((r) => ({ ...r, ...quedan }))
      }
      for (const [i, f] of orden.entries()) {
        if (laPestanaEsDeOtraCuenta()) {
          cortar(i)
          break
        }
        setResultados((r) => ({ ...r, [f.id]: { estado: 'enviando' } }))
        const datos = new FormData()
        datos.set('hoja', f.hoja)
        datos.set('id', f.id)
        datos.set('material_id', f.materialId ?? '')
        datos.set('cantidad', String(f.cantidad ?? ''))
        datos.set('fecha', f.fecha ?? '')
        let resultado: ResultadoAccion
        try {
          if (f.hoja === 'Ingresos') {
            // Sin material del catálogo: el elegido por Almacén, o darlo de alta con su descripción.
            const eleccion = elecciones[f.id]
            const elegido = eleccion && eleccion !== NUEVO ? f.sugerencias.find((s) => s.id === eleccion) : undefined
            const nuevo = !f.materialId && !elegido && f.nuevo
            datos.set('material_id', f.materialId ?? elegido?.id ?? '')
            datos.set('material_nuevo', nuevo ? nuevo.id : '')
            datos.set('descripcion', f.descripcionEscrita)
            datos.set('unidad_id', nuevo ? nuevo.unidadId : f.unidadId ?? '')
            datos.set('origen', elegido?.origen ?? f.origen)
            datos.set('documento', f.documento)
            datos.set('precio', f.precio === null ? '' : String(f.precio))
            datos.set('moneda', f.moneda)
            resultado = await registrarFilaPlanilla(null, datos)
          } else if (!usuario) {
            resultado = { ok: false, error: 'Tu sesión terminó. Ingresa de nuevo.' }
          } else {
            const foto = fotos[f.id]
            const extension = foto.type === 'image/jpeg' ? 'jpg' : foto.type === 'image/png' ? 'png' : 'webp'
            const ruta = `${usuario}/${f.id}.${extension}`
            datos.set('unidad', f.unidad)
            datos.set('motivo', f.documento)
            datos.set('recibe', f.recibe)
            datos.set('foto_ruta', ruta)
            resultado = await subirArchivoPrivado({
              bucket: 'evidencias-almacen', ruta, archivo: foto, contentType: foto.type,
              registrar: () => registrarFilaPlanilla(null, datos),
            })
          }
        } catch (e) {
          if (e instanceof OtraCuentaEnLaPestana) {
            cortar(i)
            break
          }
          resultado = { ok: false, error: 'No se confirmó: vuelve a intentar con «Registrar lo que falta»; lo registrado no se duplica.' }
        }
        setResultados((r) => ({ ...r, [f.id]: resultado.ok ? { estado: 'ok' } : { estado: 'error', mensaje: resultado.error } }))
      }
    } finally {
      setRegistrando(false)
      setIntentos((n) => n + 1)
      enCurso.current = false
    }
  }

  const resumen = filas ? {
    listas: listas.length,
    cargadas: filas.filter((f) => f.estado === 'CARGADA').length,
    errores: filas.filter((f) => f.estado === 'ERROR').length,
    elegir: filas.filter((f) => f.estado === 'ELEGIR').length,
  } : null

  return (
    <Ventana abierta={abierta} alCerrar={cerrar} titulo="Cargar planilla sin internet" ancho="xl"
      descripcion="Lo anotado en la planilla de Excel entra al kardex con la fecha en que pasó. En Ingresos basta la descripción y la cantidad. Primero revisas qué se va a registrar; cada salida pide su foto.">
      <div className="space-y-4">
        {!filas && (
          <Campo etiqueta="Planilla de Excel" htmlFor="planilla-archivo" ayuda="La que descargaste con «Descargar planilla», ya llena.">
            <ElegirArchivo id="planilla-archivo" accept={ACEPTA_EXCEL} hastaMb={MAXIMO_MB_EXCEL}
              archivo={archivo} aviso={avisoArchivo} estado={leyendo ? 'Leyendo la planilla…' : null}
              disabled={leyendo} onChange={(e) => void leer(e.target.files?.[0])} />
          </Campo>
        )}

        {filas && resumen && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Insignia tono="exito">{resumen.listas} para registrar</Insignia>
              {resumen.cargadas > 0 && <Insignia tono="neutro">{resumen.cargadas} ya estaban en el kardex</Insignia>}
              {resumen.elegir > 0 && <Insignia tono="aviso">{resumen.elegir} por elegir el material</Insignia>}
              {resumen.errores > 0 && <Insignia tono="peligro">{resumen.errores} no se cargan</Insignia>}
              {!registrando && !empezado && (
                <Boton type="button" variante="fantasma" tamano="sm" onClick={reiniciar} className="ml-auto">Elegir otra planilla</Boton>
              )}
            </div>

            <ul className="max-h-[55vh] divide-y divide-borde overflow-y-auto rounded-[var(--radius-base)] border border-borde">
              {filas.map((f) => {
                const r = resultados[f.id]
                // Si lo que no entró fue la foto, se dice en su campo y no debajo de la fila.
                const avisoFoto = r?.estado === 'error' && r.mensaje.startsWith(NO_SE_CARGO_EL_ARCHIVO) ? r.mensaje : null
                return (
                  <li key={`${f.hoja}-${f.fila}`} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-xs text-texto-suave">
                        <Insignia tono={f.hoja === 'Ingresos' ? 'exito' : 'aviso'}>{f.hoja === 'Ingresos' ? 'Ingreso' : 'Salida'}</Insignia>
                        <span>Fila {f.fila} · {f.fechaTexto}</span>
                      </p>
                      <p className="mt-1 text-sm font-medium text-texto">
                        {f.cantidad === null ? 'Sin cantidad' : `${cantidad(f.cantidad)} ${f.unidadMedida ?? ''}`} · {f.descripcion ?? (f.descripcionEscrita || f.codigo)}
                        {f.materialId && <span className="ml-1 font-mono text-xs font-normal text-texto-tenue">{f.codigo}</span>}
                      </p>
                      {f.descripcionEscrita && f.descripcion && normalizarNombre(f.descripcion) !== normalizarNombre(f.descripcionEscrita) && (
                        <p className="text-xs text-texto-suave">Escrito en la planilla: {f.descripcionEscrita}</p>
                      )}
                      {f.estado === 'LISTA' && f.hoja === 'Ingresos' && !f.materialId && f.nuevo && (
                        <p className="text-xs text-aviso">No está en el catálogo con ese nombre: se da de alta en «Por clasificar», en {f.nuevo.unidad}.</p>
                      )}
                      <p className="text-xs text-texto-suave">
                        {f.hoja === 'Ingresos'
                          ? `${f.origen === 'SALDO_INICIAL' ? 'Saldo inicial' : 'Ingreso general'} · ${f.documento}`
                          : `${f.documento} · ${f.unidadRegistrada ? `a ${f.unidadRegistrada}` : `a ${f.unidad} (código nuevo)`} · recibe ${f.recibe}`}
                      </p>
                      {f.avisos.length > 0 && f.estado !== 'CARGADA' && (
                        <ul className="mt-1 list-disc pl-4 text-xs text-texto-suave">{f.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
                      )}
                      {f.errores.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-xs text-peligro">{f.errores.map((e) => <li key={e}>{e}</li>)}</ul>
                      )}
                      {f.estado === 'ELEGIR' && r?.estado !== 'ok' && (
                        <div className="mt-2 max-w-xl">
                          <label htmlFor={`elegir-${f.id}`} className="text-xs font-medium text-texto">
                            No está en el catálogo con ese nombre. ¿Es alguno de estos?
                          </label>
                          <Seleccion id={`elegir-${f.id}`} value={elecciones[f.id] ?? ''} disabled={registrando}
                            onChange={(e) => setElecciones((previas) => ({ ...previas, [f.id]: e.target.value }))}>
                            <option value="">Elige el material…</option>
                            {f.sugerencias.map((s) => (
                              <option key={s.id} value={s.id}>{s.descripcion} · {s.codigo}{s.unidad ? ` (${s.unidad})` : ''}</option>
                            ))}
                            {f.nuevo && <option value={NUEVO}>Ninguno: darlo de alta en «Por clasificar» ({f.nuevo.unidad})</option>}
                          </Seleccion>
                        </div>
                      )}
                      {r?.estado === 'error' && !avisoFoto && <p role="alert" className="mt-1 text-xs text-peligro">{r.mensaje}</p>}
                    </div>
                    <div className="flex items-center gap-2 sm:justify-end">
                      {f.estado === 'CARGADA' && <Insignia tono="neutro">Ya cargada</Insignia>}
                      {f.estado === 'ERROR' && <Insignia tono="peligro">No se registra</Insignia>}
                      {r?.estado === 'enviando' && <Insignia tono="info">Registrando…</Insignia>}
                      {r?.estado === 'ok' && <Insignia tono="exito"><CheckCircle2 aria-hidden className="size-3" />Registrada</Insignia>}
                      {f.estado === 'LISTA' && f.hoja === 'Salidas' && r?.estado !== 'ok' && (
                        <ElegirArchivo accept={ACEPTA_FOTO} texto="Elegir la foto de la salida" hastaMb={MAXIMO_MB_FOTO}
                          archivo={elegidas[f.id] ?? null} aviso={avisoFoto} disabled={registrando} className="w-full sm:w-64"
                          aria-label={`Elegir la foto de la salida de la fila ${f.fila}`}
                          onChange={(e) => elegirFoto(f, e.target.files?.[0])} />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>

            {sinElegir.length > 0 && (
              <p className="text-sm text-aviso">{sinElegir.length === 1 ? 'Un ingreso espera' : `${sinElegir.length} ingresos esperan`} que elijas el material; {sinElegir.length === 1 ? 'no se registrará' : 'no se registrarán'} hasta entonces.</p>
            )}
            {sinFoto.length > 0 && (
              <p className="text-sm text-aviso">{sinFoto.length === 1 ? 'Una salida no tiene foto y no se registrará' : `${sinFoto.length} salidas no tienen foto y no se registrarán`} hasta que la adjuntes.</p>
            )}
            {/* Se lleva el cursor en cada vuelta: el botón que se tocó se apagó mientras
                registraba, o se fue si ya no falta nada, y el cursor caía a la página. Y
                el aviso que nace con su texto no se anunciaba (vigesimoquinta pasada). */}
            {empezado && !registrando && (
              <AvisoEnfocado key={intentos} aviso={Boolean(queda)}>
                {hechas === 0 ? 'No se registró ninguno' : hechas === 1 ? 'Se registró 1 movimiento' : `Se registraron ${hechas} movimientos`}
                {queda ? `; ${queda}.` : '.'}
              </AvisoEnfocado>
            )}
            <div className="flex flex-wrap gap-2">
              {!terminado && (
                <Boton onClick={registrar} cargando={registrando} disabled={faltan.length === 0}>
                  {empezado
                    ? `Registrar lo que falta (${faltan.length})`
                    : faltan.length === 1 ? 'Registrar 1 movimiento' : `Registrar ${faltan.length} movimientos`}
                </Boton>
              )}
              {empezado && !registrando && (
                <Boton variante={terminado && !queda ? 'primario' : 'contorno'} onClick={cerrar}>Cerrar</Boton>
              )}
            </div>
          </>
        )}
      </div>
    </Ventana>
  )
}
