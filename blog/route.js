if (document.documentElement.classList.contains("home-page")) {
  try {
    const snapshot = JSON.parse(document.querySelector("#featured-snapshot")?.dataset.value || "null");
    if (snapshot) {
      const preload = document.createElement("link");
      preload.rel = "preload";
      preload.as = "image";
      preload.href = "featured.jpg?v=" + snapshot.version;
      document.head.append(preload);
    }
  } catch { /* The live image is still available. */ }
}
