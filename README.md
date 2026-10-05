# Gestión de Citas (Apps Script + Firestore)

Web app en Google Apps Script para reservar y administrar citas de un negocio de servicios.
Los datos viven en Firebase Firestore (acceso REST con cuenta de servicio).

## Estructura
- `Index.html` + `JavaScriptPublic.html` + `StylesIndex.html`: página pública de reservas.
- `Admin.html` + `Admin*.html`: panel de administración (`?page=admin`).
- `Código.js`: routing, utilidades, caché, reportes.
- `FirebaseService.js`: autenticación JWT y CRUD genérico de Firestore.
- `DataService.js`, `CitasService.js`, `AgendaService.js`: lógica de negocio.

## Configuración
Script Properties requeridas: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.

## Despliegue
Con [clasp](https://github.com/google/clasp): `clasp push` y luego desplegar como web app.
