import { createWidget, widget, prop, align } from '@zos/ui';
import { Step } from '@zos/sensor';
import { start, stop, getAllAppServices } from '@zos/app-service';
import { queryPermission, requestPermission } from '@zos/app';
import { px } from '@zos/utils';

const file = 'app-service/steps', permissions = ['data:user.hd.step', 'device:os.bg_service'];
Page({
  build() {
    const step = new Step(); let listening = false;
    const label = createWidget(widget.TEXT, { x: px(30), y: px(48), w: px(330), h: px(150), color: 0xffffff, text_size: px(26), align_h: align.CENTER_H, text: 'Steady\nDirect watch steps' });
    const status = createWidget(widget.TEXT, { x: px(30), y: px(196), w: px(330), h: px(76), color: 0xaaaaaa, text_size: px(20), align_h: align.CENTER_H, text: 'Pair in Zepp settings first' });
    const updateCount = () => label.setProperty(prop.TEXT, 'Steady\n' + step.getCurrent() + ' steps');
    const followSteps = () => { updateCount(); if (!listening) { step.onChange(updateCount); listening = true; } };
    this.clearStepListener = () => { if (listening) step.offChange(updateCount); };
    const refresh = () => { const running = getAllAppServices().includes(file); status.setProperty(prop.TEXT, running ? 'Running · ~1 min updates\nView delivery in Steady' : 'Background sync stopped'); return running; };
    const begin = () => {
      followSteps();
      start({ file, complete_func: info => { if (info.result) refresh(); else status.setProperty(prop.TEXT, 'Could not start service\nCheck watch permissions'); } });
    };
    createWidget(widget.BUTTON, { x: px(40), y: px(290), w: px(310), h: px(60), radius: px(12), text_size: px(24), normal_color: 0x214d3b, press_color: 0x32664e, text: 'Start sync', click_func() {
      if (getAllAppServices().includes(file)) { refresh(); return; }
      const granted = queryPermission({ permissions });
      if (granted.every(value => value === 2)) begin();
      else requestPermission({ permissions, callback(results) { if (results.every(value => value === 2)) begin(); else status.setProperty(prop.TEXT, 'Steps and background\npermission are needed'); } });
    } });
    createWidget(widget.BUTTON, { x: px(40), y: px(365), w: px(310), h: px(55), radius: px(12), text_size: px(22), normal_color: 0x333333, press_color: 0x555555, text: 'Stop sync', click_func() { stop({ file, complete_func: () => refresh() }); } });
    refresh();
    if (queryPermission({ permissions: ['data:user.hd.step'] })[0] === 2) followSteps();
  },
  onDestroy() { if (this.clearStepListener) this.clearStepListener(); },
});
