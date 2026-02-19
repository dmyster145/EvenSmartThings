# Even SmartThings

SmartThings scene widget for Even Realities G2 glasses. Browse and run your SmartThings scenes from the glasses using a 4×2 tile grid (scroll to select, tap to execute).

## Structure

- `src/` — Source code
  - `app.ts` — Entry flow: PAT, SmartThings client, G2 setup, events, display updates
  - `evenhub/bridge.ts` — Even Hub SDK bridge (init, setupPage, updateText, updateBoardImage, getLocalStorage, setLocalStorage)
  - `state/` — Store, contracts, reducer, selectors, constants
  - `input/actions.ts` — Map SDK text/sys events to SCROLL / TAP
  - `render/composer.ts` — G2 page layout (1 text + 2 image containers)
  - `render/tilerenderer.ts` — Paints 8 scene tiles as two 200×100 BMP images
- `index.html` — Config panel (PAT form) and “Open in Even App” message

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Run locally**

   ```bash
   npm run dev
   ```

3. **Open in Even App**

   - Use [EvenHub CLI](https://www.npmjs.com/package/@evenrealities/evenhub-cli): `npx evenhub qr` and scan with the Even App.
   - Or open the dev URL (e.g. `http://<your-ip>:5173`) in the Even App’s browser.

4. **Configure token**

   - On first run (in Even App), the config panel asks for your SmartThings **Personal Access Token** (PAT).
   - Create a PAT at [SmartThings](https://account.smartthings.com/tokens) with **Scenes: Read all scenes** and **Scenes: Execute all scenes**.
   - Enter it and tap **Save**; the app reloads and loads your scenes.

## Usage on G2

- **Scroll** — Move the highlight between tiles (and across pages when at the top/bottom).
- **Tap** — Run the selected scene.
- Status and current scene name appear in the text area on the right.

## Build

```bash
npm run build
```

Output is in `dist/`. Deploy that folder to any static host; point the Even App at your deployed URL to use the widget in production.

## License

Private. See project terms.
