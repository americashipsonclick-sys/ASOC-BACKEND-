(function () {
  if (document.getElementById("asoc-chain-launcher")) return;
  var src = (document.currentScript && document.currentScript.getAttribute("data-src")) ||
    "http://localhost:3001/chain.html";
  var btn = document.createElement("button");
  btn.id = "asoc-chain-launcher";
  btn.textContent = "ASOC WALLET";
  btn.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#0F5132;color:#F4EFE0;border:2px solid #14171A;padding:10px 14px;font:700 12px/1 system-ui,sans-serif;letter-spacing:.06em;cursor:pointer;";
  var frame = document.createElement("iframe");
  frame.title = "ASOC chain";
  frame.src = src;
  frame.style.cssText =
    "display:none;position:fixed;right:16px;bottom:56px;z-index:2147483647;width:min(420px,calc(100vw - 24px));height:min(640px,calc(100vh - 80px));border:3px solid #14171A;background:#F4EFE0;";
  btn.onclick = function () {
    frame.style.display = frame.style.display === "none" ? "block" : "none";
  };
  document.body.appendChild(frame);
  document.body.appendChild(btn);
})();
