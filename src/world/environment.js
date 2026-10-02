import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { positionWorld, time, mx_noise_float, vec3, float, bumpMap, mix, normalView, positionViewDirection, dot, pow, clamp, color } from 'three/tsl';
import { RIVER_W, RIVER_E, WATER_Y, QUAY_ROAD, AVENUE, CITY_WEST, CITY_EAST, PROMENADE } from './layout.js';

export const SUN_DIR = new THREE.Vector3().setFromSphericalCoords( 1, THREE.MathUtils.degToRad( 90 - 38 ), THREE.MathUtils.degToRad( 28 ) );

export function buildSky( scene ) {

	const sky = new SkyMesh();
	sky.scale.setScalar( 9000 );
	sky.turbidity.value = 2.6;
	sky.rayleigh.value = 1.4;
	sky.mieCoefficient.value = 0.004;
	sky.mieDirectionalG.value = 0.82;
	sky.cloudCoverage.value = 0.32;
	sky.cloudDensity.value = 0.35;
	sky.cloudElevation.value = 0.55;
	sky.sunPosition.value.copy( SUN_DIR );
	scene.add( sky );
	return sky;

}

export function buildLights( scene ) {

	const hemi = new THREE.HemisphereLight( 0xcfe2ff, 0xb59a74, 0.55 );
	scene.add( hemi );

	const sun = new THREE.DirectionalLight( 0xfff1dc, 3.4 );
	sun.position.copy( SUN_DIR ).multiplyScalar( 200 );
	sun.castShadow = true;
	sun.shadow.mapSize.set( 2048, 2048 );
	const s = 70;
	Object.assign( sun.shadow.camera, { left: - s, right: s, top: s, bottom: - s, near: 1, far: 600 } );
	sun.shadow.bias = - 0.0004;
	sun.shadow.normalBias = 0.04;
	scene.add( sun, sun.target );

	return { sun, hemi };

}

// Keep the shadow frustum centred on the player, snapped to texels to avoid shimmering.
export function updateSun( sun, focus ) {

	const texel = ( 140 / 2048 );
	const fx = Math.round( focus.x / texel ) * texel, fz = Math.round( focus.z / texel ) * texel;
	sun.target.position.set( fx, focus.y, fz );
	sun.position.set( fx, focus.y, fz ).addScaledVector( SUN_DIR, 300 );
	sun.target.updateMatrixWorld();

}

export function buildGround( scene, tex ) {

	const group = new THREE.Group();
	scene.add( group );
	const paving = tex.paving.clone();
	paving.repeat.set( 1, 1 );
	paving.needsUpdate = true;

	const plane = ( x0, x1, z0, z1, mat, y = 0, uvScale = 5 ) => {

		const g = new THREE.PlaneGeometry( x1 - x0, z1 - z0 );
		g.rotateX( - Math.PI / 2 );
		g.translate( ( x0 + x1 ) / 2, y, ( z0 + z1 ) / 2 );
		const uv = g.attributes.uv, pos = g.attributes.position;
		for ( let i = 0; i < uv.count; i ++ ) uv.setXY( i, pos.getX( i ) / uvScale, - pos.getZ( i ) / uvScale );
		const m = new THREE.Mesh( g, mat );
		m.receiveShadow = true;
		group.add( m );
		return m;

	};

	const pave = new THREE.MeshStandardMaterial( { map: tex.paving, roughness: 0.92 } );
	plane( - 4000, RIVER_W, - 4000, 4000, pave, 0, 5 );
	plane( RIVER_E, 4000, - 4000, 4000, pave, 0, 5 );

	const asphalt = new THREE.MeshStandardMaterial( { map: tex.asphalt, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: - 2, polygonOffsetUnits: - 2 } );
	plane( QUAY_ROAD.x0, QUAY_ROAD.x1, - 4000, 4000, asphalt, 0.01, 6 );
	plane( RIVER_E + 30, RIVER_E + 52, - 4000, 4000, asphalt, 0.01, 6 );
	plane( CITY_WEST.x0 - 200, QUAY_ROAD.x0, AVENUE.z0 + 2, AVENUE.z1 - 2, asphalt, 0.01, 6 );
	plane( RIVER_E, CITY_EAST.x1 + 200, AVENUE.z0 + 2, AVENUE.z1 - 2, asphalt, 0.01, 6 );

	// lane markings
	const lineMat = new THREE.MeshStandardMaterial( { color: 0xe8e6de, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: - 4, polygonOffsetUnits: - 4 } );
	for ( let z = - 2000; z < 2000; z += 9 ) plane( ( QUAY_ROAD.x0 + QUAY_ROAD.x1 ) / 2 - 0.08, ( QUAY_ROAD.x0 + QUAY_ROAD.x1 ) / 2 + 0.08, z, z + 4.5, lineMat, 0.02 );

	// promenade lawn strip along the river
	const grass = new THREE.MeshStandardMaterial( { color: 0x6f8a45, roughness: 1, polygonOffset: true, polygonOffsetFactor: - 2, polygonOffsetUnits: - 2 } );
	plane( PROMENADE.x0 + 4, PROMENADE.x1 - 12, - 4000, AVENUE.z0 - 6, grass, 0.01 );
	plane( PROMENADE.x0 + 4, PROMENADE.x1 - 12, AVENUE.z1 + 6, 4000, grass, 0.01 );
	plane( RIVER_E + 8, RIVER_E + 26, - 4000, AVENUE.z0 - 6, grass, 0.01 );
	plane( RIVER_E + 8, RIVER_E + 26, AVENUE.z1 + 6, 4000, grass, 0.01 );

	return { group, plane, grass };

}

export function buildWater( scene ) {

	const mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.06, metalness: 0.0 } );
	const p = positionWorld.xz;
	const t = time;
	const h = mx_noise_float( vec3( p.x.mul( 0.08 ), p.y.mul( 0.03 ).add( t.mul( 0.25 ) ), t.mul( 0.15 ) ) ).mul( 0.6 )
		.add( mx_noise_float( vec3( p.x.mul( 0.35 ), p.y.mul( 0.2 ).add( t.mul( 0.9 ) ), t.mul( 0.4 ) ) ).mul( 0.25 ) )
		.add( mx_noise_float( vec3( p.x.mul( 1.4 ), p.y.mul( 1.1 ).add( t.mul( 2.2 ) ), t ) ).mul( 0.06 ) );
	mat.normalNode = bumpMap( h, float( 0.45 ) );
	// the Garonne is famously muddy — tint varies with view angle
	const facing = clamp( dot( normalView, positionViewDirection.negate() ), 0, 1 );
	mat.colorNode = mix( color( 0x6e5a3e ), color( 0x4a3d2b ), pow( facing, 0.6 ) ).add( h.mul( 0.03 ) );

	const g = new THREE.PlaneGeometry( RIVER_E - RIVER_W, 8000, 1, 1 );
	g.rotateX( - Math.PI / 2 );
	const water = new THREE.Mesh( g, mat );
	water.position.set( ( RIVER_W + RIVER_E ) / 2, WATER_Y, 0 );
	water.receiveShadow = true;
	scene.add( water );
	return water;

}
