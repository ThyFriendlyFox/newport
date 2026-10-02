// World layout constants — a stylised Bordeaux around Place Saint-Michel.
// +X is east (towards the Garonne), -Z is north.

export const WATER_Y = - 5;
export const RIVERBED_Y = - 10;
export const RIVER_W = 240; // west quay edge
export const RIVER_E = 470; // east quay edge

export const QUAY_ROAD = { x0: 192, x1: 214 }; // asphalt boulevard on the west bank
export const PROMENADE = { x0: 214, x1: RIVER_W };

export const BRIDGE = { z: - 210, halfW: 8.5, deckY: 0.4 };
export const AVENUE = { z0: BRIDGE.z - 11, z1: BRIDGE.z + 11 }; // Cours Victor Hugo leading to the bridge

export const PLAZA = { x0: - 70, x1: 125, z0: - 62, z1: 55 };
export const SPIRE = { x: 0, z: 0 };
export const BASILICA = { x0: 38, x1: 108, z0: - 21, z1: 21 };

export const CITY_WEST = { x0: - 820, x1: 190, z0: - 900, z1: 900 };
export const CITY_EAST = { x0: 500, x1: 1250, z0: - 900, z1: 900 };

export const SPAWN = { x: - 32, z: 22, yaw: Math.PI * 0.82 };
