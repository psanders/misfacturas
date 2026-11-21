# Mis Facturas — Instalación del servidor / Server setup

- [Español](#español)
- [English](#english)

---

## Español

Esto se hace **una sola vez**, en una computadora, con la cuenta de Google que va a guardar los datos.
Toma unos 15 minutos. Los archivos que necesita están en la carpeta `apps-script/` del proyecto:
`Code.gs` y `appsscript.json`.

### 1. Crear la hoja de cálculo

1. Entre a <https://sheets.google.com> y cree una hoja en blanco.
2. Póngale de nombre **Mis Facturas — Datos** (arriba a la izquierda).

No cree pestañas a mano: el paso 4 las crea todas.

### 2. Abrir Apps Script

1. En la hoja, vaya a **Extensiones → Apps Script**. Se abre el editor en otra pestaña.
2. Arriba a la izquierda, cambie el nombre del proyecto ("Proyecto sin título") a **Mis Facturas**.

### 3. Pegar el código

1. En el editor hay un archivo `Código.gs` (o `Code.gs`). Borre todo lo que tiene y pegue el contenido completo de `apps-script/Code.gs`. Guarde (ícono de disquete o Ctrl/Cmd + S).
2. Haga visible el manifiesto: menú de la izquierda **⚙ Configuración del proyecto** (Project Settings) → marque **Mostrar el archivo de manifiesto "appsscript.json" en el editor**.
3. Vuelva al **Editor** (ícono `< >`). Ahora aparece `appsscript.json`. Ábralo, borre todo y pegue el contenido de `apps-script/appsscript.json`. Guarde.

### 4. Ejecutar `setup()` una vez

1. En la barra de arriba del editor, en la lista de funciones, elija **setup** y pulse **Ejecutar**.
2. La primera vez Google pide permiso: **Revisar permisos** → elija su cuenta → si sale "Google no ha verificado esta app", pulse **Configuración avanzada → Ir a Mis Facturas (no seguro)** → **Permitir**.
   Es su propio script; los permisos son para leer/escribir **esta** hoja y crear la carpeta de fotos en su Drive.
3. Al terminar, abajo se ve el **Registro de ejecución** con una línea así:

   `Nueva clave de la hoja / New SHEET_KEY: mango-playa-nube-47`

   Esa es la **clave de la hoja**. Anótela en un lugar seguro: se escribe una vez en cada iPad/teléfono.

`setup()` crea las pestañas `Suplidores`, `Facturas`, `Pagos`, `Caja`, `Usuarios` e `Historial` con sus encabezados.
Puede borrar la pestaña vacía que traía la hoja ("Hoja 1"). Si ejecuta `setup()` otra vez no cambia nada de lo que ya existe
(ni los datos ni la clave).

**Cambiar la clave más adelante:** **⚙ Configuración del proyecto → Propiedades de la secuencia de comandos** (Script Properties) → edite el valor de `SHEET_KEY` → **Guardar**.
Todos los equipos dejarán de sincronizar y pedirán la clave nueva una vez. No toque `PHOTO_FOLDER_ID` (lo crea el script solo).

### 5. Poner los nombres en `Usuarios`

La pestaña **Usuarios** trae tres filas de ejemplo:

| id | name | active |
|---|---|---|
| U-001 | Mamá | TRUE |
| U-002 | Admin | TRUE |
| U-003 | Primo | TRUE |

- Cambie solo la columna **name** por los nombres reales (lo que se verá en el botón "¿Quién es usted?").
- **No cambie los `id`** de filas ya usadas: quedan guardados en cada cambio (`createdBy`, `updatedBy`, `Historial`).
- Para agregar a alguien: nueva fila con un id nuevo (`U-004`) y `TRUE` en **active**.
- Para quitar a alguien: ponga `FALSE` en **active**. Ya no aparece al instalar la app y el servidor rechaza sus cambios. No borre la fila.

### 6. Publicar como aplicación web

1. Arriba a la derecha: **Implementar → Nueva implementación** (Deploy → New deployment).
2. En el engranaje junto a "Seleccionar tipo", elija **Aplicación web**.
3. Descripción: `Mis Facturas`. **Ejecutar como: Yo** (su cuenta). **Quién tiene acceso: Cualquier usuario** (Anyone).
4. **Implementar**. Copie la **URL de la aplicación web**; termina en `/exec`. Esa URL es la que usa la app.

"Cualquier usuario" es necesario para que la app pueda llamar al script sin iniciar sesión en Google. Sin la clave de la hoja,
el script no entrega ni guarda nada.

**Al actualizar `Code.gs` más adelante:** pegue el código nuevo, guarde, y vaya a **Implementar → Administrar implementaciones** →
lápiz (editar) → en **Versión** elija **Nueva versión** → **Implementar**. Así la URL `/exec` sigue siendo la misma.
(Si usa "Nueva implementación" otra vez, sale una URL distinta y habría que cambiarla en todos los equipos.)

### 7. Compartir la hoja

Puede compartir la hoja **solo para ver** con quien quiera (Compartir → Lector). La clave no está en ninguna celda: vive en las
Propiedades del script, que solo ve el dueño. No dé permiso de **editor** a nadie que no deba ver el código ni la clave
(un editor de la hoja puede abrir Apps Script).

Las fotos de las facturas quedan en su Drive, en la carpeta **Mis Facturas — Fotos**.

### 8. Publicar la app / Publishing the app

La app es una página web estática (carpeta `app/dist`). Necesita HTTPS; GitHub Pages o Netlify son gratis.

1. Instale Node 22. En la carpeta `app/`: `npm install`.
2. Copie `app/.env.example` a `app/.env.local` y ponga la dirección `/exec` del paso 6 en `VITE_API_URL`.
   (Si la deja vacía, la app la pide al empezar, o use el enlace `https://<su-app>/#setup=<dirección /exec>`.)
3. `npm run build` → suba el contenido de `app/dist/` a GitHub Pages o Netlify.
4. Para probar sin la hoja: abra `https://<su-app>/?demo` (datos de ejemplo, solo en ese equipo).
5. En el iPad: abra la dirección en Safari → Compartir → **Agregar a pantalla de inicio**. Abra la app desde el ícono,
   toque **Empezar**, escriba la clave de la hoja (`SHEET_KEY`), escoja su nombre y cree un PIN de 4 números.

Cada persona crea su PIN en cada equipo. Si lo olvida (o se equivoca 5 veces), entra otra vez con la clave de la hoja y crea otro.

---

## English

Do this **once**, on a computer, signed in to the Google account that will own the data. It takes about 15 minutes.
You need two files from the project's `apps-script/` folder: `Code.gs` and `appsscript.json`.

### 1. Create the spreadsheet

1. Go to <https://sheets.google.com> and create a blank spreadsheet.
2. Name it **Mis Facturas — Datos** (top left).

Don't create tabs by hand: step 4 creates them all.

### 2. Open Apps Script

1. In the spreadsheet: **Extensions → Apps Script**. The editor opens in a new tab.
2. Top left, rename the project ("Untitled project") to **Mis Facturas**.

### 3. Paste the code

1. The editor has a file `Code.gs`. Delete its contents and paste the whole of `apps-script/Code.gs`. Save (disk icon or Ctrl/Cmd + S).
2. Show the manifest: left sidebar **⚙ Project Settings** → tick **Show "appsscript.json" manifest file in editor**.
3. Back in the **Editor** (`< >` icon), open `appsscript.json`, replace its contents with `apps-script/appsscript.json`, and save.

### 4. Run `setup()` once

1. In the toolbar's function list pick **setup** and click **Run**.
2. Google asks for permission the first time: **Review permissions** → pick your account → if you see "Google hasn't verified this app",
   click **Advanced → Go to Mis Facturas (unsafe)** → **Allow**. It's your own script; the permissions cover reading/writing
   **this** spreadsheet and creating the photo folder in your Drive.
3. The **Execution log** at the bottom shows a line like:

   `Nueva clave de la hoja / New SHEET_KEY: mango-playa-nube-47`

   That is the **sheet key**. Keep it somewhere safe: it is typed once on each iPad/phone.

`setup()` creates the `Suplidores`, `Facturas`, `Pagos`, `Caja`, `Usuarios` and `Historial` tabs with their headers. You can delete
the empty default tab ("Sheet1"). Running `setup()` again changes nothing that already exists (data or key).

**Changing the key later:** **⚙ Project Settings → Script Properties** → edit the `SHEET_KEY` value → **Save**. Every device stops
syncing and asks for the new key once. Leave `PHOTO_FOLDER_ID` alone (the script manages it).

### 5. Set the names in `Usuarios`

The **Usuarios** tab starts with three sample rows: `U-001 Mamá`, `U-002 Admin`, `U-003 Primo`, all `TRUE`.

- Change only the **name** column to real names (shown on the "¿Quién es usted?" buttons).
- **Don't change the `id`** of a row that has been used: it is stored with every change (`createdBy`, `updatedBy`, `Historial`).
- To add someone: a new row with a new id (`U-004`) and `TRUE` in **active**.
- To remove someone: set **active** to `FALSE`. They disappear from onboarding and the server rejects their changes. Don't delete the row.

### 6. Deploy as a web app

1. Top right: **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Description `Mis Facturas`. **Execute as: Me**. **Who has access: Anyone**.
4. **Deploy**, then copy the **Web app URL** (ends in `/exec`). The app uses this URL.

"Anyone" is required so the app can call the script without a Google sign-in. Without the sheet key the script returns and stores nothing.

**When you update `Code.gs` later:** paste the new code, save, then **Deploy → Manage deployments** → pencil (edit) → **Version: New version**
→ **Deploy**. The `/exec` URL stays the same. (Another "New deployment" creates a different URL that every device would need.)

### 7. Sharing the spreadsheet

You can share the spreadsheet **view-only** with anyone (Share → Viewer). The key is not in any cell; it lives in Script Properties,
which only the owner sees. Don't give **edit** access to anyone who shouldn't see the code or the key (sheet editors can open Apps Script).

Invoice photos are stored in your Drive, in the folder **Mis Facturas — Fotos**.

### 8. Publicar la app / Publishing the app

The app is a static site (`app/dist`). It needs HTTPS; GitHub Pages or Netlify are free.

1. Install Node 22. In `app/`: `npm install`.
2. Copy `app/.env.example` to `app/.env.local` and set `VITE_API_URL` to the `/exec` URL from step 6.
   (If left empty, the app asks for it during onboarding, or use the link `https://<your-app>/#setup=<exec URL>`.)
3. `npm run build` → upload the contents of `app/dist/` to GitHub Pages or Netlify.
4. To try it without the Sheet: open `https://<your-app>/?demo` (sample data, on that device only).
5. On the iPad: open the URL in Safari → Share → **Add to Home Screen**. Open the app from the icon, tap **Empezar**,
   enter the sheet password (`SHEET_KEY`), pick a name and create a 4-digit PIN.

Each person creates a PIN on each device. Forgot it (or 5 wrong tries) → sign in again with the sheet password and create a new one.

Development: `npm run dev`, `npm test` (unit + end-to-end sync against `apps-script/Code.gs` on mocks), `npm run build`.
Backend tests: `node --test apps-script/test/code.test.js` from the repo root.
