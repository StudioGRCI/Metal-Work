'use client'

import { CheckCircle2, ClipboardList, FileSpreadsheet } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Ventana } from '@/components/ui/ventana'
import { TANDA_CONTEO } from '@/lib/dominio/conteo-inicial'
import { cantidad, hoyLima } from '@/lib/format'

import { leerConteoInicial, registrarConteoInicial, type FilaConteo } from './acciones'

type Resultado = { estado: 'ok' } | { estado: 'error'; mensaje: string }

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
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filas, setFilas] = useState<FilaConteo[] | null>(null)
  const [resultados, setResultados] = useState<Record<string, Resultado>>({})
  const [registrando, setRegistrando] = useState(false)
  const [fechaLeida, setFechaLeida] = useState('')
  const enCurso = useRef(false)

  const listas = (filas ?? []).filter((f) => f.estado === 'LISTA')
  const pendientes = listas.filter((f) => resultados[f.id]?.estado !== 'ok')
  const hechas = Object.values(resultados).filter((r) => r.estado === 'ok').length
  const fallidas = Object.values(resultados).filter((r) => r.estado === 'error').length
  const terminado = !registrando && Object.keys(resultados).length > 0

  function reiniciar() {
    setFilas(null)
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
      setError('Tiene que ser el formato en Excel (.xlsx). Si lo guardaste como .xls, guárdalo como «Libro de Excel».')
      return
    }
    enCurso.current = true
    setLeyendo(true)
    try {
      const datos = new FormData()
      datos.set('archivo', archivo)
      datos.set('fecha', fecha)
      const r = await leerConteoInicial(null, datos)
      if (!r.ok) setError(r.error)
      else {
        setFilas(r.datos?.filas ?? [])
        setFechaLeida(fecha)
      }
    } catch {
      setError('No se pudo leer el conteo. Revisa la conexión y vuelve a intentar.')
    } finally {
      setLeyendo(false)
      enCurso.current = false
    }
  }

  async function registrar() {
    if (enCurso.current || pendientes.length === 0) return
    enCurso.current = true
    setRegistrando(true)
    try {
      for (let i = 0; i < pendientes.length; i += TANDA_CONTEO) {
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
                <Campo etiqueta="Fecha del conteo" htmlFor="conteo-inicial-fecha" requerido>
                  <Entrada id="conteo-inicial-fecha" type="date" value={fecha} max={hoyLima()} onChange={(e) => setFecha(e.target.value)} disabled={leyendo} />
                </Campo>
                <Campo etiqueta="Formato de conteo, ya lleno" htmlFor="conteo-inicial-archivo">
                  <Entrada id="conteo-inicial-archivo" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    disabled={leyendo || !fecha} onChange={(e) => leer(e.target.files?.[0])} />
                </Campo>
              </div>
            </>
          )}
          {leyendo && <p role="status" className="text-sm text-texto-suave">Leyendo el conteo y revisando cada material…</p>}
          {error && <p role="alert" className="text-sm text-peligro">{error}</p>}

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
              {terminado && (
                <p role="status" className={fallidas ? 'text-sm text-aviso' : 'text-sm text-exito'}>
                  {hechas === 1 ? 'Se registró 1 material' : `Se registraron ${hechas} materiales`}{fallidas ? `; ${fallidas} no: revisa el mensaje de cada uno.` : '.'}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {pendientes.length > 0 && !registrando && (
                  <Boton onClick={registrar}>
                    {pendientes.length === 1 ? 'Registrar 1 material' : `Registrar ${pendientes.length} materiales`}
                  </Boton>
                )}
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
