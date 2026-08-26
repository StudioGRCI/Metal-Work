/**
 * Marca de Metal Work: el emblema MW enmarcado con la palabra debajo.
 *
 * Está dibujado en vectores para que se vea nítido en cualquier tamaño y en
 * cualquier pantalla. Si administración envía el archivo original de la marca,
 * se reemplaza solo este componente y el resto del sistema no se entera.
 */

const AZUL = '#123B6D'
const ROJO = '#C4192E'

type Variante = 'color' | 'claro'

export function LogoMetalWork({
  variante = 'color',
  className,
}: {
  variante?: Variante
  className?: string
}) {
  const claro = variante === 'claro'
  const trazo = claro ? '#ffffff' : AZUL
  const marco = claro ? '#ffffff' : ROJO
  const relleno = claro ? 'none' : '#ffffff'

  return (
    <svg
      viewBox="0 0 260 132"
      role="img"
      aria-label="Metal Work"
      className={className}
      fill="none"
    >
      {/* Marco del emblema */}
      <rect
        x="47"
        y="4"
        width="166"
        height="70"
        rx="10"
        fill={relleno}
        stroke={marco}
        strokeWidth="5"
      />

      {/* Monograma: la M y la W se cruzan, como en la marca del taller. */}
      <g strokeWidth="13" strokeLinejoin="miter" strokeLinecap="butt" fill="none">
        {/* La M y la W comparten el trazo del medio, que es lo que le da el cruce. */}
        <path d="M82 62 V24 L108 54 L134 24 V62" stroke={trazo} />
        <path d="M126 16 V54 L152 24 L178 54 V16" stroke={ROJO} />
      </g>

      {/* Palabra */}
      <text
        x="130"
        y="106"
        textAnchor="middle"
        fontFamily="var(--font-sans, system-ui), sans-serif"
        fontSize="27"
        fontWeight="800"
        letterSpacing="3"
        fill={trazo}
      >
        METAL WORK
      </text>

      {/* Filo con el remate rojo */}
      <path d="M28 120 H214" stroke={trazo} strokeWidth="4" strokeLinecap="round" />
      <path d="M214 120 H232" stroke={ROJO} strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}
