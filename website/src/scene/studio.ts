import * as THREE from "three";

/**
 * A product-photography studio, rendered once into the environment map: a dark room, a broad
 * overhead softbox, two tall strip lights that draw long highlights down the aluminium edges, and
 * faint lime and sky strips behind for brand-coloured rims. Nothing here is visible in the frame;
 * it only exists in reflections.
 */
export function makeStudio() {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(30, 16, 30),
    new THREE.MeshBasicMaterial({ color: new THREE.Color("#050608"), side: THREE.BackSide }),
  );
  room.position.y = 6;
  scene.add(room);

  const light = (w: number, h: number, color: string, intensity: number, pos: [number, number, number], look: [number, number, number]) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(...look);
    scene.add(m);
  };

  // Overhead softbox, slightly forward: a broad soft sheen across the deck and lid.
  light(9, 5, "#ffffff", 1.8, [0, 9, 3], [0, 0, 0]);
  // A large softbox up and behind: seen from the front, the deck and keycaps reflect it as a soft sheen.
  light(18, 5, "#ffffff", 1.1, [0, 3.8, -10], [0, 1, 0]);
  // Tall strips left and right: crisp vertical highlights along every bevel.
  light(0.6, 9, "#ffffff", 2.8, [-7, 4, 2], [0, 1.5, 0]);
  light(0.6, 9, "#ffffff", 2.4, [7, 4, 1], [0, 1.5, 0]);
  // A low front fill so the keycaps and the front lip catch a rim.
  light(10, 0.35, "#ffffff", 1.4, [0, 1.2, 9], [0, 0.5, 0]);
  // Brand rims behind.
  light(0.5, 6, "#b6f36b", 3.2, [-5, 3, -7], [0, 1.5, 0]);
  light(0.5, 6, "#7dd3fc", 3.6, [5, 3, -7], [0, 1.5, 0]);
  return scene;
}
