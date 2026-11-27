// Minimal WebGL2 renderer (no dependencies, works offline).
import { buildAtlas, ATLAS_SIZE } from "./atlas.js";
import { STRIDE } from "./meshgen.js";

export const mat4 = {
  ortho(l, r, b, t, n, f) {
    return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0,
      -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookAt(e, c, up) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
    return o;
  },
  invert(m) {
    const inv = new Float32Array(16);
    const a = m;
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    det = det ? 1 / det : 0;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  },
  xform(m, x, y, z, w = 1) {
    return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w,
      m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w];
  },
};

const WORLD_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec2 a_uv;
layout(location=3) in vec4 a_col;
layout(location=4) in vec4 a_mat;
layout(location=5) in float a_bid;
uniform mat4 u_vp;
uniform highp sampler2D u_state;
out vec3 v_pos; out vec3 v_nrm; out vec2 v_uv; out vec3 v_col;
flat out vec4 v_mat; flat out vec4 v_state;
void main(){
  v_state = vec4(0.0);
  if (a_bid < 65534.5) { int b = int(a_bid + 0.5); v_state = texelFetch(u_state, ivec2(b % 1024, b / 1024), 0); }
  v_pos = a_pos; v_nrm = a_nrm; v_uv = a_uv; v_col = a_col.rgb; v_mat = a_mat;
  gl_Position = u_vp * vec4(a_pos, 1.0);
}`;
const WORLD_FS = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform vec3 u_sun, u_sunCol, u_sky, u_gnd, u_fogCol, u_cam;
uniform vec2 u_fog;
uniform float u_time;
in vec3 v_pos; in vec3 v_nrm; in vec2 v_uv; in vec3 v_col;
flat in vec4 v_mat; flat in vec4 v_state;
out vec4 o;
const float TS = 64.0 / 512.0;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec4 atlas(float t, vec2 uv){
  vec2 org = vec2(mod(t, 8.0), floor(t / 8.0)) * TS;
  vec2 ins = vec2(1.5 / 512.0);
  vec2 sc = vec2(TS) - 2.0 * ins;
  return textureGrad(u_atlas, org + ins + fract(uv) * sc, dFdx(uv) * sc, dFdy(uv) * sc);
}
void main(){
  int fl = int(v_mat.w + 0.5);
  int sf = int(v_state.g * 255.0 + 0.5);
  float dmg = floor(v_state.r * 255.0 / 64.0 + 0.5);
  bool roof = (fl & 1) != 0, door = (fl & 4) != 0;
  if (door && (sf & 1) != 0) discard;
  if (roof && ((sf & 2) != 0 || dmg > 2.5)) discard;
  vec3 n = normalize(v_nrm);
  bool back = !gl_FrontFacing && (fl & 16) == 0;
  if (!gl_FrontFacing) n = -n;
  vec3 base; float glass = 0.0;
  float tA = v_mat.x, tB = v_mat.y, lv = v_mat.z;
  if (tA < 254.5) {
    float t = tA;
    if (lv > 0.5) { float f = floor(v_uv.y); t = f < 1.0 ? tA : (f < lv ? tB : 0.0); }
    vec4 tx = atlas(t, v_uv);
    base = mix(tx.rgb, tx.rgb * v_col, tx.a);
    glass = (lv > 0.5 && tx.a < 0.5 && tx.b > tx.r) ? 1.0 : 0.0;
    if (back) { base = vec3(0.84, 0.81, 0.76) * (0.85 + 0.15 * tx.a); glass = 0.0; }
  } else {
    base = v_col;
    if (back) base *= 0.8;
  }
  if ((fl & 64) != 0) base *= 0.9 + 0.12 * hash(floor(v_pos.xz * 0.7));
  if ((fl & 8) != 0) {
    float c = abs(v_uv.x - 0.5);
    if (c < 0.02 + fwidth(v_uv.x) * 0.5 && fract(v_uv.y / 6.0) < 0.5) base = vec3(0.9, 0.88, 0.74);
  }
  if ((fl & 32) != 0) {
    float w = sin(v_pos.x * 0.35 + u_time * 1.3) * sin(v_pos.z * 0.3 - u_time * 1.1);
    base = v_col * (0.92 + 0.1 * w);
    n = normalize(vec3(w * 0.06, 1.0, w * 0.05));
  }
  if (lv > 0.5) base *= mix(0.78, 1.0, smoothstep(-0.2, 0.3, v_uv.y));
  if (dmg > 0.5) {
    float s = hash(floor(v_pos.xz * 1.7) + floor(v_pos.y * 2.0));
    base *= mix(1.0, 0.35 + 0.4 * s, min(dmg / 3.0 + 0.15, 0.85));
    if (glass > 0.5) base = vec3(0.06) + 0.1 * s;
  }
  float ndl = max(dot(n, u_sun), 0.0);
  vec3 amb = mix(u_gnd, u_sky, n.y * 0.5 + 0.5);
  vec3 col = base * (amb * 0.74 + u_sunCol * ndl * 0.66);
  if ((fl & 2) != 0) col *= 0.9;
  if (glass > 0.5) {
    vec3 v = normalize(u_cam - v_pos), h = normalize(v + u_sun);
    col += pow(max(dot(n, h), 0.0), 48.0) * 0.35 + 0.06 * (1.0 - abs(dot(n, v)));
  }
  if ((fl & 32) != 0) {
    vec3 v = normalize(u_cam - v_pos), h = normalize(v + u_sun);
    col += pow(max(dot(n, h), 0.0), 80.0) * 0.5;
  }
  if ((sf & 4) != 0) col = mix(col, vec3(1.0, 0.72, 0.12), 0.38);
  if ((sf & 8) != 0) col = mix(col, vec3(0.35, 0.8, 1.0), 0.28);
  float d = length(u_cam - v_pos);
  o = vec4(mix(col, u_fogCol, smoothstep(u_fog.x, u_fog.y, d)), 1.0);
}`;
const INST_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec3 a_col;
layout(location=3) in vec4 i_pos;   // x, y, z, scale
layout(location=4) in vec4 i_misc;  // rot, r, g, b
uniform mat4 u_vp;
out vec3 v_col; out vec3 v_nrm; out vec3 v_pos;
void main(){
  float c = cos(i_misc.x), s = sin(i_misc.x);
  vec3 p = a_pos * i_pos.w;
  p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z) + i_pos.xyz;
  v_nrm = vec3(c * a_nrm.x - s * a_nrm.z, a_nrm.y, s * a_nrm.x + c * a_nrm.z);
  v_col = a_col * i_misc.yzw;
  v_pos = p;
  gl_Position = u_vp * vec4(p, 1.0);
}`;
const INST_FS = `#version 300 es
precision highp float;
uniform vec3 u_sun, u_sunCol, u_sky, u_gnd, u_fogCol, u_cam;
uniform vec2 u_fog;
in vec3 v_col; in vec3 v_nrm; in vec3 v_pos;
out vec4 o;
void main(){
  vec3 n = normalize(v_nrm); if (!gl_FrontFacing) n = -n;
  vec3 amb = mix(u_gnd, u_sky, n.y * 0.5 + 0.5);
  vec3 col = v_col * (amb * 0.65 + u_sunCol * max(dot(n, u_sun), 0.0) * 0.7);
  o = vec4(mix(col, u_fogCol, smoothstep(u_fog.x, u_fog.y, length(u_cam - v_pos))), 1.0);
}`;
const LINE_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_vp;
void main(){ gl_Position = u_vp * vec4(a_pos, 1.0); }`;
const LINE_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 o;
void main(){ o = u_color; }`;
const SKY_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
uniform mat4 u_ivp;
out vec3 v_dir;
void main(){ vec2 p = P[gl_VertexID]; gl_Position = vec4(p, 0.9999, 1.0);
  vec4 a = u_ivp * vec4(p, -1.0, 1.0), b = u_ivp * vec4(p, 1.0, 1.0); v_dir = b.xyz / b.w - a.xyz / a.w; }`;
