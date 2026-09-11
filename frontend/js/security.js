(function () {
  window.ASOC_CSRF = "";
  window.asocSecurityReady = fetch("/api/security/session", { credentials: "include" })
    .then(function (res) {
      return res.json();
    })
    .then(function (data) {
      window.ASOC_CSRF = data.csrf || "";
      var bar = document.getElementById("cookie-policy");
      if (bar) bar.hidden = false;
      var status = document.getElementById("cookie-status");
      if (status) {
        status.textContent =
          "Cookies: asoc.sid (HttpOnly session) · asoc.csrf (SameSite=Lax). CSRF header ready.";
      }
      return data;
    })
    .catch(function () {
      return {};
    });

  window.asocFetch = function (url, opts) {
    opts = opts || {};
    return window.asocSecurityReady.then(function () {
      var headers = Object.assign({}, opts.headers || {});
      if (window.ASOC_CSRF) headers["x-csrf-token"] = window.ASOC_CSRF;
      return fetch(
        url,
        Object.assign({ credentials: "include" }, opts, { headers: headers }),
      );
    });
  };
})();
