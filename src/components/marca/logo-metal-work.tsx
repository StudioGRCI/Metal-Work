import Image from 'next/image'

import logoOscuro from '../../../public/marca/logo-metal-work.png'
import logoClaro from '../../../public/marca/logo-metal-work-claro.png'

/**
 * La marca de la empresa, tal como la usa administración.
 *
 * Vienen dos archivos porque el logotipo es azul institucional: sobre blanco se
 * lee, sobre la pantalla oscura o sobre la foto del taller no. El de fondos
 * oscuros lleva el azul en blanco y conserva el rojo, que es lo que mantiene
 * reconocible la marca.
 *
 * Con `variante="auto"` se muestran los dos y decide el CSS según el tema, sin
 * pasar por JavaScript: así no hay parpadeo ni desajuste al hidratar.
 * Con `variante="claro"` se fuerza el de fondos oscuros, que es lo que hace
 * falta en la pantalla de ingreso, donde el fondo es siempre la foto.
 *
 * Si algún día cambia el logotipo se reemplazan los archivos en `public/marca`
 * y todas las pantallas quedan al día sin tocar código.
 */
export function LogoMetalWork({
  className,
  variante = 'auto',
}: {
  className?: string
  variante?: 'auto' | 'claro'
}) {
  const alt = 'Metal Work Perú'

  if (variante === 'claro') {
    return <Image src={logoClaro} alt={alt} priority className={className} sizes="260px" />
  }

  return (
    <>
      <Image
        src={logoOscuro}
        alt={alt}
        priority
        className={`marca-en-fondo-claro ${className ?? ''}`}
        sizes="260px"
      />
      <Image
        src={logoClaro}
        alt=""
        aria-hidden
        priority
        className={`marca-en-fondo-oscuro ${className ?? ''}`}
        sizes="260px"
      />
    </>
  )
}
