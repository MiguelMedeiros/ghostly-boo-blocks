/**
 * The little linear algebra the renderer needs: 4 x 4 matrices in column-major order (as WebGL takes them).
 *
 * The camera looks along -z at yaw 0; yaw turns it to the left (counter-clockwise seen from above), pitch up.
 */
export type Vec3 = [number, number, number];
export type Mat4 = Float32Array;

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function forward(yaw: number, pitch: number): Vec3 {
  return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

export function right(yaw: number): Vec3 {
  return [Math.cos(yaw), 0, -Math.sin(yaw)];
}

export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The view matrix of a camera at `eye` turned by yaw and pitch. */
export function view(eye: Vec3, yaw: number, pitch: number): Mat4 {
  const f = forward(yaw, pitch);
  const r = right(yaw);
  const u = cross(r, f);
  const m = new Float32Array(16);
  m[0] = r[0];
  m[4] = r[1];
  m[8] = r[2];
  m[1] = u[0];
  m[5] = u[1];
  m[9] = u[2];
  m[2] = -f[0];
  m[6] = -f[1];
  m[10] = -f[2];
  m[12] = -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]);
  m[13] = -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]);
  m[14] = f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2];
  m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** A model matrix: turned by yaw about y, then moved to `at`. */
export function placeAt(at: Vec3, yaw: number): Mat4 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const m = new Float32Array(16);
  m[0] = c;
  m[2] = -s;
  m[5] = 1;
  m[8] = s;
  m[10] = c;
  m[12] = at[0];
  m[13] = at[1];
  m[14] = at[2];
  m[15] = 1;
  return m;
}

/** Where a world point lands on the screen, in CSS pixels; null when it is behind the camera. */
export function project(viewProjection: Mat4, p: Vec3, width: number, height: number): [number, number] | null {
  const x = viewProjection[0] * p[0] + viewProjection[4] * p[1] + viewProjection[8] * p[2] + viewProjection[12];
  const y = viewProjection[1] * p[0] + viewProjection[5] * p[1] + viewProjection[9] * p[2] + viewProjection[13];
  const w = viewProjection[3] * p[0] + viewProjection[7] * p[1] + viewProjection[11] * p[2] + viewProjection[15];
  if (w <= 0.01) return null;
  return [((x / w + 1) / 2) * width, ((1 - y / w) / 2) * height];
}

/** The direction of the ray through a point of the screen (ndc: -1 to 1 each way, y up). */
export function rayThrough(yaw: number, pitch: number, fovY: number, aspect: number, ndcX: number, ndcY: number): Vec3 {
  const f = forward(yaw, pitch);
  const r = right(yaw);
  const u = cross(r, f);
  const t = Math.tan(fovY / 2);
  return normalize([
    f[0] + r[0] * ndcX * t * aspect + u[0] * ndcY * t,
    f[1] + r[1] * ndcX * t * aspect + u[1] * ndcY * t,
    f[2] + r[2] * ndcX * t * aspect + u[2] * ndcY * t,
  ]);
}
