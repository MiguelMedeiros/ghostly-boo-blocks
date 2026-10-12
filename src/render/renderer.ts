/**
 * Draws the world with WebGL 2: one mesh per section (src/render/mesher.ts), redrawn when a block in it or next to
 * it changes; the contact's ghost; the outline of the block pointed at; fog into the sky's colour.
 *
 * Plain WebGL rather than a library: this is a few textured meshes and one shader, and keeping it in-house keeps the
 * page small (no third-party code in the bundle) and every byte of it reviewable.
 */
import { TILE } from "../blocks.ts";
import { SIZE_X, SIZE_Y, SIZE_Z } from "../terrain.ts";
import { SECTION, SECTION_COUNT, SECTIONS_X, SECTIONS_Z } from "../world.ts";
import { ATLAS_PX, drawAtlas } from "./atlas.ts";
import { boxMesh, FLOATS_PER_VERTEX, meshSection, type BlockSource } from "./mesher.ts";
import { multiply, perspective, placeAt, view, type Mat4, type Vec3 } from "./math.ts";

export const FOV = (70 * Math.PI) / 180;
export const SKY: Vec3 = [0.62, 0.8, 0.96];
const FAR = 160;

const VERTEX = `#version 300 es
in vec3 aPos;
in vec2 aUv;
in float aLight;
uniform mat4 uViewProjection;
uniform mat4 uModel;
uniform vec3 uEye;
out vec2 vUv;
out float vLight;
out float vDistance;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  gl_Position = uViewProjection * world;
  vUv = aUv;
  vLight = aLight;
  vDistance = distance(world.xyz, uEye);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 vUv;
in float vLight;
in float vDistance;
uniform sampler2D uAtlas;
uniform vec3 uSky;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uAlpha;
uniform vec3 uTint;
out vec4 color;
void main() {
  vec4 texel = texture(uAtlas, vUv);
  if (texel.a < 0.1) discard;
  float fog = clamp((vDistance - uFogStart) / (uFogEnd - uFogStart), 0.0, 1.0);
  vec3 lit = texel.rgb * vLight * uTint;
  color = vec4(mix(lit, uSky, fog), uAlpha < 1.0 ? texel.a * uAlpha : 1.0);
}`;

const LINE_VERTEX = `#version 300 es
in vec3 aPos;
uniform mat4 uViewProjection;
uniform vec3 uAt;
void main() { gl_Position = uViewProjection * vec4(aPos * 1.004 - 0.002 + uAt, 1.0); }`;

const LINE_FRAGMENT = `#version 300 es
precision mediump float;
out vec4 color;
void main() { color = vec4(0.05, 0.05, 0.08, 0.85); }`;

interface Mesh {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
}

