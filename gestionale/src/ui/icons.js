const paths = {
  camera:
    '<path d="M5 7.5h2.3l1.2-2h7l1.2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13.5" r="3.5"/>',
  mic:
    '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"/>',
  file:
    '<path d="M6 3h7l5 5v13H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M13 3v6h5M8 13h6M8 17h6"/>',
  barcode:
    '<path d="M4 5v14M7 5v14M11 5v14M14 5v14M18 5v14M21 5v14"/><path d="M2 8V4a2 2 0 0 1 2-2h4M22 8V4a2 2 0 0 0-2-2h-4M2 16v4a2 2 0 0 0 2 2h4M22 16v4a2 2 0 0 1-2 2h-4"/>',
  edit:
    '<path d="m14.5 5.5 4 4M4 20l1-4 10.8-10.8a2.1 2.1 0 0 1 3 3L8 19l-4 1Z"/><path d="M13 7l4 4"/>',
  upload:
    '<path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  drafts:
    '<path d="M6 3h7l5 5v13H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M13 3v6h5M8 14h7M8 18h5"/>',
  product:
    '<path d="m4 7.5 8-4.5 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4.5 7.5 7.5 4.2 7.5-4.2M12 12v9"/>',
  logout:
    '<path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 8l4 4-4 4M8 12h10"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  sync:
    '<path d="M20 7h-5V2M4 17h5v5"/><path d="M18.5 9A7 7 0 0 0 6.2 5.2L4 7M5.5 15A7 7 0 0 0 17.8 18.8L20 17"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash:
    '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 5"/>',
  alert:
    '<path d="M10.3 4.2 2.7 18a2 2 0 0 0 1.8 3h15a2 2 0 0 0 1.8-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

export function icon(name, className = 'icon') {
  const content = paths[name] || paths.product;
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
}
