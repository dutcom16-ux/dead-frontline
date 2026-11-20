// Isometric 2.5D tactical camera: orthographic projection at a fixed elevation, 90° rotation steps,
// edge scrolling, keyboard pan, wheel zoom to cursor, drag-to-pan, map bounds and smoothing.
import { clamp, lerp } from "../core";

export class IsoCamera {
  x = 0; y = 0; z = 0;          // smoothed target (map metres)
  tx = 0; ty = 0;               // desired target
  zoom = 70; tzoom = 70;        // half height of the view in metres
  yaw = Math.PI / 4; tyaw = Math.PI / 4;
  pitch = 0.87;                 // ~50° down: readable streets and building sides
  minZoom = 10; maxZoom = 900;
  bounds: [number, number, number, number];
  edge = true;
  constructor(bounds: [number, number, number, number], cx: number, cy: number) {
    this.bounds = bounds;
    this.x = this.tx = cx; this.y = this.ty = cy;
  }
  get forward(): [number, number] { return [Math.sin(this.yaw), Math.cos(this.yaw)]; }
  get right(): [number, number] { return [Math.cos(this.yaw), -Math.sin(this.yaw)]; }
  pan(dxScreen: number, dyScreen: number, metresPerPx: number) {
    // screen-space drag -> ground-space move (the ground is foreshortened vertically)
    const [fx, fy] = this.forward, [rx, ry] = this.right;
    const k = metresPerPx;
    this.tx -= (rx * dxScreen - fx * dyScreen / Math.sin(this.pitch)) * k;
    this.ty -= (ry * dxScreen - fy * dyScreen / Math.sin(this.pitch)) * k;
    this.clampTarget();
  }
  move(ax: number, ay: number, dt: number) {
    const [fx, fy] = this.forward, [rx, ry] = this.right;
    const sp = this.zoom * 1.6;
    this.tx += (rx * ax + fx * ay) * sp * dt;
    this.ty += (ry * ax + fy * ay) * sp * dt;
    this.clampTarget();
  }
  rotate(steps: number) { this.tyaw += steps * Math.PI / 2; }
  zoomBy(f: number) { this.tzoom = clamp(this.tzoom * f, this.minZoom, this.maxZoom); }
  lookAt(x: number, y: number, zoom?: number) { this.tx = x; this.ty = y; if (zoom) this.tzoom = zoom; this.clampTarget(); }
  snap() { this.x = this.tx; this.y = this.ty; this.zoom = this.tzoom; this.yaw = this.tyaw; }
  clampTarget() {
    const b = this.bounds;
    this.tx = clamp(this.tx, b[0], b[2]);
    this.ty = clamp(this.ty, b[1], b[3]);
  }
  update(dt: number, groundZ: (x: number, y: number) => number) {
    const k = 1 - Math.exp(-dt * 10);
    this.x = lerp(this.x, this.tx, k);
    this.y = lerp(this.y, this.ty, k);
    this.zoom = lerp(this.zoom, this.tzoom, k);
    this.yaw = lerp(this.yaw, this.tyaw, k);
    this.z = lerp(this.z, groundZ(this.x, this.y), k);
  }
  /** view description for the renderer (orthographic) */
  view(time: number) {
    const D = 1500, [fx, fy] = this.forward;
    const ch = Math.cos(this.pitch) * D;
    const eye = [this.x - fx * ch, this.z + Math.sin(this.pitch) * D, -(this.y - fy * ch)];
    const target = [this.x, this.z, -this.y];
    return { eye, target, ortho: this.zoom, fov: 0.9, near: 50, far: D * 2 + 2000, fog: [D + this.zoom * 3 + 400, D + this.zoom * 6 + 2600], time, occlusion: false };
  }
  /** ground extent visible on screen (for streaming and culling) */
  visibleRadius(aspect: number) { return this.zoom * Math.max(aspect, 1) * 1.6 + 60; }
}
