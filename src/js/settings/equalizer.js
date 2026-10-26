// Ajustes · Ecualizador: gráfico, ganancias y presets del usuario.

export const EQUALIZER_FREQUENCIES = [
  31, 43, 63, 87, 125, 175, 250, 350, 500, 700,
  1000, 1400, 2000, 2800, 4000, 5600, 8000, 11200, 16000, 22000
];

export const EQUALIZER_INPUT_IDS = EQUALIZER_FREQUENCIES.map(frequency => `audio-eq-${frequency}`);

function formatEqFrequency(hz) {
  if (hz >= 1000) {
    const k = hz / 1000;
    return Number.isInteger(k) ? `${k}.0k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(hz);
}

export function buildEqualizerGraphic() {
  const host = document.getElementById('audio-equalizer-controls');
  if (!host || host.dataset.built === '1') return;
  host.dataset.built = '1';
  host.replaceChildren();
  EQUALIZER_FREQUENCIES.forEach((hz, index) => {
    const id = `audio-eq-${hz}`;
    const col = document.createElement('div');
    col.className = 'eq-band';
    const topLabel = document.createElement('span');
    topLabel.className = 'eq-band-label eq-band-label-top';
    topLabel.textContent = index % 2 === 0 ? formatEqFrequency(hz) : '';
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = '-15';
    input.max = '15';
    input.step = '0.5';
    input.value = '0';
    input.orient = 'vertical';
    input.setAttribute('aria-label', `${formatEqFrequency(hz)} Hz`);
    const bottomLabel = document.createElement('span');
    bottomLabel.className = 'eq-band-label eq-band-label-bottom';
    bottomLabel.textContent = index % 2 === 1 ? formatEqFrequency(hz) : '';
    const output = document.createElement('output');
    output.id = `${id}-value`;
    output.className = 'eq-band-value';
    output.value = '0 dB';
    col.append(topLabel, input, bottomLabel, output);
    host.appendChild(col);
  });
}

export function applyEqualizerGains(gains) {
  EQUALIZER_INPUT_IDS.forEach((id, index) => {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-value`);
    if (!input) return;
    const v = Number.isFinite(gains[index]) ? gains[index] : 0;
    input.value = String(v);
    if (output) output.value = `${v} dB`;
  });
}

export function readEqualizerGains() {
  return EQUALIZER_INPUT_IDS.map(id => Number(document.getElementById(id)?.value) || 0);
}

export function loadUserEqPresets() {
  try {
    const raw = JSON.parse(localStorage.getItem('pn_audio_eq_user_presets') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.gains))
      .map(p => ({
        id: p.id,
        name: String(p.name).slice(0, 48),
        gains: EQUALIZER_FREQUENCIES.map((_, i) => {
          const g = Number(p.gains[i]);
          return Number.isFinite(g) ? Math.max(-15, Math.min(15, g)) : 0;
        })
      }));
  } catch {
    return [];
  }
}

export function saveUserEqPresets(presets) {
  localStorage.setItem('pn_audio_eq_user_presets', JSON.stringify(presets));
}
