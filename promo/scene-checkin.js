const { seg, eo, eio, lerp, TextFx } = kit;
const CHECKIN_NAME = 'Pat Tan';
kit.scene('checkin', {
  init(kit) {
    kit.stage.append(kit.h('<div class="ground"><div class="words" style="left:150px;top:330px;width:820px">' +
      '<p class="kicker checkin-kick">One tap</p><h1 class="line checkin-l1">Check in by name.</h1>' +
      '<p class="sub checkin-sub">GPS confirms you are within 100 m of the assembly point.</p></div></div>'));
    this.phone = UI.phone(kit, UI.head('Check in when you reach the assembly point.') +
      UI.status('Started 10:02 (2 min ago). Check in now.') + UI.point() +
      '<h2>Your check-in</h2>' +
      '<div class="checkin-fold" style="overflow:hidden"><div class="app-mine" style="margin-bottom:12px"><b>Checked in as safe: Pat Tan</b><span>10:04 · 32 m from the point</span></div></div>' +
      '<div class="checkin-gfold" style="overflow:hidden"><div class="app-gps checkin-gps"></div></div>' +
      '<div class="app-field"><label>Full name</label><div class="app-input"><span class="checkin-typed"></span><span class="checkin-caret" style="display:inline-block;width:2px;height:20px;background:#142019;vertical-align:-3px;margin-left:1px"></span></div></div>' +
      '<div class="app-big app-safe checkin-btn">Check in: I’m safe</div>');
    const q = (s) => this.phone.querySelector(s);
    this.fold = q('.checkin-fold').style; this.gfold = q('.checkin-gfold').style;
    this.gps = q('.checkin-gps'); this.typed = q('.checkin-typed'); this.caret = q('.checkin-caret').style;
    this.btn = q('.checkin-btn');
    for (const f of [this.fold, this.gfold]) { f.maxHeight = '0px'; f.marginBottom = '-16px'; }
    this.tapCss = [14 + 16 + this.btn.offsetWidth / 2, 14 + this.btn.offsetTop + this.btn.offsetHeight / 2];
    this.typist = kit.typist(CHECKIN_NAME, 1.05, 11);
    this.tap = kit.h('<div class="tap"></div>');
    kit.stage.append(this.tap);
    this.kick = kit.stage.querySelector('.checkin-kick').style;
    this.l1 = kit.stage.querySelector('.checkin-l1');
    this.sub = kit.stage.querySelector('.checkin-sub').style;
  },
  render(t) {
    const push = eio(seg(t, 0.2, 1.3));
    const s = lerp(1.55, 1.95, push);
    const x = lerp(1120, 1060, push);
    const y = lerp(76, -330, push) - t * 4;
    UI.place(this.phone, x, y, s);
    this.typed.textContent = this.typist.at(t);
    this.caret.opacity = t < 2.1 && Math.floor(t / 0.53) % 2 === 0 ? 1 : 0;
    const press = t > 2.15 && t < 2.4;
    this.btn.style.transform = press ? 'scale(.97)' : 'none';
    const tp = seg(t, 2.15, 2.6);
    this.tap.style.opacity = tp > 0 && tp < 1 ? 1 - tp : 0;
    this.tap.style.left = (x + this.tapCss[0] * s) + 'px';
    this.tap.style.top = (y + this.tapCss[1] * s) + 'px';
    this.tap.style.transform = 'scale(' + lerp(0.6, 1.4, eo(tp)) + ')';
    const g = eo(seg(t, 2.35, 2.75));
    this.gfold.maxHeight = (90 * g) + 'px'; this.gfold.opacity = g; this.gfold.marginBottom = (-16 * (1 - g)) + 'px';
    this.gps.textContent = t < 3.15 ? 'Finding your location…' : 'You’re 32 m from North car park, bay A (±9 m). Checking you in…';
    const m = eo(seg(t, 3.9, 4.4));
    this.fold.maxHeight = (110 * m) + 'px'; this.fold.opacity = m; this.fold.marginBottom = (-16 * (1 - m)) + 'px';
    this.kick.opacity = eo(seg(t, 0.3, 0.7));
    TextFx.fadeFromRight(this.l1, t, 0.4);
    this.sub.opacity = eo(seg(t, 2.7, 3.3));
    this.sub.transform = 'translateX(' + lerp(26, 0, eo(seg(t, 2.7, 3.3))) + 'px)';
  },
});
