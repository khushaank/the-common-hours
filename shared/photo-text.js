export function photoText(value) {
  const text = String(value || "").trim();
  return /https?:\/\/|www\.|\butm[_ ]|\.(?:jpe?g|png|webp|gif|avif)(?:\b|[?#])|\b[\w-]{10,}\s+unsplash\b/i.test(text) ? "" : text;
}

export function publicPhoto(photo, mediaAlt) {
  return { ...photo, title: photoText(photo.title) || "Untitled photograph",
    alt: photoText(photo.alt) || (typeof mediaAlt === "string" && photoText(mediaAlt)) || photoText(photo.title) || "Photograph" };
}
