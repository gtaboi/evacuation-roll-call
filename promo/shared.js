window.UI = {
  sign: '<svg width="34" height="34" viewBox="0 0 40 40" fill="none"><path d="M4 4h8M4 4v8M36 4h-8M36 4v8M4 36h8M4 36v-8M36 36h-8M36 36v-8" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/><circle cx="15" cy="15" r="3" fill="#ffffff"/><circle cx="25" cy="15" r="3" fill="#ffffff"/><path d="M11 29v-6a4 4 0 0 1 8 0v6zM21 29v-6a4 4 0 0 1 8 0v6z" fill="#ffffff"/></svg>',
  head(sub) {
    return '<div class="app-bar"><span>10:02</span><span>5G</span></div>' +
      '<div class="app-head"><div class="app-sign">' + this.sign + '</div><div><h1>Evacuation Roll Call</h1><p>' + sub + '</p></div></div>';
  },
  status(sub) {
    return '<div class="app-status"><div class="app-dot"></div><div><b>Evacuation in progress</b><span>' + sub + '</span></div></div>';
  },
  point() {
    return '<div class="app-point"><svg width="30" height="30" viewBox="0 0 24 24" style="flex:none"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg>' +
      '<div><small>Dry weather · go to this assembly point</small><strong>North car park, bay A</strong><p>Exit by the main lobby, turn left</p></div></div>';
  },
  phone(kit, html) {
    if (!kit.__appCss) { kit.css(kit.module('app.css')); kit.__appCss = true; }
    const p = kit.h('<div class="phone"><div class="phone-screen"><div class="phone-notch"></div><div class="app">' + html + '</div></div></div>');
    kit.stage.append(p);
    return p;
  },
  place(el, x, y, s) { el.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')'; },
};
