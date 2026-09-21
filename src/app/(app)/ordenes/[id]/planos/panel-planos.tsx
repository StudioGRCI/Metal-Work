'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FileCheck2, FileDown, Upload } from 'lucide-react'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { useEnvio } from '@/lib/envio'
import { fechaHora } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'
import type { ResultadoAccion } from '@/lib/acciones'
import type { VersionPlano, catalogosDePlanos } from '@/lib/datos/versiones-planos'
import { registrarVersionPlano, resolverVersionPlano } from './acciones'

type VersionEnPantalla = VersionPlano & { puedeRevisar: boolean; puedeRecibir: boolean }
type Catalogos = Awaited<ReturnType<typeof catalogosDePlanos>>
const ESTADOS: Record<string, string> = { POR_REVISAR: 'Por revisar', OBSERVADO: 'Requiere corrección', APROBADO: 'Aprobado · pendiente de recepción', RECIBIDO: 'Recibido por el área' }

export function PanelPlanos({ ordenId, abierta, puedeCargar, catalogos, versiones }: {
  ordenId: string; abierta: boolean; puedeCargar: boolean; catalogos: Catalogos; versiones: VersionEnPantalla[]
}) {
  const [historial, setHistorial] = useState(false)
  const actuales = versiones.filter(v => v.vigente || v.estado === 'POR_REVISAR' || v.estado === 'OBSERVADO')
  const visibles = historial ? versiones : actuales
  return <div className="space-y-5">
    <div className="rounded-[var(--radius-base)] border border-acento/30 bg-acento-suave p-4 text-sm text-texto">
      <p className="font-semibold">Preparar → Revisar → Entregar al área → Confirmar recepción</p>
      <p className="mt-1 text-texto-suave">Una corrección se carga como nueva versión. El plano aprobado sigue vigente hasta que se apruebe su reemplazo para esa área.</p>
    </div>
    {!abierta && <p role="status" className="text-sm text-texto-suave">La orden no está abierta: la carga y revisión de versiones están deshabilitadas.</p>}
    {puedeCargar && abierta && <CargarVersion catalogos={catalogos} ordenId={ordenId} />}
    <Tarjeta>
      <TarjetaCabecera titulo="Planos de tu ámbito" descripcion="PDF privados. La revisión no confirma que el área haya recibido el plano; esa recepción queda registrada por separado."
        acciones={<Boton variante="secundario" tamano="sm" aria-pressed={historial} onClick={() => setHistorial(!historial)}>{historial ? 'Ver vigentes y pendientes' : 'Incluir versiones anteriores'}</Boton>} />
      <TarjetaCuerpo className="space-y-4">
        {visibles.length === 0 && <div className="py-6 text-center">
          <FileCheck2 aria-hidden className="mx-auto mb-3 size-8 text-texto-tenue" />
          <p className="font-medium text-texto">Todavía no tienes planos disponibles</p>
          <p className="mt-1 text-sm text-texto-suave">{puedeCargar ? 'Crea el plano en Cumplimiento y carga aquí el PDF para revisión.' : 'Los planos aparecerán cuando se aprueben para tu área.'}</p>
        </div>}
        {visibles.map(v => <Version key={v.id} version={v} ordenId={ordenId} />)}
        {versiones.length === 200 && <p className="text-sm text-aviso">Se muestran las 200 versiones más recientes de esta orden.</p>}
      </TarjetaCuerpo>
    </Tarjeta>
  </div>
}

