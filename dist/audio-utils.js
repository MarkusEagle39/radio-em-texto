export function resample(samples, fromRate, toRate = 16000) {
  if (fromRate === toRate) return samples.slice();
  if (!samples.length || fromRate <= 0 || toRate <= 0) return new Float32Array();
  const length = Math.floor(samples.length * toRate / fromRate);
  const output = new Float32Array(length);
  const ratio = fromRate / toRate;
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const first = Math.floor(position);
    const fraction = position - first;
    const second = Math.min(first + 1, samples.length - 1);
    output[i] = samples[first] * (1 - fraction) + samples[second] * fraction;
  }
  return output;
}

export function joinSamples(chunks) {
  const result = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function rms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

const cleanWord = word => word.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');

// Only reconcile adjacent overlapping windows. Never rewrite the recognized words.
export function removeOverlap(previous, incoming) {
  const before = previous.trim().split(/\s+/).slice(-35);
  const after = incoming.trim().split(/\s+/);
  if (!incoming.trim()) return '';
  for (let size = Math.min(before.length, after.length, 25); size >= 2; size--) {
    if (before.slice(-size).every((word, index) => cleanWord(word) === cleanWord(after[index]))) {
      return after.slice(size).join(' ');
    }
  }
  return incoming.trim();
}

// Detect obvious decoding loops, not confidence or linguistic accuracy.
export function isRepetitiveCaption(text) {
  const words = text.trim().split(/\s+/).map(cleanWord).filter(Boolean);
  if (words.length < 18) return false;
  if (new Set(words).size / words.length < 0.25) return true;
  for (let size = 3; size <= 6; size++) {
    const counts = new Map();
    for (let index = 0; index <= words.length - size; index++) {
      const phrase = words.slice(index, index + size).join(' ');
      const count = (counts.get(phrase) || 0) + 1;
      counts.set(phrase, count);
      if (count >= 4 && count * size / words.length > 0.55) return true;
    }
  }
  return false;
}

export function elapsedTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export const STATIONS = Object.freeze({
  cbn: {
    name: 'CBN Campinas',
    frequency: '99,1 FM · Campinas, SP',
    description: 'Notícias, entrevistas e informação da sua cidade.',
    website: 'https://cbncampinas.com.br/ouca-ao-vivo/',
    stream: 'https://8214.brasilstream.com.br/stream',
  },
  bandeirantes: {
    name: 'Bandeirantes Campinas',
    frequency: '85,7 FM · Campinas, SP',
    description: 'Jornalismo, entrevistas e esportes, com programação local e da rede.',
    website: 'https://radiobandeirantescampinas.com.br/',
    stream: 'https://stm23.xcast.com.br:11284/stream',
  },
  jp: {
    name: 'Jovem Pan News Campinas',
    frequency: '100,3 FM · Campinas, SP',
    description: 'Notícias, entrevistas e debates. Inclui conteúdo da rede nacional.',
    website: 'https://jovempannewscampinas.com.br/',
    stream: 'https://stm11.srvstm.com:6808/stream',
  },
  difusora: {
    name: 'Difusora Jundiaí',
    frequency: 'Jundiaí, SP · Rádio pela internet',
    description: 'Jornalismo, prestação de serviço e esportes de Jundiaí e região. A programação também inclui música.',
    website: 'https://radiodifusorajundiai.com.br/',
    stream: 'https://shout35.crossradio.com.br:18112/1.mp3',
  },
});
