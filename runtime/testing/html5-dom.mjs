import { parse } from 'parse5';

export function parseHtml(html) {
  return parse(html, { sourceCodeLocationInfo: false });
}

export function classNames(node) {
  const value = node.attrs?.find(attr => attr.name === 'class')?.value || '';
  return value.split(/\s+/).filter(Boolean);
}

export function textOf(node) {
  if (!node) return '';
  if (node.nodeName === '#text') return node.value;
  return (node.childNodes || []).map(textOf).join('');
}

export function elementsByClass(root, className) {
  const found = [];
  walk(root, node => {
    if (node.tagName && classNames(node).includes(className)) found.push(node);
  });
  return found;
}

export function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
}

export function treeOrder(root, needles) {
  const hits = [];
  walk(root, node => {
    if (node.nodeName !== '#text') return;
    for (const needle of needles) {
      if (node.value.includes(needle)) hits.push(needle);
    }
  });
  return hits;
}

export function hasTag(node, tagName) {
  if (node.tagName === tagName) return true;
  return (node.childNodes || []).some(child => hasTag(child, tagName));
}

const SEGMENT = /<div class="fb-segment"([^>]*)>\s*<div class="fb-segment-en"[^>]*>([\s\S]*?)<\/div>\s*<div class="fb-translation"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;

export function withIllegalSegmentRows(html) {
  return html.replace(SEGMENT, (match, attrs, english, chinese) => {
    return `<div class="fb-segment"${attrs}>${english}</div><tr><td class="fb-translation">${chinese}</td></tr>`;
  });
}

export function withIllegalQuoteRow(html) {
  return html.replace(
    /<div class="fb-translation"[^>]*>[\s\S]*?引用正文译文[\s\S]*?<\/div>/,
    '<tr><td class="fb-translation">引用正文译文</td></tr>'
  );
}
