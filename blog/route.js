if (document.documentElement.classList.contains("home-page")) {
  try {
    const snapshot = JSON.parse(document.querySelector("#featured-snapshot")?.dataset.value || "null");
    if (typeof snapshot?.version === "string" && /^[0-9a-f]{16}$/.test(snapshot.version)) {
      const preload = document.createElement("link");
      preload.rel = "preload";
      preload.as = "image";
      preload.href = "featured.webp?v=" + encodeURIComponent(snapshot.version);
      document.head.append(preload);
    }
  } catch { /* The live image is still available. */ }
}
