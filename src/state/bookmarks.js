/** 本机收藏（不参与领养服务，纯 localStorage）。 */

const KEY = "eco-bookmarks-v1";
const MAX = 50;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (b) =>
        b &&
        typeof b.id === "string" &&
        typeof b.inchikey === "string" &&
        typeof b.name === "string"
    );
  } catch (_) {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (_) {}
  window.dispatchEvent(new CustomEvent("eco-bookmarks"));
}

export function listBookmarks() {
  return read();
}

export function isBookmarked(id) {
  return read().some((b) => b.id === id);
}

/**
 * @param {{id:string,name:string,organismZh?:string,inchikey:string}} entry
 */
export function toggleBookmark(entry) {
  if (!entry?.id || !entry.inchikey) return read();
  const list = read();
  const i = list.findIndex((b) => b.id === entry.id);
  if (i >= 0) list.splice(i, 1);
  else list.unshift(entry);
  write(list.slice(0, MAX));
  return read();
}

export function removeBookmark(id) {
  const list = read().filter((b) => b.id !== id);
  write(list);
  return list;
}
