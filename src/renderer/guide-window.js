// Standalone pelvic floor guide window (opened from Settings or the mini routine).
const theme = (s) => { document.documentElement.dataset.theme = s.theme || 'night'; };
window.api.getSettings().then(theme);
window.api.onSettings(theme);
window.PelvicGuide.mount(document.getElementById('guide'), {
  closeLabel: 'Got it',
  onClose: () => {
    window.api.setSettings({ standGuideSeen: true });
    window.close();
  },
});
