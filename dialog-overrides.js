(function () {
  "use strict";

  if (window.__amrita_dialog_overridden) return;
  window.__amrita_dialog_overridden = true;

  window.confirm = function (message) {
    console.log("[Amrita Page] Auto-accepting native confirm:", message);
    return true;
  };

  window.alert = function (message) {
    console.log("[Amrita Page] Auto-dismissing native alert:", message);
    return true;
  };
})();
