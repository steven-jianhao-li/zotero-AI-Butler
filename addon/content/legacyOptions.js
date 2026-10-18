window.addEventListener("load", function () {
  var host = Components.classes["@zotero.org/Zotero;1"].getService(
    Components.interfaces.nsISupports,
  ).wrappedJSObject;
  var button = document.getElementById("ai-butler-open-settings");
  button.addEventListener("command", function () {
    host.__addonInstance__.hooks.onOpenSettings();
  });
});
