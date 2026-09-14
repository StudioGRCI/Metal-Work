'use client'

import { FileSearch, FileUp, Plus, Undo2, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition, type FormEvent } from 'react'

import { crearClienteRapido } from '@/app/(app)/clientes/acciones'
import { crearCarroceria } from '@/app/(app)/configuracion/acciones'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { MAXIMO_ADJUNTO_MB } from '@/lib/adjuntos'
import {
  buscarCliente,
  leerNombreDeArchivo,
  leerTextoDeCotizacion,
  nombreParaCatalogo,
  proponerCarroceria,
  unirLecturas,
  type CabeceraCotizacion,
  type PropuestaCarroceria,
} from '@/lib/cotizacion-pdf'
import { createClient } from '@/lib/supabase/client'

import { registrarCotizacionPdf } from './acciones'

type Cliente = { id: string; razon_social: string; tipo_documento: string; numero_documento: string }
type Carroceria = { id: string; nombre: string }
type TipoDocumento = 'RUC' | 'DNI' | 'CE' | 'PASAPORTE'

const SIN_LEER: CabeceraCotizacion = { numero: null, fecha: null, cliente: null, documento: null, producto: null }

/**
 * Subir la cotización que se le mandó al cliente (migraciones 101 y 102).
 *
 * Al elegir el PDF se lee su cabecera en el navegador —número, «Señores», RUC y
 * el título— y el formulario sale lleno: el cliente reconocido por su RUC, o
 * listo para registrarse si es nuevo; la carrocería del catálogo que nombra el
 * título, o una nueva con ese nombre. Todo se puede cambiar antes de subir.
 *
 * Nunca se elige un cliente de oficio. Con uno solo registrado, el formulario
 * lo dejaba puesto y una cotización de otro cliente se subía a su nombre.
 *
 * Al subir va todo en orden —cliente nuevo, carrocería nueva, el PDF, la
 * anotación— y lo que ya se creó queda elegido: si algo falla después, el
 * reintento no duplica al cliente ni la carrocería.
 */
