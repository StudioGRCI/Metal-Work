import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worktrees de los auditores (skill `auditar`): no son código del proyecto.
    ".claude/worktrees/**",
  ]),
  // La letra más chica del sistema es de 12 px (`text-xs`): decisión de DKS del
  // 2026-11-25, skill `diseno` › Texto. Corta `text-[11px]` y `text-[0.7rem]` en
  // un literal o en una plantilla. No ve un `style={{ fontSize }}` ni el CSS:
  // hoy no hay ninguno en pantallas (los de `src/lib/documentos` son PDF). Las
  // excepciones —la burbuja del contador, el glifo «i» y el formato de salida
  // que se imprime— llevan su permiso escrito al lado.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...["Literal[value=", "TemplateElement[value.raw="].map((nodo) => ({
          selector: `${nodo}/text-\\[(?:length:)?(?:(?:[0-9]|1[01])(?:\\.[0-9]+)?px|0?\\.(?:[0-6][0-9]*|7|7[0-4][0-9]*)r?em)\\]/]`,
          message: "La letra más chica es de 12 px: usa text-xs (skill diseno › Texto).",
        })),
      ],
    },
  },
  // El formato de salida de almacén se imprime y se firma: ahí el tamaño es
  // parte del formato de la casa.
  {
    files: ["src/app/(app)/almacen/movimientos/*/formato/**"],
    rules: { "no-restricted-syntax": "off" },
  },
]);

export default eslintConfig;
