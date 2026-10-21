const { seg, eo, eio, lerp, TextFx } = kit;
const DEBRIEF_TEXT = 'Target met: all 48 people were accounted for in 4 min 31 s, inside the 10-minute target. 90% were in by 3 min 40 s. One person asked for help and was reached by a warden. Jon Smth was linked to John Smith. Next drill: brief new starters on the assembly point, and post a warden at the east stairwell.';
kit.scene('debrief', {
  init(kit) {
    kit.stage.append(kit.h('<div class="ground"><div class="words" style="left:150px;top:300px;width:820px">' +
      '<p class="kicker debrief-kick">After the drill</p><h1 class="line debrief-l1">A debrief, written for you.</h1>' +
      '<p class="sub debrief-sub">AI turns the numbers into a short summary: what went well, and what to fix next time.</p></div></div>'));
    this.phone = UI.phone(kit, UI.head('Admin: run the roll call and track how fast everyone is accounted for.') +
      '<div class="app-tabs"><i>Check in</i><i class="on">Admin</i></div>' +
      '<h2>Past evacuations</h2>' +
      '<div class="app-list"><div class="app-row"><div class="app-who"><b>21 Oct, 10:02 · Dry</b><small>4m 31s · 48/48 accounted for</small></div><span class="app-pill p-safe">Met target</span></div></div>' +
      '<div class="app-curve" style="display:grid;gap:8px"><div style="display:flex;justify-content:space-between;align-items:center"><h2>Debrief · 21 Oct, 10:02</h2><span class="app-btn debrief-btn">Write debrief</span></div>' +
      '<p class="debrief-text" style="margin:0;font-size:14px;line-height:1.5;min-height:0"></p>' +
      '<p class="debrief-meta" style="margin:0;font-size:12px;color:#5b6a61">Written by AI from this evacuation’s numbers. Check it before sharing.</p></div>');
    const q = (s) => this.phone.querySelector(s);
    this.btn = q('.debrief-btn'); this.text = q('.debrief-text'); this.meta = q('.debrief-meta').style;
    let x = 0, y = 0, n = this.btn;
    while (n && n !== this.phone) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    this.btnCss = [14 + x + this.btn.offsetWidth / 2, 14 + y + this.btn.offsetHeight / 2];
    this.tap = kit.h('<div class="tap"></div>');
    kit.stage.append(this.tap);
    this.kick = kit.stage.querySelector('.debrief-kick').style;
    this.l1 = kit.stage.querySelector('.debrief-l1');
    this.sub = kit.stage.querySelector('.debrief-sub').style;
  },
  render(t, kit) {
    const rise = eio(seg(t, 0, 0.9));
    const x = 1120, y = lerp(1180, 96, rise) - t * 4, s = 1.55;
    UI.place(this.phone, x, y, s);
    this.phone.style.opacity = eo(seg(t, 0, 0.25));
    this.btn.textContent = t < 1.25 ? 'Write debrief' : t < 1.9 ? 'Writing…' : 'Rewrite';
    this.btn.style.transform = t > 1.2 && t < 1.4 ? 'scale(.95)' : 'none';
    this.text.textContent = t < 1.9 ? '' : kit.streamed(DEBRIEF_TEXT, t, 1.9, 120, 6);
    this.meta.opacity = eo(seg(t, 4.3, 4.6));
    const tp = seg(t, 1.2, 1.65);
    this.tap.style.opacity = tp > 0 && tp < 1 ? 1 - tp : 0;
    this.tap.style.left = (x + this.btnCss[0] * s) + 'px';
    this.tap.style.top = (y + this.btnCss[1] * s) + 'px';
    this.tap.style.transform = 'scale(' + lerp(0.6, 1.4, eo(tp)) + ')';
    this.kick.opacity = eo(seg(t, 0.3, 0.7));
    TextFx.fadeFromRight(this.l1, t, 0.4);
    this.sub.opacity = eo(seg(t, 1.8, 2.4));
    this.sub.transform = 'translateX(' + lerp(26, 0, eo(seg(t, 1.8, 2.4))) + 'px)';
  },
});
