const { seg, eo, eio, lerp, TextFx } = kit;
kit.scene('point', {
  init(kit) {
    kit.stage.append(kit.h('<div class="ground"><div class="words" style="left:150px;top:330px;width:820px">' +
      '<p class="kicker point-kick">For staff</p><h1 class="line point-l1">See where to go.</h1>' +
      '<p class="sub point-sub">No login, no app to install. Open the link and the assembly point is right there.</p></div></div>'));
    this.phone = UI.phone(kit, UI.head('Check in when you reach the assembly point.') +
      UI.status('Started 10:02 (just now). Check in now.') + UI.point() +
      '<h2>Your check-in</h2><div class="app-field"><label>Full name</label><div class="app-input"></div></div>' +
      '<div class="app-big app-safe">Check in: I’m safe</div>');
    this.dot = this.phone.querySelector('.app-dot').style;
    this.pt = this.phone.querySelector('.app-point').style;
    this.kick = kit.stage.querySelector('.point-kick').style;
    this.l1 = kit.stage.querySelector('.point-l1');
    this.sub = kit.stage.querySelector('.point-sub').style;
  },
  render(t) {
    const rise = eio(seg(t, 0, 1.1));
    const y = lerp(1180, 96, rise) - t * 4;
    UI.place(this.phone, 1120, y, 1.55);
    this.phone.style.opacity = eo(seg(t, 0, 0.3));
    const p = (t % 1.4) / 1.4;
    this.dot.transform = 'scale(' + (1 + 0.5 * Math.sin(p * Math.PI)) + ')';
    this.dot.opacity = 1 - 0.5 * Math.sin(p * Math.PI);
    const lift = eo(seg(t, 1.6, 2.2));
    this.pt.transform = 'translateY(' + lerp(10, 0, lift) + 'px)';
    this.pt.opacity = lerp(0.35, 1, lift);
    this.kick.opacity = eo(seg(t, 0.3, 0.7));
    TextFx.fadeFromRight(this.l1, t, 0.5);
    this.sub.opacity = eo(seg(t, 1.6, 2.2));
    this.sub.transform = 'translateX(' + lerp(26, 0, eo(seg(t, 1.6, 2.2))) + 'px)';
  },
});
