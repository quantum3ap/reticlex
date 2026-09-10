/** The start-up sequence: it has to be skippable, optional and self-cleaning. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { INTRO_DURATION_MS, playIntro } from '../js/ui/intro.js';

/**
 * The smallest DOM the sequence touches. Building it here rather than pulling
 * in a browser keeps the suite dependency-free, which is the same bargain the
 * rest of these tests make.
 */
function fakeDocument() {
  const listeners = new Map();
  const make = (tag) => ({
    tag,
    className: '',
    style: { setProperty() {} },
    children: [],
    attributes: {},
    textContent: '',
    classList: {
      list: new Set(),
      add(...names) { for (const n of names) this.list.add(n); },
      remove(...names) { for (const n of names) this.list.delete(n); },
      contains(name) { return this.list.has(name); },
    },
    setAttribute(key, value) { this.attributes[key] = value; },
    append(...nodes) { this.children.push(...nodes); },
    remove() {
      const index = doc.body.children.indexOf(this);
      if (index >= 0) doc.body.children.splice(index, 1);
    },
    get lastChild() { return this.children[this.children.length - 1]; },
  });

  const doc = {
    body: make('body'),
    createElement: make,
    createElementNS: (_ns, tag) => make(tag),
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    fire(type) { for (const handler of [...(listeners.get(type) ?? [])]) handler({}); },
    listenerCount() { return [...listeners.values()].reduce((n, s) => n + s.size, 0); },
  };
  return doc;
}

const withStubs = async (matches, run) => {
  const media = globalThis.matchMedia;
  const raf = globalThis.requestAnimationFrame;
  globalThis.matchMedia = () => ({ matches });
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  try {
    return await run();
  } finally {
    globalThis.matchMedia = media;
    globalThis.requestAnimationFrame = raf;
  }
};

test('the sequence is skipped entirely when it is switched off', async () => {
  const doc = fakeDocument();
  const result = await withStubs(false, () => playIntro({
    enabled: false, sound: false, tagline: 'x', document: doc,
  }));
  assert.deepEqual(result, { played: false, skipped: false, heard: false });
  assert.equal(doc.body.children.length, 0, 'nothing should have been added to the page');
});

test('reduced motion wins over the setting', async () => {
  const doc = fakeDocument();
  const result = await withStubs(true, () => playIntro({
    enabled: true, sound: true, tagline: 'x', document: doc,
  }));
  assert.equal(result.played, false);
  assert.equal(doc.body.children.length, 0);
});

test('any key ends it early and tidies up after itself', async () => {
  const doc = fakeDocument();
  const started = Date.now();
  const pending = withStubs(false, () => playIntro({
    enabled: true, sound: false, tagline: 'ReticleX', document: doc,
  }));

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(doc.body.children.length, 1, 'the sequence should be on screen');
  doc.fire('keydown');

  const result = await pending;
  assert.equal(result.played, true);
  assert.equal(result.skipped, true);
  assert.ok(Date.now() - started < INTRO_DURATION_MS,
    'skipping must not wait out the full run time');
  assert.equal(doc.body.children.length, 0, 'the element must be removed, not just hidden');
  assert.equal(doc.listenerCount(), 0, 'both skip listeners must be detached');
});

test('a silent run still reports that it played', async () => {
  const doc = fakeDocument();
  const pending = withStubs(false, () => playIntro({
    enabled: true, sound: true, tagline: 'ReticleX', document: doc,
  }));
  await new Promise((resolve) => setTimeout(resolve, 40));
  doc.fire('pointerdown');
  const result = await pending;
  // No AudioContext exists under node, so the cues cannot have been heard.
  assert.equal(result.played, true);
  assert.equal(result.heard, false);
});

test('the scene carries the mark, the wordmark and the tagline', async () => {
  const doc = fakeDocument();
  const pending = withStubs(false, () => playIntro({
    enabled: true, sound: false, tagline: 'Crosshair Design Studio', document: doc,
  }));
  await new Promise((resolve) => setTimeout(resolve, 40));

  const host = doc.body.children[0];
  const scene = host.children[0];
  assert.equal(scene.className, 'intro__scene');
  const [mark, wordmark, tagline] = scene.children;
  assert.equal(mark.tag, 'svg');
  assert.equal(wordmark.children.length, 8, 'one span per letter of ReticleX');
  assert.equal(wordmark.children.map((c) => c.textContent).join(''), 'ReticleX');
  assert.equal(tagline.textContent, 'Crosshair Design Studio');

  doc.fire('keydown');
  await pending;
});
