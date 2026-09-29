export { createEmptyProject, createLayer } from '$core/model/project';
import { normalize3, type Vec3 } from '$core/schema/params';

export function normalizeDir(v: Vec3): Vec3 {
  return normalize3(v);
}
