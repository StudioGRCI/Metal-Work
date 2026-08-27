import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El motor del PDF arma las fuentes leyendo archivos del propio paquete; si
  // el empaquetador lo mete dentro del bundle del servidor, esos archivos ya no
  // están donde los busca y la cotización no se genera.
  serverExternalPackages: ['@react-pdf/renderer'],
};

export default nextConfig;
