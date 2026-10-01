'use client'

import { CheckCircle2, FileUp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { cantidad } from '@/lib/format'
import { subirArchivoPrivado } from '@/lib/subida-privada'
import { createClient } from '@/lib/supabase/client'

import { leerPlanillaAlmacen, registrarFilaPlanilla, type FilaPlanilla } from './acciones'

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp']
type Resultado = { estado: 'enviando' } | { estado: 'ok' } | { estado: 'error'; mensaje: string }

/**
 * Cargar la planilla llenada sin internet. Primero se lee y se muestra qué se
 * va a registrar y qué no; cada salida pide su foto; después se registra fila
 * por fila, con la fecha en que pasó, y se ve el resultado de cada una.
 * Volver a cargar la misma planilla no duplica nada.
 */
export function CargarPlanilla() {
  const router = useRouter()
  const [abierta, setAbierta] = useState(false)
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filas, setFilas] = useState<FilaPlanilla[] | null>(null)
  const [fotos, setFotos] = useState<Record<string, File>>({})
  const [resultados, setResultados] = useState<Record<string, Resultado>>({})
  const [registrando, setRegistrando] = useState(false)
  const enCurso = useRef(false)

  const listas = (filas ?? []).filter((f) => f.estado === 'LISTA')
  const porRegistrar = listas.filter((f) => f.hoja === 'Ingresos' || fotos[f.id])
  const sinFoto = listas.filter((f) => f.hoja === 'Salidas' && !fotos[f.id])
  const hechas = Object.values(resultados).filter((r) => r.estado === 'ok').length
  const fallidas = Object.values(resultados).filter((r) => r.estado === 'error').length
  const terminado = !registrando && Object.keys(resultados).length > 0

  function reiniciar() {
    setFilas(null)
    setFotos({})
    setResultados({})
    setError(null)
  }

  function cerrar() {
    if (registrando) return
    setAbierta(false)
    if (Object.keys(resultados).length > 0) router.refresh()
    reiniciar()
  }

  async function leer(archivo: File | undefined) {
    if (!archivo || enCurso.current) return
    reiniciar()
    if (!/\.xlsx$/i.test(archivo.name)) {
      setError('Tiene que ser la planilla en Excel (.xlsx). Si la guardaste como .xls, guárdala como «Libro de Excel».')
      return
    }
    enCurso.current = true
    setLeyendo(true)
    try {
      const datos = new FormData()
      datos.set('archivo', archivo)
      const r = await leerPlanillaAlmacen(null, datos)
      if (!r.ok) setError(r.error)
      else setFilas(r.datos?.filas ?? [])
    } catch {
      setError('No se pudo leer la planilla. Revisa la conexión y vuelve a intentar.')
    } finally {
      setLeyendo(false)
      enCurso.current = false
    }
  }

  function elegirFoto(fila: FilaPlanilla, archivo: File | undefined) {
    setFotos((previas) => {
      const nuevas = { ...previas }
      if (archivo && TIPOS_FOTO.includes(archivo.type) && archivo.size <= 10485760) nuevas[fila.id] = archivo
      else delete nuevas[fila.id]
      return nuevas
    })
    if (archivo && (!TIPOS_FOTO.includes(archivo.type) || archivo.size > 10485760)) {
      setResultados((r) => ({ ...r, [fila.id]: { estado: 'error', mensaje: 'La foto tiene que ser JPG, PNG o WebP de hasta 10 MB.' } }))
    } else {
      setResultados((r) => { const n = { ...r }; delete n[fila.id]; return n })
    }
  }

  async function registrar() {
    if (enCurso.current || porRegistrar.length === 0) return
    enCurso.current = true
    setRegistrando(true)
    try {
      const db = createClient()
      const { data: sesion } = await db.auth.getUser()
      const usuario = sesion.user?.id
      // Primero todos los ingresos y después las salidas: así el saldo alcanza
      // aunque la salida esté anotada antes que el ingreso del mismo día.
      const orden = [...porRegistrar.filter((f) => f.hoja === 'Ingresos'), ...porRegistrar.filter((f) => f.hoja === 'Salidas')]
      for (const f of orden) {
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
            datos.set('origen', f.origen)
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
        } catch {
          resultado = { ok: false, error: 'No se confirmó: vuelve a cargar la planilla; lo registrado no se duplica.' }
        }
        setResultados((r) => ({ ...r, [f.id]: resultado.ok ? { estado: 'ok' } : { estado: 'error', mensaje: resultado.error } }))
      }
    } finally {
      setRegistrando(false)
      enCurso.current = false
    }
  }

  const resumen = filas ? {
    listas: listas.length,
    cargadas: filas.filter((f) => f.estado === 'CARGADA').length,
    errores: filas.filter((f) => f.estado === 'ERROR').length,
  } : null

  return (
    <>
      <Boton variante="secundario" onClick={() => setAbierta(true)}>
        <FileUp aria-hidden className="size-4" />Cargar planilla
      </Boton>
      <Ventana abierta={abierta} alCerrar={cerrar} titulo="Cargar planilla sin internet" ancho="xl"
        descripcion="Lo anotado en la planilla de Excel entra al kardex con la fecha en que pasó. Primero revisas qué se va a registrar; cada salida pide su foto.">
        <div className="space-y-4">
          {!filas && (
            <Campo etiqueta="Planilla de Excel" htmlFor="planilla-archivo" ayuda="La que descargaste con «Descargar planilla», ya llena.">
              <Entrada id="planilla-archivo" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={leyendo} onChange={(e) => leer(e.target.files?.[0])} />
            </Campo>
          )}
          {leyendo && <p role="status" className="text-sm text-texto-suave">Leyendo la planilla y revisando cada fila…</p>}
          {error && <p role="alert" className="text-sm text-peligro">{error}</p>}

          {filas && resumen && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Insignia tono="exito">{resumen.listas} para registrar</Insignia>
                {resumen.cargadas > 0 && <Insignia tono="neutro">{resumen.cargadas} ya estaban en el kardex</Insignia>}
                {resumen.errores > 0 && <Insignia tono="peligro">{resumen.errores} con errores</Insignia>}
                {!registrando && !terminado && (
                  <button type="button" onClick={reiniciar} className="ml-auto text-sm text-acento hover:underline">Elegir otra planilla</button>
                )}
              </div>

              <ul className="max-h-[55vh] divide-y divide-borde overflow-y-auto rounded-[var(--radius-base)] border border-borde">
                {filas.map((f) => {
                  const r = resultados[f.id]
                  return (
                    <li key={`${f.hoja}-${f.fila}`} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-xs text-texto-suave">
                          <Insignia tono={f.hoja === 'Ingresos' ? 'exito' : 'aviso'}>{f.hoja === 'Ingresos' ? 'Ingreso' : 'Salida'}</Insignia>
                          <span>Fila {f.fila} · {f.fechaTexto}</span>
                        </p>
                        <p className="mt-1 text-sm font-medium text-texto">
                          {cantidad(f.cantidad)} {f.unidadMedida ?? ''} · {f.descripcion ?? f.codigo}
                          <span className="ml-1 font-mono text-[11px] font-normal text-texto-tenue">{f.codigo}</span>
                        </p>
                        <p className="text-xs text-texto-suave">
                          {f.hoja === 'Ingresos'
                            ? `${f.origen === 'SALDO_INICIAL' ? 'Saldo inicial' : 'Ingreso general'} · ${f.documento}`
                            : `${f.documento} · ${f.unidadRegistrada ? `a ${f.unidadRegistrada}` : `a ${f.unidad} (código nuevo)`} · recibe ${f.recibe}`}
                        </p>
                        {f.errores.length > 0 && (
                          <ul className="mt-1 list-disc pl-4 text-xs text-peligro">{f.errores.map((e) => <li key={e}>{e}</li>)}</ul>
                        )}
                        {r?.estado === 'error' && <p role="alert" className="mt-1 text-xs text-peligro">{r.mensaje}</p>}
                      </div>
                      <div className="flex items-center gap-2 sm:justify-end">
                        {f.estado === 'CARGADA' && <Insignia tono="neutro">Ya cargada</Insignia>}
                        {f.estado === 'ERROR' && <Insignia tono="peligro">No se registra</Insignia>}
                        {r?.estado === 'enviando' && <Insignia tono="info">Registrando…</Insignia>}
                        {r?.estado === 'ok' && <Insignia tono="exito"><CheckCircle2 aria-hidden className="size-3" />Registrada</Insignia>}
                        {f.estado === 'LISTA' && f.hoja === 'Salidas' && r?.estado !== 'ok' && (
                          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-base)] border border-borde-fuerte px-3 text-xs font-medium text-texto hover:bg-superficie-2 sm:min-h-9">
                            {fotos[f.id] ? `Foto: ${fotos[f.id].name.slice(0, 18)}` : 'Adjuntar foto'}
                            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={registrando}
                              aria-label={`Foto de la salida de la fila ${f.fila}`} onChange={(e) => elegirFoto(f, e.target.files?.[0])} />
                          </label>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>

              {!terminado && sinFoto.length > 0 && (
                <p className="text-sm text-aviso">{sinFoto.length === 1 ? 'Una salida no tiene foto y no se registrará' : `${sinFoto.length} salidas no tienen foto y no se registrarán`} hasta que la adjuntes.</p>
              )}
              {terminado && (
                <p role="status" className={fallidas ? 'text-sm text-aviso' : 'text-sm text-exito'}>
                  {hechas === 1 ? 'Se registró 1 movimiento' : `Se registraron ${hechas} movimientos`}{fallidas ? `; ${fallidas} no: revisa el mensaje de cada uno.` : '.'}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {!terminado && (
                  <Boton onClick={registrar} cargando={registrando} disabled={porRegistrar.length === 0}>
                    {porRegistrar.length === 1 ? 'Registrar 1 movimiento' : `Registrar ${porRegistrar.length} movimientos`}
                  </Boton>
                )}
                {terminado && <Boton onClick={cerrar}>Cerrar</Boton>}
              </div>
            </>
          )}
        </div>
      </Ventana>
    </>
  )
}
