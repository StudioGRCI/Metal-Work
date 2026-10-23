'use client'

import * as React from 'react'
import { Camera, FileCode, FileSpreadsheet, FileText, FileUp, ImageIcon, type LucideIcon } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { tamanoArchivo } from '@/lib/format'
import { cn } from '@/lib/utils'

type Tipo = {
  que: string
  /** Lo que dice con ratón, si no es lo mismo que con el dedo. */
  queConRaton?: string
  formato: string
  noEs: string
  Icono: LucideIcon
}

/**
 * Qué pide el campo, sacado de su `accept`: así cada pantalla dice lo mismo
 * para lo mismo sin repetir el texto a mano en cada formulario.
 */
function tipoDe(accept: string, conCamara: boolean): Tipo {
  const t = accept.toLowerCase().split(',').map((x) => x.trim()).filter(Boolean)
  const excel = t.some((x) => x === '.xlsx' || x.includes('spreadsheetml'))
  const xml = t.some((x) => x === '.xml' || x.endsWith('/xml'))
  const pdf = t.some((x) => x === '.pdf' || x === 'application/pdf')
  const word = t.some((x) => x === '.docx' || x === '.doc' || x.includes('wordprocessingml') || x === 'application/msword')
  const foto = t.some((x) => x.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp'].includes(x))
  if (excel) return { que: 'Elegir el Excel', formato: 'Solo Excel (.xlsx)', noEs: 'No es un Excel (.xlsx)', Icono: FileSpreadsheet }
  if (xml) return { que: 'Elegir el XML', formato: 'XML o ZIP de SUNAT', noEs: 'No es un XML ni un ZIP', Icono: FileCode }
  if (pdf && word) return { que: 'Elegir el PDF o el Word', formato: 'PDF o Word', noEs: 'No es un PDF ni un Word', Icono: FileText }
  if (pdf && foto) return { que: 'Elegir el PDF o la foto', formato: 'PDF, JPG, PNG o WEBP', noEs: 'No es un PDF ni una foto', Icono: FileUp }
  if (pdf) return { que: 'Elegir el PDF', formato: 'Solo PDF', noEs: 'No es un PDF', Icono: FileText }
  if (foto) {
    // Con `capture`, el teléfono y la tableta abren la cámara de frente, sin la
    // galería; con ratón no hay cámara y sale el explorador de archivos.
    return conCamara
      ? { que: 'Tomar la foto', queConRaton: 'Elegir la foto', formato: 'JPG, PNG o WEBP', noEs: 'No es una foto JPG, PNG o WEBP', Icono: Camera }
      : { que: 'Elegir la foto', formato: 'JPG, PNG o WEBP', noEs: 'No es una foto JPG, PNG o WEBP', Icono: ImageIcon }
  }
  return { que: 'Elegir el archivo', formato: '', noEs: 'No es del tipo que se pide', Icono: FileUp }
}

/** Si el archivo elegido es de lo que pide el `accept`, por extensión o por tipo. */
function coincide(archivo: File, accept: string): boolean {
  const t = accept.toLowerCase().split(',').map((x) => x.trim()).filter(Boolean)
  if (t.length === 0) return true
  const nombre = archivo.name.toLowerCase()
  const tipo = archivo.type.toLowerCase()
  return t.some((x) =>
    x.startsWith('.') ? nombre.endsWith(x) : x.endsWith('/*') ? tipo.startsWith(x.slice(0, -1)) : tipo === x,
  )
}

/**
 * Por qué el archivo no sirve —no es del tipo, está vacío, pasa del tope—, en
 * las mismas palabras que pone el campo; `null` si sirve. Para las pantallas
 * que leen o suben el archivo apenas se elige: así no lo intentan con uno que
 * el campo ya marcó en rojo.
 */
export function avisoDeArchivo(archivo: File, accept: string, hastaMb?: number): string | null {
  if (!coincide(archivo, accept)) return `${tipoDe(accept, false).noEs}: toca para elegir otro`
  if (archivo.size === 0) return 'Está vacío: toca para elegir otro'
  if (hastaMb && archivo.size > hastaMb * 1024 * 1024) {
    return `Pesa ${tamanoArchivo(archivo.size)} y el tope es ${hastaMb} MB: toca para elegir otro`
  }
  return null
}

/** Que los bytes del principio digan lo mismo que el nombre. */
const FIRMAS: Record<string, { que: string; es: (b: Uint8Array) => boolean }> = {
  // «%PDF-» al principio, como lo exigen el servidor y la lectura de facturas:
  // uno que el campo pusiera en verde no puede rechazarse después al enviar.
  '.pdf': { que: 'un PDF', es: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d },
  // .xlsx y .docx son un ZIP; el .doc de antes, un archivo compuesto de Office.
  '.xlsx': { que: 'un Excel', es: (b) => b[0] === 0x50 && b[1] === 0x4b },
  '.docx': { que: 'un Word', es: (b) => b[0] === 0x50 && b[1] === 0x4b },
  '.doc': { que: 'un Word', es: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 },
}

/**
 * Lo mismo, y además que lo sea por dentro: un Word o una foto con el nombre
 * cambiado a «.pdf» pasa por la extensión y después no lo abre nadie. Para
 * mirarlo antes de leerlo o subirlo.
 */
export async function revisarArchivo(archivo: File, accept: string, hastaMb?: number): Promise<string | null> {
  const aviso = avisoDeArchivo(archivo, accept, hastaMb)
  if (aviso) return aviso
  const extension = /\.[a-z0-9]+$/.exec(archivo.name.toLowerCase())?.[0] ?? ''
  const firma = FIRMAS[extension] ?? (archivo.type === 'application/pdf' ? FIRMAS['.pdf'] : undefined)
  if (!firma) return null
  try {
    const bytes = new Uint8Array(await archivo.slice(0, 8).arrayBuffer())
    return firma.es(bytes) ? null : `Está dañado o no es ${firma.que} de verdad: toca para elegir otro`
  } catch {
    // Se movió o se cambió en la computadora después de elegirlo.
    return 'No se pudo abrir: elígelo otra vez'
  }
}

/** «toca para…» con el dedo, «haz clic para…» con ratón: por el puntero, como «Tomar la foto». */
function ConPuntero({ texto }: { texto: string }) {
  const i = texto.indexOf('toca para')
  if (i < 0) return texto
  const invitacion = (
    <>
      <span className="pointer-fine:hidden">toca</span>
      <span className="hidden pointer-fine:inline">haz clic</span>
      {texto.slice(i + 'toca'.length)}
    </>
  )
  // «· toca para cambiarlo» no se dice con el campo apagado: tras «ya quedó» la
  // ventana lo traba sin pasar por aquí, y la caja invitaba a cambiar un archivo
  // que ya no se puede tocar (decimoquinta pasada).
  const separador = texto.lastIndexOf(' · ', i)
  if (separador >= 0 && /^toca para cambiarlo/.test(texto.slice(i))) {
    return (
      <>
        {texto.slice(0, separador)}
        <span className="group-has-[input:disabled]/archivo:hidden">
          {texto.slice(separador, i)}
          {invitacion}
        </span>
      </>
    )
  }
  return (
    <>
      {texto.slice(0, i)}
      {invitacion}
    </>
  )
}

/** En el globo del navegador no hay caja que tocar: «No es un PDF: elige otro.» */
function paraElGlobo(aviso: string): string {
  return aviso.replace(/: toca para elegir otro$/, ': elige otro.')
}

/** «Elegir el Excel de la planilla» → «Falta el Excel de la planilla.» */
function faltaDe(principal: string): string {
  const objeto = principal.replace(/^(Tomar|Elegir)\s+/, '')
  return objeto === principal ? 'Elige el archivo.' : `Falta ${objeto}.`
}

export type ElegirArchivoProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'multiple'> & {
  /** La línea principal antes de elegir. Sin esto sale del `accept`: «Elegir el PDF». */
  texto?: string
  /** El tope que valida el servidor: se dice antes de elegir y se avisa si el archivo pasa. */
  hastaMb?: number
  /**
   * El archivo que guarda la pantalla, cuando lo lee o lo sube apenas se elige
   * y vacía el campo para que se pueda volver a elegir el mismo. Sin esto, el
   * campo muestra lo que tiene elegido.
   */
  archivo?: File | null
  /** Por qué no sirve, cuando lo sabe la pantalla: «No se pudo leer», el rechazo de la subida. Gana al aviso propio. */
  aviso?: string | null
  /** Lo que está pasando con el archivo: «Leyendo el Excel…», «Subiendo…». */
  estado?: string | null
}

/**
 * El campo para elegir un archivo, en castellano y diciendo qué pide.
 *
 * El `<input type="file">` del navegador pinta su propio botón —«Choose File»,
 * «Seleccionar archivo» o «Examinar», según el idioma del equipo y no el de la
 * página—, corta el nombre del archivo a la mitad y no dice qué espera: en
 * «Importar del Excel» se veía «Choose File PRUEBA-NO-E…TAL-WORK.txt» y nada
 * avisaba que eso no era un Excel hasta apretar «Leer y comprobar» (DKS,
 * 2026-10-21). Ese botón no se puede traducir desde la página, así que no se
 * pinta: el campo de verdad sigue ahí, transparente y tapando toda la caja,
 * para que el formulario lo envíe igual, el `required` funcione, el teclado
 * llegue y se pueda soltar un archivo arrastrado desde el escritorio. Por lo
 * mismo, el globo de «obligatorio» también se escribe aquí: el del navegador
 * decía «Please select a file.».
 *
 * Lo que dice cambia con lo elegido: el nombre entero y su peso, o el motivo
 * —no es del tipo, pasa del tope, está vacío, no lo es por dentro— antes de
 * enviar. Avisa, no bloquea: el que decide es el servidor. Lo que sí traba es
 * que falte, y entonces lo dice también en la caja; donde la pantalla guarda el
 * archivo y es obligatorio, también que no sirva, porque esas pantallas no lo
 * envían y el navegador saltaba al primer campo vacío. Es el mismo en todo lugar que pide
 * un archivo, también donde se lee o se sube apenas se elige (`archivo`,
 * `aviso` y `estado`): «aplica para todo lugar que pida documento» (DKS,
 * 2026-10-21). Con `archivo`, el campo se vacía solo al abrirse: la pantalla
 * no tiene que vaciarlo. Sin `archivo` ni `required`, el elegido lleva
 * «Quitar»: el campo vuelve a quedar vacío y la pantalla se entera por su
 * `onChange`, como si hubieran elegido «nada».
 */
export const ElegirArchivo = React.forwardRef<HTMLInputElement, ElegirArchivoProps>(function ElegirArchivo(
  {
    texto,
    hastaMb,
    archivo: archivoDeLaPantalla,
    aviso: avisoDeLaPantalla,
    estado,
    accept = '',
    capture,
    className,
    disabled,
    required,
    onChange,
    onClick,
    onInvalid,
    'aria-describedby': descrito,
    'aria-invalid': invalidoDesdeAfuera,
    ...props
  },
  ref,
) {
  const [delCampo, setDelCampo] = React.useState<File | null>(null)
  // Lo que `revisarArchivo` vio por dentro: un Word con nombre «.pdf» no puede
  // quedar en verde, ni pasar el envío cuando la pantalla guarda el archivo.
  const [revisado, setRevisado] = React.useState<{ archivo: File; aviso: string | null } | null>(null)
  // Se intentó enviar sin archivo: «Falta…» se dice en la caja, no solo en el globo.
  const [falta, setFalta] = React.useState(false)
  const propio = React.useRef<HTMLInputElement | null>(null)
  const idEstado = React.useId()
  const tipo = tipoDe(accept, Boolean(capture))
  const principal = texto ?? tipo.que
  const controlado = archivoDeLaPantalla !== undefined

  const revisarDelCampo = React.useCallback(
    (elegido: File | null) => {
      setRevisado(null)
      if (!elegido || controlado) return
      void revisarArchivo(elegido, accept, hastaMb).then((aviso) =>
        setRevisado((antes) => (propio.current?.files?.[0] === elegido ? { archivo: elegido, aviso } : antes)),
      )
    },
    [accept, hastaMb, controlado],
  )

  // Se conecta al montar y no en un efecto: así toma también el archivo que se
  // eligió antes de que la página terminara de cargar, y se entera cuando el
  // formulario se vacía con `reset()` sin pasar por `onChange`.
  const conectar = React.useCallback(
    (input: HTMLInputElement | null) => {
      propio.current = input
      if (typeof ref === 'function') ref(input)
      else if (ref) ref.current = input
      if (!input) return
      setDelCampo(input.files?.[0] ?? null)
      revisarDelCampo(input.files?.[0] ?? null)
      const form = input.form
      const alVaciar = () => {
        input.setCustomValidity('')
        setDelCampo(null)
        setRevisado(null)
        setFalta(false)
      }
      form?.addEventListener('reset', alVaciar)
      return () => {
        form?.removeEventListener('reset', alVaciar)
        propio.current = null
        if (typeof ref === 'function') ref(null)
        else if (ref) ref.current = null
      }
    },
    [ref, revisarDelCampo],
  )

  // El que guarda la pantalla se mira por dentro aquí: solo para el envío, que
  // lo que dice la caja lo pone la pantalla.
  React.useEffect(() => {
    if (!controlado || !archivoDeLaPantalla) return
    let sigue = true
    void revisarArchivo(archivoDeLaPantalla, accept, hastaMb).then((aviso) => {
      if (sigue) setRevisado({ archivo: archivoDeLaPantalla, aviso })
    })
    return () => {
      sigue = false
    }
  }, [controlado, archivoDeLaPantalla, accept, hastaMb])

  const archivo = controlado ? archivoDeLaPantalla : delCampo
  const avisoPorDentro = archivo && revisado?.archivo === archivo ? revisado.aviso : null
  const noSirve = archivo ? avisoDeArchivo(archivo, accept, hastaMb) ?? avisoPorDentro : null

  // Si deja de ser obligatorio (la captura de la caja depende del tipo de
  // cuenta), el «Falta…» de un intento anterior no puede seguir trabando el envío.
  // Cuando la pantalla guarda el archivo, el campo se vacía al tocarlo y el
  // `required` del navegador no sabría que ya hay uno: «Falta…» sale de lo que
  // tiene la pantalla, y también que el que tiene no sirve —esas pantallas ya
  // no lo envían—. Así el navegador lo revisa en su orden, antes que los campos
  // de abajo, y no salta al primero vacío dejando el rojo fuera de la vista.
  React.useEffect(() => {
    const input = propio.current
    if (!input) return
    if (!required) input.setCustomValidity('')
    else if (controlado) {
      input.setCustomValidity(archivoDeLaPantalla ? (noSirve ? paraElGlobo(noSirve) : '') : faltaDe(principal))
    }
  }, [required, controlado, archivoDeLaPantalla, noSirve, principal])

  const aviso =
    avisoDeLaPantalla ||
    (archivo ? (controlado ? avisoDeArchivo(archivo, accept, hastaMb) : noSirve) : falta && required ? faltaDe(principal) : null)
  const limite = hastaMb ? `hasta ${hastaMb} MB` : ''
  const pie =
    aviso ??
    estado ??
    (archivo ? `${tamanoArchivo(archivo.size)} · toca para cambiarlo` : [tipo.formato, limite].filter(Boolean).join(', '))
  const invalido = invalidoDesdeAfuera === true || invalidoDesdeAfuera === 'true'
  const mal = Boolean(aviso) || invalido
  // Un campo opcional tiene que poder quedar vacío otra vez: la OC directa
  // decía «Quítalo para adjuntarlo después» y no había cómo. Donde la pantalla
  // guarda el archivo, lo vacía ella.
  const quitable = !required && !controlado && !disabled

  function quitar() {
    const input = propio.current
    if (!input) return
    input.value = ''
    // La pantalla se entera como si hubieran elegido «nada», y vacía lo que leyó.
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.focus()
  }
  // Mientras se lee o se sube todavía no se sabe si sirve: ni verde ni apagado.
  const ocupado = Boolean(estado) && !mal
  // Apagado mientras se lee o se sube, pero sin soltar el foco: un campo
  // `disabled` lo pierde, cae al <body> y Escape ya no cierra la ventana. Queda
  // enfocable y no abre nada ni acepta un archivo soltado encima.
  const quieto = Boolean(disabled) && ocupado

  return (
    <div
      className={cn(
        'group/archivo relative flex min-h-11 items-center gap-3 rounded-[var(--radius-base)] border px-3 py-2',
        archivo
          ? mal
            ? 'border-solid border-peligro bg-peligro-suave/40'
            : ocupado
              ? 'border-solid border-acento'
              : 'border-solid border-exito'
          : mal
            ? 'border-dashed border-peligro'
            : 'border-dashed border-borde-fuerte',
        // El campo de verdad es transparente: su anillo de foco (globals.css)
        // no se vería, así que lo lleva la caja, con el mismo grosor y color.
        'has-[input:focus-visible]:border-acento has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-anillo-foco',
        // Con aviso, el fondo rojo se queda aunque pase el ratón. Ocupado no se
        // apaga: «Subiendo…» se tiene que leer. Dentro de un `fieldset` trabado
        // (la ventana que envía) se apaga como los demás campos.
        disabled ? (ocupado ? 'cursor-progress' : 'opacity-60') : [!mal && 'hover:bg-superficie-2', !ocupado && 'has-[input:disabled]:opacity-60'],
        className,
      )}
    >
      <tipo.Icono
        aria-hidden
        className={cn('size-5 shrink-0', mal ? 'text-peligro' : ocupado ? 'text-acento' : archivo ? 'text-exito' : 'text-texto-tenue')}
      />
      <span id={idEstado} className="min-w-0 flex-1">
        <span className={cn('block text-sm font-medium wrap-anywhere', archivo ? 'text-texto' : 'text-acento')}>
          {archivo ? (
            archivo.name
          ) : texto || !tipo.queConRaton ? (
            principal
          ) : (
            // Por el puntero y no por el ancho: una tableta o un teléfono
            // acostado son anchos y también abren la cámara.
            <>
              <span className="pointer-fine:hidden">{tipo.que}</span>
              <span className="hidden pointer-fine:inline">{tipo.queConRaton}</span>
            </>
          )}
        </span>
        {/* Se anuncia al elegir: el aviso de «no es un Excel» llega también a quien no ve la caja. */}
        {pie && (
          <span aria-live="polite" className={cn('block text-xs', aviso ? 'text-peligro' : 'text-texto-tenue')}>
            <ConPuntero texto={pie} />
          </span>
        )}
      </span>
      <input
        ref={conectar}
        type="file"
        accept={accept || undefined}
        capture={capture}
        disabled={disabled && !quieto}
        aria-disabled={quieto || undefined}
        required={required && !controlado}
        aria-describedby={descrito ? `${descrito} ${idEstado}` : idEstado}
        aria-invalid={mal || undefined}
        aria-busy={ocupado || undefined}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed file:cursor-pointer aria-disabled:cursor-progress"
        onInvalid={(e) => {
          if (e.currentTarget.validity.valueMissing) e.currentTarget.setCustomValidity(faltaDe(principal))
          if (!archivo) setFalta(true)
          onInvalid?.(e)
        }}
        onClick={(e) => {
          if (quieto) {
            e.preventDefault()
            return
          }
          // Cuando la pantalla guarda el archivo, el campo se vacía al abrirse y
          // no al elegir: así sigue diciendo qué tiene elegido (el lector de
          // pantalla leía «No file chosen») y elegir el mismo otra vez avisa.
          if (controlado) e.currentTarget.value = ''
          onClick?.(e)
        }}
        onDragOver={(e) => {
          if (quieto) e.preventDefault()
        }}
        onDrop={(e) => {
          if (quieto) e.preventDefault()
        }}
        onChange={(e) => {
          e.currentTarget.setCustomValidity('')
          setFalta(false)
          setDelCampo(e.currentTarget.files?.[0] ?? null)
          revisarDelCampo(e.currentTarget.files?.[0] ?? null)
          onChange?.(e)
        }}
        {...props}
      />
      {quitable && archivo && (
        // Encima del campo transparente: tocarlo no abre el selector.
        <Boton
          type="button"
          variante="fantasma"
          tamano="sm"
          className="relative z-10 -my-1 shrink-0"
          aria-label={`Quitar ${archivo.name}`}
          onClick={quitar}
        >
          Quitar
        </Boton>
      )}
    </div>
  )
})
