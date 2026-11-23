import Turndown from "./turndown.js";
import { loadImageSlot, renderMarkup } from "./rich.js";

const converter = new Turndown({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*", br: "" });
const label = text => text.replace(/[\\[\]*_<>]/g, "\\$&").replace(/[\r\n]+/g, " ");
converter.addRule("storedMarkup", {
  filter: node => node.hasAttribute("data-editor-markdown"),
  replacement: (_, node) => node.dataset.editorMarkdown,
});
converter.addRule("attachment", {
  filter: node => node.hasAttribute("data-attachment"),
  replacement: (content, node) => "[" + content + "](attachment:" + node.dataset.attachment + ")",
});
converter.addRule("strike", { filter: ["s", "del", "strike"], replacement: content => "~~" + content + "~~" });
converter.addRule("listStyle", {
  filter: node => node.matches("ul.square-list > li, ol[type=a] > li"),
  replacement: (content, node) => {
    const list = node.parentElement;
    const prefix = list.tagName === "UL" ? "+   " :
      (Number(list.getAttribute("start") || 1) + [...list.children].indexOf(node)) + ")  ";
    const paragraph = /\n$/.test(content) ? "\n" : "";
    const indented = content.trim().replace(/\n/g, "\n" + " ".repeat(prefix.length));
    return prefix + indented + paragraph + (node.nextSibling ? "\n" : "");
  },
});
converter.addRule("table", {
  filter: "table",
  replacement: (_, table) => {
    const rows = [...table.rows].map(row => [...row.cells].map(cell =>
      converter.turndown(cell).replace(/(?<!\\)\|/g, "\\|").replace(/\n+/g, " ")));
    if (!rows.length) return "";
    const alignment = [...table.rows[0].cells].map(cell => ({ left: ":---", center: ":---:", right: "---:" })[cell.style.textAlign] || "---");
    rows.splice(1, 0, alignment);
    return "\n\n" + rows.map(row => "| " + row.join(" | ") + " |").join("\n") + "\n\n";
  },
});

function stored(node, markdown) {
  const replacement = document.createElement("span");
  replacement.dataset.editorMarkdown = markdown;
  replacement.textContent = "x";
  node.replaceWith(replacement);
}

function imageMarkup(node, caption) {
  const title = caption ? ' "' + caption.replace(/[\\"]/g, "\\$&").replace(/\n+/g, " ") + '"' : "";
  return "![" + label(node.dataset.alt || "") + "](media:" + node.dataset.image + title + ")";
}

export function visualMarkdown(target) {
  const copy = target.cloneNode(true);
  for (const figure of copy.querySelectorAll(".captioned-photo")) {
    const image = figure.querySelector("[data-image]");
    if (image) stored(figure, "\n\n" + imageMarkup(image, figure.querySelector("figcaption")?.textContent.trim()) + "\n\n");
  }
  for (const image of copy.querySelectorAll("[data-image]")) stored(image, imageMarkup(image));
  for (const video of copy.querySelectorAll(".video")) {
    const href = video.querySelector(".video-link")?.getAttribute("href");
    if (!href) continue;
    const title = video.querySelector(".video-caption")?.textContent.trim();
    stored(video, "\n\n" + (title ? "[" + label(title) + "](<" + href + ">)" : "::video " + href) + "\n\n");
  }
  for (const check of copy.querySelectorAll(".task-check")) stored(check, check.checked ? "[x]" : "[ ]");
  for (const reference of copy.querySelectorAll(".footnote-ref")) {
    const id = reference.querySelector("a")?.getAttribute("href")?.slice(1);
    if (id) stored(reference, "[^" + id + "]");
  }
  const notes = [];
  for (const section of copy.querySelectorAll(".footnotes")) {
    for (const note of section.querySelectorAll(".footnote-item")) {
      note.querySelectorAll(".footnote-backref").forEach(link => link.remove());
      notes.push("[^" + note.id + "]: " + converter.turndown(note).replace(/\n/g, "\n    "));
    }
    section.remove();
  }
  copy.querySelectorAll(".footnotes-sep").forEach(rule => rule.remove());
  return [converter.turndown(copy), ...notes].filter(Boolean).join("\n\n");
}

export function createVisualEditor(target, loadImage) {
  let remembered;
  const selection = () => document.getSelection();
  const remember = () => {
    const selected = selection();
    if (selected?.rangeCount && target.contains(selected.getRangeAt(0).commonAncestorContainer)) {
      remembered = selected.getRangeAt(0).cloneRange();
    }
  };
  document.addEventListener("selectionchange", remember);
  target.addEventListener("click", event => { if (event.target.closest("a")) event.preventDefault(); });
  target.addEventListener("drop", event => event.preventDefault());
  target.addEventListener("paste", event => {
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") || "");
  });

  function range() {
    remember();
    if (remembered && target.contains(remembered.commonAncestorContainer)) return remembered.cloneRange();
    const end = document.createRange();
    end.selectNodeContents(target);
    end.collapse(false);
    return end;
  }

  function restore(saved) {
    target.focus();
    selection().removeAllRanges();
    selection().addRange(target.contains(saved.commonAncestorContainer) ? saved : range());
  }

  return {
    range,
    format(command, value) {
      restore(range());
      document.execCommand(command, false, value);
    },
    insert(markdown, start) {
      const fragment = document.createElement("template");
      fragment.innerHTML = renderMarkup(markdown, { docId: crypto.randomUUID() });
      for (const item of fragment.content.querySelectorAll(".media-slot, .video, .footnote-ref, .footnotes")) {
        item.contentEditable = "false";
      }
      const inline = markdown === markdown.trim() && fragment.content.firstElementChild?.tagName === "P" &&
        fragment.content.children.length === 1;
      restore(start);
      document.execCommand("insertHTML", false, inline ? fragment.content.firstElementChild.innerHTML : fragment.innerHTML);
      for (const image of target.querySelectorAll("[data-image][aria-busy]:empty")) void loadImageSlot(image, loadImage);
    },
  };
}
