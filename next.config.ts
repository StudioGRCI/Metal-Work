import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad para todas las respuestas.
 *
 * La aplicación maneja datos reales de la empresa y se abre desde el
 * teléfono en redes ajenas. Cada cabecera cierra una puerta concreta:
 *
 * - `Strict-Transport-Security`: el navegador no vuelve a entrar por HTTP.
 * - `X-Frame-Options` y `frame-ancestors`: nadie mete la aplicación en un
 *   marco de otra página para robar clics.
 * - `X-Content-Type-Options`: un archivo subido no se ejecuta como script
 *   por adivinar su tipo.
 * - `Referrer-Policy`: la dirección de una orden (con su id) no viaja a
 *   los sitios externos que se abran desde ella.
 * - `Permissions-Policy`: la aplicación no pide cámara, micrófono ni
 *   ubicación, así que se declaran cerrados.
 * - La política de contenido no restringe `script-src`: Next mete guiones en
 *   línea que exigirían un nonce por petición, y romperlos a ciegas deja la
 *   pantalla en blanco. Sí cierra lo que no cuesta nada: marcos, objetos,
 *   `base` y formularios hacia otros dominios.
 */
const CABECERAS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
]

const nextConfig: NextConfig = {
  // El motor del PDF arma las fuentes leyendo archivos del propio paquete; si
  // el empaquetador lo mete dentro del bundle del servidor, esos archivos ya no
  // están donde los busca y la cotización no se genera.
  serverExternalPackages: ['@react-pdf/renderer'],
  // Sin esto la respuesta anuncia «Next.js» a cualquiera que mire las cabeceras.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: CABECERAS }]
  },
};

export default nextConfig;
