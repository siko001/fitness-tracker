import { createWidget, widget, prop, align } from '@zos/ui';
import { Step } from '@zos/sensor';
import { start, stop, getAllAppServices } from '@zos/app-service';
import { queryPermission, requestPermission } from '@zos/app';
import { readFileSync } from '@zos/fs';

const file = 'app-service/steps', permissions = ['data:user.hd.step', 'device:os.bg_service'];
Page({
  build() {
    // This Bip Max preview uses its documented 390x450 compatibility viewport.
    // Do not query device information before rendering: that API requires a
    // separate permission and can prevent the entire page from appearing.
    const width = 390, height = 450;
    const scale = Math.min(width / 390, height / 450), px = value => Math.round(value * scale);
    const box = (y, w, h) => ({ x: Math.round((width - px(w)) / 2), y: Math.round((height - px(450)) / 2) + px(y), w: px(w), h: px(h) });
    const step = new Step(); let listening = false;
    const label = createWidget(widget.TEXT, { ...box(35, 330, 110), color: 0xffffff, text_size: px(26), align_h: align.CENTER_H, align_v: align.CENTER_V, text: 'Steady\nDirect watch steps' });
    const status = createWidget(widget.TEXT, { ...box(150, 330, 70), color: 0xaaaaaa, text_size: px(20), align_h: align.CENTER_H, align_v: align.CENTER_V, text: 'Pair in Zepp settings first' });
    const delivery = createWidget(widget.TEXT, { ...box(222, 350, 58), color: 0xaaaaaa, text_size: px(17), align_h: align.CENTER_H, align_v: align.CENTER_V, text: 'Waiting for delivery' });
    const clock = value => { if (!value) return 'waiting'; const d = new Date(value); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const showDelivery = () => {
      try { const info = JSON.parse(readFileSync({ path: 'relay-status.json', options: { encoding: 'utf8' } })); delivery.setProperty(prop.TEXT, 'Checked ' + clock(info.lastTick) + '\nDelivered ' + clock(info.lastDelivered)); } catch (_) {}
    };
    const updateCount = () => label.setProperty(prop.TEXT, 'Steady\n' + step.getCurrent() + ' steps');
    const followSteps = () => { updateCount(); if (!listening) { step.onChange(updateCount); listening = true; } };
    this.clearStepListener = () => { if (listening) step.offChange(updateCount); };
    const refresh = () => { const running = getAllAppServices().includes(file); status.setProperty(prop.TEXT, running ? 'Running · ~1 min updates\nView delivery in Steady' : 'Background sync stopped'); return running; };
    const begin = () => {
      followSteps();
      start({ file, complete_func: info => { if (info.result) refresh(); else status.setProperty(prop.TEXT, 'Could not start service\nCheck watch permissions'); } });
    };
    createWidget(widget.BUTTON, { ...box(290, 310, 60), radius: px(12), text_size: px(24), normal_color: 0x214d3b, press_color: 0x32664e, text: 'Start sync', click_func() {
      if (getAllAppServices().includes(file)) { refresh(); return; }
      const granted = queryPermission({ permissions });
      if (granted.every(value => value === 2)) begin();
      else requestPermission({ permissions, callback(results) { if (results.every(value => value === 2)) begin(); else status.setProperty(prop.TEXT, 'Steps and background\npermission are needed'); } });
    } });
    createWidget(widget.BUTTON, { ...box(365, 310, 55), radius: px(12), text_size: px(22), normal_color: 0x333333, press_color: 0x555555, text: 'Stop sync', click_func() { stop({ file, complete_func: () => refresh() }); } });
    refresh(); showDelivery();
    if (queryPermission({ permissions: ['data:user.hd.step'] })[0] === 2) followSteps();
  },
  onDestroy() { if (this.clearStepListener) this.clearStepListener(); },
});