const SKY_FS = `#version 300 es
precision mediump float;
uniform vec3 u_fogCol, u_skyTop, u_sun;
in vec3 v_dir; out vec4 o;
void main(){ vec3 d = normalize(v_dir); float t = clamp(d.y * 2.2, 0.0, 1.0);
  vec3 c = mix(u_fogCol, u_skyTop, t); c += vec3(1.0, 0.9, 0.7) * pow(max(dot(d, u_sun), 0.0), 300.0) * 0.8;
  o = vec4(c, 1.0); }`;

// Pre-rendered sprites (town buildings, trees) placed in the 3D world. Each instance is a screen-aligned
// quad around its map pivot, drawn at the sprite's own pixel scale; its depth comes per pixel from the
// view ray hitting the object's box (building volume / tree) or else the ground, so sprites and the
// 3D world hide each other correctly. Pass 0 draws the solid pixels (depth written), pass 1 the soft
// ones (shadows, edges) over them without writing depth; pass 2 the soft batches (fire, smoke).
const SPR_VS = `#version 300 es
layout(location=0) in vec4 i_piv;   // pivot x, height, z (GL), scale
layout(location=1) in vec4 i_frm;   // frame x, y, w, h in atlas px
layout(location=2) in vec4 i_anc;   // anchor x, y in the frame, cos(front), sin(front)
layout(location=3) in vec4 i_box;   // box x0, x1, z0, z1 in sprite metres; x0 = x1: a billboard, z0 metres toward the camera
layout(location=4) in vec4 i_ext;   // box top, animation stride (px, 0 = still), phase, ground lift (sprite m)
uniform mat4 u_vp;
uniform vec2 u_vpx, u_tex;
uniform float u_k, u_time, u_frames, u_fps;
out vec2 v_uv; out vec2 v_ndc;
flat out vec4 v_piv; flat out vec4 v_box; flat out vec4 v_rot;
void main(){
  int c = gl_VertexID;
  vec2 q = vec2((c == 1 || c == 2 || c == 4) ? 1.0 : 0.0, (c == 2 || c == 4 || c == 5) ? 1.0 : 0.0);
  float col = i_ext.y > 0.0 ? mod(floor(u_time * u_fps + i_ext.z), u_frames) : 0.0;
  vec2 fpx = q * i_frm.zw;
  vec2 off = (fpx - i_anc.xy) * u_k * i_piv.w;
  vec4 pc = u_vp * vec4(i_piv.xyz, 1.0);
  vec2 ndc = pc.xy / pc.w + vec2(off.x, -off.y) * 2.0 / u_vpx;
  gl_Position = vec4(ndc, 0.0, 1.0);
  v_uv = (i_frm.xy + vec2(col * i_ext.y, 0.0) + fpx) / u_tex;
  v_ndc = ndc; v_piv = i_piv; v_box = i_box; v_rot = vec4(i_anc.zw, i_ext.x, i_ext.w);
}`;
const SPR_FS = `#version 300 es
precision highp float;
uniform sampler2D u_img;
uniform mat4 u_vp, u_ivp;
uniform vec3 u_fogCol, u_cam;
uniform vec2 u_fog;
uniform float u_pass;
in vec2 v_uv; in vec2 v_ndc;
flat in vec4 v_piv; flat in vec4 v_box; flat in vec4 v_rot;
out vec4 o;
void main(){
  vec4 t = texture(u_img, v_uv);
  if (t.a < 0.004 || (u_pass < 0.5 ? t.a < 0.5 : u_pass < 1.5 && t.a >= 0.5)) discard;
  vec4 a = u_ivp * vec4(v_ndc, -1.0, 1.0), b = u_ivp * vec4(v_ndc, 1.0, 1.0);
  vec3 ro = a.xyz / a.w, rd = normalize(b.xyz / b.w - ro);
  // sprite space: x = width, y = up, z = the front; metres before scaling
  vec3 X = vec3(-v_rot.x, 0.0, -v_rot.y), Z = vec3(v_rot.y, 0.0, -v_rot.x);
  vec3 p = (ro - v_piv.xyz) / v_piv.w;
  vec3 lo = vec3(dot(p, X), p.y, dot(p, Z)), ld = vec3(dot(rd, X), rd.y, dot(rd, Z));
  vec3 inv = 1.0 / ld;
  vec3 t0 = (vec3(v_box.x, v_rot.w, v_box.z) - lo) * inv, t1 = (vec3(v_box.y, v_rot.z, v_box.w) - lo) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float tin = max(max(tn.x, tn.y), tn.z), tout = min(min(tf.x, tf.y), tf.z);
  // the box, else the ground: lifted to the highest terrain under the sprite, so a slope never hides it;
  // fire and smoke stand on a plane facing the camera, a little in front of their source
  float th = v_box.x == v_box.y ? dot(v_piv.xyz - ro, rd) / v_piv.w - v_box.z
           : (tin <= tout && tout > 0.0) ? tin : (v_rot.w - lo.y) / ld.y;
  vec3 hit = ro + rd * (th * v_piv.w);
  vec4 cp = u_vp * vec4(hit, 1.0);
  gl_FragDepth = clamp(cp.z / cp.w * 0.5 + 0.5, 0.0, 1.0);
  float f = smoothstep(u_fog.x, u_fog.y, length(u_cam - hit));
  o = vec4(mix(t.rgb, u_fogCol * t.a, f), t.a);
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + src.split("\n").slice(0, 3).join("\n"));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: true, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;
    this.canvas = canvas;
    this.world = compile(gl, WORLD_VS, WORLD_FS);
    this.inst = compile(gl, INST_VS, INST_FS);
    this.line = compile(gl, LINE_VS, LINE_FS);
    this.sky = compile(gl, SKY_VS, SKY_FS);
    this.spr = compile(gl, SPR_VS, SPR_FS);
    this.skyVao = gl.createVertexArray();
    const atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ATLAS_SIZE, ATLAS_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildAtlas());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    this.atlas = atlas;
    this.emptyState = this.createState(1);
    this.boxGeo = this.makeBoxGeo();
    this.lineBuf = gl.createBuffer();
    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    this.sunDir = norm([0.45, 0.8, 0.35]);
    this.env = { sunCol: [1.0, 0.96, 0.88], sky: [0.62, 0.72, 0.85], gnd: [0.42, 0.4, 0.34], fog: [0.75, 0.8, 0.86], skyTop: [0.36, 0.56, 0.84] };
    this.occlusion = true;
    this.stats = {};
    this.gpuBytes = 0;
  }

  upload(m) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, m.vb, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, STRIDE, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE, 16);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, STRIDE, 24);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, false, STRIDE, 28);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.UNSIGNED_SHORT, false, STRIDE, 32);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.ib, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const bytes = m.vb.byteLength + m.ib.byteLength;
    this.gpuBytes += bytes;
    return { vao, vbo, ibo, count: m.ni, min: m.min, max: m.max, bytes, tris: m.ni / 3 };
  }
  // per-frame geometry (effects, decals): re-uses one buffer pair
  uploadDynamic(m, slot) {
    const gl = this.gl;
    if (!slot) slot = this.upload({ vb: new Uint8Array(36 * 4), ib: new Uint32Array(3), nv: 1, ni: 0, min: [0, 0, 0], max: [0, 0, 0] });
    gl.bindVertexArray(slot.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, slot.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, m.vb, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, slot.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.ib, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    slot.count = m.ni; slot.min = m.min; slot.max = m.max; slot.tris = m.ni / 3;
    return slot;
  }
  free(g) {
    if (!g) return;
    const gl = this.gl;
    gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.vbo); gl.deleteBuffer(g.ibo);
    this.gpuBytes -= g.bytes;
  }

  // per-chunk building state texture (damage, door open, roof cut, selection)
  createState(n) {
    const gl = this.gl;
    const w = 1024, h = Math.max(1, Math.ceil(n / 1024));
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const data = new Uint8Array(w * h * 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { tex, w, h, data, dirty: false };
  }
  syncState(st) {
    if (!st.dirty) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, st.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, st.w, st.h, gl.RGBA, gl.UNSIGNED_BYTE, st.data);
    st.dirty = false;
  }

  instMesh(verts, cols, nrms, idx) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const mk = (arr, loc, n) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
    };
    mk(verts, 0, 3); mk(nrms, 1, 3); mk(cols, 2, 3);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    const ibuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);
    return { vao, count: idx.length, ibuf, n: 0, cap: 0 };
  }
  setInstances(m, data, n) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, m.ibuf);
    if (data.byteLength > m.cap) { gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); m.cap = data.byteLength; }
    else gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n * 8));
    m.n = n;
  }

  // a sprite atlas page (premultiplied, mipmapped)
  spriteTexture(img) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 4);
    this.gpuBytes += img.width * img.height * 5.3;
    return { tex, w: img.width, h: img.height };
  }
  // instance buffer for a sprite batch (20 floats per instance)
  spriteBatch(slot, data, n) {
    const gl = this.gl;
    if (!slot) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (let k = 0; k < 5; k++) { gl.enableVertexAttribArray(k); gl.vertexAttribPointer(k, 4, gl.FLOAT, false, 80, k * 16); gl.vertexAttribDivisor(k, 1); }
      gl.bindVertexArray(null);
      slot = { vao, buf, cap: 0, n: 0 };
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, slot.buf);
    if (data.byteLength > slot.cap) { gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); slot.cap = data.byteLength; }
    else gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n * 20));
    slot.n = n;
    return slot;
  }

  makeBoxGeo() {
    const gl = this.gl;
    const v = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]);
    const i = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, i, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr || 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  // view: {eye, target, fov, near, far, fog:[n,f], time}
  // scene: {ground: [{g, layer}], buildings: [{g, state, chunk}], inst: [{m}], lines: [{pts:Float32Array, color}]}
  render(view, scene) {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const aspect = this.canvas.width / this.canvas.height;
    // view.ortho = half height of the view in metres (isometric RTS camera); otherwise perspective
    const P = view.ortho ? mat4.ortho(-view.ortho * aspect, view.ortho * aspect, -view.ortho, view.ortho, view.near, view.far)
      : mat4.perspective(view.fov, aspect, view.near, view.far);
    const V = mat4.lookAt(view.eye, view.target, [0, 1, 0]);
    const VP = mat4.mul(P, V);
    this.VP = VP;
    this.IVP = mat4.invert(VP);
    const planes = frustumPlanes(VP);
    const st = (this.stats = { drawn: 0, culled: 0, occluded: 0, tris: 0, queries: 0, ground: 0 });
    gl.clearColor(...this.env.fog, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    // sky
    gl.depthMask(false);
    gl.useProgram(this.sky.p);
    gl.uniformMatrix4fv(this.sky.u.u_ivp, false, this.IVP);
    gl.uniform3fv(this.sky.u.u_fogCol, this.env.fog);
    gl.uniform3fv(this.sky.u.u_skyTop, this.env.skyTop);
    gl.uniform3fv(this.sky.u.u_sun, this.sunDir);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);

    const W = this.world;
    gl.useProgram(W.p);
    gl.uniformMatrix4fv(W.u.u_vp, false, VP);
    gl.uniform3fv(W.u.u_sun, this.sunDir);
    gl.uniform3fv(W.u.u_sunCol, this.env.sunCol);
    gl.uniform3fv(W.u.u_sky, this.env.sky);
    gl.uniform3fv(W.u.u_gnd, this.env.gnd);
    gl.uniform3fv(W.u.u_fogCol, this.env.fog);
    gl.uniform3fv(W.u.u_cam, view.eye);
    gl.uniform2fv(W.u.u_fog, view.fog);
    gl.uniform1f(W.u.u_time, view.time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(W.u.u_atlas, 0);
    gl.uniform1i(W.u.u_state, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.emptyState.tex);

    // ground, layer by layer (polygon offset keeps coplanar decals stable at distance)
    gl.enable(gl.POLYGON_OFFSET_FILL);
    const ground = scene.ground.slice().sort((a, b) => a.layer - b.layer);
    for (const it of ground) {
      if (!aabbVisible(planes, it.g.min, it.g.max)) continue;
      gl.polygonOffset(-0.6 * it.layer, -3 * it.layer);
      gl.bindVertexArray(it.g.vao);
      gl.drawElements(gl.TRIANGLES, it.g.count, gl.UNSIGNED_INT, 0);
      st.ground++;
      st.tris += it.g.tris;
    }
    gl.polygonOffset(0, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // buildings: front to back; occlusion queries for chunks beyond the near ring
    const eye = view.eye;
    const items = [];
    for (const it of scene.buildings) {
      if (!aabbVisible(planes, it.g.min, it.g.max)) { st.culled++; continue; }
      const cx = (it.g.min[0] + it.g.max[0]) / 2 - eye[0], cz = (it.g.min[2] + it.g.max[2]) / 2 - eye[2];
      it.dist = Math.hypot(cx, cz);
      items.push(it);
    }
    items.sort((a, b) => a.dist - b.dist);
    const useOcc = this.occlusion && view.occlusion !== false;
    const queried = [];
    for (const it of items) {
      const oc = it.occ || (it.occ = { q: null, visible: true, pending: false });
      if (oc.pending && gl.getQueryParameter(oc.q, gl.QUERY_RESULT_AVAILABLE)) {
        oc.visible = gl.getQueryParameter(oc.q, gl.QUERY_RESULT) > 0;
        oc.pending = false;
      }
      const inside = eye[0] > it.g.min[0] - 8 && eye[0] < it.g.max[0] + 8 && eye[2] > it.g.min[2] - 8 && eye[2] < it.g.max[2] + 8;
      const near = inside || it.dist < 90;
      if (useOcc && !near && !oc.visible) { st.occluded++; queried.push(it); continue; }
      if (it.state) { this.syncState(it.state); gl.bindTexture(gl.TEXTURE_2D, it.state.tex); }
      else gl.bindTexture(gl.TEXTURE_2D, this.emptyState.tex);
      gl.bindVertexArray(it.g.vao);
      gl.drawElements(gl.TRIANGLES, it.g.count, gl.UNSIGNED_INT, 0);
      st.drawn++;
      st.tris += it.g.tris;
      if (useOcc && !near) queried.push(it);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.emptyState.tex);

    // pre-rendered town sprites: solid pixels first, then shadows and soft edges
    if (scene.sprites && scene.sprites.length) {
      const S = this.spr;
      gl.useProgram(S.p);
      gl.uniformMatrix4fv(S.u.u_vp, false, VP);
      gl.uniformMatrix4fv(S.u.u_ivp, false, this.IVP);
      gl.uniform2f(S.u.u_vpx, this.canvas.width, this.canvas.height);
      gl.uniform1f(S.u.u_time, view.time);
      gl.uniform3fv(S.u.u_fogCol, this.env.fog);
      gl.uniform3fv(S.u.u_cam, view.eye);
      gl.uniform2fv(S.u.u_fog, view.fog);
      gl.uniform1i(S.u.u_img, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const devPpm = this.canvas.height / (2 * (view.ortho || 1));
      for (const pass of [0, 1, 2]) {
        gl.uniform1f(S.u.u_pass, pass);
        gl.depthMask(pass === 0);
        for (const sb of scene.sprites) {
          if (!sb.slot || !sb.slot.n || !!sb.soft !== (pass === 2)) continue;
          gl.bindTexture(gl.TEXTURE_2D, sb.tex.tex);
          gl.uniform2f(S.u.u_tex, sb.tex.w, sb.tex.h);
          gl.uniform1f(S.u.u_k, devPpm / sb.ppm);
          gl.uniform1f(S.u.u_frames, sb.frames || 4);
          gl.uniform1f(S.u.u_fps, sb.fps || 4);
          gl.bindVertexArray(sb.slot.vao);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, sb.slot.n);
          st.tris += 2 * sb.slot.n;
        }
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE1);
    }

    // instanced trees / characters
    const I = this.inst;
    gl.useProgram(I.p);
    gl.uniformMatrix4fv(I.u.u_vp, false, VP);
    for (const k of ["u_sun", "u_sunCol", "u_sky", "u_gnd", "u_fogCol"]) gl.uniform3fv(I.u[k], k === "u_sun" ? this.sunDir : this.env[{ u_sunCol: "sunCol", u_sky: "sky", u_gnd: "gnd", u_fogCol: "fog" }[k]]);
    gl.uniform3fv(I.u.u_cam, view.eye);
    gl.uniform2fv(I.u.u_fog, view.fog);
    for (const it of scene.inst) {
      if (!it.m.n) continue;
      gl.bindVertexArray(it.m.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, it.m.count, gl.UNSIGNED_SHORT, 0, it.m.n);
      st.tris += (it.m.count / 3) * it.m.n;
    }

    // lines (debug overlays: nav paths, LOS rays, chunk bounds)
    if (scene.lines && scene.lines.length) {
      gl.useProgram(this.line.p);
      gl.uniformMatrix4fv(this.line.u.u_vp, false, VP);
      gl.bindVertexArray(this.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.disable(gl.DEPTH_TEST);
      for (const L of scene.lines) {
        gl.uniform4fv(this.line.u.u_color, L.color);
        gl.bufferData(gl.ARRAY_BUFFER, L.pts, gl.DYNAMIC_DRAW);
        gl.drawArrays(L.strip ? gl.LINE_STRIP : gl.LINES, 0, L.pts.length / 3);
      }
      gl.enable(gl.DEPTH_TEST);
    }

    // occlusion queries: chunk AABBs against the depth buffer just drawn (results used next frames)
    if (useOcc && queried.length) {
      gl.useProgram(this.line.p);
      gl.colorMask(false, false, false, false);
      gl.depthMask(false);
      gl.bindVertexArray(this.boxGeo.vao);
      for (const it of queried) {
        const oc = it.occ;
        if (oc.pending) continue;
        if (!oc.q) oc.q = gl.createQuery();
        const mn = it.g.min, mx = it.g.max;
        const M = new Float32Array([mx[0] - mn[0], 0, 0, 0, 0, mx[1] - mn[1] + 0.5, 0, 0, 0, 0, mx[2] - mn[2], 0, mn[0], mn[1] - 0.25, mn[2], 1]);
        gl.uniformMatrix4fv(this.line.u.u_vp, false, mat4.mul(VP, M));
        gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, oc.q);
        gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
        gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
        oc.pending = true;
        st.queries++;
      }
      gl.colorMask(true, true, true, true);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
  }

  // world-space ray through a canvas pixel
  rayAt(px, py) {
    const x = (px / this.canvas.clientWidth) * 2 - 1, y = 1 - (py / this.canvas.clientHeight) * 2;
    const a = mat4.xform(this.IVP, x, y, -1), b = mat4.xform(this.IVP, x, y, 1);
    const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], e = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    const d = norm([e[0] - o[0], e[1] - o[1], e[2] - o[2]]);
    return { o, d };
  }
  project(x, y, z) {
    const p = mat4.xform(this.VP, x, y, z);
    if (p[3] <= 0) return null;
    return [((p[0] / p[3]) * 0.5 + 0.5) * this.canvas.clientWidth, (0.5 - (p[1] / p[3]) * 0.5) * this.canvas.clientHeight];
  }
}

function norm(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
function frustumPlanes(m) {
  const p = [];
  const r = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = r(0), r1 = r(1), r2 = r(2), r3 = r(3);
  for (const [a, s] of [[r0, 1], [r0, -1], [r1, 1], [r1, -1], [r2, 1], [r2, -1]]) {
    const pl = [r3[0] + s * a[0], r3[1] + s * a[1], r3[2] + s * a[2], r3[3] + s * a[3]];
    const l = Math.hypot(pl[0], pl[1], pl[2]);
    p.push(pl.map((v) => v / l));
  }
  return p;
}
export function aabbVisible(planes, mn, mx) {
  for (const pl of planes) {
    const x = pl[0] > 0 ? mx[0] : mn[0], y = pl[1] > 0 ? mx[1] : mn[1], z = pl[2] > 0 ? mx[2] : mn[2];
    if (pl[0] * x + pl[1] * y + pl[2] * z + pl[3] < 0) return false;
  }
  return true;
}
