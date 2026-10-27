'use strict';

// On Linux, focusable:false creates an unmanaged X11 window and setFocusable
// cannot change it later. Keep it managed from creation and show it inactive.
function inputWindowOptions(platform = process.platform) {
  return { focusable: platform === 'linux' };
}

function focusInput(overlay, enabled, platform = process.platform) {
  if (!overlay || overlay.isDestroyed()) return false;
  if (platform !== 'linux') overlay.setFocusable(Boolean(enabled));
  if (enabled) {
    overlay.focus();
    overlay.webContents.focus();
  } else overlay.blur();
  return true;
}

module.exports = { inputWindowOptions, focusInput };
