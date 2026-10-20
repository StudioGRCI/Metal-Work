'use client'

import { Ban, LogIn, LogOut, Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Ventana } from '@/components/ui/ventana'
import type { Marca, Trabajador } from '@/lib/datos/rrhh'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { horaCorta, minutosLargos } from '@/lib/dominio/rrhh'
import { useEnvio } from '@/lib/envio'

import { anularAsistencia, buscarPorDni, marcarAsistencia } from './acciones'

type Persona = Pick<Trabajador, 'id' | 'nombres' | 'apellidos' | 'cargo' | 'hora_entrada' | 'hora_salida'>

/** Lo que la base contestó para un DNI: la persona, nadie, o por qué no buscó. */
type RespuestaDni = { dni: string; id: string | null; error?: string }

/**
 * La lista del día, pensada para el celular del portero: un buscador y una
 * tarjeta por persona con dos botones grandes. Quien solo consulta ve lo
 * mismo sin botones.
 *
 * El DNI no llega al celular (migración 20261020165000): con los 8 dígitos
 * escritos, la base contesta quién es y queda solo su tarjeta. Quien solo
 * consulta busca por nombre.
 */
export function Marcador({
  personal,
  marcas,
  marca,
  anula,
  esHoy,
  buscaPorDni,
}: {
  personal: Persona[]
  marcas: Marca[]
  marca: boolean
  anula: boolean
  esHoy: boolean
  /** La portería y RR. HH.: los demás buscan por nombre. */
  buscaPorDni: boolean
}) {
  const [busqueda, setBusqueda] = useState('')
  const [respuesta, setRespuesta] = useState<RespuestaDni | null>(null)
  const digitos = busqueda.replace(/\s/g, '')
  const esNumero = buscaPorDni && /^\d+$/.test(digitos)
  const dni = esNumero && digitos.length === 8 ? digitos : null

  useEffect(() => {
    if (!dni) return
    let vigente = true
    buscarPorDni(dni)
      .then((r) => vigente && setRespuesta({ dni, ...r }))
      .catch(() => vigente && setRespuesta({ dni, id: null, error: 'No se pudo buscar. Revisa la conexión y vuelve a escribirlo.' }))
    return () => {
      vigente = false
    }
  }, [dni])

  const contestado = dni !== null && respuesta?.dni === dni ? respuesta : null
  const palabras = palabrasDeBusqueda(busqueda)
  const visibles = esNumero
    ? contestado?.id
      ? personal.filter((p) => p.id === contestado.id)
      : []
    : personal.filter((p) => coincide(palabras, [p.nombres, p.apellidos]))
  const vacio =
    personal.length === 0
      ? 'Recursos Humanos todavía no registró a nadie.'
      : !esNumero
        ? buscaPorDni
          ? 'Nadie coincide. Prueba solo con el apellido o con el DNI.'
          : 'Nadie coincide. Prueba solo con el apellido.'
        : digitos.length < 8
          ? `Escribe los 8 dígitos del DNI (van ${digitos.length}).`
          : digitos.length > 8
            ? 'El DNI tiene 8 dígitos: sobra alguno.'
            : !contestado
              ? 'Buscando…'
              : (contestado.error ?? 'Ese DNI no es de nadie del personal activo. Revísalo o busca por el apellido.')
  const porPersona = new Map<string, Marca[]>()
  for (const m of marcas) porPersona.set(m.trabajador_id, [...(porPersona.get(m.trabajador_id) ?? []), m])

  return (
    <div className="space-y-3">
      <div className="relative max-w-xl">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-texto-suave" />
        <Entrada
          type="search"
          aria-label={buscaPorDni ? 'Buscar por nombre o DNI' : 'Buscar por nombre'}
          placeholder={buscaPorDni ? 'Nombre o los 8 dígitos del DNI' : 'Nombre o apellido'}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          // Al volver al buscador queda todo marcado: el siguiente DNI se escribe encima.
          onFocus={(e) => e.currentTarget.select()}
          className="min-h-11 pl-9"
          autoComplete="off"
        />
      </div>
      {visibles.length === 0 ? (
        <p
          role="status"
          className="rounded-[var(--radius-base)] border border-borde bg-superficie p-4 text-center text-sm text-texto-suave"
        >
          {vacio}
        </p>
      ) : (
        <ul className="space-y-2">
          {visibles.map((p) => (
            <TarjetaPersona key={p.id} persona={p} marcas={porPersona.get(p.id) ?? []} marca={marca && esHoy} anula={anula} />
          ))}
        </ul>
      )}
    </div>
  )
}

