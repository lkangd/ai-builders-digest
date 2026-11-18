import { parse } from 'parse5';

export function parseHtml(html) {
  return parse(html);
}

export function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
}

export function textOf(node) {
  if (!node) return '';
  if (node.nodeName === '#text') return node.value;
  return (node.childNodes || []).map(textOf).join('');
}

export function attr(node, name) {
  return node.attrs?.find(item => item.name === name)?.value ?? '';
}

export function byTag(root, tagName) {
  const found = [];
  walk(root, node => {
    if (node.tagName === tagName) found.push(node);
  });
  return found;
}

export function byId(root, id) {
  let found = null;
  walk(root, node => {
    if (attr(node, 'id') === id) found = node;
  });
  return found;
}

export function byClass(root, className) {
  const found = [];
  walk(root, node => {
    if (attr(node, 'class').split(/\s+/).includes(className)) found.push(node);
  });
  return found;
}
