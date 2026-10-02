import * as THREE from 'three/webgpu';
import { GeoBatch } from '../core/geo.js';
import { ROOF_GABLE_X } from '../core/physics.js';
import { SPIRE, BASILICA, BRIDGE, RIVER_W, RIVER_E, WATER_Y, RIVERBED_Y } from './layout.js';

const white = new THREE.Color( 1, 1, 1 );

function mesh( geo, mat, parent, shadow = true ) {

	const m = new THREE.Mesh( geo, mat );
	m.castShadow = shadow;
	m.receiveShadow = true;
	parent.add( m );
	return m;

}

// Octagonal frustum from y0 (radius r0) to y1 (radius r1), centred at (cx, cz).
function octFrustum( batch, cx, cz, y0, y1, r0, r1, uv, c, sides = 8 ) {

	for ( let i = 0; i < sides; i ++ ) {

		const a0 = ( i + 0.5 ) / sides * Math.PI * 2, a1 = ( i + 1.5 ) / sides * Math.PI * 2;
		const p0 = [ cx + Math.cos( a0 ) * r0, y0, cz + Math.sin( a0 ) * r0 ];
		const p1 = [ cx + Math.cos( a1 ) * r0, y0, cz + Math.sin( a1 ) * r0 ];
		const p2 = [ cx + Math.cos( a1 ) * r1, y1, cz + Math.sin( a1 ) * r1 ];
		const p3 = [ cx + Math.cos( a0 ) * r1, y1, cz + Math.sin( a0 ) * r1 ];
		const wb = Math.hypot( p1[ 0 ] - p0[ 0 ], p1[ 2 ] - p0[ 2 ] ), wt = Math.hypot( p2[ 0 ] - p3[ 0 ], p2[ 2 ] - p3[ 2 ] );
		const h = ( y1 - y0 ) / uv.v;
		const u1 = uv.fit ? 1 : wb / uv.u;
		const t0 = uv.fit ? 0.5 - wt / wb / 2 : ( wb - wt ) / 2 / uv.u, t1 = uv.fit ? 0.5 + wt / wb / 2 : t0 + wt / uv.u;
		// p1 -> p0 order gives an outward facing quad with the GeoBatch winding convention
		batch.quad( p1, p0, p3, p2, [ 0, 0, u1, 0, t1, h, t0, h ], c );

	}

}