function TarjetaPersona({ persona: p, marcas, marca, anula }: { persona: Persona; marcas: Marca[]; marca: boolean; anula: boolean }) {
  // Un reintento manda el mismo id y la base no duplica; al marcar bien, se estrena otro.
  const [marcaId, setMarcaId] = useState(() => crypto.randomUUID())
  const [aviso, setAviso] = useState<string | null>(null)
  const envio = useEnvio(marcarAsistencia, (r) => {
    setMarcaId(crypto.randomUUID())
    setAviso(r.mensaje ?? null)
  })
  const vigentes = marcas.filter((m) => m.anulado_en === null)
  const ingreso = vigentes.find((m) => m.tipo === 'INGRESO')
  const salida = vigentes.find((m) => m.tipo === 'SALIDA')
  const anuladas = marcas.filter((m) => m.anulado_en !== null)

  return (
    <li className="rounded-[var(--radius-base)] border border-borde bg-superficie p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-texto">
            {p.apellidos}, {p.nombres}
          </p>
          <p className="text-xs text-texto-suave">
            {p.cargo ?? 'Sin cargo'} · entra <span className="tabular">{horaCorta(p.hora_entrada)}</span> · sale{' '}
            <span className="tabular">{horaCorta(p.hora_salida)}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          {ingreso ? (
            <LineaMarca marca={ingreso} anula={anula} />
          ) : (
            <Insignia tono="neutro">Sin ingreso</Insignia>
          )}
          {salida && <LineaMarca marca={salida} anula={anula} />}
        </div>
      </div>
      {anuladas.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-texto-suave">
          {anuladas.map((m) => (
            <li key={m.id}>
              <s className="tabular">
                {m.tipo === 'INGRESO' ? 'Ingreso' : 'Salida'} {horaCorta(m.hora)}
              </s>{' '}
              · anulada: {m.motivo_anulacion}
            </li>
          ))}
        </ul>
      )}
      {marca && (
        <div className="mt-3 flex gap-2">
          {(['INGRESO', 'SALIDA'] as const).map((tipo) => (
            // Un formulario por botón: el valor del botón pulsado no viaja en el FormData.
            <form
              key={tipo}
              onSubmit={(e) => {
                setAviso(null)
                envio.alEnviar(e)
              }}
              className="flex-1"
            >
              <input type="hidden" name="marca_id" value={marcaId} />
              <input type="hidden" name="trabajador_id" value={p.id} />
              <input type="hidden" name="tipo" value={tipo} />
              <Boton
                type="submit"
                variante={tipo === 'INGRESO' ? 'primario' : 'secundario'}
                tamano="lg"
                className="min-h-12 w-full"
                disabled={tipo === 'INGRESO' ? Boolean(ingreso) : !ingreso || Boolean(salida)}
                cargando={envio.enviando}
                aria-label={`Marcar ${tipo === 'INGRESO' ? 'el ingreso' : 'la salida'} de ${p.nombres} ${p.apellidos}`}
              >
                {tipo === 'INGRESO' ? <LogIn aria-hidden className="size-5" /> : <LogOut aria-hidden className="size-5" />}
                {tipo === 'INGRESO' ? 'Ingreso' : 'Salida'}
              </Boton>
            </form>
          ))}
        </div>
      )}
      {envio.error && (
        <p role="alert" className="mt-2 text-sm text-peligro">
          {envio.error}
        </p>
      )}
      {aviso && !envio.error && (
        <p role="status" className="mt-2 text-sm text-exito">
          {aviso}
        </p>
      )}
    </li>
  )
}

function LineaMarca({ marca: m, anula }: { marca: Marca; anula: boolean }) {
  const tarde = m.tipo === 'INGRESO' && m.es_tardanza
  return (
    <div className="flex items-center justify-end gap-1.5">
      <span className="text-xs text-texto">
        {m.tipo === 'INGRESO' ? 'Ingreso' : 'Salida'} <span className="tabular font-semibold">{horaCorta(m.hora)}</span>
      </span>
      {tarde ? (
        <Insignia tono="peligro">Tarde {minutosLargos(m.tardanza_minutos)}</Insignia>
      ) : m.tipo === 'INGRESO' && m.tardanza_minutos > 0 ? (
        <Insignia tono="aviso">{minutosLargos(m.tardanza_minutos)} tarde, tolerado</Insignia>
      ) : m.tipo === 'INGRESO' ? (
        <Insignia tono="exito">A tiempo</Insignia>
      ) : null}
      {anula && <AnularMarca marca={m} />}
    </div>
  )
}

function AnularMarca({ marca: m }: { marca: Marca }) {
  const [abierta, setAbierta] = useState(false)
  const envio = useEnvio(anularAsistencia, () => setAbierta(false))
  const que = m.tipo === 'INGRESO' ? 'el ingreso' : 'la salida'
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="icono" aria-label={`Anular ${que} de las ${horaCorta(m.hora)}`} onClick={() => setAbierta(true)}>
        <Ban aria-hidden className="size-4" />
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular ${que} de las ${horaCorta(m.hora)}`}
        descripcion="Para una marca que se hizo a la persona equivocada o por error. No se borra: queda con su motivo, y después se puede volver a marcar."
        ancho="sm"
      >
        <form onSubmit={envio.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={m.id} />
          <Campo etiqueta="Motivo" htmlFor={`anular-${m.id}`} requerido>
            <AreaTexto id={`anular-${m.id}`} name="motivo" required minLength={10} maxLength={500} rows={3} placeholder="Por ejemplo: se marcó a la persona equivocada." />
          </Campo>
          {envio.error && (
            <p role="alert" className="text-sm text-peligro">
              {envio.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={envio.enviando}>
              Anular
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