export interface Ghost {
  at: Vec3;
  yaw: number;
  tint: Vec3;
}

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
  return program;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly lines: WebGLProgram;
  private readonly uniforms: Record<string, WebGLUniformLocation | null> = {};
  private readonly lineUniforms: Record<string, WebGLUniformLocation | null> = {};
  private readonly solid: (Mesh | null)[] = Array(SECTION_COUNT).fill(null);
  private readonly water: (Mesh | null)[] = Array(SECTION_COUNT).fill(null);
  private readonly dirty = new Set<number>();
  private readonly ghost: Mesh;
  private readonly outline: { vao: WebGLVertexArrayObject; count: number };
  private readonly identity = placeAt([0, 0, 0], 0);
  viewProjection: Mat4 = new Float32Array(16);

  /** Throws when the page cannot have WebGL 2. */
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("no-webgl");
    this.gl = gl;
    this.program = compile(gl, VERTEX, FRAGMENT);
    this.lines = compile(gl, LINE_VERTEX, LINE_FRAGMENT);
    for (const name of ["uViewProjection", "uModel", "uEye", "uAtlas", "uSky", "uFogStart", "uFogEnd", "uAlpha", "uTint"]) this.uniforms[name] = gl.getUniformLocation(this.program, name);
    for (const name of ["uViewProjection", "uAt"]) this.lineUniforms[name] = gl.getUniformLocation(this.lines, name);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ATLAS_PX, ATLAS_PX, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(drawAtlas().buffer));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.ghost = this.upload(boxMesh(0.8, 1.5, 0.8, TILE.ghostFace, TILE.ghostBody))!;
    this.outline = this.makeOutline();
  }

  private upload(mesh: { vertices: Float32Array; indices: Uint32Array }, old?: Mesh | null): Mesh | null {
    const gl = this.gl;
    if (old) {
      gl.deleteVertexArray(old.vao);
      for (const b of old.buffers) gl.deleteBuffer(b);
    }
    if (!mesh.indices.length) return null;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    const stride = FLOATS_PER_VERTEX * 4;
    const attributes: [string, number, number][] = [["aPos", 3, 0], ["aUv", 2, 12], ["aLight", 1, 20]];
    for (const [name, size, offset] of attributes) {
      const location = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    }
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, buffers: [vbo, ibo], count: mesh.indices.length };
  }

  private makeOutline(): { vao: WebGLVertexArrayObject; count: number } {
    const gl = this.gl;
    const corners = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]];
    const edges = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(edges.flatMap((i) => corners[i])), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(this.lines, "aPos");
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    return { vao, count: edges.length };
  }

  /** Sections waiting to be meshed again. */
  get waiting(): number {
    return this.dirty.size;
  }

  /** Every section is drawn again (a new world). */
  markAll(): void {
    for (let s = 0; s < SECTION_COUNT; s++) this.dirty.add(s);
  }

  /** A cell changed: its section, and the neighbouring ones when it is on their edge (their faces and shadows). */
  markCell(x: number, y: number, z: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = x + dx;
          const cy = y + dy;
          const cz = z + dz;
          if (cx < 0 || cz < 0 || cy < 0 || cx >= SIZE_X || cz >= SIZE_Z || cy >= SIZE_Y) continue;
          this.dirty.add(((cy >> 4) * SECTIONS_Z + (cz >> 4)) * SECTIONS_X + (cx >> 4));
        }
      }
    }
  }

  /** Builds up to `budget` waiting sections, nearest the eye first. Returns how many it built. */
  rebuild(world: BlockSource, eye: Vec3, budget = Infinity): number {
    if (!this.dirty.size) return 0;
    const centre = (s: number): number => {
      const x = (s % SECTIONS_X) * SECTION + 8 - eye[0];
      const z = (Math.floor(s / SECTIONS_X) % SECTIONS_Z) * SECTION + 8 - eye[2];
      const y = Math.floor(s / (SECTIONS_X * SECTIONS_Z)) * SECTION + 8 - eye[1];
      return x * x + y * y + z * z;
    };
    const order = [...this.dirty].sort((a, b) => centre(a) - centre(b)).slice(0, budget);
    for (const s of order) {
      const mesh = meshSection(world, s);
      this.solid[s] = this.upload(mesh.solid, this.solid[s]);
      this.water[s] = this.upload(mesh.water, this.water[s]);
      this.dirty.delete(s);
    }
    return order.length;
  }

  resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  draw(eye: Vec3, yaw: number, pitch: number, ghosts: Ghost[], pointed: Vec3 | null, underwater: boolean): void {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const sky: Vec3 = underwater ? [0.16, 0.32, 0.6] : SKY;
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const projection = perspective(FOV, this.canvas.width / this.canvas.height, 0.05, FAR);
    this.viewProjection = multiply(projection, view(eye, yaw, pitch));
    const u = this.uniforms;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(u.uViewProjection, false, this.viewProjection);
    gl.uniformMatrix4fv(u.uModel, false, this.identity);
    gl.uniform3fv(u.uEye, eye);
    gl.uniform1i(u.uAtlas, 0);
    gl.uniform3fv(u.uSky, sky);
    gl.uniform1f(u.uFogStart, underwater ? 2 : 60);
    gl.uniform1f(u.uFogEnd, underwater ? 18 : FAR - 10);
    gl.uniform1f(u.uAlpha, 1);
    gl.uniform3f(u.uTint, 1, 1, 1);
    gl.disable(gl.BLEND);
    for (const mesh of this.solid) if (mesh) this.drawMesh(mesh);
    for (const ghost of ghosts) {
      gl.uniformMatrix4fv(u.uModel, false, placeAt(ghost.at, ghost.yaw));
      gl.uniform3fv(u.uTint, ghost.tint);
      this.drawMesh(this.ghost);
    }
    gl.uniformMatrix4fv(u.uModel, false, this.identity);
    gl.uniform3f(u.uTint, 1, 1, 1);
    if (pointed) {
      gl.useProgram(this.lines);
      gl.uniformMatrix4fv(this.lineUniforms.uViewProjection, false, this.viewProjection);
      gl.uniform3fv(this.lineUniforms.uAt, pointed);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.outline.vao);
      gl.drawArrays(gl.LINES, 0, this.outline.count);
      gl.useProgram(this.program);
    }
    // Water last, see-through, without writing depth so what is behind it in other sections still shows.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(u.uAlpha, 0.85);
    for (const mesh of this.water) if (mesh) this.drawMesh(mesh);
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  private drawMesh(mesh: Mesh): void {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
  }
}
