const { seg, eo, eio, lerp, TextFx } = kit;
kit.scene('match', {
  init(kit) {
    kit.stage.append(kit.h('<div class="ground"><div class="words" style="left:150px;top:330px;width:820px">' +
      '<p class="kicker match-kick">No one slips through</p><h1 class="line match-l1">Nobody missed.</h1>' +
      '<p class="sub match-sub">A misspelt name? AI suggests who it is. One tap links it.</p></div></div>'));
    this.phone = UI.phone(kit, UI.head('Admin: run the roll call and track how fast everyone is accounted for.') +
      '<div class="app-tabs"><i>Check in</i><i class="on">Admin</i></div>' +
      UI.status('Started 10:02. Staff can check in now.') +
      '<div class="app-tally"><div class="app-tile"><b class="match-acc"></b><span>Accounted for</span></div>' +
      '<div class="app-tile"><b class="match-miss" style="color:#8a6d00"></b><span>Not checked in</span></div>' +
      '<div class="app-tile"><b style="color:#c8102e">1</b><span>Need help</span></div>' +
      '<div class="app-tile"><b class="match-time"></b><span>Elapsed</span></div></div>' +
      '<div class="app-progress"><i class="match-bar"></i></div>' +
      '<div class="match-done" style="overflow:hidden"><div class="app-mine"><b>Everyone accounted for</b><span>4m 31s · within the 10 min target</span></div></div>' +
      '<div class="match-cfold" style="overflow:hidden"><div class="app-curve" style="display:grid;gap:10px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:13px;color:#5b6a61">1 check-in doesn’t match the staff list.</span><span class="app-btn match-sug">Suggest matches</span></div>' +
      '<div class="match-sfold" style="overflow:hidden"><div class="app-row" style="border:1px solid #d6ddd7;border-radius:8px"><div class="app-av">J</div><div class="app-who"><b>Jon Smth → John Smith</b><small>Nickname and typo match</small></div><span class="app-btn match-link">Link</span></div></div></div></div>' +
      '<div class="match-mfold" style="overflow:hidden;display:grid;gap:8px"><h2>Not checked in</h2><div class="app-list"><div class="app-row"><div class="app-av">J</div><div class="app-who"><b>John Smith</b></div><span class="app-pill p-miss">Missing</span><span class="app-btn">Mark safe</span></div></div></div>');
    const q = (s) => this.phone.querySelector(s);
    this.acc = q('.match-acc'); this.miss = q('.match-miss'); this.time = q('.match-time'); this.bar = q('.match-bar').style;
    this.done = q('.match-done').style; this.cfold = q('.match-cfold').style; this.sfold = q('.match-sfold').style; this.mfold = q('.match-mfold').style;
    this.sug = q('.match-sug'); this.link = q('.match-link'); this.dot = q('.app-dot').style;
    const at = (el) => { let x = 0, y = 0, n = el; while (n && n !== this.phone) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } return [14 + x + el.offsetWidth / 2, 14 + y + el.offsetHeight / 2]; };
    this.done.maxHeight = '0px'; this.done.marginBottom = '-16px';
    this.linkCss = at(this.link);
    this.sfold.maxHeight = '0px';
    this.sugCss = at(this.sug);
    this.taps = [kit.h('<div class="tap"></div>'), kit.h('<div class="tap"></div>')];
    this.taps.forEach((e) => kit.stage.append(e));
    this.kick = kit.stage.querySelector('.match-kick').style;
    this.l1 = kit.stage.querySelector('.match-l1');
    this.sub = kit.stage.querySelector('.match-sub').style;
  },
  render(t) {
    const push = eio(seg(t, 0.1, 1.1));
    const s = lerp(1.55, 1.75, push), x = lerp(1120, 1080, push), y = lerp(72, -330, push) - t * 4;
    UI.place(this.phone, x, y, s);
    const linked = t >= 2.95;
    const n = linked ? 48 : 47;
    this.acc.textContent = Math.round(100 * n / 48) + '%';
    this.miss.textContent = linked ? '0' : '1';
    const secs = Math.min(271, 252 + Math.round(t * 6.4));
    this.time.textContent = Math.floor(secs / 60) + 'm ' + String(secs % 60).padStart(2, '0') + 's';
    this.bar.transform = 'scaleX(' + lerp(47 / 48, 1, eo(seg(t, 2.95, 3.4))) + ')';
    const sOpen = eo(seg(t, 1.9, 2.3));
    this.sfold.maxHeight = (80 * sOpen) + 'px'; this.sfold.opacity = sOpen;
    this.sug.textContent = t > 1.45 && t < 1.95 ? 'Matching…' : 'Suggest matches';
    const close = eio(seg(t, 3.05, 3.5));
    this.cfold.maxHeight = (190 * (1 - close)) + 'px'; this.cfold.opacity = 1 - close;
    this.mfold.maxHeight = (110 * (1 - close)) + 'px'; this.mfold.opacity = 1 - close;
    const dn = eo(seg(t, 3.3, 3.8));
    this.done.maxHeight = (90 * dn) + 'px'; this.done.opacity = dn; this.done.marginBottom = (-16 * (1 - dn)) + 'px';
    [[this.sugCss, 1.3], [this.linkCss, 2.85]].forEach(([c, t0], i) => {
      const tp = seg(t, t0, t0 + 0.45), st = this.taps[i].style;
      st.opacity = tp > 0 && tp < 1 ? 1 - tp : 0;
      st.left = (x + c[0] * s) + 'px'; st.top = (y + c[1] * s) + 'px';
      st.transform = 'scale(' + lerp(0.6, 1.4, eo(tp)) + ')';
    });
    const p = (t % 1.4) / 1.4;
    this.dot.transform = 'scale(' + (1 + 0.5 * Math.sin(p * Math.PI)) + ')';
    this.kick.opacity = eo(seg(t, 0.3, 0.7));
    TextFx.fadeFromRight(this.l1, t, 0.4);
    this.sub.opacity = eo(seg(t, 1.6, 2.2));
    this.sub.transform = 'translateX(' + lerp(26, 0, eo(seg(t, 1.6, 2.2))) + 'px)';
  },
});
