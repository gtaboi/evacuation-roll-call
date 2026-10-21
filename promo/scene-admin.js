const { seg, eo, eio, lerp, TextFx } = kit;
const ADMIN_EXPECTED = 48, ADMIN_IN = 47, ADMIN_MIN = 4.2;
const ADMIN_TIMES = Array.from({ length: ADMIN_IN }, (_, i) => ADMIN_MIN * Math.pow((i + 1) / ADMIN_IN, 1.7));
kit.scene('admin', {
  init(kit) {
    kit.stage.append(kit.h('<div class="ground"><div class="words" style="left:150px;top:330px;width:820px">' +
      '<p class="kicker admin-kick">For admins</p><h1 class="line admin-l1">Watch it fill in.</h1>' +
      '<p class="sub admin-sub">Live counts and the accountability curve, minute by minute.</p></div></div>'));
    const W = 330, H = 120;
    const x = (m) => 8 + (m / 5) * (W - 16), y = (n) => H - 10 - (n / ADMIN_EXPECTED) * (H - 20);
    let d = 'M' + x(0) + ',' + y(0);
    ADMIN_TIMES.forEach((m, i) => { d += ' H' + x(m).toFixed(1) + ' V' + y(i + 1).toFixed(1); });
    d += ' H' + x(5);
    this.phone = UI.phone(kit, UI.head('Admin: run the roll call and track how fast everyone is accounted for.') +
      '<div class="app-tabs"><i>Check in</i><i class="on">Admin</i></div>' +
      UI.status('Started 10:02. Staff can check in now.') +
      '<div class="app-tally"><div class="app-tile"><b class="admin-acc"></b><span>Accounted for</span></div>' +
      '<div class="app-tile"><b class="admin-miss" style="color:#8a6d00"></b><span>Not checked in</span></div>' +
      '<div class="app-tile"><b class="admin-help" style="color:#c8102e"></b><span>Need help</span></div>' +
      '<div class="app-tile"><b class="admin-time"></b><span>Elapsed</span></div></div>' +
      '<div class="app-progress"><i class="admin-bar"></i></div>' +
      '<div class="app-curve"><h2 style="margin-bottom:6px">Accountability curve</h2><svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<defs><clipPath id="admin-clip"><rect class="admin-clip" x="0" y="0" width="0" height="' + H + '"/></clipPath></defs>' +
      '<line x1="8" x2="' + (W - 8) + '" y1="' + y(ADMIN_EXPECTED) + '" y2="' + y(ADMIN_EXPECTED) + '" stroke="#5b6a61" stroke-width="1.5" stroke-dasharray="5 4"/>' +
      '<line x1="' + x(4) + '" x2="' + x(4) + '" y1="8" y2="' + (H - 8) + '" stroke="#8a6d00" stroke-width="1.5" stroke-dasharray="5 4"/>' +
      '<g clip-path="url(#admin-clip)"><path d="' + d + ' V' + y(0) + ' Z" fill="#00794a" fill-opacity=".12"/><path d="' + d + '" fill="none" stroke="#00794a" stroke-width="2.5"/></g></svg></div>');
    const q = (s) => this.phone.querySelector(s);
    this.acc = q('.admin-acc'); this.miss = q('.admin-miss'); this.help = q('.admin-help'); this.time = q('.admin-time');
    this.bar = q('.admin-bar').style; this.clip = q('.admin-clip'); this.xOf = x; this.dot = q('.app-dot').style;
    this.kick = kit.stage.querySelector('.admin-kick').style;
    this.l1 = kit.stage.querySelector('.admin-l1');
    this.sub = kit.stage.querySelector('.admin-sub').style;
  },
  render(t) {
    const enter = eio(seg(t, 0, 1));
    UI.place(this.phone, lerp(2000, 1120, enter), 96 - t * 4, 1.55);
    const m = lerp(0, ADMIN_MIN, eio(seg(t, 0.8, 5)));
    const n = ADMIN_TIMES.filter((a) => a <= m).length;
    this.acc.textContent = Math.round(100 * n / ADMIN_EXPECTED) + '%';
    this.miss.textContent = String(ADMIN_EXPECTED - n);
    this.help.textContent = m > 1.6 ? '1' : '0';
    const secs = Math.round(m * 60);
    this.time.textContent = Math.floor(secs / 60) + 'm ' + String(secs % 60).padStart(2, '0') + 's';
    this.bar.transform = 'scaleX(' + (n / ADMIN_EXPECTED) + ')';
    this.clip.setAttribute('width', this.xOf(m) + 1);
    const p = (t % 1.4) / 1.4;
    this.dot.transform = 'scale(' + (1 + 0.5 * Math.sin(p * Math.PI)) + ')';
    this.kick.opacity = eo(seg(t, 0.4, 0.8));
    TextFx.fadeFromRight(this.l1, t, 0.5);
    this.sub.opacity = eo(seg(t, 1.8, 2.4));
    this.sub.transform = 'translateX(' + lerp(26, 0, eo(seg(t, 1.8, 2.4))) + 'px)';
  },
});
