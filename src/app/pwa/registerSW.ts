export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  // En desarrollo evitamos cache persistente para ver cambios de UI al instante.
  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    void navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const reg of regs) {
        void reg.unregister();
      }
    });
    return;
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
