# Debug Session: wallet-testflight-open
- **Status**: [OPEN]
- **Issue**: En TestFlight el flujo de Apple Wallet genera el `.pkpass`, pero no abre la UI nativa de Cartera y termina ofreciendo compartir el archivo.
- **Debug Server**: `http://192.168.1.131:7777/event`
- **Log File**: `.dbg/trae-debug-log-wallet-testflight-open.ndjson`

## Reproduction Steps
1. Instalar la app desde TestFlight en un iPhone.
2. Abrir la pantalla `Mis entradas`.
3. Pulsar `Añadir a Wallet`.
4. Observar si aparece la UI nativa de Cartera o si solo se comparte/abre el archivo `.pkpass`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | El cliente iOS sigue entrando en una ruta de archivo/compartir en vez de usar el bridge nativo de PassKit. | High | Med | Rejected |
| B | El módulo nativo `ExpoPasskite` no está enlazado o no está disponible en la build de TestFlight. | High | Med | Rejected |
| C | El plugin/entitlements de PassKit no se están aplicando correctamente en el binario iOS distribuido. | Med | Med | Rejected for current build config |
| D | La build de TestFlight sí invoca el bridge nativo, pero `PKAddPassesViewController` falla por el contenido del pass o por cómo se entrega la base64 al módulo. | Med | High | Confirmed |
| E | Existe otra implementación paralela en el proyecto que vuelve a guardar/compartir el `.pkpass` y eclipsa el flujo nativo esperado. | Med | Low | Rejected in current repo |

## Log Evidence
- `expo config --type introspect` incluye `com.apple.developer.pass-type-identifiers = ["$(TeamIdentifierPrefix)*"]`.
- Instrumentación añadida en `app/(tabs)/tickets.tsx` y `lib/passkite.ts` para registrar:
  - entorno de ejecución (`executionEnvironment`)
  - versión y build nativa
  - disponibilidad del módulo `ExpoPasskite`
  - resultados de `isPassLibraryAvailable`, `canAddPasses` y `addPassToWallet`
- La reproducción reportada por el usuario en TestFlight sigue mostrando compartir `.pkpass`.
- El flujo actual del repo en `app/(tabs)/tickets.tsx` no contiene fallback iOS a `FileSystem`, `Linking.openURL(file://...)` ni `Sharing.shareAsync(...)` para Wallet; solo invoca `addPassToWallet(...)`.
- Evidencia runtime capturada desde la app:
  - `hasNativeModule: true`
  - `isPassLibraryAvailable: true`
  - `canAddPasses: true`
  - `addPassToWallet -> success: false`
  - `error: "Failed to parse pass data: The pass cannot be read because it isn’t valid."`
- Logs de Supabase confirman desalineación entre el certificado y el `pass.json`:
  - certificado firmante: `Pass Type ID: pass.com.eclipse.ticket`
  - OU del certificado: `HKC36224LZ`
  - `pass.json` generado antes del fix: `passTypeIdentifier = "tu.identificador.de.pase"` y `teamIdentifier = "TU_TEAM_ID"`
- Se desplegó un fix en `apple-wallet-generator` para resolver automáticamente `passTypeIdentifier` y `teamIdentifier` desde el certificado cuando los secretos contienen placeholders.

## Verification Conclusion
- Se confirman `B` y `C` como resueltas para la build actual: el módulo nativo existe y Wallet está disponible.
- Se rechaza la hipótesis de share-sheet como causa principal del estado actual; el sistema entra en PassKit nativo.
- Causa raíz confirmada: el `.pkpass` se estaba firmando con un certificado cuyo `Pass Type ID` y `Team ID` no coincidían con los valores inyectados en `pass.json`, por lo que Apple lo marcaba como inválido.
- Fix desplegado: usar identidad real del certificado cuando `APPLE_PASS_TYPE_ID` / `APPLE_TEAM_ID` vienen mal configurados en secretos.
