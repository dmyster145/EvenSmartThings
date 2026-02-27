# Even SmartThings

**Control SmartThings from your Even Realities G2 glasses.** Browse scenes, rooms, and devices in a list, then tap to run or control. Configure your token, list order, favorites, custom names, and stats visibility in the Even App config panel.

This project is licensed under the MIT License — see [LICENSE](LICENSE).

### Screenshots

| Config panel | Main menu (Favorites) | Scenes |
|--------------|------------------------|--------|
| [![Config panel](screenshots/config.png)](screenshots/config.png) | [![Main menu](screenshots/main-screen.png)](screenshots/main-screen.png) | [![Scenes](screenshots/scenes.png)](screenshots/scenes.png) |

| Favorites list | Rooms | Devices (lights) |
|-----------------|-------|-------------------|
| [![Favorites](screenshots/favorites.png)](screenshots/favorites.png) | [![Rooms](screenshots/rooms.png)](screenshots/rooms.png) | [![Devices lights](screenshots/devices-lights.png)](screenshots/devices-lights.png) |

| Device: motion sensor | Device: dimming |
|------------------------|------------------|
| [![Motion sensor](screenshots/devices-motion-sensor.png)](screenshots/devices-motion-sensor.png) | [![Dimming](screenshots/devices-dimming.png)](screenshots/devices-dimming.png) |

*Config panel:* list order, stats visibility (including **All** toggle), favorites, custom names, token, and documentation. *On the glasses:* main menu (Scenes, Devices, and Favorites when favorites exist), scene list with SmartThings statuses, favorites list, rooms, device lists, device detail (e.g. motion sensor with battery/temperature), and dimming control.

---

## Features

- **Scenes** — Run any scene with one tap.
- **Devices** — Browse by room; tap to turn on/off or adjust dim level.
- **Favorites** — One list mixing scenes and devices; you choose what’s in it and the order.
- **Rooms** — Navigate by room, then control devices or run room actions.
- **Config panel** — Set your token, list order (alphabetical, reverse, or custom), which stats show on the glasses, favorites, and custom display names in the Even App.
- **Gesture navigation** — Single tap to select, double tap to go back, triple tap to jump to the last page.
- **G2-native UI** — List on the left, confirmation and stats on the right; scroll and tap drive everything.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Runtime | TypeScript, Vite 7 |
| Glasses | [Even Hub SDK](https://www.npmjs.com/package/@evenrealities/even_hub_sdk) (G2) |
| SmartThings | [SmartThings Core SDK](https://www.npmjs.com/package/@smartthings/core-sdk) |
| Node requirement | 20.19+ (LTS) or 22.12+ |

---

## Project structure

```
├── index.html          # Even App config UI (PAT form, list order, stats, favorites, renames) + “Open in Even App” fallback
├── src/
│   ├── bootstrap.ts    # Polyfills (Buffer, util) then main
│   ├── main.ts         # App bootstrap
│   ├── app.ts          # PAT storage, SmartThings client, G2 setup, events, display updates
│   ├── evenhub/
│   │   └── bridge.ts   # Even Hub SDK bridge (init, setupPage, updateText, updateBoardImage, storage)
│   ├── input/
│   │   └── actions.ts  # Map Even Hub events to app tap actions
│   ├── render/
│   │   ├── composer.ts # G2 page layout (list + confirmation + stats containers)
│   │   ├── icon-data.ts   # Confirmation/status images (thumbs up/down/partial) + BMP/PNG conversion
│   │   └── bmp-constants.ts
│   ├── state/          # Redux-style store, contracts, reducer, selectors, constants
│   ├── crypto/
│   │   └── pat-storage.ts  # Encrypted PAT persistence
│   └── debug-log.ts
├── public/             # Static assets and doc.html
└── package.json
```

---

## Prerequisites

- **SmartThings** — An account and a [Personal Access Token (PAT)](https://account.smartthings.com/tokens) with:
  - **Scenes:** Read all scenes, Execute all scenes  
  - **Devices:** Read all devices, Execute all device commands  
  - **Locations:** Read all locations (for rooms)
- **Even Realities** — G2 glasses and the Even App (to open the widget so it appears on your glasses).
- **Node.js** — v20.19+ (LTS) or v22.12+.

---

## Setup

1. **Clone and install**

   ```bash
   git clone https://github.com/dmyster145/EvenSmartThings.git
   cd EvenSmartThings
   npm install
   ```

2. **Use a supported Node version**

   ```bash
   nvm use
   ```

   If you do not use `nvm`, make sure `node -v` is `20.19+` or `22.12+`.

3. **Run locally**

   ```bash
   npm run dev
   ```

4. **Open in the Even App**

   - Use [EvenHub CLI](https://www.npmjs.com/package/@evenrealities/evenhub-cli): run `npx @evenrealities/evenhub-cli qr` and scan with the Even App, or  
   - Open the dev URL (e.g. `http://<your-ip>:5173`) in the Even App’s in-app browser.

5. **Configure your token**

   - On first load, the config panel asks for your SmartThings **Personal Access Token**.
   - Paste your PAT and tap **Save**; the app reloads and loads your scenes, devices, and rooms.
   - The token is stored on this device only (encryption optional).

---

## Usage on the glasses

- **Scroll** — Move the highlight in the list.
- **Tap** — Run or open the selected action: run a scene, open a room/device, toggle on/off, or change dim level.
- **Page controls** — Highlight `← Previous` / `Next →` and tap to move between pages.
- **Shortcuts** — Double tap to go back; triple tap to jump to the last page when available.
- The right side shows confirmation and stats (choose which stats in the config panel).

---

## Config panel (web)

Open the app in the Even App to configure:

- **List order** — Home, Scenes, Rooms, Devices, Favorites: alphabetical, reverse, or custom (reorder with Up/Down).
- **Stats visibility** — Choose which stats show on the glasses (e.g. total devices, online/offline, type, on/off, brightness).
- **Favorites** — Add scenes and devices to one “Favorites” list on the glasses.
- **Custom names** — Override display names for scenes, rooms, or devices (this app only).
- **SmartThings token** — Set or delete your PAT (section is above Documentation).
- **Documentation** — Link to in-app docs (`doc.html`).

If you open the URL in a regular browser, you will see the **Open in Even App** panel.

---

## Build and deploy

```bash
npm run build
```

Output is in `dist/`. Deploy that folder to any static host, then open the deployed URL in the Even App to use the widget in production.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | TypeScript build + Vite production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint on `src/` |

---

## License

MIT — see [LICENSE](LICENSE).
