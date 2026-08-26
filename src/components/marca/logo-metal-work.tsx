import Image from 'next/image'

import logo from '../../../public/marca/logo-metal-work.png'

/**
 * La marca de la empresa, tal como la usa administración.
 *
 * El archivo vive en `public/marca`: si algún día cambia, se reemplaza ahí y
 * todas las pantallas quedan al día sin tocar código.
 */
export function LogoMetalWork({ className }: { className?: string }) {
  return (
    <Image
      src={logo}
      alt="Metal Work Perú"
      priority
      className={className}
      sizes="(max-width: 640px) 200px, 260px"
    />
  )
}