export function SubirCotizacion({ clientes, carrocerias }: { clientes: Cliente[]; carrocerias: Carroceria[] }) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [lectura, setLectura] = useState<CabeceraCotizacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, iniciar] = useTransition()
  const enCurso = useRef(false)

  const [numero, setNumero] = useState('')

  const [listaClientes, setListaClientes] = useState(clientes)
  const [clienteNuevo, setClienteNuevo] = useState(false)
  const [clienteId, setClienteId] = useState('')
  const [reconocido, setReconocido] = useState(false)
  const [tipoDoc, setTipoDoc] = useState<TipoDocumento>('RUC')
  const [numeroDoc, setNumeroDoc] = useState('')
  const [razonSocial, setRazonSocial] = useState('')

  const [listaCarrocerias, setListaCarrocerias] = useState(carrocerias)
  const [carroceriaNueva, setCarroceriaNueva] = useState(false)
  const [carroceriaId, setCarroceriaId] = useState('')
  const [propuesta, setPropuesta] = useState<PropuestaCarroceria | null>(null)
  const [nombreCarroceria, setNombreCarroceria] = useState('')

  function abrir() {
    setArchivo(null)
    setLectura(null)
    setError(null)
    setAviso(null)
    setNumero('')
    setListaClientes(clientes)
    setClienteNuevo(false)
    setClienteId('')
    setReconocido(false)
    setTipoDoc('RUC')
    setNumeroDoc('')
    setRazonSocial('')
    setListaCarrocerias(carrocerias)
    setCarroceriaNueva(false)
    setCarroceriaId('')
    setPropuesta(null)
    setNombreCarroceria('')
    setAbierto(true)
  }

  /** Lo que se leyó llena el formulario; lo que no, se deja como estaba. */
  function aplicar(r: CabeceraCotizacion) {
    setLectura(r)
    if (r.numero) setNumero(r.numero)

    const registrado = buscarCliente(r, listaClientes)
    setReconocido(Boolean(registrado))
    if (registrado) {
      setClienteNuevo(false)
      setClienteId(registrado.id)
    } else if (r.cliente || r.documento) {
      setClienteNuevo(true)
      setClienteId('')
      setTipoDoc(r.documento?.tipo ?? 'RUC')
      setNumeroDoc(r.documento?.numero ?? '')
      setRazonSocial(r.cliente ?? '')
    }

    const prop = proponerCarroceria(r.producto, listaCarrocerias)
    setPropuesta(prop)
    setCarroceriaNueva(false)
    setCarroceriaId(prop?.id ?? '')
    setNombreCarroceria(r.producto ? nombreParaCatalogo(r.producto) : '')
  }

  async function elegirArchivo(elegido: File | undefined) {
    if (!elegido) return
    setArchivo(elegido)
    setError(null)
    setLectura(null)
    if (elegido.type !== 'application/pdf' && !/\.pdf$/i.test(elegido.name)) {
      setError('La cotización se sube en PDF.')
      return
    }

    setLeyendo(true)
    let delTexto = SIN_LEER
    try {
      // La librería solo hace falta aquí: se carga cuando se elige el archivo.
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(await elegido.arrayBuffer()))
      const { text } = await extractText(pdf, { mergePages: false })
      delTexto = leerTextoDeCotizacion(text[0] ?? '')
    } catch {
      // Escaneado o dañado: queda lo que diga el nombre del archivo.
    } finally {
      setLeyendo(false)
    }
    aplicar(unirLecturas(delTexto, leerNombreDeArchivo(elegido.name)))
  }

  function validar(): string | null {
    if (!archivo) return 'Elige el PDF de la cotización.'
    if (archivo.type !== 'application/pdf' && !/\.pdf$/i.test(archivo.name)) return 'La cotización se sube en PDF.'
    if (archivo.size > MAXIMO_ADJUNTO_MB * 1024 * 1024) return `El PDF pesa más de ${MAXIMO_ADJUNTO_MB} MB.`
    if (numero.trim().length < 3) return 'Escribe el número que dice el PDF.'
    if (clienteNuevo) {
      if (razonSocial.trim().length < 3) return 'Escribe el nombre o la razón social del cliente nuevo.'
      if (tipoDoc === 'RUC' && !/^\d{11}$/.test(numeroDoc.trim())) return 'El RUC del cliente tiene 11 dígitos.'
      if (tipoDoc === 'DNI' && !/^\d{8}$/.test(numeroDoc.trim())) return 'El DNI del cliente tiene 8 dígitos.'
      if (numeroDoc.trim().length < 6) return 'Escribe el documento del cliente nuevo.'
    } else if (!clienteId) {
      return 'Elige el cliente.'
    }
    if (carroceriaNueva ? nombreCarroceria.trim().length < 3 : !carroceriaId) {
      return carroceriaNueva ? 'Escribe el nombre de la carrocería nueva.' : 'Elige qué se fabrica.'
    }
    return null
  }

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (enCurso.current) return

    const falta = validar()
    if (falta || !archivo) {
      setError(falta)
      return
    }

    enCurso.current = true
    setError(null)
    iniciar(async () => {
      const supabase = createClient()
      const id = crypto.randomUUID()
      const ruta = `cot/${id}/${crypto.randomUUID()}.pdf`
      let subido = false
      try {
        let cliente = clienteId
        if (clienteNuevo) {
          const datos = new FormData()
          datos.set('tipo_documento', tipoDoc)
          datos.set('numero_documento', numeroDoc.trim())
          datos.set('razon_social', razonSocial.trim())
          const r = await crearClienteRapido(null, datos)
          if (!r.ok || !r.datos) {
            setError(r.ok ? 'No se pudo registrar el cliente.' : r.error)
            return
          }
          const creado = r.datos
          cliente = creado.id
          // Queda elegido: si lo que sigue falla, el reintento no lo vuelve a crear.
          setListaClientes((lista) =>
            lista.some((c) => c.id === creado.id)
              ? lista
              : [...lista, { id: creado.id, razon_social: creado.razon_social, tipo_documento: tipoDoc, numero_documento: creado.numero_documento }],
          )
          setClienteId(creado.id)
          setClienteNuevo(false)
          setReconocido(true)
        }

        let carroceria = carroceriaId
        if (carroceriaNueva) {
          const datos = new FormData()
          datos.set('nombre', nombreCarroceria.trim())
          const r = await crearCarroceria(null, datos)
          if (!r.ok || !r.datos) {
            setError(r.ok ? 'No se pudo agregar la carrocería.' : r.error)
            return
          }
          const creada = r.datos
          carroceria = creada.id
          setListaCarrocerias((lista) => (lista.some((c) => c.id === creada.id) ? lista : [...lista, creada]))
          setCarroceriaId(creada.id)
          setCarroceriaNueva(false)
        }

        const { error: falla } = await supabase.storage
          .from('cotizaciones-pdf')
          .upload(ruta, archivo, { contentType: 'application/pdf', upsert: false })
        if (falla) {
          setError('No se pudo subir el PDF. Revisa la señal y vuelve a intentar.')
          return
        }
        subido = true

        const datos = new FormData()
        datos.set('id', id)
        datos.set('numero', numero.trim())
        datos.set('cliente_id', cliente)
        datos.set('tipo_carroceria_id', carroceria)
        datos.set('ruta_storage', ruta)
        datos.set('nombre_archivo', archivo.name.slice(0, 200))
        datos.set('tamano_bytes', String(archivo.size))

        const r = await registrarCotizacionPdf(null, datos)
        if (!r.ok) {
          await supabase.storage.from('cotizaciones-pdf').remove([ruta])
          subido = false
          setError(r.error)
          return
        }
        subido = false
        setAviso(r.mensaje ?? 'Cotización subida.')
        setAbierto(false)
        iniciar(() => router.refresh())
      } catch {
        // Si la anotación se cae por el camino, el archivo se quita: uno que
        // ninguna fila nombra no lo ve nadie y no lo borra nadie.
        if (subido) await supabase.storage.from('cotizaciones-pdf').remove([ruta])
        setError('No se pudo registrar la cotización. Vuelve a intentar.')
      } finally {
        enCurso.current = false
      }
    })
  }

  const leido = lectura && (lectura.numero || lectura.cliente || lectura.documento || lectura.producto)

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        <Boton onClick={abrir}>
          <Upload aria-hidden className="size-4" />
          Subir cotización
        </Boton>
        {aviso && (
          <span role="status" className="text-xs font-medium text-exito">
            {aviso}
          </span>
        )}
      </span>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Subir la cotización"
        descripcion="El PDF que se le mandó al cliente. Al elegirlo se leen su número, el cliente y qué se fabrica: revisa que esté bien y súbela."
        ancho="md"
      >
        <form onSubmit={enviar} className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-base)] border border-dashed border-borde px-4 py-6 text-center text-sm text-texto-suave hover:bg-superficie-2">
            <FileUp aria-hidden className="size-6" />
            <span className="font-medium text-texto">{archivo ? archivo.name : 'Elegir el PDF'}</span>
            <span className="text-xs">Hasta {MAXIMO_ADJUNTO_MB} MB</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => {
                void elegirArchivo(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>

          {leyendo && (
            <p role="status" className="flex items-center gap-2 text-sm text-texto-suave">
              <FileSearch aria-hidden className="size-4" />
              Leyendo el PDF…
            </p>
          )}

          {lectura && !leyendo && (
            <div role="status" className="rounded-[var(--radius-base)] bg-superficie-2 px-3 py-2 text-xs text-texto-suave">
              {leido ? (
                <>
                  <p className="font-medium text-texto">Leído del PDF</p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    {lectura.numero && (
                      <>
                        <dt>Número</dt>
                        <dd className="tabular text-texto">{lectura.numero}</dd>
                      </>
                    )}
                    {(lectura.cliente || lectura.documento) && (
                      <>
                        <dt>Señores</dt>
                        <dd className="text-texto">
                          {lectura.cliente ?? '—'}
                          {lectura.documento && (
                            <span className="tabular text-texto-suave">
                              {' '}
                              · {lectura.documento.tipo} {lectura.documento.numero}
                            </span>
                          )}
                        </dd>
                      </>
                    )}
                    {lectura.producto && (
                      <>
                        <dt>Título</dt>
                        <dd className="text-texto">{lectura.producto}</dd>
                      </>
                    )}
                  </dl>
                </>
              ) : (
                <p>No se encontró la cabecera de la cotización (¿es un escaneo?). Llena los datos a mano.</p>
              )}
            </div>
          )}

          <Campo etiqueta="Número de la cotización" htmlFor="cot-numero" ayuda="El que dice el PDF" requerido>
            <Entrada
              id="cot-numero"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              required
              maxLength={40}
              placeholder="3522-2025"
              autoComplete="off"
            />
          </Campo>

          {/* ------------------------------------------------------ cliente */}
          {clienteNuevo ? (
            <fieldset className="space-y-3 rounded-[var(--radius-base)] border border-borde p-3">
              <legend className="px-1 text-sm font-medium text-texto">Cliente nuevo</legend>
              <p className="-mt-1 text-xs text-texto-suave">
                No está registrado. Se registra al subir la cotización; la ficha completa se llena después en Clientes.
              </p>
              <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                <Campo etiqueta="Documento" htmlFor="cot-tipo-doc" requerido>
                  <Seleccion id="cot-tipo-doc" value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value as TipoDocumento)}>
                    <option value="RUC">RUC</option>
                    <option value="DNI">DNI</option>
                    <option value="CE">CE</option>
                    <option value="PASAPORTE">Pasaporte</option>
                  </Seleccion>
                </Campo>
                <Campo etiqueta="Número" htmlFor="cot-num-doc" requerido>
                  <Entrada
                    id="cot-num-doc"
                    value={numeroDoc}
                    onChange={(e) => setNumeroDoc(e.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={20}
                  />
                </Campo>
              </div>
              <Campo etiqueta="Nombre o razón social" htmlFor="cot-razon" requerido>
                <Entrada
                  id="cot-razon"
                  value={razonSocial}
                  onChange={(e) => setRazonSocial(e.target.value)}
                  autoComplete="off"
                  maxLength={200}
                />
              </Campo>
              <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setClienteNuevo(false)}>
                <Undo2 aria-hidden className="size-3.5" />
                Elegir uno registrado
              </Boton>
            </fieldset>
          ) : (
            <div className="space-y-1.5">
              <Campo
                etiqueta="Cliente"
                htmlFor="cot-cliente"
                ayuda={reconocido && clienteId ? 'Reconocido por el documento que trae el PDF' : undefined}
                requerido
              >
                <Seleccion
                  id="cot-cliente"
                  value={clienteId}
                  onChange={(e) => {
                    setClienteId(e.target.value)
                    setReconocido(false)
                  }}
                >
                  <option value="" disabled>
                    Elige el cliente
                  </option>
                  {listaClientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.razon_social}
                    </option>
                  ))}
                </Seleccion>
              </Campo>
              <Boton
                type="button"
                variante="fantasma"
                tamano="sm"
                onClick={() => {
                  setClienteNuevo(true)
                  if (!razonSocial && lectura?.cliente) setRazonSocial(lectura.cliente)
                }}
              >
                <Plus aria-hidden className="size-3.5" />
                Es un cliente nuevo
              </Boton>
            </div>
          )}

          {/* -------------------------------------------------- carrocería */}
          {carroceriaNueva ? (
            <fieldset className="space-y-3 rounded-[var(--radius-base)] border border-borde p-3">
              <legend className="px-1 text-sm font-medium text-texto">Carrocería nueva</legend>
              <p className="-mt-1 text-xs text-texto-suave">
                Se agrega al catálogo al subir la cotización. Sus horas y precios de referencia se ponen después, en Configuración.
              </p>
              <Campo etiqueta="Nombre" htmlFor="cot-carroceria-nueva" requerido>
                <Entrada
                  id="cot-carroceria-nueva"
                  value={nombreCarroceria}
                  onChange={(e) => setNombreCarroceria(e.target.value)}
                  autoComplete="off"
                  maxLength={120}
                />
              </Campo>
              <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setCarroceriaNueva(false)}>
                <Undo2 aria-hidden className="size-3.5" />
                Elegir del catálogo
              </Boton>
            </fieldset>
          ) : (
            <div className="space-y-1.5">
              <Campo
                etiqueta="Qué se fabrica"
                htmlFor="cot-carroceria"
                ayuda={
                  propuesta && carroceriaId === propuesta.id
                    ? propuesta.completa
                      ? 'Propuesta por el título de la cotización'
                      : 'Parecida al título de la cotización: revisa que sea esta'
                    : lectura?.producto && !propuesta
                      ? 'El título no se parece a ninguna del catálogo: elígela o agrégala'
                      : 'La carrocería, del catálogo de la casa'
                }
                requerido
              >
                <Seleccion id="cot-carroceria" value={carroceriaId} onChange={(e) => setCarroceriaId(e.target.value)}>
                  <option value="" disabled>
                    Elige la carrocería
                  </option>
                  {listaCarrocerias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </Seleccion>
              </Campo>
              <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setCarroceriaNueva(true)}>
                <Plus aria-hidden className="size-3.5" />
                No está en el catálogo
              </Boton>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="lg" cargando={enviando} disabled={leyendo} className="w-full sm:w-auto">
              Subir y mandar a Gerencia
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
