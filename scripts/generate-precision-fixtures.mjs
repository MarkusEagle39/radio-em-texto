import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') {
  console.error('Este gerador usa as ferramentas say e afconvert do macOS. Em outros sistemas, forneça os WAVs sintéticos descritos em tests/precision/results.md. Os testes npm test funcionam sem eles.');
  process.exit(1);
}
const output = fileURLToPath(new URL('../tests/precision/', import.meta.url));
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'radio-em-texto-fixtures-'));
const cases = [
  ['test', 155, 'Eu moro em Campinas. O ônibus para Valinhos sai às oito e trinta. A passagem custa cinco reais. Maria trabalha em Jundiaí.'],
  ['regiao', 170, 'Em Hortolândia, Sumaré e Paulínia, a vacinação começa na segunda-feira. Ana Paula atende em Indaiatuba.'],
  ['esportes', 170, 'O Guarani enfrenta a Ponte Preta em Campinas. O ingresso custa vinte reais. A partida começa às quinze horas.'],
];
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} terminou com código ${result.status}`);
}
try {
  for (const [name, rate, text] of cases) {
    const source = join(temporary, `${name}.aiff`);
    run('say', ['-v', 'Luciana (Português (Brasil))', '-r', String(rate), '-o', source, text]);
    run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', source, join(output, `_precision-${name}.wav`)]);
  }
  console.log('Três áudios sintéticos gerados em tests/precision. Nenhum áudio foi reproduzido ou enviado a serviços externos.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