function CargarVersion({ catalogos, ordenId }: { catalogos: Catalogos; ordenId: string }) {
  const [solicitud, setSolicitud] = useState(() => crypto.randomUUID())
  const [aviso, setAviso] = useState<string | null>(null)
  async function cargar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    setAviso(null)
    const archivo = datos.get('archivo')
    if (!(archivo instanceof File) || !archivo.size || archivo.size > 20 * 1024 * 1024 || await archivo.slice(0, 5).text() !== '%PDF-') {
      return { ok: false, error: 'Selecciona un PDF válido de hasta 20 MB.' }
    }
    const supabase = createClient()
    const { data: sesion, error: sesionError } = await supabase.auth.getUser()
    if (sesionError || !sesion.user) return { ok: false, error: 'La sesión venció. Vuelve a ingresar.' }
    const ruta = `${sesion.user.id}/${solicitud}.pdf`
    try {
      const { error: subida } = await supabase.storage.from('planos-privados').upload(ruta, archivo, { contentType: 'application/pdf', upsert: false })
      // El mismo identificador permite confirmar un envío cuya respuesta se perdió.
      if (subida && subida.statusCode !== '409') return { ok: false, error: 'No se pudo cargar el PDF. Revisa la conexión y vuelve a intentar.' }
      const formulario = new FormData()
      formulario.set('id', solicitud)
      formulario.set('plano_id', String(datos.get('plano_id') ?? ''))
      formulario.set('area_id', String(datos.get('area_id') ?? ''))
      formulario.set('nombre_archivo', archivo.name.slice(0, 200))
      const resultado = await registrarVersionPlano(null, formulario)
      if (!resultado.ok) {
        const { error: limpieza } = await supabase.storage.from('planos-privados').remove([ruta])
        if (limpieza) return { ok: false, error: `${resultado.error} No se pudo retirar el archivo sin registrar; conserva esta pantalla y vuelve a intentar.` }
      }
      return resultado
    } catch {
      // Si ya se registró, RLS impide borrarlo. Un reintento conserva la misma solicitud.
      await supabase.storage.from('planos-privados').remove([ruta]).catch(() => undefined)
      return { ok: false, error: 'No se pudo confirmar el envío. Vuelve a intentar con el mismo archivo.' }
    }
  }
  const { alEnviar, enviando, error } = useEnvio(cargar, r => setAviso(r.mensaje ?? 'Versión registrada.'))
  return <Tarjeta>
    <TarjetaCabecera titulo="Enviar plano a revisión" descripcion="Selecciona el plano y su área destinataria. Conserva el CAD original en Diseño y carga el PDF que debe usar el taller." />
    <TarjetaCuerpo>
      {catalogos.planos.length === 0 ? <p className="text-sm text-texto-suave">Primero <Link className="text-acento underline" href={`/ordenes/${ordenId}?vista=cumplimiento`}>crea el plano y sus piezas en Cumplimiento</Link>.</p> :
        <form onSubmit={alEnviar} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Plano" htmlFor="version-plano"><Seleccion id="version-plano" name="plano_id" required disabled={enviando} defaultValue=""><option value="" disabled>Elige un plano</option>{catalogos.planos.map(p => <option key={p.id} value={p.id}>{p.numero_plano} · {p.nombre}</option>)}</Seleccion></Campo>
            <Campo etiqueta="Área destinataria" htmlFor="version-area"><Seleccion id="version-area" name="area_id" required disabled={enviando} defaultValue=""><option value="" disabled>Elige un área</option>{catalogos.areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}</Seleccion></Campo>
          </div>
          <Campo etiqueta="Plano en PDF" htmlFor="version-archivo" ayuda="Hasta 20 MB. Para otro archivo, selecciónalo de nuevo; se creará una nueva revisión.">
            <Entrada id="version-archivo" name="archivo" type="file" accept="application/pdf,.pdf" required disabled={enviando} onChange={() => { setSolicitud(crypto.randomUUID()); setAviso(null) }} />
          </Campo>
          {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
          {aviso && <p role="status" className="text-sm text-exito">{aviso}</p>}
          <Boton type="submit" cargando={enviando}><Upload aria-hidden className="size-4" />Enviar a revisión</Boton>
        </form>}
    </TarjetaCuerpo>
  </Tarjeta>
}

function Version({ version: v, ordenId }: { version: VersionEnPantalla; ordenId: string }) {
  const [aviso, setAviso] = useState<string | null>(null)
  const { alEnviar, enviando, error } = useEnvio(resolverVersionPlano, r => setAviso(r.mensaje ?? 'Cambio registrado.'))
  return <article className="rounded-[var(--radius-base)] border border-borde p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="font-semibold wrap-break-word">Plano {v.plano.numero_plano} · {v.plano.nombre}</h2><p className="mt-1 text-sm text-texto-suave">{v.area.nombre} · Revisión {v.revision}</p></div>
      <Insignia tono={v.vigente ? 'exito' : v.estado === 'OBSERVADO' ? 'peligro' : 'aviso'}>{v.vigente ? 'Vigente' : ['APROBADO', 'RECIBIDO'].includes(v.estado) ? 'Versión anterior' : ESTADOS[v.estado]}</Insignia>
    </div>
    <p className="mt-2 text-sm">{ESTADOS[v.estado]}</p>
    <a className="mt-3 inline-flex min-h-11 items-center gap-2 break-all text-sm font-medium text-acento hover:underline" href={`/ordenes/${ordenId}/planos/${v.id}/archivo`}><FileDown aria-hidden className="size-4 shrink-0" />{v.nombre_archivo}</a>
    <p className="mt-2 text-xs text-texto-suave">Cargado: {fechaHora(v.creado_en)}{v.revisado_en ? ` · Revisado: ${fechaHora(v.revisado_en)}` : ''}{v.recibido_en ? ` · Recibido: ${fechaHora(v.recibido_en)}` : ''}</p>
    {v.observacion && <p className="mt-3 rounded-[var(--radius-base)] bg-aviso-suave p-3 text-sm text-texto whitespace-pre-wrap">{v.observacion}</p>}
    {v.puedeRevisar && <form onSubmit={alEnviar} className="mt-4 space-y-3">
      <input type="hidden" name="id" value={v.id} />
      <Campo etiqueta="Decisión" htmlFor={`decision-${v.id}`}><Seleccion id={`decision-${v.id}`} name="accion" required disabled={enviando} defaultValue=""><option value="" disabled>Elige después de revisar el PDF</option><option value="aprobar">Aprobar para el área</option><option value="observar">Pedir corrección a Diseño</option></Seleccion></Campo>
      <Campo etiqueta="Observación" htmlFor={`nota-${v.id}`} ayuda="Obligatoria si pides corrección."><AreaTexto id={`nota-${v.id}`} name="observacion" maxLength={1000} disabled={enviando} /></Campo>
      <Boton type="submit" cargando={enviando}>Guardar revisión</Boton>
    </form>}
    {v.puedeRecibir && <form onSubmit={alEnviar} className="mt-4"><input type="hidden" name="id" value={v.id} /><input type="hidden" name="accion" value="recibir" /><Boton type="submit" cargando={enviando}>Confirmar recepción del plano</Boton></form>}
    {error && <p role="alert" className="mt-3 text-sm text-peligro">{error}</p>}
    {aviso && <p role="status" className="mt-3 text-sm text-exito">{aviso}</p>}
  </article>
}
