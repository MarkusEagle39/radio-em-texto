import test from 'node:test';
import assert from 'node:assert/strict';
import { resample, joinSamples, rms, removeOverlap, isRepetitiveCaption, elapsedTime } from '../dist/audio-utils.js';

test('resampling one second of speech-band audio preserves duration, level and pitch', () => {
  for (const rate of [44100, 48000]) {
    const source = Float32Array.from({ length: rate }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 440 * i / rate));
    const result = resample(source, rate);
    assert.equal(result.length, 16000);
    assert.ok(Math.abs(rms(result) - 0.4 / Math.sqrt(2)) < 0.002);
    let risingCrossings = 0;
    for (let i = 1; i < result.length; i++) {
      if (result[i - 1] <= 0 && result[i] > 0) risingCrossings++;
    }
    assert.ok(Math.abs(risingCrossings - 440) <= 1, `pitch changed at input rate ${rate}`);
    assert.ok(result.every(Number.isFinite));
  }
});

test('16 kHz audio can be transferred without sharing the capture buffer', () => {
  const source = new Float32Array([0.1, -0.1, 0.2]);
  const result = resample(source, 16000);
  assert.deepEqual(result, source);
  assert.notEqual(result.buffer, source.buffer);
  result[0] = 1;
  assert.ok(source[0] < 0.11);
});

test('empty and silent audio remain safe for the silence gate', () => {
  assert.equal(resample(new Float32Array(), 44100).length, 0);
  assert.equal(rms(new Float32Array()), 0);
  assert.equal(rms(resample(new Float32Array(44100), 44100)), 0);
  assert.ok(rms(Float32Array.from([0.0001, -0.0001])) < 0.001);
  assert.ok(rms(Float32Array.from([0.1, -0.1])) > 0.001);
});

test('combining capture chunks preserves chronological samples and does not mutate them', () => {
  const chunks = [new Float32Array([1, 2]), new Float32Array(), new Float32Array([3, 4])];
  const combined = joinSamples(chunks);
  assert.deepEqual(Array.from(combined), [1, 2, 3, 4]);
  combined[0] = 99;
  assert.equal(chunks[0][0], 1);
  assert.equal(joinSamples([]).length, 0);
});

test('adjacent captions remove duplicated Portuguese words despite case and punctuation', () => {
  assert.equal(
    removeOverlap('A previsão para Campinas, São Paulo.', 'CAMPINAS SÃO PAULO: é de chuva à tarde.'),
    'é de chuva à tarde.',
  );
  assert.equal(removeOverlap('Agora, muito obrigado!', 'Muito obrigado.'), '');
});

test('caption reconciliation preserves new wording, numbers and natural repetition', () => {
  assert.equal(removeOverlap('A temperatura é de 20 graus.', 'A temperatura é de 21 graus.'), 'A temperatura é de 21 graus.');
  assert.equal(removeOverlap('A notícia chega agora.', 'agora vamos falar de Campinas.'), 'agora vamos falar de Campinas.');
  assert.equal(removeOverlap('', 'Sim, sim, vamos continuar.'), 'Sim, sim, vamos continuar.');
  assert.equal(removeOverlap('A chuva continua.', '   '), '');
});

test('reading elapsed time handles minute boundaries and sessions longer than one hour', () => {
  assert.equal(elapsedTime(-5), '00:00');
  assert.equal(elapsedTime(59.9), '00:59');
  assert.equal(elapsedTime(60), '01:00');
  assert.equal(elapsedTime(3661), '61:01');
});

test('obvious decoder loops are flagged without treating ordinary speech or brief emphasis as unreliable', () => {
  assert.equal(isRepetitiveCaption('com o que é '.repeat(28)), true);
  assert.equal(isRepetitiveCaption('2, 3, ' + '4, '.repeat(80)), true);
  assert.equal(isRepetitiveCaption('Não, não, não. Precisamos conferir essa informação.'), false);
  assert.equal(isRepetitiveCaption('O campeonato brasileiro volta nesta quarta-feira. A equipe joga às oito e meia da noite em Belo Horizonte, e o resultado será acompanhado pela nossa reportagem.'), false);
});
