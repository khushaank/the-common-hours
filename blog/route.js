// Reserve the correct first-paint layout before asynchronous data requests.
const route = new URLSearchParams(location.search);
if (route.get("post")) document.body.classList.add("article-page");
if (!["view", "post", "month", "tag", "series", "page"].some(key => route.has(key))) {
  document.body.classList.add("home-page");
  document.querySelector("#week-photo").hidden = false;
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