export function buildLandmarks( scene, physics, tex ) {

	const group = new THREE.Group();
	group.name = 'landmarks';
	scene.add( group );

	const gothicMat = new THREE.MeshStandardMaterial( { map: tex.gothic.map, roughnessMap: tex.gothic.roughnessMap, vertexColors: true } );
	const stoneMat = new THREE.MeshStandardMaterial( { map: tex.gothicPlain, roughness: 0.9, vertexColors: true } );
	const slateMat = new THREE.MeshStandardMaterial( { map: tex.slate, roughness: 0.55, metalness: 0.1, vertexColors: true } );
	const brickMat = new THREE.MeshStandardMaterial( { map: tex.brick, roughness: 0.85 } );
	const quayMat = new THREE.MeshStandardMaterial( { map: tex.quay, roughness: 0.9, vertexColors: true } );
	const metalMat = new THREE.MeshStandardMaterial( { color: 0x2b2b2b, roughness: 0.4, metalness: 0.8 } );

	const gothic = new GeoBatch(), stone = new GeoBatch(), slate = new GeoBatch(), quay = new GeoBatch();
	const pinnacles = [];

	// --- La Flèche Saint-Michel -----------------------------------------------------------------
	{

		const { x, z } = SPIRE;
		const tower = ( half, y0, y1, bays ) => {

			const x0 = x - half, x1 = x + half, z0 = z - half, z1 = z + half;
			const uSize = ( half * 2 ) / bays;
			gothic.wall( x0, z1, x1, z1, y0, y1, uSize, y1 - y0, white );
			gothic.wall( x1, z1, x1, z0, y0, y1, uSize, y1 - y0, white );
			gothic.wall( x1, z0, x0, z0, y0, y1, uSize, y1 - y0, white );
			gothic.wall( x0, z0, x0, z1, y0, y1, uSize, y1 - y0, white );
			// corner buttresses
			for ( const sx of [ - 1, 1 ] ) {

				for ( const sz of [ - 1, 1 ] ) {

					const bx = x + sx * half, bz = z + sz * half;
					stone.box( bx - 0.9, y0, bz - 0.9, bx + 0.9, y1 + 0.5, bz + 0.9, 3, white, 'nsewt' );
					pinnacles.push( [ bx, y1 + 0.5, bz, 0.8, 5 ] );

				}

			}

			// parapet ledge
			stone.box( x0 - 0.5, y1 - 0.2, z0 - 0.5, x1 + 0.5, y1 + 0.4, z1 + 0.5, 3, white, 'nsewtb' );
			physics.add( x0 - 0.5, y0, z0 - 0.5, x1 + 0.5, y1 + 0.4, z1 + 0.5, null, { tag: 'spire' } );

		};

		tower( 5.5, 0, 26, 2 );
		tower( 4.2, 26.4, 46, 2 );
		// octagonal lantern
		octFrustum( gothic, x, z, 46.4, 62, 4.6, 4.3, { fit: true, v: 15.6 }, white );
		physics.add( x - 4.0, 46.4, z - 4.0, x + 4.0, 62.4, z + 4.0, null, { tag: 'spire' } );
		const ring = ( y, r ) => {

			octFrustum( stone, x, z, y - 0.5, y, r, r, { u: 3, v: 3 }, white );
			// top face of the ring
			for ( let i = 0; i < 8; i ++ ) {

				const a0 = ( i + 0.5 ) / 8 * Math.PI * 2, a1 = ( i + 1.5 ) / 8 * Math.PI * 2;
				stone.tri( [ x, y, z ], [ x + Math.cos( a1 ) * r, y, z + Math.sin( a1 ) * r ], [ x + Math.cos( a0 ) * r, y, z + Math.sin( a0 ) * r ], [ 0, 0, 1, 0, 0, 1 ], white );

			}

			for ( let i = 0; i < 8; i ++ ) {

				const a = ( i + 0.5 ) / 8 * Math.PI * 2;
				pinnacles.push( [ x + Math.cos( a ) * r * 0.92, y, z + Math.sin( a ) * r * 0.92, 0.35, 2.4 ] );

			}

		};

		ring( 62.4, 5.2 );
		const tiers = [ [ 62.4, 76, 3.7, 3.0, 3.6 ], [ 76, 90, 2.7, 2.1, 2.8 ], [ 90, 102, 1.9, 1.35, 2.05 ], [ 102, 113, 1.15, 0.12, 0 ] ];
		for ( const [ y0, y1, r0, r1, rr ] of tiers ) {

			octFrustum( stone, x, z, y0, y1, r0, r1, { u: 3, v: 3 }, new THREE.Color( 0.93, 0.9, 0.86 ) );
			const apo = ( ( r0 + r1 ) / 2 ) * Math.cos( Math.PI / 8 );
			if ( rr > 0 ) {

				ring( y1, rr );
				physics.add( x - apo, y0, z - apo, x + apo, y1, z + apo, null, { tag: 'spire' } );
				const ra = rr * Math.cos( Math.PI / 8 );
				physics.add( x - ra, y1 - 0.5, z - ra, x + ra, y1, z + ra, null, { tag: 'spire' } );

			} else {

				physics.add( x - 0.7, y0, z - 0.7, x + 0.7, 108.5, z + 0.7, null, { tag: 'spire' } );

			}

			// crockets along the edges
			for ( let i = 0; i < 8; i ++ ) {

				const a = ( i + 0.5 ) / 8 * Math.PI * 2;
				for ( let y = y0 + 1.5; y < y1 - 0.8; y += 2.2 ) {

					const t = ( y - y0 ) / ( y1 - y0 );
					const r = r0 + ( r1 - r0 ) * t + 0.15;
					pinnacles.push( [ x + Math.cos( a ) * r, y, z + Math.sin( a ) * r, 0.2, 0.7 ] );

				}

			}

		}

		// cross
		stone.box( x - 0.12, 113, z - 0.12, x + 0.12, 116.2, z + 0.12, 1, white, 'nsewt' );
		stone.box( x - 0.9, 114.8, z - 0.12, x + 0.9, 115.15, z + 0.12, 1, white, 'nsewtb' );

	}

	// --- Basilique Saint-Michel -----------------------------------------------------------------
	{

		const { x0, x1, z0, z1 } = BASILICA;
		const nz0 = z0 + 9, nz1 = z1 - 9; // nave
		const aisleH = 13, naveH = 24, roofH = 12;
		const bays = Math.round( ( x1 - x0 ) / 7 );
		const uSize = ( x1 - x0 ) / bays;
		// aisles
		gothic.wall( x0, z1, x1, z1, 0, aisleH, uSize, aisleH, white );
		gothic.wall( x1, z0, x0, z0, 0, aisleH, uSize, aisleH, white );
		stone.wall( x0, z0, x0, nz0, 0, aisleH, 3, 3, white );
		stone.wall( x0, nz1, x0, z1, 0, aisleH, 3, 3, white );
		// clerestory
		gothic.wall( x0, nz1, x1, nz1, aisleH, naveH, uSize, naveH - aisleH, white );
		gothic.wall( x1, nz0, x0, nz0, aisleH, naveH, uSize, naveH - aisleH, white );
		// west front
		gothic.wall( x0, nz0, x0, nz1, 0, naveH, nz1 - nz0, naveH, white );
		stone.box( x0 - 1.2, 0, nz0 - 1, x0, naveH + 2, nz0 + 1, 3, white, 'nsewt' );
		stone.box( x0 - 1.2, 0, nz1 - 1, x0, naveH + 2, nz1 + 1, 3, white, 'nsewt' );
		pinnacles.push( [ x0 - 0.6, naveH + 2, nz0, 0.9, 6 ], [ x0 - 0.6, naveH + 2, nz1, 0.9, 6 ] );
		// gable of the west front
		const zm = ( z0 + z1 ) / 2;
		stone.tri( [ x0, naveH, nz0 ], [ x0, naveH, nz1 ], [ x0, naveH + roofH, zm ], [ 0, 0, 4, 0, 2, 4 ], white );
		stone.tri( [ x1, naveH, nz1 ], [ x1, naveH, nz0 ], [ x1, naveH + roofH, zm ], [ 0, 0, 4, 0, 2, 4 ], white );
		// east wall
		gothic.wall( x1, z1, x1, z0, 0, aisleH, ( z1 - z0 ) / 4, aisleH, white );
		gothic.wall( x1, nz1, x1, nz0, aisleH, naveH, nz1 - nz0, naveH - aisleH, white );
		// nave roof (steep slate)
		const ov = 0.6;
		slate.quad( [ x0 - ov, naveH, nz1 + ov ], [ x1 + ov, naveH, nz1 + ov ], [ x1 + ov, naveH + roofH, zm ], [ x0 - ov, naveH + roofH, zm ], [ 0, 0, ( x1 - x0 ) / 3, 0, ( x1 - x0 ) / 3, 5, 0, 5 ], white );
		slate.quad( [ x1 + ov, naveH, nz0 - ov ], [ x0 - ov, naveH, nz0 - ov ], [ x0 - ov, naveH + roofH, zm ], [ x1 + ov, naveH + roofH, zm ], [ 0, 0, ( x1 - x0 ) / 3, 0, ( x1 - x0 ) / 3, 5, 0, 5 ], white );
		// aisle lean-to roofs
		const ar = 3.5;
		slate.quad( [ x0, aisleH, z1 + ov ], [ x1, aisleH, z1 + ov ], [ x1, aisleH + ar, nz1 ], [ x0, aisleH + ar, nz1 ], [ 0, 0, 20, 0, 20, 3, 0, 3 ], white );
		slate.quad( [ x1, aisleH, z0 - ov ], [ x0, aisleH, z0 - ov ], [ x0, aisleH + ar, nz0 ], [ x1, aisleH + ar, nz0 ], [ 0, 0, 20, 0, 20, 3, 0, 3 ], white );
		// flying buttresses / pier buttresses with pinnacles
		for ( let i = 0; i <= bays; i ++ ) {

			const bx = x0 + i * uSize;
			for ( const side of [ - 1, 1 ] ) {

				const bz = side < 0 ? z0 : z1;
				stone.box( bx - 0.7, 0, Math.min( bz, bz + side * 2.2 ), bx + 0.7, aisleH + 3, Math.max( bz, bz + side * 2.2 ), 3, white, 'nsewt' );
				pinnacles.push( [ bx, aisleH + 3, bz + side * 1.1, 0.6, 4 ] );
				// flyer
				const fz = side < 0 ? nz0 : nz1;
				stone.box( bx - 0.35, aisleH + 3.5, Math.min( bz, fz ), bx + 0.35, aisleH + 4.4, Math.max( bz, fz ), 3, white, 'nsewtb' );

			}

		}

		// apse — half octagon behind the east wall
		const ax = x1, ar2 = ( nz1 - nz0 ) / 2 + 2;
		for ( let i = 0; i < 4; i ++ ) {

			const a0 = - Math.PI / 2 + i * Math.PI / 4, a1 = a0 + Math.PI / 4;
			const p0x = ax + Math.cos( a0 ) * ar2, p0z = zm + Math.sin( a0 ) * ar2;
			const p1x = ax + Math.cos( a1 ) * ar2, p1z = zm + Math.sin( a1 ) * ar2;
			gothic.wall( p1x, p1z, p0x, p0z, 0, naveH - 4, Math.hypot( p1x - p0x, p1z - p0z ), naveH - 4, white );
			slate.tri( [ p1x, naveH - 4, p1z ], [ p0x, naveH - 4, p0z ], [ ax, naveH + roofH - 4, zm ], [ 0, 0, 3, 0, 1.5, 4 ], white );

		}

		physics.add( x0, 0, nz0, x1, naveH, nz1, { type: ROOF_GABLE_X, h: roofH } );
		physics.add( x0, 0, z0 - 0.5, x1, aisleH, nz0, null );
		physics.add( x0, 0, nz1, x1, aisleH, z1 + 0.5, null );
		physics.add( x1, 0, zm - ar2 * 0.7, x1 + ar2 * 0.92, naveH - 4, zm + ar2 * 0.7, null );

	}

	// --- Quays, riverbed -------------------------------------------------------------------------
	{

		const zA = - 3000, zB = 3000;
		const qc = new THREE.Color( 0.95, 0.93, 0.9 );
		quay.wall( RIVER_W, zA, RIVER_W, zB, RIVERBED_Y, 0, 4, 4, qc );
		quay.wall( RIVER_E, zB, RIVER_E, zA, RIVERBED_Y, 0, 4, 4, qc );
		// coping stones
		quay.box( RIVER_W - 0.8, 0, zA, RIVER_W + 0.25, 0.35, zB, 2, qc, 'et' );
		quay.box( RIVER_E - 0.25, 0, zA, RIVER_E + 0.8, 0.35, zB, 2, qc, 'wt' );
		physics.add( - 4000, - 30, - 4000, RIVER_W, 0, 4000, null, { tag: 'bank' } );
		physics.add( RIVER_E, - 30, - 4000, 4000, 0, 4000, null, { tag: 'bank' } );
		physics.add( - 4000, - 40, - 4000, 4000, RIVERBED_Y, 4000, null, { tag: 'bed', climbable: false } );

		const bed = new THREE.Mesh( new THREE.PlaneGeometry( RIVER_E - RIVER_W, 6000 ), new THREE.MeshStandardMaterial( { color: 0x4a3c2a, roughness: 1 } ) );
		bed.rotation.x = - Math.PI / 2;
		bed.position.set( ( RIVER_W + RIVER_E ) / 2, RIVERBED_Y, 0 );
		group.add( bed );

	}

	// --- Pont de Pierre ------------------------------------------------------------------------
	{

		const span = RIVER_E - RIVER_W;
		const arches = 17;
		const pitch = span / arches;
		const pier = 3.2;
		const springY = WATER_Y + 0.6;
		const deckBottom = BRIDGE.deckY - 1.3;
		const shape = new THREE.Shape();
		shape.moveTo( RIVER_W - 2, RIVERBED_Y );
		shape.lineTo( RIVER_E + 2, RIVERBED_Y );
		shape.lineTo( RIVER_E + 2, BRIDGE.deckY );
		shape.lineTo( RIVER_W - 2, BRIDGE.deckY );
		shape.closePath();
		const medallions = [];
		for ( let i = 0; i < arches; i ++ ) {

			const a = RIVER_W + i * pitch + pier / 2, b = RIVER_W + ( i + 1 ) * pitch - pier / 2;
			const r = ( b - a ) / 2;
			const rise = Math.min( r, deckBottom - springY );
			const hole = new THREE.Path();
			hole.moveTo( a, RIVERBED_Y - 0.01 + 0.2 );
			hole.lineTo( a, springY );
			hole.absellipse( ( a + b ) / 2, springY, r, rise, Math.PI, 0, true );
			hole.lineTo( b, RIVERBED_Y + 0.2 );
			hole.closePath();
			shape.holes.push( hole );
			if ( i > 0 ) medallions.push( RIVER_W + i * pitch );

		}

		const geo = new THREE.ExtrudeGeometry( shape, { depth: BRIDGE.halfW * 2, bevelEnabled: false, curveSegments: 10 } );
		geo.translate( 0, 0, BRIDGE.z - BRIDGE.halfW );
		// scale UVs (ExtrudeGeometry emits world units)
		const uv = geo.attributes.uv;
		for ( let i = 0; i < uv.count; i ++ ) uv.setXY( i, uv.getX( i ) / 6, uv.getY( i ) / 6 );
		mesh( geo, brickMat, group );

		const bridge = new GeoBatch();
		const pale = new THREE.Color( 0.97, 0.95, 0.9 );
		const z0 = BRIDGE.z - BRIDGE.halfW, z1 = BRIDGE.z + BRIDGE.halfW;
		// deck & cornice
		bridge.box( RIVER_W - 2, BRIDGE.deckY - 0.5, z0 - 0.5, RIVER_E + 2, BRIDGE.deckY, z1 + 0.5, 2, pale, 'nst' );
		// parapets
		for ( const [ a, b ] of [ [ z0 - 0.4, z0 + 0.2 ], [ z1 - 0.2, z1 + 0.4 ] ] ) {

			bridge.box( RIVER_W - 2, BRIDGE.deckY, a, RIVER_E + 2, BRIDGE.deckY + 1.05, b, 2, pale, 'nstew' );
			physics.add( RIVER_W - 2, BRIDGE.deckY, a, RIVER_E + 2, BRIDGE.deckY + 1.05, b, null );

		}

		// cutwaters and medallions on the piers
		for ( const px of medallions ) {

			for ( const side of [ - 1, 1 ] ) {

				const zf = side < 0 ? z0 : z1;
				bridge.box( px - pier / 2, RIVERBED_Y, Math.min( zf, zf + side * 2.4 ), px + pier / 2, springY + 1.2, Math.max( zf, zf + side * 2.4 ), 2, pale, side < 0 ? 'nwet' : 'swet' );
				// medallion
				const mz = zf + side * 0.06;
				const R = 0.9, cy = ( springY + deckBottom ) / 2 + 0.6;
				for ( let k = 0; k < 12; k ++ ) {

					const a0 = k / 12 * Math.PI * 2, a1 = ( k + 1 ) / 12 * Math.PI * 2;
					const p0 = [ px + Math.cos( a0 ) * R, cy + Math.sin( a0 ) * R, mz ];
					const p1 = [ px + Math.cos( a1 ) * R, cy + Math.sin( a1 ) * R, mz ];
					if ( side > 0 ) bridge.tri( [ px, cy, mz ], p0, p1, [ 0, 0, 1, 0, 0, 1 ], pale );
					else bridge.tri( [ px, cy, mz ], p1, p0, [ 0, 0, 1, 0, 0, 1 ], pale );

				}

			}

			physics.add( px - pier / 2, RIVERBED_Y, z0 - 2.4, px + pier / 2, deckBottom, z1 + 2.4, null );

		}

		physics.add( RIVER_W - 2, deckBottom, z0, RIVER_E + 2, BRIDGE.deckY, z1, null, { tag: 'bridge' } );
		mesh( bridge.toGeometry(), quayMat, group );

		// lamp posts on the parapets above each pier
		const lampGeo = new THREE.CylinderGeometry( 0.07, 0.11, 4.2, 6 );
		lampGeo.translate( 0, 2.1, 0 );
		const headGeo = new THREE.SphereGeometry( 0.28, 10, 8 );
		const lamps = new THREE.InstancedMesh( lampGeo, metalMat, medallions.length * 2 );
		const heads = new THREE.InstancedMesh( headGeo, new THREE.MeshStandardMaterial( { color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 0.6, roughness: 0.3 } ), medallions.length * 2 );
		const m4 = new THREE.Matrix4();
		medallions.forEach( ( px, i ) => {

			[ z0 - 0.1, z1 + 0.1 ].forEach( ( pz, k ) => {

				m4.makeTranslation( px, BRIDGE.deckY + 1.05, pz );
				lamps.setMatrixAt( i * 2 + k, m4 );
				m4.makeTranslation( px, BRIDGE.deckY + 1.05 + 4.4, pz );
				heads.setMatrixAt( i * 2 + k, m4 );

			} );

		} );
		lamps.castShadow = true;
		group.add( lamps, heads );

	}

	// pinnacles (instanced cones)
	{

		const cone = new THREE.ConeGeometry( 1, 1, 6 );
		cone.translate( 0, 0.5, 0 );
		const inst = new THREE.InstancedMesh( cone, new THREE.MeshStandardMaterial( { map: tex.gothicPlain, roughness: 0.9 } ), pinnacles.length );
		const m4 = new THREE.Matrix4();
		pinnacles.forEach( ( [ px, py, pz, r, h ], i ) => {

			m4.makeScale( r, h, r ).setPosition( px, py, pz );
			inst.setMatrixAt( i, m4 );

		} );
		inst.castShadow = true;
		inst.receiveShadow = true;
		group.add( inst );

	}

	mesh( gothic.toGeometry(), gothicMat, group );
	mesh( stone.toGeometry(), stoneMat, group );
	mesh( slate.toGeometry(), slateMat, group );
	mesh( quay.toGeometry(), quayMat, group );

	return group;

}

