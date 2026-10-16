// Deployment settings stay outside the saved model/credential configuration.
export function loadNetworkConfig(env = process.env) {
  const listenHost = env.LISTEN_HOST || "127.0.0.1";
  // Both choices keep the console's internal gateway probe reachable on loopback.
  if (!["127.0.0.1", "0.0.0.0"].includes(listenHost)) throw new Error("LISTEN_HOST must be 127.0.0.1 or 0.0.0.0");
  function urlSetting(name, originOnly) {
    if (!env[name]) return null;
    try {
      const url = new URL(env[name]);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
          url.hostname.includes("*") || url.hostname === "0.0.0.0" ||
          (originOnly && url.pathname !== "/")) throw new Error();
      return originOnly ? url.origin : url.href.replace(/\/$/, "");
    } catch { throw new Error(`Invalid ${name}: use an http(s) ${originOnly ? "origin without a path" : "URL"}, without credentials, query or fragment`); }
  }
  return { listenHost, guiOrigin: urlSetting("GUI_ORIGIN", true), gatewayPublicUrl: urlSetting("GATEWAY_PUBLIC_URL", false) };
}

export function consoleRequestAccess(headers, port, guiOrigin) {
  const localHosts = ["127.0.0.1", "localhost"].flatMap(name => port === 80 ? [name, name + ":80"] : [name + ":" + port]);
  const publicUrl = guiOrigin ? new URL(guiOrigin) : null;
  const isPublic = publicUrl !== null && publicUrl.host === headers.host;
  if (!isPublic && !localHosts.includes(headers.host)) return { allowed: false };
  const expectedOrigin = isPublic ? publicUrl.origin : new URL("http://" + headers.host).origin;
  return {
    allowed: (!headers.origin || headers.origin === expectedOrigin) && headers["sec-fetch-site"] !== "cross-site",
    secure: isPublic && publicUrl.protocol === "https:",
  };
}
