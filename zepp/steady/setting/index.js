import { parsePairing } from '../shared/protocol';
AppSettingsPage({
  build(props) {
    return View({ style: { padding: '16px' } }, [
      Text({ paragraph: true }, 'Steady direct watch sync'),
      Text({ paragraph: true }, 'In Steady: Activity → Direct Zepp sync → Create watch pairing. Paste the configuration below. Then open Steady on your watch and start background sync.'),
      TextInput({ label: 'Tap here to paste pairing configuration', placeholder: 'Paste configuration from Steady', multiline: true,
        onChange(value) {
          try { const config = parsePairing(value); props.settingsStorage.setItem('pairing', JSON.stringify(config)); props.settingsStorage.setItem('status', 'Paired. Start sync on the watch.'); }
          catch (_) { props.settingsStorage.setItem('status', 'Invalid configuration. Paste the entire configuration from Steady.'); }
        } }),
      Text({ paragraph: true }, props.settingsStorage.getItem('status') || 'Not paired yet.'),
      Text({ paragraph: true }, 'Last watch contact: ' + (props.settingsStorage.getItem('lastWatchContact') || 'Waiting for the watch')),
      Text({ paragraph: true }, 'Changed steps are sent about once a minute, with a check every 15 minutes while stationary. Zepp must be allowed to run in the background. Watch readings may be delayed while disconnected.'),
    ]);
  },
});
