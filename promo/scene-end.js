const { seg, eo, eob, eio, lerp, TextFx } = kit;
kit.scene('end', {
  init(kit) {
    kit.stage.append(kit.h('<div class="ground">' +
      '<div class="end-mark" style="position:absolute;left:810px;top:170px;width:300px;height:300px;border-radius:44px;background:var(--main);display:grid;place-items:center">' +
      '<svg width="220" height="220" viewBox="0 0 40 40" fill="none"><path d="M4 4h8M4 4v8M36 4h-8M36 4v8M4 36h8M4 36v-8M36 36h-8M36 36v-8" style="stroke:var(--ground)" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="15" cy="15" r="3" style="fill:var(--ground)"/><circle cx="25" cy="15" r="3" style="fill:var(--ground)"/><path d="M11 29v-6a4 4 0 0 1 8 0v6zM21 29v-6a4 4 0 0 1 8 0v6z" style="fill:var(--ground)"/></svg></div>' +
      '<div class="words" style="left:160px;top:540px;width:1600px;align-items:center;text-align:center;gap:30px">' +
      '<h1 class="line end-name" style="font-size:156px">Evacuation Roll Call</h1>' +
      '<p class="sub end-sub" style="font-size:48px;color:var(--second)">Every person, accounted for.</p>' +
      '<div class="end-under" style="width:240px;height:10px;border-radius:5px;background:var(--accent);transform-origin:50% 50%"></div></div></div>'));
    this.mark = kit.stage.querySelector('.end-mark').style;
    this.name = kit.stage.querySelector('.end-name');
    this.sub = kit.stage.querySelector('.end-sub').style;
    this.under = kit.stage.querySelector('.end-under').style;
  },
  render(t) {
    const g = seg(t, 0, 0.7);
    this.mark.transform = 'scale(' + (g <= 0 ? 0.02 : Math.max(0.02, eob(g, 1.7))) + ') rotate(' + lerp(-8, 0, eo(g)) + 'deg)';
    this.mark.opacity = eo(seg(t, 0, 0.15));
    TextFx.fadeFromRight(this.name, t, 0.35);
    this.sub.opacity = eo(seg(t, 1.0, 1.5));
    this.sub.transform = 'translateX(' + lerp(26, 0, eo(seg(t, 1.0, 1.5))) + 'px)';
    this.under.transform = 'scaleX(' + eio(seg(t, 1.4, 1.9)) + ')';
    const drift = 1 + 0.004 * t;
    this.name.style.transform = 'scale(' + drift + ')';
  },
});
