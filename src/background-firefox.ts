/**
 * Firefox has no offscreen documents, and its background is an event page
 * with a DOM, so the page hosts both composition roots: the feature handlers
 * Chrome's service worker registers, and the dictionaries and OCR model
 * Chrome keeps in the offscreen document.
 */
import './service-worker.js';
import './offscreen/offscreen.js';
