// Point d'entrée du bundle local de Three.js (aucune dépendance CDN à l'exécution).
export * from "three";
export { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
export * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
export * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
export { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
export { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
