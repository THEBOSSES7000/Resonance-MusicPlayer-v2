import { updateTitleMarquee } from './audioPlayer.js';

export function initResizers() {
  const resizerLeft = document.getElementById('resizer-left');
  const resizerRight = document.getElementById('resizer-right');
  const resizerBottom = document.getElementById('resizer-bottom');
  const bottomPlayer = document.getElementById('bottom-player');
  const lockResizingInput = document.getElementById('lock-panel-resizing');
  const root = document.documentElement;
  const storedDimensions = [
    { key: 'pn_sidebar_left_width', property: '--sidebar-left-width', min: 180, max: 400 },
    { key: 'pn_sidebar_right_width', property: '--sidebar-right-width', min: 220, max: 460 },
    { key: 'pn_player_height', property: '--player-height', min: 84, max: 180 }
  ];

  storedDimensions.forEach(({ key, property, min, max }) => {
    const stored = Number(localStorage.getItem(key));
    if (!Number.isFinite(stored) || stored <= 0) return;
    const value = Math.max(min, Math.min(max, stored));
    root.style.setProperty(property, `${value}px`);
  });

  let resizingLocked = localStorage.getItem('pn_panel_resizing_locked') === 'true';
  if (lockResizingInput) {
    lockResizingInput.checked = resizingLocked;
    lockResizingInput.addEventListener('change', () => {
      resizingLocked = lockResizingInput.checked;
      localStorage.setItem('pn_panel_resizing_locked', String(resizingLocked));
      root.dataset.resizingLocked = String(resizingLocked);
    });
  }
  root.dataset.resizingLocked = String(resizingLocked);

  const persistDimension = (key, value) => localStorage.setItem(key, String(value));

  resizerLeft.addEventListener('mousedown', (e) => {
    if (resizingLocked) return;
    e.preventDefault();
    document.body.classList.add('resizing-x');
    const onMove = (ev) => {
      let w = Math.max(180, Math.min(400, ev.clientX));
      document.documentElement.style.setProperty('--sidebar-left-width', `${w}px`);
      persistDimension('pn_sidebar_left_width', w);
      updateTitleMarquee();
    };
    const onUp = () => {
      document.body.classList.remove('resizing-x');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      updateTitleMarquee();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  resizerRight.addEventListener('mousedown', (e) => {
    if (resizingLocked) return;
    e.preventDefault();
    document.body.classList.add('resizing-x');
    const onMove = (ev) => {
      let w = Math.max(220, Math.min(460, window.innerWidth - ev.clientX));
      document.documentElement.style.setProperty('--sidebar-right-width', `${w}px`);
      persistDimension('pn_sidebar_right_width', w);
      updateTitleMarquee();
    };
    const onUp = () => {
      document.body.classList.remove('resizing-x');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      updateTitleMarquee();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  resizerBottom.addEventListener('mousedown', (e) => {
    if (resizingLocked) return;
    e.preventDefault();
    document.body.classList.add('resizing-y');
    const onMove = (ev) => {
      const minimumHeight = Math.max(84, parseFloat(getComputedStyle(bottomPlayer).minHeight) || 84);
      let h = Math.max(minimumHeight, Math.min(180, window.innerHeight - ev.clientY));
      document.documentElement.style.setProperty('--player-height', `${h}px`);
      persistDimension('pn_player_height', h);
    };
    const onUp = () => {
      document.body.classList.remove('resizing-y');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // --- Columnas de listas de música (sin MutationObserver: evita freeze) ---
  const lockMusicColumnsInput = document.getElementById('lock-music-columns');
  let musicColumnsLocked = localStorage.getItem('pn_music_columns_locked');
  if (musicColumnsLocked === null) musicColumnsLocked = 'true';
  musicColumnsLocked = musicColumnsLocked === 'true';

  const FR_MIN = 0.6;

  const loadFr = (key, fallback) => {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n >= FR_MIN ? n : fallback;
  };

  const applyStoredMusicColumns = () => {
    const hasCustom =
      localStorage.getItem('pn_music_col_title_fr') != null ||
      localStorage.getItem('pn_music_col_album_fr') != null ||
      localStorage.getItem('pn_music_col_date_fr') != null;
    root.dataset.musicColsCustom = hasCustom ? 'true' : 'false';
    if (!hasCustom) return;
    // Importante: incluir unidad "fr" para que el grid sea válido
    root.style.setProperty('--pt-title-fr', `${loadFr('pn_music_col_title_fr', 2.5)}fr`);
    root.style.setProperty('--pt-album-fr', `${loadFr('pn_music_col_album_fr', 1.8)}fr`);
    root.style.setProperty('--pt-date-fr', `${loadFr('pn_music_col_date_fr', 1.2)}fr`);
  };
  applyStoredMusicColumns();

  function ensureMusicColumnHandles() {
    const header = document.querySelector('.playlist-table-header');
    if (!header) return;

    header.querySelectorAll('.col-resize-handle').forEach(h => h.remove());
    if (musicColumnsLocked) return;

    const attach = (selector, pair) => {
      const cell = header.querySelector(selector);
      if (!cell || cell.querySelector('.col-resize-handle')) return;
      const handle = document.createElement('div');
      handle.className = 'col-resize-handle';
      handle.dataset.pair = pair;
      handle.title = 'Arrastrar para ajustar columnas';
      cell.appendChild(handle);

      handle.addEventListener('mousedown', (e) => {
        if (musicColumnsLocked) return;
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        let titleFr = loadFr('pn_music_col_title_fr', 2.5);
        let albumFr = loadFr('pn_music_col_album_fr', 1.8);
        let dateFr = loadFr('pn_music_col_date_fr', 1.2);
        const total = titleFr + albumFr + dateFr;

        document.body.classList.add('resizing-music-columns');
        root.dataset.musicColsCustom = 'true';

        const onMove = (ev) => {
          const headerWidth = Math.max(400, header.getBoundingClientRect().width || 800);
          const delta = ((ev.clientX - startX) / headerWidth) * total;
          if (pair === 'title-album') {
            let t = Math.max(FR_MIN, titleFr + delta);
            let a = Math.max(FR_MIN, albumFr - delta);
            root.style.setProperty('--pt-title-fr', `${t}fr`);
            root.style.setProperty('--pt-album-fr', `${a}fr`);
          } else if (pair === 'album-date') {
            let a = Math.max(FR_MIN, albumFr + delta);
            let d = Math.max(FR_MIN, dateFr - delta);
            root.style.setProperty('--pt-album-fr', `${a}fr`);
            root.style.setProperty('--pt-date-fr', `${d}fr`);
          }
        };

        const onUp = () => {
          document.body.classList.remove('resizing-music-columns');
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          const parseFr = (prop, fb) => {
            const raw = getComputedStyle(root).getPropertyValue(prop).trim();
            const n = Number.parseFloat(raw);
            return Number.isFinite(n) ? Math.max(FR_MIN, n) : fb;
          };
          const t = parseFr('--pt-title-fr', 2.5);
          const a = parseFr('--pt-album-fr', 1.8);
          const d = parseFr('--pt-date-fr', 1.2);
          localStorage.setItem('pn_music_col_title_fr', String(t));
          localStorage.setItem('pn_music_col_album_fr', String(a));
          localStorage.setItem('pn_music_col_date_fr', String(d));
          root.style.setProperty('--pt-title-fr', `${t}fr`);
          root.style.setProperty('--pt-album-fr', `${a}fr`);
          root.style.setProperty('--pt-date-fr', `${d}fr`);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    };

    attach('.col-title', 'title-album');
    attach('.col-album', 'album-date');
  }

  if (lockMusicColumnsInput) {
    lockMusicColumnsInput.checked = musicColumnsLocked;
    lockMusicColumnsInput.addEventListener('change', () => {
      musicColumnsLocked = lockMusicColumnsInput.checked;
      localStorage.setItem('pn_music_columns_locked', String(musicColumnsLocked));
      root.dataset.musicColumnsLocked = String(musicColumnsLocked);
      // Solo tocar handles del header actual; sin observers
      try {
        ensureMusicColumnHandles();
      } catch (err) {
        console.warn('No se pudieron actualizar los handles de columnas:', err);
      }
    });
  }
  root.dataset.musicColumnsLocked = String(musicColumnsLocked);

  // Handles iniciales (si el header ya está en el DOM)
  try {
    ensureMusicColumnHandles();
  } catch (_) {}

  // Exponer para reinyectar handles tras re-render de búsqueda / listas
  window.__pnEnsureMusicColumnHandles = ensureMusicColumnHandles;
}
