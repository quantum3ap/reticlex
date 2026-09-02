/**
 * Canvas renderer for resolved crosshair geometry.
 *
 * Shapes arrive already positioned and rotated from the core; all this layer
 * does is turn them into canvas paths. Each paint group is drawn as a single
 * path so overlapping arms union under the non-zero winding rule instead of
 * blending twice — the same rule the native rasteriser follows, which is what
 * keeps the on-screen preview and an exported PNG identical.
 */

export const LAYER_OUTLINE = 0;
export const LAYER_LINES = 1;
export const LAYER_DOT = 2;
const LAYER_ORDER = [LAYER_OUTLINE, LAYER_LINES, LAYER_DOT];

const SHAPE_RECT = 0;
const SHAPE_ELLIPSE = 1;

function toCss({ r, g, b }) {
  const channel = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
}

/** roundRect landed late in some engines; fall back to arcs when missing. */
function addRoundedRect(ctx, hw, hh, radius) {
  const r = Math.min(radius, hw, hh);
  if (r <= 0.01) {
    ctx.rect(-hw, -hh, hw * 2, hh * 2);
    return;
  }
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(-hw, -hh, hw * 2, hh * 2, r);
    return;
  }
  ctx.moveTo(-hw + r, -hh);
  ctx.lineTo(hw - r, -hh);
  ctx.arcTo(hw, -hh, hw, -hh + r, r);
  ctx.lineTo(hw, hh - r);
  ctx.arcTo(hw, hh, hw - r, hh, r);
  ctx.lineTo(-hw + r, hh);
  ctx.arcTo(-hw, hh, -hw, hh - r, r);
  ctx.lineTo(-hw, -hh + r);
  ctx.arcTo(-hw, -hh, -hw + r, -hh, r);
  ctx.closePath();
}

/**
 * Draws geometry into a 2D context.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{shapes:Array}} geometry as returned by ReticleCore.buildGeometry
 * @param {{zoom:number, originX:number, originY:number, opacity?:number}} view
 *        origin is in device pixels; zoom already includes devicePixelRatio
 */
export function drawGeometry(ctx, geometry, view) {
  const { zoom, originX, originY, opacity = 1 } = view;
  if (!geometry || geometry.shapes.length === 0) return;

  const previousAlpha = ctx.globalAlpha;
  for (const layer of LAYER_ORDER) {
    const shapes = geometry.shapes.filter((shape) => shape.layer === layer);
    if (shapes.length === 0) continue;

    const alpha = shapes[0].a * opacity;
    if (alpha <= 0) continue;

    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = toCss(shapes[0]);
    ctx.beginPath();

    for (const shape of shapes) {
      // Compose base * translate(cx, cy) * rotate(angle) so the sub-path can be
      // added in the shape's own frame. Changing the transform mid-path is
      // legal and applies to the commands that follow it.
      const cos = Math.cos(shape.angle);
      const sin = Math.sin(shape.angle);
      ctx.setTransform(
        zoom * cos,
        zoom * sin,
        -zoom * sin,
        zoom * cos,
        originX + zoom * shape.cx,
        originY + zoom * shape.cy,
      );
      if (shape.kind === SHAPE_ELLIPSE) {
        ctx.ellipse(0, 0, Math.max(shape.hw, 0.01), Math.max(shape.hh, 0.01), 0, 0, Math.PI * 2);
      } else {
        addRoundedRect(ctx, shape.hw, shape.hh, shape.radius);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fill();
  }
  ctx.globalAlpha = previousAlpha;
}

/**
 * Sizes a canvas to its CSS box at the current device pixel ratio.
 * @returns {{width:number, height:number, dpr:number}} device dimensions
 */
export function resizeCanvas(canvas, cssWidth, cssHeight) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return { width, height, dpr };
}

/** Zoom that fits geometry inside a box, leaving `margin` CSS pixels around it. */
export function fitZoom(geometry, boxWidth, boxHeight, margin = 8) {
  const availableW = Math.max(boxWidth - margin * 2, 1);
  const availableH = Math.max(boxHeight - margin * 2, 1);
  if (!geometry || (geometry.extentW <= 0 && geometry.extentH <= 0)) return 1;
  const zx = geometry.extentW > 0 ? availableW / geometry.extentW : Infinity;
  const zy = geometry.extentH > 0 ? availableH / geometry.extentH : Infinity;
  return Math.max(0.1, Math.min(zx, zy, 64));
}

/**
 * Renders a crosshair into a small square canvas, scaled to fit.
 * Used by the card thumbnails on Home and Presets.
 */
export function renderThumbnail(canvas, core, config, size = 96) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Prefer the box CSS actually gave the canvas; fall back to the requested
  // size while the element is still off-document.
  const rect = canvas.getBoundingClientRect();
  const boxW = rect.width > 0 ? rect.width : size;
  const boxH = rect.height > 0 ? rect.height : size;
  const { width, height, dpr } = resizeCanvas(canvas, boxW, boxH);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const geometry = core.buildGeometry(config);
  if (geometry.shapes.length === 0) return;

  // Fit, but never blow a three-pixel dot up to fill the card: a capped zoom
  // keeps thumbnails comparable with each other.
  const zoom = Math.min(fitZoom(geometry, boxW, boxH, Math.max(8, boxW * 0.1)), 12) * dpr;
  drawGeometry(ctx, geometry, { zoom, originX: width / 2, originY: height / 2 });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Produces a transparent PNG data URL of a crosshair at a given pixel size. */
export function toPngDataUrl(core, config, size = 512, zoom = null) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  const geometry = core.buildGeometry(config);
  const scale = zoom ?? fitZoom(geometry, size, size, size * 0.08);
  drawGeometry(ctx, geometry, { zoom: scale, originX: size / 2, originY: size / 2 });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas.toDataURL('image/png');
}
