const { seg, eo, ei, eio, lerp, TextFx } = kit;
const ALARM_BUBBLES = [
  { text: 'Is Pat out?', x: 1080, y: 250, t: 0.7 },
  { text: 'Anyone seen John?', x: 1260, y: 420, t: 1.1 },
  { text: 'Still at my desk, sorry', x: 1010, y: 600, t: 1.5 },
  { text: 'Who is counting?', x: 1300, y: 780, t: 1.9 },
];
kit.scene('alarm', {
  init(kit) {
    let rings = '';
    for (let i = 0; i < 3; i++) rings += '<circle class="alarm-ring" cx="1460" cy="540" r="120" fill="none" style="stroke:var(--accent)" stroke-width="6"/>';
    kit.stage.append(kit.h('<div class="ground">' +
      '<svg class="alarm-art" viewBox="0 0 1920 1080" style="position:absolute;inset:0;width:100%;height:100%">' + rings +
      '<circle cx="1460" cy="540" r="62" style="fill:var(--accent)" class="alarm-core"/></svg>' +
      '<div class="words" style="left:150px;top:300px;width:900px"><p class="kicker alarm-kick">10:02 · Fire alarm</p>' +
      '<h1 class="line alarm-l1">The alarm goes off.</h1><h1 class="line hi alarm-l2">Who is actually out?</h1></div></div>'));
    this.rings = [...kit.stage.querySelectorAll('.alarm-ring')];
    this.core = kit.stage.querySelector('.alarm-core');
    this.core.style.transformOrigin = '1460px 540px';
    this.kick = kit.stage.querySelector('.alarm-kick').style;
    this.l1 = kit.stage.querySelector('.alarm-l1');
    this.l2 = kit.stage.querySelector('.alarm-l2');
    this.words = kit.stage.querySelector('.words').style;
    this.bubbles = ALARM_BUBBLES.map((b) => {
      const el = kit.h('<div class="bubble"></div>');
      el.textContent = b.text;
      el.style.left = b.x + 'px'; el.style.top = b.y + 'px';
      kit.stage.firstChild.append(el);
      return { el: el.style, b };
    });
  },
  render(t, kit) {
    this.kick.opacity = eo(seg(t, -0.6, -0.1));
    TextFx.fadeFromRight(this.l1, t, -0.6);
    TextFx.fadeFromRight(this.l2, t, 1.3);
    const out = ei(seg(t, 3.3, 3.95));
    this.words.transform = 'translateX(' + (-40 * out) + 'px)';
    this.words.opacity = 1 - out;
    const period = 1.6;
    this.rings.forEach((r, i) => {
      const p = ((t + i * period / 3) % period) / period;
      r.setAttribute('r', lerp(80, 420, eo(p)));
      r.style.opacity = (1 - p) * 0.55 * (1 - out);
    });
    this.core.style.transform = 'scale(' + (1 + 0.05 * Math.sin(t * Math.PI * 2 / 1.6)) + ')';
    this.core.style.opacity = 1 - out;
    for (const { el, b } of this.bubbles) {
      const p = eo(seg(t, b.t, b.t + 0.5));
      el.opacity = p * (1 - out);
      el.transform = 'translateY(' + (lerp(30, 0, p) - (t - b.t) * 6) + 'px) scale(' + lerp(0.94, 1, p) + ')';
    }
  },
});
