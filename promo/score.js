kit.score(function (S, T) {
  const BPM = 96, B = 60 / BPM;
  S.tempo(BPM, { t0: T.point - 8 * B });
  S.program('pad', 'pad', { rev: 0.6 });
  S.program('keys', 'ep', { gain: -2 });
  S.program('bass', 'bass');
  S.program('mallet', 'marimba', { pan: 0.2 });
  S.program('bell', 'vibes', { rev: 0.4, pan: -0.2 });
  // The alarm: a low pad and a soft two-note pulse with the rings; pops as the worried messages appear.
  S.chord('pad', ['A2', 'E3', 'C4'], { t: 0, dur: 4.2, vel: 34 });
  [0, 1.6, 3.2].forEach((t) => { S.note('bell', 'E5', { t, dur: 0.4, vel: 40 }); S.note('bell', 'C5', { t: t + 0.4, dur: 0.6, vel: 32 }); });
  [0.7, 1.1, 1.5, 1.9].forEach((t) => S.fx('pop', t, { vel: 38 }));
  S.fx('whoosh', T.point - 0.3, { dur: 0.5, vel: 40 });
  // The groove, beats 8 to 40 (the staff screens, then the admin view).
  const prog = [['D3', 'A3', 'D4', 'F#4'], ['B2', 'F#3', 'B3', 'D4'], ['G2', 'D3', 'G3', 'B3'], ['A2', 'E3', 'A3', 'C#4']];
  const roots = ['D2', 'B1', 'G1', 'A1'];
  for (let i = 0; i < 4; i++) {
    const beat = 8 + i * 8;
    S.chord('keys', prog[i], { beat, beats: 7.5, vel: 48 });
    S.chord('pad', prog[i].slice(0, 3), { beat, beats: 8, vel: 24 });
    S.note('bass', roots[i], { beat, beats: 1.5, vel: 74 });
    S.note('bass', roots[i], { beat: beat + 3, beats: 0.75, vel: 58 });
    S.note('bass', roots[i], { beat: beat + 4, beats: 1.5, vel: 70 });
  }
  S.drums({ hat: 'x.x.x.x.' }, { from: 8, repeat: 2, vel: 40 });
  S.pattern('mallet', 'x.x.X.xx', { from: 16, repeat: 6, pitch: ['A4', 'D5', 'F#5', 'D5'], vel: 54 });
  S.drums({ kick: 'x...x...', sidestick: '..x...x.', hat: 'oxoxoxox' }, { from: 16, repeat: 6, vel: 62 });
  // Check in: a tick per keystroke, the tap, location found, checked in.
  for (let i = 0; i < 7; i++) S.fx('tick', T.checkin + 1.05 + i / 11, { vel: 34 });
  S.fx('click', T.checkin + 2.15);
  S.fx('pop', T.checkin + 2.35, { vel: 40 });
  S.fx('ding', T.checkin + 3.15, { vel: 50 });
  S.fx('chime', T.checkin + 3.9, { vel: 60 });
  // The admin view: the phone slides in, the count rolls up and lands.
  S.fx('whoosh', T.admin, { dur: 0.6, vel: 42 });
  S.fx('roll', T.admin + 0.8, { dur: 4.2, vel: 30 });
  // Nobody missed: suggest, the match appears, link, everyone accounted for.
  S.fx('click', T.match + 1.3);
  S.fx('sparkle', T.match + 1.95, { vel: 48 });
  S.fx('click', T.match + 2.85);
  S.fx('chime', T.match + 3.35, { vel: 66 });
  // AI debrief: a lighter bed, the tap, a sparkle as the summary starts writing, soft ticks as it streams.
  S.fx('whoosh', T.debrief, { dur: 0.5, vel: 38 });
  S.chord('pad', ['G2', 'D3', 'B3'], { t: T.debrief, dur: 2.6, vel: 30 });
  S.chord('keys', ['G3', 'B3', 'D4', 'F#4'], { t: T.debrief, dur: 2.4, vel: 38 });
  S.chord('pad', ['A2', 'E3', 'C#4'], { t: T.debrief + 2.5, dur: 2.6, vel: 30 });
  S.chord('keys', ['A3', 'C#4', 'E4', 'G4'], { t: T.debrief + 2.5, dur: 2.4, vel: 38 });
  S.note('bass', 'G1', { t: T.debrief, dur: 1.2, vel: 60 });
  S.note('bass', 'A1', { t: T.debrief + 2.5, dur: 1.2, vel: 60 });
  S.pattern('mallet', 'x...x.x.', { from: Math.round(S.toBeat(T.debrief + 0.6)), repeat: 2, pitch: ['B4', 'D5', 'E5'], vel: 40 });
  S.fx('click', T.debrief + 1.2);
  S.fx('sparkle', T.debrief + 1.9, { vel: 46 });
  for (let i = 0; i < 10; i++) S.fx('tick', T.debrief + 2 + i * 0.24, { vel: 18 });
  // Into the end card: a swell and a rising run, then the resolving chord.
  S.fx('revswell', T.end, { dur: 1.4, vel: 50 });
  S.run('mallet', ['D5', 'E5', 'F#5', 'A5', 'B5', 'D6'], { t: T.end - 0.62, step: 0.1, vel: 52, cresc: 8 });
  S.fx('pop', T.end + 0.1, { vel: 50 });
  S.chord('keys', ['D3', 'A3', 'E4', 'F#4', 'A4'], { t: T.end, dur: 3.8, vel: 70 });
  S.chord('pad', ['D3', 'A3', 'F#4'], { t: T.end, dur: 4, vel: 36 });
  S.note('bass', 'D2', { t: T.end, dur: 2.5, vel: 82 });
  S.drum('kick', { t: T.end, vel: 90 });
  S.note('bell', 'D6', { t: T.end + 1.4, dur: 1.6, vel: 44 });
  S.master({ gain: -6, fadeOut: 1.5 });
});
